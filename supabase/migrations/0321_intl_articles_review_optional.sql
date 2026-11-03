-- ============================================================================
-- 0321 — International articles: a doctor's review is optional
-- ============================================================================
-- AFTER 0320. Safe to re-run.
--
-- Decided 3 Nov 2026: getting every health article read by a doctor is not
-- practical. A health or treatment article can now be published without a
-- reviewer; the page then says "Prepared by the Sehatsandhi team · General
-- information, not medical advice". When a doctor does read one, reviewed_by
-- carries their name and the page says "Medically reviewed by …" instead.
-- (0315's check required reviewed_by for every published health article.)
-- ============================================================================

alter table intl_articles drop constraint if exists intl_articles_check;

notify pgrst, 'reload schema';
