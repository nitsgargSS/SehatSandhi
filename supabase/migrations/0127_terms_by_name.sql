-- ============================================================================
-- Sehatsandhi — terms are called Monthly, Half-yearly and Yearly
--
-- Run AFTER 0126. Safe to re-run.
--
-- "Sehatsandhi subscription — 1 month" read as a single month bought once, not
-- a charge that recurs (decided 26 Sep 2026). Line items and invoices now name
-- the term (termLabel in _shared/pricing.ts); these are the labels on the term
-- picker. Only the defaults 0117 wrote are renamed — a label admin has typed
-- is left alone.
-- ============================================================================

update vertical_term_prices set label = 'Monthly'     where months = 1  and (label is null or label in ('1 month', 'Monthly'));
update vertical_term_prices set label = 'Half-yearly' where months = 6  and (label is null or label = '6 months');
update vertical_term_prices set label = 'Yearly'      where months = 12 and (label is null or label = '12 months');

notify pgrst, 'reload schema';
