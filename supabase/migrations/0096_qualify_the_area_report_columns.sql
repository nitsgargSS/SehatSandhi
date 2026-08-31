-- ============================================================================
-- Sehatsandhi — the area report had an ambiguous column, and said so
--
-- Run AFTER 0095. Safe to re-run.
--
-- 0094 rewrote sehat_admin_area_report to survive businesses outside the
-- curated areas, and broke it: every call raised
--
--     42702  column reference "pin_code" is ambiguous
--
-- A plpgsql function declared `returns table (... pin_code text ...)` has
-- pin_code as an OUT parameter in scope for the whole body. Any UNQUALIFIED
-- pin_code in the query is then ambiguous between that variable and the column,
-- and Postgres refuses rather than guessing.
--
-- 0093's version never tripped it because every reference happened to be
-- qualified. 0094 added
--
--     (select distinct pin_code, area_name, district, state from based)
--
-- with four bare column names, four of which are also OUT parameters.
--
-- The fix is to qualify every one. Not to rename the OUT parameters — the
-- column names are the report's contract with the client and the CSV — and not
-- to set `#variable_conflict use_column`, which would silence this instance and
-- leave the next one to be discovered at runtime by whoever calls it.
--
-- Caught because the report was exercised after the migration rather than
-- assumed to work from a clean `migrate up`. An applied migration proves the
-- DDL parsed, never that the function runs.
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
    select distinct on (b.id)
           b.id            as business_id,
           b.status        as business_status,
           l.pin_code      as loc_pin,
           coalesce(l.state,    a.state,    'Unmapped') as loc_state,
           coalesce(l.district, a.district, 'Unmapped') as loc_district,
           coalesce(l.city,     a.area_name)            as loc_area
      from businesses b
      join practice_locations l on l.business_id = b.id and l.is_primary
      left join service_areas a on a.pin_code = l.pin_code
     order by b.id, l.created_at
  ),
  covers as (
    select b.id as business_id, unnest(b.pin_codes) as cov_pin from businesses b
  ),
  -- Every place worth a row: a curated area, or somewhere a business actually
  -- is. Aliased away from the OUT parameter names throughout — that is the
  -- whole point of this migration.
  places as (
    select coalesce(sa.pin_code,  bp.loc_pin)                as p_pin,
           coalesce(sa.area_name, bp.loc_area)               as p_area,
           coalesce(bp.loc_district, sa.district, 'Unmapped') as p_district,
           coalesce(bp.loc_state,    sa.state,    'Unmapped') as p_state,
           coalesce(sa.population, 0)                         as p_pop
      from (select * from service_areas where is_active) sa
      full outer join (
        select distinct bb.loc_pin, bb.loc_area, bb.loc_district, bb.loc_state
          from based bb
      ) bp on bp.loc_pin = sa.pin_code
  ),
  places_f as (
    select pl.* from places pl
     where (p_state    is null or pl.p_state    = p_state)
       and (p_district is null or pl.p_district = p_district)
       and (p_pincode  is null or pl.p_pin      = p_pincode)
  ),
  per_pin as (
    select pf.p_pin, pf.p_area, pf.p_district, pf.p_state, pf.p_pop,
           count(distinct bs.business_id)::integer                                          as n_biz,
           count(distinct bs.business_id) filter (where bs.business_status = 'active')::integer  as n_active,
           count(distinct bs.business_id) filter (where bs.business_status = 'pending')::integer as n_pending,
           count(distinct cv.business_id)::integer                                          as n_cover
      from places_f pf
      left join based  bs on bs.loc_pin = pf.p_pin
      left join covers cv on cv.cov_pin = pf.p_pin
     group by pf.p_pin, pf.p_area, pf.p_district, pf.p_state, pf.p_pop
  )
  select
    v_scope,
    pp.p_state,
    case when v_scope in ('district','pincode') then pp.p_district end,
    case when v_scope = 'pincode'               then pp.p_pin end,
    case when v_scope = 'pincode'               then pp.p_area end,
    sum(pp.p_pop)::bigint,
    count(*)::integer,
    sum(pp.n_biz)::integer,
    sum(pp.n_active)::integer,
    sum(pp.n_pending)::integer,
    sum(pp.n_cover)::integer,
    case when sum(pp.n_biz) > 0 and sum(pp.p_pop) > 0
         then round(sum(pp.p_pop)::numeric / sum(pp.n_biz), 0) end
    from per_pin pp
   group by 2, 3, 4, 5
   order by (sum(pp.n_biz) = 0) desc,
            case when sum(pp.n_biz) > 0 and sum(pp.p_pop) > 0
                 then sum(pp.p_pop)::numeric / sum(pp.n_biz) end desc nulls first,
            sum(pp.p_pop) desc;
end;
$$;

comment on function sehat_admin_area_report is
  'Registrations by pincode, district or state, including businesses outside '
  'the curated service_areas — those report under "Unmapped" rather than '
  'vanishing. `businesses` counts primary locations; `covering` counts the '
  'coverage array. Every internal alias avoids the OUT parameter names, which '
  'is what 0096 fixed.';


notify pgrst, 'reload schema';
