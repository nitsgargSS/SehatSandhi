-- ============================================================================
-- 0285 — Pharmacy stock report for the owner and doctors
-- ============================================================================
-- Decided 29 Oct 2026. The owner (and a manager or doctor — whoever may manage
-- the pharmacy, sehat_pharmacy_may_manage) tracks the whole pharmacy from one
-- place, chosen by dates, by medicine and by company:
--
--   * STOCK REGISTER — per medicine: opening, received, dispensed, returned,
--     adjusted, closing, and what is on the shelf now (at cost and at MRP).
--     Built from pharmacy_stock_moves, which every stock change writes
--     (purchase, sale, return, cancel, adjust), so it adds up by construction.
--   * STOCK ADDED — every purchase line: date, supplier, their invoice, batch,
--     expiry, quantity, cost, MRP and who added it.
--   * DISPENSED — every bill line: date, our bill number, patient (and whether
--     it went on a hospital bill), quantity, returned, amount after discount.
--
-- pharmacy_items gains `manufacturer` — the company / brand — to choose by.
-- ============================================================================

alter table pharmacy_items add column if not exists manufacturer text;
create index if not exists pharmacy_items_manufacturer_idx on pharmacy_items (business_id, lower(manufacturer));

-- pharmacy_stock was made with i.*, which a view fixes when it is created; made
-- again so it carries the company. Dropped first: the new column lands in the
-- middle, which create or replace cannot do.
drop view if exists pharmacy_stock;
create view pharmacy_stock with (security_invoker = true) as
  select i.*,
         coalesce(sum(b.qty_in_hand) filter (where b.expiry_date >= current_date), 0)::integer as qty_available,
         coalesce(sum(b.qty_in_hand) filter (where b.expiry_date < current_date), 0)::integer as qty_expired,
         min(b.expiry_date) filter (where b.qty_in_hand > 0 and b.expiry_date >= current_date) as next_expiry,
         max(b.unit_mrp) filter (where b.qty_in_hand > 0 and b.expiry_date >= current_date) as unit_mrp,
         coalesce(sum(b.qty_in_hand * b.unit_cost) filter (where b.expiry_date >= current_date), 0)::numeric(12,2) as stock_value
    from pharmacy_items i
    left join pharmacy_batches b on b.item_id = i.id
   group by i.id;
grant select on pharmacy_stock to authenticated;

-- The medicine form saves the company too.
create or replace function sehat_pharmacy_save_item(p_business uuid, p_item jsonb)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_item->>'id', '')::uuid;
  v_name text := btrim(coalesce(p_item->>'name', ''));
begin
  perform sehat_pharmacy_check(p_business, true);
  if v_name = '' then raise exception 'Give the medicine a name.' using errcode = '22023'; end if;

  if v_id is null then
    insert into pharmacy_items (business_id, name, generic_name, strength, form, unit, pack_size,
                                hsn_code, gst_rate, reorder_level, is_active, created_by, manufacturer)
    values (p_business, v_name,
            nullif(btrim(coalesce(p_item->>'generic_name', '')), ''),
            nullif(btrim(coalesce(p_item->>'strength', '')), ''),
            nullif(btrim(coalesce(p_item->>'form', '')), ''),
            coalesce(nullif(btrim(coalesce(p_item->>'unit', '')), ''), 'unit'),
            coalesce(nullif(p_item->>'pack_size', '')::integer, 1),
            nullif(btrim(coalesce(p_item->>'hsn_code', '')), ''),
            coalesce(nullif(p_item->>'gst_rate', '')::numeric, 12),
            coalesce(nullif(p_item->>'reorder_level', '')::integer, 0),
            coalesce((p_item->>'is_active')::boolean, true),
            auth.uid(),
            nullif(btrim(coalesce(p_item->>'manufacturer', '')), ''))
    returning id into v_id;
  else
    update pharmacy_items
       set name = v_name,
           generic_name = nullif(btrim(coalesce(p_item->>'generic_name', '')), ''),
           strength = nullif(btrim(coalesce(p_item->>'strength', '')), ''),
           form = nullif(btrim(coalesce(p_item->>'form', '')), ''),
           unit = coalesce(nullif(btrim(coalesce(p_item->>'unit', '')), ''), 'unit'),
           pack_size = coalesce(nullif(p_item->>'pack_size', '')::integer, pack_size),
           hsn_code = nullif(btrim(coalesce(p_item->>'hsn_code', '')), ''),
           gst_rate = coalesce(nullif(p_item->>'gst_rate', '')::numeric, gst_rate),
           reorder_level = coalesce(nullif(p_item->>'reorder_level', '')::integer, reorder_level),
           is_active = coalesce((p_item->>'is_active')::boolean, is_active),
           -- 0285: left as it was by a caller that does not send it.
           manufacturer = case when p_item ? 'manufacturer' then nullif(btrim(coalesce(p_item->>'manufacturer', '')), '') else manufacturer end,
           updated_at = now()
     where id = v_id and business_id = p_business;
    if not found then raise exception 'No such medicine at this clinic.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'This clinic already has "%" with that strength and form.', v_name using errcode = '23505';
end $$;

revoke all on function sehat_pharmacy_save_item(uuid, jsonb) from public, anon;
grant execute on function sehat_pharmacy_save_item(uuid, jsonb) to authenticated;

-- Who an auth user is at this business, for "added by": their practitioner
-- name, else 'Owner' for the login the clinic signed up with.
create or replace function sehat_staff_name_of(p_business uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.full_name from practitioners p
       join business_practitioners bp on bp.practitioner_id = p.id and bp.business_id = p_business
      where p.auth_uid = p_uid limit 1),
    (select 'Owner' from businesses b where b.id = p_business and b.auth_uid = p_uid),
    case when p_uid is null then null else 'Staff' end);
