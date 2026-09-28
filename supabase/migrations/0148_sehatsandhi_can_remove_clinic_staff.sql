-- ============================================================================
-- Sehatsandhi — our team can remove a clinic's staff member; only an owner
-- removes an owner
--
-- Run AFTER 0147. Safe to re-run.
--
-- Decided 28 Sep 2026:
--
--   • A Sehatsandhi admin or manager (0145) can remove, or bring back, a staff
--     member of any clinic from the admin panel — for the call that says "Dr X
--     has left, take him off". Same emailed code and reason as the clinic's
--     own owner; the clinic is emailed. Recorded in the clinic's staff log and
--     in our staff_activity.
--   • A clinic manager can no longer remove an owner's place on the staff. The
--     owner kept their access either way (it comes from registering the
--     business), but dropped off the doctor list. Only an owner — or
--     Sehatsandhi — removes an owner now.
-- ============================================================================

-- ── The gate, plus: only an owner removes an owner ──────────────────────────
create or replace function sehat_staff_change_needs_code()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_req uuid := nullif(current_setting('sehat.staff_request', true), '')::uuid;
begin
  if auth.uid() is null or sehat_is_admin() then return new; end if;

  if tg_op = 'UPDATE' and old.role = 'owner'
     and old.status is distinct from 'suspended' and new.status = 'suspended'
     and coalesce(sehat_caller_role(new.business_id), '') <> 'owner' and not sehat_is_staff()
  then
    raise exception 'Only an owner can remove an owner.' using errcode = '42501';
  end if;

  if (select status from businesses where id = new.business_id) = 'pending' then return new; end if;

  -- attach is INSERT … ON CONFLICT DO UPDATE; see 0147 for why an insert for
  -- someone already on the staff is left to the UPDATE to judge.
  if tg_op = 'INSERT' and exists (select 1 from business_practitioners
                                   where business_id = new.business_id and practitioner_id = new.practitioner_id) then
    return new;
  end if;

  v_kind := sehat_staff_change_kind(tg_op,
    case when tg_op = 'UPDATE' then old.status end, new.status,
    case when tg_op = 'UPDATE' then old.role end, new.role);
  if v_kind is null then return new; end if;

  if v_req is null or not exists (
    select 1 from business_staff_requests r
     where r.id = v_req and r.status = 'verified'
       and r.requested_by = auth.uid()
       and r.business_id = new.business_id and r.practitioner_id = new.practitioner_id)
  then
    raise exception 'Adding, removing or promoting staff needs the code we email you. Use Doctors & staff on your dashboard.'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ── Carrying out a request — now also for Sehatsandhi's team ────────────────
create or replace function sehat_staff_apply(p_request uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r business_staff_requests%rowtype;
  bp business_practitioners%rowtype;
  v_role text;
  v_platform boolean := sehat_is_staff();
begin
  select * into r from business_staff_requests where id = p_request for update;
  if r.id is null or r.requested_by is distinct from auth.uid() then
    raise exception 'That request was not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'verified' or r.verified_at < now() - interval '10 minutes' then
    raise exception 'That code has already been used or has expired. Start again.' using errcode = 'P0001';
  end if;

  perform set_config('sehat.staff_request', r.id::text, true);
  select * into bp from business_practitioners
   where business_id = r.business_id and practitioner_id = r.practitioner_id;

  if v_platform then
    -- Our team removes and brings back; hiring stays with the clinic. Direct
    -- updates, because attach/detach ask whether the caller runs THIS clinic.
    if r.action = 'remove' then
      update business_practitioners set status = 'suspended', is_primary = false
       where business_id = r.business_id and practitioner_id = r.practitioner_id;
    elsif r.action = 'restore' then
      -- 'pending' lets 0140's trigger decide: live at once, or held for the fee.
      update business_practitioners set status = 'pending'
       where business_id = r.business_id and practitioner_id = r.practitioner_id and status = 'suspended';
    else
      raise exception 'Sehatsandhi can remove or bring back staff; adding and roles are for the clinic.'
        using errcode = '42501';
    end if;
    perform sehat_log_staff_action(
      case r.action when 'remove' then 'clinic_staff_removed' else 'clinic_staff_restored' end,
      'practitioner', r.practitioner_id, (select full_name from practitioners where id = r.practitioner_id),
      jsonb_build_object('business_id', r.business_id, 'role', bp.role, 'note', r.reason));
  elsif r.action = 'remove' then
    perform sehat_detach_practitioner(r.business_id, r.practitioner_id);
  else
    -- restore keeps the role they had; add and role use the one asked for.
    v_role := case when r.action = 'restore' then coalesce(bp.role, 'doctor') else coalesce(r.role, 'doctor') end;
    perform sehat_attach_practitioner(r.business_id, r.practitioner_id, v_role,
                                      coalesce(bp.is_primary, false), coalesce(bp.consultation_fee, 0));
  end if;

  select * into bp from business_practitioners
   where business_id = r.business_id and practitioner_id = r.practitioner_id;
  update business_staff_requests
     set status = 'used', used_at = now(),
         result = jsonb_build_object('status', bp.status, 'role', bp.role, 'awaiting_payment', bp.awaiting_payment)
   where id = r.id;
  perform set_config('sehat.staff_request', '', true);

  return jsonb_build_object('status', bp.status, 'role', bp.role, 'awaiting_payment', bp.awaiting_payment);
end $$;

-- ── The clinic's log says when it was us ────────────────────────────────────
create or replace function sehat_log_staff_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_req uuid := nullif(current_setting('sehat.staff_request', true), '')::uuid;
  v_reason text;
  v_actor text;
  v_email text;
begin
  if tg_op = 'INSERT' then
    v_action := 'added';
  elsif old.status is distinct from 'suspended' and new.status = 'suspended' then
    v_action := 'removed';
  elsif old.status = 'suspended' and new.status is distinct from 'suspended' then
    v_action := 'restored';
  elsif old.role is distinct from new.role then
    v_action := 'role_changed';
  else
    return null;
  end if;

  if v_req is not null then select reason into v_reason from business_staff_requests where id = v_req; end if;
  select email into v_email from auth.users where id = auth.uid();
  v_actor := case
    when auth.uid() is null then 'system'
    when sehat_is_staff() then 'Sehatsandhi' || coalesce(' (' || v_email || ')', '')
    else coalesce(v_email, auth.uid()::text)
  end;

  insert into business_staff_log (business_id, practitioner_id, practitioner_name, action,
                                  role_from, role_to, status_to, reason, actor_uid, actor_label, request_id)
  values (new.business_id, new.practitioner_id,
          (select full_name from practitioners where id = new.practitioner_id),
          v_action, case when tg_op = 'UPDATE' then old.role end, new.role, new.status,
          v_reason, auth.uid(), v_actor, v_req);
  return null;
end $$;

notify pgrst, 'reload schema';
