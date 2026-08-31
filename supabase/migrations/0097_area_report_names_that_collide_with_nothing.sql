-- ============================================================================
-- Sehatsandhi — the area report, with names that collide with nothing
--
-- Run AFTER 0096. Safe to re-run.
--
-- 0096 fixed "column reference pin_code is ambiguous" by aliasing the internal
-- columns away from the OUT parameters, and picked p_pin / p_state / p_district
-- as the new names. Those collide with the INPUT parameters instead:
--
--     42702  column reference "p_state" is ambiguous
--
-- A plpgsql function has BOTH sets of names in scope for its whole body — the
-- IN parameters and, for `returns table`, the OUT columns. An internal alias
-- must avoid both, and 0096 dodged one by running into the other.
--
-- Everything internal is now prefixed x_, which matches neither p_* nor a
-- column of the result. Prosaic, and the point: the fix is a naming convention
-- that cannot collide rather than another round of picking names that happen to
-- be free today.
--
-- This draft was executed against the live schema inside a rolled-back
-- transaction before being written to a file. Both previous attempts applied
-- cleanly and failed on first call, because `create function` only parses the
-- body — plpgsql resolves identifiers when the statement first runs. A
-- migration that applies is not a function that works.
-- ============================================================================

create or replace function sehat_admin_area_report(
  p_scope text default 'district', p_state text default null,
  p_district text default null, p_pincode text default null)
returns table (scope text, state text, district text, pin_code text, area_name text,
  population bigint, areas integer, businesses integer, active integer, pending integer,
  covering integer, residents_per_business numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_scope text := lower(coalesce(p_scope,'district'));
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode='42501'; end if;
  if v_scope not in ('pincode','district','state') then v_scope := 'district'; end if;
  return query
  with based as (
    select distinct on (b.id) b.id as x_biz, b.status as x_status, l.pin_code as x_pin,
           coalesce(l.state, sa.state, 'Unmapped') as x_state,
           coalesce(l.district, sa.district, 'Unmapped') as x_district,
           coalesce(l.city, sa.area_name) as x_area
      from businesses b
      join practice_locations l on l.business_id = b.id and l.is_primary
      left join service_areas sa on sa.pin_code = l.pin_code
     order by b.id, l.created_at),
  covers as (select b.id as x_biz, unnest(b.pin_codes) as x_pin from businesses b),
  places as (
    select coalesce(sa.pin_code, bp.x_pin) as x_pin,
           coalesce(sa.area_name, bp.x_area) as x_area,
           coalesce(bp.x_district, sa.district, 'Unmapped') as x_district,
           coalesce(bp.x_state, sa.state, 'Unmapped') as x_state,
           coalesce(sa.population, 0) as x_pop
      from (select * from service_areas where is_active) sa
      full outer join (select distinct bb.x_pin, bb.x_area, bb.x_district, bb.x_state from based bb) bp
        on bp.x_pin = sa.pin_code),
  places_f as (
    select pl.* from places pl
     where (p_state is null or pl.x_state = p_state)
       and (p_district is null or pl.x_district = p_district)
       and (p_pincode is null or pl.x_pin = p_pincode)),
  per_pin as (
    select pf.x_pin, pf.x_area, pf.x_district, pf.x_state, pf.x_pop,
           count(distinct bs.x_biz)::integer as n_biz,
           count(distinct bs.x_biz) filter (where bs.x_status='active')::integer as n_active,
           count(distinct bs.x_biz) filter (where bs.x_status='pending')::integer as n_pending,
           count(distinct cv.x_biz)::integer as n_cover
      from places_f pf
      left join based bs on bs.x_pin = pf.x_pin
      left join covers cv on cv.x_pin = pf.x_pin
     group by pf.x_pin, pf.x_area, pf.x_district, pf.x_state, pf.x_pop)
  select v_scope, pp.x_state,
    case when v_scope in ('district','pincode') then pp.x_district end,
    case when v_scope='pincode' then pp.x_pin end,
    case when v_scope='pincode' then pp.x_area end,
    sum(pp.x_pop)::bigint, count(*)::integer,
    sum(pp.n_biz)::integer, sum(pp.n_active)::integer, sum(pp.n_pending)::integer,
    sum(pp.n_cover)::integer,
    case when sum(pp.n_biz)>0 and sum(pp.x_pop)>0 then round(sum(pp.x_pop)::numeric/sum(pp.n_biz),0) end
    from per_pin pp group by 2,3,4,5
   order by (sum(pp.n_biz)=0) desc,
     case when sum(pp.n_biz)>0 and sum(pp.x_pop)>0 then sum(pp.x_pop)::numeric/sum(pp.n_biz) end desc nulls first,
     sum(pp.x_pop) desc;
end; $$;

comment on function sehat_admin_area_report is
  'Registrations by pincode, district or state, including businesses outside '
  'the curated service_areas — those report under "Unmapped" rather than '
  'vanishing. `businesses` counts primary locations, `covering` counts the '
  'coverage array. Internal aliases are x_ prefixed so they collide with '
  'neither the IN parameters nor the OUT columns.';

notify pgrst, 'reload schema';
