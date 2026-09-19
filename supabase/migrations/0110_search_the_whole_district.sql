-- ============================================================================
-- Sehatsandhi — a search covers the patient's whole district
--
-- Run AFTER 0109. Safe to re-run. Then load the directory:
--   node scripts/load-pincode-directory.mjs --env sandbox   (and --env prod)
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Every search matched the patient's pincode EXACTLY against a listing's
-- coverage (`pin_codes @> array[pin]`): the bot in bot_bookable and camps, the
-- website in SpecialityLanding. A patient one pincode over from a clinic was
-- told nobody exists. In a district of twenty pincodes, most searches found
-- nothing although the district had doctors — the worst first impression a
-- directory can give.
--
-- Now a search returns what serves the patient's district: listings covering
-- ANY of its pincodes, or located in it. Those covering the patient's own
-- pincode still come first, and the rest say which town they are in.
--
-- ── WHERE THE DISTRICT COMES FROM ───────────────────────────────────────────
-- pincode_directory: India Post's All India Pincode Directory (data.gov.in,
-- Government Open Data License – India), one row per pincode. A pincode that
-- spans districts is filed under the one with most of its post offices. Loaded
-- from supabase/reference/pincode_directory.csv by the script above, so both
-- environments get the same rows and no deploy fetches anything.
--
-- 0094 chose NOT to put all of India into service_areas, and this keeps that:
-- service_areas stays the curated, priced list. It is still read here, because
-- ten of its twenty Yamuna Nagar pincodes are not in the India Post file — a
-- district is the union of both, matched on district AND state (Bilaspur is in
-- two states), ignoring case, spaces and punctuation ("Yamuna Nagar" is
-- "YAMUNANAGAR").
--
-- A pincode in neither falls back to itself, which is exactly the old
-- behaviour — nothing gets worse where we know less.
-- ============================================================================


-- ============================================================================
-- 1. The directory
-- ============================================================================

create table if not exists pincode_directory (
  pin_code text primary key check (pin_code ~ '^[1-9][0-9]{5}$'),
  district text not null,
  state    text not null
);

comment on table pincode_directory is
  'India Post pincode → district and state, one row per pincode. Public '
  'reference data, loaded by scripts/load-pincode-directory.mjs. Not the '
  'priced service area list — that is service_areas.';

create or replace function sehat_area_key(p_name text)
returns text language sql immutable as $$
  select nullif(regexp_replace(lower(coalesce(p_name, '')), '[^a-z]', '', 'g'), '');
$$;

comment on function sehat_area_key is
  'A place name reduced for matching: lowercase letters only. "Yamuna Nagar", '
  '"YAMUNANAGAR" and "Yamunanagar" all become yamunanagar.';

create index if not exists pincode_directory_area_idx
  on pincode_directory (sehat_area_key(state), sehat_area_key(district));

alter table pincode_directory enable row level security;
drop policy if exists "anyone_reads_pincode_directory" on pincode_directory;
create policy "anyone_reads_pincode_directory" on pincode_directory
  for select using (true);


-- ============================================================================
-- 2. A pincode's district, and every pincode in it
-- ============================================================================

create or replace function sehat_pin_district(p_pin_code text)
returns table (district_key text, state_key text)
language sql stable security definer set search_path = public as $$
  select k.district_key, k.state_key from (
    select sehat_area_key(d.district) as district_key, sehat_area_key(d.state) as state_key, 1 as pref
      from pincode_directory d where d.pin_code = p_pin_code
    union all
    select sehat_area_key(a.district), sehat_area_key(a.state), 2
      from service_areas a where a.pin_code = p_pin_code
  ) k
  where k.district_key is not null and k.state_key is not null
  order by k.pref
  limit 1;
$$;

create or replace function sehat_district_pin_codes(p_pin_code text)
returns text[] language sql stable security definer set search_path = public as $$
  with k as (select * from sehat_pin_district(p_pin_code))
  select array(
    select p_pin_code where p_pin_code is not null
    union
    select d.pin_code from pincode_directory d, k
     where sehat_area_key(d.district) = k.district_key and sehat_area_key(d.state) = k.state_key
    union
    select a.pin_code from service_areas a, k
     where sehat_area_key(a.district) = k.district_key and sehat_area_key(a.state) = k.state_key
  );
