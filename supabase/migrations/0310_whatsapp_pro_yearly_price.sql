-- ============================================================================
-- 0310 — WhatsApp Pro: ₹10,000 for 12 months
-- ============================================================================
-- AFTER 0309. Safe to re-run.
--
-- Decided 2 Nov 2026: WhatsApp Pro (₹1,000 a month) is ₹10,000 for a year,
-- not 12 × ₹1,000; six months stays ₹6,000. Changed only where the year is
-- still 0262's default (twice Basic's ₹6,000), so a price an admin has set by
-- hand is left alone. Renewals read vertical_term_prices, so they follow.
-- ============================================================================

update vertical_term_prices
   set whatsapp_pro_price = 10000
 where months = 12 and whatsapp_pro_price = 12000;

notify pgrst, 'reload schema';
