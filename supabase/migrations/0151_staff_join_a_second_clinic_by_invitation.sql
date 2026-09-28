-- ============================================================================
-- Sehatsandhi — one person, several clinics: the clinic invites, the person accepts
--
-- Run AFTER 0150. Safe to re-run.
--
-- Decided 28 Sep 2026:
--
--   • Everyone — doctor, nurse, receptionist, manager — has ONE login, one
--     email and one phone, whatever number of clinics they work at.
--   • A clinic adding someone first looks them up by email or phone
--     (sehat_find_person). A person already known — they have a login, or work
--     at another clinic — is not added directly: the clinic sends an
--     INVITATION (still confirmed by the emailed code, 0147) and the person
--     accepts or declines it from their own dashboard. Nobody is pulled into a
--     clinic without knowing.
--   • Until 0151 a second clinic could not add them at all: registering the
--     same email again was refused ("already registered"), and doctors were
--     recognised only by council + registration number.
--   • Once in, they see one clinic at a time — the switcher — and nothing of
--     one clinic inside another. That was already so; unchanged here.
-- ============================================================================

create table if not exists staff_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  role text not null check (role in ('doctor', 'nurse', 'receptionist', 'manager')),
  link_doctor_id uuid references practitioners(id) on delete set null,   -- a doctor inviting their own nurse
  invited_by uuid,
  invited_by_label text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  responded_at timestamptz
);
create unique index if not exists staff_invitations_one_open
  on staff_invitations (business_id, practitioner_id) where status = 'pending';

alter table staff_invitations enable row level security;
revoke all on staff_invitations from anon, authenticated;
grant select on staff_invitations to authenticated;
-- The person invited, and the clinic's owners and managers. Writes: RPCs only.
drop policy if exists "invitation_readers" on staff_invitations;
create policy "invitation_readers" on staff_invitations for select using (
  practitioner_id = sehat_caller_practitioner_id()
  or sehat_caller_is_business(business_id)
  or sehat_is_staff());

