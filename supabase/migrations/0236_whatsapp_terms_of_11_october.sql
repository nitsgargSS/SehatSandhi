-- ============================================================================
-- 0236 — The WhatsApp sending terms of 11 Oct 2026
-- ============================================================================
-- AFTER 0235. Safe to re-run.
--
-- The terms a clinic accepts before broadcasting (0219, src/lib/waTerms.ts)
-- gained what was decided since: pictures, the right template in the right
-- language, no "best / only" claims, asking for reviews, and the two wallet
-- prices. The version moves with the words, so every clinic is asked to
-- accept again before its next broadcast. Nobody had accepted the old one.
-- ============================================================================

update whatsapp_marketing_settings set terms_version = '2026-10-11', updated_at = now()
 where terms_version is distinct from '2026-10-11';
alter table whatsapp_marketing_settings alter column terms_version set default '2026-10-11';
