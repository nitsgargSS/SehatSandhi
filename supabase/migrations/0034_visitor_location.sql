-- ============================================================================
-- Sehatsandhi — where the people looking at us actually are
--
-- Run AFTER 0032. (0033 is a sandbox-only seed that was never committed.) Safe to re-run.
--
-- THIS PARTLY REVERSES A DECISION MADE IN 0013, ON PURPOSE
-- 0013 dropped the baseline's site_visits table and said, in as many words, that
-- it carried latitude and longitude "which we have no use for and would have to
-- justify holding under the DPDP Act". That was true when the only question was
-- "how is this listing performing". It stopped being true once the question
-- became "which towns should we open in next, and where is the demand we are not
-- serving" — a question site_events cannot answer, because a pin_code is only
-- recorded when someone types one into a search.
--
-- So coordinates come back. The justification 0013 asked for, written down:
--
--   PURPOSE      Deciding which areas to expand into and where supply is short.
--   GRANULARITY  City-level from IP for everyone; exact only where the visitor
--                pressed Allow on the browser's own permission prompt.
--   IDENTITY     The per-tab session id from 0013 and nothing else. It still
--                dies with the tab, so two visits on different days are still
--                not linkable to each other, and none of this is linked to a
--                name, a phone number or a booking.
--   RETENTION    90 days idle, purged by the function at the bottom. 0013's
--                events keep their own ~400-day life; this table is not history,
--                it is a current picture, and a stale row is not a picture.
--
-- WHY ONE ROW PER SESSION, NOT AN EVENT LOG
-- "Only maintain active location" — the ask was where visitors are now, not
-- everywhere a visitor has ever been. A moving-around trail is both more
-- sensitive and less useful than a current position, so the primary key is the
-- session id and a second reading overwrites the first. There is no history here
-- to leak, because none is kept.
-- ============================================================================

create table if not exists visitor_locations (
  -- Same random per-tab id as site_events.session_id, and the reason this is a
  -- primary key rather than a column: one row per visit, overwritten in place.
  session_id text primary key,

  -- Coarse, always present when the lookup succeeds.
  city        text,
  region      text,          -- state, e.g. 'Haryana'
  country     text,          -- ISO-2, e.g. 'IN'
  postal_code text,          -- frequently null on Indian mobile IPs

  -- Rounded to ~1 km (3 decimal places) when it came from an IP lookup, because
  -- an IP cannot resolve better than a city and false precision invites someone
  -- to read it as though it could. Full precision only with consent.
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),

  -- Which of the two produced the row above. 'gps' means the visitor pressed
  -- Allow; 'ip' means they were never asked. Reporting must be able to tell
  -- them apart — a map that mixes them is a map of two different things.
  source text not null default 'ip' check (source in ('ip', 'gps')),

  -- Denormalised from site_events so the "who is on the site right now" query
  -- does not need a join. Bumped on every ping.
  first_seen_at  timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

-- "Active in the last N minutes" is the whole point of the table, and it is the
-- only ordering anything asks for.
create index if not exists visitor_locations_active_idx
  on visitor_locations (last_active_at desc);

-- Expansion planning reads by area.
create index if not exists visitor_locations_area_idx
  on visitor_locations (country, region, city);

comment on table visitor_locations is
  'Current location of each active visit, one row per per-tab session id, '
  'overwritten in place — not a movement history. City-level from IP unless '
  'the visitor granted the browser location prompt (source = gps). Purged '
  'after 90 days idle by sehat_purge_stale_visitor_locations().';

alter table visitor_locations enable row level security;

-- ── Who may write ──────────────────────────────────────────────────────────
-- Nobody, with the public key. Unlike site_events, this table is NOT open to
-- browser inserts: a row here asserts "this session is at these coordinates",
-- and a client that could write it directly could put any session anywhere,
-- which would quietly poison the one table we intend to make expansion
-- decisions from. The record-visitor-location function holds the service role
-- and is the only writer. It derives city from the request IP itself, so the
-- coarse path cannot be forged at all.
--
-- No insert/update policy is defined, so RLS denies both to anon and authed.

drop policy if exists "admins_read_locations" on visitor_locations;
create policy "admins_read_locations" on visitor_locations
  for select using (sehat_is_admin());

