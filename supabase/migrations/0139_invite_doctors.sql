-- ============================================================================
-- Sehatsandhi — the owner invites each doctor to log in and fill in their page
--
-- Run AFTER 0138. Safe to re-run.
--
-- Decided 26 Sep 2026: the main account asks every doctor it adds to set up
-- their own login and public profile. One login per person, whatever number of
-- clinics they work at — the invite points at the same sign-in every time, and
-- the dashboard switches between their clinics.
--
--   sehat_invite_doctor      owner/manager queues a 'doctor_invite' email
--                            (email-send writes it); at most one an hour each
--   sehat_set_doctor_email   owner/manager adds the email of a doctor who has
--                            none and has never signed in — without one there
--                            is nothing to sign in with. An address already in
--                            use is refused (0079), and a doctor who has signed
--                            in keeps theirs: it is their login.
--
-- A doctor added from the dashboard is invited automatically (the screen calls
-- sehat_invite_doctor after adding them).
-- ============================================================================

alter table email_outbox add column if not exists practitioner_id uuid references practitioners(id) on delete cascade;

alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check
  check (kind in ('business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite'));

create or replace function sehat_invite_doctor(p_business uuid, p_practitioner uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  if coalesce(sehat_caller_role(p_business), '') not in ('owner', 'manager') then
    raise exception 'Only the owner or a manager can invite doctors.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from business_practitioners
                  where business_id = p_business and practitioner_id = p_practitioner and status <> 'suspended') then
    raise exception 'That person does not work here.' using errcode = 'no_data_found';
  end if;
  select nullif(btrim(email), '') into v_email from practitioners where id = p_practitioner;
  if v_email is null then
    raise exception 'Add their email first — it is what they sign in with.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from email_outbox where kind = 'doctor_invite' and practitioner_id = p_practitioner
              and business_id = p_business and created_at > now() - interval '1 hour') then
    return 'already_sent';
  end if;
  insert into email_outbox (kind, business_id, practitioner_id) values ('doctor_invite', p_business, p_practitioner);
  return 'queued';
end $$;
revoke all on function sehat_invite_doctor(uuid, uuid) from public, anon;
grant execute on function sehat_invite_doctor(uuid, uuid) to authenticated;

create or replace function sehat_set_doctor_email(p_business uuid, p_practitioner uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := sehat_norm_email(p_email);
  p record;
begin
  if coalesce(sehat_caller_role(p_business), '') not in ('owner', 'manager') then
    raise exception 'Only the owner or a manager can do this.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from business_practitioners where business_id = p_business and practitioner_id = p_practitioner) then
    raise exception 'That person does not work here.' using errcode = 'no_data_found';
  end if;
  if v_email is null or not sehat_valid_email(v_email) then
    raise exception 'Enter a valid email address.' using errcode = 'check_violation';
  end if;
  select auth_uid, email into p from practitioners where id = p_practitioner;
  if p.auth_uid is not null then
    raise exception 'They have already signed in; their email is their login and only they can change it.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from practitioners where lower(btrim(email)) = v_email and id <> p_practitioner) then
    raise exception '% is already registered to another doctor. Search for them instead.', v_email
      using errcode = 'unique_violation';
  end if;
  update practitioners set email = v_email where id = p_practitioner;
end $$;
revoke all on function sehat_set_doctor_email(uuid, uuid, text) from public, anon;
grant execute on function sehat_set_doctor_email(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
