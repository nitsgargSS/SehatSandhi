-- ============================================================================
-- Sehatsandhi — the organisation detail screen can actually write
--
-- Run AFTER 0021. Safe to re-run.
--
-- Found by auditing every table for a missing admin policy, after camps turned
-- out to have none (0021).
--
-- org_specialities has exactly one policy: the public may read the active
-- specialities of active organisations. org_subscriptions has none at all. The
-- admin organisation detail screen inserts and deletes rows in both — that is
-- how a hospital's specialities and its per-area subscriptions are managed — so
-- every one of those actions silently did nothing. An insert was refused, and a
-- delete matched zero rows and reported success.
--
-- WHY THIS WAS INVISIBLE
-- Reading either table as an admin returned []. So does a table you are allowed
-- to read that happens to be empty, which both are in production. Only creating
-- a row and then failing to see it distinguishes the two, which is what the
-- audit finally did.
-- ============================================================================

-- Specialities offered by an organisation.
drop policy if exists "admins_manage_org_specialities" on org_specialities;
create policy "admins_manage_org_specialities" on org_specialities
  for all using (sehat_is_admin()) with check (sehat_is_admin());

-- Which specialities an organisation is subscribed for, per area. This carries
-- monthly_price, so it is money: admin-only, with no public policy of any kind.
drop policy if exists "admins_manage_org_subscriptions" on org_subscriptions;
create policy "admins_manage_org_subscriptions" on org_subscriptions
  for all using (sehat_is_admin()) with check (sehat_is_admin());

comment on table org_subscriptions is
  'Per-speciality, per-area subscription rows for an organisation, with the '
  'monthly price. Admin-only — never readable with the public key.';

-- The organisation detail screen also lists the hospital's doctors, which
-- admins_read_doctors (0012) already covers.
