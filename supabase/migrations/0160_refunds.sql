-- ============================================================================
-- Sehatsandhi — refunding a fee: money handed back, and the fee taken off
--
-- Run AFTER 0159. Depends on nothing from 0141–0157, so 0158–0160 can go to
-- production together on their own. Safe to re-run.
--
-- ── THE CASE ────────────────────────────────────────────────────────────────
-- Reception takes the OPD fee; the doctor then waives it — a relative, a
-- follow-up, a patient who could not afford it — and the money goes back.
-- Or a procedure is not done, or someone paid twice. Until now the only way
-- to undo money was to delete the payment, which erases that it ever came in
-- and leaves the drawer and the tally disagreeing.
--
-- ── HOW ─────────────────────────────────────────────────────────────────────
-- A refund is a patient_payments row with kind = 'refund', a NEGATIVE amount,
-- and refund_of pointing at the payment it gives back. Every total in the
-- system is sum(amount) — the patient's account (0051), a bill's paid and
-- balance (0056), the revenue report's collected (0091), the tally (0159) —
-- so a refund nets out of all of them with no change to any of them. It
-- carries the method it was handed back by, the reason, and (0159) the name
-- of whoever handed it back.
--
-- Money back alone would leave the fee still charged, and the patient
-- showing as owing it again. So a refund can also take the fee off: the
-- charge is reduced through 0133's discount — list price kept, amount
-- lowered, reason "Refunded: …" — which puts it on the discount report as
-- well. A charge already on an issued bill is frozen (0056): the bill has to
-- be cancelled first, and the RPC says so.
--
-- ── WHO ─────────────────────────────────────────────────────────────────────
-- Owner, clinic manager, doctor. Reception can hand the money over, but the
-- decision to give it back is not theirs — and a refund is a direct way to
-- take cash out of the drawer, so it is only an RPC; the insert policy
-- refuses a refund row typed straight into the table.
-- ============================================================================

alter table patient_payments add column if not exists kind text not null default 'payment';
-- Restrict: a payment that has been partly given back cannot be deleted out
-- from under its refund.
alter table patient_payments add column if not exists refund_of uuid references patient_payments(id) on delete restrict;
alter table patient_payments add column if not exists refund_reason text;

do $$
declare c record;
begin
  -- 0051's "amount > 0" becomes: payments are positive, refunds negative.
  for c in select conname from pg_constraint
            where conrelid = 'patient_payments'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ~ '\(amount > '
  loop
    execute format('alter table patient_payments drop constraint %I', c.conname);
  end loop;
end $$;

do $$ begin
  alter table patient_payments add constraint patient_payments_kind_check
    check ((kind = 'payment' and amount > 0 and refund_of is null)
        or (kind = 'refund' and amount < 0 and refund_of is not null and btrim(coalesce(refund_reason, '')) <> ''));
exception when duplicate_object then null; end $$;

create index if not exists patient_payments_refund_of_idx on patient_payments (refund_of) where refund_of is not null;

-- Refunds only through the RPC below.
drop policy if exists "clinic_writes_patient_payments" on patient_payments;
create policy "clinic_writes_patient_payments" on patient_payments for insert
  with check (sehat_caller_owns_business(business_id) and kind = 'payment');

