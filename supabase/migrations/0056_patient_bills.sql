-- ============================================================================
-- Sehatsandhi — the bill the patient is actually handed
--
-- Run AFTER 0055. Safe to re-run.
--
-- ── WHY A LEDGER WAS NOT ENOUGH ─────────────────────────────────────────────
-- 0051 records charges and payments, and patient_account computes a balance.
-- That answers "what does this patient owe", which is the front desk's
-- question. It does not answer the patient's question, which is "what am I
-- paying for, and can I have that in writing".
--
-- A patient leaving after a six-day admission cannot currently be handed
-- anything. They need a numbered, itemised document — to check the arithmetic
-- at the desk, to argue with it, and above all to submit it to an insurer,
-- who will not reimburse against a screen.
--
-- ── SNAPSHOTTED BECAUSE CHARGES ARE DELETABLE ───────────────────────────────
-- 0051 deliberately lets a clinic delete a charge line typed wrong in front of
-- a patient. That is right for an unbilled line and fatal for a billed one: a
-- bill computed live from patient_charges would silently change its own total
-- after being printed and filed with a TPA.
--
-- So the lines are COPIED onto the bill at issue, and the charges they came
-- from are stamped with the bill id and frozen. Two different protections:
-- the copy means the document cannot change, the stamp means the same charge
-- cannot be billed twice.
--
-- ── STILL NO GST ────────────────────────────────────────────────────────────
-- The header of 0051 explains why, and issuing a document changes none of it.
-- Clinical services are exempt, medicines are not, and the two often sit under
-- two registrations. This prints what was charged and what was paid. A clinic
-- needing a tax invoice for its pharmacy raises it where it does today.
-- The clinic's GSTIN is snapshotted only because a document with a business's
-- name on it is expected to carry it.
-- ============================================================================


-- ============================================================================
-- 1. Numbering
-- ============================================================================

create table if not exists bill_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  fy text not null,
  last_number integer not null default 0,
  primary key (business_id, fy)
);

create or replace function sehat_next_bill_number(p_business uuid, p_date date default current_date)
returns text language plpgsql security definer set search_path = public as $$
declare v_fy text; v_n integer;
begin
  v_fy := sehat_financial_year(p_date);
  insert into bill_counters (business_id, fy, last_number)
  values (p_business, v_fy, 0) on conflict (business_id, fy) do nothing;
  select last_number + 1 into v_n from bill_counters
   where business_id = p_business and fy = v_fy for update;
  update bill_counters set last_number = v_n
   where business_id = p_business and fy = v_fy;
  return 'BILL/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;


-- ============================================================================
-- 2. The bill
-- ============================================================================

create table if not exists patient_bills (
  id uuid primary key default gen_random_uuid(),
  bill_no text not null,

  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  -- What it settles. An IPD final bill names the stay; an OPD bill names the
  -- visit; a bill for neither is an account settlement across whatever was
  -- outstanding. All nullable: the document outlives the encounter.
  admission_id uuid references admissions(id) on delete set null,
  visit_id uuid references patient_visits(id) on delete set null,

  bill_type text not null default 'opd'
    check (bill_type in ('opd','ipd','account')),

  -- Snapshots.
  patient_name text not null,
  patient_age integer,
  patient_gender text,
  patient_phone text,
  mrn text,
  clinic_name text,
  clinic_address text,
  clinic_phone text,
  clinic_gstin text,
  admission_no text,
  admitted_at timestamptz,
  discharged_at timestamptz,

  -- Money. numeric(12,2) throughout, for the reason 0051 gives.
  subtotal numeric(12,2) not null default 0,
  -- Concessions are ordinary here — a camp rate, a staff relative, a hardship
  -- write-off agreed at the desk. Recorded with its reason because an
  -- unexplained discount on a filed document is what an audit asks about.
  discount_amount numeric(12,2) not null default 0,
  discount_reason text,
  -- Charges land on paise; bills are settled in rupees. Kept as its own line
  -- so the total is never a sum that does not add up.
  round_off numeric(12,2) not null default 0,
  net_payable numeric(12,2) not null default 0,

  issued_at timestamptz not null default now(),
  issued_by uuid references practitioners(id) on delete set null,

  status text not null default 'issued' check (status in ('issued','cancelled','superseded')),
  supersedes uuid references patient_bills(id) on delete set null,
  superseded_by uuid references patient_bills(id) on delete set null,
  cancelled_reason text,

  public_token uuid not null default gen_random_uuid(),
  -- A year. Insurance reimbursement runs for months and a patient asked for
  -- "the bill again" long after discharge is the normal case, not the odd one.
  token_expires_at timestamptz not null default now() + interval '1 year',

  sent_at timestamptz,
  sent_channels text[] default '{}',
  send_error text,

  created_at timestamptz not null default now(),

  constraint patient_bills_amounts_sane check (
    subtotal >= 0 and discount_amount >= 0 and net_payable >= 0
  ),
  -- A discount nobody can explain is the one an auditor stops on.
  constraint patient_bills_discount_reason check (
    discount_amount = 0 or coalesce(btrim(discount_reason), '') <> ''
  )
);

