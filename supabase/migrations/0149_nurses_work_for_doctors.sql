-- ============================================================================
-- Sehatsandhi — a nurse works for particular doctors; reception records vitals
--
-- Run AFTER 0148. Safe to re-run.
--
-- Decided 28 Sep 2026:
--
--   • A nurse is linked to one or more doctors (nurse_doctor_links). They see
--     the patients, queue, appointments and admissions of those doctors only,
--     and their doctor pickers list only those doctors. Until now a nurse saw the whole
--     clinic.
--   • A WARD NURSE (business_practitioners.ward_nurse) also sees every admitted
--     patient, whoever the doctor: they cover the floor.
--   • The owner or clinic manager links any nurse to any doctor; a doctor links
--     nurses to themself, and may add a new nurse of their own (via the emailed
--     code, 0147) who is linked to them at once.
--   • When a doctor leaves (removed, or no longer a doctor) every link to them
--     goes. A nurse left linked to nobody — and not a ward nurse — is reported
--     to the clinic by email, and listed on Doctors & staff until fixed.
--   • Reception records vitals but no longer reads them: vitals follow the same
--     rule as the rest of the medical record (0138).
--   • Existing nurses are linked to every current doctor of their clinic, so
--     nobody loses access today; the clinic narrows it from Doctors & staff.
-- ============================================================================

alter table business_practitioners add column if not exists ward_nurse boolean not null default false;

