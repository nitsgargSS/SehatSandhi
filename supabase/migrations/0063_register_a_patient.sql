-- ============================================================================
-- Sehatsandhi — registering a patient at the front desk
--
-- Run AFTER 0062. Safe to re-run.
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────
-- 0047 built the whole patient identity model — patients (the phone account),
-- patient_members (the people on it), business_patients (who is on which
-- clinic's list) — and gave it exactly one way in: the appointment trigger.
-- A patient existed if and only if somebody had booked them.
--
-- So a clinic could not register a walk-in. In Indian OPD that is most of the
-- day. The Patients tab even told them the opposite — "a patient appears here
-- once they book, scan your reception QR, or are added at the front desk" —
-- and neither of the last two existed.
--
-- ── WHY AN RPC AND NOT THREE INSERTS ────────────────────────────────────────
-- Registering one person touches three tables, and getting it wrong quietly
-- produces the bug 0047 was written to prevent: a second patient_members row
-- for someone already on the list, so their history splits in two and the
-- allergy recorded last month is not on the record the doctor opens today.
--
-- The matching rule lives here, once, rather than in whatever screen happens to
-- be calling.
--
-- ── WHAT COUNTS AS THE SAME PERSON ──────────────────────────────────────────
-- Same phone AND same name, case- and space-insensitively. Deliberately not
-- phone alone: a household shares a handset, and treating the phone as the
-- person is exactly the merge 0047 split apart. Deliberately not name alone
-- either — two Sunita Devis in one town are two people.
--
-- Reception can call this. It is identity, not clinical: 0057 gates the record,
-- not the act of writing someone's name down.
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
  p_source text default 'walk_in'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
  v_patient uuid;
  v_member uuid;
  v_name text;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'not your business';
  end if;

  v_name := btrim(coalesce(p_full_name, ''));
  if v_name = '' then raise exception 'a patient needs a name'; end if;

  -- 10 digits is what a receptionist types and what is printed on a card. The
  -- column's check constraint wants 91XXXXXXXXXX, so normalise here rather than
  -- making every caller remember.
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) = 10 then v_phone := '91' || v_phone;
  elsif length(v_phone) = 11 and left(v_phone, 1) = '0' then v_phone := '91' || substr(v_phone, 2);
  end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then
    raise exception 'that does not look like an Indian mobile number';
  end if;

  -- The phone account. One per handset; the people are the members below.
  select id into v_patient from patients where phone = v_phone;
  if v_patient is null then
    insert into patients (phone) values (v_phone) returning id into v_patient;
  end if;

  -- Same phone and same name is the same person coming back, not a new one.
  select id into v_member
    from patient_members
   where patient_id = v_patient
     and lower(btrim(full_name)) = lower(v_name)
     and status <> 'deleted'
   limit 1;

  if v_member is null then
    insert into patient_members (
      patient_id, full_name, relation, gender, age_years, date_of_birth, blood_group,
      -- The first person registered on a number is that number's owner unless
      -- reception says otherwise. Everyone after is a relative until told.
      is_self
    ) values (
      v_patient, v_name,
      coalesce(nullif(btrim(p_relation), ''), 'self'),
      p_gender, p_age_years, p_date_of_birth, p_blood_group,
      coalesce(nullif(btrim(p_relation), ''), 'self') = 'self'
        and not exists (select 1 from patient_members m where m.patient_id = v_patient and m.is_self)
    ) returning id into v_member;
  else
    -- Known person, thin record. Fill the blanks and leave anything already
    -- recorded alone — a doctor's entry outranks a hurried one at the counter.
    update patient_members
       set gender        = coalesce(gender, p_gender),
           age_years     = coalesce(age_years, p_age_years),
           date_of_birth = coalesce(date_of_birth, p_date_of_birth),
           blood_group   = coalesce(blood_group, p_blood_group),
           updated_at    = now()
     where id = v_member;
  end if;

  perform sehat_link_patient_to_business(v_member, p_business, p_source, 'registered at the front desk');

  -- The clinic's own file number, if they keep one. Set separately because the
  -- link may already have existed from a booking, and a partial unique index
  -- means a clash here has to surface rather than being swallowed.
  if coalesce(btrim(p_mrn), '') <> '' then
    begin
      update business_patients set mrn = btrim(p_mrn)
       where business_id = p_business and patient_member_id = v_member;
    exception when unique_violation then
      raise exception 'file number % is already used by another patient here', btrim(p_mrn);
    end;
  end if;

  return v_member;
end $$;

comment on function sehat_register_patient is
  'Register a walk-in: finds or creates the phone account, finds or creates the '
  'person on it, and puts them on this clinic''s list. Same phone AND same name '
  'is the same person — phone alone would merge a household, which is the bug '
  '0047 exists to prevent.';

grant execute on function sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text) to authenticated;
revoke all on function sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text) from anon;
