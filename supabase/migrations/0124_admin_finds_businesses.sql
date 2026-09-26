-- ============================================================================
-- Sehatsandhi — admin finds a business among thousands
--
-- Run AFTER 0123. Safe to re-run.
--
-- The All Doctors and Pending tabs downloaded every business and searched name
-- and phone in the browser. Fine at 40 listings; slow and unreadable at 1,000.
-- This searches in the database and returns one page at a time.
--
-- One box matches any of: business name, phone, email, registration number;
-- the business's own town, district, state and PIN; any branch's town,
-- district and PIN; any doctor's name or phone; and — for a 6-digit query —
-- any PIN the listing covers. Filters for status and business type. Newest
-- first. Admin only.
-- ============================================================================

create or replace function sehat_admin_find_businesses(
  p_query text default null, p_status text default null, p_vertical text default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_like text;
  v_pin boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  v_like := '%' || replace(replace(coalesce(v_q, ''), '%', ''), '_', '') || '%';
  v_pin := v_q ~ '^[1-9][0-9]{5}$';

  with hits as (
    select b.*
      from businesses b
     where (p_status is null or b.status = p_status)
       and (p_vertical is null or b.vertical = p_vertical)
       and (v_q is null
         or b.name ilike v_like or b.phone ilike v_like or b.email ilike v_like
         or b.reg_number ilike v_like
         or b.own_city ilike v_like or b.own_district ilike v_like or b.own_state ilike v_like
         or b.own_pin_code = v_q
         or (v_pin and v_q = any(b.pin_codes))
         or exists (select 1 from practice_locations l
                     where l.business_id = b.id
                       and (l.city ilike v_like or l.district ilike v_like or l.pin_code = v_q or l.name ilike v_like))
         or exists (select 1 from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
                     where bp.business_id = b.id
                       and (p.full_name ilike v_like or p.phone ilike v_like or p.reg_number ilike v_like)))
  )
  select (select count(*) from hits),
         coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc)
                     from (select * from hits order by created_at desc limit v_limit offset v_offset) h), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

revoke all on function sehat_admin_find_businesses(text, text, text, integer, integer) from public, anon;
grant execute on function sehat_admin_find_businesses(text, text, text, integer, integer) to authenticated;

create index if not exists businesses_created_at_idx on businesses (created_at desc);
create index if not exists businesses_status_vertical_idx on businesses (status, vertical);

notify pgrst, 'reload schema';
