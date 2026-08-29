-- ============================================================================
-- Sehatsandhi — nobody hands themselves a role
--
-- Run AFTER 0077. Safe to re-run.
--
-- ── WHAT THIS ACTUALLY WAS ──────────────────────────────────────────────────
-- 0077's closing note called this the narrower question — "reception can change
-- a consultant's consultation_fee and role" — and framed it as a commercial
-- matter. That was wrong, and measuring it says so. `role` on
-- business_practitioners is the input to sehat_caller_role(), which is what
-- sehat_caller_is_clinical() and sehat_caller_may_prescribe() are built on. It
-- is not a label. It is the whole role system 0057 and 0071 put in.
--
-- affiliations_manage_own was
--
--     for all using (sehat_caller_owns_business(business_id))
--
-- and sehat_caller_owns_business is not ownership. It is
-- `p_business in (select sehat_caller_business_ids())` — true for ANY staff
-- member with a web login, receptionists included. So a receptionist could
-- update their own affiliation row. Measured on sandbox, as
-- sandbox-reception@:
--
--     before: role=receptionist  clinical=false  rx=false
--     update business_practitioners set role='owner' where id=<own row>
--             -> 1 row changed
--     after:  role=owner         clinical=true   rx=true
--
--     patient_conditions      1 row
--     prescriptions          18 rows
--     discharge summaries    13 rows
--
-- The front desk could read every patient's conditions, every prescription and
-- every discharge summary, and write a drug chart, by editing one column.
--
-- ── AND THE SAME HOLE THROUGH THE FRONT DOOR ────────────────────────────────
-- Closing the policy alone would have been theatre. Nothing in src/ writes this
-- table directly — the roster goes through sehat_attach_practitioner and
-- sehat_detach_practitioner, both SECURITY DEFINER, so RLS never sees them. And
-- both gate on the same sehat_caller_owns_business(). attach is an upsert with
--
--     on conflict (business_id, practitioner_id) do update set role = excluded.role
--
-- so the identical promotion works by calling the RPC:
--
--     select sehat_attach_practitioner(<business>, <self>, 'owner')
--             -> ACCEPTED,  role=owner  rx=true
--
-- detach is the mirror image: gated the same way, it let a receptionist suspend
-- every doctor at the clinic.
--
-- ── THE RULES ───────────────────────────────────────────────────────────────
--   1. Only an owner or manager may write an affiliation at all.
--   2. NOBODY may create or change their OWN role, status or web-login flag.
--      Not reception, not a manager, not an owner. Somebody else does it, or an
--      admin does. This is the rule that makes self-promotion unreachable
--      whatever the starting role.
--   3. Only an owner or an admin may grant the 'owner' role, so a manager
--      cannot mint one for an accomplice.
--
-- Nobody is locked out by rule 2. sehat_caller_role() returns 'owner' from
-- businesses.auth_uid — route 1, the person who signed the listing up — with no
-- affiliation row involved at all, and 'owner' is already clinical and already
-- a prescriber. A solo doctor who owns their clinic never needs to give
-- themselves a role.
-- ============================================================================


-- ── 1. What "may manage this business" should have meant all along ──────────
--
-- sehat_caller_owns_business() keeps its meaning — it answers "may this caller
-- act on this business at all", which is the right question for reading a
-- patient or booking an appointment, and it is used in dozens of places that
-- are correct. This is the narrower question it was being asked to answer and
-- could not.

