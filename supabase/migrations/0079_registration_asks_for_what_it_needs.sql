-- ============================================================================
-- Sehatsandhi — registration asks for what it needs, and asks once
--
-- Run AFTER 0078. Safe to re-run.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Everything about logging in rests on there being an email address, and there
-- are almost none. Measured 2026-08-28:
--
--   sandbox   businesses 7, four with an email · practitioners 11, NONE
--   prod      businesses 2, one with an email  · practitioners  1, none
--
-- A doctor, a nurse and a receptionist are all practitioner rows, so "log in
-- with your email" currently has nobody to address. sehat_register_business_
-- with_doctors validated exactly one thing — that the business had a name —
-- and never wrote a doctor's email at all, even when the wizard collected one.
-- sehat_register_practitioner checked the name and nothing else.
--
-- This makes the four fields that identity depends on mandatory AT THE POINT OF
-- REGISTRATION, validates them, and makes an email unrepeatable.
--
-- ── WHERE THE CHECKS LIVE, AND WHY NOT ONLY IN THE FORM ─────────────────────
-- A form is a convenience, not a check. Both registration paths are RPCs
-- callable by anyone holding the anon key — which is in the JavaScript bundle —
-- so the rules are here, and the form repeats them for the sake of a decent
-- error message rather than to enforce anything.
--
-- ── WHAT "CANNOT BE DUPLICATED" MEANS HERE ──────────────────────────────────
-- Unique per table, on lower(email), not globally across both. A solo doctor
-- who owns their clinic is legitimately a business row AND a practitioner row
-- with the same address, and that is one person with one login — auth.users
-- already enforces that an email maps to a single account, which is the
-- uniqueness that actually stops two people sharing a sign-in.
--
-- Enforced as a UNIQUE INDEX rather than a check in the RPC. A rule the
-- application enforces is a rule until somebody writes a second application;
-- two clinics registering the same address in the same second would both pass
-- an application-level check and both insert.
--
-- Verified before adding: neither database has a duplicate email today.
--
-- ── WHAT IS NOT MADE NOT NULL, AND WHY ──────────────────────────────────────
-- The columns stay nullable. Twelve practitioners and nine businesses already
-- exist without an email, and a NOT NULL — or a NOT VALID check, which still
-- applies to UPDATEs — would make those rows uneditable: correcting a legacy
-- doctor's phone number would fail because of a missing email nobody has. So
-- the requirement is enforced where registration happens, and the format guard
-- below only fires on INSERT, or on an UPDATE that actually touches the field.
-- Existing rows are legacy, not invalid.
-- ============================================================================


-- ── 1. What a valid one looks like ──────────────────────────────────────────
--
-- The email pattern is deliberately loose. Addresses that are legal and look
-- wrong are far more common than the reverse, and the only real proof an
-- address works is the OTP arriving at it — so this rejects what cannot
-- possibly be an address and leaves the rest to verification.