-- ── The links ───────────────────────────────────────────────────────────────
create table if not exists nurse_doctor_links (
  business_id uuid not null references businesses(id) on delete cascade,
  nurse_id uuid not null references practitioners(id) on delete cascade,
  doctor_id uuid not null references practitioners(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (business_id, nurse_id, doctor_id),
  check (nurse_id <> doctor_id)
);
create index if not exists nurse_doctor_links_doctor_idx on nurse_doctor_links (business_id, doctor_id);

alter table nurse_doctor_links enable row level security;
revoke all on nurse_doctor_links from anon, authenticated;
grant select on nurse_doctor_links to authenticated;
-- Anyone working at the clinic may see who works with whom. Writes: RPCs below.
drop policy if exists "clinic_reads_nurse_links" on nurse_doctor_links;
create policy "clinic_reads_nurse_links" on nurse_doctor_links
  for select using (sehat_caller_owns_business(business_id) or sehat_is_staff());

-- ── Who the caller is, as a nurse ───────────────────────────────────────────
-- The doctors a nurse caller works for; NULL when the caller is not a nurse
-- here (so nothing is narrowed for anybody else).
create or replace function sehat_caller_nurse_doctors(p_business uuid)
returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when sehat_caller_role(p_business) = 'nurse' then
    coalesce((select array_agg(l.doctor_id) from nurse_doctor_links l
               where l.business_id = p_business and l.nurse_id = sehat_caller_practitioner_id()), '{}')
  end;
$$;

create or replace function sehat_caller_is_ward_nurse(p_business uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select sehat_caller_role(p_business) = 'nurse' and exists (
    select 1 from business_practitioners bp
     where bp.business_id = p_business and bp.practitioner_id = sehat_caller_practitioner_id()
       and bp.ward_nurse and bp.status <> 'suspended');
$$;

-- For a queue or appointment row: may the caller see a row for this doctor?
-- True for everyone but a nurse; a nurse sees their doctors' rows and rows with
-- no doctor yet (a token given before a doctor was chosen).
create or replace function sehat_nurse_may_see_doctor(p_business uuid, p_doctor uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when sehat_caller_role(p_business) is distinct from 'nurse' then true
    when p_doctor is null then true
    else p_doctor = any(sehat_caller_nurse_doctors(p_business))
  end;
$$;

grant execute on function sehat_caller_nurse_doctors(uuid) to authenticated;
grant execute on function sehat_caller_is_ward_nurse(uuid) to authenticated;
grant execute on function sehat_nurse_may_see_doctor(uuid, uuid) to authenticated;

-- ── Is this patient under this doctor? ──────────────────────────────────────
-- 0138's test, lifted out so a nurse can ask it for each of their doctors.
create or replace function sehat_patient_is_under(p_business uuid, p_member uuid, p_doctor uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from opd_queue q where q.business_id = p_business and q.patient_member_id = p_member and q.practitioner_id = p_doctor)
      or exists (select 1 from patient_visits v where v.business_id = p_business and v.patient_member_id = p_member and v.practitioner_id = p_doctor)
      or exists (select 1 from appointments a where a.business_id = p_business and a.patient_member_id = p_member and a.practitioner_id = p_doctor)
      or exists (select 1 from admissions a where a.business_id = p_business and a.patient_member_id = p_member and a.attending_practitioner_id = p_doctor)
      or exists (select 1 from patient_referrals r where r.business_id = p_business and r.patient_member_id = p_member
                  and (r.to_practitioner_id = p_doctor or r.from_practitioner_id = p_doctor))
      or exists (select 1 from business_patients bp where bp.business_id = p_business and bp.patient_member_id = p_member
                  and bp.primary_practitioner_id = p_doctor)
      or exists (select 1 from patient_charges c where c.business_id = p_business and c.patient_member_id = p_member
                  and c.practitioner_id = p_doctor);
$$;

create or replace function sehat_caller_sees_patient(p_business uuid, p_member uuid)
returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_role text := sehat_caller_role(p_business);
  v_me   uuid;
begin
  if v_role = 'owner' then return true; end if;
  if v_role not in ('doctor', 'nurse') or p_member is null then return false; end if;
  v_me := sehat_caller_practitioner_id();
  if v_me is null then return false; end if;

  if v_role = 'doctor' then
    return sehat_patient_is_under(p_business, p_member, v_me);
  end if;

  -- A nurse: anyone admitted, if a ward nurse; otherwise their doctors' patients.
  if sehat_caller_is_ward_nurse(p_business)
     and exists (select 1 from admissions a where a.business_id = p_business and a.patient_member_id = p_member) then
    return true;
  end if;
  return exists (
    select 1 from nurse_doctor_links l
     where l.business_id = p_business and l.nurse_id = v_me
       and sehat_patient_is_under(p_business, p_member, l.doctor_id));
end $$;

-- ── A nurse's lists narrow to their doctors ─────────────────────────────────
drop policy if exists "clinic_reads_queue" on opd_queue;
create policy "clinic_reads_queue" on opd_queue
  for select using (sehat_caller_owns_business(business_id) and sehat_nurse_may_see_doctor(business_id, practitioner_id));

drop policy if exists "clinic_reads_appointments" on appointments;
create policy "clinic_reads_appointments" on appointments
  for select using (sehat_caller_owns_business(business_id) and sehat_nurse_may_see_doctor(business_id, practitioner_id));

drop policy if exists "clinic_reads_admissions" on admissions;
create policy "clinic_reads_admissions" on admissions
  for select using (sehat_caller_owns_business(business_id)
    and (sehat_caller_is_ward_nurse(business_id) or sehat_nurse_may_see_doctor(business_id, attending_practitioner_id)));

drop policy if exists "clinic_reads_business_patients" on business_patients;
create policy "clinic_reads_business_patients" on business_patients
  for select using (sehat_caller_owns_business(business_id)
    and (sehat_caller_role(business_id) is distinct from 'nurse' or sehat_caller_sees_patient(business_id, patient_member_id)));

-- ── Vitals: reception writes, the medical-record rule reads ─────────────────
drop policy if exists "clinic_reads_patient_vitals" on patient_vitals;
create policy "clinic_reads_patient_vitals" on patient_vitals
  for select using (sehat_caller_sees_patient(business_id, patient_member_id));
drop policy if exists "clinic_updates_patient_vitals" on patient_vitals;
create policy "clinic_updates_patient_vitals" on patient_vitals
  for update using (sehat_caller_sees_patient(business_id, patient_member_id))
  with check (sehat_caller_sees_patient(business_id, patient_member_id));
-- clinic_writes_patient_vitals (INSERT, any role at the clinic) is unchanged.

-- ── Linking ─────────────────────────────────────────────────────────────────
-- Owner/manager: any nurse to any doctor. A doctor: nurses to themself.
create or replace function sehat_nurse_link_allowed(p_business uuid, p_doctor uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select sehat_caller_manages_business(p_business)
      or (sehat_caller_role(p_business) = 'doctor' and p_doctor = sehat_caller_practitioner_id());
$$;

create or replace function sehat_link_nurse(p_business uuid, p_nurse uuid, p_doctor uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_nurse_link_allowed(p_business, p_doctor) then
    raise exception 'Only the owner, a manager, or the doctor themself can link a nurse to a doctor.' using errcode = '42501';
  end if;
  if not exists (select 1 from business_practitioners where business_id = p_business and practitioner_id = p_nurse
                  and role = 'nurse' and status <> 'suspended') then
    raise exception 'That person is not a nurse here.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from business_practitioners where business_id = p_business and practitioner_id = p_doctor
                  and role in ('doctor', 'owner') and status <> 'suspended') then
    raise exception 'That person is not a doctor here.' using errcode = 'P0001';
  end if;
  insert into nurse_doctor_links (business_id, nurse_id, doctor_id, created_by)
  values (p_business, p_nurse, p_doctor, auth.uid())
  on conflict do nothing;
end $$;

create or replace function sehat_unlink_nurse(p_business uuid, p_nurse uuid, p_doctor uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_nurse_link_allowed(p_business, p_doctor) then
    raise exception 'Only the owner, a manager, or the doctor themself can unlink a nurse.' using errcode = '42501';
  end if;
  delete from nurse_doctor_links where business_id = p_business and nurse_id = p_nurse and doctor_id = p_doctor;
end $$;

create or replace function sehat_set_ward_nurse(p_business uuid, p_nurse uuid, p_on boolean)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_caller_manages_business(p_business) then
    raise exception 'Only the owner or a manager can make someone a ward nurse.' using errcode = '42501';
  end if;
  update business_practitioners set ward_nurse = coalesce(p_on, false)
   where business_id = p_business and practitioner_id = p_nurse and role = 'nurse';
  insert into business_staff_log (business_id, practitioner_id, practitioner_name, action, actor_uid, actor_label)
  values (p_business, p_nurse, (select full_name from practitioners where id = p_nurse),
          case when p_on then 'ward_nurse_on' else 'ward_nurse_off' end, auth.uid(),
          coalesce((select email from auth.users where id = auth.uid()), 'system'));
end $$;

revoke all on function sehat_link_nurse(uuid, uuid, uuid) from public, anon;
revoke all on function sehat_unlink_nurse(uuid, uuid, uuid) from public, anon;
revoke all on function sehat_set_ward_nurse(uuid, uuid, boolean) from public, anon;
grant execute on function sehat_link_nurse(uuid, uuid, uuid) to authenticated;
grant execute on function sehat_unlink_nurse(uuid, uuid, uuid) to authenticated;
grant execute on function sehat_set_ward_nurse(uuid, uuid, boolean) to authenticated;

-- ── Every link change is logged; a nurse left with nobody is reported ───────
alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check
  check (kind in ('business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite', 'nurse_unassigned'));

create or replace function sehat_nurse_link_changed()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l nurse_doctor_links%rowtype;
  v_actor text := case when auth.uid() is null then 'system'
                       else coalesce((select email from auth.users where id = auth.uid()), auth.uid()::text) end;
  v_doctor text;
begin
  if tg_op = 'DELETE' then l := old; else l := new; end if;
  v_doctor := (select full_name from practitioners where id = l.doctor_id);
  insert into business_staff_log (business_id, practitioner_id, practitioner_name, action, reason, actor_uid, actor_label)
  values (l.business_id, l.nurse_id, (select full_name from practitioners where id = l.nurse_id),
          case when tg_op = 'DELETE' then 'nurse_unlinked' else 'nurse_linked' end,
          'Doctor: ' || coalesce(v_doctor, '?'), auth.uid(), v_actor);

  -- Left with no doctor, still a working nurse here, not a ward nurse: tell the clinic.
  if tg_op = 'DELETE'
     and not exists (select 1 from nurse_doctor_links x where x.business_id = l.business_id and x.nurse_id = l.nurse_id)
     and exists (select 1 from business_practitioners bp where bp.business_id = l.business_id and bp.practitioner_id = l.nurse_id
                  and bp.role = 'nurse' and bp.status <> 'suspended' and not bp.ward_nurse)
  then
    insert into email_outbox (kind, business_id, practitioner_id, payload)
    values ('nurse_unassigned', l.business_id, l.nurse_id, jsonb_build_object('last_doctor', v_doctor));
  end if;
  return null;
end $$;

drop trigger if exists nurse_link_changed on nurse_doctor_links;
create trigger nurse_link_changed after insert or delete on nurse_doctor_links
  for each row execute function sehat_nurse_link_changed();

-- ── A doctor who leaves takes their links with them; so does a nurse ────────
create or replace function sehat_unlink_on_leaving()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role in ('doctor', 'owner')
     and (new.status = 'suspended' or new.role not in ('doctor', 'owner')) then
    delete from nurse_doctor_links where business_id = new.business_id and doctor_id = new.practitioner_id;
  end if;
  if old.role = 'nurse' and (new.status = 'suspended' or new.role <> 'nurse') then
    delete from nurse_doctor_links where business_id = new.business_id and nurse_id = new.practitioner_id;
    -- Not a trigger column, so this does not re-enter.
    if new.role <> 'nurse' and new.ward_nurse then
      update business_practitioners set ward_nurse = false
       where business_id = new.business_id and practitioner_id = new.practitioner_id;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists unlink_on_leaving on business_practitioners;
create trigger unlink_on_leaving after update of status, role on business_practitioners
  for each row execute function sehat_unlink_on_leaving();

-- ── A doctor adds a nurse of their own ──────────────────────────────────────
-- 0148's sehat_staff_apply, plus one branch: a doctor (not owner/manager) may
-- use a verified 'add' request for a NURSE, who joins linked to that doctor.
-- attach/detach cannot serve it — they ask whether the caller runs the clinic.
create or replace function sehat_staff_apply(p_request uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r business_staff_requests%rowtype;
  bp business_practitioners%rowtype;
  v_role text;
  v_platform boolean := sehat_is_staff();
  v_me uuid;
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
    if r.action = 'remove' then
      update business_practitioners set status = 'suspended', is_primary = false
       where business_id = r.business_id and practitioner_id = r.practitioner_id;
    elsif r.action = 'restore' then
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
  elsif sehat_caller_role(r.business_id) = 'doctor' then
    v_me := sehat_caller_practitioner_id();
    if r.action <> 'add' or r.role is distinct from 'nurse' or v_me is null then
      raise exception 'A doctor can add a nurse of their own; other staff changes are for the owner or manager.'
        using errcode = '42501';
    end if;
    if bp.practitioner_id is not null and (bp.role is distinct from 'nurse' or bp.status <> 'suspended') then
      raise exception 'That person is already on the staff here. Ask the owner or manager.' using errcode = 'P0001';
    end if;
    insert into business_practitioners (business_id, practitioner_id, role, status)
    values (r.business_id, r.practitioner_id, 'nurse', 'pending')
    on conflict (business_id, practitioner_id) do update set status = 'pending';
    insert into nurse_doctor_links (business_id, nurse_id, doctor_id, created_by)
    values (r.business_id, r.practitioner_id, v_me, auth.uid())
    on conflict do nothing;
    -- Their login invite. sehat_invite_doctor is for owners and managers, so
    -- the doctor's nurse is queued here instead.
    insert into email_outbox (kind, business_id, practitioner_id)
    select 'doctor_invite', r.business_id, r.practitioner_id
     where exists (select 1 from practitioners p where p.id = r.practitioner_id and p.auth_uid is null and p.email is not null);
  elsif r.action = 'remove' then
    perform sehat_detach_practitioner(r.business_id, r.practitioner_id);
  else
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

-- ── Nobody loses access today ───────────────────────────────────────────────
-- Existing nurses keep seeing what they saw: every current doctor of their
-- clinic. Done with the log trigger off, so it does not flood staff logs.
-- Only on the first run (the table is empty): a re-run must not re-link nurses
-- a clinic has since unlinked on purpose.
alter table nurse_doctor_links disable trigger nurse_link_changed;
insert into nurse_doctor_links (business_id, nurse_id, doctor_id)
select n.business_id, n.practitioner_id, d.practitioner_id
  from business_practitioners n
  join business_practitioners d on d.business_id = n.business_id
 where n.role = 'nurse' and n.status <> 'suspended'
   and d.role in ('doctor', 'owner') and d.status <> 'suspended'
   and n.practitioner_id <> d.practitioner_id
   and not exists (select 1 from nurse_doctor_links)
on conflict do nothing;
alter table nurse_doctor_links enable trigger nurse_link_changed;

notify pgrst, 'reload schema';
