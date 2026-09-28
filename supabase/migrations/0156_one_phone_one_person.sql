-- ============================================================================
-- Sehatsandhi — one mobile number belongs to one person; every login can prove its own
--
-- Run AFTER 0155. Safe to re-run.
--
-- Decided 28 Sep 2026 (admin Phase 4):
--
--   • A mobile number belongs to ONE person across Sehatsandhi — a doctor,
--     nurse, receptionist or clinic manager (practitioners), and our own
--     admins and managers (admin_users). The same person may carry it on both
--     kinds of row (the same login), nobody else may. Adding someone whose
--     number is already a different person's is refused; the clinic looks
--     them up and invites them instead (0151).
--   • Business phones are left as they are: a clinic's number is often the
--     owner's own, shared by their branches, and 0129 already checks it at
--     registration.
--   • Enforced on every new number and every change from now on. Numbers that
--     already clash are not touched; sehat_admin_duplicate_phones lists them
--     for admin to sort out.
--   • Each login can prove its number on WhatsApp (phone-verify). When it does,
--     phone_verified_at is stamped on that person's own rows, and it is cleared
--     whenever the number changes. The WhatsApp code is switched OFF until the
--     AiSensy template is approved (PHONE_VERIFY_ENABLED); until then an admin
--     marks numbers verified after calling, as clinics are today.
--   • Email is proven for every login already: each first sign-in is by a code
--     sent to that address.
-- ============================================================================

alter table practitioners add column if not exists phone_verified_at timestamptz;
alter table admin_users add column if not exists phone_verified_at timestamptz;

-- ── One number, one person ──────────────────────────────────────────────────
-- Who else holds this number? The label is masked: enough to recognise, not to harvest.
create or replace function sehat_phone_held_by_other(p_phone text, p_practitioner uuid, p_auth uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select left(p.full_name, 1) || '… (' || coalesce(p.speciality, 'on Sehatsandhi') || ')'
       from practitioners p
      where sehat_norm_phone(p.phone) = sehat_norm_phone(p_phone)
        and p.id is distinct from p_practitioner
        and (p_auth is null or p.auth_uid is distinct from p_auth)
      limit 1),
    (select 'a Sehatsandhi team member'
       from admin_users a
      where sehat_norm_phone(a.phone) = sehat_norm_phone(p_phone)
        and (p_auth is null or a.auth_uid is distinct from p_auth)
        and not (p_practitioner is null and p_auth is not null and a.auth_uid = p_auth)
      limit 1));
$$;

create or replace function sehat_practitioner_phone_one_person()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_other text;
begin
  if sehat_norm_phone(new.phone) is null then return new; end if;
  if tg_op = 'UPDATE' and sehat_norm_phone(old.phone) is not distinct from sehat_norm_phone(new.phone)
     and old.auth_uid is not distinct from new.auth_uid then
    return new;
  end if;
  v_other := sehat_phone_held_by_other(new.phone, new.id, new.auth_uid);
  if v_other is not null then
    raise exception 'This mobile number already belongs to someone else on Sehatsandhi (%). One number is one person — if it is the same person, find them by this number and invite them.', v_other
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists practitioner_phone_one_person on practitioners;
create trigger practitioner_phone_one_person before insert or update of phone, auth_uid on practitioners
  for each row execute function sehat_practitioner_phone_one_person();

create or replace function sehat_admin_phone_one_person()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_other text;
begin
  if sehat_norm_phone(new.phone) is null then return new; end if;
  if tg_op = 'UPDATE' and sehat_norm_phone(old.phone) is not distinct from sehat_norm_phone(new.phone) then return new; end if;
  -- A clinic person with this number who is not this login.
  select left(p.full_name, 1) || '… (' || coalesce(p.speciality, 'on Sehatsandhi') || ')' into v_other
    from practitioners p
   where sehat_norm_phone(p.phone) = sehat_norm_phone(new.phone)
     and p.auth_uid is distinct from new.auth_uid
   limit 1;
  if v_other is not null then
    raise exception 'This mobile number already belongs to someone else on Sehatsandhi (%). One number is one person.', v_other
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists admin_phone_one_person on admin_users;
create trigger admin_phone_one_person before insert or update of phone on admin_users
  for each row execute function sehat_admin_phone_one_person();

