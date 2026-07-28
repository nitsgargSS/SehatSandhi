-- ============================================================================
-- Sehatsandhi — site events, so reporting has something to report on
--
-- Run AFTER 0012. Safe to re-run.
--
-- WHY A NEW TABLE RATHER THAN site_visits
-- site_visits exists in the baseline and has never been written to by anything.
-- It also carries latitude and longitude, which we have no use for and would
-- have to justify holding under the DPDP Act. This table records what a business
-- actually needs to know — was I seen, was I searched for, did anyone tap
-- WhatsApp — and nothing that identifies a person.
--
-- WHAT IS DELIBERATELY NOT HERE
-- No IP address, no coordinates, no device fingerprint, no patient identifier.
-- session_id is a random string the browser generates per tab and forgets; it
-- exists only to tell "one person looked at six doctors" from "six people looked
-- at one doctor". Two visits by the same person on different days are not
-- linkable, by design.
--
-- HISTORY CANNOT BE BACKFILLED
-- This is why it ships before the dashboards that read it: every day without it
-- is a day of counts that can never be recovered.
-- ============================================================================

create table if not exists site_events (
  id bigserial primary key,

  -- What happened. Constrained so a typo in the client becomes a visible error
  -- rather than a category that silently never appears in any report.
  event_type text not null check (event_type in (
    'page_view',        -- any page
    'search',           -- a speciality/area search was run
    'doctor_view',      -- a listing's profile was opened
    'doctor_impression',-- a listing appeared in a result set
    'whatsapp_click',   -- the WhatsApp button was tapped
    'call_click',       -- the phone number was tapped
    'book_start',       -- a booking flow was entered
    'business_lead'     -- the business signup wizard was entered
  )),

  -- Random per browser tab, not a user id. See the note above.
  session_id text not null,

  path text,                       -- which page, no query string
  doctor_id uuid references doctors(id) on delete set null,
  speciality text,
  pin_code text,
  -- Host only ('google.com'), never the full referring URL, which can carry the
  -- searched terms and in some cases identifiers.
  referrer_host text,
  device_type text check (device_type in ('mobile', 'tablet', 'desktop')),

  created_at timestamptz not null default now()
);

-- Reporting reads by day, by doctor, and by type. These three cover it.
create index if not exists site_events_created_idx on site_events (created_at desc);
create index if not exists site_events_doctor_idx on site_events (doctor_id, created_at desc)
  where doctor_id is not null;
create index if not exists site_events_type_idx on site_events (event_type, created_at desc);

comment on table site_events is
  'Anonymous product analytics. No IP, no coordinates, no personal identifier — '
  'session_id is per browser tab and is not linkable across days. Aggregated by '
  'business_daily_stats and platform_daily_stats.';

alter table site_events enable row level security;

-- The browser writes these with the public key, so insert is open — there is no
-- way to record an anonymous visit otherwise. Reading is not: raw rows are a
-- behavioural trail, and every consumer below is an aggregate.
drop policy if exists "anyone_can_record_events" on site_events;
create policy "anyone_can_record_events" on site_events
  for insert with check (true);

drop policy if exists "admins_read_events" on site_events;
create policy "admins_read_events" on site_events
  for select using (sehat_is_admin());

-- ── Retention ──────────────────────────────────────────────────────────────
-- Raw events age out; the daily rollups below are what reporting actually
-- reads, so trends survive the purge. Call from pg_cron once scheduled.

create or replace function sehat_purge_old_site_events(p_keep_days integer default 400)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  delete from site_events where created_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function sehat_purge_old_site_events is
  'Drops raw events older than p_keep_days (default ~13 months, so a full '
  'year-on-year comparison survives). Rollup views are unaffected.';

-- ── What a business sees about itself ──────────────────────────────────────
-- security_invoker = on so the caller's own RLS decides which doctor rows they
-- may see. A clinic reading this gets its own numbers; an admin gets everyone's.

create or replace view business_daily_stats
with (security_invoker = on) as
select
  e.doctor_id,
  date_trunc('day', e.created_at)::date          as day,
  count(*) filter (where e.event_type = 'doctor_impression') as times_listed,
  count(*) filter (where e.event_type = 'doctor_view')       as profile_views,
  count(*) filter (where e.event_type = 'whatsapp_click')    as whatsapp_clicks,
  count(*) filter (where e.event_type = 'call_click')        as call_clicks,
  count(distinct e.session_id)                                as unique_visitors
from site_events e
where e.doctor_id is not null
group by e.doctor_id, date_trunc('day', e.created_at)::date;

comment on view business_daily_stats is
  'Per-listing daily counts. Pair with appointment_outcomes for the other half '
  'of the funnel — this view knows about interest, not about who turned up.';

-- ── What the platform sees about itself ────────────────────────────────────

create or replace view platform_daily_stats
with (security_invoker = on) as
select
  date_trunc('day', created_at)::date as day,
  count(distinct session_id)                                  as visitors,
  count(*) filter (where event_type = 'page_view')            as page_views,
  count(*) filter (where event_type = 'search')               as searches,
  count(*) filter (where event_type = 'doctor_view')          as profile_views,
  count(*) filter (where event_type = 'whatsapp_click')       as whatsapp_clicks,
  count(*) filter (where event_type = 'business_lead')        as business_leads
from site_events
group by date_trunc('day', created_at)::date;

-- Where demand is, including where we have no supply — the pincodes people
-- search that we cannot serve are the argument for entering a new town.
create or replace view demand_by_area
with (security_invoker = on) as
select
  e.pin_code,
  e.speciality,
  count(*)                        as searches,
  count(distinct e.session_id)    as searchers,
  max(e.created_at)               as last_searched_at,
  (select count(*) from doctors d
    where d.status = 'active' and e.pin_code = any(d.pin_codes)) as active_listings
from site_events e
where e.event_type = 'search' and e.pin_code is not null
group by e.pin_code, e.speciality;

comment on view demand_by_area is
  'Searches by area and speciality against how many active listings serve them. '
  'A high searches / zero listings row is an unserved market.';
