-- ============================================================================
-- Sehatsandhi — "check your area" by city name too, with every pincode.
--
-- Run AFTER 0169. Safe to re-run. Adds one table, area_searches (the log
-- behind "Area interest" in the admin Leads panel).
--
-- 0166 answered a pincode. The business page's coverage card now leads with
-- the visitor's own place rather than with our first live district: they type
-- a pincode OR a city / district / state — "Gurgaon", "Gurugram", "Mumbai",
-- "Delhi", "122001" — and the card shows that place: its districts, the Census
-- 2011 population, every pincode in it, and whether we are live there.
--
-- HOW A NAME IS MATCHED (pincode_directory has pincode → district only, no
-- locality names, so a "city" is its district or districts):
--   1. common names → the directory's district names (Gurgaon → Gurugram,
--      Bangalore → Bengaluru Urban + Rural, Noida → Gautam Buddha Nagar, …);
--   2. an exact district name; else a state name (Delhi is a state of 11
--      districts; "Haryana" shows the whole state); else a district name that
--      starts with, then contains, what was typed (4+ / 5+ letters);
--      a last resort ignores the letter 'a' (Gautam Buddh = Buddha Nagar);
--   3. matches in more than one state ("Aurangabad": Bihar and Maharashtra)
--      come back as choices; the page asks, then calls again with p_state.
-- Pincodes are listed per district when there are 12 districts or fewer (Delhi
-- included); a bigger state lists its districts with counts only.
-- ============================================================================