$$;

comment on function sehat_district_pin_codes is
  'Every pincode in the given pincode''s district (India Post plus '
  'service_areas), always including the pincode itself. Just the pincode when '
  'its district is unknown.';

-- Whether a business serves a pincode's district, and how closely:
--   0  covers or sits in the pincode itself
--   1  covers some other pincode of the district, or is located in it
--   null  neither
create or replace function sehat_serves_rank(
  p_pin_codes text[], p_own_pin text, p_own_district text, p_own_state text,
  p_pin_code text, p_district_pins text[], p_district_key text, p_state_key text
) returns integer language sql immutable as $$
  select case
    when p_pin_codes @> array[p_pin_code] or p_own_pin = p_pin_code then 0
    when p_pin_codes && p_district_pins
      or p_own_pin = any(p_district_pins)
      or (p_district_key is not null
          and sehat_area_key(p_own_district) = p_district_key
          and sehat_area_key(p_own_state) = p_state_key) then 1
  end;
$$;


-- ============================================================================
-- 3. The bot: bot_bookable searches the district
--
-- Dropped and recreated because it gains a column: `area`, the town of a
-- result that is not in the patient's own pincode, for the list to show.
-- Everything reading it names its columns, so the extra one is harmless.
-- Ranking: own pincode first, then as before — top-rated, rating, newest — so
-- the number a patient taps still means one row in the search and the pick.
-- ============================================================================

drop function if exists bot_bookable(text, text, text);

create function bot_bookable(p_kind text, p_filter text, p_pincode text)
returns table (
  rn integer, business_id uuid, practitioner_id uuid,
  title text, subtitle text, phone text, address text,
  consultation_fee integer, avg_rating numeric, total_reviews bigint,
  area text
)
language sql stable security definer set search_path = public as $$
  with k as (
    select sehat_district_pin_codes(p_pincode) as pins, d.district_key, d.state_key
      from (select 1) one
      left join sehat_pin_district(p_pincode) d on true
  ),
  ranked as (
    select v.business_id, v.practitioner_id,
           v.full_name as title, v.business_name as subtitle,
           b.phone, b.address, v.consultation_fee,
           r.avg_rating, r.total_reviews, r.is_top_rated, b.created_at,
           sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                             p_pincode, k.pins, k.district_key, k.state_key) as near,
           b.own_city
      from public_practitioner_businesses v
      join businesses b on b.id = v.business_id
      left join rating_aggregate r on r.business_id = v.business_id
      cross join k
     where p_kind = 'doctor'
       and v.speciality = p_filter
    union all
    select b.id, null::uuid,
           b.name, null::text,
           b.phone, b.address, 0,
           r.avg_rating, r.total_reviews, r.is_top_rated, b.created_at,
           sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                             p_pincode, k.pins, k.district_key, k.state_key),
           b.own_city
      from businesses b
      left join rating_aggregate r on r.business_id = b.id
      cross join k
     where p_kind <> 'doctor'
       and b.vertical = p_filter
       and b.status = 'active'
  )
  select row_number() over (
           order by ranked.near,
                    coalesce(ranked.is_top_rated, false) desc,
                    ranked.avg_rating desc nulls last,
                    ranked.created_at desc nulls last,
                    ranked.business_id,
                    ranked.practitioner_id
         )::integer,
         ranked.business_id, ranked.practitioner_id,
         ranked.title, ranked.subtitle, ranked.phone, ranked.address,
         ranked.consultation_fee, ranked.avg_rating, ranked.total_reviews,
         case when ranked.near = 1 then nullif(btrim(ranked.own_city), '') end
    from ranked
   where ranked.near is not null
   order by 1
   limit 8;
$$;

comment on function bot_bookable is
  'One ranked page of results for the bot: doctors of a speciality, or '
  'businesses of a vertical, serving the pincode''s district — its own pincode '
  'first. Shared by the search and the selection resolver, so the number the '
  'patient taps means the same row in both. `area` is the town of a result '
  'outside the patient''s own pincode.';

