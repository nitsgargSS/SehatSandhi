-- ============================================================================
-- Sehatsandhi — every payment says how it was paid and who took it
--
-- Run AFTER 0158 (in-house dispensing). Depends on nothing from 0141–0157, so
-- 0158 + 0159 can go to production together on their own. Safe to re-run.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- At closing, a clinic counts the cash drawer and checks the UPI and card
-- machine totals against what was billed. That needs, for every rupee taken —
-- OPD, IPD, account and pharmacy alike — how it was paid and WHO took it.
--
--   • Methods: 'card' becomes credit card and debit card, which settle to the
--     bank separately and are checked against different slips. Old 'card' rows
--     keep their value and are shown as "Card".
--   • Who: patient_payments.recorded_by is a practitioner id the screen passes
--     in, blank for an owner or a receptionist with no practitioner row. So the
--     database now stamps the signed-in person's uid and name itself, on every
--     insert, whichever screen it came from. The pharmacy already does (0158).
--   • A tally that anyone can quietly edit is not a tally. Changing or
--     deleting a clinic payment is now owner/manager only, and every change or
--     deletion is kept in payment_changes with who did it.
--   • sehat_collections: every payment in a date range, from both counters,
--     with method and taker. Owner and manager see everyone's; everyone else
--     sees only what they took themselves — enough to hand over their cash.
-- ============================================================================


-- ============================================================================
-- 1. Methods
-- ============================================================================

do $$
declare c record;
begin
  for c in select conrelid::regclass as t, conname from pg_constraint
            where conrelid in ('patient_payments'::regclass, 'pharmacy_payments'::regclass)
              and contype = 'c' and pg_get_constraintdef(oid) like '%method%'
  loop
    execute format('alter table %s drop constraint %I', c.t, c.conname);
  end loop;
end $$;

alter table patient_payments add constraint patient_payments_method_check
  check (method in ('cash','upi','credit_card','debit_card','card','netbanking','cheque','insurance','other'));
alter table pharmacy_payments add constraint pharmacy_payments_method_check
  check (method in ('cash','upi','credit_card','debit_card','card','netbanking','cheque','other'));

-- Refund methods on pharmacy returns follow suit.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'pharmacy_returns'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%refund_method%'
  loop
    execute format('alter table pharmacy_returns drop constraint %I', c.conname);
  end loop;
end $$;
alter table pharmacy_returns add constraint pharmacy_returns_refund_method_check
  check (refund_method is null or refund_method in ('cash','upi','credit_card','debit_card','card','netbanking','cheque','other'));


-- ============================================================================
-- 2. Who took it
-- ============================================================================

-- The signed-in person's name at this clinic. Same answer as 0158's
-- sehat_pharmacy_staff_name, which now just calls this.
create or replace function sehat_caller_staff_name(p_business uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.full_name from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
      where bp.business_id = p_business and p.auth_uid = auth.uid() limit 1),
    (select 'Owner' from businesses b where b.id = p_business and b.auth_uid = auth.uid()),
    (select 'Sehatsandhi: ' || email from auth.users where id = auth.uid()),
    'Unknown');
$$;
revoke all on function sehat_caller_staff_name(uuid) from public, anon;
grant execute on function sehat_caller_staff_name(uuid) to authenticated;

create or replace function sehat_pharmacy_staff_name(p_business uuid)
returns text language sql stable security definer set search_path = public as $$
  select sehat_caller_staff_name(p_business);
$$;

alter table patient_payments add column if not exists received_by_uid uuid;
alter table patient_payments add column if not exists received_by_name text;
alter table pharmacy_payments add column if not exists received_by_name text;

-- Stamped by the database, not trusted from the screen, and never rewritten.
create or replace function sehat_payment_takes_its_taker()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.received_by_uid := auth.uid();
      new.received_by_name := sehat_caller_staff_name(new.business_id);
    end if;
  else
    new.received_by_uid := old.received_by_uid;
    new.received_by_name := old.received_by_name;
  end if;
  return new;
