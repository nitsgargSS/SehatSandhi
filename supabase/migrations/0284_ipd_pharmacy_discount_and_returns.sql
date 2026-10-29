-- ============================================================================
-- 0284 — IPD medicines: a discount at issue, and part returns off the stay
-- ============================================================================
-- Decided 29 Oct 2026, walking the IPD → pharmacy → bill flow for the demo.
--
-- 1. DISCOUNT. A ward issue (0270) could not carry a discount; the counter's
--    could. sehat_pharmacy_issue_to_admission now takes the same discount the
--    counter does, with its reason, and what goes on the stay is what the
--    patient was actually charged.
--
-- 2. RETURNS. A ward issue could only be taken back whole. Now any part of it
--    can come back: the counter's own sehat_pharmacy_return puts the stock
--    back and credits each line at what was charged for it — the discount
--    included — and the same credit comes off that medicine's charge on the
--    stay. Nothing is paid at the counter for a ward issue, so nothing is
--    handed back there: the deposit left goes up, and whatever of the
--    deposit is unused is refunded at discharge by the hospital bill.
--    Once the medicines are on an issued hospital bill they cannot be
--    returned here — cancel that bill first, as for a whole issue.
-- ============================================================================

drop function if exists sehat_pharmacy_issue_to_admission(uuid, jsonb, uuid);

create or replace function sehat_pharmacy_issue_to_admission(
  p_admission uuid, p_lines jsonb, p_request uuid default null,
  p_discount_pct numeric default 0, p_discount_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  a admissions;
  v_bill uuid;
  v_no text;
  v_total numeric;
  i record;
begin
  select * into a from admissions where id = p_admission;
  if a.id is null or a.status <> 'admitted' then raise exception 'That patient is not admitted.' using errcode = 'P0001'; end if;
  perform sehat_pharmacy_check(a.business_id, false);

  -- The counter's own issue: stock, batches, earliest expiry first, its
  -- discount rules. No payment.
  v_bill := sehat_pharmacy_issue_bill(a.business_id, p_lines, a.patient_member_id, null, null, null,
                                      coalesce(p_discount_pct, 0), p_discount_reason, null);
  update pharmacy_bills set admission_id = a.id where id = v_bill returning bill_no, net_payable into v_no, v_total;

  -- One charge per medicine on the admission, at what was charged (after the
  -- discount). Medicines inside the IPD bill carry no separate GST.
  for i in
    select bi.name, sum(bi.quantity) qty, max(bi.unit_mrp) mrp, sum(bi.amount) amount
      from pharmacy_bill_items bi where bi.bill_id = v_bill group by bi.name, bi.item_id order by min(bi.sort_order)
  loop
    insert into patient_charges (business_id, patient_member_id, admission_id, category, description,
                                 quantity, unit_price, amount, charged_on, recorded_by, pharmacy_bill_id)
    values (a.business_id, a.patient_member_id, a.id, 'medicine', i.name || ' (' || v_no || ')',
            i.qty, round(i.amount / nullif(i.qty, 0), 2), i.amount, (now() at time zone 'Asia/Kolkata')::date,
            sehat_caller_practitioner_id(), v_bill);
  end loop;

  if p_request is not null then
    update pharmacy_ward_requests set status = 'issued', issued_bill_id = v_bill, issued_at = now(),
           issued_by_name = sehat_caller_staff_name(a.business_id)
     where id = p_request and admission_id = a.id and status = 'requested';
  end if;

  return jsonb_build_object('bill_id', v_bill, 'bill_no', v_no, 'amount', v_total,
                            'money', sehat_admission_money(a.id));
end $$;

revoke all on function sehat_pharmacy_issue_to_admission(uuid, jsonb, uuid, numeric, text) from public, anon;
grant execute on function sehat_pharmacy_issue_to_admission(uuid, jsonb, uuid, numeric, text) to authenticated;


-- Part of a ward issue comes back: stock back, and its charge off the stay.
create or replace function sehat_pharmacy_return_ipd(p_bill uuid, p_lines jsonb, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  b pharmacy_bills;
  v_billed text;
  v_out jsonb;
  k record;
begin
  select * into b from pharmacy_bills where id = p_bill;
  if b.id is null or b.admission_id is null then raise exception 'That is not a ward issue.' using errcode = 'P0002'; end if;
  perform sehat_pharmacy_check(b.business_id, false);
  select pb.bill_no into v_billed from patient_charges c join patient_bills pb on pb.id = c.bill_id and pb.status = 'issued'
   where c.pharmacy_bill_id = p_bill limit 1;
  if v_billed is not null then
    raise exception 'These medicines are already on hospital bill %. Cancel that bill first.', v_billed using errcode = 'P0001';
  end if;

  -- The counter's return: stock back, a credit per line at what was charged.
  -- Nothing was paid at the counter, so it refunds nothing.
  v_out := sehat_pharmacy_return(p_bill, p_lines, null, coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Returned from the ward'));

  -- Each medicine's charge on the stay becomes what is still kept of it, at
  -- what was charged for it — worked out afresh rather than taken down step
  -- by step, so two returns in quick succession cannot miscount.
  for k in
    select bi.name, sum(bi.quantity - bi.returned_qty) kept,
           sum(round(bi.amount * (bi.quantity - bi.returned_qty) / bi.quantity, 2)) amount
      from pharmacy_bill_items bi where bi.bill_id = p_bill group by bi.name
  loop
    update patient_charges set quantity = k.kept, amount = k.amount
     where pharmacy_bill_id = p_bill and bill_id is null and description = k.name || ' (' || b.bill_no || ')';
  end loop;
  -- A medicine returned in full leaves the stay altogether. The ward request
  -- stays answered: the medicines did go to the ward.
  delete from patient_charges where pharmacy_bill_id = p_bill and bill_id is null and quantity <= 0;

  return jsonb_build_object('credit', (v_out->>'credit')::numeric, 'money', sehat_admission_money(b.admission_id));
end $$;

revoke all on function sehat_pharmacy_return_ipd(uuid, jsonb, text) from public, anon;
grant execute on function sehat_pharmacy_return_ipd(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
