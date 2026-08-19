-- ============================================================================
-- Sehatsandhi — the clinical record: whose patient, seen when, and what for
--
-- Run AFTER 0046. Safe to re-run.
--
-- This is the foundation of the patient-records product: the per-clinic patient
-- list, the people inside a phone number, the visit and its clinical content,
-- and the consent that has to exist before a consultation may be recorded.
-- Billing, prescriptions/documents and the consultation-recording pipeline sit
-- on top of this and land in later migrations.
--
-- ── WHAT WAS ALREADY HERE, AND IS REUSED RATHER THAN REBUILT ────────────────
--   patients          one row per phone, demographics, consent state (0004)
--   patient_visits    a visit log, built for hospital-register imports (0004)
--   patient_consents  append-only consent audit: action, basis, evidence (0004)
--   wa_entry_points   one row per QR poster, with grants_marketing_consent (0005)
--   sehat_wa_handle_inbound  turns a scan into a contact and a patient (0005)
--
-- The QR-at-reception flow is mostly built already. What it could not do is say
-- WHICH clinic's reception the poster was on, so a scan could not put anyone on
-- a particular doctor's list. That is fixed here.
--
-- ── THE THING THAT HAD TO BE FIXED FIRST ────────────────────────────────────
-- patients.phone is UNIQUE, so one phone was one person. Indian households
-- share a handset: a mother books for two children and her father-in-law on the
-- same number. Under the old shape those four people are one row, which means
-- one merged medical record — the wrong allergy against the wrong child.
--
-- So `patients` becomes the CONTACT (a phone, its consent state, its language)
-- and patient_members are the PEOPLE. Every clinical row below hangs off a
-- member, never off the phone. Existing rows are backfilled one-member-each, so
-- nothing already recorded changes meaning.
--
-- ── WHOSE RECORD IS IT ──────────────────────────────────────────────────────
-- Own-clinic-only, by decision. Every clinical table carries business_id and
-- every policy resolves through sehat_caller_owns_business(), so one clinic
-- cannot read another's notes even for a patient they share.
--
-- The honest cost of that choice is allergies: if Dr A records a penicillin
-- reaction, Dr B cannot see it. That is a real clinical downside, accepted for
-- now because the alternative is a consent surface nobody has agreed yet. When
-- cross-clinic sharing arrives it should arrive as patient-granted access per
-- business (ABDM's model), not as a flag that opens everything.
--
-- ── RECORDING A CONSULTATION ────────────────────────────────────────────────
-- Consent is the patient's to give, not the clinic's to assume, so
-- consultation_recordings.consent_id is NOT NULL and references a granted
-- recording consent. The schema itself refuses to hold a recording that nobody
-- agreed to; it is not left to the UI to remember.
--
-- Audio is transitional. It exists to be transcribed, the doctor confirms or
-- corrects the draft, and then it is deleted — audio_deleted_at records when.
-- What survives is the confirmed note, because a machine transcript of a
-- clinical instruction is a draft and never a medical record: speech
-- recognition mishearing "15 mg" as "50 mg" writes a wrong dose, so nothing
-- reaches a prescription until a doctor has signed it off.
-- ============================================================================


-- ============================================================================
-- 1. The people inside a phone number
-- ============================================================================

create table if not exists patient_members (
  id uuid primary key default gen_random_uuid(),
  -- The phone account this person is reachable on. Several members share one.
  patient_id uuid not null references patients(id) on delete cascade,

  full_name text not null,
  -- Who they are to the account holder. 'self' is the person whose phone it is.
  relation text not null default 'self'
    check (relation in ('self','spouse','child','parent','sibling','other')),
  is_self boolean not null default false,

  gender text check (gender is null or gender in ('male','female','other')),
  date_of_birth date,
  -- Kept alongside DOB because registers and patients themselves give an age,
  -- not a birthday. age_years is what was said; date_of_birth is what is known.
  age_years integer check (age_years is null or age_years between 0 and 130),
  blood_group text check (blood_group is null or blood_group in
    ('A+','A-','B+','B-','AB+','AB-','O+','O-')),

  -- India's health ID. Null until a patient links one; stored so records can be
  -- pushed to ABDM later without a migration to find room for it.
  abha_number text,
  abha_address text,

  status text not null default 'active' check (status in ('active','merged','deleted')),
  -- Set when this row was folded into another after a duplicate was found.
  merged_into uuid references patient_members(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patient_members_patient_idx on patient_members (patient_id);
create index if not exists patient_members_name_idx
  on patient_members using gin (to_tsvector('simple', full_name));
create unique index if not exists patient_members_one_self
  on patient_members (patient_id) where is_self;

comment on table patient_members is
  'A person. `patients` is the phone they are reachable on, which a household '
  'shares — so every clinical record hangs off a member and never off the '
  'phone, or a mother and her children end up sharing one medical history.';
comment on column patient_members.age_years is
  'What the patient said. date_of_birth is what is known. A register line gives '
  'an age and never a birthday, so storing only DOB would mean inventing one.';

-- Backfill: every existing patient becomes the 'self' member of their own
-- phone, carrying the demographics that were on the phone row.
insert into patient_members (patient_id, full_name, relation, is_self, gender, age_years, created_at)
select p.id, coalesce(nullif(btrim(p.name), ''), 'Unnamed'), 'self', true,
       case lower(coalesce(p.gender, ''))
         when 'm' then 'male' when 'male' then 'male'
         when 'f' then 'female' when 'female' then 'female'
         else null end,
       p.age, coalesce(p.created_at, now())
  from patients p
 where not exists (select 1 from patient_members m where m.patient_id = p.id);


-- ============================================================================
-- 2. The doctor's list — who is a patient OF this business
--
-- The join that makes "my database" mean something. A person exists once on the
-- platform; this says which clinics have actually seen them, and how they
-- arrived — the QR at reception, an appointment, or the front desk.
-- ============================================================================

create table if not exists business_patients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,

  -- The clinic's own file number. Clinics think in file numbers, not uuids, and
  -- a patient asked "what's your number?" can answer this one.
  mrn text,

  source text not null default 'walk_in'
    check (source in ('qr_reception','appointment','walk_in','import','bot','referral')),
  source_detail text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  visit_count integer not null default 0,

  -- Clinic-private. The patient never sees these and they are not shared.
  notes text,

  status text not null default 'active' check (status in ('active','inactive','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (business_id, patient_member_id)
);

create unique index if not exists business_patients_mrn_idx
  on business_patients (business_id, upper(btrim(mrn)))
  where mrn is not null and btrim(mrn) <> '';
create index if not exists business_patients_recent_idx
  on business_patients (business_id, last_seen_at desc nulls last);

comment on table business_patients is
  'Which clinics have seen which people. One row per (business, person): the '
  'doctor''s patient list, and the boundary every clinical policy below '
  'resolves against.';


-- ============================================================================
-- 3. A visit, and what happened in it
--
-- patient_visits already exists from the register import, where a visit was a
-- transcribed line with the hospital and doctor as free text. Those columns stay
-- for imported history; new visits carry real references.
-- ============================================================================

alter table patient_visits add column if not exists patient_member_id uuid references patient_members(id) on delete cascade;
alter table patient_visits add column if not exists business_id uuid references businesses(id) on delete cascade;
alter table patient_visits add column if not exists practitioner_id uuid references practitioners(id) on delete set null;
alter table patient_visits add column if not exists appointment_id uuid references appointments(id) on delete set null;

alter table patient_visits add column if not exists visit_type text default 'opd';
alter table patient_visits add column if not exists chief_complaint text;
alter table patient_visits add column if not exists diagnosis text;
alter table patient_visits add column if not exists icd10_code text;
alter table patient_visits add column if not exists advice text;
-- The commercial hook: a due date is what the WhatsApp bot can act on, and a
-- recalled patient is a repeat visit the clinic would otherwise have lost.
alter table patient_visits add column if not exists follow_up_due date;
alter table patient_visits add column if not exists follow_up_reminded_at timestamptz;
alter table patient_visits add column if not exists created_by uuid references practitioners(id) on delete set null;
alter table patient_visits add column if not exists updated_at timestamptz default now();

do $$ begin
  alter table patient_visits add constraint patient_visits_type_check
    check (visit_type in ('opd','ipd','followup','teleconsult','procedure','emergency')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists patient_visits_member_idx
  on patient_visits (patient_member_id, visit_date desc);
create index if not exists patient_visits_business_idx
  on patient_visits (business_id, visit_date desc);
create index if not exists patient_visits_followup_idx
  on patient_visits (follow_up_due) where follow_up_due is not null and follow_up_reminded_at is null;

-- Imported visits belong to the 'self' member of their phone. They have no
-- business_id: nobody knows which listing "Sharma Hospital" in a register line
-- refers to, and guessing would put another clinic's history on someone's list.
update patient_visits v
   set patient_member_id = m.id
  from patient_members m
 where v.patient_member_id is null and m.patient_id = v.patient_id and m.is_self;

comment on column patient_visits.business_id is
  'Null for rows imported from a paper register: the hospital was free text and '
  'resolving it to a listing would be a guess. Every visit created in the app '
  'has one.';


-- ── Vitals. One row per reading, so a trend is a query and not a rewrite. ───

create table if not exists patient_vitals (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references patient_visits(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,

  recorded_at timestamptz not null default now(),
  bp_systolic integer  check (bp_systolic  is null or bp_systolic  between 40 and 300),
  bp_diastolic integer check (bp_diastolic is null or bp_diastolic between 20 and 200),
  pulse integer        check (pulse is null or pulse between 20 and 250),
  temperature_c numeric(4,1),
  weight_kg numeric(5,2),
  height_cm numeric(5,1),
  spo2 integer check (spo2 is null or spo2 between 50 and 100),
  blood_sugar_mg_dl integer,
  blood_sugar_type text check (blood_sugar_type is null or blood_sugar_type in ('fasting','pp','random','hba1c')),
  notes text,
  recorded_by uuid references practitioners(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists patient_vitals_member_idx
  on patient_vitals (patient_member_id, recorded_at desc);

comment on table patient_vitals is
  'One row per reading. Storing the latest on the patient would lose the trend, '
  'which is the part a doctor actually reads.';


-- ── Allergies. The loudest thing on a patient header, by design. ───────────

create table if not exists patient_allergies (
  id uuid primary key default gen_random_uuid(),
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,

  substance text not null,                 -- 'Penicillin', 'Sulpha', 'Peanut'
  category text check (category is null or category in ('drug','food','environment','other')),
  reaction text,                           -- 'rash', 'anaphylaxis'
  severity text check (severity is null or severity in ('mild','moderate','severe')),
  noted_on date default current_date,
  is_active boolean not null default true,
  recorded_by uuid references practitioners(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists patient_allergies_member_idx
  on patient_allergies (patient_member_id) where is_active;

comment on table patient_allergies is
  'Scoped to the business that recorded it, per the own-clinic-only rule. This '
  'is the one place that rule has a clinical cost — another clinic cannot see a '
  'reaction recorded here — and the first thing cross-clinic sharing should fix.';


-- ── Problem list and current medication ────────────────────────────────────

create table if not exists patient_conditions (
  id uuid primary key default gen_random_uuid(),
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,

  condition text not null,                 -- 'Type 2 Diabetes'
  icd10_code text,
  status text not null default 'active' check (status in ('active','resolved','inactive')),
  onset_date date,
  resolved_date date,
  notes text,
  recorded_by uuid references practitioners(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patient_conditions_member_idx
  on patient_conditions (patient_member_id) where status = 'active';

create table if not exists patient_medications (
  id uuid primary key default gen_random_uuid(),
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  visit_id uuid references patient_visits(id) on delete set null,

  drug_name text not null,
  strength text,                           -- '500 mg'
  dosage text,                             -- '1-0-1'
  duration text,                           -- '5 days'
  instructions text,                       -- 'after food'
  started_on date default current_date,
  stopped_on date,
  is_current boolean not null default true,
  recorded_by uuid references practitioners(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists patient_medications_member_idx
  on patient_medications (patient_member_id) where is_current;

comment on table patient_medications is
  'What the patient is on now, so duplication and interactions are visible at '
  'the point of prescribing. A prescription issued on a visit is a separate '
  'artefact and lands with the documents work.';


-- ============================================================================
-- 4. Consent, extended rather than replaced
--
-- patient_consents is already an append-only audit with an action, a basis and
-- an evidence reference. What it could not express is what the consent was FOR:
-- agreeing to health updates on WhatsApp is not agreeing to be recorded, and
-- 0005 is explicit that two kinds of consent must not be conflated.
-- ============================================================================

alter table patient_consents add column if not exists purpose text default 'marketing';
alter table patient_consents add column if not exists patient_member_id uuid references patient_members(id) on delete cascade;
alter table patient_consents add column if not exists business_id uuid references businesses(id) on delete set null;
alter table patient_consents add column if not exists expires_at timestamptz;

do $$ begin
  alter table patient_consents add constraint patient_consents_purpose_check
    check (purpose in ('marketing','recording','records_sharing','research')) not valid;
exception when duplicate_object then null; end $$;

-- 'in_person' matters here: consent to be recorded is given in the room, on a
-- form or verbally, not over a messaging channel.
alter table patient_consents drop constraint if exists patient_consents_channel_check;
do $$ begin
  alter table patient_consents add constraint patient_consents_channel_check
    check (channel in ('whatsapp','sms','both','in_person','web')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists patient_consents_purpose_idx
  on patient_consents (patient_member_id, purpose, created_at desc);

comment on column patient_consents.purpose is
  'What was agreed to. Consent to health updates on WhatsApp is not consent to '
  'be recorded in a consulting room — see 0005 on why these are tracked apart.';

-- Is there a live, un-withdrawn consent of this kind right now? The append-only
-- log means the answer is "the most recent action", not "a row exists".
create or replace function sehat_has_consent(
  p_member uuid, p_purpose text, p_business uuid default null
) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.action = 'granted'
       and (c.expires_at is null or c.expires_at > now())
      from patient_consents c
     where c.patient_member_id = p_member
       and c.purpose = p_purpose
       and (p_business is null or c.business_id is null or c.business_id = p_business)
     order by c.created_at desc
     limit 1
  ), false);
$$;

comment on function sehat_has_consent is
  'The current state of one kind of consent, read off the top of the audit '
  'trail. A withdrawal is a newer row, not a deletion, so "a row exists" is '
  'never the right question.';


-- ============================================================================
-- 5. Recording a consultation
--
-- consent_id is NOT NULL on purpose: the schema will not hold a recording that
-- nobody agreed to, so the rule survives a UI bug.
-- ============================================================================

create table if not exists consultation_recordings (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references patient_visits(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  practitioner_id uuid references practitioners(id) on delete set null,

  -- The consent this recording rests on. Not nullable, and checked again by
  -- trigger below because a foreign key cannot say "and it must be granted".
  consent_id uuid not null references patient_consents(id),

  status text not null default 'recording'
    check (status in ('recording','transcribing','draft','confirmed','discarded','failed')),

  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,

  -- Where the audio is WHILE it exists. Nulled when the audio is deleted, which
  -- is the normal end state: audio is transitional, the note is the record.
  audio_path text,
  audio_deleted_at timestamptz,

  -- What the machine heard. Never shown as clinical fact and never the source
  -- of a prescription — a mis-heard dose is a real harm, so a human signs off.
  transcript_draft text,
  transcript_language text default 'hi',
  transcript_engine text,
  -- What the doctor confirmed. This is the medical record.
  transcript_confirmed text,
  confirmed_by uuid references practitioners(id) on delete set null,
  confirmed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consultation_recordings_visit_idx on consultation_recordings (visit_id);
create index if not exists consultation_recordings_pending_audio_idx
  on consultation_recordings (started_at) where audio_path is not null and audio_deleted_at is null;

comment on table consultation_recordings is
  'A recorded consultation, from capture to a confirmed note. Audio is '
  'transitional and deleted once the doctor has confirmed the transcript; what '
  'survives is transcript_confirmed. consent_id is not nullable so a recording '
  'without agreement cannot be stored at all.';
comment on column consultation_recordings.transcript_draft is
  'What speech recognition heard. A draft, always: "15 mg" misheard as "50 mg" '
  'is a wrong dose in a medical record, so nothing here reaches a prescription '
  'until a doctor has confirmed it.';

-- A foreign key can require a consent row; only a trigger can require that the
-- consent is the right kind, belongs to this patient, and is still granted.
create or replace function sehat_recording_needs_consent()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select c.action = 'granted'
     and c.purpose = 'recording'
     and c.patient_member_id = new.patient_member_id
     and (c.expires_at is null or c.expires_at > now())
    into v_ok
    from patient_consents c where c.id = new.consent_id;

  if not coalesce(v_ok, false) then
    raise exception
      'consent % is not a live recording consent for this patient', new.consent_id
      using errcode = 'check_violation';
  end if;

  -- Withdrawal after the fact stops the recording being kept, so re-check the
  -- current state rather than trusting the row that was cited at the start.
  if not sehat_has_consent(new.patient_member_id, 'recording', new.business_id) then
    raise exception 'recording consent has been withdrawn for this patient'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists consultation_recordings_consent on consultation_recordings;
create trigger consultation_recordings_consent
  before insert or update of consent_id, patient_member_id on consultation_recordings
  for each row execute function sehat_recording_needs_consent();


-- ============================================================================
-- 6. Who looked at whose record
--
-- Health data needs an access trail, and it is also the answer when a hospital
-- asks what stops a receptionist browsing their neighbour's file.
-- ============================================================================

create table if not exists patient_record_access (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete set null,
  patient_member_id uuid references patient_members(id) on delete set null,
  actor_auth_uid uuid,
  actor_practitioner_id uuid references practitioners(id) on delete set null,
  action text not null check (action in ('search','view','create','update','export','email','print')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists patient_record_access_patient_idx
  on patient_record_access (patient_member_id, created_at desc);
create index if not exists patient_record_access_business_idx
  on patient_record_access (business_id, created_at desc);

comment on table patient_record_access is
  'Append-only. Never updated, never deleted — an audit trail that can be '
  'edited is not one.';


-- ============================================================================
-- 7. Getting onto a doctor's list, without anyone remembering to do it
-- ============================================================================

-- A QR poster belongs to a clinic. wa_entry_points knew the poster's location
-- as free text but not which listing it stood in, so a scan could not put
-- anyone on a particular doctor's list — the gap between the QR flow that
-- exists and the QR flow that was asked for.
alter table wa_entry_points add column if not exists business_id uuid references businesses(id) on delete cascade;

comment on column wa_entry_points.business_id is
  'The clinic whose reception this poster stands in. A scan adds the patient to '
  'that clinic''s list; null means a platform-wide entry point that adds them '
  'to nobody''s.';

-- Put a person on a clinic's list, or touch them if they are already on it.
create or replace function sehat_link_patient_to_business(
  p_member uuid, p_business uuid, p_source text default 'walk_in', p_detail text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_member is null or p_business is null then return null; end if;

  insert into business_patients (business_id, patient_member_id, source, source_detail, last_seen_at)
  values (p_business, p_member, coalesce(p_source, 'walk_in'), p_detail, now())
  on conflict (business_id, patient_member_id) do update
    set last_seen_at = now(),
        -- The first way someone arrived is the interesting one; a later walk-in
        -- should not overwrite "found us through the QR at reception".
        source_detail = coalesce(business_patients.source_detail, excluded.source_detail)
  returning id into v_id;

  return v_id;
end $$;

-- Anyone who books lands on the list, whichever channel booked them.
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

  -- Match the person by name within the phone, so a mother booking for her
  -- child creates the child rather than overwriting herself. An unnamed booking
  -- falls back to the account holder.
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
  return new;
end $$;

alter table appointments add column if not exists patient_member_id uuid references patient_members(id) on delete set null;
create index if not exists appointments_member_idx on appointments (patient_member_id);

drop trigger if exists appointments_link_patient on appointments;
create trigger appointments_link_patient
  before insert on appointments
  for each row execute function sehat_appointment_links_patient();

comment on function sehat_appointment_links_patient is
  'Every booking puts its patient on the clinic''s list, from the bot, the '
  'dashboard or anywhere else. A trigger rather than a step each caller has to '
  'remember, for the same reason 0008 made notification a trigger.';

-- Keep the visit counters honest.
create or replace function sehat_visit_touches_patient()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.patient_member_id is null or new.business_id is null then return new; end if;

  perform sehat_link_patient_to_business(new.patient_member_id, new.business_id, 'walk_in', null);

  update business_patients
     set visit_count = visit_count + 1,
         last_seen_at = greatest(coalesce(last_seen_at, 'epoch'::timestamptz),
                                 coalesce(new.visit_date::timestamptz, now())),
         updated_at = now()
   where business_id = new.business_id and patient_member_id = new.patient_member_id;

  return new;
end $$;

drop trigger if exists patient_visits_touch on patient_visits;
create trigger patient_visits_touch after insert on patient_visits
  for each row execute function sehat_visit_touches_patient();


-- ============================================================================
-- 8. What the doctor searches, and what they see
-- ============================================================================

-- Name or phone, across this caller's own clinics only.
create or replace function sehat_search_patients(p_query text, p_business uuid default null)
returns table (
  patient_member_id uuid, business_id uuid, full_name text, relation text,
  phone text, age_years integer, gender text, mrn text,
  last_seen_at timestamptz, visit_count integer
)
language sql stable security definer set search_path = public as $$
  with q as (select btrim(coalesce(p_query, '')) as raw)
  select m.id, bp.business_id, m.full_name, m.relation,
         p.phone, m.age_years, m.gender, bp.mrn,
         bp.last_seen_at, bp.visit_count
    from business_patients bp
    join patient_members m on m.id = bp.patient_member_id
    join patients p on p.id = m.patient_id
   cross join q
   where bp.business_id in (select sehat_caller_business_ids())
     and (p_business is null or bp.business_id = p_business)
     and m.status = 'active'
     and q.raw <> ''
     and (
       m.full_name ilike '%' || q.raw || '%'
       or p.phone like '%' || regexp_replace(q.raw, '[^0-9]', '', 'g') || '%'
       or upper(coalesce(bp.mrn, '')) = upper(q.raw)
     )
   order by bp.last_seen_at desc nulls last, m.full_name
   limit 50;
$$;

comment on function sehat_search_patients is
  'Search a clinic''s own patients by name, phone or file number. Scoped by '
  'sehat_caller_business_ids(), so a clinic cannot reach another''s list even '
  'for someone they both see.';

-- The patient header: everything that must be visible before prescribing.
create or replace view patient_summary as
  select
    m.id as patient_member_id,
    bp.business_id,
    m.full_name, m.relation, m.gender, m.age_years, m.date_of_birth,
    m.blood_group, m.abha_number,
    p.phone, p.lang, p.pin_code, p.area,
    bp.mrn, bp.source, bp.first_seen_at, bp.last_seen_at, bp.visit_count,
    (select count(*) from patient_visits v
      where v.patient_member_id = m.id and v.business_id = bp.business_id) as visits_here,
    (select array_agg(a.substance order by a.severity desc nulls last)
       from patient_allergies a
      where a.patient_member_id = m.id and a.business_id = bp.business_id and a.is_active) as allergies,
    (select array_agg(c.condition order by c.created_at)
       from patient_conditions c
      where c.patient_member_id = m.id and c.business_id = bp.business_id and c.status = 'active') as conditions,
    (select max(v.follow_up_due) from patient_visits v
      where v.patient_member_id = m.id and v.business_id = bp.business_id
        and v.follow_up_due >= current_date) as next_follow_up,
    sehat_has_consent(m.id, 'recording', bp.business_id) as recording_consent
  from business_patients bp
  join patient_members m on m.id = bp.patient_member_id
  join patients p on p.id = m.patient_id
 where bp.business_id in (select sehat_caller_business_ids());

comment on view patient_summary is
  'The patient header. Allergies and conditions are arrays rather than a join '
  'so the one screen a doctor reads before prescribing is a single row.';

-- Appointments with the person attached, for the clinic's own page.
create or replace view business_appointment_list as
  select
    a.id as appointment_id, a.business_id, a.practitioner_id,
    a.slot_datetime, a.status, a.booked_via, a.location_id,
    a.patient_phone, a.patient_name, a.patient_age,
    a.patient_member_id,
    m.full_name as member_name, bp.mrn,
    pr.full_name as practitioner_name
  from appointments a
  left join patient_members m on m.id = a.patient_member_id
  left join business_patients bp
    on bp.patient_member_id = a.patient_member_id and bp.business_id = a.business_id
  left join practitioners pr on pr.id = a.practitioner_id
 where a.business_id in (select sehat_caller_business_ids());


-- ============================================================================
-- 9. RLS — a clinic sees its own patients and nobody else's
-- ============================================================================

alter table patient_members          enable row level security;
alter table business_patients        enable row level security;
alter table patient_vitals           enable row level security;
alter table patient_allergies        enable row level security;
alter table patient_conditions       enable row level security;
alter table patient_medications      enable row level security;
alter table consultation_recordings  enable row level security;
alter table patient_record_access    enable row level security;

-- Every clinical table is scoped the same way, so the rule is one rule.
do $$
declare t text;
begin
  foreach t in array array[
    'business_patients','patient_vitals','patient_allergies',
    'patient_conditions','patient_medications','consultation_recordings'
  ] loop
    execute format('drop policy if exists "clinic_reads_%1$s" on %1$I', t);
    execute format(
      'create policy "clinic_reads_%1$s" on %1$I for select using (sehat_caller_owns_business(business_id))', t);

    execute format('drop policy if exists "clinic_writes_%1$s" on %1$I', t);
    execute format(
      'create policy "clinic_writes_%1$s" on %1$I for insert with check (sehat_caller_owns_business(business_id))', t);

    execute format('drop policy if exists "clinic_updates_%1$s" on %1$I', t);
    execute format(
      'create policy "clinic_updates_%1$s" on %1$I for update using (sehat_caller_owns_business(business_id)) with check (sehat_caller_owns_business(business_id))', t);
  end loop;
end $$;

-- A person is readable to any clinic that has them on its list — the join is
-- the permission, so there is no separate grant to keep in step.
drop policy if exists "clinic_reads_members" on patient_members;
create policy "clinic_reads_members" on patient_members
  for select using (
    exists (select 1 from business_patients bp
             where bp.patient_member_id = patient_members.id
               and sehat_caller_owns_business(bp.business_id))
    or sehat_is_admin()
  );

drop policy if exists "clinic_writes_members" on patient_members;
create policy "clinic_writes_members" on patient_members
  for insert with check (auth.uid() is not null);

drop policy if exists "clinic_updates_members" on patient_members;
create policy "clinic_updates_members" on patient_members
  for update using (
    exists (select 1 from business_patients bp
             where bp.patient_member_id = patient_members.id
               and sehat_caller_owns_business(bp.business_id))
  ) with check (true);

-- Append-only: an audit trail nobody can rewrite. No update or delete policy
-- exists, so neither is possible however the caller arrives.
drop policy if exists "clinic_writes_access_log" on patient_record_access;
create policy "clinic_writes_access_log" on patient_record_access
  for insert with check (sehat_caller_owns_business(business_id));

drop policy if exists "clinic_reads_access_log" on patient_record_access;
create policy "clinic_reads_access_log" on patient_record_access
  for select using (sehat_caller_owns_business(business_id) or sehat_is_admin());

grant select on patient_summary, business_appointment_list to authenticated;
grant execute on function sehat_search_patients(text, uuid)                 to authenticated;
grant execute on function sehat_has_consent(uuid, text, uuid)               to authenticated;
grant execute on function sehat_link_patient_to_business(uuid, uuid, text, text) to authenticated;

-- Patient data is never readable with the anon key. The website ships that key
-- in its bundle, so anything granted to anon is public.
revoke all on function sehat_search_patients(text, uuid)                  from anon;
revoke all on function sehat_link_patient_to_business(uuid, uuid, text, text) from anon;
revoke all on function sehat_has_consent(uuid, text, uuid)                from anon;


-- ============================================================================
-- WHAT IS DELIBERATELY NOT HERE
--
--   Prescriptions and uploaded documents  — the next slice. A prescription is
--     an artefact with a signature, a format and an email path, not a text
--     column, and it depends on the confirmed-transcript rule above.
--   Patient billing (OPD/IPD/medicines/tests)  — its own ledger. It must NOT
--     reuse invoices/payments: those bill CLINICS for their Sehatsandhi
--     listing, and merging the two puts clinic revenue and our revenue in one
--     pot with the same GST machinery over both.
--   IPD admission, beds, daily notes, discharge summary.
--   The transcription pipeline itself (an edge function calling an ASR
--     service), and the audio-deletion job that empties audio_path once a
--     transcript is confirmed.
--   Cross-clinic sharing, which should arrive as patient-granted access per
--     business rather than a flag.
-- ============================================================================
