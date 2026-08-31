-- ============================================================================
-- Sehatsandhi — where the businesses are, where they are not, and who is due
--
-- Run AFTER 0092. Safe to re-run.
--
-- Admin could see a list of businesses and nothing about the shape of them:
-- which districts are covered, which pincodes have population and no listing,
-- what kind of business clusters where, and whose term is about to run out.
-- Four questions that are really one — where is the business coming from, and
-- where should it come from next.
--
-- ── LOCATED IN IS NOT THE SAME AS SELLS INTO ────────────────────────────────
-- The trap in every query below, and the reason this file exists rather than a
-- handful of views.
--
--   practice_locations.pin_code   where the clinic physically IS
--   businesses.pin_codes[]        every pincode it advertises INTO
--
-- Measured before writing this: one sandbox listing carries 20 pincodes and
-- another carries 1. Counting registrations off the coverage array would report
-- that hospital as twenty registrations in twenty places, and "most
-- registrations" would simply name whichever area the widest advertiser picked.
--
-- So `businesses` counts primary locations — one business, one place, the
-- honest answer to "how many registered here". `covering` counts the coverage
-- array separately, because "who can be found here" is a real and different
-- question. Both are returned; neither is allowed to stand in for the other.
--
-- ── WHAT "SCOPE FOR IMPROVEMENT" MEANS HERE ─────────────────────────────────
-- Deliberately not a score. An area with population and no listing is an
-- opportunity; an area with one listing per two thousand residents is not.
-- residents_per_business says that plainly and lets the reader judge, where a
-- weighted index would hide the arithmetic and be argued with. Areas with no
-- business at all sort first, because that is the list a sales conversation
-- starts from.
-- ============================================================================


-- ============================================================================
-- 1. Registrations by area
--
-- p_scope is 'pincode', 'district' or 'state'. The filters narrow before
-- grouping, so asking for districts within Haryana is one call and not a
-- client-side filter over every district in the country.
-- ============================================================================

