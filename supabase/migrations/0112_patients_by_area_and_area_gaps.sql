-- ============================================================================
-- Sehatsandhi — patients by area, for a business; area gaps, for the admin
--
-- Run AFTER 0111. Safe to re-run.
--
-- 0111 started recording where patients come from. These are the two reports
-- that read it.
--
-- ── sehat_business_patient_areas: "where do my patients come from?" ─────────
-- One row per pincode that matters to this business: every pincode of its own
-- district, every pincode it covers, and every pincode a patient of its came
-- from (however far). Per pincode, over the chosen period:
--
--   patients  people this business saw or booked, by where they live
--   bookings  appointments made, by the pincode they were booked from
--   searches  searches for what THIS business offers — its doctors'
--             specialities, or its own vertical — on the website or the bot
--   unmet     of those, searches that found nobody
--
-- The gap a business acts on is "searches here, few of my patients from here".
-- Search counts are anonymous platform demand for the business's own
-- specialities only; nothing about another business is exposed. Patients with
-- no known pincode are one row with pin_code null.
--
-- ── sehat_admin_area_gaps: "where do we market?" ────────────────────────────
-- Per pincode or per district: population, businesses (located there, and
-- covering it, by vertical), doctors, patients, bookings, searches and unmet
-- searches, and a `gap` label. Filterable by state, district, speciality and
-- vertical, with free-text search. With a district or state filter every
-- pincode in it is listed, including the silent ones — a pincode with nothing
-- at all is the gap, and it would otherwise never appear.
--
-- `covering` counts are inflated by design: registration gives a business
-- every service area of the plan (0094 explains), so `located` is the number
-- that says where supply really is.
-- ============================================================================


-- ============================================================================
-- 1. Business: patients by area
-- ============================================================================

