-- ============================================================================
-- 0263 — The WhatsApp sending terms of 26 Oct 2026
-- ============================================================================
-- AFTER 0262. Safe to re-run.
--
-- The terms a clinic accepts before sending (src/lib/waTerms.ts) now cover
-- WhatsApp Pro: the clinic's own number (Meta charges the clinic's card and
-- Meta's terms apply to it), and the automatic messages sent on the clinic's
-- behalf. The version moves with the words, so every clinic accepts again.
-- ============================================================================

update whatsapp_marketing_settings set terms_version = '2026-10-26', updated_at = now()
 where terms_version is distinct from '2026-10-26';
alter table whatsapp_marketing_settings alter column terms_version set default '2026-10-26';

notify pgrst, 'reload schema';
