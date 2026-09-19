-- ============================================================================
-- Sehatsandhi — record where patients come from
--
-- Run AFTER 0110. Safe to re-run.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- A business should be able to see which pincodes its patients come from and
-- which it is not reaching; the admin panel needs the same to find areas to
-- market in. Measured before writing this, none of that could be answered:
--
--   • appointments has no location at all. The bot asks every patient for a
--     pincode, uses it to find the listing (bot_pick), and drops it — bot_book_at
--     stores name, age, phone and slot only.
--   • patients has pin_code, area, district and state (0004), and no code path
--     writes any of them: not the bot, not the booking trigger (0047), not the
--     front desk (0063, whose RPC takes no location).
--   • Only the bot's MISSES are logged (unmet_demand_log). A search that found
--     doctors leaves no trace, so demand the bot served is invisible.
--
-- History cannot be recovered; this starts the record. Reports built on it
-- will show earlier bookings as area unknown.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- 1. appointments.patient_pin_code: the pincode the booking was made from.
--    bot_book_appointment passes the one the patient gave; nothing else in the
--    AiSensy flow changes, its booking node already sends p_pincode.
-- 2. The booking trigger copies it onto the patient's record — only into a
--    blank, because a pincode typed into a search is where someone was looking,
--    not necessarily where they live.
-- 3. The front desk may record a PIN (optional). That one DOES overwrite: the
--    patient is standing at the counter saying where they live.
-- 4. bot_search_log: every bot search, found or not.
--
-- district and state are filled from pincode_directory (0110) whenever a pin
-- is written, and `area` from service_areas' own name for it where we have one.
-- ============================================================================


-- ============================================================================
-- 1. The appointment remembers where it came from
-- ============================================================================

alter table appointments add column if not exists patient_pin_code text;

do $$ begin
  alter table appointments add constraint appointments_patient_pin_code_check
    check (patient_pin_code is null or patient_pin_code ~ '^[1-9][0-9]{5}$') not valid;
exception when duplicate_object then null; end $$;

create index if not exists appointments_patient_pin_idx
  on appointments (business_id, patient_pin_code) where patient_pin_code is not null;

comment on column appointments.patient_pin_code is
  'The pincode the patient booked from (the bot asks for it). Where the patient '
  'came from, not where the business is — that is practice_locations.';


-- ============================================================================
-- 2. A patient's area, filled from a pincode
-- ============================================================================

create or replace function sehat_set_patient_pin(p_patient uuid, p_pin_code text, p_overwrite boolean)
returns void language sql security definer set search_path = public as $$
  update patients p
     set pin_code = p_pin_code,
         district = coalesce(d.district, case when p_overwrite then null else p.district end),
         state    = coalesce(d.state,    case when p_overwrite then null else p.state end),
         area     = coalesce(sa.area_name, case when p_overwrite then null else p.area end)
    from (select 1) one
    left join pincode_directory d on d.pin_code = p_pin_code
    left join service_areas sa on sa.pin_code = p_pin_code
   where p.id = p_patient
     and p_pin_code ~ '^[1-9][0-9]{5}$'
     and (p_overwrite or p.pin_code is null)
     and p.pin_code is distinct from p_pin_code;
$$;

comment on function sehat_set_patient_pin is
  'Record where a patient lives: pin_code, plus district/state from '
  'pincode_directory and area from service_areas. p_overwrite = false only '
  'fills a blank.';

revoke all on function sehat_set_patient_pin(uuid, text, boolean) from public, anon, authenticated;


-- The booking trigger (0047), unchanged but for the last step.
create or replace function sehat_appointment_links_patient()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_phone  text;
  v_patient uuid;
  v_member uuid;
begin
  v_phone := sehat_normalise_phone(new.patient_phone);
  if v_phone is null or new.business_id is null then return new; end if;

  insert into patients (phone, name, source, source_detail)
  values (v_phone, new.patient_name, 'appointment', 'booked via ' || coalesce(new.booked_via, 'app'))
  on conflict (phone) do update set name = coalesce(patients.name, excluded.name)
  returning id into v_patient;

  select m.id into v_member
    from patient_members m
   where m.patient_id = v_patient
     and (
       (coalesce(btrim(new.patient_name), '') <> ''
        and lower(btrim(m.full_name)) = lower(btrim(new.patient_name)))
       or (coalesce(btrim(new.patient_name), '') = '' and m.is_self)
     )
   order by m.is_self desc
   limit 1;

  if v_member is null then
    insert into patient_members (patient_id, full_name, relation, is_self, age_years)
    values (v_patient,
            coalesce(nullif(btrim(new.patient_name), ''), 'Unnamed'),
            'other',
            not exists (select 1 from patient_members m2 where m2.patient_id = v_patient and m2.is_self),
            new.patient_age)
    returning id into v_member;
  elsif new.patient_age is not null then
    update patient_members set age_years = new.patient_age, updated_at = now()
     where id = v_member and age_years is null;
  end if;

  new.patient_member_id := v_member;
  perform sehat_link_patient_to_business(v_member, new.business_id, 'appointment',
                                         'booked via ' || coalesce(new.booked_via, 'app'));

  -- A searched pincode only fills a blank; see the header.
  if new.patient_pin_code is not null then
    perform sehat_set_patient_pin(v_patient, new.patient_pin_code, false);
  end if;

  return new;
