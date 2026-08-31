-- ============================================================================
-- Sehatsandhi — registration remembers whether they want to auto-renew
--
-- Run AFTER 0083. Safe to re-run.
--
-- 0083 gave businesses.auto_renew a default of true and an owner-only RPC to
-- change it. Neither is reachable at the moment it actually matters. Signup runs
-- on the ANON key with no session — that is the whole reason 0079 validates
-- registration in SQL — so sehat_set_auto_renew(), which demands an owner or a
-- manager, cannot be what records an UNTICKED box. Left as it was, unticking
-- would appear to work and the business would silently be created with
-- auto_renew = true.
--
-- So the flag rides in on registration. A defaulted eleventh parameter cannot be
-- added with CREATE OR REPLACE: that produces a second overload and every
-- existing ten-argument call becomes ambiguous. The old signature is dropped and
-- recreated instead, body unchanged.
--
-- The body below is the live definition, transformed mechanically rather than
-- retyped: parameter added, auto_renew added to the businesses INSERT, nothing
-- else touched. Retyping a 200-line SECURITY DEFINER registration function by
-- hand is how a validation rule goes missing.
-- ============================================================================

drop function if exists public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.sehat_register_business_with_doctors(p_name text, p_vertical text DEFAULT 'clinic'::text, p_address text DEFAULT NULL::text, p_pin_codes text[] DEFAULT '{}'::text[], p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_reg_number text DEFAULT NULL::text, p_working_hours text DEFAULT NULL::text, p_place_id text DEFAULT NULL::text, p_doctors jsonb DEFAULT '[]'::jsonb, p_auto_renew boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    reg_number, working_hours, google_place_id, status, auto_renew
  ) values (
    btrim(p_name),
    coalesce(nullif(btrim(p_vertical), ''), 'clinic'),
    p_address,
    coalesce(p_pin_codes, '{}'),
    v_phone, v_email,
    nullif(btrim(coalesce(p_reg_number, '')), ''),
    p_working_hours, p_place_id,
    'pending',
    coalesce(p_auto_renew, true)
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
end $function$
;

comment on function public.sehat_register_business_with_doctors is
  'Registration. p_auto_renew records the auto-renewal box as ticked or not at '
  'the moment of signup, because the anon key has no session and the '
  'owner-only sehat_set_auto_renew() cannot be called yet.';

grant execute on function public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb, boolean) to PUBLIC;
grant execute on function public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb, boolean) to anon;
grant execute on function public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb, boolean) to authenticated;
grant execute on function public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb, boolean) to service_role;

notify pgrst, 'reload schema';
