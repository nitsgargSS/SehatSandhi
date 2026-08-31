-- ============================================================================
-- Sehatsandhi — a business is where it actually is, anywhere in India
--
-- Run AFTER 0093. Safe to re-run.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- Every business on the platform is recorded as being in Yamuna Nagar, and none
-- of them was ever asked. Two things combined:
--
--   1. The wizard auto-fills `pin_codes` with every row of service_areas —
--      correct, because the live plan sells every area for one price.
--   2. sehat_create_primary_location() then sets the branch's pin_code to
--      `new.pin_codes[1]`, the FIRST of those.
--
-- So a clinic in Pune registers, is given twenty Yamuna Nagar coverage
-- pincodes, and its own branch is filed at whichever of them sorted first. The
-- area report added in 0093 was not wrong about the data; the data was wrong.
--
-- ── WHY service_areas IS NOT THE FIX ────────────────────────────────────────
-- The instinct is to load all ~19,000 Indian pincodes into service_areas. That
-- is a different thing and is not needed here. service_areas is the CURATED
-- list: population, tier and price per area, the basis of per-pincode pricing.
-- Being in it means "we priced this area", not "a business may exist here".
--
-- Nothing ever constrained a business to it — there is no foreign key, checked
-- before writing this — so the database has always accepted any pincode. What
-- was missing was anybody asking for one.
--
-- ── WHERE THE ANSWER COMES FROM ─────────────────────────────────────────────
-- Google Places already returns it. placesLookup pulls addressComponents and
-- reads postal_code out of them, and the wizard then discarded it along with
-- the locality and the two administrative levels. So the city, district and
-- state are free for any business that picks itself from the search, and typed
-- by hand for one that does not. No dataset, no import, no third-party lookup.
--
-- ── COVERAGE IS UNCHANGED ───────────────────────────────────────────────────
-- `pin_codes` still means "every area this listing is sold into", and the flat
-- plan still includes all of them — that is the product and this does not touch
-- it. What changes is that the branch's own address is now its own, recorded
-- separately, and no longer borrowed from the front of a coverage array.
-- ============================================================================


-- ============================================================================
-- 1. A location knows where it is
-- ============================================================================

alter table practice_locations add column if not exists city     text;
alter table practice_locations add column if not exists district text;
alter table practice_locations add column if not exists state    text;

comment on column practice_locations.pin_code is
  'The branch''s OWN pincode, asked for at registration. Not to be confused '
  'with businesses.pin_codes, which is every area the listing is sold into.';
comment on column practice_locations.district is
  'From Google Places (administrative_area_level_2) or typed. Falls back to '
  'service_areas when the pincode happens to be one we have priced.';

create index if not exists practice_locations_state_district_idx
  on practice_locations (state, district);


-- ============================================================================
-- 2. The trigger stops guessing
--
-- Uses the pincode the business actually gave. Falls back to the old behaviour
-- ONLY when none was supplied, so a caller that has not been updated yet keeps
-- working rather than creating a branch with no address at all.
-- ============================================================================

alter table businesses add column if not exists own_pin_code text;
alter table businesses add column if not exists own_city     text;
alter table businesses add column if not exists own_district text;
alter table businesses add column if not exists own_state    text;

comment on column businesses.own_pin_code is
  'Where the business IS. businesses.pin_codes is where it SELLS. Keeping the '
  'two apart is what 0094 fixed; do not conflate them again.';

create or replace function sehat_create_primary_location()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pin text;
begin
  -- What they told us, then the curated fallback. The old behaviour is kept as
  -- the last resort rather than deleted: an older client that sends no pincode
  -- must still produce a branch, and a wrong-but-present pincode is easier to
  -- correct later than a null nobody notices.
  v_pin := coalesce(
    nullif(btrim(coalesce(new.own_pin_code, '')), ''),
    case when array_length(new.pin_codes, 1) > 0 then new.pin_codes[1] end
  );

  insert into practice_locations
    (business_id, name, address, pin_code, city, district, state, phone, is_primary)
  values (
    new.id,
    coalesce(nullif(btrim(new.name), ''), 'Main branch'),
    new.address,
    v_pin,
    nullif(btrim(coalesce(new.own_city, '')), ''),
    -- District and state fall back to service_areas when the pincode is one we
    -- have priced, so an area we already know about never needs re-typing.
    coalesce(nullif(btrim(coalesce(new.own_district, '')), ''),
             (select a.district from service_areas a where a.pin_code = v_pin limit 1)),
    coalesce(nullif(btrim(coalesce(new.own_state, '')), ''),
             (select a.state from service_areas a where a.pin_code = v_pin limit 1)),
    new.phone,
    true
  );
  return new;
end $$;

comment on function sehat_create_primary_location is
  'Files the branch at the pincode the business gave, not at the front of its '
  'coverage array — see 0094. Falls back to pin_codes[1] only when no own '
  'pincode was supplied.';


-- ============================================================================
-- 3. Backfill what we can, and be honest about what we cannot
--
-- Existing rows have a Yamuna Nagar pincode that nobody chose. Where that
-- pincode IS a curated area, its district and state are correct and worth
-- filling in. Where a business supplied nothing, the pincode stays as it is:
-- it is not known to be wrong, only known to be unasked, and inventing a
-- correction would be worse than leaving a row that can be edited.
-- ============================================================================

update practice_locations l
   set district = coalesce(l.district, a.district),
       state    = coalesce(l.state,    a.state),
       city     = coalesce(l.city,     a.area_name)
  from service_areas a
 where a.pin_code = l.pin_code
   and (l.district is null or l.state is null or l.city is null);