end $$;


-- ============================================================================
-- 3. The bot stores the pincode on the booking
--
-- bot_book_at gains p_pin_code. Dropped rather than overloaded: two versions
-- differing by a defaulted argument make every existing five-argument call
-- ambiguous.
-- ============================================================================

drop function if exists bot_book_at(uuid, uuid, text, timestamptz, text);

create function bot_book_at(
  p_business_id uuid,
  p_practitioner_id uuid,
  p_patient_info text,          -- "Sunita, 34" — one attribute holding two fields
  p_slot_datetime timestamptz,
  p_phone text,
  p_pin_code text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_info  text := btrim(coalesce(p_patient_info, ''));
  v_pin   text := case when p_pin_code ~ '^[1-9][0-9]{5}$' then p_pin_code end;
  v_name  text;
  v_age   integer;
  v_biz   record;
  v_who   text;
begin
  if v_phone is null then
    return 'हमें आपका मोबाइल नंबर सही से नहीं मिला। कृपया 10 अंकों का नंबर भेजें।';
  end if;
  if p_business_id is null or p_slot_datetime is null then
    return 'आपका चयन समझ नहीं आया। कृपया सूची में से दोबारा चुनें।';
  end if;

  select b.id, b.name, b.address, b.phone
    into v_biz
    from businesses b
   where b.id = p_business_id and b.status = 'active';
  if not found then
    return 'यह लिस्टिंग अभी उपलब्ध नहीं है। कृपया सूची में से कोई और चुनें।';
  end if;

  select coalesce(
           (select p.full_name from practitioners p where p.id = p_practitioner_id),
           v_biz.name)
    into v_who;

  v_name := nullif(btrim(split_part(v_info, ',', 1)), '');
  v_age  := nullif(substring(v_info from '([0-9]{1,3})[^0-9]*$'), '')::integer;
  if v_age is not null and (v_age < 1 or v_age > 120) then v_age := null; end if;
  if v_info not like '%,%' and v_age is not null then
    v_name := nullif(btrim(regexp_replace(v_name, '[0-9]{1,3}[^0-9]*$', '')), '');
  end if;

  insert into appointments (
    patient_phone, patient_name, patient_age, business_id, practitioner_id,
    slot_datetime, status, booked_via, last_actor, last_actor_detail, patient_pin_code
  ) values (
    v_phone, v_name, v_age, v_biz.id, p_practitioner_id,
    p_slot_datetime, 'booked', 'whatsapp_bot', 'patient', 'whatsapp_bot', v_pin
  );

  return 'आपका अपॉइंटमेंट बुक हो गया ✅'
      || E'\n\n' || v_who
      || case when v_who <> v_biz.name then E'\n' || v_biz.name else '' end
      || E'\n' || bot_hi_when(p_slot_datetime)
      || case when coalesce(v_biz.address, '') <> '' then E'\n' || v_biz.address else '' end
      || E'\n\nकृपया 10 मिनट पहले पहुँचें। बदलाव के लिए यहीं मैसेज करें।';
exception
  when check_violation then
    return 'यह समय अभी-अभी भर गया। कृपया दूसरा समय चुनें।';
end $$;

revoke all on function bot_book_at(uuid, uuid, text, timestamptz, text, text)
  from public, anon, authenticated;

-- 0046's booking resolver, unchanged but for passing the pincode on.
create or replace function bot_book_appointment(
  p_speciality text,
  p_pincode text,
  p_selection text,
  p_patient_info text,
  p_slot_selection text,
  p_phone text,
  p_type text default 'doctor'
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
  v_pract    uuid;
  v_sel  text := btrim(coalesce(p_slot_selection, ''));
  v_slot timestamptz;
  v_n    integer;
begin
  select k.business_id, k.practitioner_id into v_business, v_pract
    from bot_pick(case when p_type = 'lab_booking' then 'business' else 'doctor' end,
                  case when p_type = 'lab_booking' then 'lab' else p_speciality end,
                  p_pincode, p_selection) k;

  if v_business is null then
    return 'आपका चयन समझ नहीं आया। कृपया सूची में से दोबारा चुनें।';
  end if;

  select s.slot_start into v_slot
    from bot_slot_options(v_business, v_pract) s
   where v_sel = s.label or v_sel like '%' || s.label || '%'
   order by s.rn
   limit 1;

  if v_slot is null then
    v_n := nullif(substring(v_sel from '^[0-9]+'), '')::integer;
    if v_n is not null then
      select s.slot_start into v_slot
        from bot_slot_options(v_business, v_pract) s
       where s.rn = v_n;
    end if;
  end if;

  if v_slot is null then
    return 'वह समय अब उपलब्ध नहीं है। कृपया सूची में से दोबारा समय चुनें।';
  end if;

  return bot_book_at(v_business, v_pract, p_patient_info, v_slot, p_phone,
                     bot_pincode(p_pincode));
end $$;


-- ============================================================================
-- 4. The front desk may record where the patient lives
--
-- sehat_register_patient (0063) gains an optional p_pin_code, last and
-- defaulted. Dropped and recreated for the same reason as bot_book_at.
-- ============================================================================

drop function if exists sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text);

create function sehat_register_patient(
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

  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) = 10 then v_phone := '91' || v_phone;
  elsif length(v_phone) = 11 and left(v_phone, 1) = '0' then v_phone := '91' || substr(v_phone, 2);
  end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then
    raise exception 'that does not look like an Indian mobile number';
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

  if coalesce(btrim(p_mrn), '') <> '' then
    begin
      update business_patients set mrn = btrim(p_mrn)
       where business_id = p_business and patient_member_id = v_member;
    exception when unique_violation then
      raise exception 'file number % is already used by another patient here', btrim(p_mrn);
    end;
  end if;

  -- Said at the counter, so it overwrites; see the header.
  if v_pin is not null then
    perform sehat_set_patient_pin(v_patient, v_pin, true);
  end if;

  return v_member;
end $$;

comment on function sehat_register_patient is
  'Register a walk-in: finds or creates the phone account, finds or creates the '
  'person on it, and puts them on this clinic''s list. Same phone AND same name '
  'is the same person — phone alone would merge a household, which is the bug '
  '0047 exists to prevent. p_pin_code, optional, records where they live.';

revoke all on function sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text, text)
  from public, anon;