create or replace function sehat_admin_area_report(
  p_scope    text default 'district',
  p_state    text default null,
  p_district text default null,
  p_pincode  text default null
)
returns table (
  scope             text,
  state             text,
  district          text,
  pin_code          text,
  area_name         text,
  population        bigint,
  areas             integer,
  -- Businesses whose PRIMARY LOCATION is here. The registration count.
  businesses        integer,
  active            integer,
  pending           integer,
  -- Businesses that ADVERTISE here, wherever they are based. Always >= the
  -- above and usually much larger; a different question, kept separate.
  covering          integer,
  -- Population divided by registrations. Null where nobody has registered,
  -- which is the strongest signal on the sheet rather than a missing value.
  residents_per_business numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text := lower(coalesce(p_scope, 'district'));
begin
  if not sehat_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if v_scope not in ('pincode', 'district', 'state') then
    v_scope := 'district';
  end if;

  return query
  with areas_f as (
    select a.* from service_areas a
     where a.is_active
       and (p_state    is null or a.state    = p_state)
       and (p_district is null or a.district = p_district)
       and (p_pincode  is null or a.pin_code = p_pincode)
  ),
  -- One row per business, at the pincode it is actually based in. The distinct
  -- on guards against a business with more than one row marked primary.
  based as (
    select distinct on (b.id) b.id, b.status, b.vertical, l.pin_code
      from businesses b
      join practice_locations l on l.business_id = b.id
     where l.is_primary and l.pin_code is not null
     order by b.id, l.created_at
  ),
  -- Coverage is one row per (business, pincode) pair, unnested from the array.
  covers as (
    select b.id, unnest(b.pin_codes) as pin_code from businesses b
  ),
  per_pin as (
    select a.pin_code, a.area_name, a.district, a.state, a.population,
           count(distinct bs.id)::integer                                     as businesses,
           count(distinct bs.id) filter (where bs.status = 'active')::integer  as active,
           count(distinct bs.id) filter (where bs.status = 'pending')::integer as pending,
           count(distinct cv.id)::integer                                      as covering
      from areas_f a
      left join based  bs on bs.pin_code = a.pin_code
      left join covers cv on cv.pin_code = a.pin_code
     group by a.pin_code, a.area_name, a.district, a.state, a.population
  )
  select
    v_scope,
    case when v_scope in ('state','district','pincode') then p.state end,
    case when v_scope in ('district','pincode')         then p.district end,
    case when v_scope = 'pincode'                       then p.pin_code end,
    case when v_scope = 'pincode'                       then p.area_name end,
    sum(p.population)::bigint,
    count(*)::integer,
    sum(p.businesses)::integer,
    sum(p.active)::integer,
    sum(p.pending)::integer,
    sum(p.covering)::integer,
    case when sum(p.businesses) > 0
         then round(sum(p.population)::numeric / sum(p.businesses), 0) end
    from per_pin p
   group by 2, 3, 4, 5
   -- Empty areas first: that is the list to act on. Then the biggest
   -- opportunity by headroom, then simply the largest.
   order by (sum(p.businesses) = 0) desc,
            case when sum(p.businesses) > 0
                 then sum(p.population)::numeric / sum(p.businesses) end desc nulls first,
            sum(p.population) desc;
end;
$$;

comment on function sehat_admin_area_report is
  'Registrations by pincode, district or state. `businesses` counts primary '
  'practice locations — where a clinic IS. `covering` counts the pin_codes '
  'array — where it advertises. Areas with no listing sort first.';


-- ============================================================================
-- 2. The matrix — what kind of business, and where
-- ============================================================================

create or replace function sehat_admin_vertical_matrix(
  p_scope text default 'district',
  p_state text default null
)
returns table (
  region     text,
  vertical   text,
  businesses integer,
  active     integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scope text := lower(coalesce(p_scope, 'district'));
begin
  if not sehat_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if v_scope not in ('district', 'state') then v_scope := 'district'; end if;

  return query
  with based as (
    select distinct on (b.id) b.id, b.status, b.vertical, l.pin_code
      from businesses b
      join practice_locations l on l.business_id = b.id
     where l.is_primary and l.pin_code is not null
     order by b.id, l.created_at
  )
  select case when v_scope = 'state' then a.state else a.district end,
         bs.vertical,
         count(*)::integer,
         count(*) filter (where bs.status = 'active')::integer
    from based bs
    join service_areas a on a.pin_code = bs.pin_code
   where p_state is null or a.state = p_state
   group by 1, 2
   order by 3 desc, 1, 2;
end;
$$;

comment on function sehat_admin_vertical_matrix is
  'Business type against district or state, from primary locations. Long form '
  'rather than a pivot: the client cross-tabulates, so adding a vertical never '
  'needs a schema change.';


-- ============================================================================
-- 3. Who is paying, for how long, and who is due
-- ============================================================================

create or replace function sehat_admin_renewals(
  p_days_ahead integer default null,
  p_state      text default null,
  p_district   text default null
)
returns table (
  business_id      uuid,
  name             text,
  vertical         text,
  status           text,
  phone            text,
  email            text,
  state            text,
  district         text,
  pin_code         text,
  plan_code        text,
  monthly_price    integer,
  months_paid      integer,
  term_start       date,
  term_end         date,
  -- Negative when the term has already run out, which is the case that most
  -- needs to be visible rather than filtered away.
  days_to_expiry   integer,
  auto_renew       boolean,
  mandate_status   text,
  renewal_price    integer,
  renewal_term_months integer,
  last_reminder_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not sehat_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  return query
  with based as (
    select distinct on (b.id) b.id, l.pin_code
      from businesses b
      join practice_locations l on l.business_id = b.id
     where l.is_primary
     order by b.id, l.created_at
  )
  select b.id, b.name, b.vertical, b.status, b.phone, b.email,
         a.state, a.district, bs.pin_code,
         b.pricing_plan_code, b.locked_monthly_price, b.months_paid,
         b.term_start, b.term_end,
         case when b.term_end is null then null
              else (b.term_end - (now() at time zone 'Asia/Kolkata')::date)::integer end,
         b.auto_renew, b.mandate_status, b.renewal_price, b.renewal_term_months,
         (select max(n.created_at) from billing_notifications n
           where n.business_id = b.id and n.kind = 'renewal_reminder')
    from businesses b
    left join based bs on bs.id = b.id
    left join service_areas a on a.pin_code = bs.pin_code
   where (p_state    is null or a.state    = p_state)
     and (p_district is null or a.district = p_district)
     -- A null term_end has never paid; it is not "due in N days" and is only
     -- shown when no window was asked for.
     and (p_days_ahead is null
          or (b.term_end is not null
              and b.term_end <= ((now() at time zone 'Asia/Kolkata')::date + p_days_ahead)))
   order by b.term_end nulls last, b.name;
end;
$$;

comment on function sehat_admin_renewals is
  'Every business with its term, renewal date and auto-renewal state. '
  'days_to_expiry goes negative for a lapsed term — the row that most needs '
  'seeing, so it is never filtered out.';


-- ============================================================================
-- 4. Queue a renewal reminder for one business, from the table
--
-- Writes the same billing_notifications row the daily job in 0083 writes, with
-- days_before null to mark it as sent by hand. The unique index there is on
-- (business, kind, term_end, days_before), so a manual nudge never collides
-- with the automatic 15-day one and a second click the same term is a no-op.
--
-- WHAT THIS DOES NOT DO: send anything. Nothing drains billing_notifications
-- yet — the sender is unbuilt and its MSG91 and AiSensy credentials are unset.
-- The row is real and will go out the moment that exists; until then this
-- queues and the admin screen says so rather than implying a message left.
-- ============================================================================

create or replace function sehat_admin_queue_reminder(p_business uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_b record;
  v_n integer;
begin
  if not sehat_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  select b.id, b.name, b.email, b.phone, b.term_end, b.renewal_term_months,
         coalesce(b.renewal_price, b.locked_monthly_price) as amount
    into v_b
    from businesses b where b.id = p_business;

  if not found then
    raise exception 'No such business' using errcode = 'P0002';
  end if;
  if v_b.term_end is null then
    return 'This business has no term to renew.';
  end if;
  if coalesce(v_b.email, '') = '' and coalesce(v_b.phone, '') = '' then
    return 'No email or phone on file — nothing to send to.';
  end if;

  insert into billing_notifications
    (business_id, kind, term_end, days_before, amount, email, phone, payload)
  values
    (v_b.id, 'renewal_reminder', v_b.term_end, null, v_b.amount, v_b.email, v_b.phone,
     jsonb_build_object('business_name', v_b.name, 'term_end', v_b.term_end,
                        'months', v_b.renewal_term_months, 'manual', true))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return case when v_n > 0
    then 'Reminder queued. It will be sent once the sender is live.'
    else 'A reminder for this term is already queued.' end;
end;
$$;

comment on function sehat_admin_queue_reminder is
  'Queues one renewal reminder by hand, alongside the automatic 15-day one. '
  'QUEUES ONLY — nothing drains billing_notifications yet, so the caller must '
  'not tell anyone a message was sent.';


-- ============================================================================
-- 5. Where we are being noticed
--
-- visitor_locations is coarse on purpose — city and region from an IP, never a
-- coordinate tied to a person. 0034 chose that and this does not widen it: the
-- question is which towns the traffic comes from, which a city name answers.
-- ============================================================================

create or replace function sehat_admin_visitor_geo(p_days integer default 30)
returns table (
  country       text,
  region        text,
  city          text,
  postal_code   text,
  sessions      integer,
  page_views    integer,
  searches      integer,
  profile_views integer,
  business_leads integer,
  last_seen     timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 730);
  v_from timestamptz := now() - make_interval(days => v_days);
begin
  if not sehat_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  return query
  select v.country, v.region, v.city, v.postal_code,
         count(distinct v.session_id)::integer,
         count(*) filter (where e.event_type = 'page_view')::integer,
         count(*) filter (where e.event_type = 'search')::integer,
         count(*) filter (where e.event_type = 'doctor_view')::integer,
         count(*) filter (where e.event_type = 'business_lead')::integer,
         max(v.last_active_at)
    from visitor_locations v
    -- Left join: a visitor who arrived and did nothing is still a place we are
    -- being seen from, and dropping them would flatter every conversion figure.
    left join site_events e
      on e.session_id = v.session_id and e.created_at >= v_from
   where v.last_active_at >= v_from
   group by v.country, v.region, v.city, v.postal_code
   order by 5 desc, 6 desc;
end;
$$;

comment on function sehat_admin_visitor_geo is
  'Which towns the traffic comes from, and what it did. City-level from IP '
  'only — 0034 deliberately keeps no coordinate tied to a person.';


-- ============================================================================
-- 6. Grants — admin screens, so authenticated and never anon.
--    `from public, anon` because either alone leaves the other. See 0088.
-- ============================================================================

revoke all on function sehat_admin_area_report(text, text, text, text)   from public, anon;
revoke all on function sehat_admin_vertical_matrix(text, text)           from public, anon;
revoke all on function sehat_admin_renewals(integer, text, text)         from public, anon;
revoke all on function sehat_admin_queue_reminder(uuid)                  from public, anon;
revoke all on function sehat_admin_visitor_geo(integer)                  from public, anon;

grant execute on function sehat_admin_area_report(text, text, text, text) to authenticated;
grant execute on function sehat_admin_vertical_matrix(text, text)         to authenticated;
grant execute on function sehat_admin_renewals(integer, text, text)       to authenticated;
grant execute on function sehat_admin_queue_reminder(uuid)                to authenticated;
grant execute on function sehat_admin_visitor_geo(integer)                to authenticated;


-- The filters need to be cheap at every scale the sheet is read at.
create index if not exists service_areas_state_district_idx on service_areas (state, district);
create index if not exists practice_locations_primary_pin_idx
  on practice_locations (pin_code) where is_primary;
create index if not exists businesses_term_end_idx on businesses (term_end) where term_end is not null;
create index if not exists visitor_locations_last_active_idx on visitor_locations (last_active_at);


notify pgrst, 'reload schema';