end $$;

drop trigger if exists a_payment_takes_its_taker on patient_payments;
create trigger a_payment_takes_its_taker before insert or update on patient_payments
  for each row execute function sehat_payment_takes_its_taker();

-- Old rows: the practitioner the screen named, where there was one.
update patient_payments pp
   set received_by_name = p.full_name
  from practitioners p
 where p.id = pp.recorded_by and pp.received_by_name is null;


-- ============================================================================
-- 3. Changing or deleting a payment: owner/manager only, and kept
-- ============================================================================

create table if not exists payment_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  payment_id uuid not null,
  action text not null check (action in ('changed', 'deleted')),
  before jsonb not null,
  after jsonb,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists payment_changes_business_idx on payment_changes (business_id, changed_at desc);

create or replace function sehat_payment_change_is_kept()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into payment_changes (business_id, payment_id, action, before, changed_by, changed_by_name)
    values (old.business_id, old.id, 'deleted', to_jsonb(old), auth.uid(), sehat_caller_staff_name(old.business_id));
    return old;
  end if;
  -- Stamping a bill id on it (0056) is bookkeeping, not a change to the money.
  if (new.amount, new.method, new.reference, new.received_on, new.patient_member_id)
     is distinct from (old.amount, old.method, old.reference, old.received_on, old.patient_member_id) then
    insert into payment_changes (business_id, payment_id, action, before, after, changed_by, changed_by_name)
    values (old.business_id, old.id, 'changed', to_jsonb(old), to_jsonb(new), auth.uid(), sehat_caller_staff_name(old.business_id));
  end if;
  return new;
end $$;

drop trigger if exists z_payment_change_is_kept on patient_payments;
create trigger z_payment_change_is_kept after update or delete on patient_payments
  for each row execute function sehat_payment_change_is_kept();

drop policy if exists "clinic_updates_patient_payments" on patient_payments;
create policy "clinic_updates_patient_payments" on patient_payments for update
  using (sehat_is_admin() or sehat_caller_is_business(business_id))
  with check (sehat_is_admin() or sehat_caller_is_business(business_id));
drop policy if exists "clinic_removes_patient_payments" on patient_payments;
create policy "clinic_removes_patient_payments" on patient_payments for delete
  using (sehat_is_admin() or sehat_caller_is_business(business_id));

alter table payment_changes enable row level security;
drop policy if exists "clinic_reads_payment_changes" on payment_changes;
create policy "clinic_reads_payment_changes" on payment_changes for select
  using (sehat_is_admin() or sehat_caller_is_business(business_id));
grant select on payment_changes to authenticated;
revoke insert, update, delete on payment_changes from anon, authenticated;


-- ============================================================================
-- 4. The tally
-- ============================================================================

-- Every payment taken between two dates (Indian days), OPD/IPD/account and
-- pharmacy together, refunds as negative rows. Owner/manager: everyone's.
-- Anyone else: only their own.
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
    select 'clinic'::text, pp.created_at, pp.received_on, pp.amount, pp.method, pp.reference,
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

-- A stored uid's name, for rows that were not stamped with one (refunds).
create or replace function sehat_name_for_uid(p_business uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.full_name from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
      where bp.business_id = p_business and p.auth_uid = p_uid limit 1),
    (select 'Owner' from businesses b where b.id = p_business and b.auth_uid = p_uid),
    (select 'Sehatsandhi: ' || email from auth.users where id = p_uid));
$$;
revoke all on function sehat_name_for_uid(uuid, uuid) from public, anon, authenticated;

revoke all on function sehat_collections(uuid, date, date) from public, anon;
grant execute on function sehat_collections(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';

-- ── NOT HERE ────────────────────────────────────────────────────────────────
-- • Closing the day (a signed-off cash count per person). The report gives the
--   figure to count against; recording the count is a later step.
-- • Changing patient_payments.recorded_by. It stays whatever practitioner the
--   screen passed in; who took the money is received_by_*.
