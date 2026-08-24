-- ============================================================================
-- Sehatsandhi — OPD and IPD are separately bought modules, and the term is a month
--
-- Run AFTER 0059. Safe to re-run.
--
-- Two changes that arrived together because they are the same decision:
-- what a business buys, and for how long.
--
-- ── ONE MONTH, ALWAYS ───────────────────────────────────────────────────────
-- The plans allowed 1–12 months upfront and the wizard drew a row of term
-- buttons for it. That is gone: everything is monthly. The columns stay
-- (period_months, months_paid, term_start/term_end are load-bearing for
-- renewals and invoices) but min/max/default are pinned to 1, so the clamp in
-- clampMonths can only ever return one month however the client asks.
--
-- Pinned rather than dropped on purpose. If a yearly term is ever wanted again
-- it is three numbers in a row of this table, not a schema change and a
-- re-plumbing of invoices.
--
-- ── OPD AND IPD ARE THINGS YOU BUY ──────────────────────────────────────────
-- Until now a listing was a listing: pay for coverage and get the whole
-- dashboard. The clinical systems built in 0047-0058 are worth more than the
-- listing and cost more to run, so they are bought separately and each one a
-- business has not paid for stays switched off.
--
-- ── PER BUSINESS, NOT PER DOCTOR ────────────────────────────────────────────
-- The coverage fee multiplies by consultant headcount for a hospital. These do
-- NOT, and that is deliberate: a ward management system is one system whether
-- three doctors use it or nine. Multiplying would price a nine-consultant
-- hospital at ninety thousand a month for IPD, which is not a price, it is a
-- refusal. The module total is added after applyHeadcount for exactly this
-- reason — see _shared/pricing.ts.
-- ============================================================================


-- ============================================================================
-- 1. What can be bought
-- ============================================================================

create table if not exists care_modules (
  code text primary key,
  label text not null,
  description text,
  -- Whole rupees, like every other price we set. Clinics' own prices carry
  -- paise; ours never have.
  monthly_price integer not null check (monthly_price >= 0),
  sequence integer not null default 100,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table care_modules is
  'Clinical systems a business buys on top of its listing, priced per month per '
  'business. Never multiplied by consultant headcount: a ward system is one '
  'system whatever the size of the roster.';

insert into care_modules (code, label, description, monthly_price, sequence) values
  ('opd', 'OPD system',
   'Token queue, patient records, prescriptions and consultation notes for outpatients.',
   5000, 10),
  ('ipd', 'IPD system',
   'Admissions, ward and bed management, ward notes, discharge summaries and inpatient billing.',
   10000, 20)
on conflict (code) do update
  set label = excluded.label,
      description = excluded.description,
      monthly_price = excluded.monthly_price,
      sequence = excluded.sequence,
      updated_at = now();

alter table care_modules enable row level security;

-- Readable by anyone: the price has to render on the public pricing page and in
-- the signup wizard before there is a session. Writable only by admins, through
-- the admin panel — the same shape as pricing_plans.
drop policy if exists care_modules_public_read on care_modules;
create policy care_modules_public_read on care_modules
  for select using (true);

drop policy if exists care_modules_admin_all on care_modules;
create policy care_modules_admin_all on care_modules
  using (sehat_is_admin()) with check (sehat_is_admin());

grant select on care_modules to anon, authenticated;


-- ============================================================================
-- 2. What a business has bought
-- ============================================================================

alter table businesses add column if not exists opd_module boolean not null default false;
alter table businesses add column if not exists ipd_module boolean not null default false;

comment on column businesses.opd_module is
  'Paid for the OPD system. Gates the queue and the patient record in the '
  'dashboard. Set by fulfilment when a payment including it is captured.';
comment on column businesses.ipd_module is
  'Paid for the IPD system. Gates admissions, the bed board and inpatient '
  'billing.';

-- What a given payment bought, so fulfilment knows which flags to raise and an
-- invoice can say what was sold. On the payment rather than derived from the
-- business, because the business's flags change over time and an invoice must
-- not.
alter table payments add column if not exists modules text[] not null default '{}';

comment on column payments.modules is
  'care_modules codes this payment covered. The invoice line-items read from '
  'here, so a document raised last March still says what was sold in March.';


-- ============================================================================
-- 3. Is a module live right now?
--
-- The flag alone is not the answer: a business whose term has run out has not
-- paid for this month, and the dashboard should not keep letting it admit
-- patients. Same expiry that governs the listing.
-- ============================================================================

create or replace function sehat_business_has_module(p_business uuid, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case p_code
             when 'opd' then b.opd_module
             when 'ipd' then b.ipd_module
             else false
           end
       and b.status = 'active'
       -- No term recorded is treated as live: businesses created before billing
       -- existed, and admin-activated listings, have never had one.
       and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date)
      from businesses b where b.id = p_business
  ), false);
$$;

comment on function sehat_business_has_module is
  'Whether a business may use a clinical module today: it bought it AND its '
  'term has not lapsed. The dashboard asks this; it is not a substitute for '
  'RLS, which is scoped by business the same way it always was.';

grant execute on function sehat_business_has_module(uuid, text) to authenticated;

-- What the dashboard reads in one go, rather than two RPCs per load.
create or replace view business_modules as
  select
    b.id as business_id,
    b.opd_module,
    b.ipd_module,
    b.term_end,
    (b.status = 'active'
      and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date)) as term_live,
    (b.opd_module and b.status = 'active'
      and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date)) as opd_live,
    (b.ipd_module and b.status = 'active'
      and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date)) as ipd_live
  from businesses b
 where b.id in (select sehat_caller_business_ids());

grant select on business_modules to authenticated;


-- ============================================================================
-- 4. Everything is monthly now
-- ============================================================================

update pricing_plans set min_months = 1, max_months = 1, default_months = 1
 where min_months <> 1 or max_months <> 1 or default_months <> 1;

-- So a plan added later is monthly without anyone remembering to make it so.
alter table pricing_plans alter column min_months set default 1;
alter table pricing_plans alter column max_months set default 1;
alter table pricing_plans alter column default_months set default 1;

comment on column pricing_plans.max_months is
  'Pinned to 1 by 0060 — billing is monthly. Kept as a column rather than '
  'dropped so a longer term is three numbers in a row, not a migration and a '
  're-plumbing of invoices.';


-- ============================================================================
-- NOT HERE
--   Turning a module OFF on renewal. Fulfilment raises flags and never lowers
--     them, so a mid-term top-up buying IPD alone cannot cancel OPD. A business
--     that stops paying is cut off by term_end, which governs everything at
--     once; deliberately dropping a single module is an admin action and there
--     is no screen for it yet.
--   Per-doctor module pricing — see the header. One system, one price.
--   Trials. A free month of IPD is a discount_code shape, not a module shape.
-- ============================================================================