-- ============================================================================
-- 4. Reports must not lose a business that is outside the curated areas
--
-- 0093's area report inner-joined service_areas, which was fine while every
-- business was (wrongly) in Yamuna Nagar and is wrong the moment one is not: a
-- clinic in Pune would simply not appear in a report about registrations.
--
-- Now the region comes from the LOCATION first and service_areas second, and a
-- business whose state is unknown is reported under 'Unmapped' rather than
-- dropped. A row you can see and fix beats a row that silently is not there.
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
  businesses        integer,
  active            integer,
  pending           integer,
  covering          integer,
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
  with based as (
    -- One row per business, at the place it says it is. Region resolved from
    -- the location, then from the curated areas, then named as unmapped.
    select distinct on (b.id)
           b.id, b.status,
           l.pin_code,
           coalesce(l.state,    a.state,    'Unmapped') as state,
           coalesce(l.district, a.district, 'Unmapped') as district,
           coalesce(l.city,     a.area_name)            as area_name
      from businesses b
      join practice_locations l on l.business_id = b.id and l.is_primary
      left join service_areas a on a.pin_code = l.pin_code
     order by b.id, l.created_at
  ),
  covers as (
    select b.id, unnest(b.pin_codes) as pin_code from businesses b
  ),
  -- Every place worth a row: a curated area, or somewhere a business actually
  -- is. The full outer join is what stops either side being lost.
  places as (
    select coalesce(a.pin_code, bs.pin_code)                  as pin_code,
           coalesce(a.area_name, bs.area_name)                as area_name,
           coalesce(bs.district, a.district, 'Unmapped')      as district,
           coalesce(bs.state,    a.state,    'Unmapped')      as state,
           coalesce(a.population, 0)                          as population
      from (select * from service_areas where is_active) a
      full outer join (select distinct pin_code, area_name, district, state from based) bs
        on bs.pin_code = a.pin_code
  ),
  places_f as (
    select * from places p
     where (p_state    is null or p.state    = p_state)
       and (p_district is null or p.district = p_district)
       and (p_pincode  is null or p.pin_code = p_pincode)
  ),
  per_pin as (
    select p.pin_code, p.area_name, p.district, p.state, p.population,
           count(distinct bs.id)::integer                                      as businesses,
           count(distinct bs.id) filter (where bs.status = 'active')::integer   as active,
           count(distinct bs.id) filter (where bs.status = 'pending')::integer  as pending,
           count(distinct cv.id)::integer                                       as covering
      from places_f p
      left join based  bs on bs.pin_code = p.pin_code
      left join covers cv on cv.pin_code = p.pin_code
     group by p.pin_code, p.area_name, p.district, p.state, p.population
  )
  select
    v_scope,
    p.state,
    case when v_scope in ('district','pincode') then p.district end,
    case when v_scope = 'pincode'               then p.pin_code end,
    case when v_scope = 'pincode'               then p.area_name end,
    sum(p.population)::bigint,
    count(*)::integer,
    sum(p.businesses)::integer,
    sum(p.active)::integer,
    sum(p.pending)::integer,
    sum(p.covering)::integer,
    case when sum(p.businesses) > 0 and sum(p.population) > 0
         then round(sum(p.population)::numeric / sum(p.businesses), 0) end
    from per_pin p
   group by 2, 3, 4, 5
   order by (sum(p.businesses) = 0) desc,
            case when sum(p.businesses) > 0 and sum(p.population) > 0
                 then sum(p.population)::numeric / sum(p.businesses) end desc nulls first,
            sum(p.population) desc;
end;
$$;


-- The matrix has the same blind spot, and the same fix.
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
    select distinct on (b.id) b.id, b.status, b.vertical,
           coalesce(l.state,    a.state,    'Unmapped') as state,
           coalesce(l.district, a.district, 'Unmapped') as district
      from businesses b
      join practice_locations l on l.business_id = b.id and l.is_primary
      left join service_areas a on a.pin_code = l.pin_code
     order by b.id, l.created_at
  )
  select case when v_scope = 'state' then bs.state else bs.district end,
         bs.vertical,
         count(*)::integer,
         count(*) filter (where bs.status = 'active')::integer
    from based bs
   where p_state is null or bs.state = p_state
   group by 1, 2
   order by 3 desc, 1, 2;
end;
$$;


-- And the renewal list, which took its district from service_areas too.
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
    select distinct on (b.id) b.id, l.pin_code,
           coalesce(l.state,    a.state)    as state,
           coalesce(l.district, a.district) as district
      from businesses b
      join practice_locations l on l.business_id = b.id and l.is_primary
      left join service_areas a on a.pin_code = l.pin_code
     order by b.id, l.created_at
  )
  select b.id, b.name, b.vertical, b.status, b.phone, b.email,
         bs.state, bs.district, bs.pin_code,
         b.pricing_plan_code, b.locked_monthly_price, b.months_paid,
         b.term_start, b.term_end,
         case when b.term_end is null then null
              else (b.term_end - (now() at time zone 'Asia/Kolkata')::date)::integer end,
         b.auto_renew, b.mandate_status, b.renewal_price, b.renewal_term_months,
         (select max(n.created_at) from billing_notifications n
           where n.business_id = b.id and n.kind = 'renewal_reminder')
    from businesses b
    left join based bs on bs.id = b.id
   where (p_state    is null or bs.state    = p_state)
     and (p_district is null or bs.district = p_district)
     and (p_days_ahead is null
          or (b.term_end is not null
              and b.term_end <= ((now() at time zone 'Asia/Kolkata')::date + p_days_ahead)))
   order by b.term_end nulls last, b.name;
end;
$$;


notify pgrst, 'reload schema';