-- ── Looking someone up ──────────────────────────────────────────────────────
-- For whoever may add staff here. Says who matches and whether an invitation
-- is needed; never returns their email or phone back, only confirms a match.
create or replace function sehat_find_person(p_business uuid, p_email text, p_phone text)
returns table (practitioner_id uuid, full_name text, speciality text, needs_invitation boolean, here_status text, here_role text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := sehat_norm_email(p_email);
  v_phone text := sehat_norm_phone(p_phone);
begin
  if not (sehat_caller_manages_business(p_business) or sehat_caller_role(p_business) = 'doctor') then
    raise exception 'Only the owner, a manager or a doctor here can look people up.' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.speciality,
           (p.auth_uid is not null
            or exists (select 1 from business_practitioners o where o.practitioner_id = p.id and o.business_id <> p_business)),
           bp.status, bp.role
      from practitioners p
      left join business_practitioners bp on bp.practitioner_id = p.id and bp.business_id = p_business
     where (v_email is not null and lower(btrim(p.email)) = v_email)
        or (v_phone is not null and sehat_norm_phone(p.phone) = v_phone)
     -- Up to five: phone numbers are not yet unique across people, so the
     -- clinic picks the right one by name. An email match comes first.
     order by (lower(btrim(p.email)) = v_email) desc nulls last, p.full_name
     limit 5;
end $$;
revoke all on function sehat_find_person(uuid, text, text) from public, anon;
grant execute on function sehat_find_person(uuid, text, text) to authenticated;

-- ── The gate learns about accepted invitations ──────────────────────────────
-- 0148's body, plus: a person accepting their own invitation passes.
create or replace function sehat_staff_change_needs_code()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_req uuid := nullif(current_setting('sehat.staff_request', true), '')::uuid;
  v_inv uuid := nullif(current_setting('sehat.staff_invitation', true), '')::uuid;
begin
  if auth.uid() is null or sehat_is_admin() then return new; end if;

  if v_inv is not null and exists (
       select 1 from staff_invitations i join practitioners p on p.id = i.practitioner_id
        where i.id = v_inv and i.status = 'pending'
          and i.business_id = new.business_id and i.practitioner_id = new.practitioner_id
          and p.auth_uid = auth.uid()) then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.role = 'owner'
     and old.status is distinct from 'suspended' and new.status = 'suspended'
     and coalesce(sehat_caller_role(new.business_id), '') <> 'owner' and not sehat_is_staff()
  then
    raise exception 'Only an owner can remove an owner.' using errcode = '42501';
  end if;

  if (select status from businesses where id = new.business_id) = 'pending' then return new; end if;

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

-- ── Carrying out a request: an 'add' for a known person becomes an invitation
-- 0149's body; the two add branches now invite where the person is known.
create or replace function sehat_staff_apply(p_request uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r business_staff_requests%rowtype;
  bp business_practitioners%rowtype;
  v_role text;
  v_platform boolean := sehat_is_staff();
  v_me uuid;
  v_known boolean;
  v_inv uuid;
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

  -- Known elsewhere and not already on this clinic's staff: invite, don't add.
  v_known := r.action = 'add' and bp.practitioner_id is null and exists (
    select 1 from practitioners p where p.id = r.practitioner_id
       and (p.auth_uid is not null
            or exists (select 1 from business_practitioners o where o.practitioner_id = p.id and o.business_id <> r.business_id)));

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
    if v_known then
      insert into staff_invitations (business_id, practitioner_id, role, link_doctor_id, invited_by, invited_by_label)
      values (r.business_id, r.practitioner_id, 'nurse', v_me, auth.uid(), r.requested_by_email)
      on conflict (business_id, practitioner_id) where status = 'pending'
      do update set role = excluded.role, link_doctor_id = excluded.link_doctor_id, created_at = now(),
                    expires_at = now() + interval '14 days'
      returning id into v_inv;
    else
      insert into business_practitioners (business_id, practitioner_id, role, status)
      values (r.business_id, r.practitioner_id, 'nurse', 'pending')
      on conflict (business_id, practitioner_id) do update set status = 'pending';
      insert into nurse_doctor_links (business_id, nurse_id, doctor_id, created_by)
      values (r.business_id, r.practitioner_id, v_me, auth.uid())
      on conflict do nothing;
      insert into email_outbox (kind, business_id, practitioner_id)
      select 'doctor_invite', r.business_id, r.practitioner_id
       where exists (select 1 from practitioners p where p.id = r.practitioner_id and p.auth_uid is null and p.email is not null);
    end if;

  elsif v_known then
    if r.role = 'owner' then
      raise exception 'An owner cannot be invited from another clinic. Add them as a manager or doctor.' using errcode = 'P0001';
    end if;
    insert into staff_invitations (business_id, practitioner_id, role, invited_by, invited_by_label)
    values (r.business_id, r.practitioner_id, coalesce(r.role, 'doctor'), auth.uid(), r.requested_by_email)
    on conflict (business_id, practitioner_id) where status = 'pending'
    do update set role = excluded.role, created_at = now(), expires_at = now() + interval '14 days'
    returning id into v_inv;

  elsif r.action = 'remove' then
    perform sehat_detach_practitioner(r.business_id, r.practitioner_id);
  else
    v_role := case when r.action = 'restore' then coalesce(bp.role, 'doctor') else coalesce(r.role, 'doctor') end;
    perform sehat_attach_practitioner(r.business_id, r.practitioner_id, v_role,
                                      coalesce(bp.is_primary, false), coalesce(bp.consultation_fee, 0));
  end if;

  if v_inv is not null then
    insert into business_staff_log (business_id, practitioner_id, practitioner_name, action, role_to, actor_uid, actor_label, request_id)
    values (r.business_id, r.practitioner_id, (select full_name from practitioners where id = r.practitioner_id),
            'invited', r.role, auth.uid(), r.requested_by_email, r.id);
    update business_staff_requests set status = 'used', used_at = now(),
           result = jsonb_build_object('status', 'invited', 'role', r.role, 'invitation_id', v_inv)
     where id = r.id;
    perform set_config('sehat.staff_request', '', true);
    return jsonb_build_object('status', 'invited', 'role', r.role, 'awaiting_payment', false, 'invitation_id', v_inv);
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

-- ── The person answers ──────────────────────────────────────────────────────
create or replace function sehat_respond_invitation(p_invitation uuid, p_accept boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  i staff_invitations%rowtype;
  bp business_practitioners%rowtype;
begin
  select * into i from staff_invitations where id = p_invitation for update;
  if i.id is null or i.practitioner_id is distinct from sehat_caller_practitioner_id() then
    raise exception 'That invitation was not found.' using errcode = 'P0002';
  end if;
  if i.status <> 'pending' then raise exception 'That invitation is no longer open.' using errcode = 'P0001'; end if;
  if i.expires_at < now() then
    update staff_invitations set status = 'expired' where id = i.id;
    raise exception 'That invitation has expired. Ask the clinic to send a new one.' using errcode = 'P0001';
  end if;

  if not p_accept then
    update staff_invitations set status = 'declined', responded_at = now() where id = i.id;
    insert into business_staff_log (business_id, practitioner_id, practitioner_name, action, role_to, actor_uid, actor_label)
    values (i.business_id, i.practitioner_id, (select full_name from practitioners where id = i.practitioner_id),
            'invitation_declined', i.role, auth.uid(), coalesce((select email from auth.users where id = auth.uid()), 'them'));
    return jsonb_build_object('status', 'declined');
  end if;

  perform set_config('sehat.staff_invitation', i.id::text, true);
  -- 'pending' lets 0140/0147's trigger decide: live now, or held for the fee.
  insert into business_practitioners (business_id, practitioner_id, role, status)
  values (i.business_id, i.practitioner_id, i.role, 'pending')
  on conflict (business_id, practitioner_id)
  do update set role = excluded.role, status = 'pending';
  if i.link_doctor_id is not null then
    insert into nurse_doctor_links (business_id, nurse_id, doctor_id, created_by)
    values (i.business_id, i.practitioner_id, i.link_doctor_id, i.invited_by)
    on conflict do nothing;
  end if;
  update staff_invitations set status = 'accepted', responded_at = now() where id = i.id;
  perform set_config('sehat.staff_invitation', '', true);

  select * into bp from business_practitioners where business_id = i.business_id and practitioner_id = i.practitioner_id;
  return jsonb_build_object('status', bp.status, 'role', bp.role, 'awaiting_payment', bp.awaiting_payment);
end $$;

-- The clinic takes an unanswered invitation back.
create or replace function sehat_cancel_invitation(p_invitation uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare i staff_invitations%rowtype;
begin
  select * into i from staff_invitations where id = p_invitation;
  if i.id is null or not (sehat_caller_manages_business(i.business_id) or i.invited_by = auth.uid()) then
    raise exception 'That invitation was not found.' using errcode = 'P0002';
  end if;
  update staff_invitations set status = 'cancelled', responded_at = now() where id = i.id and status = 'pending';
end $$;

-- What the signed-in person has been invited to, with the clinic's name —
-- which they cannot read through RLS until they join it.
create or replace function sehat_my_invitations()
returns table (id uuid, business_id uuid, business_name text, business_city text, role text,
               invited_by_label text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.business_id, b.name, b.own_city, i.role, i.invited_by_label, i.created_at, i.expires_at
    from staff_invitations i
    join businesses b on b.id = i.business_id
   where i.practitioner_id = sehat_caller_practitioner_id()
     and i.status = 'pending' and i.expires_at > now()
   order by i.created_at desc;
$$;
revoke all on function sehat_my_invitations() from public, anon;
grant execute on function sehat_my_invitations() to authenticated;

-- A clinic's open invitations, with the invitee's name — which RLS on
-- practitioners does not show the clinic until they have joined.
create or replace function sehat_clinic_invitations(p_business uuid)
returns table (id uuid, practitioner_id uuid, full_name text, role text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.practitioner_id, p.full_name, i.role, i.created_at, i.expires_at
    from staff_invitations i
    join practitioners p on p.id = i.practitioner_id
   where i.business_id = p_business and i.status = 'pending' and i.expires_at > now()
     and (sehat_caller_is_business(p_business) or sehat_caller_role(p_business) = 'doctor')
   order by i.created_at desc;
$$;
revoke all on function sehat_clinic_invitations(uuid) from public, anon;
grant execute on function sehat_clinic_invitations(uuid) to authenticated;

revoke all on function sehat_respond_invitation(uuid, boolean) from public, anon;
revoke all on function sehat_cancel_invitation(uuid) from public, anon;
grant execute on function sehat_respond_invitation(uuid, boolean) to authenticated;
grant execute on function sehat_cancel_invitation(uuid) to authenticated;

notify pgrst, 'reload schema';