-- The doctor and lab list says where a result outside the patient's pincode
-- is. The read-out lines (pharmacy, lab call-back, insurance) print the
-- address, which already names the town.
create or replace function bot_search_bookable(p_kind text, p_filter text, p_pincode text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin  text := bot_pincode(p_pincode);
  v_code text := case when p_kind = 'doctor'
                      then bot_speciality_code(p_filter)
                      else bot_vertical_code(coalesce(nullif(btrim(p_filter), ''), p_kind)) end;
  v_out  text;
begin
  if v_code is not null and v_pin is not null then
    select string_agg(l.line, E'\n\n' order by l.rn) into v_out
      from (
        select b.rn,
               b.rn || '. ' || b.title
            || case when coalesce(b.subtitle, '') not in ('', b.title)
                    then ' — ' || b.subtitle else '' end
            || case when b.avg_rating is not null
                    then ' (' || b.avg_rating || '★, ' || b.total_reviews || ' समीक्षाएँ)'
                    else ' (नया)' end
            || case when b.area is not null then E'\n   📍 ' || b.area else '' end
            || case when coalesce(b.consultation_fee, 0) > 0
                    then E'\n   फ़ीस ₹' || b.consultation_fee else '' end
            || E'\n   ' || bot_profile_url(b.business_id, coalesce(b.subtitle, b.title)) as line
          from bot_bookable(p_kind, v_code, v_pin) b
      ) l;
  end if;

  if v_out is null then
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification)
    values ('bot',
            coalesce(v_pin, nullif(left(btrim(coalesce(p_pincode, '')), 20), '')),
            coalesce(v_code, nullif(left(btrim(coalesce(p_filter, '')), 40), '')),
            false);
  end if;

  return v_out;
end $$;

create or replace function bot_ambulance(p_pincode text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin text := bot_pincode(p_pincode);
  v_out text;
begin
  if v_pin is not null then
    select string_agg(t.line, E'\n' order by t.rn) into v_out
      from (
        select b.rn, '🚑 ' || b.title
            || case when b.area is not null then ' (' || b.area || ')' else '' end
            || case when coalesce(b.phone, '') <> '' then ' — ☎ ' || b.phone else '' end as line
          from bot_bookable('business', 'ambulance', v_pin) b
         where b.rn <= 3
      ) t;
  end if;

  if v_out is null then
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification)
    values ('bot', coalesce(v_pin, nullif(left(btrim(coalesce(p_pincode, '')), 20), '')),
            'ambulance', false);
    return 'इस पिनकोड में हमारा कोई एम्बुलेंस पार्टनर नहीं है। '
        || 'कृपया तुरंत 108 पर कॉल करें — यह मुफ़्त सरकारी एम्बुलेंस सेवा है।';
  end if;

  return 'अभी कॉल करें:' || E'\n' || v_out
      || E'\n\nकोई जवाब न मिले तो 108 पर कॉल करें (मुफ़्त सरकारी एम्बुलेंस)।';
end $$;

