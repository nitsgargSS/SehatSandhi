-- ============================================================================
-- Sehatsandhi — the launch offer: a term has its own price, and OPD/IPD are free
--
-- Run AFTER 0081. Safe to re-run.
--
-- Two changes that arrive together because they are one commercial decision:
-- what a business pays, and what it gets for it.
--
-- ── A TERM IS PRICED, NOT A MONTH MULTIPLIED ────────────────────────────────
-- 0060 pinned every plan to one month and said that if a longer term were ever
-- wanted again it would be "three numbers in a row of pricing_plans". That was
-- true only while a term's price was its monthly rate times its length. The
-- launch offer breaks exactly that:
--
--     6 months  → ₹6,000    which IS 1,000 × 6
--    12 months  → ₹10,000   which is NOT 1,000 × 12 (that would be ₹12,000)
--
-- The annual price is a real discount — two months free — and there is nowhere
-- in pricing_plans to put it. monthly_price × months cannot express it, and
-- inventing a monthly rate of ₹833.33 would put paise into a schema whose every
-- price is whole rupees and would still not reproduce ₹10,000 exactly.
--
-- So a term gets a row and a total. pricing_plans keeps monthly_price as the
-- headline rate to advertise ("from ₹1,000 a month"); plan_terms says what is
-- actually charged for a given length. Where a plan has no plan_terms rows
-- nothing changes at all and the old monthly × months arithmetic still applies,
-- which is why `standard` and `pincode_tiers` are untouched below.
--
-- ── THE TERM PRICE IS FLAT ──────────────────────────────────────────────────
-- The launch plan bills per_doctor: its monthly price is multiplied by the
-- consultant headcount, so a nine-consultant hospital pays ₹9,000 a month, not
-- ₹1,000. An offer advertised as "₹6,000 for 6 months" cannot then take
-- ₹54,000, so a term price is charged as it is written and is NOT multiplied.
--
-- This is the same reasoning 0060 used to keep the care modules off the
-- headcount multiplier: the offer is one price for one clinic. It is also a
-- genuine revenue decision rather than a technicality, so it is a column and
-- not a hard-coded rule — multiplies_headcount = true restores the old
-- behaviour for a term with a single UPDATE and no migration.
--
-- ── OPD AND IPD BECOME FREE ─────────────────────────────────────────────────
-- 0060 sold them at ₹5,000 and ₹10,000 a month. They are now included at no
-- charge and offered as a tick at registration. The rows stay, the gating stays,
-- sehat_business_has_module() stays — only the price becomes zero, so putting a
-- price back is an UPDATE rather than a rebuild. Everything that reads
-- care_modules.monthly_price keeps working and simply reads 0.
--
-- Nothing is grandfathered because there is nothing to grandfather: production
-- has no captured payment and no active business. Checked before writing this.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ─────────────────────────────────────────
-- Auto-renewal, the mandate and the 15-day reminders are 0083. They are a
-- different decision — what happens when a term ENDS — and they depend on these
-- terms existing first.
-- ============================================================================


-- ============================================================================
-- 1. What a term costs
-- ============================================================================

create table if not exists plan_terms (
  plan_code text not null references pricing_plans(code) on delete cascade,
  months integer not null check (months >= 1 and months <= 36),

  -- The TOTAL for the whole term, in whole rupees. Taxable value unless the
  -- plan carries price_includes_gst, exactly like pricing_plans.monthly_price —
  -- the tax treatment is the plan's, never the term's, so a business cannot be
  -- quoted inclusive on one term and exclusive on another.
  price integer not null check (price >= 0),

  -- Shown on the offer card. Null falls back to "N months" in the UI.
  label text,
  -- The saving to advertise, e.g. 'Save ₹2,000'. Copy, never arithmetic: it is
  -- not derived, so an admin can word it however they like — or leave it blank.
  savings_note text,

  -- False means the price is charged as written. True multiplies it by the
  -- consultant headcount the way pricing_plans.monthly_price is multiplied.
  -- See the header: false is the launch offer's whole point.
  multiplies_headcount boolean not null default false,

  sequence integer not null default 100,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),

  primary key (plan_code, months)
);

comment on table plan_terms is
  'What a given term length costs on a given plan, as a total rather than a '
  'monthly rate times a length. Exists because the annual launch price '
  '(₹10,000) is a discount that monthly_price × months cannot express. A plan '
  'with no rows here prices the old way and is unaffected.';

comment on column plan_terms.price is
  'Total for the whole term in whole rupees. Taxable value unless the PLAN '
  'says price_includes_gst.';