create unique index if not exists patient_bills_token_idx on patient_bills (public_token);
create unique index if not exists patient_bills_no_idx on patient_bills (business_id, bill_no);
create index if not exists patient_bills_patient_idx
  on patient_bills (patient_member_id, business_id, issued_at desc);
create index if not exists patient_bills_admission_idx
  on patient_bills (admission_id) where admission_id is not null;

-- One live bill per stay. A second final bill for the same admission is a
-- correction, which supersedes; two issued at once is a double claim.
create unique index if not exists patient_bills_one_live_per_admission
  on patient_bills (admission_id) where admission_id is not null and status = 'issued';

comment on table patient_bills is
  'The itemised, numbered document a patient is handed and submits to an '
  'insurer. Lines are copied from patient_charges at issue rather than read '
  'live, because charges stay deletable and a filed bill must not change.';


create table if not exists patient_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references patient_bills(id) on delete cascade,
  -- Where the line came from. Set null rather than cascade: the copy on the
  -- bill is the record now, and deleting the original must not blank the bill.
  charge_id uuid references patient_charges(id) on delete set null,

  category text not null default 'other',
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  amount numeric(12,2) not null,
  charged_on date,
  sort_order integer not null default 0
);

create index if not exists patient_bill_items_bill_idx
  on patient_bill_items (bill_id, sort_order);


-- Status may move; money and identity may not.
create or replace function sehat_patient_bill_is_immutable()
returns trigger language plpgsql as $$
begin
  if new.bill_no         is distinct from old.bill_no
  or new.business_id     is distinct from old.business_id
  or new.patient_name    is distinct from old.patient_name
  or new.subtotal        is distinct from old.subtotal
  or new.discount_amount is distinct from old.discount_amount
  or new.round_off       is distinct from old.round_off
  or new.net_payable     is distinct from old.net_payable
  or new.issued_at       is distinct from old.issued_at
  then
    raise exception
      'a bill cannot be edited once issued — cancel it, or issue a corrected bill that supersedes it'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists patient_bills_immutable on patient_bills;
create trigger patient_bills_immutable before update on patient_bills
  for each row execute function sehat_patient_bill_is_immutable();


-- ============================================================================
-- 3. Stamping the charges and the payments
--
-- Both directions of the same idea: a charge already on a bill cannot be
-- billed again, and a payment taken for a stay belongs to that stay's bill
-- even though it arrived before the bill existed.
-- ============================================================================

alter table patient_charges  add column if not exists bill_id uuid references patient_bills(id) on delete set null;
alter table patient_payments add column if not exists bill_id uuid references patient_bills(id) on delete set null;

create index if not exists patient_charges_unbilled_idx
  on patient_charges (patient_member_id, business_id) where bill_id is null;
create index if not exists patient_payments_bill_idx
  on patient_payments (bill_id) where bill_id is not null;

comment on column patient_charges.bill_id is
  'The issued bill this line was copied onto. Non-null means frozen: 0051 lets '
  'a clinic delete a mistyped charge, and that has to stop the moment the line '
  'is printed on a numbered document somebody filed with a TPA.';

-- The freeze. 0051's delete policy is right for a line nobody has been shown
-- and wrong for a line on an issued bill; this draws that boundary in the one
-- place it cannot be forgotten.
create or replace function sehat_billed_charge_is_frozen()
returns trigger language plpgsql as $$
declare v_no text;
begin
  if old.bill_id is not null then
    select bill_no into v_no from patient_bills
     where id = old.bill_id and status = 'issued';

    -- Releasing the line is how a cancellation or a correction unwinds, and is
    -- the one change an issued bill permits.
    if found and not (tg_op = 'UPDATE' and new.bill_id is null) then
      raise exception
        'this charge is on bill % — cancel that bill before changing it', v_no
        using errcode = 'check_violation';
    end if;
  end if;

  -- A BEFORE DELETE trigger must return OLD; returning NULL would silently
  -- swallow the delete.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists patient_charges_frozen_when_billed on patient_charges;
