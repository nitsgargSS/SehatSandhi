-- ============================================================================
-- 0260 — The WhatsApp sending terms of 24 Oct 2026
-- ============================================================================
-- AFTER 0259. Safe to re-run.
--
-- The terms a clinic accepts before broadcasting (src/lib/waTerms.ts) now say
-- what 0259 gives: free one-to-one messages every month with the add-on, used
-- before the wallet, lapsing at the end of each month. The version moves with
-- the words, so every clinic accepts again before its next broadcast.
-- ============================================================================

update whatsapp_marketing_settings set terms_version = '2026-10-24', updated_at = now()
 where terms_version is distinct from '2026-10-24';
alter table whatsapp_marketing_settings alter column terms_version set default '2026-10-24';

notify pgrst, 'reload schema';
