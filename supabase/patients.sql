-- ============================================================================
-- Sehatsandhi — patient records imported from hospital registers
--
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent.
--
-- WHAT THIS IS FOR
-- Patient phone numbers and details are transcribed from photos of a hospital
-- register and loaded here. Two consumers read the result:
--   • AISensy  — WhatsApp bot         → reads messageable_whatsapp
--   • MSG91    — transactional/promo SMS → reads messageable_sms
--
-- TWO RULES THIS SCHEMA ENFORCES, BY DESIGN
--
-- 1. NOTHING IS MESSAGEABLE UNTIL CONSENT IS RECORDED.
--    A number written in an OPD register was given for treatment, not for
--    marketing. Under the DPDP Act 2023 and TRAI's commercial-communication
--    rules, consent to be contacted is separate, purpose-bound and must be
--    auditable. So patients.consent_status defaults to 'pending', and the
--    messageable_* views return ONLY rows where it is 'granted' for that
--    channel. Import 5,000 patients and the bot sees zero of them until you
--    record a basis — that is intentional, not a bug. See "RECORDING CONSENT".
--
-- 2. HANDWRITING IS REVIEWED BEFORE IT BECOMES A PATIENT.
--    One misread digit means messaging a stranger. Transcribed register lines
--    land in patient_import_rows with a confidence flag and review_status =
--    'needs_review'. Only accepted rows are promoted into `patients`.
--
-- PII WARNING: `patients` holds names, phones and visit history. RLS is on and
-- there is deliberately NO anon/authenticated policy — the public web key
-- cannot read a single row. Only the service-role key (edge functions, and the
-- AISensy/MSG91 backends) can. Never query these tables from browser code.
-- ============================================================================

-- ============================================================================
-- Phone helpers
--
-- Canonical phone format everywhere in this schema: country code + number,
-- digits only, no '+' and no spaces — e.g. 919812345678. This matches the
-- existing `patients.phone` convention and what both AISensy and MSG91 accept.
-- ============================================================================

-- Strip everything non-numeric and normalise a 10-digit Indian mobile to 91XXXXXXXXXX.
-- Returns null when the input cannot be a valid Indian mobile, so callers can
-- route it to review instead of silently storing garbage.
create or replace function sehat_normalise_phone(raw text)
returns text language plpgsql immutable as $$
declare d text;
begin
  d := regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g');
  -- drop a leading 0 (0 98123…) or 00 91 international prefix
  if length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2); end if;
  if length(d) = 14 and left(d, 4) = '0091' then d := substr(d, 3); end if;
  if length(d) = 10 then d := '91' || d; end if;
  if d ~ '^91[6-9][0-9]{9}$' then return d; end if;
  return null;   -- landline, short, garbled, or not an Indian mobile
end $$;

