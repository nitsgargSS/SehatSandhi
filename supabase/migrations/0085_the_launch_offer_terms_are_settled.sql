-- ============================================================================
-- Sehatsandhi — the launch offer's two open questions, settled
--
-- Run AFTER 0084. Safe to re-run. Comments only — no data, no structure.
--
-- 0082 shipped with two things undecided, and both are now answered (confirmed
-- 2026-08-31). They are recorded here rather than only in a commit message
-- because the next person to change a price will be looking at the schema, not
-- at git log — and because 0082 itself is applied history and cannot be edited.
--
-- ── THE PRICES ARE EX-GST ───────────────────────────────────────────────────
-- ₹6,000 and ₹10,000 are TAXABLE VALUES, not amounts debited. pricing_plans
-- carries price_includes_gst = false for the launch plan, so 18% is added:
--
--     6 months   ₹6,000  + ₹1,080  =  ₹7,080 charged
--    12 months  ₹10,000  + ₹1,800  =  ₹11,800 charged
--
-- That choice puts a burden on the copy. An offer advertised as "₹6,000" that
-- takes ₹7,080 is how a chargeback starts, so the registration wizard prints the
-- GST-inclusive figure on the term option itself — not only in the review rows
-- further down — and computes it with the same localTax() the quote and the
-- invoice use, so the three cannot disagree.
--
-- To switch to inclusive pricing later, set price_includes_gst = true on the
-- plan. Nothing else needs editing: computePrice() already branches to
-- extractGst() and the wizard's line follows from the same helper.
--
-- ── SIX AND TWELVE ARE THE ONLY TERMS ───────────────────────────────────────
-- There is no one-month option. pricing_plans.min_months is 6, so a client that
-- asks for one month is clamped up rather than sold a term that is not offered.
--
-- Restoring a monthly option therefore takes BOTH a plan_terms row AND lowering
-- min_months back to 1. The row on its own would be unreachable — clampMonths()
-- and resolveTermMonths() would never return a length outside the plan's bounds,
-- and the term would sit in the table looking enabled while nobody could buy it.
-- ============================================================================

comment on column plan_terms.price is
  'Total for the whole term in whole rupees. A TAXABLE VALUE unless the PLAN '
  'says price_includes_gst — the launch terms are ex-GST, so ₹6,000 is charged '
  'as ₹7,080 and ₹10,000 as ₹11,800. Settled 2026-08-31.';

comment on column plan_terms.months is
  'Term length. The launch plan offers 6 and 12 only, and there is deliberately '
  'no monthly option. A row here is unreachable unless the plan''s '
  'min_months/max_months admit it, so adding a term means adding a row AND '
  'widening those bounds.';

comment on table plan_terms is
  'What a given term length costs on a given plan, as a total rather than a '
  'monthly rate times a length. Exists because the annual launch price '
  '(₹10,000) is a discount that monthly_price × months cannot express. A plan '
  'with no rows here prices the old way and is unaffected. Prices are ex-GST '
  'unless the plan says otherwise.';


-- Belt and braces: re-assert that only 6 and 12 are on offer for the launch
-- plan, in case a term was added while this was being decided. Disables rather
-- than deletes — a disabled row is a record of something once sold, and
-- sehat_plan_terms() already filters on is_enabled.
update plan_terms
   set is_enabled = false,
       updated_at = now()
 where plan_code = 'launch'
   and months not in (6, 12)
   and is_enabled;


notify pgrst, 'reload schema';
