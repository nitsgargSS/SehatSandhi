-- ============================================================================
-- Sehatsandhi — let the signup form read the register mirror directly
--
-- Run AFTER 0029. Safe to re-run.
--
-- WHY
-- Name search went through an edge function holding the service-role key. The
-- query itself takes under a millisecond; the function hop around it costs about
-- 200ms, roughly doubling what a doctor waits after pressing Enter. Reading the
-- table straight from the browser removes that hop.
--
-- WHY THIS IS SAFE TO EXPOSE
-- imr_doctors is a copy of the Indian Medical Register, which the NMC Act 2019
-- s.31 requires to be published and declares a public document. Every row here is
-- already searchable by anyone at nmc.org.in. We deliberately did not import the
-- father's name the register carries (see 0029), so there is nothing in this
-- table that is not both public and necessary.
--
-- What this does NOT open: imr_sync_state stays closed — import progress is
-- ours, not the public's — and nothing here touches doctors, which continues to
-- expose only active listings.
-- ============================================================================

-- Read-only, and only for looking up registrations. No insert, update or delete
-- policy exists, so the anon key cannot alter the register mirror; the import
-- script runs as the service role and bypasses RLS.
drop policy if exists "read_imr_register" on imr_doctors;
create policy "read_imr_register" on imr_doctors
  for select to anon, authenticated
  using (true);

comment on table imr_doctors is
  'Local copy of the Indian Medical Register, for verifying doctor registration '
  'numbers at signup. Public data (NMC Act 2019 s.31) and publicly readable here '
  'so the signup form can search it without an edge function in the way. '
  'Deliberately excludes the father''s name the register carries — it is not '
  'needed to confirm a number. Written only by scripts/imr-import.mjs.';
