-- ============================================================================
-- 0297 — A Facebook Page is connected to one business only
-- ============================================================================
-- AFTER 0296. Safe to re-run.
--
-- 29 Oct 2026: whoever connects sees every Page their Facebook login manages
-- (the user manages both SN Eye's and Sehatsandhi's). Picking the wrong one
-- would send one business's posts to another's Page. social-connect refuses
-- it with a message; this index is the rule underneath.
-- ============================================================================

create unique index if not exists social_accounts_one_business_per_page on social_accounts (page_id);