-- Camps: any approved camp in the district, not only the exact pincode.
create or replace function bot_camps_offers(p_pincode text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_pin  text := bot_pincode(p_pincode);
  v_pins text[];
  v_out  text;
begin
  if v_pin is not null then
    v_pins := sehat_district_pin_codes(v_pin);
    select string_agg(t.line, E'\n\n' order by t.near, t.date_from) into v_out
      from (
        select c.date_from,
               case when c.pin_codes @> array[v_pin] then 0 else 1 end as near,
               case when c.camp_type = 'free_camp' then '🏥 निःशुल्क कैंप — ' else '🎁 ऑफर — ' end
            || c.title
            || case when coalesce(b.name, '') <> '' then E'\n   ' || b.name else '' end
            || case when not c.pin_codes @> array[v_pin] and nullif(btrim(b.own_city), '') is not null
                    then E'\n   📍 ' || btrim(b.own_city) else '' end
            || E'\n   ' || bot_hi_date(c.date_from)
            || case when c.date_to > c.date_from then ' से ' || bot_hi_date(c.date_to) || ' तक' else '' end
            || case when coalesce(c.time_slot, '') <> '' then ', ' || c.time_slot else '' end
            || case when coalesce(c.services_offered, '') <> ''
                    then E'\n   ' || left(c.services_offered, 120) else '' end as line
          from camps_offers c
          left join businesses b on b.id = c.business_id
         where c.status = 'approved'
           and c.date_to >= (now() at time zone 'Asia/Kolkata')::date
           and c.pin_codes && v_pins
         order by case when c.pin_codes @> array[v_pin] then 0 else 1 end, c.date_from
         limit 5
      ) t;
  end if;

  if v_out is null then
    return 'अभी आपके इलाके में कोई कैंप या ऑफर नहीं है। '
        || 'नया कैंप लगते ही हम आपको WhatsApp पर बता देंगे — '
        || 'तब तक डॉक्टर, दवाई या जांच के लिए मेन्यू में वापस जाएँ।';
  end if;

  return 'आपके क्षेत्र में ये कैंप और ऑफर चल रहे हैं:' || E'\n\n' || v_out;
end $$;


-- ============================================================================
-- 4. The website: one doctor search, the same district rule
--
-- SpecialityLanding filtered the public view with `.contains('pin_codes',
-- [pin])` in the browser. It calls this instead, so the site and the bot
-- cannot disagree about who serves an area. Returns the view's own columns —
-- already public — plus `nearby` (true when outside the pincode itself) and
-- the town of such a result.
-- ============================================================================

create or replace function sehat_find_doctors(p_speciality text, p_pin_code text)
returns table (
  practitioner_id uuid, full_name text, speciality text, qualification text,
  business_id uuid, business_name text, address text,
  consultation_fee integer, is_primary boolean,
  nearby boolean, area text
)
language sql stable security definer set search_path = public as $$
  with k as (
    select sehat_district_pin_codes(p_pin_code) as pins, d.district_key, d.state_key
      from (select 1) one
      left join sehat_pin_district(p_pin_code) d on true
  ),
  hits as (
    select v.*, b.own_city,
           sehat_serves_rank(b.pin_codes, b.own_pin_code, b.own_district, b.own_state,
                             p_pin_code, k.pins, k.district_key, k.state_key) as near
      from public_practitioner_businesses v
      join businesses b on b.id = v.business_id
      cross join k
     where v.speciality = p_speciality
  )
  select h.practitioner_id, h.full_name, h.speciality, h.qualification,
         h.business_id, h.business_name, h.address,
         h.consultation_fee, h.is_primary,
         h.near = 1,
         case when h.near = 1 then nullif(btrim(h.own_city), '') end
    from hits h
   where h.near is not null
   order by h.near, h.full_name;
$$;

comment on function sehat_find_doctors is
  'Doctors of a speciality serving a pincode''s district, the pincode itself '
  'first. The website''s speciality search; the bot applies the same rule in '
  'bot_bookable.';


-- ============================================================================
-- Grants, per 0088: revoke both, grant what is called from outside.
-- ============================================================================

revoke all on function sehat_area_key(text)                 from public, anon, authenticated;
grant execute on function sehat_area_key(text)              to anon, authenticated;
revoke all on function sehat_pin_district(text)             from public, anon, authenticated;
grant execute on function sehat_pin_district(text)          to anon, authenticated;
revoke all on function sehat_district_pin_codes(text)       from public, anon, authenticated;
grant execute on function sehat_district_pin_codes(text)    to anon, authenticated;
revoke all on function sehat_serves_rank(text[], text, text, text, text, text[], text, text)
  from public, anon, authenticated;
revoke all on function sehat_find_doctors(text, text)       from public, anon, authenticated;
grant execute on function sehat_find_doctors(text, text)    to anon, authenticated;
revoke all on function bot_bookable(text, text, text)       from public, anon, authenticated;
grant execute on function bot_bookable(text, text, text)    to anon, authenticated;
grant select on pincode_directory to anon, authenticated;
