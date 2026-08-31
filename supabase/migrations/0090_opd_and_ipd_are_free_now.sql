-- ============================================================================
-- Sehatsandhi — OPD and IPD are free, shipped ahead of the term pricing
--
-- Run AFTER 0089. Safe to re-run.
--
-- 0082 does two unrelated things in one file: it prices the six- and
-- twelve-month terms, and it makes the two care modules free. The first is held
-- off production because the deployed compute-price still multiplies a monthly
-- rate, so shipping it early would quote ₹10,000 and charge ₹12,000. The second
-- has been sitting behind it for no reason at all.
--
-- The cost of that was visible: /business advertises the OPD and IPD systems and
-- reads their price from this table, so production was showing ₹5,000 and
-- ₹10,000 a month for two systems that are supposed to come with the listing.
-- Prices nobody is charging and nobody intends to charge.
--
-- ── WHY THIS HALF IS SAFE AND THE OTHER HALF IS NOT ─────────────────────────
-- The term half changes how a total is COMPUTED — plan_terms, and min_months
-- moving 1 → 6 — and the deployed edge function knows about neither. The old
-- client sends months = 1, gets clamped up to 6, and is charged six times what
-- its own screen says. That needs the redeploy.
--
-- This half changes a number the deployed function already reads. compute-price
-- does:
--
--     const moduleTotal = moduleLines.reduce((s, m) => s + m.monthly_price, 0)
--     monthlyTotal += moduleTotal
--
-- At zero that is an addition of nothing. No branch changes, no clamp moves, no
-- redeploy needed. Checked against the deployed source before writing this, not
-- assumed from the migration it was copied out of.
--
-- Nothing is grandfathered because there is nothing to grandfather: production
-- has 2 businesses, 0 with either module, 0 active and 0 payments. Measured.
--
-- 0082 still carries the same UPDATE. Both are idempotent and both set the same
-- values, so whichever order they arrive in, the result is identical — this one
-- simply gets there first.
-- ============================================================================

update care_modules
   set monthly_price = 0,
       updated_at    = now()
 where code in ('opd', 'ipd')
   and monthly_price <> 0;

update care_modules
   set description = 'Token queue, patient records, prescriptions and '
                     'consultation notes for outpatients. Included free.',
       updated_at  = now()
 where code = 'opd';

update care_modules
   set description = 'Admissions, ward and bed management, ward notes, '
                     'discharge summaries and inpatient billing. Included free.',
       updated_at  = now()
 where code = 'ipd';

comment on column care_modules.monthly_price is
  'Whole rupees per month per business. Zero since 0090 — both modules are '
  'included with the listing. The column stays because putting a price back '
  'should be an UPDATE rather than a rebuild, and because compute-price still '
  'adds it: at zero that addition is simply nothing.';


notify pgrst, 'reload schema';
