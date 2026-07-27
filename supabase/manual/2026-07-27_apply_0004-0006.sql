-- ============================================================================
-- Sehatsandhi — apply migrations 0004, 0005 and 0006 by hand
--
-- Generated 2026-07-27. Paste this whole file into:
--   Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- Run it on SANDBOX first, then production. Everything here is idempotent, so
-- re-running is safe.
--
-- WHAT IT DOES
--   0004  patients + register-import tables, consent log, visits, messaging views
--   0005  inbound WhatsApp contacts, sessions, QR opt-in entry points
--   0006  pricing plans (the toggle), price locking, per-vertical billing split,
--         and a fix for payments so type='listing' inserts stop failing
--
-- WHY THE schema_migrations INSERTS ARE HERE
-- The repo has a migration runner (npm run migrate) that keeps a ledger in
-- public.schema_migrations. Running SQL by hand leaves that ledger empty, and
-- the runner would then try to apply these again later. Each section below
-- records itself with the exact checksum the runner computes, so the two stay
-- in agreement and `npm run migrate:status` reports these as already applied.
--
-- IMPORTANT: this file does NOT include migrations 0002 and 0003 (the
-- create_listing function). Those came from the sandbox work, not this change.
-- Check with whoever wrote them whether production already has them.
-- ============================================================================

-- The runner's ledger. Schema-qualified deliberately: a pg_dump preamble can
-- empty the search_path for the session, and an unqualified name then fails to
-- resolve even though the table exists.
create table if not exists public.schema_migrations (
  version    text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);


-- ============================================================================
-- BEGIN 0004_patient_register_import
-- ============================================================================

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
-- patients — one row per person, keyed by phone, because the phone is what both
-- the WhatsApp bot and the SMS sender address.
--
-- schema.sql declares this table but was never applied to production (the
-- 0001 baseline dump has no `patients`), so it is created here rather than
-- assumed. The definition matches schema.sql exactly; the ALTERs below then add
-- what register imports, consent and messaging need.
-- ============================================================================

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,              -- WhatsApp number, country code, no +
  name text,
  area text,
  pin_code text,
  lang text default 'hi' check (lang in ('en','hi')),
  created_at timestamptz default now()
);

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
-- The register carries no consent line, and there is no way to invent one after
-- the fact. The resolved approach is inbound-only: this backlog is never
-- messaged, it exists so the bot recognises a patient who writes to US first.
-- New opt-ins come from QR posters at reception and on OPD slips, where the
-- patient's own message is the evidence. See migration 0005, which
-- implements that path and grants consent automatically for the QR entry points
-- whose pre-filled text is an explicit agreement.
--
-- Withdrawal needs no special handling: insert into opt_outs (phone, channel,
-- reason) and the trigger flips consent_status to 'withdrawn', logs it, and the
-- messageable_* views drop the row immediately.
-- ============================================================================

-- Record 0004_patient_register_import in the runner's ledger.
insert into public.schema_migrations (version, checksum) values
  ('0004_patient_register_import', '0c8bd26797f2f90bf09cd34b4c1d80de688ab0a6d0f93ccb84ad5da20ec127f7')
on conflict (version) do nothing;

-- END 0004_patient_register_import


-- ============================================================================
-- BEGIN 0005_whatsapp_inbound
-- ============================================================================

-- ============================================================================
-- Sehatsandhi — inbound WhatsApp (AISensy) contacts, sessions and opt-in
--
-- Applied by npm run migrate, after 0004 (patient register import).
-- Safe to re-run: every statement is idempotent.
--
-- THE MODEL: INBOUND-ONLY
-- We never message the hospital-register backlog. Those rows exist so that when
-- a patient messages us FIRST, the bot already knows them — name, area, last
-- visit, doctor seen — and can skip five questions. All contact is
-- user-initiated, so there is no consent problem to solve at send time.
--
-- New opt-ins come from QR posters at reception and on OPD slips, which open a
-- wa.me link with pre-filled text. The patient's own message is the opt-in, and
-- we keep that one message verbatim as the evidence.
--
-- TWO THINGS THAT ARE NOT THE SAME, AND ARE TRACKED SEPARATELY
--
--   1. SERVICE WINDOW (wa_contacts.last_inbound_at)
--      An inbound message lets us reply freely for 24 hours. This is about
--      answering someone who just wrote to us. It expires. It is NOT consent.
--
--   2. MARKETING CONSENT (patients.consent_status / consent_channels)
--      Permission to send business-initiated template messages later. It only
--      exists if the patient actually agreed — which, for a QR entry point,
--      depends on what the pre-filled text said. See wa_entry_points.
--
--   Conflating these is how businesses lose their WhatsApp number: replying in
--   the window is fine, blasting templates to everyone who ever said "hi" is
--   what earns blocks and a quality-rating downgrade.
--
-- WHAT A CLICK GIVES US: nothing. Tapping wa.me only opens WhatsApp on the
-- patient's phone. Nothing reaches us until they hit send. First contact gives
-- us their phone number, their WhatsApp display name (as they set it — often
-- not their real name), a message id, a timestamp, the message, and a referral
-- block if they came via a link or ad. No email, no photo, no contacts, no
-- location unless they explicitly share it.
--
-- MESSAGE RETENTION: structured extract only. Bodies are kept while a session
-- is open because the bot needs the context, then purged — see
-- sehat_purge_closed_session_bodies(). The single exception is the first
-- inbound message, kept permanently on wa_contacts as opt-in evidence.
-- ============================================================================