grant execute on function sehat_register_patient(uuid, text, text, text, text, integer, date, text, text, text, text)
  to authenticated;


-- ============================================================================
-- 5. Every bot search, found or not
--
-- Its own table rather than site_events: that is the website's visitor log,
-- and its search counts feed the platform report as website traffic. The
-- demand reports read both. No phone and no patient — a search is counted,
-- not attributed.
-- ============================================================================

create table if not exists bot_search_log (
  id bigserial primary key,
  branch text not null,          -- doctor | lab_booking | lab_callback | pharmacy | ambulance | camps
  speciality text,               -- the resolved code on the doctor branch
  pin_code text,                 -- as resolved by bot_pincode; null when unreadable
  raw_place text,                -- what the patient typed, when it did not resolve
  found boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists bot_search_log_created_idx on bot_search_log (created_at desc);
create index if not exists bot_search_log_pin_idx on bot_search_log (pin_code, created_at desc)
  where pin_code is not null;

alter table bot_search_log enable row level security;
-- No policies: written by the security-definer search below, read by reports.

comment on table bot_search_log is
  'One row per WhatsApp bot search, found or not. Counts demand; carries no '
  'phone or patient.';

-- 0107's search, unchanged but for the log line.
create or replace function bot_generic_search_json(
  p_type text,
  p_filter_value text,
  p_pincode text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_branch text := bot_branch(p_type, p_filter_value);
  v_pin    text := bot_pincode(p_pincode);
  v_text   text := bot_generic_search(v_branch, p_filter_value, p_pincode);
begin
  insert into bot_search_log (branch, speciality, pin_code, raw_place, found)
  values (v_branch,
          case when v_branch = 'doctor' then bot_speciality_code(p_filter_value) end,
          v_pin,
          case when v_pin is null then nullif(left(btrim(coalesce(p_pincode, '')), 40), '') end,
          v_text is not null);

  if v_text is not null then
    return jsonb_build_object(
      'found', true,
      'route', case when v_branch in ('doctor', 'lab_booking') then 'list' else 'info' end,
      'text',  v_text);
  end if;

  return jsonb_build_object('found', false, 'route', 'none', 'text',
    case
      when v_pin is null then
        'हमें आपका शहर या PIN कोड समझ नहीं आया। '
        || 'कृपया अपना 6 अंकों का PIN कोड भेजें (जैसे 135001)।'
      when v_branch = 'lab_booking' then
        'आपके क्षेत्र में अभी कोई जांच लैब उपलब्ध नहीं है। '
        || 'कृपया पास का PIN कोड आज़माएँ।'
      else
        'आपके क्षेत्र में अभी इस स्पेशलिटी के डॉक्टर उपलब्ध नहीं हैं। '
        || 'कृपया दूसरी स्पेशलिटी या पास का PIN कोड आज़माएँ।'
    end);
end $$;

revoke all on function bot_generic_search_json(text, text, text) from public, anon, authenticated;
grant execute on function bot_generic_search_json(text, text, text) to anon, authenticated;
