-- ============================================================================
-- 0253 — A strip can be opened: tablets are counted and billed one by one
-- ============================================================================
-- AFTER 0252. Safe to re-run.
--
-- The dispensary counts each medicine in one unit and bills whole numbers of
-- it. A clinic that entered its tablets as strips (6 strips at ₹226) could not
-- bill the 5 tablets a patient actually takes. sehat_pharmacy_split_pack
-- re-counts one medicine in its smaller unit: 1 strip = N tablets. Everything
-- that holds its quantity moves together — stock on the shelf, the batch's
-- cost and MRP (now per tablet), its stock history, and past bills (10 tablets
-- at ₹22.60 where it said 1 strip at ₹226; every amount is unchanged) — so a
-- return on an old bill still adds up. Done once per medicine; pack_size
-- remembers N, so a full strip is still one tap at the counter.
-- ============================================================================

create or replace function sehat_pharmacy_split_pack(p_item uuid, p_per_pack integer, p_unit text default 'tablet')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it pharmacy_items;
  n integer := p_per_pack;
  v_unit text := lower(nullif(btrim(coalesce(p_unit, '')), ''));
  v_was text;
begin
  select * into it from pharmacy_items where id = p_item for update;
  if it.id is null then raise exception 'That medicine was not found.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(it.business_id, true);
  if n is null or n < 2 or n > 1000 then raise exception 'Enter how many are in one pack — 2 or more.' using errcode = '22023'; end if;
  if it.pack_size > 1 then
    raise exception 'This medicine is already counted loose (% in a pack).', it.pack_size using errcode = 'P0001';
  end if;
  if v_unit is null or char_length(v_unit) > 20 then v_unit := 'tablet'; end if;
  if exists (select 1 from pharmacy_batches b where b.item_id = p_item and (b.qty_received::bigint * n > 2000000000)) then
    raise exception 'That count is too large.' using errcode = '22023';
  end if;
  v_was := it.unit;

  update pharmacy_batches
     set qty_received = qty_received * n, qty_in_hand = qty_in_hand * n,
         unit_cost = round(unit_cost / n, 4), unit_mrp = greatest(round(unit_mrp / n, 4), 0.0001)
   where item_id = p_item;
  update pharmacy_stock_moves set qty = qty * n where item_id = p_item;
  update pharmacy_returns r
     set items = (select jsonb_agg(case when exists (select 1 from pharmacy_bill_items bi where bi.id::text = e ->> 'bill_item_id' and bi.item_id = p_item)
                                        then jsonb_set(e, '{qty}', to_jsonb((e ->> 'qty')::integer * n)) else e end order by o)
                    from jsonb_array_elements(r.items) with ordinality x(e, o))
   where exists (select 1 from pharmacy_bill_items bi where bi.bill_id = r.bill_id and bi.item_id = p_item)
     and jsonb_typeof(r.items) = 'array' and jsonb_array_length(r.items) > 0;
  update pharmacy_bill_items
     set quantity = quantity * n, returned_qty = returned_qty * n, unit_mrp = round(unit_mrp / n, 4)
   where item_id = p_item;
  update pharmacy_items
     set unit = v_unit, pack_size = n, reorder_level = least(reorder_level * n, 2000000000), updated_at = now()
   where id = p_item;

  insert into pharmacy_stock_moves (business_id, item_id, kind, qty, reason, recorded_by)
  values (it.business_id, p_item, 'adjust', 0, 'Now counted loose: 1 ' || coalesce(nullif(btrim(v_was), ''), 'pack') || ' = ' || n || ' ' || v_unit, auth.uid());

  return jsonb_build_object('unit', v_unit, 'pack_size', n);
end $$;
revoke all on function sehat_pharmacy_split_pack(uuid, integer, text) from public, anon;
grant execute on function sehat_pharmacy_split_pack(uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