create or replace function sehat_caller_manages_business(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select sehat_is_admin()
      or coalesce(sehat_caller_role(p_business) in ('owner', 'manager'), false);
$$;

comment on function sehat_caller_manages_business is
  'Added in 0078. Owner or manager, not merely "works here". '
  'sehat_caller_owns_business() is true for a receptionist and was being used as '
  'though it were not.';

grant execute on function sehat_caller_manages_business(uuid)
  to authenticated, service_role;

drop policy if exists affiliations_manage_own on business_practitioners;
drop policy if exists affiliations_manage_as_manager on business_practitioners;
create policy affiliations_manage_as_manager on business_practitioners
  for all using      (sehat_caller_manages_business(business_id))
          with check (sehat_caller_manages_business(business_id));

comment on policy affiliations_manage_as_manager on business_practitioners is
  'Replaced affiliations_manage_own in 0078, which was '
  'using (sehat_caller_owns_business(business_id)) — true for a receptionist, who '
  'could therefore set their own role to owner and become a prescriber.';


-- ── 2. Nobody hands themselves a role ───────────────────────────────────────
--
-- SECURITY INVOKER for the reason 0077 spells out: inside a DEFINER function
-- current_user is the OWNER, so a privilege test written there passes for
-- everybody.
--
-- What this trigger does NOT cover, said plainly rather than left to be
-- discovered: a SECURITY DEFINER function runs its statements as the function's
-- owner, so the BYPASSRLS escape below is taken and this guard does not fire
-- inside sehat_attach_practitioner or the signup path. That is deliberate —
-- signup has to create the founder's own affiliation — and it is exactly why
-- section 3 fixes the RPC's own authorisation rather than relying on this.
-- This guard is for the direct-table route; section 3 is for the RPC route.
-- Neither is sufficient alone.

create or replace function sehat_guard_affiliation_role()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_is_self  boolean;
  v_changed  text[] := '{}';
begin
  if sehat_is_admin()
     or coalesce((select r.rolbypassrls from pg_roles r where r.rolname = current_user), false)
  then
    return new;
  end if;

  -- Only an owner may create or move somebody into 'owner'.
  if new.role = 'owner'
     and (tg_op = 'INSERT' or old.role is distinct from 'owner')
     and coalesce(sehat_caller_role(new.business_id), '') <> 'owner'
  then
    raise exception 'Only an owner can make somebody else an owner.'
      using errcode = 'insufficient_privilege';
  end if;

  select exists (
    select 1 from practitioners p
     where p.id = new.practitioner_id
       and p.auth_uid is not null
       and p.auth_uid = auth.uid())
    into v_is_self;

  if not v_is_self then return new; end if;

  if tg_op = 'INSERT' then
    raise exception 'You cannot give yourself a role here. Ask an owner or Sehatsandhi.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.role          is distinct from old.role          then v_changed := array_append(v_changed, 'role');          end if;
  if new.status        is distinct from old.status        then v_changed := array_append(v_changed, 'status');        end if;
  if new.can_login_web is distinct from old.can_login_web then v_changed := array_append(v_changed, 'can_login_web'); end if;

  if array_length(v_changed, 1) > 0 then
    raise exception 'You cannot change your own % here. Ask an owner or Sehatsandhi.',
      array_to_string(v_changed, ', ')
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

comment on function sehat_guard_affiliation_role is
  'Added in 0078. Nobody creates or edits their own role, status or web-login '
  'flag, and only an owner grants ownership. Guards the direct-table route; the '
  'RPCs carry their own check because a DEFINER function skips this.';

drop trigger if exists business_practitioners_guard_role on business_practitioners;
create trigger business_practitioners_guard_role
  before insert or update on business_practitioners
  for each row execute function sehat_guard_affiliation_role();


-- ── 3. The RPCs stop asking the wrong question ──────────────────────────────
--
-- Bodies otherwise unchanged from what they were; only the authorisation line
-- differs, plus attach refusing to re-role the caller themselves. Without that
-- second check the manage-level gate still lets a MANAGER promote themselves,
-- which is the whole shape of the bug one rung up.

create or replace function sehat_attach_practitioner(
  p_business_id uuid,
  p_practitioner_id uuid,
  p_role text default 'doctor',
  p_is_primary boolean default false,
  p_consultation_fee integer default 0
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id   uuid;
  v_role text := coalesce(nullif(btrim(p_role), ''), 'doctor');
begin
  if not sehat_caller_manages_business(p_business_id) then
    raise exception 'you are not authorised to manage this business'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from practitioners where id = p_practitioner_id) then
    raise exception 'no such practitioner';
  end if;

  if not sehat_is_admin() then
    if v_role = 'owner' and coalesce(sehat_caller_role(p_business_id), '') <> 'owner' then
      raise exception 'Only an owner can make somebody else an owner.'
        using errcode = 'insufficient_privilege';
    end if;

    if exists (select 1 from practitioners p
                where p.id = p_practitioner_id
                  and p.auth_uid is not null
                  and p.auth_uid = auth.uid()) then
      raise exception 'You cannot set your own role here. Ask an owner or Sehatsandhi.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- One primary per person: clear the old one first, or the partial unique
  -- index rejects the insert and the caller sees a constraint error instead of
  -- their intent being carried out.
  if p_is_primary then
    update business_practitioners
       set is_primary = false
     where practitioner_id = p_practitioner_id and is_primary;
  end if;

  insert into business_practitioners (
    business_id, practitioner_id, role, is_primary, consultation_fee, status
  ) values (
    p_business_id, p_practitioner_id, v_role,
    coalesce(p_is_primary, false),
    coalesce(p_consultation_fee, 0),
    'pending'
  )
  on conflict (business_id, practitioner_id) do update
    set role             = excluded.role,
        is_primary       = excluded.is_primary,
        consultation_fee = excluded.consultation_fee,
        status           = case when business_practitioners.status = 'suspended'
                                then 'pending' else business_practitioners.status end
  returning id into v_id;

  return v_id;
end $$;

comment on function sehat_attach_practitioner is
  'Fixed in 0078. Gated on sehat_caller_owns_business(), which is true for a '
  'receptionist, and upserts role — so calling it on yourself with ''owner'' was '
  'a one-line promotion to prescriber.';

create or replace function sehat_detach_practitioner(
  p_business_id uuid,
  p_practitioner_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not sehat_caller_manages_business(p_business_id) then
    raise exception 'you are not authorised to manage this business'
      using errcode = 'insufficient_privilege';
  end if;

  update business_practitioners
     set status = 'suspended', is_primary = false
   where business_id = p_business_id
     and practitioner_id = p_practitioner_id;
end $$;

comment on function sehat_detach_practitioner is
  'Fixed in 0078. Same gate as attach, so a receptionist could suspend every '
  'doctor at the clinic.';

notify pgrst, 'reload schema';


-- ============================================================================
-- NOT DONE HERE
--
--   sehat_set_primary_affiliation still uses sehat_caller_owns_business(), and
--   correctly: it writes only is_primary, which orders a doctor's listings and
--   grants nothing. The practitioner themselves may also call it, which is the
--   point of it.
--
--   consultation_fee is now owner/manager-only as a side effect of rule 1,
--   which is where it belonged, but it was never the interesting half.
--
--   Nothing re-checks existing rows, and nothing needed to. Audited on both
--   databases on 2026-08-28, looking for affiliations carrying 'owner' or
--   'manager' and for any held by the login that owns the business:
--
--     prod      none at all — it has no affiliations yet
--     sandbox   one 'manager', seeded deliberately; no 'owner' anywhere;
--               four 'doctor' rows whose practitioner is also the business's
--               own login, which is a solo doctor owning their clinic and is
--               what the signup path creates
--
--   So nothing was promoted before this closed, and there is nothing to undo.
--   The query worth re-running if it ever matters is that one: affiliations at
--   'owner', and affiliations whose practitioner.auth_uid = businesses.auth_uid.
-- ============================================================================