comment on column plan_terms.multiplies_headcount is
  'False (the default) charges the price as written, whatever the consultant '
  'count. True multiplies by headcount like pricing_plans.monthly_price. The '
  'launch offer is flat: "₹6,000 for 6 months" cannot become ₹54,000 for a '
  'nine-consultant hospital.';


-- Seed the launch offer. on conflict updates the prices but never deletes, so
-- re-running this file re-asserts the offer without disturbing terms an admin
-- has added since.
insert into plan_terms (plan_code, months, price, label, savings_note, sequence) values
  ('launch',  6,  6000, '6 months',  null,                          10),
  ('launch', 12, 10000, '12 months', 'Save ₹2,000 — two months free', 20)
on conflict (plan_code, months) do update
  set price        = excluded.price,
      label        = excluded.label,
      savings_note = excluded.savings_note,
      sequence     = excluded.sequence,
      updated_at   = now();


-- The plan's own month bounds have to admit the terms or clampMonths() will
-- reject them before plan_terms is ever consulted. 0060 pinned these to 1.
--
-- default_months is 6 deliberately: it is the cheaper commitment, and a default
-- that quietly selects the ₹10,000 option would be a dark pattern. The wizard
-- draws both and highlights the annual saving instead.
update pricing_plans
   set min_months     = 6,
       max_months     = 12,
       default_months = 6,
       updated_at     = now()
 where code = 'launch';


-- ============================================================================
-- 2. OPD and IPD are free
-- ============================================================================

update care_modules
   set monthly_price = 0,
       updated_at    = now()
 where code in ('opd', 'ipd');

-- Say so in the copy too, so the registration wizard and the admin screen do
-- not need a special case to explain a zero.
update care_modules
   set description = 'Token queue, patient records, prescriptions and '
                     'consultation notes for outpatients. Included free.'
 where code = 'opd';

update care_modules
   set description = 'Admissions, ward and bed management, ward notes, '
                     'discharge summaries and inpatient billing. Included free.'
 where code = 'ipd';


-- ============================================================================
-- 3. Resolving a term
--
-- The server must never take the client's word for a price. These two are the
-- authority: one says which terms exist, the other what one costs. The edge
-- function's computePrice() calls the same logic in TypeScript; this exists so
-- SQL callers (the renewal job in 0083, admin screens) do not have to
-- reimplement it.
-- ============================================================================

create or replace function sehat_plan_terms(p_plan_code text)
returns table (months integer, price integer, label text, savings_note text,
               multiplies_headcount boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.months, t.price, t.label, t.savings_note, t.multiplies_headcount
    from plan_terms t
    join pricing_plans p on p.code = t.plan_code
   where t.plan_code = p_plan_code
     and t.is_enabled
     and p.is_enabled
   order by t.sequence, t.months;
$$;

comment on function sehat_plan_terms is
  'The enabled terms for a plan, cheapest-sequenced first. Empty for a plan '
  'priced the old way.';

grant execute on function sehat_plan_terms(text) to anon, authenticated, service_role;


-- Null when the plan has no such term. A caller that gets null must fall back
-- to monthly_price × months rather than treating it as free — which is why this
-- returns null and not 0.
create or replace function sehat_plan_term_price(p_plan_code text, p_months integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select t.price
    from plan_terms t
    join pricing_plans p on p.code = t.plan_code
   where t.plan_code = p_plan_code
     and t.months    = p_months
     and t.is_enabled
     and p.is_enabled;
$$;

comment on function sehat_plan_term_price is
  'Total price for one term, or NULL when the plan does not price that length. '
  'NULL means "price it the old way", never "free".';

grant execute on function sehat_plan_term_price(text, integer) to anon, authenticated, service_role;


-- ============================================================================
-- 4. Who may read and write this
--
-- Same shape as pricing_plans and care_modules: the world reads it, because the
-- offer has to render on the public pricing page and in the signup wizard
-- before there is a session; only an admin writes it.
-- ============================================================================

alter table plan_terms enable row level security;

drop policy if exists plan_terms_public_read on plan_terms;
create policy plan_terms_public_read on plan_terms
  for select using (true);

drop policy if exists plan_terms_admin_all on plan_terms;
create policy plan_terms_admin_all on plan_terms
  using (sehat_is_admin()) with check (sehat_is_admin());

grant select on plan_terms to anon, authenticated;
grant all    on plan_terms to service_role;


-- ============================================================================
-- 5. Tell PostgREST
--
-- A new table and two new functions are invisible to the REST API until the
-- schema cache is reloaded, and pasting DDL into the SQL Editor does not do it.
-- ============================================================================

notify pgrst, 'reload schema';
