-- ============================================================================
-- Sehatsandhi — practitioner policies that do not recurse
--
-- Run AFTER 0042. Safe to re-run.
--
-- ⚠ RECONSTRUCTED, NOT THE ORIGINAL ⚠
-- Sandeep Goyal wrote and applied a migration under this name to sandbox on
-- 2026-08-12. It was never committed and the file was not available. This one
-- was rebuilt on 2026-08-24 by diffing sandbox (which has it) against
-- production (which does not) and reading the resulting objects out of the
-- catalog verbatim.
--
-- It therefore reproduces WHAT THE DATABASE LOOKS LIKE, which is not
-- necessarily everything the original did. Anything that left no trace in the
-- final schema — a data fix, a dropped object, a one-off backfill — is not
-- here and cannot be recovered this way. If the original turns up, diff it
-- against this before replacing it.
--
-- ── THE BUG IT FIXES ────────────────────────────────────────────────────────
-- 0038 gave practitioners a policy that reads business_practitioners:
--
--     exists (select 1 from business_practitioners bp
--              where bp.practitioner_id = practitioners.id and ...)
--
-- and gave business_practitioners a policy that reads practitioners:
--
--     exists (select 1 from practitioners p
--              where p.id = business_practitioners.practitioner_id
--                and p.auth_uid = auth.uid())
--
-- Each table's policy consults the other table, whose policy consults the
-- first. Postgres evaluates RLS on the inner read too, so this is a cycle:
-- "infinite recursion detected in policy for relation practitioners". Any
-- select on either table fails outright — which takes out the roster, the
-- dashboard's doctor list, and every public profile at once.
--
-- The fix is one SECURITY DEFINER function. It runs as its owner, so the reads
-- inside it are not subject to RLS, and neither policy has to consult the other
-- table under RLS any more. The cycle is broken at exactly one point rather
-- than by weakening either policy.
-- ============================================================================


-- ============================================================================
-- 1. The cycle-breaker
-- ============================================================================

create or replace function sehat_caller_practitioner_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  -- Themselves, if they have a login.
  select p.id from practitioners p
   where p.auth_uid is not null and p.auth_uid = auth.uid()
  union
  -- Everyone attached to a business the caller may act on.
  select bp.practitioner_id
    from business_practitioners bp
   where bp.business_id in (select sehat_caller_business_ids());
$$;

comment on function sehat_caller_practitioner_ids is
  'Practitioners the current session may act on: themselves, plus everyone '
  'rostered at a business it can act on. SECURITY DEFINER on purpose — it is '
  'what lets the policies on practitioners and business_practitioners stop '
  'reading each other, which is what made them recurse.';

grant execute on function sehat_caller_practitioner_ids() to anon, authenticated, service_role;


-- ============================================================================
-- 2. practitioners
-- ============================================================================

-- Active practitioners are publicly visible. This is what the profile and the
-- search results read; 0038 had no such policy and relied on a view.
drop policy if exists practitioners_public_read on practitioners;
create policy practitioners_public_read on practitioners
  for select using (status = 'active');

drop policy if exists practitioners_read_own on practitioners;
create policy practitioners_read_own on practitioners
  for select using (id in (select sehat_caller_practitioner_ids()));

-- Note the WITH CHECK, which 0038 left as `true`. That allowed an update to
-- move a row to a practitioner the caller does not control: the USING clause
-- decided which rows could be touched, and nothing decided what they could be
-- turned into.
drop policy if exists practitioners_update_own on practitioners;
create policy practitioners_update_own on practitioners
  for update using (id in (select sehat_caller_practitioner_ids()))
  with check (id in (select sehat_caller_practitioner_ids()));


-- ============================================================================
-- 3. business_practitioners
-- ============================================================================

-- The roster of an active business is public — it is what a patient sees on a
-- clinic's page. Both sides must be active: a suspended doctor should not
-- appear on a live clinic, and no one should appear on a pending one.
drop policy if exists affiliations_public_read on business_practitioners;
create policy affiliations_public_read on business_practitioners
  for select using (
    status = 'active'
    and exists (
      select 1 from businesses b
       where b.id = business_practitioners.business_id
         and b.status = 'active'
    )
  );

drop policy if exists affiliations_read_own on business_practitioners;
create policy affiliations_read_own on business_practitioners
  for select using (
    business_id in (select sehat_caller_business_ids())
    or practitioner_id in (select sehat_caller_practitioner_ids())
  );

-- practitioners_admin_all, affiliations_admin_all and affiliations_manage_own
-- are 0038's and are unchanged. They never referenced the other table, so they
-- were never part of the cycle.