-- ── Upsert, called by the edge function under the service role ─────────────
-- security definer so the function body, not the caller, owns the write.
--
-- first_seen_at survives an update while everything else is replaced: that is
-- what makes "this visit started 20 minutes ago and is now in Jagadhri" a thing
-- the table can say.
--
-- A gps row is never overwritten by a later ip row for the same session. The
-- pings keep coming while a tab is open, and without this rule a consented
-- exact position would be flattened back to a city centroid by the next
-- heartbeat, making the Allow button look broken.

create or replace function sehat_record_visitor_location(
  p_session_id  text,
  p_city        text,
  p_region      text,
  p_country     text,
  p_postal_code text,
  p_latitude    numeric,
  p_longitude   numeric,
  p_source      text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_session_id is null or length(trim(p_session_id)) = 0 then
    return;
  end if;
  if p_source not in ('ip', 'gps') then
    raise exception 'bad source %', p_source using errcode = 'check_violation';
  end if;

  insert into visitor_locations as v (
    session_id, city, region, country, postal_code,
    latitude, longitude, source, first_seen_at, last_active_at
  ) values (
    left(p_session_id, 64), p_city, p_region, p_country, p_postal_code,
    p_latitude, p_longitude, p_source, now(), now()
  )
  on conflict (session_id) do update set
    -- Coarse data never clobbers consented precise data; see above.
    city        = case when v.source = 'gps' and p_source = 'ip' then v.city        else excluded.city        end,
    region      = case when v.source = 'gps' and p_source = 'ip' then v.region      else excluded.region      end,
    country     = case when v.source = 'gps' and p_source = 'ip' then v.country     else excluded.country     end,
    postal_code = case when v.source = 'gps' and p_source = 'ip' then v.postal_code else excluded.postal_code end,
    latitude    = case when v.source = 'gps' and p_source = 'ip' then v.latitude    else excluded.latitude    end,
    longitude   = case when v.source = 'gps' and p_source = 'ip' then v.longitude   else excluded.longitude   end,
    source      = case when v.source = 'gps' and p_source = 'ip' then v.source      else excluded.source      end,
    -- Always bumped. A heartbeat that changes nothing else still proves the
    -- visit is alive, which is the column reporting filters on.
    last_active_at = now();
end $$;

comment on function sehat_record_visitor_location is
  'Upsert the current location of one visit. Called only by the '
  'record-visitor-location edge function under the service role. A gps-sourced '
  'row is never downgraded to ip-sourced; last_active_at always advances.';

-- ── Retention ──────────────────────────────────────────────────────────────
-- 90 days idle. Schedule beside sehat_purge_old_site_events in pg_cron.

create or replace function sehat_purge_stale_visitor_locations(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted integer;
begin
  delete from visitor_locations
   where last_active_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function sehat_purge_stale_visitor_locations is
  'Drops visit locations idle longer than p_keep_days (default 90). This table '
  'is a current picture, not history — see the header of 0034.';

-- ── What reporting reads ───────────────────────────────────────────────────
-- security_invoker = on, so the admin-only select policy above applies to these
-- exactly as it does to the table.

-- Who is on the site right now.
create or replace view visitors_live
with (security_invoker = on) as
select
  session_id, city, region, country, postal_code,
  latitude, longitude, source, first_seen_at, last_active_at,
  round(extract(epoch from (now() - last_active_at)) / 60)::int as minutes_idle
from visitor_locations
where last_active_at > now() - interval '30 minutes'
order by last_active_at desc;

comment on view visitors_live is
  'Sessions active in the last 30 minutes, most recent first.';

-- Where our visitors are, for expansion decisions. Counts kept separate by
-- source: mixing a consented GPS fix with a city centroid guessed from a mobile
-- IP would read as one number with one accuracy, and it is not.
create or replace view visitors_by_area
with (security_invoker = on) as
select
  country,
  region,
  city,
  postal_code,
  count(*)                                      as visits,
  count(*) filter (where source = 'gps')        as precise_visits,
  avg(latitude)  filter (where source = 'gps')  as approx_latitude,
  avg(longitude) filter (where source = 'gps')  as approx_longitude,
  max(last_active_at)                           as last_seen_at
from visitor_locations
group by country, region, city, postal_code;

comment on view visitors_by_area is
  'Visit counts by area. precise_visits is the consented-GPS subset; the '
  'averaged coordinates are computed from that subset only, because IP '
  'coordinates are city centroids and would drag the average to nowhere real.';