create or replace function sehat_area_search(p_q text, p_state text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_raw text := btrim(coalesce(p_q, ''));
  v_key text := sehat_squash(p_q);
  v_keys text[];
  v_kind text := 'district';
  v_pin text;
  v_area text;
  v_hits jsonb := '[]'::jsonb;   -- [{district, state}]
  v_all_pins text[];
  v_patients integer;
  v_businesses integer;
  v_list_pins boolean;
  v_districts jsonb;
  v_census_total bigint;
  v_census_missing integer;
begin
  -- ── A pincode ──
  if v_key ~ '^[0-9]{6}$' then
    v_pin := v_key;
    if v_pin !~ '^[1-8]' then return jsonb_build_object('found', false, 'reason', 'invalid'); end if;
    select coalesce(
             (select jsonb_build_array(jsonb_build_object('district', sa.district, 'state', sa.state)) from service_areas sa where sa.pin_code = v_pin limit 1),
             (select jsonb_build_array(jsonb_build_object('district', pd.district, 'state', pd.state)) from pincode_directory pd where pd.pin_code = v_pin),
             '[]'::jsonb)
      into v_hits;
    select sa.area_name into v_area from service_areas sa where sa.pin_code = v_pin limit 1;
    if jsonb_array_length(v_hits) = 0 then
      return jsonb_build_object('found', false, 'reason', 'unknown', 'pin_code', v_pin);
    end if;
  else
    if length(v_key) < 3 or v_key ~ '[0-9]' then
      return jsonb_build_object('found', false, 'reason', 'invalid');
    end if;

    -- Everyday names → the directory's names (all squashed).
    v_keys := case v_key
      when 'gurgaon' then array['gurugram']
      when 'gurgram' then array['gurugram']
      when 'bangalore' then array['bengaluruurban','bengalururural']
      when 'bengaluru' then array['bengaluruurban','bengalururural']
      when 'bengalore' then array['bengaluruurban','bengalururural']
      when 'bombay' then array['mumbai','mumbaisuburban']
      when 'mumbai' then array['mumbai','mumbaisuburban']
      when 'navimumbai' then array['thane']
      when 'noida' then array['gautambuddhanagar']
      when 'greaternoida' then array['gautambuddhanagar']
      when 'calcutta' then array['kolkata']
      when 'madras' then array['chennai']
      when 'poona' then array['pune']
      when 'mysore' then array['mysuru']
      when 'allahabad' then array['prayagraj']
      when 'cochin' then array['ernakulam']
      when 'kochi' then array['ernakulam']
      when 'vizag' then array['visakhapatanam']
      when 'visakhapatnam' then array['visakhapatanam']
      when 'baroda' then array['vadodara']
      when 'trivandrum' then array['thiruvananthapuram']
      when 'ahmedabad' then array['ahmadabad']
      when 'mohali' then array['sasnagar']
      when 'kanpur' then array['kanpurnagar']
      when 'secunderabad' then array['hyderabad']
      when 'jagadhri' then array['yamunanagar']
      when 'benares' then array['varanasi']
      when 'banaras' then array['varanasi']
      when 'pondicherry' then array['puducherry']
      else array[v_key] end;

    with names as (
      select distinct district, state from (
        select pd.district, pd.state from pincode_directory pd
        union select sa.district, sa.state from service_areas sa) x
    ), m as (
      select district, state, 1 as tier from names where sehat_squash(district) = any(v_keys)
      union all
      select district, state, 2 from names where sehat_squash(state) = v_key
      union all
      select district, state, 3 from names where length(v_key) >= 4 and sehat_squash(district) like v_key || '%'
      union all
      select district, state, 4 from names where length(v_key) >= 5 and sehat_squash(district) like '%' || v_key || '%'
      union all
      -- Last resort, for spellings that differ only in an 'a' (Gautam Buddh /
      -- Buddha Nagar, Visakhapatnam / Visakhapatanam): compare without them.
      select district, state, 5 from names where length(v_key) >= 5
         and replace(sehat_squash(district), 'a', '') = replace(v_key, 'a', '')
    ), best as (
      select * from m where tier = (select min(tier) from m)
        and (p_state is null or sehat_squash(state) = sehat_squash(p_state))
    )
    select coalesce(jsonb_agg(jsonb_build_object('district', district, 'state', state) order by state, district), '[]'::jsonb),
           case when bool_or(tier = 2) then 'state' else 'district' end
      into v_hits, v_kind
      from best;

    if jsonb_array_length(v_hits) = 0 then
      return jsonb_build_object('found', false, 'reason', 'unknown', 'query', v_raw);
    end if;

    if (select count(distinct sehat_squash(h->>'state')) from jsonb_array_elements(v_hits) h) > 1 then
      return jsonb_build_object('found', false, 'reason', 'choose', 'query', v_raw,
        'options', (select jsonb_agg(h) from (select h from jsonb_array_elements(v_hits) h limit 12) y));
    end if;
  end if;

  -- One row per district, however it is spelled; service_areas' spelling wins.
  with h as (
    select distinct on (sehat_squash(x->>'district')) x->>'district' as district, x->>'state' as state,
           sehat_squash(x->>'district') as dk, sehat_squash(x->>'state') as sk
      from jsonb_array_elements(v_hits) x
     order by sehat_squash(x->>'district'),
              (exists (select 1 from service_areas sa where sa.district = x->>'district')) desc
  ), dir as (
    select pd.pin_code as pin, sehat_squash(pd.district) as dk, sehat_squash(pd.state) as sk from pincode_directory pd
    union
    select sa.pin_code, sehat_squash(sa.district), sehat_squash(sa.state) from service_areas sa
  ), d as (
    select h.district, h.state,
      (select dp.population from district_population dp
        where sehat_squash(dp.district) = h.dk and sehat_squash(dp.state) = h.sk limit 1) as census,
      array_agg(distinct dir.pin order by dir.pin) filter (where dir.pin is not null) as pins
      from h left join dir on dir.dk = h.dk and dir.sk = h.sk
     group by h.district, h.state, h.dk, h.sk
  )
  select
    jsonb_agg(jsonb_build_object(
      'district', d.district, 'state', d.state, 'census_population', d.census,
      'pincode_count', coalesce(cardinality(d.pins), 0),
      'live', exists (select 1 from service_areas sa where sa.is_active and sa.pin_code = any(d.pins)),
      'pincodes', case when (select count(*) from h) <= 12 then (
         select jsonb_agg(jsonb_build_object('pin', p,
                  'area', (select sa.area_name from service_areas sa where sa.pin_code = p limit 1),
                  'live', exists (select 1 from service_areas sa where sa.pin_code = p and sa.is_active)) order by p)
           from unnest(d.pins) p) end
    ) order by d.census desc nulls last, d.district),
    sum(d.census), count(*) filter (where d.census is null),
    (select array_agg(p) from d d2, unnest(d2.pins) p)
  into v_districts, v_census_total, v_census_missing, v_all_pins
  from d;

  select count(*) into v_patients from patients pa where pa.pin_code = any(v_all_pins);
  select count(*) into v_businesses from businesses b
   where b.status = 'active' and (b.own_pin_code = any(v_all_pins) or b.pin_codes && v_all_pins);

  return jsonb_build_object(
    'found', true,
    'kind', case when v_kind = 'state' then 'state' when jsonb_array_length(v_districts) > 1 then 'city' else 'district' end,
    'label', case
      when v_kind = 'state' then v_hits->0->>'state'
      when jsonb_array_length(v_districts) = 1 then v_districts->0->>'district'
      else initcap(v_raw) end,
    'state', v_hits->0->>'state',
    'pin_code', v_pin,
    'area', v_area,
    'districts', v_districts,
    'district_count', jsonb_array_length(v_districts),
    'pincode_count', coalesce(cardinality(v_all_pins), 0),
    'census_population', v_census_total,
    -- Districts formed after 2011 have no census figure: the total is then partial.
    'census_partial', v_census_missing > 0 and v_census_total is not null,
    'live', exists (select 1 from service_areas sa where sa.is_active and sa.pin_code = any(v_all_pins)),
    'patients', case when v_patients >= 25 then v_patients end,
    'businesses', case when v_businesses >= 5 then v_businesses end
  );
end $$;

revoke all on function sehat_area_search(text, text) from public;
grant execute on function sehat_area_search(text, text) to anon, authenticated;

-- The national line the card shows before anyone searches.
create or replace function sehat_area_totals()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pincodes', (select count(*) from pincode_directory),
    'districts', (select count(distinct (district, state)) from pincode_directory),
    'live_districts', (select coalesce(jsonb_agg(distinct sa.district), '[]'::jsonb) from service_areas sa where sa.is_active)
  );
