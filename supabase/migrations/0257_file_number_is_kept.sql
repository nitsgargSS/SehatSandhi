-- ============================================================================
-- 0257 — A returning patient keeps their file number
-- ============================================================================
-- AFTER 0256. Safe to re-run.
--
-- Reported 23 Oct 2026: a returning patient's file (MRD) number was being
-- changed, and some numbers had several file numbers for one person.
--
-- sehat_register_patient (0193) wrote whatever file number was typed over the
-- one already on record. Now it is set only where the patient has none here;
-- a different one is refused with the number they already have. (The form now
-- also asks, once the phone is typed, which person on it has come — so a
-- returning patient is picked, not typed in again under a new spelling.)
--
-- Only this function changes; it is copied from 0193 apart from the file
-- number block.
-- ============================================================================

create or replace function sehat_register_patient(
  p_business uuid,
  p_phone text,
  p_full_name text,
  p_relation text default 'self',
  p_gender text default null,
  p_age_years integer default null,
  p_date_of_birth date default null,
  p_blood_group text default null,
  p_mrn text default null,
  p_source text default 'walk_in',
  p_pin_code text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
  v_patient uuid;
  v_member uuid;
  v_name text;
  v_mrn text;
  v_pin text := nullif(regexp_replace(coalesce(p_pin_code, ''), '\D', '', 'g'), '');
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'not your business';
  end if;

  v_name := btrim(coalesce(p_full_name, ''));
  if v_name = '' then raise exception 'a patient needs a name'; end if;

  if v_pin is not null and v_pin !~ '^[1-9][0-9]{5}$' then
    raise exception 'a PIN code is 6 digits';
  end if;

  -- 0193: exactly ten digits for an Indian mobile, or a foreign number typed
  -- with + and its country code. Anything else says what is wrong.
  v_phone := sehat_patient_phone(p_phone);
  if v_phone is null then
    raise exception '%', sehat_patient_phone_problem(p_phone);
  end if;

  select id into v_patient from patients where phone = v_phone;
  if v_patient is null then
    insert into patients (phone) values (v_phone) returning id into v_patient;
  end if;

  select id into v_member
    from patient_members
   where patient_id = v_patient
     and lower(btrim(full_name)) = lower(v_name)
     and status <> 'deleted'
   limit 1;

  if v_member is null then
    insert into patient_members (
      patient_id, full_name, relation, gender, age_years, date_of_birth, blood_group,
      is_self
    ) values (
      v_patient, v_name,
      coalesce(nullif(btrim(p_relation), ''), 'self'),
      p_gender, p_age_years, p_date_of_birth, p_blood_group,
      coalesce(nullif(btrim(p_relation), ''), 'self') = 'self'
        and not exists (select 1 from patient_members m where m.patient_id = v_patient and m.is_self)
    ) returning id into v_member;
  else
    update patient_members
       set gender        = coalesce(gender, p_gender),
           age_years     = coalesce(age_years, p_age_years),
           date_of_birth = coalesce(date_of_birth, p_date_of_birth),
           blood_group   = coalesce(blood_group, p_blood_group),
           updated_at    = now()
     where id = v_member;
  end if;

  perform sehat_link_patient_to_business(v_member, p_business, p_source, 'registered at the front desk');

  -- 0257: a file number, once given, is kept. It is set only where the
  -- patient has none here; a different one typed for a returning patient is
  -- refused rather than written over theirs.
  if coalesce(btrim(p_mrn), '') <> '' then
    select nullif(btrim(mrn), '') into v_mrn
      from business_patients
     where business_id = p_business and patient_member_id = v_member;
    if v_mrn is null then
      begin
        update business_patients set mrn = btrim(p_mrn), updated_at = now()
         where business_id = p_business and patient_member_id = v_member;
      exception when unique_violation then
        raise exception 'file number % is already used by another patient here', btrim(p_mrn);
      end;
    elsif upper(v_mrn) <> upper(btrim(p_mrn)) then
      raise exception '% already has file number % here — it is kept, not replaced', v_name, v_mrn;
    end if;
  end if;

  -- Said at the counter, so it overwrites; see the header.
  if v_pin is not null then
    perform sehat_set_patient_pin(v_patient, v_pin, true);
  end if;

  return v_member;
end $$;

notify pgrst, 'reload schema';