create or replace function sehat_norm_email(p_email text)
returns text language sql immutable as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create or replace function sehat_valid_email(p_email text)
returns boolean language sql immutable as $$
  select sehat_norm_email(p_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$';
$$;

-- Indian mobile numbers: ten digits starting 6-9. Accepts the shapes people
-- actually type — +91, 91, a leading 0, spaces and dashes — and stores the ten
-- digits. normalisePhone in clinic-otp already does this in TypeScript; this is
-- the same rule where the data is, so the two cannot drift into disagreeing
-- about who is who.
create or replace function sehat_norm_phone(p_phone text)
returns text language sql immutable as $$
  with digits as (
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d
  ),
  trimmed as (
    select case
             when length(d) = 12 and left(d, 2) = '91' then right(d, 10)
             when length(d) = 11 and left(d, 1) = '0'  then right(d, 10)
             else d
           end as d
      from digits
  )
  select case when d ~ '^[6-9][0-9]{9}$' then d else null end from trimmed;
$$;

create or replace function sehat_valid_phone(p_phone text)
returns boolean language sql immutable as $$
  select sehat_norm_phone(p_phone) is not null;
$$;

comment on function sehat_norm_phone is
  'Added in 0079. Ten digits, 6-9 leading. Mirrors normalisePhone in clinic-otp '
  'so the login lookup and the registration agree on what a number is.';

grant execute on function sehat_norm_email(text), sehat_valid_email(text),
                         sehat_norm_phone(text), sehat_valid_phone(text)
  to anon, authenticated, service_role;


-- ── 2. An email belongs to one account ──────────────────────────────────────

create unique index if not exists businesses_email_unique
  on businesses (lower(btrim(email)))
  where coalesce(btrim(email), '') <> '';

create unique index if not exists practitioners_email_unique
  on practitioners (lower(btrim(email)))
  where coalesce(btrim(email), '') <> '';


-- ── 3. A stored address is a normalised address ─────────────────────────────
--
-- On INSERT always; on UPDATE only when the field is actually being changed, so
-- the rows that predate this migration can still have their other columns
-- corrected. Without that carve-out every legacy practitioner becomes read-only.

create or replace function sehat_normalise_contact()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    if coalesce(btrim(new.email), '') <> '' then
      if not sehat_valid_email(new.email) then
        raise exception 'That does not look like an email address: %', new.email
          using errcode = 'check_violation';
      end if;
      new.email := sehat_norm_email(new.email);
    else
      new.email := null;
    end if;
  end if;

  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    if coalesce(btrim(new.phone), '') <> '' then
      if not sehat_valid_phone(new.phone) then
        raise exception 'That does not look like an Indian mobile number: %', new.phone
          using errcode = 'check_violation';
      end if;
      new.phone := sehat_norm_phone(new.phone);
    else
      new.phone := null;
    end if;
  end if;

  return new;
end $$;

comment on function sehat_normalise_contact is
  'Added in 0079. Validates and normalises email and phone on the way in, on '
  'INSERT and on any UPDATE that touches them — but not on an UPDATE that does '
  'not, so rows predating this stay editable.';

drop trigger if exists businesses_normalise_contact on businesses;
create trigger businesses_normalise_contact
  before insert or update on businesses
  for each row execute function sehat_normalise_contact();

drop trigger if exists practitioners_normalise_contact on practitioners;
create trigger practitioners_normalise_contact
  before insert or update on practitioners
  for each row execute function sehat_normalise_contact();


-- ── 4. Registering a person ─────────────────────────────────────────────────
--
-- Dropped and recreated rather than replaced: p_role is new, and adding a
-- parameter to a `create or replace` makes an OVERLOAD instead, which leaves
-- PostgREST choosing between two functions of the same name.
--
-- p_role exists because a registration number is a doctor's, and a nurse or a
-- receptionist has none. Requiring one of everybody would make it impossible to
-- add a receptionist; requiring it of nobody is how a consultant ends up listed
-- with no council number behind the "verified" wording.

drop function if exists sehat_register_practitioner(text, text, text, text, integer, text, text);

create function sehat_register_practitioner(
  p_full_name text,
  p_speciality text default null,
  p_qualification text default null,
  p_reg_number text default null,
  p_smc_id integer default null,
  p_phone text default null,
  p_email text default null,
  p_role text default 'doctor'
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id    uuid;
  v_email text := sehat_norm_email(p_email);
  v_phone text := sehat_norm_phone(p_phone);
  v_reg   text := nullif(btrim(coalesce(p_reg_number, '')), '');
  v_role  text := coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'doctor');
begin
  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'Enter the full name.' using errcode = 'check_violation';
  end if;
  if v_phone is null then
    raise exception 'Enter a 10-digit mobile number.' using errcode = 'check_violation';
  end if;
  if v_email is null or not sehat_valid_email(v_email) then
    raise exception 'Enter an email address — it is how they sign in.'
      using errcode = 'check_violation';
  end if;
  if v_role = 'doctor' and v_reg is null then
    raise exception 'Enter the council registration number.' using errcode = 'check_violation';
  end if;

  -- Already on the register? That is one person, not two. Checked before the
  -- email rules below, so a returning consultant is recognised rather than
  -- rejected for an address somebody else already gave them.
  if p_smc_id is not null and v_reg is not null then
    select id into v_id from practitioners
     where smc_id = p_smc_id and upper(btrim(reg_number)) = upper(v_reg);
    if found then
      return v_id;
    end if;
  end if;

  if exists (select 1 from practitioners where lower(btrim(email)) = v_email) then
    raise exception 'Somebody is already registered with %. Sign in instead, or use another address.', v_email
      using errcode = 'unique_violation';
  end if;

  insert into practitioners (
    full_name, speciality, qualification, reg_number, smc_id, phone, email, status
  ) values (
    btrim(p_full_name),
    nullif(btrim(coalesce(p_speciality, '')), ''),
    nullif(btrim(coalesce(p_qualification, '')), ''),
    v_reg, p_smc_id, v_phone, v_email,
    'pending'
  )
  returning id into v_id;

  return v_id;
end $$;

comment on function sehat_register_practitioner is
  'Rewritten in 0079. Checked only that a name was present; a doctor could be '
  'registered with no number, no phone and no email, which is why no '
  'practitioner had one.';

grant execute on function sehat_register_practitioner(text, text, text, text, integer, text, text, text)
  to anon, authenticated, service_role;


-- ── 5. Registering a business, and its doctors with it ──────────────────────

create or replace function sehat_register_business_with_doctors(
  p_name text,
  p_vertical text default 'clinic',
  p_address text default null,
  p_pin_codes text[] default '{}',
  p_phone text default null,
  p_email text default null,
  p_reg_number text default null,
  p_working_hours text default null,
  p_place_id text default null,
  p_doctors jsonb default '[]'
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_business uuid;
  v_doc   jsonb;
  v_pid   uuid;
  v_smc   int;
  v_reg   text;
  v_email text := sehat_norm_email(p_email);
  v_phone text := sehat_norm_phone(p_phone);
  v_dmail text;
  v_dphone text;
  v_dname text;
  v_n     int := 0;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Enter the name of the clinic or hospital.' using errcode = 'check_violation';
  end if;
  if v_phone is null then
    raise exception 'Enter a 10-digit mobile number for the business.' using errcode = 'check_violation';
  end if;
  if v_email is null or not sehat_valid_email(v_email) then
    raise exception 'Enter an email address — it is how you will sign in.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from businesses where lower(btrim(email)) = v_email) then
    raise exception 'A business is already registered with %. Sign in instead, or use another address.', v_email
      using errcode = 'unique_violation';
  end if;

  -- Every doctor is checked BEFORE anything is written. Half a registration —
  -- a business created and its consultant rejected — leaves somebody owning a
  -- listing they cannot finish and cannot see, so this either takes all of it
  -- or none.
  for v_doc in select * from jsonb_array_elements(coalesce(p_doctors, '[]'::jsonb))
  loop
    v_n := v_n + 1;
    if (v_doc ->> 'practitioner_id') is not null then
      continue;   -- already on the platform; their details are already checked
    end if;
    v_dname  := btrim(coalesce(v_doc ->> 'name', ''));
    v_dphone := sehat_norm_phone(v_doc ->> 'phone');
    v_dmail  := sehat_norm_email(v_doc ->> 'email');
    v_reg    := nullif(btrim(coalesce(v_doc ->> 'reg_number', '')), '');

    if v_dname = '' then
      raise exception 'Doctor %: enter their full name.', v_n using errcode = 'check_violation';
    end if;
    if v_dphone is null then
      raise exception 'Doctor % (%): enter a 10-digit mobile number.', v_n, v_dname
        using errcode = 'check_violation';
    end if;
    if v_dmail is null then
      raise exception 'Doctor % (%): enter an email address — it is how they sign in.', v_n, v_dname
        using errcode = 'check_violation';
    end if;
    if v_reg is null then
      raise exception 'Doctor % (%): enter the council registration number.', v_n, v_dname
        using errcode = 'check_violation';
    end if;
    if v_dmail = v_email then
      -- The solo doctor who owns the clinic. One person, one login, two rows.
      null;
    elsif exists (select 1 from practitioners where lower(btrim(email)) = v_dmail) then
      raise exception 'Doctor % (%): % is already registered. They can be added by registration number instead.',
        v_n, v_dname, v_dmail using errcode = 'unique_violation';
    end if;
  end loop;

  insert into businesses (
    name, vertical, address, pin_codes, phone, email,
    reg_number, working_hours, google_place_id, status
  ) values (
    btrim(p_name),
    coalesce(nullif(btrim(p_vertical), ''), 'clinic'),
    p_address,
    coalesce(p_pin_codes, '{}'),
    v_phone, v_email,
    nullif(btrim(coalesce(p_reg_number, '')), ''),
    p_working_hours, p_place_id,
    'pending'
  )
  returning id into v_business;

  for v_doc in select * from jsonb_array_elements(coalesce(p_doctors, '[]'::jsonb))
  loop
    v_pid   := nullif(v_doc ->> 'practitioner_id', '')::uuid;
    v_smc   := nullif(v_doc ->> 'smc_id', '')::int;
    v_reg   := nullif(btrim(coalesce(v_doc ->> 'reg_number', '')), '');
    v_dmail := sehat_norm_email(v_doc ->> 'email');

    if v_pid is null and v_smc is not null and v_reg is not null then
      select id into v_pid from practitioners
       where smc_id = v_smc and upper(btrim(reg_number)) = upper(v_reg);
    end if;

    if v_pid is null then
      insert into practitioners (
        full_name, speciality, qualification, reg_number, smc_id, phone, email, status
      ) values (
        btrim(v_doc ->> 'name'),
        nullif(btrim(coalesce(v_doc ->> 'speciality', '')), ''),
        nullif(btrim(coalesce(v_doc ->> 'qualification', '')), ''),
        v_reg, v_smc,
        sehat_norm_phone(v_doc ->> 'phone'),
        v_dmail,
        'pending'
      )
      returning id into v_pid;
    end if;

    insert into business_practitioners (
      business_id, practitioner_id, role, is_primary, consultation_fee, status, sort_order
    ) values (
      v_business, v_pid, 'doctor',
      coalesce((v_doc ->> 'is_primary')::boolean, false)
        and not exists (select 1 from business_practitioners bp
                         where bp.practitioner_id = v_pid and bp.is_primary),
      coalesce((v_doc ->> 'consultation_fee')::integer, 0),
      'pending',
      coalesce((v_doc ->> 'sort_order')::integer, 0)
    )
    on conflict (business_id, practitioner_id) do nothing;
  end loop;

  return v_business;
end $$;

comment on function sehat_register_business_with_doctors is
  'Rewritten in 0079. Validated only that the business had a name, and silently '
  'dropped every doctor email the wizard collected — it never wrote the column.';

notify pgrst, 'reload schema';


-- ============================================================================
-- NOT DONE HERE
--
--   Password rules are not enforceable from SQL. Supabase Auth stores and
--   checks the password, and its minimum length and required character classes
--   are project settings — Authentication > Policies in the dashboard. The
--   forms enforce them so the user is told before submitting, but the setting
--   is what makes it true. It has to be turned on by hand, like the Vault
--   secrets.
--
--   Email OTP needs SMTP. Supabase's built-in sender is rate-limited to a
--   handful of messages an hour and is not for real traffic. Until a real SMTP
--   provider is configured in the dashboard, signInWithOtp will not deliver —
--   the same shape of blocker as the notification drain, and worth doing in the
--   same sitting.
--
--   The existing rows are untouched. Twelve practitioners and nine businesses
--   have no email and can still sign in by phone; nothing forces them onto an
--   address. Deciding whether to require one at their next login is a product
--   decision, not a migration.
-- ============================================================================
