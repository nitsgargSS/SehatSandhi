-- ============================================================================
-- 0226 — The OPD fee taken with the token; GST on a counter invoice
-- ============================================================================
-- AFTER 0225. Safe to re-run.
--
-- Decided 10 Oct 2026:
--
-- 1. THE FEE WITH THE TOKEN. Giving a token put the OPD fee on the patient's
--    account but recorded no payment, so a clinic's collections showed none of
--    its OPD money unless someone went into each patient's billing afterwards.
--    sehat_opd_visit now takes how the fee was paid (cash, UPI, card…) and
--    records the payment with the token. Left out, nothing changes: the fee
--    stays due.
--
-- 2. GST ON AN INVOICE. A line on a counter invoice (0225) may carry GST, if
--    the biller charges it — 0% by default, the rate chosen per line, and
--    remembered on the price list. The tax is added to the rate; the charge's
--    amount is what the patient pays, tax and all, so the ledger, balances and
--    reports go on working in rupees owed. gst_rate and tax_amount say how
--    much of it is tax. The printed bill shows the taxable value and the
--    CGST / SGST halves when any line has tax, and the clinic's GSTIN when it
--    has one (it always did).
--
--    Not here: HSN / SAC codes, IGST for a buyer in another state, and any
--    check that a clinic charging GST is registered for it.
-- ============================================================================