$$;
revoke all on function sehat_staff_name_of(uuid, uuid) from public, anon, authenticated;

create or replace function sehat_pharmacy_stock_report(
  p_business uuid, p_from date, p_to date,
  p_item uuid default null, p_company text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
  v_end timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
  v_company text := nullif(lower(btrim(coalesce(p_company, ''))), '');
begin
  perform sehat_pharmacy_check(p_business, true);
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates.' using errcode = '22023'; end if;
  if p_to - p_from > 366 then raise exception 'Choose at most a year.' using errcode = '22023'; end if;

  return jsonb_build_object(
    'companies', coalesce((select jsonb_agg(distinct btrim(i.manufacturer) order by btrim(i.manufacturer))
                             from pharmacy_items i
                            where i.business_id = p_business and coalesce(btrim(i.manufacturer), '') <> ''), '[]'::jsonb),

    'register', coalesce((select jsonb_agg(r order by r->>'name') from (
      select jsonb_build_object(
               'item_id', i.id, 'name', i.name, 'generic', i.generic_name, 'strength', i.strength,
               'company', i.manufacturer, 'unit', i.unit,
               'opening', coalesce(sum(m.qty) filter (where m.created_at < v_start), 0),
               'received', coalesce(sum(m.qty) filter (where m.created_at >= v_start and m.created_at < v_end and m.kind = 'purchase'), 0),
               'dispensed', -coalesce(sum(m.qty) filter (where m.created_at >= v_start and m.created_at < v_end and m.kind = 'sale'), 0),
               'returned', coalesce(sum(m.qty) filter (where m.created_at >= v_start and m.created_at < v_end and m.kind in ('return', 'cancel')), 0),
               'adjusted', coalesce(sum(m.qty) filter (where m.created_at >= v_start and m.created_at < v_end and m.kind = 'adjust'), 0),
               'closing', coalesce(sum(m.qty) filter (where m.created_at < v_end), 0),
               'in_hand', s.qty_available, 'expired', s.qty_expired, 'next_expiry', s.next_expiry,
               'value_cost', s.stock_value,
               'value_mrp', (select coalesce(sum(b.qty_in_hand * b.unit_mrp), 0)::numeric(12,2) from pharmacy_batches b
                              where b.item_id = i.id and b.expiry_date >= current_date),
               'reorder', i.reorder_level) r
        from pharmacy_items i
        join pharmacy_stock s on s.id = i.id
        left join pharmacy_stock_moves m on m.item_id = i.id
       where i.business_id = p_business
         and (p_item is null or i.id = p_item)
         and (v_company is null or lower(btrim(i.manufacturer)) = v_company)
       group by i.id, s.qty_available, s.qty_expired, s.next_expiry, s.stock_value
    ) x), '[]'::jsonb),

    'added', coalesce((select jsonb_agg(a order by a->>'at' desc) from (
      select jsonb_build_object(
               'at', m.created_at, 'name', i.name, 'company', i.manufacturer, 'unit', i.unit,
               'batch', b.batch_no, 'expiry', b.expiry_date, 'qty', m.qty,
               'unit_cost', b.unit_cost, 'unit_mrp', b.unit_mrp,
               'supplier', pu.supplier_name, 'invoice', pu.invoice_no, 'invoice_date', pu.invoice_date,
               'by', sehat_staff_name_of(p_business, m.recorded_by)) a
        from pharmacy_stock_moves m
        join pharmacy_items i on i.id = m.item_id
        left join pharmacy_batches b on b.id = m.batch_id
        left join pharmacy_purchases pu on pu.id = m.purchase_id
       where m.business_id = p_business and m.kind = 'purchase'
         and m.created_at >= v_start and m.created_at < v_end
         and (p_item is null or i.id = p_item)
         and (v_company is null or lower(btrim(i.manufacturer)) = v_company)
       limit 2000
    ) y), '[]'::jsonb),

    'dispensed', coalesce((select jsonb_agg(d order by d->>'at' desc) from (
      select jsonb_build_object(
               'at', pb.issued_at, 'bill_id', pb.id, 'bill_no', pb.bill_no, 'patient', pb.customer_name,
               'ipd', pb.admission_id is not null, 'status', pb.status,
               'name', bi.name, 'company', i.manufacturer, 'unit', i.unit, 'batch', bi.batch_no,
               'qty', bi.quantity, 'returned', bi.returned_qty, 'mrp', bi.unit_mrp,
               'amount', bi.amount,
               'net', case when pb.status = 'cancelled' then 0
                           else round(bi.amount * (bi.quantity - bi.returned_qty) / bi.quantity, 2) end,
               'by', pb.issued_by_name) d
        from pharmacy_bill_items bi
        join pharmacy_bills pb on pb.id = bi.bill_id
        left join pharmacy_items i on i.id = bi.item_id
       where pb.business_id = p_business
         and pb.issued_at >= v_start and pb.issued_at < v_end
         and (p_item is null or bi.item_id = p_item)
         and (v_company is null or lower(btrim(i.manufacturer)) = v_company)
       limit 5000
    ) z), '[]'::jsonb));
end $$;

revoke all on function sehat_pharmacy_stock_report(uuid, date, date, uuid, text) from public, anon;
grant execute on function sehat_pharmacy_stock_report(uuid, date, date, uuid, text) to authenticated;

notify pgrst, 'reload schema';
