-- ============================================================================
-- 0298 — Sehatsandhi's posts: call 87087 18705
-- ============================================================================
-- AFTER 0296. Safe to re-run.
--
-- 29 Oct 2026, asked for: the call button on Sehatsandhi's own posts is
-- 87087 18705. WhatsApp stays 70153 99355 (the caption's free-demo line, in
-- social-posts), since that SIM has no WhatsApp.
-- ============================================================================

update social_settings
   set profile = profile || jsonb_build_object('phone', '87087 18705'), updated_at = now()
 where business_id = '5e4a75a0-0000-4000-8000-000000000001';
