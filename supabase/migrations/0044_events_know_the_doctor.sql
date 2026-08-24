-- ============================================================================
-- Sehatsandhi — analytics events know which doctor they were about
--
-- Run AFTER 0043. Safe to re-run.
--
-- ⚠ RECONSTRUCTED, NOT THE ORIGINAL ⚠
-- Same provenance as 0043: written and applied to sandbox by Sandeep Goyal on
-- 2026-08-12, never committed, rebuilt on 2026-08-24 from the prod↔sandbox
-- catalog difference. It reproduces the schema, not necessarily every action
-- the original took — a backfill of existing site_events rows, for instance,
-- would leave no trace here. See 0043's header.
--
-- ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
-- site_events carried doctor_id, which 0037 nulled out wholesale when the
-- `doctors` table was split — the migration's own comment says the value of
-- that log is the searches themselves, not which listing they reached. But a
-- clinic's Reports tab wants per-doctor numbers, and a business_id cannot give
-- them: a hospital with nine consultants is one business and nine different
-- profiles a patient might have viewed.
--
-- So events get a practitioner_id of their own, alongside the business. Nullable
-- and set null on delete: an impression happened whether or not the doctor is
-- still listed, and losing the person must not lose the count.
-- ============================================================================


-- ============================================================================
-- 1. The column
-- ============================================================================

alter table site_events
  add column if not exists practitioner_id uuid references practitioners(id) on delete set null;

comment on column site_events.practitioner_id is
  'Which practitioner this event was about, where it was about one at all. '
  'Distinct from the business: a hospital is one listing and many profiles, and '
  'per-doctor reporting cannot be derived from the business id.';

-- Partial: most events are not about a practitioner, and an index carrying
-- those nulls would be mostly dead weight on the busiest-written table here.
-- (practitioner_id, created_at) rather than practitioner_id alone, because
-- every read of this is "for this doctor, over this period".
create index if not exists site_events_practitioner_idx
  on site_events (practitioner_id, created_at)
  where practitioner_id is not null;


-- ============================================================================
-- 2. Per-doctor, per-day
--
-- Aggregated in the database rather than in the dashboard: the Reports tab used
-- to pull rows and count them in the browser, which under-reports the moment
-- there are more events than the page limit.
-- ============================================================================

create or replace view practitioner_daily_stats as
  select
    practitioner_id,
    (date_trunc('day', created_at))::date as day,
    count(*) filter (where event_type = 'doctor_impression') as times_listed,
    count(*) filter (where event_type = 'doctor_view')       as profile_views,
    count(*) filter (where event_type = 'whatsapp_click')    as whatsapp_clicks,
    count(distinct session_id)                               as unique_visitors
  from site_events e
  where practitioner_id is not null
  group by practitioner_id, (date_trunc('day', created_at))::date;

comment on view practitioner_daily_stats is
  'Impressions, profile views and WhatsApp clicks per practitioner per day. '
  'Counted in the database because the dashboard used to count the rows it had '
  'loaded, which silently under-reported past the page limit.';

-- ── NOTE FOR WHOEVER PICKS THIS UP ─────────────────────────────────────────
-- On sandbox this view is granted to postgres and service_role ONLY. It is NOT
-- granted to `authenticated`, so a signed-in clinic cannot read it, which makes
-- it unusable from the dashboard as things stand.
--
-- Reproduced as found rather than "fixed", because this is a reconstruction and
-- guessing at intent is how a reconstruction becomes a rewrite. It is either
-- deliberate — the view is for admin and service-role reporting — or the grant
-- was forgotten. Ask Sandeep; if it is the latter, the one line is:
--
--     grant select on practitioner_daily_stats to authenticated;
--
-- and it will need an RLS-shaped filter too, since a view with no WHERE clause
-- on business would show every clinic every other clinic's numbers.