-- ============================================================================
-- wa_entry_points — one row per QR poster, slip or web button.
--
-- Each gets its own code so you can measure which reception desk actually
-- produces patients. grants_marketing_consent is the important column: it must
-- be true ONLY where the pre-filled text is an unambiguous agreement to receive
-- updates. A generic "I need help" is a service request, not consent.
-- ============================================================================

create table if not exists wa_entry_points (
  code text primary key,                   -- 'qr_sharma_reception', 'opd_slip', 'web_home'
  label text not null,                     -- 'Sharma Hospital — reception poster'
  location text,                           -- hospital / page it lives on
  prefilled_text text not null,            -- exactly what the patient's message will say
  grants_marketing_consent boolean default false,
  is_active boolean default true,
  created_at timestamptz default now()
);

comment on column wa_entry_points.grants_marketing_consent is
  'True only if prefilled_text is an explicit agreement to receive updates. '
  'If the patient merely asks for help, this is false and only the 24h service window applies.';

-- Seed. The wa.me link for each is:
--   https://wa.me/<WA_NUMBER>?text=<url-encoded prefilled_text>
--
-- The first two are the links the site already sends today (App.tsx's floating
-- button, and PatientHome's "Book on WhatsApp" — the latter appends the selected
-- area in brackets). Both are help requests, so neither grants consent. The QR
-- entries are the new opt-in path, where the text IS the agreement.
insert into wa_entry_points (code, label, location, prefilled_text, grants_marketing_consent) values
  ('web_float',            'Website — floating WhatsApp button', 'all pages',
   'Namaste!',                                                                 false),
  ('web_home',             'Homepage — Book on WhatsApp',        'sehatsandhi.com/',
   'Hi Sehatsandhi, I need help',                                              false),
  ('web_ambulance',        'Homepage — Ambulance now',           'sehatsandhi.com/',
   'EMERGENCY: I need an ambulance',                                           false),
  ('qr_reception_consent', 'Reception QR — opt-in poster',        'hospital reception',
   'Yes, I want health updates and booking help from Sehatsandhi on WhatsApp',  true),
  ('opd_slip',             'OPD slip QR — opt-in',               'printed OPD slip',
   'Yes, I want health updates and booking help from Sehatsandhi on WhatsApp',  true)
on conflict (code) do update
  set label = excluded.label,
      location = excluded.location,
      prefilled_text = excluded.prefilled_text,
      grants_marketing_consent = excluded.grants_marketing_consent;

-- ============================================================================
-- wa_contacts — one row per WhatsApp user who has written to us.
--
-- patient_id links to the register row when the number matches, which is what
-- makes the backlog useful without messaging it.
-- ============================================================================

create table if not exists wa_contacts (
  phone text primary key,                  -- wa_id, digits only: 919812345678
  patient_id uuid references patients(id) on delete set null,

  profile_name text,                       -- WhatsApp display name, self-set
  lang text default 'hi',

  entry_code text references wa_entry_points(code),
  referral_source_url text,                -- from the webhook referral block
  referral_headline text,

  first_inbound_at timestamptz default now(),
  last_inbound_at timestamptz default now(),
  inbound_count integer default 1,

  -- opt-in evidence: the one message body we keep permanently, because it is
  -- what proves the patient initiated contact and what they agreed to
  optin_message_id text,
  optin_message_text text,
  optin_at timestamptz,

  matched_register boolean default false,   -- were they already known from a register?
  created_at timestamptz default now()
);

