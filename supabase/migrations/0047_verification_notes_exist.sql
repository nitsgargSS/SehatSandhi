-- ============================================================================
-- Sehatsandhi — give the admin's verification note somewhere to live
--
-- Run AFTER 0046. Safe to re-run.
--
-- The admin panel has had a "verification notes" box since 0012: a reviewer
-- types why they approved or rejected a listing, and it saves. It has never
-- worked. `verification_notes` appears in no migration and in no database —
-- the UPDATE names a column that does not exist, PostgREST returns an error,
-- and the panel discards it, so the note vanishes and the box clears as though
-- it had saved.
--
-- Found while repairing the admin panel after the rename. Unlike everything
-- else there, this one is not rename fallout: it was broken before 0037 and
-- would have stayed broken after it.
--
-- The alternative was deleting the box. Kept instead because the reason a
-- listing was rejected is exactly the thing you want six months later when the
-- same clinic applies again, and because doctors here are verified by hand
-- against a council register — the note is the only record that the check
-- happened at all.
-- ============================================================================

alter table businesses add column if not exists verification_notes text;

comment on column businesses.verification_notes is
  'Why a reviewer approved or rejected this listing. Written from the admin '
  'panel, never shown to the business. Registration is checked by hand against '
  'the relevant council register, and this is the only record that the check '
  'was made.';

-- No policy change needed: admins_update_doctors was rebuilt against
-- businesses by 0038, and it already permits the whole row.
