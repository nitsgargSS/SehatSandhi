-- ============================================================================
-- Sehatsandhi — reception cannot edit a doctor's council registration
--
-- Run AFTER 0076. Safe to re-run.
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
-- practitioners_update_own, from 0038:
--
--     for update using (id in (select sehat_caller_practitioner_ids()))
--
-- The name says "own". The helper does not mean that. Its second branch is
--
--     select bp.practitioner_id from business_practitioners bp
--      where bp.business_id in (select sehat_caller_business_ids())
--
-- — every practitioner attached to any business the caller may act on. So the
-- policy reads "a practitioner may update their own record" and grants "anybody
-- with a login at a clinic may update every practitioner there". A receptionist
-- could rewrite a consultant's `reg_number`, `smc_id` or `status`, or move
-- `auth_uid` onto themselves.
--
-- reg_number is not an ordinary profile field. Council registration is checked
-- BY HAND before a doctor is listed, and the "verified" wording the public site
-- carries rests on that check having been done against that number. A field
-- whose value is the whole of a public claim cannot be editable by whoever is
-- on the front desk.
--
-- Found while writing 0076, whose first draft used the same helper for the same
-- kind of test and let a nurse set a consultant's hours.
--
-- ── WHY A TRIGGER AND NOT COLUMN GRANTS ─────────────────────────────────────
-- 0074 used column-level GRANTs for exactly this shape of problem on
-- seed_clinics, and they are the better tool when the split is by ROLE NAME.
-- Here it is not. Admins reach PostgREST as `authenticated` like everyone else,
-- so `revoke update (reg_number) from authenticated` would lock out the admin
-- screen that exists to fix these fields — which is the mistake 0068 caught in
-- its own first draft on purge_job_history. The distinction is by what the
-- caller IS, not what role they connect as, so it has to be tested at run time.
--
-- ── WHAT CHANGES, IN PRACTICE ───────────────────────────────────────────────
-- Nothing in the product. src/pages/admin/Dashboard.tsx:204 is the only UPDATE
-- against this table anywhere in src/, it changes `speciality`, and it runs as
-- an admin. No clinic screen writes to practitioners at all: the roster edits
-- business_practitioners, which affiliations_manage_own already governs.
--
-- Creation is untouched and was never the gap. sehat_register_practitioner is
-- SECURITY DEFINER, so RLS never saw it, and a clinic can already file whatever
-- registration number it likes — with status 'pending'. The hand check is what
-- stands between that and a listing. This migration protects the number AFTER
-- it has been checked, which is where it was unprotected.
-- ============================================================================


-- ── 1. Who may touch the record at all ──────────────────────────────────────
--
-- The practitioner themselves, matched on auth_uid rather than through the
-- helper — see 0076, same trap. Plus an owner or manager of a business they are
-- affiliated to, because three of the eleven practitioners in sandbox have no
-- login at all and somebody has to be able to correct a typo in their name or
-- phone without it becoming an admin ticket.
--
-- Reception and nursing staff, no. A roster is not a profile.

create or replace function sehat_caller_may_edit_practitioner(p_practitioner uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
           select 1 from practitioners p
            where p.id = p_practitioner
              and p.auth_uid is not null
              and p.auth_uid = auth.uid())
      or exists (
           select 1 from business_practitioners bp
            where bp.practitioner_id = p_practitioner
              and sehat_caller_role(bp.business_id) in ('owner', 'manager'));
$$;

comment on function sehat_caller_may_edit_practitioner is
  'Added in 0077. The practitioner themselves, or an owner/manager of a business '
  'they work at. Deliberately not sehat_caller_practitioner_ids(), which returns '
  'everyone the caller can SEE — see 0076.';

grant execute on function sehat_caller_may_edit_practitioner(uuid)
  to authenticated, service_role;

drop policy if exists practitioners_update_own on practitioners;
drop policy if exists practitioners_update_profile on practitioners;
create policy practitioners_update_profile on practitioners
  for update using      (sehat_caller_may_edit_practitioner(id))
          with check    (sehat_caller_may_edit_practitioner(id));

comment on policy practitioners_update_profile on practitioners is
  'Replaced practitioners_update_own in 0077, which used '
  'sehat_caller_practitioner_ids() and so let any staff member at a clinic update '
  'every practitioner there, registration number included.';