-- Stable hash used by opt_outs, so a number can be suppressed without storing
-- it in the clear a second time. Uses the built-in sha256() (Postgres 11+)
-- rather than pgcrypto's digest(), which on Supabase lives in the `extensions`
-- schema and may not be on the search_path.
--
-- Note this is a lookup key, not protection: a 10-digit number space is small
-- enough to brute-force against any hash. It exists so suppression works
-- without a second plaintext copy — not as an anonymisation claim.
create or replace function sehat_phone_hash(raw text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g'), 'utf8')), 'hex')
$$;

-- ============================================================================
-- patients — one row per person. Created in schema.sql; extended here.
-- Keyed by phone (already unique there), because the phone is what both the
-- WhatsApp bot and the SMS sender address.
-- ============================================================================

-- identity & demographics
alter table patients add column if not exists phone_raw text;      -- exactly as written in the register
alter table patients add column if not exists gender text;
alter table patients add column if not exists age integer;
alter table patients add column if not exists address text;
alter table patients add column if not exists city text;
alter table patients add column if not exists district text;
alter table patients add column if not exists state text;

-- where this record came from — needed to answer "why do you have my number?"
alter table patients add column if not exists source text default 'hospital_register';
alter table patients add column if not exists source_detail text;  -- 'Sharma Hospital OPD register, Jul 2026'
alter table patients add column if not exists import_row_id uuid;  -- back-pointer to the transcribed line

-- visit summary (full history lives in patient_visits)
alter table patients add column if not exists first_visit_date date;
alter table patients add column if not exists last_visit_date date;
alter table patients add column if not exists visit_count integer default 0;

-- consent — see "RECORDING CONSENT" at the bottom of this file
alter table patients add column if not exists consent_status text default 'pending';
alter table patients add column if not exists consent_channels text[] default '{}';  -- {whatsapp,sms}
alter table patients add column if not exists consent_basis text;   -- 'signed OPD form', 'replied YES on WhatsApp'
alter table patients add column if not exists consent_at timestamptz;

-- record hygiene
alter table patients add column if not exists status text default 'active';
alter table patients add column if not exists verified boolean default false;  -- a human confirmed the transcription
alter table patients add column if not exists notes text;
alter table patients add column if not exists updated_at timestamptz default now();

-- Constraints added separately so this file stays re-runnable, and NOT VALID so
-- adding them can never fail on rows that already exist — they apply to every
-- new insert and update from here on.
do $$ begin
  alter table patients add constraint patients_phone_format
    check (phone ~ '^91[6-9][0-9]{9}$') not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table patients add constraint patients_gender_check
    check (gender is null or gender in ('male', 'female', 'other')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table patients add constraint patients_age_check
    check (age is null or age between 0 and 120) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table patients add constraint patients_consent_status_check
    check (consent_status in ('pending', 'granted', 'withdrawn', 'refused')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table patients add constraint patients_status_check
    check (status in ('active', 'duplicate', 'invalid_phone', 'deceased', 'archived')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists patients_pin_code_idx      on patients (pin_code);
create index if not exists patients_consent_idx       on patients (consent_status);
create index if not exists patients_last_visit_idx    on patients (last_visit_date desc);
create index if not exists patients_status_idx        on patients (status);

-- Keep updated_at honest.
create or replace function sehat_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists patients_touch_updated_at on patients;
create trigger patients_touch_updated_at before update on patients
  for each row execute function sehat_touch_updated_at();

-- ============================================================================
-- patient_imports — one row per batch of register photos handed over.
-- Gives every patient record a traceable origin: which register, which pages,
-- which day, who entered it.
-- ============================================================================

create table if not exists patient_imports (
  id uuid primary key default gen_random_uuid(),
  label text not null,                     -- 'OPD register, 12–14 Jul 2026, pages 3-5'
  hospital_name text,
  register_type text,                      -- OPD | IPD | lab | pharmacy | camp
  register_date_from date,
  register_date_to date,
  source_files text[],                     -- original photo filenames, for audit
  image_count integer default 0,
  rows_transcribed integer default 0,
  rows_accepted integer default 0,
  imported_by text,                        -- who did the entry
  notes text,
  created_at timestamptz default now()
);

-- ============================================================================
-- patient_import_rows — the raw transcription, exactly as read off the photo.
--
-- This is the review gate. Values stay as text (never coerced) so a bad read is
-- visible rather than silently rounded into a date or an age. raw_extra keeps
-- any column the register has that this schema doesn't, so nothing is lost.
-- ============================================================================

create table if not exists patient_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references patient_imports(id) on delete cascade,
  page_number integer,
  row_number integer,                      -- line on that page, top to bottom

  raw_name text,
  raw_phone text,
  raw_age text,
  raw_gender text,
  raw_area text,
  raw_address text,
  raw_visit_date text,
  raw_doctor text,
  raw_extra jsonb default '{}'::jsonb,     -- anything else on the register line

  -- what normalisation made of the phone; null means it could not be read as
  -- an Indian mobile and must be fixed by hand before this row can be accepted
  normalised_phone text,

  -- 'low' means the handwriting was genuinely ambiguous — never auto-accept it
  transcription_confidence text default 'medium',
  ambiguous_fields text[] default '{}',    -- e.g. {raw_phone,raw_age}

  review_status text default 'needs_review',
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,

  patient_id uuid references patients(id) on delete set null,  -- set on accept
  created_at timestamptz default now()
);

do $$ begin
  alter table patient_import_rows add constraint import_rows_confidence_check
    check (transcription_confidence in ('high', 'medium', 'low')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table patient_import_rows add constraint import_rows_review_check
    check (review_status in ('needs_review', 'accepted', 'rejected', 'duplicate')) not valid;
exception when duplicate_object then null; end $$;

-- The same register line must not be entered twice.
create unique index if not exists import_rows_unique_line
  on patient_import_rows (import_id, page_number, row_number);

create index if not exists import_rows_review_idx on patient_import_rows (review_status);
create index if not exists import_rows_phone_idx  on patient_import_rows (normalised_phone);

-- Fill normalised_phone automatically from whatever was transcribed.
create or replace function sehat_import_row_normalise()
returns trigger language plpgsql as $$
begin
  new.normalised_phone := sehat_normalise_phone(new.raw_phone);
  return new;
end $$;

drop trigger if exists import_rows_normalise on patient_import_rows;
create trigger import_rows_normalise before insert or update of raw_phone
  on patient_import_rows for each row execute function sehat_import_row_normalise();

-- ============================================================================
-- patient_visits — one row per register line that was accepted.
--
-- The register IS a visit log, so the same person recurs across dates. Keeping
-- visits separate lets `patients` stay one row per human (phone unique) without
-- throwing away the individual visits.
-- ============================================================================

create table if not exists patient_visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  visit_date date,
  hospital_name text,
  department text,
  doctor_seen text,
  notes text,
  import_row_id uuid references patient_import_rows(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists patient_visits_patient_idx on patient_visits (patient_id, visit_date desc);

-- ============================================================================
-- patient_consents — the audit trail.
--
-- consent_status on `patients` is the current state; this is how it got there.
-- Every grant and every withdrawal is appended, never updated, so you can show
-- when and on what basis a given number became contactable.
-- ============================================================================

create table if not exists patient_consents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  phone text,                              -- denormalised, survives patient deletion
  channel text,                            -- whatsapp | sms | both
  action text,                             -- granted | withdrawn | refused
  basis text,                              -- 'signed OPD consent form dated 12-07-2026'
  evidence_ref text,                       -- scan filename, form serial, message id
  recorded_by text,
  created_at timestamptz default now()
);

do $$ begin
  alter table patient_consents add constraint patient_consents_channel_check
    check (channel in ('whatsapp', 'sms', 'both')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table patient_consents add constraint patient_consents_action_check
    check (action in ('granted', 'withdrawn', 'refused')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists patient_consents_patient_idx on patient_consents (patient_id, created_at desc);

-- ============================================================================
-- opt_outs — suppression. Created in schema.sql keyed by phone_hash; extended
-- here so a number can be suppressed by writing the plain phone and letting the
-- trigger hash it. STOP replies from AISensy or MSG91 land here.
-- ============================================================================

alter table opt_outs add column if not exists phone text;
alter table opt_outs add column if not exists patient_id uuid references patients(id) on delete cascade;
alter table opt_outs add column if not exists reason text;

-- phone_hash is NOT NULL in schema.sql, so derive it whenever only phone is given.
create or replace function sehat_optout_fill_hash()
returns trigger language plpgsql as $$
begin
  if new.phone_hash is null and new.phone is not null then
    new.phone_hash := sehat_phone_hash(new.phone);
  end if;
  return new;
end $$;

drop trigger if exists optouts_fill_hash on opt_outs;
create trigger optouts_fill_hash before insert or update on opt_outs
  for each row execute function sehat_optout_fill_hash();

-- Withdrawing consent on the patient record when someone opts out. Suppression
-- must not depend on a second manual step being remembered.
create or replace function sehat_optout_withdraw_consent()
returns trigger language plpgsql as $$
begin
  update patients p
     set consent_status = 'withdrawn', consent_channels = '{}'
   where sehat_phone_hash(p.phone) = new.phone_hash;

  insert into patient_consents (patient_id, phone, channel, action, basis, recorded_by)
  select p.id, p.phone, 'both', 'withdrawn',
         coalesce(new.reason, 'opted out via ' || coalesce(new.channel, 'unknown')),
         'system:opt_out'
    from patients p
   where sehat_phone_hash(p.phone) = new.phone_hash;

  return new;
end $$;

drop trigger if exists optouts_withdraw_consent on opt_outs;
create trigger optouts_withdraw_consent after insert on opt_outs
  for each row execute function sehat_optout_withdraw_consent();

-- ============================================================================
-- message_log — what was sent, to whom, and what the provider said back.
-- AISensy and MSG91 both write delivery status here. Also the basis for
-- frequency capping: check this before sending again.
-- ============================================================================

create table if not exists message_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete set null,
  phone text not null,
  channel text not null,                   -- whatsapp | sms
  provider text,                           -- aisensy | msg91 | other
  template_name text,                      -- AISensy template / MSG91 DLT template
  dlt_template_id text,                    -- TRAI DLT id, required for Indian SMS
  campaign text,
  body_preview text,                       -- first ~160 chars, for support lookups
  status text default 'queued',
  provider_message_id text,
  error_code text,
  error_detail text,
  queued_at timestamptz default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
);

do $$ begin
  alter table message_log add constraint message_log_channel_check
    check (channel in ('whatsapp', 'sms')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table message_log add constraint message_log_status_check
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'blocked')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists message_log_phone_idx    on message_log (phone, queued_at desc);
create index if not exists message_log_status_idx   on message_log (status);
create index if not exists message_log_campaign_idx on message_log (campaign, queued_at desc);
create index if not exists message_log_provider_idx on message_log (provider_message_id);

-- ============================================================================
-- THE INTEGRATION POINT — what AISensy and MSG91 actually read.
--
-- Point the bot and the SMS sender at these views, never at `patients`. Consent,
-- opt-out, phone validity and transcription review are all baked in, so a
-- suppressed or unconsented number cannot be reached by forgetting a filter.
--
-- security_invoker = on makes the view respect the caller's RLS instead of the
-- view owner's, so these are not a way around the policies below.
-- ============================================================================

create or replace view messageable_patients as
select
  p.id            as patient_id,
  p.phone,
  p.name,
  p.lang,
  p.area,
  p.pin_code,
  p.city,
  p.district,
  p.state,
  p.gender,
  p.age,
  p.last_visit_date,
  p.visit_count,
  p.consent_channels
from patients p
where p.status = 'active'
  and p.verified = true                      -- transcription confirmed by a human
  and p.consent_status = 'granted'
  and p.phone ~ '^91[6-9][0-9]{9}$'
  and not exists (
    select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(p.phone)
  );

alter view messageable_patients set (security_invoker = on);

-- AISensy reads this one.
create or replace view messageable_whatsapp as
select * from messageable_patients where 'whatsapp' = any(consent_channels);

alter view messageable_whatsapp set (security_invoker = on);

-- MSG91 reads this one.
create or replace view messageable_sms as
select * from messageable_patients where 'sms' = any(consent_channels);

alter view messageable_sms set (security_invoker = on);

-- Progress of an import batch, for the data-entry side.
create or replace view patient_import_summary as
select
  i.id,
  i.label,
  i.hospital_name,
  i.register_date_from,
  i.register_date_to,
  count(r.id)                                                    as rows_total,
  count(*) filter (where r.review_status = 'needs_review')        as needs_review,
  count(*) filter (where r.review_status = 'accepted')            as accepted,
  count(*) filter (where r.review_status = 'rejected')            as rejected,
  count(*) filter (where r.review_status = 'duplicate')           as duplicates,
  count(*) filter (where r.normalised_phone is null)              as unreadable_phones,
  count(*) filter (where r.transcription_confidence = 'low')      as low_confidence,
  i.created_at
from patient_imports i
left join patient_import_rows r on r.import_id = i.id
group by i.id;

alter view patient_import_summary set (security_invoker = on);

-- ============================================================================
-- RLS — patient PII is service-role only.
--
-- Every table below gets RLS enabled and NO policy for anon/authenticated. In
-- Postgres, RLS with no matching policy denies, so the public web key sees
-- nothing. The service-role key bypasses RLS, which is how the edge functions
-- and the AISensy/MSG91 backends read. The explicit REVOKEs are belt and
-- braces against Supabase's default table grants.
-- ============================================================================

alter table patients             enable row level security;
alter table patient_imports      enable row level security;
alter table patient_import_rows  enable row level security;
alter table patient_visits       enable row level security;
alter table patient_consents     enable row level security;
alter table message_log          enable row level security;

revoke all on patients            from anon, authenticated;
revoke all on patient_imports     from anon, authenticated;
revoke all on patient_import_rows from anon, authenticated;
revoke all on patient_visits      from anon, authenticated;
revoke all on patient_consents    from anon, authenticated;
revoke all on message_log         from anon, authenticated;
revoke all on messageable_patients, messageable_whatsapp, messageable_sms from anon, authenticated;
revoke all on patient_import_summary from anon, authenticated;

-- opt_outs stays anon-insertable (schema.sql:97-98) so a STOP webhook or an
-- unsubscribe link can suppress a number without privileged credentials.

-- ============================================================================
-- HOW A REGISTER PHOTO BECOMES A PATIENT
--
-- Step 1 — open a batch for the photos:
--
--   insert into patient_imports (label, hospital_name, register_type,
--                               register_date_from, register_date_to,
--                               source_files, image_count, imported_by)
--   values ('OPD register 12–14 Jul 2026, pages 3-5', 'Sharma Hospital', 'OPD',
--           '2026-07-12', '2026-07-14',
--           array['IMG_4821.jpg','IMG_4822.jpg'], 2, 'nitin')
--   returning id;
--
-- Step 2 — one insert per transcribed line. Values stay as text; the trigger
-- fills normalised_phone. Mark anything the handwriting left ambiguous:
--
--   insert into patient_import_rows (import_id, page_number, row_number,
--          raw_name, raw_phone, raw_age, raw_gender, raw_area, raw_visit_date,
--          raw_doctor, transcription_confidence, ambiguous_fields)
--   values ('<import id>', 3, 1,
--           'Ramesh Kumar', '98123 45678', '42', 'M', 'Model Town', '12-07-2026',
--           'Dr. Aggarwal', 'high', '{}');
--
-- Step 3 — review. These are the rows that must not be promoted blindly:
--
--   select * from patient_import_rows
--    where import_id = '<import id>'
--      and (normalised_phone is null or transcription_confidence = 'low');
--
-- Step 4 — promote reviewed rows. Upsert by phone so a repeat visitor updates
-- rather than duplicating. Note consent is NOT set here:
--
--   with row as (select * from patient_import_rows where id = '<row id>')
--   insert into patients (phone, phone_raw, name, age, gender, area, lang,
--                         source, source_detail, import_row_id, verified,
--                         first_visit_date, last_visit_date, visit_count)
--   select r.normalised_phone, r.raw_phone, r.raw_name,
--          nullif(regexp_replace(r.raw_age, '[^0-9]', '', 'g'), '')::int,
--          case lower(left(coalesce(r.raw_gender,''),1))
--            when 'm' then 'male' when 'f' then 'female' else null end,
--          r.raw_area, 'hi', 'hospital_register',
--          (select label from patient_imports where id = r.import_id),
--          r.id, true,
--          to_date(r.raw_visit_date, 'DD-MM-YYYY'),
--          to_date(r.raw_visit_date, 'DD-MM-YYYY'), 1
--     from row r
--    where r.normalised_phone is not null
--   on conflict (phone) do update
--      set name            = coalesce(excluded.name, patients.name),
--          last_visit_date = greatest(patients.last_visit_date, excluded.last_visit_date),
--          visit_count     = patients.visit_count + 1,
--          updated_at      = now()
--   returning id;
--
--   -- then record the visit itself
--   insert into patient_visits (patient_id, visit_date, hospital_name, doctor_seen, import_row_id)
--   values ('<patient id>', '2026-07-12', 'Sharma Hospital', 'Dr. Aggarwal', '<row id>');
--
--   update patient_import_rows
--      set review_status = 'accepted', patient_id = '<patient id>',
--          reviewed_by = 'nitin', reviewed_at = now()
--    where id = '<row id>';
--
-- ============================================================================
-- RECORDING CONSENT — the step that makes a patient reachable
--
-- Until this runs, the patient exists but no bot or SMS job can see them. Do it
-- only where you actually have a basis, and say what that basis was:
--
--   insert into patient_consents (patient_id, phone, channel, action, basis,
--                                 evidence_ref, recorded_by)
--   values ('<patient id>', '919812345678', 'both', 'granted',
--           'Signed OPD consent form, dated 12-07-2026', 'form-serial-1183', 'nitin');
--
--   update patients
--      set consent_status = 'granted',
--          consent_channels = array['whatsapp','sms'],
--          consent_basis = 'Signed OPD consent form, dated 12-07-2026',
--          consent_at = now()
--    where id = '<patient id>';
--
-- If the register carries no consent line, the clean route is a one-time
-- opt-in: send a service message asking them to reply YES, and record consent
-- only for those who do. That reply is itself the evidence, and it is what
-- keeps the WhatsApp sender quality rating and the DLT registration safe.
--
-- Withdrawal needs no special handling: insert into opt_outs (phone, channel,
-- reason) and the trigger flips consent_status to 'withdrawn', logs it, and the
-- messageable_* views drop the row immediately.
-- ============================================================================
