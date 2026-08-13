-- ============================================================================
-- Sehatsandhi — registering a business and its doctors is ONE act
--
-- Run AFTER 0041. Safe to re-run.
--
-- THE BUG THIS FIXES
-- 0038 split signup into three calls: register the business, register each
-- doctor, attach each one. The first two are granted to anon, because signup
-- happens before anybody has logged in. The third is not — sehat_attach_
-- practitioner checks sehat_caller_owns_business(), and during registration
-- auth.uid() is null, so the caller owns nothing.
--
-- The result was silent and bad: the business row appeared, the practitioner
-- row appeared, and the link between them did not. A doctor who registered was
-- created and then not attached to their own clinic — invisible in search,
-- because search resolves through the affiliation. No error reached the user;
-- the wizard reported success.
--
-- Found by registering a doctor in the browser and reading the three tables.
--
-- WHY A SINGLE RPC RATHER THAN A LOOSER GRANT
-- Granting attach to anon would let anybody bolt any doctor onto any business.
-- The authority to attach comes from having just created the business in the
-- same statement — so it is the same function, one transaction, and the
-- business id is never taken from the caller. A half-registered signup can no
-- longer exist: either all of it lands or none of it does.
-- ============================================================================

create or replace function sehat_register_business_with_doctors(
  p_name          text,
  p_vertical      text default 'clinic',
  p_address       text default null,
  p_pin_codes     text[] default '{}',
  p_phone         text default null,
  p_email         text default null,
  p_reg_number    text default null,
  p_working_hours text default null,
  p_place_id      text default null,
  -- [{ practitioner_id? , name, speciality, qualification, reg_number, smc_id,
  --    phone, consultation_fee, is_primary }]
  p_doctors       jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_doc jsonb;
  v_pid uuid;
  v_smc int;
  v_reg text;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a business needs a name';
  end if;

  insert into businesses (
    name, vertical, address, pin_codes, phone, email,
    reg_number, working_hours, google_place_id, status
  ) values (
    btrim(p_name),
    coalesce(nullif(btrim(p_vertical), ''), 'clinic'),
    p_address,
    coalesce(p_pin_codes, '{}'),
    p_phone,
    p_email,
    p_reg_number,
    p_working_hours,
    p_place_id,
    'pending'
  )
  returning id into v_business;

  for v_doc in select * from jsonb_array_elements(coalesce(p_doctors, '[]'::jsonb))
  loop
    continue when coalesce(btrim(v_doc ->> 'name'), '') = ''
             and (v_doc ->> 'practitioner_id') is null;

    v_pid := nullif(v_doc ->> 'practitioner_id', '')::uuid;
    v_smc := nullif(v_doc ->> 'smc_id', '')::int;
    v_reg := nullif(btrim(coalesce(v_doc ->> 'reg_number', '')), '');

    -- Already on the platform? Use that person. The wizard passes
    -- practitioner_id when it matched somebody; the registration pair catches
    -- the case where it did not but the doctor is here anyway.
    if v_pid is null and v_smc is not null and v_reg is not null then
      select id into v_pid from practitioners
       where smc_id = v_smc and upper(btrim(reg_number)) = upper(v_reg);
    end if;

    if v_pid is null then
      insert into practitioners (
        full_name, speciality, qualification, reg_number, smc_id, phone, status
      ) values (
        btrim(v_doc ->> 'name'),
        nullif(btrim(coalesce(v_doc ->> 'speciality', '')), ''),
        nullif(btrim(coalesce(v_doc ->> 'qualification', '')), ''),
        v_reg,
        v_smc,
        nullif(btrim(coalesce(v_doc ->> 'phone', '')), ''),
        'pending'
      )
      returning id into v_pid;
    end if;

    -- One primary per person, so an existing doctor's main post elsewhere is
    -- left alone: a visiting attachment never steals their primary.
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

grant execute on function sehat_register_business_with_doctors(
  text, text, text, text[], text, text, text, text, text, jsonb
) to anon, authenticated;

comment on function sehat_register_business_with_doctors is
  'The whole of signup, atomically: the business, its doctors, and the links. '
  'Reachable by anon because registration happens before anybody has logged in '
  '— which is exactly why attaching cannot be a separate call, since the '
  'caller owns nothing yet. The business id is created here and never taken '
  'from the caller, so this cannot be used to attach doctors to a business '
  'somebody else owns.';