-- ── 2. And which fields, once they may ──────────────────────────────────────
--
-- The protected set is everything a claim rests on rather than everything that
-- looks important:
--
--   reg_number, smc_id      the council registration the hand check verified
--   imr_status, imr_checked_at, imr_year
--                           the register lookup's own findings. Written by the
--                           imr-lookup function as service_role; not an opinion
--                           anybody may revise.
--   status                  whether this person appears on the public site at
--                           all — practitioners_public_read is `status =
--                           'active'`, so writing it is self-listing.
--   auth_uid                who logs in as this practitioner. Moving it is
--                           taking over the identity, and it is the single most
--                           dangerous column on the table.
--
-- Everything else — name, phone, email, photo, qualification, speciality — is
-- the person's own description of themselves and stays editable.
--
-- Admins pass, and so does anything holding BYPASSRLS: the edge functions run
-- as service_role and must be able to write the IMR result, and the migration
-- runner is postgres.

-- SECURITY INVOKER, and that is load-bearing. Inside a SECURITY DEFINER
-- function `current_user` is the function's OWNER, not the caller — postgres
-- here, which holds BYPASSRLS. Written as DEFINER, the escape hatch below
-- matched every caller and the guard passed everything; a manager rewrote a
-- registration number in the first test run. It needs no elevated rights of its
-- own: it reads OLD and NEW, a public catalog, and sehat_is_admin(), which is
-- SECURITY DEFINER itself and does the privileged part.
create or replace function sehat_guard_practitioner_claims()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_changed text[] := '{}';
begin
  if sehat_is_admin()
     or coalesce((select r.rolbypassrls from pg_roles r where r.rolname = current_user), false)
  then
    return new;
  end if;

  if new.reg_number     is distinct from old.reg_number     then v_changed := array_append(v_changed, 'reg_number');     end if;
  if new.smc_id         is distinct from old.smc_id         then v_changed := array_append(v_changed, 'smc_id');         end if;
  if new.imr_status     is distinct from old.imr_status     then v_changed := array_append(v_changed, 'imr_status');     end if;
  if new.imr_checked_at is distinct from old.imr_checked_at then v_changed := array_append(v_changed, 'imr_checked_at'); end if;
  if new.imr_year       is distinct from old.imr_year       then v_changed := array_append(v_changed, 'imr_year');       end if;
  if new.status         is distinct from old.status         then v_changed := array_append(v_changed, 'status');         end if;
  if new.auth_uid       is distinct from old.auth_uid       then v_changed := array_append(v_changed, 'auth_uid');       end if;

  if array_length(v_changed, 1) > 0 then
    -- Deliberately one message for all seven rather than a tailored one each:
    -- what they have in common is that Sehatsandhi checked them, and a clinic
    -- needs to know who to ask rather than why it was refused.
    raise exception
      'Only Sehatsandhi can change % on a practitioner. Ask us if it needs correcting.',
      array_to_string(v_changed, ', ')
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

comment on function sehat_guard_practitioner_claims is
  'Added in 0077. Registration, register-lookup findings, listing status and the '
  'login binding are admin-only. A trigger rather than column grants because '
  'admins arrive as `authenticated` like everyone else, and SECURITY INVOKER '
  'because current_user inside a DEFINER function is the owner, not the caller.';

drop trigger if exists practitioners_guard_claims on practitioners;
create trigger practitioners_guard_claims
  before update on practitioners
  for each row execute function sehat_guard_practitioner_claims();


-- ============================================================================
-- NOT DONE HERE
--
--   practitioners_read_own carries the same helper and is left alone on
--   purpose: reading is what the helper's wider meaning is actually FOR. A
--   clinic must see the practitioners on its own roster, and that is what the
--   second branch returns. It is only as an identity test that it is wrong.
--
--   affiliations_manage_own is `for all using (sehat_caller_owns_business(...))`
--   on business_practitioners, so reception can still change a consultant's
--   consultation_fee and role on the roster. That is the clinic's own
--   commercial arrangement rather than the doctor's identity, so it is a
--   narrower question than this one — but it is a question, and nobody has
--   asked it.
--
--   Nothing re-verifies the four practitioners currently at status 'pending'.
--   They are not publicly listed, so nothing is exposed; they simply cannot
--   list themselves any more, which is the point.
-- ============================================================================
