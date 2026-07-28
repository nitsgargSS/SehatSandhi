-- ============================================================================
-- Sehatsandhi — an admin can actually see and act on camps
--
-- Run AFTER 0020. Safe to re-run.
--
-- camps_offers has three policies: a doctor reads their own, a doctor inserts
-- their own, and the public reads approved ones that have not finished. There is
-- nothing for an admin — so the Camps tab showed an empty approval queue no
-- matter how many camps were waiting, and Approve and Reject would have written
-- nothing.
--
-- Exactly the fault 0012 fixed for doctors, on a table I did not think to
-- include. It surfaced when three pending camps were seeded into sandbox and the
-- admin session still read back an empty list.
--
-- Approving is a decision we make, so admin gets select and update. No delete: a
-- rejected camp keeps its admin_notes and its history, which is the point of
-- having a rejected status rather than removing the row.
-- ============================================================================

drop policy if exists "admins_read_camps" on camps_offers;
create policy "admins_read_camps" on camps_offers
  for select using (sehat_is_admin());

drop policy if exists "admins_update_camps" on camps_offers;
create policy "admins_update_camps" on camps_offers
  for update using (sehat_is_admin()) with check (sehat_is_admin());

-- The camps list joins the doctor's name and clinic. doctors already has
-- admins_read_doctors from 0012, so that side is covered.

comment on table camps_offers is
  'Health camps and offers submitted by a listing, pending our approval. Admin '
  'reads and updates via sehat_is_admin(); doctors see only their own; the '
  'public sees approved camps that have not yet finished.';