-- p_charge: the fee to take off as well (null = money back only).
create or replace function sehat_refund_payment(
  p_payment uuid,
  p_amount numeric,
  p_method text,
  p_reason text,
  p_charge uuid default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  pay record;
  ch record;
  v_left numeric;
  v_id uuid;
  v_bill text;
begin
  select * into pay from patient_payments where id = p_payment for update;
  if not found or pay.kind <> 'payment' then raise exception 'No such payment.' using errcode = 'P0002'; end if;
  if not (sehat_is_admin() or coalesce(sehat_caller_role(pay.business_id) in ('owner', 'manager', 'doctor'), false)) then
    raise exception 'Only the owner, a manager or a doctor can refund.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why the money is going back — for example, "Doctor waived the fee".' using errcode = '22023';
  end if;

  v_left := pay.amount + coalesce((select sum(amount) from patient_payments where refund_of = p_payment), 0);
  if coalesce(p_amount, 0) <= 0 then raise exception 'Give the amount being refunded.' using errcode = '22023'; end if;
  if p_amount > v_left then
    raise exception 'Only ₹% of this payment is left to refund.', v_left using errcode = '22023';
  end if;
  if coalesce(p_method, '') not in ('cash','upi','credit_card','debit_card','card','netbanking','cheque','insurance','other') then
    raise exception 'Say how the money was given back.' using errcode = '22023';
  end if;

  if p_charge is not null then
    select * into ch from patient_charges where id = p_charge for update;
    if not found or ch.business_id <> pay.business_id or ch.patient_member_id <> pay.patient_member_id then
      raise exception 'That charge is not this patient''s.' using errcode = 'P0002';
    end if;
    if ch.bill_id is not null then
      select bill_no into v_bill from patient_bills where id = ch.bill_id and status = 'issued';
      if found then
        raise exception 'The fee is on bill %. Cancel that bill first, then refund — or refund the money only.', v_bill
          using errcode = 'P0001';
      end if;
    end if;
    if p_amount > ch.amount then
      raise exception 'The fee is only ₹%; refund the rest as money only.', ch.amount using errcode = '22023';
    end if;
    -- 0133's trigger works out the discount from the list price and stamps
    -- who gave it.
    update patient_charges
       set list_price = coalesce(list_price, unit_price),
           amount = amount - round(p_amount, 2),
           -- Keeps a discount already given, and why.
           discount_reason = left(coalesce(nullif(btrim(discount_reason), '') || '; ', '') || 'Refunded: ' || btrim(p_reason), 300)
     where id = p_charge;
  end if;

  insert into patient_payments (business_id, patient_member_id, admission_id, amount, method, reference,
                                received_on, notes, recorded_by, practitioner_id, bill_id,
                                kind, refund_of, refund_reason)
  values (pay.business_id, pay.patient_member_id, pay.admission_id, -round(p_amount, 2), p_method, pay.reference,
          current_date, null, pay.recorded_by, pay.practitioner_id,
          -- Money back on a paid bill shows against that bill.
          pay.bill_id,
          'refund', p_payment, btrim(p_reason))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function sehat_refund_payment(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function sehat_refund_payment(uuid, numeric, text, text, uuid) to authenticated;

-- The tally (0159) shows a refund's reason in place of a reference.
create or replace function sehat_collections(p_business uuid, p_from date, p_to date)
returns table (source text, taken_at timestamptz, taken_on date, amount numeric, method text, reference text,
               taken_by_uid uuid, taken_by_name text, customer_name text, bill_no text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_all boolean := sehat_is_admin() or sehat_caller_is_business(p_business);
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  return query
    select 'clinic'::text, pp.created_at, pp.received_on, pp.amount, pp.method,
           case when pp.kind = 'refund' then 'Refund: ' || pp.refund_reason else pp.reference end,
           pp.received_by_uid, coalesce(pp.received_by_name, 'Not recorded'),
           pm.full_name, pb.bill_no
      from patient_payments pp
      join patient_members pm on pm.id = pp.patient_member_id
      left join patient_bills pb on pb.id = pp.bill_id
     where pp.business_id = p_business and pp.received_on between p_from and p_to
       and (v_all or pp.received_by_uid = auth.uid())
    union all
    select 'pharmacy', ph.received_at, (ph.received_at at time zone 'Asia/Kolkata')::date, ph.amount, ph.method, ph.reference,
           ph.received_by, coalesce(ph.received_by_name, 'Not recorded'), b.customer_name, b.bill_no
      from pharmacy_payments ph join pharmacy_bills b on b.id = ph.bill_id
     where ph.business_id = p_business and ph.received_at >= v_from and ph.received_at < v_to
       and (v_all or ph.received_by = auth.uid())
    union all
    select 'pharmacy', r.created_at, (r.created_at at time zone 'Asia/Kolkata')::date, -r.refund_amount,
           coalesce(r.refund_method, 'cash'), 'Refund' || coalesce(': ' || r.reason, ''),
           r.recorded_by, coalesce(sehat_name_for_uid(r.business_id, r.recorded_by), 'Not recorded'), b.customer_name, b.bill_no
      from pharmacy_returns r join pharmacy_bills b on b.id = r.bill_id
     where r.business_id = p_business and r.refund_amount > 0 and r.created_at >= v_from and r.created_at < v_to
       and (v_all or r.recorded_by = auth.uid())
    order by 2;
end $$;

notify pgrst, 'reload schema';

-- ── NOT HERE ────────────────────────────────────────────────────────────────
-- • Refunding a pharmacy bill: that is a return or a cancellation (0158).
-- • Refunding against a charge on an issued bill in one step. Cancelling the
--   bill first keeps the numbered document and the money in agreement.