$$;
revoke all on function sehat_area_totals() from public;
grant execute on function sehat_area_totals() to anon, authenticated;

-- ============================================================================
-- Area interest — which places visitors search, for the admin Leads panel
-- ============================================================================
-- Every search on the card is logged: what was typed, how (typed, "Use my
-- location", a quick city button, or an ?area= link), and the place it
-- resolved to. No IP, no coordinates, no person — a random per-tab session id
-- only, so one visitor searching five times counts once in "visitors". The
-- page skips logging when the browser sends Do Not Track, and the insert is
-- capped per session so the table cannot be flooded.

create table if not exists area_searches (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id text,
  query text not null,
  method text not null check (method in ('typed', 'location', 'chip', 'link')),
  found boolean not null,
  kind text,
  label text,
  district text,
  state text,
  live boolean
);
create index if not exists area_searches_created_idx on area_searches (created_at desc);

alter table area_searches enable row level security;
drop policy if exists "admin_reads_area_searches" on area_searches;
create policy "admin_reads_area_searches" on area_searches for select using (sehat_is_admin() or sehat_is_manager());
revoke all on area_searches from anon, authenticated;
grant select on area_searches to authenticated;

create or replace function sehat_log_area_search(
  p_session text, p_query text, p_method text, p_found boolean,
  p_kind text default null, p_label text default null, p_district text default null,
  p_state text default null, p_live boolean default null
) returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_method not in ('typed', 'location', 'chip', 'link') or btrim(coalesce(p_query, '')) = '' then return; end if;
  -- 40 searches an hour per tab is far more than a person does.
  if p_session is not null and (select count(*) from area_searches
       where session_id = left(p_session, 64) and created_at > now() - interval '1 hour') >= 40 then return; end if;
  insert into area_searches (session_id, query, method, found, kind, label, district, state, live)
  values (left(p_session, 64), left(btrim(p_query), 60), p_method, coalesce(p_found, false),
          left(p_kind, 12), left(p_label, 80), left(p_district, 80), left(p_state, 60), p_live);
end $$;
revoke all on function sehat_log_area_search(text, text, text, boolean, text, text, text, text, boolean) from public;
grant execute on function sehat_log_area_search(text, text, text, boolean, text, text, text, text, boolean) to anon, authenticated;

-- The Leads panel's table: places by searches in the last p_days, with how
-- they were searched. Unfound searches are grouped by what was typed, so a
-- place we cannot resolve yet (a missing alias) shows up too.
create or replace function sehat_admin_area_interest(p_days integer default 30)
returns table (label text, state text, kind text, live boolean, found boolean, searches bigint, visitors bigint,
               typed bigint, by_location bigint, chip bigint, link bigint, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_is_manager()) then raise exception 'Admins and managers only.' using errcode = '42501'; end if;
  return query
    select coalesce(a.label, initcap(lower(a.query))) as label, a.state, max(a.kind), bool_or(coalesce(a.live, false)), a.found,
           count(*), count(distinct a.session_id),
           count(*) filter (where a.method = 'typed'), count(*) filter (where a.method = 'location'),
           count(*) filter (where a.method = 'chip'), count(*) filter (where a.method = 'link'),
           max(a.created_at)
      from area_searches a
     where a.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
     group by coalesce(a.label, initcap(lower(a.query))), a.state, a.found
     order by count(distinct a.session_id) desc, count(*) desc
     limit 200;
end $$;
revoke all on function sehat_admin_area_interest(integer) from public, anon;
grant execute on function sehat_admin_area_interest(integer) to authenticated;

notify pgrst, 'reload schema';
