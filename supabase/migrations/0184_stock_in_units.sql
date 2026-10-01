-- ============================================================================
-- Sehatsandhi — stock is entered as a plain quantity, at a price per unit
--
-- Run AFTER 0183. Safe to re-run.
--
-- Found 1 Oct 2026: a clinic entered 10 bottles of eye drops and saw 0 in
-- stock. Adding a medicine never added stock, and stock came in only through a
-- purchase counted in PACKS (× the item's pack size, which defaulted to 10).
-- A purchase line may now give units / free_units / unit_cost / unit_mrp —
-- "10 bottles at ₹250 each" — and the pack size plays no part. Lines that give
-- packs work exactly as before (0158's body otherwise unchanged).
-- ============================================================================

create or replace function sehat_pharmacy_record_purchase(
  p_business uuid,
  p_supplier_name text,
  p_invoice_no text,
  p_invoice_date date,
  p_lines jsonb,
  p_notes text default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_purchase uuid;
  v_supplier uuid;
  v_name text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  l jsonb;
  it record;
  v_units integer;
  v_paid_units integer;
  v_batch uuid;
  v_total numeric(12,2) := 0;
  v_expiry date;
  v_by_unit boolean;
  v_size integer;
  v_cost numeric;
  v_mrp numeric;
begin
  perform sehat_pharmacy_check(p_business, true);
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one medicine to the purchase.' using errcode = '22023';
  end if;

  if v_name is not null then
    insert into pharmacy_suppliers (business_id, name) values (p_business, v_name)
    on conflict (business_id, lower(name)) do nothing;
    select id into v_supplier from pharmacy_suppliers
     where business_id = p_business and lower(name) = lower(v_name);
  end if;

  insert into pharmacy_purchases (business_id, supplier_id, supplier_name, invoice_no, invoice_date, notes, recorded_by)
  values (p_business, v_supplier, v_name, nullif(btrim(coalesce(p_invoice_no, '')), ''),
          coalesce(p_invoice_date, current_date), nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_purchase;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from pharmacy_items
     where id = (l->>'item_id')::uuid and business_id = p_business;
    if not found then raise exception 'A medicine on this purchase is not on the clinic''s list.' using errcode = 'P0002'; end if;

    -- 0184: a line may give plain units (bottles, tablets) and per-unit prices
    -- instead of packs; then the pack size does not matter.
    v_by_unit := l ? 'units';
    v_size := case when v_by_unit then 1 else it.pack_size end;
    v_paid_units := coalesce(nullif(l->>case when v_by_unit then 'units' else 'packs' end, '')::integer, 0) * v_size;
    v_units := v_paid_units + coalesce(nullif(l->>case when v_by_unit then 'free_units' else 'free_packs' end, '')::integer, 0) * v_size;
    v_cost := coalesce(nullif(l->>case when v_by_unit then 'unit_cost' else 'pack_cost' end, '')::numeric, 0);
    v_mrp := coalesce(nullif(l->>case when v_by_unit then 'unit_mrp' else 'pack_mrp' end, '')::numeric, 0);
    if v_units <= 0 then raise exception '%: give how many came in.', it.name using errcode = '22023'; end if;
    if btrim(coalesce(l->>'batch_no', '')) = '' then
      raise exception '%: the batch number is on the strip or box.', it.name using errcode = '22023';
    end if;
    v_expiry := nullif(l->>'expiry_date', '')::date;
    if v_expiry is null then raise exception '%: give the expiry date.', it.name using errcode = '22023'; end if;
    if v_expiry < current_date then raise exception '%: that batch has already expired.', it.name using errcode = '22023'; end if;
    if v_mrp <= 0 then
      raise exception '%: give the MRP printed on the pack.', it.name using errcode = '22023';
    end if;

    insert into pharmacy_batches (business_id, item_id, purchase_id, batch_no, expiry_date,
                                  qty_received, qty_in_hand, unit_cost, unit_mrp)
    values (p_business, it.id, v_purchase, upper(btrim(l->>'batch_no')), v_expiry, v_units, v_units,
            -- Free packs bring the cost of each unit down.
            round(v_cost * greatest(v_paid_units, 0) / v_size / v_units, 4),
            round(v_mrp / v_size, 4))
    returning id into v_batch;

    insert into pharmacy_stock_moves (business_id, item_id, batch_id, kind, qty, purchase_id, recorded_by)
    values (p_business, it.id, v_batch, 'purchase', v_units, v_purchase, auth.uid());

    v_total := v_total + round(v_cost * v_paid_units / v_size, 2);
  end loop;

  update pharmacy_purchases set total_cost = v_total where id = v_purchase;
  return v_purchase;
end $$;

notify pgrst, 'reload schema';
