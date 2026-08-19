-- ============================================================================
-- Sehatsandhi — what a patient was charged, and what they have paid
--
-- Run AFTER 0050. Safe to re-run.
--
-- ── THIS IS NOT THE INVOICES TABLE, AND MUST NEVER BECOME IT ────────────────
-- `invoices`, `payments` and the whole GST apparatus from 0007 bill BUSINESSES
-- for their Sehatsandhi listing. That is our revenue, raised under our GSTIN,
-- on our statutory numbering series.
--
-- This is a different flow entirely: a clinic charging a patient. Different
-- payer, different payee, different tax treatment, money that is never ours.
-- Putting both in one table would pool clinic takings with platform revenue and
-- run our GST machinery over consultations it has no business touching — and
-- the merge would be very hard to unpick once a year of rows existed.
--
-- ── WHY numeric AND NOT integer ─────────────────────────────────────────────
-- Every other amount in this schema is an integer of rupees, and prices we set
-- are whole rupees. A clinic's own prices are not: a strip of tablets is ₹12.50
-- and a bill that cannot hold it will be wrong by rounding on every line. So
-- these columns are numeric(12,2), deliberately unlike their neighbours.
--
-- ── NO GST HERE, ON PURPOSE ─────────────────────────────────────────────────
-- Healthcare services provided by a clinical establishment are exempt in India,
-- while medicines sold across a counter are not, and the two often sit on one
-- bill under two different registrations. Getting that wrong prints a document
-- somebody files. A clinic that needs a tax invoice for medicines raises it in
-- whatever they use for the pharmacy today; this records what the patient owes
-- and what they paid, which is the question the doctor actually asked for.
-- ============================================================================


-- ============================================================================
-- 1. Charges — one row per line on the bill
-- ============================================================================

create table if not exists patient_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,

  -- What this charge was for. Both nullable and both set null on delete: a
  -- charge outlives the encounter it came from, because the money was still
  -- taken.
  visit_id uuid references patient_visits(id) on delete set null,
  admission_id uuid references admissions(id) on delete set null,

  category text not null default 'other'
    check (category in ('consultation','bed','procedure','medicine','lab','consumable','other')),
  description text not null,

  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  -- Stored, not computed on read: a clinic may discount a line, and the total
  -- has to be what was actually charged rather than what the arithmetic says.
  amount numeric(12,2) not null,

  charged_on date not null default current_date,
  notes text,
  recorded_by uuid references practitioners(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint patient_charges_amount_sane check (amount >= 0)
);

create index if not exists patient_charges_patient_idx
  on patient_charges (patient_member_id, business_id, charged_on desc);
create index if not exists patient_charges_admission_idx
  on patient_charges (admission_id) where admission_id is not null;

comment on column patient_charges.amount is
  'What was actually charged for this line. Not derived from quantity × '
  'unit_price on read: a clinic discounts lines, and the bill must say what was '
  'taken rather than what the multiplication implies.';


-- ============================================================================
-- 2. Payments — money actually received
-- ============================================================================