do $$ begin
  alter table wa_contacts add constraint wa_contacts_phone_format
    check (phone ~ '^91[6-9][0-9]{9}$') not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table wa_contacts add constraint wa_contacts_lang_check
    check (lang in ('en', 'hi')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists wa_contacts_patient_idx  on wa_contacts (patient_id);
create index if not exists wa_contacts_last_in_idx  on wa_contacts (last_inbound_at desc);
create index if not exists wa_contacts_entry_idx    on wa_contacts (entry_code);

-- ============================================================================
-- wa_sessions — one bot conversation, as a structured extract.
--
-- This is the durable record: what they wanted, where, what came of it. No
-- symptom free-text lives here.
-- ============================================================================

create table if not exists wa_sessions (
  id uuid primary key default gen_random_uuid(),
  phone text references wa_contacts(phone) on delete cascade,
  patient_id uuid references patients(id) on delete set null,

  -- what the bot resolved from the conversation
  service_category text,                   -- doctors | hospital | pharmacy | lab | insurance | ambulance
  speciality text,                         -- 'cardiology' — a category, not a complaint
  area text,
  pin_code text,
  chosen_doctor_id uuid references doctors(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,

  outcome text default 'open',             -- open | booked | abandoned | referred | no_match
  entry_code text references wa_entry_points(code),

  started_at timestamptz default now(),
  last_activity_at timestamptz default now(),
  closed_at timestamptz,
  bodies_purged_at timestamptz             -- when free text was deleted
);

do $$ begin
  alter table wa_sessions add constraint wa_sessions_outcome_check
    check (outcome in ('open', 'booked', 'abandoned', 'referred', 'no_match')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists wa_sessions_phone_idx  on wa_sessions (phone, started_at desc);
create index if not exists wa_sessions_open_idx   on wa_sessions (outcome) where outcome = 'open';

-- ============================================================================
-- wa_session_messages — working memory only.
--
-- The bot needs recent turns to hold a conversation, so bodies live here while
-- the session is open and are deleted once it closes. Nothing here is a
-- permanent record; anything worth keeping belongs in wa_sessions above.
-- ============================================================================

create table if not exists wa_session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references wa_sessions(id) on delete cascade,
  phone text,
  direction text not null,                 -- inbound | outbound
  message_id text,                         -- provider id, for dedupe on webhook retries
  body text,                               -- PURGED after the session closes
  message_type text default 'text',        -- text | button | image | location | interactive
  created_at timestamptz default now()
);

do $$ begin
  alter table wa_session_messages add constraint wa_session_messages_direction_check
    check (direction in ('inbound', 'outbound')) not valid;
exception when duplicate_object then null; end $$;

create index if not exists wa_session_messages_session_idx on wa_session_messages (session_id, created_at);
-- AISensy retries webhooks; this makes a repeat delivery a no-op.
create unique index if not exists wa_session_messages_message_id_idx
  on wa_session_messages (message_id) where message_id is not null;

-- ============================================================================
-- Inbound handler — what the AISensy webhook calls on every incoming message.
--
-- Does the whole first-contact path atomically:
--   • normalises the phone, ignoring anything that isn't an Indian mobile
--   • matches or creates the patient row (a register match links, not duplicates)
--   • marks the patient verified — they told us the number themselves, which is
--     stronger evidence than a transcription from handwriting
--   • records the first message as opt-in evidence
--   • grants marketing consent ONLY if the entry point's pre-filled text was an
--     explicit agreement, and logs it to patient_consents with the message id
--   • refuses to resurrect anyone who has opted out
--
-- Returns the wa_contacts row so the bot can greet a known patient by name.
-- ============================================================================

create or replace function sehat_wa_handle_inbound(
  p_raw_phone text,
  p_profile_name text default null,
  p_message_id text default null,
  p_message_text text default null,
  p_entry_code text default null,
  p_referral_source_url text default null
)
returns wa_contacts
language plpgsql security definer
set search_path = public
as $$
declare
  v_phone text;
  v_patient_id uuid;
  v_grants boolean := false;
  v_is_new boolean := false;
  v_contact wa_contacts;
begin
  v_phone := sehat_normalise_phone(p_raw_phone);
  if v_phone is null then
    raise exception 'not an Indian mobile number: %', p_raw_phone;
  end if;

  -- Someone who opted out does not get re-enrolled by writing to us. They can
  -- still be replied to inside the service window; they just do not regain
  -- marketing consent here.
  if exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(v_phone)) then
    v_grants := false;
  else
    select coalesce(e.grants_marketing_consent, false) into v_grants
      from wa_entry_points e
     where e.code = p_entry_code and e.is_active;
    v_grants := coalesce(v_grants, false);
  end if;

  -- Match the register, or create the patient. phone is unique on patients, so
  -- an existing register row is reused rather than duplicated.
  select id into v_patient_id from patients where phone = v_phone;

  if v_patient_id is null then
    v_is_new := true;
    insert into patients (phone, name, lang, source, source_detail, verified, status)
    values (v_phone, nullif(p_profile_name, ''), 'hi', 'whatsapp_inbound',
            coalesce(p_entry_code, 'unknown entry point'), true, 'active')
    returning id into v_patient_id;
  else
    -- self-asserted phone beats a handwriting transcription
    update patients
       set verified = true,
           name = coalesce(name, nullif(p_profile_name, '')),
           updated_at = now()
     where id = v_patient_id;
  end if;

  if v_grants then
    update patients
       set consent_status = 'granted',
           consent_channels = array['whatsapp'],
           consent_basis = 'Patient-initiated WhatsApp opt-in via ' || coalesce(p_entry_code, 'QR'),
           consent_at = coalesce(consent_at, now())
     where id = v_patient_id
       and consent_status <> 'granted';

    insert into patient_consents (patient_id, phone, channel, action, basis, evidence_ref, recorded_by)
    values (v_patient_id, v_phone, 'whatsapp', 'granted',
            'Patient sent: ' || coalesce(left(p_message_text, 200), '(no text)'),
            p_message_id, 'system:wa_inbound');
  end if;

  insert into wa_contacts (
    phone, patient_id, profile_name, entry_code, referral_source_url,
    optin_message_id, optin_message_text, optin_at, matched_register
  ) values (
    v_phone, v_patient_id, nullif(p_profile_name, ''), p_entry_code, p_referral_source_url,
    p_message_id, p_message_text, now(), not v_is_new
  )
  on conflict (phone) do update
     set patient_id      = coalesce(wa_contacts.patient_id, excluded.patient_id),
         profile_name    = coalesce(excluded.profile_name, wa_contacts.profile_name),
         last_inbound_at = now(),
         inbound_count   = wa_contacts.inbound_count + 1
  returning * into v_contact;

  return v_contact;
end $$;

revoke all on function sehat_wa_handle_inbound(text, text, text, text, text, text) from anon, authenticated;

-- ============================================================================
-- inbound_patient_context — what the bot reads to recognise a caller.
--
-- This is the payoff for storing the register: a returning patient is greeted
-- by name with their area pre-filled, and the bot asks less.
-- ============================================================================

create or replace view inbound_patient_context as
select
  c.phone,
  c.profile_name,
  c.lang,
  c.inbound_count,
  c.last_inbound_at,
  c.matched_register,
  p.id                as patient_id,
  p.name              as register_name,
  p.area,
  p.pin_code,
  p.city,
  p.gender,
  p.age,
  p.last_visit_date,
  p.visit_count,
  p.consent_status,
  p.consent_channels,
  -- the 24h reply window: about answering them, not about marketing
  (c.last_inbound_at > now() - interval '24 hours') as service_window_open,
  (select v.doctor_seen from patient_visits v
    where v.patient_id = p.id order by v.visit_date desc nulls last limit 1) as last_doctor_seen
from wa_contacts c
left join patients p on p.id = c.patient_id;

alter view inbound_patient_context set (security_invoker = on);

-- Numbers we may reply to freely right now, because they wrote to us recently.
-- Distinct from messageable_whatsapp, which is about business-initiated sends.
create or replace view wa_service_window_open as
select phone, patient_id, profile_name, last_inbound_at,
       last_inbound_at + interval '24 hours' as window_closes_at
from wa_contacts
where last_inbound_at > now() - interval '24 hours';

alter view wa_service_window_open set (security_invoker = on);

-- Which QR poster is actually working.
-- Scalar subqueries rather than two left joins, which would multiply contacts
-- by sessions and inflate every count.
create or replace view wa_entry_point_stats as
select
  e.code,
  e.label,
  e.location,
  e.grants_marketing_consent,
  (select count(*) from wa_contacts c where c.entry_code = e.code)                    as contacts,
  (select count(*) from wa_contacts c where c.entry_code = e.code
      and c.matched_register)                                                          as already_in_register,
  (select count(*) from wa_contacts c where c.entry_code = e.code
      and c.first_inbound_at > now() - interval '30 days')                             as new_last_30d,
  (select count(*) from wa_sessions s where s.entry_code = e.code)                     as sessions,
  (select count(*) from wa_sessions s where s.entry_code = e.code
      and s.outcome = 'booked')                                                        as booked
from wa_entry_points e;

alter view wa_entry_point_stats set (security_invoker = on);

-- ============================================================================
-- Retention — drop message bodies once a session is done.
--
-- Keeps the structured extract in wa_sessions and deletes the free text, so a
-- symptom description never becomes a permanent record. Run it on a schedule:
--
--   select cron.schedule('purge-wa-bodies', '0 3 * * *',
--                        $$select sehat_purge_closed_session_bodies(7)$$);
--
-- (Requires the pg_cron extension — enable it under Database → Extensions.)
-- ============================================================================

create or replace function sehat_purge_closed_session_bodies(p_days integer default 7)
returns integer language plpgsql as $$
declare v_count integer;
begin
  with stale as (
    select id from wa_sessions
     where outcome <> 'open'
       and coalesce(closed_at, last_activity_at) < now() - make_interval(days => p_days)
       and bodies_purged_at is null
  )
  delete from wa_session_messages m using stale s where m.session_id = s.id;

  get diagnostics v_count = row_count;

  update wa_sessions
     set bodies_purged_at = now()
   where outcome <> 'open'
     and coalesce(closed_at, last_activity_at) < now() - make_interval(days => p_days)
     and bodies_purged_at is null;

  return v_count;
end $$;

-- Sessions abandoned mid-conversation never get closed by the bot; close them
-- so their bodies become eligible for purging.
create or replace function sehat_close_stale_sessions(p_hours integer default 48)
returns integer language plpgsql as $$
declare v_count integer;
begin
  update wa_sessions
     set outcome = 'abandoned', closed_at = now()
   where outcome = 'open'
     and last_activity_at < now() - make_interval(hours => p_hours);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ============================================================================
-- RLS — everything here is patient PII. Service-role only, same as patients.
-- The AISensy webhook must authenticate with the service-role key (or call an
-- edge function that holds it). Never from browser code.
-- ============================================================================

alter table wa_contacts         enable row level security;
alter table wa_sessions         enable row level security;
alter table wa_session_messages enable row level security;
alter table wa_entry_points     enable row level security;

revoke all on wa_contacts, wa_sessions, wa_session_messages from anon, authenticated;
revoke all on inbound_patient_context, wa_service_window_open, wa_entry_point_stats from anon, authenticated;

-- Entry points hold no PII and the site needs to build wa.me links from them.
create policy "read_active_entry_points" on wa_entry_points
  for select using (is_active = true);

-- ============================================================================
-- WIRING AISENSY
--
-- On every inbound message, call:
--
--   select * from sehat_wa_handle_inbound(
--     p_raw_phone           => '919812345678',
--     p_profile_name        => 'Ramesh',
--     p_message_id          => 'wamid.HBgM...',
--     p_message_text        => 'Yes, I want health updates ...',
--     p_entry_code          => 'qr_reception_consent',
--     p_referral_source_url => 'https://sehatsandhi.com/'
--   );
--
-- Then read the caller's context to personalise the greeting:
--
--   select * from inbound_patient_context where phone = '919812345678';
--
-- A register match returns register_name, area and last_visit_date, so the bot
-- opens with "Namaste Ramesh — Model Town, same as your last visit on 12 Jul?"
-- instead of asking. matched_register = false means they are new.
--
-- Open a session and record the extract as the conversation resolves:
--
--   insert into wa_sessions (phone, patient_id, service_category, area, pin_code, entry_code)
--   values ('919812345678', '<patient id>', 'doctors', 'Model Town', '135002',
--           'qr_reception_consent')
--   returning id;
--
--   update wa_sessions
--      set speciality = 'cardiology', chosen_doctor_id = '<doctor id>',
--          appointment_id = '<appointment id>', outcome = 'booked',
--          closed_at = now(), last_activity_at = now()
--    where id = '<session id>';
--
-- STOP handling — one insert, and the triggers from 0004 do the rest
-- (consent flipped to withdrawn, logged, dropped from messageable_whatsapp):
--
--   insert into opt_outs (phone, channel, reason)
--   values ('919812345678', 'whatsapp', 'replied STOP');
--
-- SENDING RULES, RESTATED BECAUSE IT IS EASY TO GET WRONG
--   • Replying to someone in wa_service_window_open — always fine, free text.
--   • Business-initiated template later — only to messageable_whatsapp, which
--     requires consent_status = 'granted' AND no opt-out.
--   • An inbound "hi" from web_home puts them in the service window but grants
--     NO marketing consent, because that entry point's text was a request for
--     help, not an agreement. That is deliberate.
-- ============================================================================

-- Record 0005_whatsapp_inbound in the runner's ledger.
insert into public.schema_migrations (version, checksum) values
  ('0005_whatsapp_inbound', 'bb8591f2b18f19725ef2f905be63c26b4b58400392a2d5db0af0915d4e1f64fa')
on conflict (version) do nothing;

-- END 0005_whatsapp_inbound


-- ============================================================================
-- BEGIN 0006_pricing_plans
-- ============================================================================

-- ============================================================================
-- Sehatsandhi — pricing plans: a queue you toggle, instead of editing prices
--
-- Run AFTER supabase/schema.sql. Safe to re-run.
--
-- THE PROBLEM THIS SOLVES
-- Changing what businesses pay used to mean editing pricing_tiers rows AND
-- redeploying the hardcoded mirror in the frontend. Now prices live in plans;
-- switching plan is one row update and the site follows.
--
-- PLANS ARE A QUEUE, NOT A SWITCH
-- Each plan has a sequence, an optional signup cap and an optional date window.
-- The active plan is the first enabled plan whose window is open and whose cap
-- is not yet filled — so the 51st business rolls onto the next plan by itself.
-- An explicit override in pricing_settings beats the queue when you want manual
-- control.
--
--   seq 1  launch_1000    ₹1,000/mo   term 5 months   cap 50 businesses
--   seq 2  growth_2000    ₹2,000/mo   term 3 months   no cap
--   seq 3  pincode_tiers  by population tier          no cap
--
-- EVERYTHING IS A MONTHLY RATE × MONTHS
-- Plans store only a monthly price. The number of months is chosen at checkout
-- (bounded by the plan) so a business can pay 5 months upfront. Total is always
-- derived: monthly × months.
--
-- PRICE IS LOCKED FOR THE TERM PAID, NOT FOREVER
-- On payment the listing is stamped with the plan, the monthly price and the
-- term dates. A later toggle never re-prices an existing business mid-term. At
-- term_end they are quoted whatever plan is active then, with the next term
-- starting from term_end — see subscription_renewals_due.
--
-- MONTHLY AND COMMISSION ARE INDEPENDENT
-- A vertical can pay a monthly fee, a commission, both, or neither. This
-- supersedes vertical_billing.billing_model (the either/or enum added earlier),
-- which is migrated below and kept only for reference. "Charge doctors 5% on
-- surgeries while they also pay monthly" is now an admin edit, not a schema
-- change.
-- ============================================================================

-- ============================================================================
-- pricing_plans
-- ============================================================================

create table if not exists pricing_plans (
  code text primary key,                   -- 'launch_1000', 'growth_2000', 'pincode_tiers'
  label text not null,                     -- shown on /business and in admin
  description text,                        -- one line of sales copy for the pricing card
  sequence integer not null default 100,   -- queue order; lowest open plan wins

  -- how the monthly amount is computed
  mode text not null default 'pincode_tiers',
  monthly_price integer,                   -- required for the flat modes; null for tiers

  -- term: how many months a business may buy upfront
  default_months integer not null default 1,
  min_months integer not null default 1,
  max_months integer not null default 12,

  -- capacity: null = unlimited. Counted from listings locked onto this plan.
  max_signups integer,

  -- which verticals this plan's monthly price applies to. null = all of them.
  applies_to_verticals text[],

  -- while this plan is active, do NOT charge the per-vertical commission
  suspend_commission boolean not null default false,

  is_enabled boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$ begin
  alter table pricing_plans add constraint pricing_plans_mode_check
    check (mode in ('flat_all_pincodes', 'flat_per_pincode', 'pincode_tiers')) not valid;
exception when duplicate_object then null; end $$;

-- A flat plan without a price would silently charge ₹0.
do $$ begin
  alter table pricing_plans add constraint pricing_plans_flat_needs_price
    check (mode = 'pincode_tiers' or monthly_price is not null) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table pricing_plans add constraint pricing_plans_months_sane
    check (min_months >= 1 and max_months >= min_months
           and default_months between min_months and max_months) not valid;
exception when duplicate_object then null; end $$;

create index if not exists pricing_plans_sequence_idx on pricing_plans (sequence) where is_enabled;

-- Also defined in 0004; repeated so this migration stands alone.
create or replace function sehat_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists pricing_plans_touch_updated_at on pricing_plans;
create trigger pricing_plans_touch_updated_at before update on pricing_plans
  for each row execute function sehat_touch_updated_at();

-- ============================================================================
-- pricing_settings — single row. The manual override that beats the queue.
-- ============================================================================

create table if not exists pricing_settings (
  id boolean primary key default true,
  override_plan_code text references pricing_plans(code),
  updated_by text,
  updated_at timestamptz default now(),
  constraint pricing_settings_single_row check (id)
);

insert into pricing_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================================
-- pricing_plan_events — audit. Every activation and edit, with who did it.
-- The admin password is compiled into the frontend bundle, so this log is how
-- an unwanted price change gets noticed and traced.
-- ============================================================================

create table if not exists pricing_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_code text,
  action text not null,                    -- created | edited | enabled | disabled | override_set | override_cleared | tier_price_changed
  actor text,
  detail jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists pricing_plan_events_created_idx on pricing_plan_events (created_at desc);

-- ============================================================================
-- Seed the queue described above. Re-running updates prices but never wipes
-- which plan is enabled, so a live toggle survives a re-run of this file.
-- ============================================================================

insert into pricing_plans
  (code, label, description, sequence, mode, monthly_price,
   default_months, min_months, max_months, max_signups, suspend_commission, notes)
values
  ('launch_1000', 'Launch offer — ₹1,000/month',
   'Every pincode included, for your first months on Sehatsandhi.',
   1, 'flat_all_pincodes', 1000, 5, 1, 12, 50, true,
   'Founding offer while we build patient density. Applies to all six verticals; commission suspended.'),

  ('growth_2000', 'Growth — ₹2,000/month',
   'All pincodes included while we grow patient numbers in your area.',
   2, 'flat_all_pincodes', 2000, 3, 1, 12, null, true,
   'Takes over automatically once launch_1000 fills its 50 seats.'),

  ('pincode_tiers', 'Pay for reach — priced by pincode',
   'Each pincode is priced by its population. Your total is the sum of the pincodes you pick.',
   3, 'pincode_tiers', null, 1, 1, 12, null, false,
   'The long-run model: tier prices live in pricing_tiers and are editable from admin.')
on conflict (code) do update
  set label            = excluded.label,
      description      = excluded.description,
      sequence         = excluded.sequence,
      mode             = excluded.mode,
      monthly_price    = excluded.monthly_price,
      default_months   = excluded.default_months,
      min_months       = excluded.min_months,
      max_months       = excluded.max_months,
      max_signups      = excluded.max_signups,
      suspend_commission = excluded.suspend_commission;
      -- is_enabled deliberately NOT overwritten

-- ============================================================================
-- vertical_billing — how each category is billed.
--
-- schema.sql declares this table but was never applied to production (the 0001
-- baseline dump has no vertical_billing), so create it here before altering it.
-- The definition and seed match schema.sql; the split into two independent
-- dimensions follows immediately below.
-- ============================================================================

create table if not exists vertical_billing (
  vertical text primary key,                 -- doctors|hospital|pharmacy|lab|insurance|ambulance
  db_speciality text not null,               -- doctors.speciality written by the wizard
  billing_model text not null default 'pincode_monthly'
    check (billing_model in ('pincode_monthly','commission')),
  commission_percent numeric(5,2) default 0,
  commission_basis text,
  is_active boolean default true
);

create unique index if not exists vertical_billing_speciality_idx
  on vertical_billing (db_speciality);

insert into vertical_billing (vertical, db_speciality, billing_model, commission_percent, commission_basis) values
  ('doctors',   'GEN',       'pincode_monthly',  0, null),
  ('hospital',  'HOSPITAL',  'pincode_monthly',  0, null),
  ('lab',       'LAB',       'pincode_monthly',  0, null),
  ('pharmacy',  'PHARMACY',  'commission',      10, 'order value on prescriptions filled through Sehatsandhi'),
  ('insurance', 'INSURANCE', 'commission',      10, 'your IRDA commission on policies sold through Sehatsandhi — you keep 90%'),
  ('ambulance', 'AMBULANCE', 'commission',      10, 'non-emergency transport billing — emergency calls are always commission-free')
on conflict (vertical) do nothing;

alter table vertical_billing enable row level security;
drop policy if exists "read_vertical_billing" on vertical_billing;
create policy "read_vertical_billing" on vertical_billing for select using (is_active = true);

-- ============================================================================
-- Split the either/or enum into two independent dimensions.
--
-- monthly_enabled     : does this vertical pay the plan's monthly price?
-- commission_percent  : what we take of their billing; 0 means none.
--
-- Both can be on at once. That is the point — later you may want doctors on a
-- monthly fee AND a percentage of surgeries.
-- ============================================================================

alter table vertical_billing add column if not exists monthly_enabled boolean default true;
alter table vertical_billing add column if not exists commission_enabled boolean default false;

-- Backfill from the old enum, once.
update vertical_billing
   set monthly_enabled    = (billing_model = 'pincode_monthly'),
       commission_enabled = (billing_model = 'commission')
 where monthly_enabled is null or commission_enabled is null
    or (billing_model = 'commission' and commission_enabled = false)
    or (billing_model = 'pincode_monthly' and monthly_enabled = false);

comment on column vertical_billing.billing_model is
  'LEGACY. Superseded by monthly_enabled + commission_enabled, which can both be true. '
  'Kept for reference only; the edge functions no longer read it.';

-- Basis text for the verticals that may get a commission later, so switching
-- one on from admin does not also require writing copy.
update vertical_billing set commission_basis = 'surgery and procedure billing'
 where vertical in ('doctors', 'hospital') and commission_basis is null;
update vertical_billing set commission_basis = 'test billing'
 where vertical = 'lab' and commission_basis is null;

-- ============================================================================
-- doctors — the price lock. Written on successful payment, never by the client.
-- ============================================================================

alter table doctors add column if not exists pricing_plan_code text references pricing_plans(code);
alter table doctors add column if not exists locked_monthly_price integer;
alter table doctors add column if not exists locked_mode text;
alter table doctors add column if not exists months_paid integer;
alter table doctors add column if not exists term_start date;
alter table doctors add column if not exists term_end date;
alter table doctors add column if not exists locked_at timestamptz;

create index if not exists doctors_plan_idx     on doctors (pricing_plan_code);
create index if not exists doctors_term_end_idx on doctors (term_end);

-- ============================================================================
-- payments — what was actually sold, so a charge can be reconciled later even
-- if the plan has since changed.
--
-- The first block here is a PRODUCTION FIX, not new work. razorpay-order has
-- always inserted type='listing' with pin_codes, razorpay_order_id and
-- period_months, but the 0001 baseline shows production has none of those
-- columns and a type check allowing only 'subscription'/'premium_slot' — so
-- every business payment would fail its insert. schema.sql widened this, but
-- schema.sql was never applied. Doing it here means the paid signup path
-- actually works once migrated.
-- ============================================================================

alter table payments add column if not exists pin_codes text[];
alter table payments add column if not exists razorpay_order_id text;
alter table payments add column if not exists period_months integer default 1;

alter table payments drop constraint if exists payments_type_check;
alter table payments add constraint payments_type_check
  check (type in ('subscription', 'premium_slot', 'listing'));

alter table payments add column if not exists pricing_plan_code text;
alter table payments add column if not exists monthly_price integer;
alter table payments add column if not exists pricing_mode text;
alter table payments add column if not exists term_start date;
alter table payments add column if not exists term_end date;

-- ============================================================================
-- Resolution — which plan applies right now.
--
-- SECURITY DEFINER because the seat count reads `doctors`, where RLS only shows
-- anon callers the active listings. Counting under the caller's RLS would miss
-- pending signups and hand out more launch seats than exist.
-- ============================================================================

create or replace function sehat_active_pricing_plan()
returns pricing_plans
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_override text;
  v_plan pricing_plans;
begin
  select override_plan_code into v_override from pricing_settings where id;

  if v_override is not null then
    select * into v_plan from pricing_plans where code = v_override;
    if found then return v_plan; end if;
  end if;

  select p.* into v_plan
    from pricing_plans p
   where p.is_enabled
     and (p.starts_at is null or p.starts_at <= now())
     and (p.ends_at   is null or p.ends_at   >  now())
     and (p.max_signups is null
          or (select count(*) from doctors d where d.pricing_plan_code = p.code) < p.max_signups)
   order by p.sequence, p.code
   limit 1;

  return v_plan;   -- null when nothing is configured; callers fall back to tiers
end $$;

-- Readable by the site so the landing page and wizard quote the live plan.
create or replace view active_pricing_plan as
  select * from sehat_active_pricing_plan();

-- Seat usage, for the admin plan list.
create or replace view pricing_plan_status as
select
  p.*,
  (select count(*) from doctors d where d.pricing_plan_code = p.code)            as signups_used,
  case when p.max_signups is null then null
       else greatest(p.max_signups - (select count(*) from doctors d
                                       where d.pricing_plan_code = p.code), 0)
  end                                                                             as seats_left,
  (select code from active_pricing_plan)                                          as active_code,
  (p.code = (select code from active_pricing_plan))                               as is_currently_active
from pricing_plans p
order by p.sequence, p.code;

-- ============================================================================
-- Renewals — who is due, and what they would pay next.
--
-- The next term starts at term_end, not at the date they happen to pay, so a
-- business that renews late does not get free days and one that renews early
-- does not lose any.
-- ============================================================================

create or replace view subscription_renewals_due as
select
  d.id                                    as doctor_id,
  d.name,
  d.speciality,
  d.phone,
  d.pricing_plan_code                     as current_plan,
  d.locked_monthly_price                  as current_monthly_price,
  d.months_paid,
  d.term_start,
  d.term_end,
  (d.term_end - current_date)             as days_remaining,
  d.term_end                              as next_term_start,
  ap.code                                 as renewal_plan,
  ap.label                                as renewal_plan_label,
  ap.mode                                 as renewal_mode,
  ap.monthly_price                        as renewal_monthly_price,
  ap.default_months                       as renewal_default_months
from doctors d
cross join lateral (select * from active_pricing_plan) ap
where d.term_end is not null
order by d.term_end;

-- ============================================================================
-- RLS
--
-- Plans and tier prices are public-readable — the site has to quote them. All
-- writes are service-role only: the admin password is compiled into the
-- frontend bundle (VITE_ADMIN_PASS), so an anon write policy here would let
-- anyone on the internet re-price the platform. Admin changes go through the
-- admin-pricing edge function instead.
-- ============================================================================

alter table pricing_plans       enable row level security;
alter table pricing_settings    enable row level security;
alter table pricing_plan_events enable row level security;

drop policy if exists "read_pricing_plans" on pricing_plans;
create policy "read_pricing_plans" on pricing_plans for select using (is_enabled);

-- no policies on pricing_settings / pricing_plan_events → service-role only
revoke all on pricing_settings, pricing_plan_events from anon, authenticated;

grant select on active_pricing_plan to anon, authenticated;
revoke all  on pricing_plan_status, subscription_renewals_due from anon, authenticated;

-- ============================================================================
-- OPERATING IT
--
-- Which plan is live right now, and how many seats are left:
--   select code, label, mode, monthly_price, signups_used, seats_left,
--          is_currently_active
--     from pricing_plan_status;
--
-- Force a specific plan (beats the queue):
--   update pricing_settings set override_plan_code = 'growth_2000',
--          updated_by = 'nitin', updated_at = now() where id;
--
-- Hand control back to the queue:
--   update pricing_settings set override_plan_code = null where id;
--
-- Change a price — takes effect for NEW registrations only:
--   update pricing_plans set monthly_price = 1500 where code = 'launch_1000';
--
-- Change how many launch seats exist:
--   update pricing_plans set max_signups = 75 where code = 'launch_1000';
--
-- Switch to pincode pricing whenever traction justifies it:
--   update pricing_settings set override_plan_code = 'pincode_tiers' where id;
--   -- then tune the tiers themselves:
--   update pricing_tiers set monthly_price = 1200 where tier_number = 3;
--
-- Turn on a commission for doctors, on top of whatever they pay monthly:
--   update vertical_billing
--      set commission_enabled = true, commission_percent = 5,
--          commission_basis = 'surgery and procedure billing'
--    where vertical = 'doctors';
--
-- Who renews in the next 30 days, and at what:
--   select name, phone, term_end, current_monthly_price,
--          renewal_plan, renewal_monthly_price
--     from subscription_renewals_due
--    where days_remaining between 0 and 30;
-- ============================================================================

-- Record 0006_pricing_plans in the runner's ledger.
insert into public.schema_migrations (version, checksum) values
  ('0006_pricing_plans', 'f6f7cf91e3c12a5adeeba53f714fb2869dcff269356252d3bcbdf1f45ed8e907')
on conflict (version) do nothing;

-- END 0006_pricing_plans


-- ============================================================================
-- VERIFY — run these after the above and check the output
-- ============================================================================

-- 1. Ledger should list 0004, 0005, 0006.
select version, applied_at from public.schema_migrations order by version;

-- 2. Which plan new registrations are quoted. Expect launch_1000 at 1000,
--    mode flat_all_pincodes, 50 seats, 0 used.
select code, label, mode, monthly_price, default_months, max_signups,
       signups_used, seats_left, is_currently_active
  from pricing_plan_status;

-- 3. Billing per category. The launch plan suspends commission, so all six
--    should end up on the flat monthly price while it is live.
select vertical, monthly_enabled, commission_enabled, commission_percent
  from vertical_billing order by vertical;

-- 4. payments must now accept 'listing' — this is the production fix. Expect
--    the constraint to list all three values.
select pg_get_constraintdef(oid) as payments_type_check
  from pg_constraint where conname = 'payments_type_check';

-- 5. Patient messaging views exist and are empty (nothing consented yet — that
--    is correct, not a fault).
select (select count(*) from patients)              as patients,
       (select count(*) from messageable_whatsapp)  as whatsapp_ready,
       (select count(*) from messageable_sms)       as sms_ready;

-- 6. QR entry points, for the reception posters. grants_marketing_consent must
--    be true ONLY for the two opt-in ones.
select code, label, grants_marketing_consent from wa_entry_points order by code;