-- ── A changed number is no longer verified ──────────────────────────────────
create or replace function sehat_phone_change_unverifies()
returns trigger
language plpgsql as $$
begin
  if sehat_norm_phone(old.phone) is distinct from sehat_norm_phone(new.phone) then
    new.phone_verified_at := null;
  end if;
  return new;
end $$;

drop trigger if exists phone_change_unverifies on practitioners;
create trigger phone_change_unverifies before update of phone on practitioners
  for each row execute function sehat_phone_change_unverifies();
drop trigger if exists phone_change_unverifies on admin_users;
create trigger phone_change_unverifies before update of phone on admin_users
  for each row execute function sehat_phone_change_unverifies();
drop trigger if exists phone_change_unverifies on businesses;
create trigger phone_change_unverifies before update of phone on businesses
  for each row execute function sehat_phone_change_unverifies();

-- ── Proving a number: stamp the prover's own rows ───────────────────────────
-- Called by phone-verify (service role) once a WhatsApp code matches. Only
-- rows that belong to that login AND carry that number are stamped.
create or replace function sehat_stamp_phone_verified(p_auth uuid, p_phone text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a int; b int; c int;
begin
  update practitioners set phone_verified_at = now()
   where auth_uid = p_auth and sehat_norm_phone(phone) = sehat_norm_phone(p_phone);
  get diagnostics a = row_count;
  update admin_users set phone_verified_at = now()
   where auth_uid = p_auth and sehat_norm_phone(phone) = sehat_norm_phone(p_phone);
  get diagnostics b = row_count;
  update businesses set phone_verified_at = now()
   where auth_uid = p_auth and sehat_norm_phone(phone) = sehat_norm_phone(p_phone) and phone_verified_at is null;
  get diagnostics c = row_count;
  return jsonb_build_object('practitioners', a, 'admin_users', b, 'businesses', c);
end $$;
revoke all on function sehat_stamp_phone_verified(uuid, text) from public, anon, authenticated;
grant execute on function sehat_stamp_phone_verified(uuid, text) to service_role;

-- An admin who has rung the person marks it by hand (the path until WhatsApp
-- codes are switched on). Full admins, for our team; clinic staff likewise.
create or replace function sehat_admin_mark_phone_verified(p_kind text, p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if p_kind = 'admin_user' then
    update admin_users set phone_verified_at = now() where id = p_id and phone is not null;
  elsif p_kind = 'practitioner' then
    update practitioners set phone_verified_at = now() where id = p_id and phone is not null;
  else
    raise exception 'Unknown kind.' using errcode = 'P0001';
  end if;
  perform sehat_log_staff_action('phone_verified', p_kind, p_id, null, '{}'::jsonb);
end $$;
revoke all on function sehat_admin_mark_phone_verified(text, uuid) from public, anon;
grant execute on function sehat_admin_mark_phone_verified(text, uuid) to authenticated;

-- ── Numbers that already clash ──────────────────────────────────────────────
create or replace function sehat_admin_duplicate_phones()
returns table (phone text, people integer, names text[])
language sql stable security definer set search_path = public as $$
  with all_rows as (
    select sehat_norm_phone(p.phone) ph, coalesce(p.auth_uid::text, 'p:' || p.id) who, p.full_name nm from practitioners p
    union all
    select sehat_norm_phone(a.phone), a.auth_uid::text, coalesce(a.full_name, a.email) || ' (team)' from admin_users a
  )
  select ph, count(distinct who)::int, array_agg(distinct nm)
    from all_rows
   where ph is not null and sehat_is_admin()
   group by ph
  having count(distinct who) > 1
   order by 2 desc, 1;
$$;
grant execute on function sehat_admin_duplicate_phones() to authenticated;

notify pgrst, 'reload schema';