create table if not exists patient_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  admission_id uuid references admissions(id) on delete set null,

  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'cash'
    check (method in ('cash','upi','card','netbanking','cheque','insurance','other')),
  -- UPI reference, cheque number, TPA claim id — whatever proves it arrived.
  reference text,
  received_on date not null default current_date,
  notes text,
  recorded_by uuid references practitioners(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists patient_payments_patient_idx
  on patient_payments (patient_member_id, business_id, received_on desc);

comment on table patient_payments is
  'Money the clinic received from a patient. Never refers to razorpay: that is '
  'the platform being paid for a listing, which is a different flow with a '
  'different payer.';


-- ============================================================================
-- 3. Bed days, computed rather than typed
--
-- beds.daily_charge exists so this can be worked out instead of counted on
-- fingers at discharge. Idempotent: it replaces any bed charge it previously
-- posted for the same stay, so running it twice does not bill twice — which is
-- the failure that turns a billing feature into a complaint.
-- ============================================================================

create or replace function sehat_post_bed_charges(p_admission_id uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_days integer;
  v_rate numeric(12,2);
  v_total numeric(12,2);
begin
  select a.*, b.daily_charge, b.label, w.name as ward_name
    into v
    from admissions a
    left join beds b on b.id = a.bed_id
    left join wards w on w.id = b.ward_id
   where a.id = p_admission_id;

  if not found then raise exception 'no such admission'; end if;
  if not sehat_caller_owns_business(v.business_id) then raise exception 'not your business'; end if;

  v_rate := coalesce(v.daily_charge, 0);
  if v_rate = 0 then
    return 0;   -- no rate set on the bed; nothing to post, and not an error
  end if;

  -- A part day is a day: hospitals charge by nights occupied, and a patient
  -- admitted at 11pm and discharged at 9am has used a bed.
  v_days := greatest(1, ceil(extract(epoch from
              coalesce(v.discharged_at, now()) - v.admitted_at) / 86400.0)::integer);
  v_total := v_days * v_rate;

  delete from patient_charges
   where admission_id = p_admission_id and category = 'bed';

  insert into patient_charges (
    business_id, patient_member_id, admission_id, category, description,
    quantity, unit_price, amount, charged_on
  ) values (
    v.business_id, v.patient_member_id, p_admission_id, 'bed',
    coalesce(v.ward_name || ' / bed ' || v.label, 'Bed') || ' — ' || v_days || ' day' ||
      case when v_days = 1 then '' else 's' end,
    v_days, v_rate, v_total,
    coalesce(v.discharged_at::date, current_date)
  );

  return v_total;
end $$;

comment on function sehat_post_bed_charges is
  'Posts (or re-posts) the bed charge for one stay from beds.daily_charge and '
  'nights occupied. Deletes its own previous line first, so calling it again '
  'after a bed move or a late discharge corrects the bill instead of doubling '
  'it.';


-- ============================================================================
-- 4. What the patient owes
-- ============================================================================

create or replace view patient_account as
  select
    bp.business_id,
    bp.patient_member_id,
    m.full_name as patient_name,
    coalesce(ch.total, 0)  as charged,
    coalesce(pay.total, 0) as paid,
    coalesce(ch.total, 0) - coalesce(pay.total, 0) as balance,
    ch.last_charged,
    pay.last_paid
  from business_patients bp
  join patient_members m on m.id = bp.patient_member_id
  left join lateral (
    select sum(c.amount) as total, max(c.charged_on) as last_charged
      from patient_charges c
     where c.patient_member_id = bp.patient_member_id and c.business_id = bp.business_id
  ) ch on true
  left join lateral (
    select sum(p.amount) as total, max(p.received_on) as last_paid
      from patient_payments p
     where p.patient_member_id = bp.patient_member_id and p.business_id = bp.business_id
  ) pay on true
 where bp.business_id in (select sehat_caller_business_ids());

comment on view patient_account is
  'Charged, paid and the difference, per patient per clinic. A positive balance '
  'is money owed to the clinic; a negative one is an advance not yet used, '
  'which is ordinary for an admission.';

-- What a clinic is owed in total, and by whom. The list a front desk works
-- from at the end of a day.
create or replace view business_outstanding as
  select business_id, patient_member_id, patient_name, charged, paid, balance, last_paid
    from patient_account
   where balance > 0;

grant select on patient_account, business_outstanding to authenticated;


-- ============================================================================
-- 5. RLS
-- ============================================================================

alter table patient_charges  enable row level security;
alter table patient_payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['patient_charges','patient_payments'] loop
    execute format('drop policy if exists "clinic_reads_%1$s" on %1$I', t);
    execute format('create policy "clinic_reads_%1$s" on %1$I for select using (sehat_caller_owns_business(business_id))', t);
    execute format('drop policy if exists "clinic_writes_%1$s" on %1$I', t);
    execute format('create policy "clinic_writes_%1$s" on %1$I for insert with check (sehat_caller_owns_business(business_id))', t);
    execute format('drop policy if exists "clinic_updates_%1$s" on %1$I', t);
    execute format('create policy "clinic_updates_%1$s" on %1$I for update using (sehat_caller_owns_business(business_id)) with check (sehat_caller_owns_business(business_id))', t);
    -- A line typed wrong on a bill in front of a patient has to be removable.
    -- Unlike a clinical note, a charge is not evidence of anything clinical.
    execute format('drop policy if exists "clinic_removes_%1$s" on %1$I', t);
    execute format('create policy "clinic_removes_%1$s" on %1$I for delete using (sehat_caller_owns_business(business_id))', t);
  end loop;
end $$;

grant execute on function sehat_post_bed_charges(uuid) to authenticated;
revoke all on function sehat_post_bed_charges(uuid) from anon;


-- ============================================================================
-- NOT HERE
--   GST on a patient bill — see the header. Exempt for clinical services,
--     not for medicines, and often two registrations on one document.
--   Insurance and TPA claims: a claim is a workflow with its own states, not
--     a payment method, and patient_payments.method='insurance' is a
--     placeholder for the money arriving rather than a model of the claim.
--   Package rates, itemised pharmacy stock, and anything resembling inventory.
-- ============================================================================
