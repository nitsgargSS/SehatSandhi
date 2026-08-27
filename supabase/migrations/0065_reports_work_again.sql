-- ============================================================================
-- Sehatsandhi — the Reports tab has never worked since the rename
--
-- Run AFTER 0064. Safe to re-run.
--
-- ── THREE BREAKAGES IN ONE FUNCTION ─────────────────────────────────────────
-- sehat_business_report dates from 0019 and was never revisited. Since 0037
-- applied it has been broken in three separate ways, any one of which is fatal:
--
--   1. It calls sehat_caller_owns_listing(), which 0037 dropped.
--   2. It reads site_events.doctor_id, renamed to business_id by 0037.
--   3. It reads appointments.doctor_id, likewise.
--
-- The first one is what actually fires:
--     ERROR: function sehat_caller_owns_listing(uuid) does not exist
-- so nobody has ever reached the other two.
--
-- 0039 is called "finish the rename" and did not finish it. This is the third
-- function found this month still reading tables 0037 removed — after
-- Dashboard.tsx's RPC call and clinic-otp. The lesson is in
-- renames-need-function-bodies-checked: Postgres does not parse plpgsql bodies
-- for dependencies, so a rename breaks them silently and only at runtime.
--
-- ── AND A NAME THAT LIES ────────────────────────------------------------------
-- The parameter is p_doctor_id and has always taken a listing id, which is now
-- a business id. Renamed here, which needs a DROP: Postgres refuses to change
-- an input parameter's name through CREATE OR REPLACE. The one caller in the
-- dashboard is updated in the same commit.
--
-- ── WHO MAY READ IT ─────────────────────────────────────────────────────────
-- Owner and doctors. Not reception, and — decided deliberately — not managers
-- either. Revenue, impressions and conversion are the business's own numbers
-- and the people who see them are the ones accountable for the practice.
-- ============================================================================

drop function if exists sehat_business_report(uuid, integer);

create function sehat_business_report(
  p_business_id uuid,
  p_days        integer default 30
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
  -- sehat_caller_is_clinical is owner-or-doctor, which is exactly the rule
  -- wanted here; admins keep their override for support.
  if not (sehat_caller_is_clinical(p_business_id) or sehat_is_admin()) then
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
           count(distinct session_id)                               as visitors
      from site_events
     where business_id = p_business_id and created_at >= v_from
     group by 1
  ),
  ap as (
    select date_trunc('day', created_at)::date as d,
           count(*)                                    as booked,
           count(*) filter (where status = 'completed') as done,
           count(*) filter (where status = 'cancelled') as cancelled,
           count(*) filter (where status = 'no_show')   as missed
      from appointments
     where business_id = p_business_id and created_at >= v_from
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

comment on function sehat_business_report is
  'Daily reach and booking figures for one listing. Owner and doctors only — '
  'not reception, not managers. Repaired in 0065: it had been calling a '
  'function 0037 dropped and reading two columns 0037 renamed, and had '
  'therefore never run since.';

-- revoke from PUBLIC, not from anon — see 0064. `from anon` alone does nothing.
revoke all on function sehat_business_report(uuid, integer) from public, anon;
grant execute on function sehat_business_report(uuid, integer) to authenticated;


-- ============================================================================
-- The stale guard itself, removed
--
-- sehat_caller_owns_listing was dropped by 0037, but 0027's definition is still
-- in the repo and would be recreated by anyone replaying that file. Nothing
-- should call it: sehat_caller_owns_business is the one authority now.
-- Left as a comment rather than a DROP, because there is nothing to drop.
-- ============================================================================