create or replace function sehat_business_patient_areas(p_business_id uuid, p_days integer default 30)
returns table (
  pin_code text, area_name text, district text, state text, population integer,
  in_district boolean, covered boolean,
  patients integer, bookings integer, searches integer, unmet integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_from  timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_biz   businesses%rowtype;
  v_home  text;
  v_specs text[];
  v_codes text[];
begin
  if not (sehat_caller_may_prescribe(p_business_id) or sehat_is_admin()) then
    raise exception 'you are not authorised to read this listing''s reports'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_biz from businesses b where b.id = p_business_id;
  if not found then return; end if;

  -- Where the business itself is: its own pincode, else its primary branch,
  -- else the first area it covers.
  v_home := coalesce(
    v_biz.own_pin_code,
    (select l.pin_code from practice_locations l
      where l.business_id = p_business_id order by l.is_primary desc nulls last limit 1),
    v_biz.pin_codes[1]);

  select coalesce(array_agg(distinct p.speciality) filter (where p.speciality is not null), '{}')
    into v_specs
    from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
   where bp.business_id = p_business_id and bp.status = 'active' and bp.role = 'doctor';

  -- What demand for this business is logged as: its specialities, plus its
  -- vertical for the businesses the bot searches by type.
  v_codes := v_specs || array[v_biz.vertical];

  return query
  with district_pins as (
    select unnest(sehat_district_pin_codes(v_home)) as pin where v_home is not null
  ),
  people as (
    -- Everyone this business saw or booked in the period, and where they live:
    -- the patient's own pincode, else the pincode of their latest booking here.
    select m.id as member,
           coalesce(pt.pin_code,
                    (select a2.patient_pin_code from appointments a2
                      where a2.patient_member_id = m.id and a2.business_id = p_business_id
                        and a2.patient_pin_code is not null
                      order by a2.created_at desc limit 1)) as pin
      from business_patients bp
      join patient_members m on m.id = bp.patient_member_id
      join patients pt on pt.id = m.patient_id
     where bp.business_id = p_business_id
       and (greatest(bp.first_seen_at, bp.last_seen_at) >= v_from
            or exists (select 1 from appointments a
                        where a.patient_member_id = m.id and a.business_id = p_business_id
                          and a.created_at >= v_from))
  ),
  booked as (
    select case when coalesce(a.patient_pin_code, pt.pin_code) ~ '^[1-9][0-9]{5}$'
                then coalesce(a.patient_pin_code, pt.pin_code) end as pin
      from appointments a
      left join patient_members m on m.id = a.patient_member_id
      left join patients pt on pt.id = m.patient_id
     where a.business_id = p_business_id
       and a.created_at >= v_from
       and a.status <> 'cancelled'
  ),
  searched as (
    select e.pin_code as pin from site_events e
     where e.event_type = 'search' and e.created_at >= v_from
       and e.speciality = any(v_specs) and e.pin_code ~ '^[1-9][0-9]{5}$'
    union all
    select s.pin_code from bot_search_log s
     where s.created_at >= v_from and s.pin_code ~ '^[1-9][0-9]{5}$'
       and ((s.branch = 'doctor' and s.speciality = any(v_specs))
            or (v_biz.vertical = 'lab' and s.branch in ('lab_booking', 'lab_callback'))
            or (v_biz.vertical in ('pharmacy', 'ambulance') and s.branch = v_biz.vertical))
    union all
    select l.pincode from insurance_leads l
     where v_biz.vertical = 'insurance' and l.created_at >= v_from and l.pincode ~ '^[1-9][0-9]{5}$'
  ),
  missed as (
    select u.pin_code as pin from unmet_demand_log u
     where u.created_at >= v_from and u.speciality = any(v_codes)
       -- The bot used to log what the patient typed when it was not a pincode.
       and u.pin_code ~ '^[1-9][0-9]{5}$'
  ),
  pins as (
    select pin from district_pins
    union select unnest(v_biz.pin_codes)
    union select pin from people
    union select pin from booked
    union select pin from searched
    union select pin from missed
  )
  select p.pin,
         sa.area_name,
         coalesce(d.district, sa.district),
         coalesce(d.state, sa.state),
         sa.population,
         p.pin in (select pin from district_pins),
         p.pin = any(v_biz.pin_codes),
         (select count(distinct x.member) from people x where x.pin is not distinct from p.pin)::integer,
         (select count(*) from booked x where x.pin is not distinct from p.pin)::integer,
         (select count(*) from searched x where x.pin is not distinct from p.pin)::integer,
         (select count(*) from missed x where x.pin is not distinct from p.pin)::integer
    from pins p
    left join pincode_directory d on d.pin_code = p.pin
    left join service_areas sa on sa.pin_code = p.pin
   order by (p.pin is null), 8 desc, 10 desc, p.pin;
end $$;

comment on function sehat_business_patient_areas is
  'Where a business''s patients come from, per pincode, beside anonymous '
  'search demand for its own specialities there. Its district, its coverage '
  'and any pincode a patient came from; pin_code null is "unknown".';

revoke all on function sehat_business_patient_areas(uuid, integer) from public, anon;
grant execute on function sehat_business_patient_areas(uuid, integer) to authenticated;


-- ============================================================================
-- 2. Admin: area gaps
-- ============================================================================

create or replace function sehat_admin_area_gaps(
  p_days       integer default 30,
  p_scope      text    default 'pincode',   -- 'pincode' | 'district'
  p_state      text    default null,
  p_district   text    default null,
  p_speciality text    default null,        -- GEN, CARD … narrows doctors and searches
  p_vertical   text    default null,        -- clinic, lab … narrows businesses and searches
  p_query      text    default null         -- pincode prefix, area, district or state
)
returns table (
  pin_code text, area_name text, district text, state text,
  pincodes integer, population bigint,
  businesses integer, located integer,
  clinics integer, hospitals integer, labs integer, pharmacies integer, ambulances integer, insurance integer,
  doctors integer, patients integer, bookings integer, searches integer, unmet integer,
  gap text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_from     timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_district boolean := lower(coalesce(p_scope, 'pincode')) = 'district';
  v_skey     text := sehat_area_key(p_state);
  v_dkey     text := sehat_area_key(p_district);
  v_spec     text := nullif(upper(btrim(coalesce(p_speciality, ''))), '');
  v_vert     text := nullif(lower(btrim(coalesce(p_vertical, ''))), '');
  v_q        text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not sehat_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  with geo as (
    -- Every pincode we can place: India Post first, service_areas for the rest.
    select g.pin_code as pin, g.district, g.state from pincode_directory g
    union all
    -- Spelled as India Post spells the district where the two agree ignoring
    -- spaces and case, so "Yamuna Nagar" and "Yamunanagar" are one row.
    select a.pin_code,
           coalesce(c.district, a.district),
           coalesce(c.state, a.state)
      from service_areas a
      left join lateral (
        select g2.district, g2.state from pincode_directory g2
         where sehat_area_key(g2.district) = sehat_area_key(a.district)
           and sehat_area_key(g2.state) = sehat_area_key(a.state)
         limit 1) c on true
     where not exists (select 1 from pincode_directory g where g.pin_code = a.pin_code)
  ),
  long as (
    -- One row per (pincode, fact). Counted with count(distinct id) per metric,
    -- so a business covering five pincodes of a district is one business there.
    select unnest(b.pin_codes) as pin, 'cov'::text as m, b.id::text as id, b.vertical as v
      from businesses b
     where b.status = 'active' and (v_vert is null or b.vertical = v_vert)
    union all
    select coalesce(b.own_pin_code,
                    (select l.pin_code from practice_locations l
                      where l.business_id = b.id order by l.is_primary desc nulls last limit 1)),
           'loc', b.id::text, b.vertical
      from businesses b
     where b.status = 'active' and (v_vert is null or b.vertical = v_vert)
    union all
    select unnest(v.pin_codes), 'doc', v.practitioner_id::text, null
      from public_practitioner_businesses v
     where (v_spec is null or v.speciality = v_spec)
       and (v_vert is null or v.vertical = v_vert)
    union all
    select pt.pin_code, 'pat', pt.id::text, null
      from patients pt
     where pt.pin_code is not null
       and exists (select 1 from patient_members m
                     join business_patients bp on bp.patient_member_id = m.id
                    where m.patient_id = pt.id)
    union all
    select coalesce(a.patient_pin_code, pt.pin_code), 'book', a.id::text, null
      from appointments a
      left join patient_members m on m.id = a.patient_member_id
      left join patients pt on pt.id = m.patient_id
      left join businesses b on b.id = a.business_id
     where a.created_at >= v_from and a.status <> 'cancelled'
       and (v_vert is null or b.vertical = v_vert)
    union all
    select e.pin_code, 'srch', 'w' || e.id, null
      from site_events e
     where e.event_type = 'search' and e.created_at >= v_from
       and (v_spec is null or e.speciality = v_spec)
       and (v_vert is null or v_vert in ('clinic', 'hospital'))
    union all
    select s.pin_code, 'srch', 'b' || s.id, null
      from bot_search_log s
     where s.created_at >= v_from
       and (v_spec is null or s.speciality = v_spec)
       and (v_vert is null
            or (v_vert in ('clinic', 'hospital') and s.branch = 'doctor')
            or (v_vert = 'lab' and s.branch in ('lab_booking', 'lab_callback'))
            or s.branch = v_vert)
    union all
    select u.pin_code, 'miss', u.id::text, null
      from unmet_demand_log u
     where u.created_at >= v_from
       and (v_spec is null or u.speciality = v_spec)
       and (v_vert is null or u.speciality = v_vert
            or (v_vert in ('clinic', 'hospital') and u.speciality not in ('lab', 'pharmacy', 'ambulance', 'insurance')))
    union all
    -- The silent pincodes: with a place filter, all of them; otherwise the
    -- curated service areas, so a priced area with no activity still shows.
    select g.pin, 'u', null, null from geo g
     where (v_skey is not null or v_dkey is not null)
       and (v_skey is null or sehat_area_key(g.state) = v_skey)
       and (v_dkey is null or sehat_area_key(g.district) = v_dkey)
    union all
    select a.pin_code, 'u', null, null from service_areas a
     where v_skey is null and v_dkey is null
  ),
  placed as (
    select l.*, g.district, g.state, sa.area_name, sa.population
      from long l
      left join geo g on g.pin = l.pin
      left join service_areas sa on sa.pin_code = l.pin
     where l.pin ~ '^[1-9][0-9]{5}$'
       and (v_skey is null or sehat_area_key(g.state) = v_skey)
       and (v_dkey is null or sehat_area_key(g.district) = v_dkey)
  ),
  keyed as (
    select case when v_district then null else p.pin end as k_pin,
           coalesce(p.district, 'Unmapped') as k_district,
           coalesce(p.state, 'Unmapped') as k_state,
           p.*
      from placed p
  ),
  agg as (
    select k.k_pin, k.k_district, k.k_state,
           max(k.area_name) as area_name,
           count(distinct k.pin)::integer as pincodes,
           (select sum(sa.population) from service_areas sa
             where sa.pin_code = any(array_agg(distinct k.pin)))::bigint as population,
           count(distinct k.id) filter (where k.m in ('cov', 'loc'))::integer as businesses,
           count(distinct k.id) filter (where k.m = 'loc')::integer as located,
           count(distinct k.id) filter (where k.m in ('cov', 'loc') and k.v = 'clinic')::integer as clinics,
           count(distinct k.id) filter (where k.m in ('cov', 'loc') and k.v = 'hospital')::integer as hospitals,
           count(distinct k.id) filter (where k.m in ('cov', 'loc') and k.v = 'lab')::integer as labs,
           count(distinct k.id) filter (where k.m in ('cov', 'loc') and k.v = 'pharmacy')::integer as pharmacies,
           count(distinct k.id) filter (where k.m in ('cov', 'loc') and k.v = 'ambulance')::integer as ambulances,
           count(distinct k.id) filter (where k.m in ('cov', 'loc') and k.v = 'insurance')::integer as insurance,
           count(distinct k.id) filter (where k.m = 'doc')::integer as doctors,
           count(distinct k.id) filter (where k.m = 'pat')::integer as patients,
           count(distinct k.id) filter (where k.m = 'book')::integer as bookings,
           count(distinct k.id) filter (where k.m = 'srch')::integer as searches,
           count(distinct k.id) filter (where k.m = 'miss')::integer as unmet
      from keyed k
     group by k.k_pin, k.k_district, k.k_state
  )
  select a.k_pin, a.area_name, a.k_district, a.k_state,
         a.pincodes, a.population,
         a.businesses, a.located,
         a.clinics, a.hospitals, a.labs, a.pharmacies, a.ambulances, a.insurance,
         a.doctors, a.patients, a.bookings, a.searches, a.unmet,
         case
           when a.businesses = 0 and (a.searches > 0 or a.unmet > 0) then 'Demand, no businesses'
           when v_spec is not null and a.doctors = 0 and a.searches > 0 then 'Searched, no such doctor'
           when a.unmet > 0                                        then 'Searches finding nobody'
           when a.businesses = 0                                   then 'No businesses'
           when a.located = 0                                      then 'No business located here'
           when a.patients = 0                                     then 'Businesses, no patients yet'
         end
    from agg a
   where v_q is null
      or a.k_pin like v_q || '%'
      or a.area_name ilike '%' || v_q || '%'
      or a.k_district ilike '%' || v_q || '%'
      or a.k_state ilike '%' || v_q || '%'
   order by (a.businesses = 0 and (a.searches > 0 or a.unmet > 0)) desc,
            a.unmet desc, a.searches desc, a.population desc nulls last,
            a.k_state, a.k_district, a.k_pin
   limit 2000;
end $$;

comment on function sehat_admin_area_gaps is
  'Where to market: per pincode or district, supply (businesses by vertical, '
  'doctors), patients, bookings and search demand, with a gap label. Admin only.';

revoke all on function sehat_admin_area_gaps(integer, text, text, text, text, text, text) from public, anon;
grant execute on function sehat_admin_area_gaps(integer, text, text, text, text, text, text) to authenticated;
