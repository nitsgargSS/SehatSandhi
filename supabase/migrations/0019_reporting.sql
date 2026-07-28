-- ============================================================================
-- Sehatsandhi — reporting a business can read about itself
--
-- Run AFTER 0018. Safe to re-run.
--
-- 0013 started recording events and shipped business_daily_stats over them. But
-- site_events has an admin-only SELECT policy, and that view is security_invoker
-- — so a clinic reading its own numbers got an empty table. The data was being
-- collected for an audience that could not see it.
--
-- Fixed with a function rather than a policy on site_events. Raw events are a
-- behavioural trail; a clinic has no business reading rows, only totals. This
-- returns aggregates and nothing else, and checks the caller owns the listing.
--
-- It joins the two halves of the funnel: site_events knows about interest
-- (listed, opened, tapped) and appointments knows about outcome (booked, seen,
-- no-show). Neither is useful alone — "240 views" means nothing without "and 3
-- of them turned up".
-- ============================================================================

create or replace function sehat_caller_owns_listing(p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from doctors d
     where d.id = p_doctor_id
       and (
         sehat_is_admin()
         or d.email = auth.jwt() ->> 'email'
         or exists (
           select 1 from clinic_users cu
            where cu.doctor_id = d.id and cu.supabase_user_id = auth.uid() and cu.is_active
         )
         -- A hospital may read its consultants' numbers; that is the point of
         -- employing them.
         or (d.organization_id is not null and sehat_caller_owns_org(d.organization_id))
       )
  );
$$;

-- ── What a business sees about itself ──────────────────────────────────────

create or replace function sehat_business_report(
  p_doctor_id uuid,
  p_days      integer default 30
)
returns table (
  day             date,
  times_listed    integer,
  profile_views   integer,
  whatsapp_clicks integer,
  unique_visitors integer,
  bookings        integer,
  completed       integer,
  cancelled       integer,
  no_show         integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from date := current_date - greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not sehat_caller_owns_listing(p_doctor_id) then
    raise exception 'you are not authorised to read this listing''s reports'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  -- Every day in the range, so a quiet day is a gap in the chart rather than a
  -- missing bar that silently shortens the axis.
  with days as (
    select generate_series(v_from, current_date, interval '1 day')::date as d
  ),
  ev as (
    select date_trunc('day', created_at)::date as d,
           count(*) filter (where event_type = 'doctor_impression') as listed,
           count(*) filter (where event_type = 'doctor_view')       as views,
           count(*) filter (where event_type = 'whatsapp_click')    as taps,
           count(distinct session_id)                                as visitors
      from site_events
     where doctor_id = p_doctor_id and created_at >= v_from
     group by 1
  ),
  ap as (
    select date_trunc('day', created_at)::date as d,
           count(*)                                         as booked,
           count(*) filter (where status = 'completed')      as done,
           count(*) filter (where status = 'cancelled')      as cancelled,
           count(*) filter (where status = 'no_show')        as missed
      from appointments
     where doctor_id = p_doctor_id and created_at >= v_from
     group by 1
  )
  select days.d,
         coalesce(ev.listed, 0)::integer,
         coalesce(ev.views, 0)::integer,
         coalesce(ev.taps, 0)::integer,
         coalesce(ev.visitors, 0)::integer,
         coalesce(ap.booked, 0)::integer,
         coalesce(ap.done, 0)::integer,
         coalesce(ap.cancelled, 0)::integer,
         coalesce(ap.missed, 0)::integer
    from days
    left join ev on ev.d = days.d
    left join ap on ap.d = days.d
   order by days.d;
end $$;

grant execute on function sehat_business_report(uuid, integer) to authenticated;

comment on function sehat_business_report is
  'Daily interest and outcome for one listing. Aggregates only — a clinic has no '
  'business reading raw event rows. Returns every day in the range, including '
  'empty ones.';

-- ── What the platform sees about itself ────────────────────────────────────

create or replace function sehat_platform_report(p_days integer default 30)
returns table (
  day             date,
  visitors        integer,
  page_views      integer,
  searches        integer,
  profile_views   integer,
  whatsapp_clicks integer,
  business_leads  integer,
  new_listings    integer,
  bookings        integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from date := current_date - greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not sehat_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  with days as (
    select generate_series(v_from, current_date, interval '1 day')::date as d
  ),
  ev as (
    select date_trunc('day', created_at)::date as d,
           count(distinct session_id)                                as visitors,
           count(*) filter (where event_type = 'page_view')           as pages,
           count(*) filter (where event_type = 'search')              as searches,
           count(*) filter (where event_type = 'doctor_view')         as views,
           count(*) filter (where event_type = 'whatsapp_click')      as taps,
           count(*) filter (where event_type = 'business_lead')       as leads
      from site_events where created_at >= v_from group by 1
  ),
  li as (
    select date_trunc('day', created_at)::date as d, count(*) as n
      from doctors where created_at >= v_from group by 1
  ),
  ap as (
    select date_trunc('day', created_at)::date as d, count(*) as n
      from appointments where created_at >= v_from group by 1
  )
  select days.d,
         coalesce(ev.visitors, 0)::integer, coalesce(ev.pages, 0)::integer,
         coalesce(ev.searches, 0)::integer, coalesce(ev.views, 0)::integer,
         coalesce(ev.taps, 0)::integer,     coalesce(ev.leads, 0)::integer,
         coalesce(li.n, 0)::integer,        coalesce(ap.n, 0)::integer
    from days
    left join ev on ev.d = days.d
    left join li on li.d = days.d
    left join ap on ap.d = days.d
   order by days.d;
end $$;

grant execute on function sehat_platform_report(integer) to authenticated;

-- ── Where to expand next ───────────────────────────────────────────────────
-- demand_by_area (0013) is security_invoker over site_events, so only an admin
-- resolves rows through it. Wrapped here so the admin screen gets a stable
-- shape and a bounded window.

create or replace function sehat_demand_report(p_days integer default 90)
returns table (
  pin_code        text,
  area_name       text,
  speciality      text,
  searches        integer,
  searchers       integer,
  active_listings integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from date := current_date - greatest(1, least(coalesce(p_days, 90), 365));
begin
  if not sehat_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  select e.pin_code,
         coalesce(sa.area_name, e.pin_code),
         e.speciality,
         count(*)::integer,
         count(distinct e.session_id)::integer,
         (select count(*) from doctors d
           where d.status = 'active' and e.pin_code = any(d.pin_codes)
             and (e.speciality is null or d.speciality = e.speciality))::integer
    from site_events e
    left join service_areas sa on sa.pin_code = e.pin_code
   where e.event_type = 'search' and e.pin_code is not null and e.created_at >= v_from
   group by e.pin_code, sa.area_name, e.speciality
   order by count(*) desc;
end $$;

grant execute on function sehat_demand_report(integer) to authenticated;

comment on function sehat_demand_report is
  'Searches by area and speciality against the listings that serve them. A row '
  'with many searches and zero listings is an unserved market — the argument for '
  'entering a town, and the reason this is worth collecting.';
