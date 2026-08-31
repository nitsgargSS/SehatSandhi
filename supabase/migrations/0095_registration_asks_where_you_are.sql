-- ============================================================================
-- Sehatsandhi — registration asks where the business actually is
--
-- Run AFTER 0094. Safe to re-run.
--
-- 0094 gave businesses somewhere to record their own address and taught the
-- trigger to use it. Nothing fills it in: signup runs on the anon key and the
-- registration RPC has no parameter for a pincode, so every new business would
-- still be filed at the front of its coverage array.
--
-- Four defaulted parameters, and the same drop-and-recreate 0084 needed: a
-- defaulted parameter added with CREATE OR REPLACE produces a second overload
-- and makes every existing call ambiguous. The body below is the live
-- definition transformed mechanically — parameters added, four columns added to
-- the INSERT, nothing else touched. Retyping a 200-line SECURITY DEFINER
-- registration function by hand is how a validation rule goes missing.
--
-- Deliberately NOT required in SQL. A business that cannot find itself in the
-- Google search and does not know its own pincode should still be able to
-- register; an empty pincode leaves the old fallback in place and admin can
-- correct it. Making it not-null here would turn a data-quality preference into
-- a failed signup, and the funnel matters more than the tidiness of the column.
-- ============================================================================

drop function if exists public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.sehat_register_business_with_doctors(p_name text, p_vertical text DEFAULT 'clinic'::text, p_address text DEFAULT NULL::text, p_pin_codes text[] DEFAULT '{}'::text[], p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_reg_number text DEFAULT NULL::text, p_working_hours text DEFAULT NULL::text, p_place_id text DEFAULT NULL::text, p_doctors jsonb DEFAULT '[]'::jsonb, p_auto_renew boolean DEFAULT true, p_pin_code text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_district text DEFAULT NULL::text, p_state text DEFAULT NULL::text)
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
    reg_number, working_hours, google_place_id, status, auto_renew,
    own_pin_code, own_city, own_district, own_state
  ) values (
    btrim(p_name),
    coalesce(nullif(btrim(p_vertical), ''), 'clinic'),
    p_address,
    coalesce(p_pin_codes, '{}'),
    v_phone, v_email,
    nullif(btrim(coalesce(p_reg_number, '')), ''),
    p_working_hours, p_place_id,
    'pending',
    coalesce(p_auto_renew, true),
    nullif(btrim(coalesce(p_pin_code, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_district, '')), ''),
    nullif(btrim(coalesce(p_state, '')), '')
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
  'Registration. p_pin_code/p_city/p_district/p_state record where the business '
  'IS — distinct from p_pin_codes, which is where it SELLS. Optional on purpose: '
  'a missing pincode falls back to the old behaviour rather than failing signup.';

grant execute on function public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb, boolean, text, text, text, text) to anon;
grant execute on function public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb, boolean, text, text, text, text) to authenticated;
grant execute on function public.sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb, boolean, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
