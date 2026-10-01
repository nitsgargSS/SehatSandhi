-- ============================================================================
-- Sehatsandhi — pharmacies pay the same listing fee as a clinic
--
-- Run AFTER 0189. Safe to re-run.
--
-- 0189 moved pharmacies to the listing model, but their rows in
-- vertical_term_prices were ₹0, so checkout priced them at nothing. Decided
-- 1 Oct 2026: "charge listing fee same as doctors" — copy the clinic's price
-- term by term, only where the pharmacy price is still ₹0, so a price an admin
-- has set is never overwritten. Editable afterwards in Admin → Pricing.
-- ============================================================================

update vertical_term_prices p
   set subscription_price = c.subscription_price
  from vertical_term_prices c
 where p.vertical = 'pharmacy' and c.vertical = 'clinic' and c.months = p.months
   and coalesce(p.subscription_price, 0) = 0;