create trigger patient_charges_frozen_when_billed
  before update or delete on patient_charges
  for each row execute function sehat_billed_charge_is_frozen();


-- ============================================================================
-- 4. Issuing a bill
--
-- Takes whatever is unbilled for the scope asked for, copies it, totals it,
-- and stamps the originals — in one transaction, because a bill numbered from
-- a serialised counter with no lines under it is a gap in the series somebody
-- has to explain.
-- ============================================================================

create or replace function sehat_issue_patient_bill(
  p_patient_member_id uuid,
  p_business_id uuid,
  p_admission_id uuid default null,
  p_visit_id uuid default null,
  p_discount numeric default 0,
  p_discount_reason text default null,
  p_round_off numeric default 0,
  p_issued_by uuid default null,
  p_supersedes uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
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
    charged_on, sort_order
  )
  select v_id, c.id, c.category, c.description, c.quantity, c.unit_price, c.amount,
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
end $$;

comment on function sehat_issue_patient_bill is
  'Copies every unbilled charge in scope onto a numbered bill, totals it, and '
  'freezes the originals — one transaction, because a numbered bill with no '
  'lines is a gap in the series. Refuses when there is nothing to bill.';


-- ============================================================================
-- 5. Cancelling one
--
-- Releases the charges so they can be billed again. Order matters: the bill
-- stops being 'issued' first, which is what lets the freeze trigger let go.
-- ============================================================================

create or replace function sehat_cancel_patient_bill(p_bill_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from patient_bills where id = p_bill_id;
  if not found then raise exception 'no such bill'; end if;
  if not sehat_caller_owns_business(v_biz) then raise exception 'not your business'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why the bill is being cancelled';
  end if;

  update patient_bills
     set status = 'cancelled', cancelled_reason = p_reason
   where id = p_bill_id;

  update patient_charges  set bill_id = null where bill_id = p_bill_id;
  update patient_payments set bill_id = null where bill_id = p_bill_id;
end $$;


-- ============================================================================
-- 6. Re-posting bed charges around an issued bill
--
-- 0051's sehat_post_bed_charges deletes its own previous line before writing a
-- new one. Once that line is on an issued bill the freeze trigger stops it —
-- correctly, but with an error about a charge when the caller asked about a
-- bed. Replaced here so it only clears what it may clear, and says plainly
-- what to do when it may not.
-- ============================================================================

create or replace function sehat_post_bed_charges(p_admission_id uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_biz uuid;
  v_member uuid;
  v_end timestamptz;
  v_total numeric(12,2) := 0;
  s record;
  v_days integer;
  v_line numeric(12,2);
  v_billed text;
begin
  select a.business_id, a.patient_member_id, coalesce(a.discharged_at, now())
    into v_biz, v_member, v_end
    from admissions a where a.id = p_admission_id;
  if not found then raise exception 'no such admission'; end if;
  if not sehat_caller_owns_business(v_biz) then raise exception 'not your business'; end if;

  -- NEW IN 0056. Everything below this block is 0053's, unchanged: the rate is
  -- the one snapshotted when the patient moved into that bed, never the bed's
  -- current rate, so re-posting after a price rise does not re-price a stay
  -- that already happened.
  select b.bill_no into v_billed
    from patient_charges c
    join patient_bills b on b.id = c.bill_id and b.status = 'issued'
   where c.admission_id = p_admission_id and c.category = 'bed'
   limit 1;

  if v_billed is not null then
    raise exception
      'the bed charge for this stay is already on bill % — cancel that bill before re-posting', v_billed
      using errcode = 'check_violation';
  end if;

  -- Replace this stay's bed lines rather than adding to them, so a re-run after
  -- a transfer or a late discharge corrects the bill instead of doubling it.
  -- Only the unbilled ones: anything already on a document is not ours to
  -- rewrite, and the guard above has established there are none.
  delete from patient_charges
   where admission_id = p_admission_id and category = 'bed' and bill_id is null;

  for s in
    select bs.*, coalesce(bs.to_at, v_end) as ended_at
      from admission_bed_stays bs
     where bs.admission_id = p_admission_id
     order by bs.from_at
  loop
    continue when coalesce(s.daily_charge_snapshot, 0) = 0;

    -- A part day is a day: a bed occupied from 11pm to 9am has been used, and
    -- every hospital charges it. Applied per period, so two half-days across a
    -- transfer are two days — which is what the wards actually did.
    v_days := greatest(1, ceil(extract(epoch from s.ended_at - s.from_at) / 86400.0)::integer);
    v_line := v_days * s.daily_charge_snapshot;
    v_total := v_total + v_line;

    insert into patient_charges (
      business_id, patient_member_id, admission_id, category, description,
      quantity, unit_price, amount, charged_on
    ) values (
      v_biz, v_member, p_admission_id, 'bed',
      coalesce(nullif(concat_ws(' / ', s.ward_name, 'bed ' || s.bed_label), ''), 'Bed')
        || ' — ' || v_days || ' day' || case when v_days = 1 then '' else 's' end,
      v_days, s.daily_charge_snapshot, v_line,
      coalesce(s.ended_at::date, current_date)
    );
  end loop;

  return v_total;
end $$;

comment on function sehat_post_bed_charges is
  'Posts one bed line per period of the stay, from admission_bed_stays and the '
  'rate snapshotted when the patient moved in. Clears only its own unbilled '
  'lines, and refuses outright once the bed charge is on an issued bill.';


-- ============================================================================
-- 7. Reading it back
-- ============================================================================

create or replace view patient_bill_detail as
  select
    b.*,
    coalesce(p.paid, 0) as paid,
    b.net_payable - coalesce(p.paid, 0) as balance_due,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'category', i.category, 'description', i.description,
        'quantity', i.quantity, 'unit_price', i.unit_price,
        'amount', i.amount, 'charged_on', i.charged_on) order by i.sort_order), '[]'::jsonb)
       from patient_bill_items i where i.bill_id = b.id) as items
  from patient_bills b
  left join lateral (
    select sum(pp.amount) as paid from patient_payments pp where pp.bill_id = b.id
  ) p on true
 where b.business_id in (select sehat_caller_business_ids());

