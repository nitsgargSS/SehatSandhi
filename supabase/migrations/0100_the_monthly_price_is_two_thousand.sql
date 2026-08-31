-- ============================================================================
-- Sehatsandhi — the introductory monthly price is ₹2,000
--
-- Run AFTER 0099. Safe to re-run.
--
-- Revised introductory pricing, ex-GST, for every area:
--
--     1 month    ₹2,000
--     6 months  ₹10,000
--    12 months  ₹15,000
--
-- This migration does ONLY the monthly rate. The six- and twelve-month terms
-- are 0101, and they are separated for the same reason 0090 was split out of
-- 0082: one half is safe on production today and the other is not.
--
--   monthly_price          a number the DEPLOYED compute-price already reads
--                          and multiplies by a one-month term. Changing it
--                          changes the charge correctly, with no redeploy.
--
--   plan_terms + bounds    changes how a total is COMPUTED. The deployed
--                          function knows neither, so shipping it early quotes
--                          one number and charges another.
--
-- Production is pinned at min_months = max_months = 1, so after this it sells a
-- one-month listing at ₹2,000 + GST — which is exactly the monthly option that
-- was asked for, live immediately, without waiting on the edge deploy.
--
-- ── WHY THE MONTHLY OPTION EXISTS AGAIN ─────────────────────────────────────
-- 0085 recorded that six and twelve were the only terms and that there was
-- deliberately no monthly one. That is superseded here: a doctor evaluating the
-- product should be able to pay for one month and see whether it earns its
-- keep, and a six-month minimum is a lot to ask of somebody still deciding.
-- The reasoning in 0085 was sound for the offer as it stood; the offer changed.
-- ============================================================================

update pricing_plans
   set monthly_price = 2000,
       updated_at    = now()
 where code = 'launch'
   and monthly_price is distinct from 2000;

comment on column pricing_plans.monthly_price is
  'The advertised monthly rate, in whole rupees, ex-GST unless '
  'price_includes_gst. ₹2,000 for the launch plan since 0100. Where '
  'plan_terms prices a longer term, THAT total is charged and this is only the '
  'headline — the two deliberately disagree on a discounted term.';


notify pgrst, 'reload schema';