-- ── 1. The fee with the token ───────────────────────────────────────────────
-- The old eight-argument form goes, so there is one function to call; callers
-- that send eight still reach this one.
drop function if exists sehat_opd_visit(uuid, uuid, uuid, numeric, text, text, integer, text);
CREATE OR REPLACE FUNCTION public.sehat_opd_visit(p_business uuid, p_member uuid, p_practitioner uuid, p_fee numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_priority integer DEFAULT 0, p_priority_reason text DEFAULT NULL::text, p_paid_method text DEFAULT NULL::text, p_paid_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_doc    record;
  v_list   numeric;
  v_fee    numeric;
  v_token  opd_queue;
  v_charge uuid;
  v_paid   numeric := 0;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'not your business' using errcode = 'insufficient_privilege';
  end if;

  if p_practitioner is not null then
    select p.full_name, bp.consultation_fee, bp.discounted_fee into v_doc
      from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
     where bp.business_id = p_business and bp.practitioner_id = p_practitioner
       and bp.status <> 'suspended';
    if v_doc.full_name is null then
      raise exception 'That doctor does not work here.' using errcode = 'no_data_found';
    end if;
    v_list := nullif(coalesce(v_doc.discounted_fee, v_doc.consultation_fee, 0), 0);
  end if;

  v_token := sehat_issue_token(p_member, p_business, p_practitioner, nullif(btrim(coalesce(p_reason, '')), ''),
                               null, coalesce(p_priority, 0), p_priority_reason, sehat_caller_practitioner_id());

  v_fee := coalesce(p_fee, v_list, 0);
  if v_fee < 0 then raise exception 'The fee cannot be negative.' using errcode = 'check_violation'; end if;
  if v_fee > 0 or v_list is not null then
    insert into patient_charges (business_id, patient_member_id, category, description, quantity,
                                 unit_price, amount, practitioner_id, list_price, discount_reason)
    values (p_business, p_member, 'consultation',
            'OPD consultation' || coalesce(' — ' || v_doc.full_name, ''), 1,
            v_fee, v_fee, p_practitioner, v_list, p_discount_reason)
    returning id into v_charge;
  end if;

  -- 0226: the fee taken at the desk as the token is given — so the day's
  -- collections have it, under the name of whoever took it.
  if v_fee > 0 and nullif(btrim(coalesce(p_paid_method, '')), '') is not null then
    insert into patient_payments (business_id, patient_member_id, amount, method, reference, notes, recorded_by, practitioner_id)
    values (p_business, p_member, v_fee, p_paid_method, nullif(btrim(coalesce(p_paid_reference, '')), ''),
            'OPD fee, token ' || v_token.token_number, sehat_caller_practitioner_id(), p_practitioner);
    v_paid := v_fee;
  end if;

  update business_patients set last_seen_at = now(), visit_count = coalesce(visit_count, 0) + 1,
         primary_practitioner_id = coalesce(primary_practitioner_id, p_practitioner)
   where business_id = p_business and patient_member_id = p_member;

  return jsonb_build_object('queue_id', v_token.id, 'token_number', v_token.token_number,
                            'charge_id', v_charge, 'fee', v_fee, 'list_price', v_list, 'paid', v_paid);
end $function$;
revoke all on function sehat_opd_visit(uuid, uuid, uuid, numeric, text, text, integer, text, text, text) from public, anon;
grant execute on function sehat_opd_visit(uuid, uuid, uuid, numeric, text, text, integer, text, text, text) to authenticated;

-- ── 2. GST ──────────────────────────────────────────────────────────────────
alter table patient_charges add column if not exists gst_rate numeric(5,2) not null default 0;
alter table patient_charges add column if not exists tax_amount numeric(12,2) not null default 0;
alter table patient_bill_items add column if not exists gst_rate numeric(5,2) not null default 0;
alter table patient_bill_items add column if not exists tax_amount numeric(12,2) not null default 0;
alter table clinic_price_items add column if not exists gst_rate numeric(5,2) not null default 0;
alter table patient_charges drop constraint if exists patient_charges_gst_sane;
alter table patient_charges add constraint patient_charges_gst_sane
  check (gst_rate between 0 and 40 and tax_amount >= 0 and tax_amount <= amount);
alter table clinic_price_items drop constraint if exists clinic_price_items_gst_sane;
alter table clinic_price_items add constraint clinic_price_items_gst_sane check (gst_rate between 0 and 40);

-- A bill made the older way (Issue a bill) carries each line's tax too.
CREATE OR REPLACE FUNCTION public.sehat_issue_patient_bill(p_patient_member_id uuid, p_business_id uuid, p_admission_id uuid DEFAULT NULL::uuid, p_visit_id uuid DEFAULT NULL::uuid, p_discount numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_round_off numeric DEFAULT 0, p_issued_by uuid DEFAULT NULL::uuid, p_supersedes uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_type text;
  v_subtotal numeric(12,2);
  v_count integer;
  m record;
  b record;
  -- Scalars, not a record: on an OPD or account bill there is no admission to
  -- read, and a record variable never assigned raises the moment a field of it
  -- is touched.
  v_admission_no text;
  v_admitted_at timestamptz;
  v_discharged_at timestamptz;
begin
  if not sehat_caller_owns_business(p_business_id) then
    raise exception 'not your business';
  end if;

  v_type := case
              when p_admission_id is not null then 'ipd'
              when p_visit_id is not null then 'opd'
              else 'account'
            end;

  select mm.full_name, mm.age_years, mm.gender, pa.phone into m
    from patient_members mm join patients pa on pa.id = mm.patient_id
   where mm.id = p_patient_member_id;
  if not found then raise exception 'no such patient'; end if;

  select bb.name, bb.address, bb.phone, bb.gstin into b
    from businesses bb where bb.id = p_business_id;

  if p_admission_id is not null then
    select ad.admission_no, ad.admitted_at, ad.discharged_at
      into v_admission_no, v_admitted_at, v_discharged_at
      from admissions ad where ad.id = p_admission_id and ad.business_id = p_business_id;
    if not found then raise exception 'no such admission at this business'; end if;
  end if;

  -- ── A correction releases the bill it replaces, FIRST ──
  -- Two reasons it cannot wait until the end. One live bill per admission is a
  -- unique index, so leaving the old one 'issued' while inserting the new one
  -- collides. And a corrected bill has to carry the same lines — which are all
  -- stamped with the old bill, so without releasing them there is nothing left
  -- to bill and this would refuse its own correction.
  if p_supersedes is not null then
    perform 1 from patient_bills
     where id = p_supersedes and business_id = p_business_id and status = 'issued';
    if not found then
      raise exception 'the bill being corrected is not an issued bill of this business';
    end if;

    update patient_bills set status = 'superseded' where id = p_supersedes;
    update patient_charges set bill_id = null where bill_id = p_supersedes;
    -- Payments are deliberately NOT released here. Money already taken belongs
    -- to whatever replaces this bill, and nulling it now would leave it
    -- untagged on any bill that is not scoped to an admission — showing a
    -- patient who has paid in full a balance equal to the whole bill. They are
    -- moved onto the new bill once it exists, below.
  end if;

  -- Nothing to bill is a mistake worth naming, not an empty document.
  select count(*), coalesce(sum(c.amount), 0) into v_count, v_subtotal
    from patient_charges c
   where c.patient_member_id = p_patient_member_id
     and c.business_id = p_business_id
     and c.bill_id is null
     and (p_admission_id is null or c.admission_id = p_admission_id)
     and (p_visit_id is null or c.visit_id = p_visit_id);

  if v_count = 0 then
    raise exception 'there are no unbilled charges to put on this bill';
  end if;

  if coalesce(p_discount, 0) > v_subtotal then
    raise exception 'the discount is more than the bill';
  end if;

  insert into patient_bills (
    bill_no, business_id, patient_member_id, admission_id, visit_id, bill_type,
    patient_name, patient_age, patient_gender, patient_phone,
    mrn, clinic_name, clinic_address, clinic_phone, clinic_gstin,
    admission_no, admitted_at, discharged_at,
    subtotal, discount_amount, discount_reason, round_off, net_payable,
    issued_by, supersedes
  ) values (
    sehat_next_bill_number(p_business_id), p_business_id, p_patient_member_id,
    p_admission_id, p_visit_id, v_type,
    m.full_name, m.age_years, m.gender, m.phone,
    (select bp.mrn from business_patients bp
      where bp.patient_member_id = p_patient_member_id and bp.business_id = p_business_id),
    b.name, b.address, b.phone, b.gstin,
    v_admission_no, v_admitted_at, v_discharged_at,
    v_subtotal, coalesce(p_discount, 0), p_discount_reason, coalesce(p_round_off, 0),
    v_subtotal - coalesce(p_discount, 0) + coalesce(p_round_off, 0),
    p_issued_by, p_supersedes
  ) returning id into v_id;

  -- Copy, then stamp. The copy is what the patient holds; the stamp is what
  -- stops the same line reaching a second bill.
  insert into patient_bill_items (
    bill_id, charge_id, category, description, quantity, unit_price, amount,
    gst_rate, tax_amount,
    charged_on, sort_order
  )
  select v_id, c.id, c.category, c.description, c.quantity, c.unit_price, c.amount,
         c.gst_rate, c.tax_amount,
         c.charged_on,
         (row_number() over (order by c.charged_on, c.category, c.created_at))::integer
    from patient_charges c
   where c.patient_member_id = p_patient_member_id
     and c.business_id = p_business_id
     and c.bill_id is null
     and (p_admission_id is null or c.admission_id = p_admission_id)
     and (p_visit_id is null or c.visit_id = p_visit_id);

  update patient_charges c
     set bill_id = v_id
   where c.patient_member_id = p_patient_member_id
     and c.business_id = p_business_id
     and c.bill_id is null
     and (p_admission_id is null or c.admission_id = p_admission_id)
     and (p_visit_id is null or c.visit_id = p_visit_id);

  -- Advances. An IPD deposit is taken on admission, long before there is a
  -- bill to attach it to; at final billing it is exactly what this bill has
  -- already been paid. Leaving it untagged would show the patient a balance
  -- they have in fact already handed over.
  if p_admission_id is not null then
    update patient_payments
       set bill_id = v_id
     where admission_id = p_admission_id and business_id = p_business_id
       and bill_id is null;
  end if;

  -- The status moved before the insert; the back-pointer and the money it had
  -- already collected are what need the new id.
  if p_supersedes is not null then
    update patient_bills set superseded_by = v_id where id = p_supersedes;
    update patient_payments set bill_id = v_id where bill_id = p_supersedes;
  end if;

  return v_id;
end $function$;

-- The bill as the clinic reads it: each line now says its tax.
create or replace view patient_bill_detail with (security_invoker = true) as
 SELECT b.id,
    b.bill_no,
    b.business_id,
    b.patient_member_id,
    b.admission_id,
    b.visit_id,
    b.bill_type,
    b.patient_name,
    b.patient_age,
    b.patient_gender,
    b.patient_phone,
    b.mrn,
    b.clinic_name,
    b.clinic_address,
    b.clinic_phone,
    b.clinic_gstin,
    b.admission_no,
    b.admitted_at,
    b.discharged_at,
    b.subtotal,
    b.discount_amount,
    b.discount_reason,
    b.round_off,
    b.net_payable,
    b.issued_at,
    b.issued_by,
    b.status,
    b.supersedes,
    b.superseded_by,
    b.cancelled_reason,
    b.public_token,
    b.token_expires_at,
    b.sent_at,
    b.sent_channels,
    b.send_error,
    b.created_at,
    COALESCE(p.paid, 0::numeric) AS paid,
    b.net_payable - COALESCE(p.paid, 0::numeric) AS balance_due,
    ( SELECT COALESCE(jsonb_agg(jsonb_build_object('category', i.category, 'description', i.description, 'quantity', i.quantity, 'unit_price', i.unit_price, 'amount', i.amount, 'charged_on', i.charged_on, 'gst_rate', i.gst_rate, 'tax_amount', i.tax_amount) ORDER BY i.sort_order), '[]'::jsonb) AS "coalesce"
           FROM patient_bill_items i
          WHERE i.bill_id = b.id) AS items
   FROM patient_bills b
     LEFT JOIN LATERAL ( SELECT sum(pp.amount) AS paid
           FROM patient_payments pp
          WHERE pp.bill_id = b.id) p ON true
  WHERE (b.business_id IN ( SELECT sehat_caller_business_ids() AS sehat_caller_business_ids));

-- ── The invoice at the counter, with GST per line ───────────────────────────
create or replace function sehat_counter_invoice(
  p_business uuid, p_member uuid, p_lines jsonb,
  p_charge_ids uuid[] default '{}',
  p_discount numeric default 0, p_discount_reason text default null, p_round_off numeric default 0,
  p_paid numeric default 0, p_method text default 'cash', p_reference text default null,
  p_recorded_by uuid default null, p_doctor uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_qty numeric;
  v_rate numeric;
  v_gst numeric;
  v_base numeric(12,2);
  v_amt numeric(12,2);
  v_desc text;
  v_cat text;
  v_subtotal numeric(12,2);
  v_net numeric(12,2);
  v_bill uuid;
  v_no text;
  v_token text;
  m record;
  b record;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  if not exists (select 1 from business_patients bp where bp.business_id = p_business and bp.patient_member_id = p_member) then
    raise exception 'Register the patient here first.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 60 then
    raise exception 'An invoice takes up to 60 lines.' using errcode = '22023';
  end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_desc := left(btrim(coalesce(l ->> 'description', '')), 200);
    v_cat := coalesce(nullif(l ->> 'category', ''), 'other');
    v_qty := coalesce(nullif(l ->> 'quantity', '')::numeric, 1);
    v_rate := coalesce(nullif(l ->> 'unit_price', '')::numeric, 0);
    if v_desc = '' then raise exception 'Every line needs to say what it is for.' using errcode = '22023'; end if;
    if v_cat not in ('consultation', 'procedure', 'medicine', 'lab', 'consumable', 'product', 'other') then
      raise exception 'Unknown kind of charge: %', v_cat using errcode = '22023';
    end if;
    if v_qty <= 0 or v_qty > 9999 or v_rate < 0 or v_rate > 9999999 then
      raise exception 'Check the quantity and rate of "%".', v_desc using errcode = '22023';
    end if;
    -- 0226: GST, if the biller charges it on this line, is added to the rate.
    v_gst := coalesce(nullif(l ->> 'gst_rate', '')::numeric, 0);
    if v_gst < 0 or v_gst > 40 then raise exception 'Check the GST rate of "%".', v_desc using errcode = '22023'; end if;
    v_base := round(v_qty * v_rate, 2);
    v_amt := round(v_base * (1 + v_gst / 100), 2);
    insert into patient_charges (business_id, patient_member_id, category, description, quantity, unit_price, amount, gst_rate, tax_amount, recorded_by, practitioner_id)
    values (p_business, p_member, v_cat, v_desc, v_qty, v_rate, v_amt, v_gst, v_amt - v_base, p_recorded_by, p_doctor)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  -- Charges already there, if asked for and still free to bill.
  select v_ids || coalesce(array_agg(c.id), '{}') into v_ids
    from patient_charges c
   where c.id = any(coalesce(p_charge_ids, '{}')) and c.business_id = p_business and c.patient_member_id = p_member
     and c.bill_id is null and c.admission_id is null;

  if cardinality(v_ids) = 0 then
    raise exception 'There is nothing to put on this invoice.' using errcode = '22023';
  end if;

  select coalesce(sum(c.amount), 0) into v_subtotal from patient_charges c where c.id = any(v_ids);
  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > v_subtotal then
    raise exception 'The discount is more than the invoice.' using errcode = '22023';
  end if;
  if coalesce(p_discount, 0) > 0 and btrim(coalesce(p_discount_reason, '')) = '' then
    raise exception 'Say why the discount is given.' using errcode = '22023';
  end if;
  if abs(coalesce(p_round_off, 0)) >= 1 then
    raise exception 'Rounding is less than a rupee.' using errcode = '22023';
  end if;
  v_net := v_subtotal - coalesce(p_discount, 0) + coalesce(p_round_off, 0);
  if coalesce(p_paid, 0) < 0 or coalesce(p_paid, 0) > v_net then
    raise exception 'The payment is more than the invoice (%).', v_net using errcode = '22023';
  end if;

  select mm.full_name, mm.age_years, mm.gender, pa.phone into m
    from patient_members mm join patients pa on pa.id = mm.patient_id where mm.id = p_member;
  select bb.name, bb.address, bb.phone, bb.gstin into b from businesses bb where bb.id = p_business;

  insert into patient_bills (
    bill_no, business_id, patient_member_id, bill_type,
    patient_name, patient_age, patient_gender, patient_phone, mrn,
    clinic_name, clinic_address, clinic_phone, clinic_gstin,
    subtotal, discount_amount, discount_reason, round_off, net_payable, issued_by)
  values (
    sehat_next_bill_number(p_business), p_business, p_member, 'account',
    m.full_name, m.age_years, m.gender, m.phone,
    (select bp.mrn from business_patients bp where bp.patient_member_id = p_member and bp.business_id = p_business),
    b.name, b.address, b.phone, b.gstin,
    v_subtotal, coalesce(p_discount, 0), nullif(btrim(coalesce(p_discount_reason, '')), ''), coalesce(p_round_off, 0), v_net, p_recorded_by)
  returning id, bill_no, public_token::text into v_bill, v_no, v_token;

  insert into patient_bill_items (bill_id, charge_id, category, description, quantity, unit_price, amount, gst_rate, tax_amount, charged_on, sort_order)
  select v_bill, c.id, c.category, c.description, c.quantity, c.unit_price, c.amount, c.gst_rate, c.tax_amount, c.charged_on,
         (row_number() over (order by c.charged_on, c.created_at, c.id))::integer
    from patient_charges c where c.id = any(v_ids);
  update patient_charges set bill_id = v_bill where id = any(v_ids);

  if coalesce(p_paid, 0) > 0 then
    insert into patient_payments (business_id, patient_member_id, amount, method, reference, bill_id, recorded_by)
    values (p_business, p_member, p_paid, coalesce(nullif(p_method, ''), 'cash'), nullif(btrim(coalesce(p_reference, '')), ''), v_bill, p_recorded_by);
  end if;

  return jsonb_build_object('bill_id', v_bill, 'bill_no', v_no, 'token', v_token, 'net', v_net, 'paid', coalesce(p_paid, 0));
end $$;
revoke all on function sehat_counter_invoice(uuid, uuid, jsonb, uuid[], numeric, text, numeric, numeric, text, text, uuid, uuid) from public, anon;
grant execute on function sehat_counter_invoice(uuid, uuid, jsonb, uuid[], numeric, text, numeric, numeric, text, text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