comment on view patient_bill_detail is
  'A bill with its lines and what has been paid against it. The total is '
  'snapshotted and never moves; paid and balance_due are live, because a '
  'patient settling next week should see it.';

-- What is still owed on issued bills. Narrower than business_outstanding,
-- which counts every unbilled charge too — this is money the patient has
-- actually been asked for in writing.
create or replace view business_bills_outstanding as
  select business_id, id as bill_id, bill_no, patient_member_id, patient_name,
         bill_type, issued_at, net_payable, paid, balance_due
    from patient_bill_detail
   where status = 'issued' and balance_due > 0;


-- ============================================================================
-- 8. RLS
-- ============================================================================

alter table patient_bills      enable row level security;
alter table patient_bill_items enable row level security;
alter table bill_counters      enable row level security;

drop policy if exists "clinic_reads_patient_bills" on patient_bills;
create policy "clinic_reads_patient_bills" on patient_bills
  for select using (sehat_caller_owns_business(business_id));

-- No insert policy: issuing goes through the RPC, which numbers the bill,
-- copies the lines and freezes the charges. A direct insert skips all three.
--
-- And no update policy either, which is a change of habit from the tables
-- around this one. Cancelling a bill is not a status change, it is a status
-- change PLUS releasing every charge and payment stamped with it. A clinic
-- able to write the status directly could cancel a bill and leave its charges
-- frozen to a bill that no longer exists, unbillable forever with nothing on
-- screen to explain why. sehat_cancel_patient_bill does both halves.
drop policy if exists "clinic_updates_patient_bills" on patient_bills;

drop policy if exists "clinic_reads_bill_items" on patient_bill_items;
create policy "clinic_reads_bill_items" on patient_bill_items
  for select using (exists (
    select 1 from patient_bills b
     where b.id = patient_bill_items.bill_id and sehat_caller_owns_business(b.business_id)
  ));

drop policy if exists "admins_read_bill_counters" on bill_counters;
create policy "admins_read_bill_counters" on bill_counters
  for select using (sehat_is_admin());

grant select on patient_bill_detail, business_bills_outstanding to authenticated;
grant execute on function sehat_issue_patient_bill(uuid, uuid, uuid, uuid, numeric, text, numeric, uuid, uuid) to authenticated;
grant execute on function sehat_cancel_patient_bill(uuid, text) to authenticated;

revoke all on function sehat_issue_patient_bill(uuid, uuid, uuid, uuid, numeric, text, numeric, uuid, uuid) from anon;
revoke all on function sehat_cancel_patient_bill(uuid, text) from anon;
revoke all on function sehat_next_bill_number(uuid, date) from anon, authenticated;
