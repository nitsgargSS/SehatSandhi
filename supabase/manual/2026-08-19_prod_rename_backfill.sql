-- ============================================================================
-- Sehatsandhi — the businesses/practitioners rename, for a database with data
--
-- Generated 2026-08-19. DRAFT — not yet run anywhere. Read the whole file, then
-- rehearse it on a restored copy of production before it touches production.
--
-- Paste into: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Run on a PROD RESTORE first, then production. It is wrapped in one
-- transaction: it either lands whole or not at all.
--
-- ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
--
-- 0037_businesses_and_practitioners.sql reaches the same destination, and must
-- never be run here. Its own header says so:
--
--   "NOT re-runnable against a database that already holds real listings: it
--    drops the identity tables outright. Applied while every row was a test row
--    (8 listings, 4 organisations, 0 appointments)."
--
-- That was true of sandbox and is not true of production. 0037 does
-- `drop table doctors cascade` and then unconditionally deletes thirteen
-- tables, two of which must not be deleted here at all:
--
--   invoices  — GST tax invoices issued under our GSTIN, on a statutory
--               numbering series (sehat_next_invoice_number, 0007). A deleted
--               invoice is a compliance problem, and the gap it leaves in the
--               series is permanent.
--   payments  — the record of money actually received, and what those invoices
--               reconcile against.
--
-- Plus every real listing, since `doctors` is dropped rather than migrated.
--
-- This file does the same structural work by BACKFILLING: every row is carried
-- across and re-pointed, nothing is deleted, and the old tables are RENAMED
-- rather than dropped so there is a way back.
--
-- ── HOW THE OLD SHAPE MAPS ONTO THE NEW ─────────────────────────────────────
--
-- `doctors` held four different kinds of row. They do not migrate the same way:
--
--   1. A solo doctor or clinic       speciality = a medical code, no org
--      -> one business AND one practitioner, joined by an affiliation.
--
--   2. A pharmacy / lab / ambulance / insurance desk
--      speciality = PHARMACY|LAB|AMBULANCE|INSURANCE
--      -> a business only. There is no person here, and 0037 is explicit that
--         a pharmacy was never a speciality.
--
--   3. A hospital's own listing      speciality = 'HOSPITAL', organization_id set
--      -> a business with vertical 'hospital'. The `organizations` row beside it
--         is redundant in the new shape — business_practitioners expresses what
--         it existed to express — so it is carried onto the business and the
--         table is retired.
--
--   4. A hospital consultant         organization_id set, is_hospital_doctor
--      -> a PRACTITIONER attached to the hospital's business. NOT a business of
--         their own. This is the case that makes a naive backfill wrong: giving
--         each consultant their own business would turn one hospital into
--         fifteen listings competing with each other in search.
--
-- Because of case 4, an old doctors.id does not map onto one new id but onto a
-- PAIR — a business and (sometimes) a practitioner. Every foreign key that used
-- to point at `doctors` is re-pointed through rename_doctor_map below, so an
-- appointment with a consultant ends up on the hospital's business with the
-- consultant named in practitioner_id, which is exactly what 0037 added that
-- column for.
--
-- ── WHAT TO CHECK BEFORE YOU BELIEVE IT ─────────────────────────────────────
-- The verification queries at the foot are not optional. In particular the row
-- counts before and after: this file's whole claim is that nothing was lost.
-- ============================================================================

begin;

-- Fail loudly rather than half-apply.
set local statement_timeout = '600s';

-- ── 0. Refuse to run twice, or in the wrong place ──────────────────────────

do $$
begin
  if to_regclass('public.doctors') is null then
    raise exception
      'No `doctors` table here — this database has already been migrated (or 0037 was run). Nothing to do.';
  end if;
  if to_regclass('public.businesses') is not null then
    raise exception
      '`businesses` already exists. Either this script has already run, or 0037 has. Stopping.';
  end if;
end $$;


-- ============================================================================
-- 1. The new tables. DDL identical to 0037 — if that file changes, this must.
-- ============================================================================

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vertical text not null default 'clinic'
    check (vertical in ('clinic','hospital','pharmacy','lab','insurance','ambulance')),
  address text,
  pin_codes text[] not null default '{}',
  phone text,
  email text,
  working_hours text,
  photo_url text,
  google_place_id text,
  reg_number text,
  status text not null default 'pending'
    check (status in ('pending','active','suspended')),
  pricing_plan_code text references pricing_plans(code),
  locked_monthly_price integer,
  locked_mode text,
  months_paid integer,
  term_start date,
  term_end date,
  locked_at timestamptz,
  gstin text,
  gst_legal_name text,
  state_code text,
  billing_address text,
  discount_code text,
  discount_applied integer,
  auth_uid uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table practitioners (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  speciality text,
  qualification text,
  reg_number text,
  smc_id integer,
  imr_year integer,
  imr_status text not null default 'unchecked'
    check (imr_status in ('unchecked','matched','confirmed','no_match','ambiguous','error')),
  imr_checked_at timestamptz,
  phone text,
  email text,
  photo_url text,
  auth_uid uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_practitioners (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  practitioner_id uuid not null references practitioners(id) on delete cascade,
  role text not null default 'doctor'
    check (role in ('owner','doctor','receptionist','manager')),
  is_primary boolean not null default false,
  consultation_fee integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending','active','suspended')),
  sort_order integer not null default 0,
  can_login_web boolean not null default true,
  notify_new_appointments boolean not null default true,
  notify_daily_schedule boolean not null default true,
  notify_cancellations boolean not null default true,
  notify_monthly_report boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, practitioner_id)
);


-- ============================================================================
-- 2. The map. One row per OLD doctors row, saying where it went.
--
-- Kept rather than dropped: it is the only record of how ids were re-pointed,
-- and the thing to join against if a number looks wrong a week from now. Drop
-- it once you are satisfied — see the last line of this file.
-- ============================================================================

create table rename_doctor_map (
  old_doctor_id   uuid primary key,
  business_id     uuid not null references businesses(id),
  practitioner_id uuid references practitioners(id),
  kind            text not null,   -- solo | vertical | hospital | consultant
  note            text
);

-- Which vertical an old speciality code meant. Anything unrecognised is a
-- clinic, matching verticalForSpeciality() in the app.
create or replace function pg_temp.vertical_of(p_speciality text)
returns text language sql immutable as $$
  select case upper(coalesce(p_speciality, ''))
    when 'HOSPITAL'  then 'hospital'
    when 'PHARMACY'  then 'pharmacy'
    when 'LAB'       then 'lab'
    when 'INSURANCE' then 'insurance'
    when 'AMBULANCE' then 'ambulance'
    else 'clinic'
  end;
$$;

-- Is this row a PERSON as well as a listing? Only the medical specialities are.
create or replace function pg_temp.is_person(p_speciality text)
returns boolean language sql immutable as $$
  select pg_temp.vertical_of(p_speciality) = 'clinic';
$$;


-- ── 2a. Businesses: kinds 1, 2 and 3. Consultants (kind 4) get none. ───────

with source as (
  select d.*,
         (d.organization_id is not null and coalesce(d.is_hospital_doctor, false)) as is_consultant
    from doctors d
),
inserted as (
  insert into businesses (
    name, vertical, address, pin_codes, phone, email, working_hours, photo_url,
    reg_number, status, pricing_plan_code, locked_monthly_price, locked_mode,
    months_paid, term_start, term_end, locked_at, gstin, gst_legal_name,
    state_code, billing_address, discount_code, discount_applied, auth_uid,
    created_at
  )
  select
    -- The listing's name is the clinic's, falling back to the person's, which
    -- is what a solo practice put there.
    coalesce(nullif(btrim(s.clinic_name), ''), s.name),
    pg_temp.vertical_of(s.speciality),
    s.address, coalesce(s.pin_codes, '{}'), s.phone, s.email, s.working_hours,
    s.photo_url,
    -- A clinic's reg_number was the DOCTOR's medical registration; it moves to
    -- the person below. For every other vertical it is the business's own
    -- licence and stays here.
    case when pg_temp.is_person(s.speciality) then null else s.reg_number end,
    s.status, s.pricing_plan_code, s.locked_monthly_price, s.locked_mode,
    s.months_paid, s.term_start, s.term_end, s.locked_at, s.gstin,
    s.gst_legal_name, s.state_code, s.billing_address, s.discount_code,
    s.discount_applied, s.auth_uid, s.created_at
  from source s
  where not s.is_consultant
  returning id, name, created_at
)
insert into rename_doctor_map (old_doctor_id, business_id, kind)
select s.id, i.id,
       case when pg_temp.vertical_of(s.speciality) = 'hospital' then 'hospital'
            when pg_temp.is_person(s.speciality) then 'solo'
            else 'vertical' end
  from source s
  join lateral (
    -- Re-identify the row just inserted for this source row. created_at is
    -- carried across verbatim and name is derived deterministically, so the
    -- pair is unique per source row in practice; the id ordering breaks any tie.
    select i.id from inserted i
     where i.name = coalesce(nullif(btrim(s.clinic_name), ''), s.name)
       and i.created_at is not distinct from s.created_at
     order by i.id
     limit 1
  ) i on true
 where not s.is_consultant;

-- The join above is the one piece of this file I am least happy with: it
-- re-identifies rows by (name, created_at) because a plain INSERT..SELECT
-- cannot return the source key alongside the new one. If two listings share a
-- name AND a created_at timestamp to the microsecond, they could cross over.
-- The verification block at the foot asserts the map is 1:1, which is what
-- catches it. If that assertion ever fires, the fix is to add a temporary
-- `legacy_doctor_id uuid` column to businesses, populate it in the INSERT, and
-- build the map from that instead — slower to write, impossible to get wrong.


-- ── 2b. Practitioners: kind 1 (the person inside a solo listing) and kind 4 ─

with source as (
  select d.* from doctors d
   where pg_temp.is_person(d.speciality)
),
inserted as (
  insert into practitioners (
    full_name, speciality, qualification, reg_number, smc_id, imr_year,
    imr_status, imr_checked_at, phone, email, photo_url, status, created_at
  )
  select s.name, s.speciality, s.qualification, s.reg_number, s.smc_id,
         s.imr_year, coalesce(s.imr_status, 'unchecked'), s.imr_checked_at,
         s.phone, s.email, s.photo_url, s.status, s.created_at
    from source s
  returning id, full_name, created_at
)
update rename_doctor_map m
   set practitioner_id = i.id
  from source s
  join lateral (
    select i.id from inserted i
     where i.full_name = s.name
       and i.created_at is not distinct from s.created_at
     order by i.id limit 1
  ) i on true
 where m.old_doctor_id = s.id;

-- Consultants have no business of their own, so 2a skipped them and they have
-- no map row yet. Point them at their hospital's business.
insert into rename_doctor_map (old_doctor_id, business_id, practitioner_id, kind, note)
select d.id, hm.business_id, null, 'consultant',
       'attached to the hospital listing for organization ' || d.organization_id
  from doctors d
  join doctors h
    on h.organization_id = d.organization_id
   and upper(coalesce(h.speciality, '')) = 'HOSPITAL'
  join rename_doctor_map hm on hm.old_doctor_id = h.id
 where d.organization_id is not null
   and coalesce(d.is_hospital_doctor, false)
   and not exists (select 1 from rename_doctor_map m where m.old_doctor_id = d.id);

-- A consultant whose hospital listing is missing would otherwise be dropped
-- silently. Give them their own business rather than lose them, and say so.
insert into businesses (name, vertical, address, pin_codes, phone, email,
                        status, created_at)
select coalesce(nullif(btrim(d.clinic_name), ''), d.name), 'clinic', d.address,
       coalesce(d.pin_codes, '{}'), d.phone, d.email, d.status, d.created_at
  from doctors d
 where d.organization_id is not null
   and coalesce(d.is_hospital_doctor, false)
   and not exists (select 1 from rename_doctor_map m where m.old_doctor_id = d.id);

insert into rename_doctor_map (old_doctor_id, business_id, kind, note)
select d.id, b.id, 'consultant',
       'ORPHAN: no HOSPITAL listing for organization ' || d.organization_id
         || ' — given its own business, review this one'
  from doctors d
  join lateral (
    select b.id from businesses b
     where b.name = coalesce(nullif(btrim(d.clinic_name), ''), d.name)
       and b.created_at is not distinct from d.created_at
     order by b.id limit 1
  ) b on true
 where d.organization_id is not null
   and coalesce(d.is_hospital_doctor, false)
   and not exists (select 1 from rename_doctor_map m where m.old_doctor_id = d.id);

-- Now the consultants' practitioner rows, linked through the map.
with inserted as (
  insert into practitioners (
    full_name, speciality, qualification, reg_number, smc_id, imr_year,
    imr_status, imr_checked_at, phone, email, photo_url, status, created_at
  )
  select d.name, d.speciality, d.qualification, d.reg_number, d.smc_id,
         d.imr_year, coalesce(d.imr_status, 'unchecked'), d.imr_checked_at,
         d.phone, d.email, d.photo_url, d.status, d.created_at
    from doctors d
    join rename_doctor_map m on m.old_doctor_id = d.id
   where m.kind = 'consultant' and m.practitioner_id is null
  returning id, full_name, created_at
)
update rename_doctor_map m
   set practitioner_id = i.id
  from doctors d
  join lateral (
    select i.id from inserted i
     where i.full_name = d.name
       and i.created_at is not distinct from d.created_at
     order by i.id limit 1
  ) i on true
 where m.old_doctor_id = d.id
   and m.kind = 'consultant'
   and m.practitioner_id is null;


-- ── 2c. The affiliations ───────────────────────────────────────────────────
-- consultation_fee moves here from the listing, which is the point of the
-- table: the same doctor charges differently at each place they sit.

insert into business_practitioners (
  business_id, practitioner_id, role, is_primary, consultation_fee,
  status, created_at
)
select m.business_id, m.practitioner_id, 'doctor',
       -- A solo doctor's practice is their primary post. A consultant's is
       -- not assumed to be: they may hold a solo listing elsewhere, and the
       -- partial unique index allows only one primary per person.
       (m.kind = 'solo'),
       coalesce(d.consultation_fee, 0),
       d.status, d.created_at
  from rename_doctor_map m
  join doctors d on d.id = m.old_doctor_id
 where m.practitioner_id is not null
on conflict (business_id, practitioner_id) do nothing;

-- Anyone who could log in or be notified, from clinic_users. Their role is
-- carried across; reception and managers become practitioners too, which is
-- what 0037 intended by "a person: a doctor, or any other member of staff".
with staff as (
  select cu.*, m.business_id
    from clinic_users cu
    join rename_doctor_map m on m.old_doctor_id = cu.doctor_id
   where coalesce(cu.is_active, true)
),
inserted as (
  insert into practitioners (full_name, phone, email, auth_uid, status, created_at)
  select s.full_name, s.whatsapp_number, s.email, s.supabase_user_id,
         case when coalesce(s.is_active, true) then 'active' else 'suspended' end,
         s.created_at
    from staff s
    -- Someone already carried across as a doctor is the same person; do not
    -- create a second row for them.
    where not exists (
      select 1 from practitioners p
       where lower(btrim(p.full_name)) = lower(btrim(s.full_name))
         and coalesce(p.phone, '') = coalesce(s.whatsapp_number, '')
    )
  returning id, full_name, created_at
)
insert into business_practitioners (
  business_id, practitioner_id, role, is_primary, status,
  can_login_web, notify_new_appointments, notify_daily_schedule,
  notify_cancellations, notify_monthly_report, created_at
)
select s.business_id, p.id, s.role, false,
       case when coalesce(s.is_active, true) then 'active' else 'suspended' end,
       coalesce(s.can_login_web, true),
       coalesce(s.notify_new_appointments, true),
       coalesce(s.notify_daily_schedule, true),
       coalesce(s.notify_cancellations, true),
       coalesce(s.notify_monthly_report, false),
       s.created_at
  from staff s
  join lateral (
    select p.id from practitioners p
     where lower(btrim(p.full_name)) = lower(btrim(s.full_name))
       and coalesce(p.phone, '') = coalesce(s.whatsapp_number, '')
     order by p.created_at limit 1
  ) p on true
on conflict (business_id, practitioner_id) do nothing;


-- ============================================================================
-- 3. Re-point everything that referenced a listing.
--
-- The old FKs must go first: they point at `doctors`, and the values are about
-- to stop being doctors ids. Dropped by lookup rather than by name, because the
-- names in production came from a dump and are not all predictable.
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
      join pg_class f on f.oid = c.confrelid
     where c.contype = 'f'
       and f.relname in ('doctors', 'organizations', 'clinic_users')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table appointments              rename column doctor_id to business_id;
alter table camps_offers              rename column doctor_id to business_id;
alter table ratings                   rename column doctor_id to business_id;
alter table rating_responses          rename column doctor_id to business_id;
alter table payments                  rename column doctor_id to business_id;
alter table premium_slots             rename column doctor_id to business_id;
alter table subscriptions             rename column doctor_id to business_id;
alter table doctor_pricing_overrides  rename column doctor_id to business_id;
alter table discount_code_usage       rename column doctor_id to business_id;
alter table practice_locations        rename column doctor_id to business_id;
alter table invoices                  rename column doctor_id to business_id;
alter table site_events               rename column doctor_id to business_id;
alter table login_codes               rename column doctor_id to business_id;
alter table seed_clinics              rename column claimed_by to claimed_by_business_id;
alter table wa_sessions               rename column chosen_doctor_id to chosen_business_id;

alter table doctor_pricing_overrides rename to business_pricing_overrides;

-- appointments learns who the patient actually saw, before the values move.
alter table appointments
  add column practitioner_id uuid references practitioners(id) on delete set null;

update appointments a
   set practitioner_id = m.practitioner_id
  from rename_doctor_map m
 where a.business_id = m.old_doctor_id
   and m.practitioner_id is not null;

-- Now the ids themselves. Every one of these was a doctors id and becomes a
-- businesses id.
update appointments             t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update camps_offers             t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update ratings                  t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update rating_responses         t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update payments                 t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update premium_slots            t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update subscriptions            t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update business_pricing_overrides t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update discount_code_usage      t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update practice_locations       t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update invoices                 t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update site_events              t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update login_codes              t set business_id = m.business_id from rename_doctor_map m where t.business_id = m.old_doctor_id;
update seed_clinics             t set claimed_by_business_id = m.business_id from rename_doctor_map m where t.claimed_by_business_id = m.old_doctor_id;
update wa_sessions              t set chosen_business_id = m.business_id from rename_doctor_map m where t.chosen_business_id = m.old_doctor_id;

-- appointment_events, which 0039 renames on the sandbox path.
alter table appointment_events rename column doctor_id to business_id;
alter table appointment_events
  add column if not exists practitioner_id uuid references practitioners(id) on delete set null;
update appointment_events t set business_id = m.business_id
  from rename_doctor_map m where t.business_id = m.old_doctor_id;

-- The new FKs, each keeping its original delete behaviour.
alter table appointments               add constraint appointments_business_fkey               foreign key (business_id) references businesses(id) on delete cascade;
alter table camps_offers               add constraint camps_offers_business_fkey               foreign key (business_id) references businesses(id) on delete cascade;
alter table ratings                    add constraint ratings_business_fkey                    foreign key (business_id) references businesses(id) on delete cascade;
alter table rating_responses           add constraint rating_responses_business_fkey           foreign key (business_id) references businesses(id) on delete cascade;
alter table payments                   add constraint payments_business_fkey                   foreign key (business_id) references businesses(id);
alter table premium_slots              add constraint premium_slots_business_fkey              foreign key (business_id) references businesses(id) on delete cascade;
alter table subscriptions              add constraint subscriptions_business_fkey              foreign key (business_id) references businesses(id) on delete cascade;
alter table business_pricing_overrides add constraint business_pricing_overrides_business_fkey foreign key (business_id) references businesses(id) on delete cascade;
alter table discount_code_usage        add constraint discount_code_usage_business_fkey        foreign key (business_id) references businesses(id);
alter table practice_locations         add constraint practice_locations_business_fkey         foreign key (business_id) references businesses(id) on delete cascade;
alter table invoices                   add constraint invoices_business_fkey                   foreign key (business_id) references businesses(id) on delete set null;
alter table site_events                add constraint site_events_business_fkey                foreign key (business_id) references businesses(id) on delete set null;
alter table login_codes                add constraint login_codes_business_fkey                foreign key (business_id) references businesses(id) on delete cascade;
alter table seed_clinics               add constraint seed_clinics_claimed_by_fkey             foreign key (claimed_by_business_id) references businesses(id) on delete set null;
alter table wa_sessions                add constraint wa_sessions_chosen_business_fkey         foreign key (chosen_business_id) references businesses(id) on delete set null;

create index if not exists appointments_practitioner_idx
  on appointments (practitioner_id, slot_datetime) where practitioner_id is not null;


-- ============================================================================
-- 4. Availability moves onto the posting
-- ============================================================================

alter table doctor_availability rename to availability;
alter table availability rename column doctor_id to business_id;

update availability t set business_id = m.business_id
  from rename_doctor_map m where t.business_id = m.old_doctor_id;

alter table availability
  add constraint availability_business_fkey foreign key (business_id) references businesses(id) on delete cascade;

alter table availability
  add column business_practitioner_id uuid references business_practitioners(id) on delete cascade;

-- Hours that belonged to a solo doctor become that doctor's hours at their own
-- business. A hospital's hours stay the house's — there is no way to know which
-- consultant they described, and guessing would put a doctor in a room they may
-- never sit in.
update availability a
   set business_practitioner_id = bp.id
  from rename_doctor_map m
  join business_practitioners bp
    on bp.business_id = m.business_id and bp.practitioner_id = m.practitioner_id
 where m.kind = 'solo'
   and a.business_id = m.business_id;

create index if not exists availability_affiliation_idx
  on availability (business_practitioner_id, day_of_week) where is_active;


-- ============================================================================
-- 5. Retire the old tables — RENAMED, not dropped.
--
-- 0037 drops them. Here they are kept under a dated name so there is a way back
-- for as long as you want one: every id in rename_doctor_map still resolves.
-- Drop them once the verification below has been checked and the site has run
-- on the new shape for a while. See the last line of this file.
-- ============================================================================

alter table doctors       rename to doctors_legacy_20260819;
alter table organizations rename to organizations_legacy_20260819;
alter table clinic_users  rename to clinic_users_legacy_20260819;

-- Nothing should still be reading them. Take the policies off so a stray query
-- through PostgREST fails loudly rather than returning rows from a dead table.
alter table doctors_legacy_20260819       disable row level security;
alter table organizations_legacy_20260819 disable row level security;
alter table clinic_users_legacy_20260819  disable row level security;
revoke all on doctors_legacy_20260819, organizations_legacy_20260819,
              clinic_users_legacy_20260819 from anon, authenticated;


-- ============================================================================
-- 6. The pieces 0037 recreates, which have nothing to do with data
-- ============================================================================

create index businesses_auth_uid_idx on businesses (auth_uid) where auth_uid is not null;
create index businesses_status_idx on businesses (status);
create index businesses_vertical_idx on businesses (vertical);
create index businesses_pin_codes_idx on businesses using gin (pin_codes);

create unique index practitioners_registration_key
  on practitioners (smc_id, upper(btrim(reg_number)))
  where smc_id is not null and coalesce(btrim(reg_number), '') <> '';

create index practitioners_auth_uid_idx on practitioners (auth_uid) where auth_uid is not null;
create index practitioners_speciality_idx on practitioners (speciality) where status = 'active';
create index practitioners_name_idx on practitioners using gin (to_tsvector('simple', full_name));

create unique index business_practitioners_one_primary
  on business_practitioners (practitioner_id) where is_primary;
create index business_practitioners_business_idx
  on business_practitioners (business_id, role) where status = 'active';
create index business_practitioners_practitioner_idx
  on business_practitioners (practitioner_id) where status = 'active';

create or replace function sehat_create_primary_location()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into practice_locations (business_id, name, address, pin_code, phone, is_primary)
  values (
    new.id,
    coalesce(nullif(btrim(new.name), ''), 'Main branch'),
    new.address,
    case when array_length(new.pin_codes, 1) > 0 then new.pin_codes[1] end,
    new.phone,
    true
  );
  return new;
end $$;

drop trigger if exists businesses_create_primary_location on businesses;
create trigger businesses_create_primary_location
  after insert on businesses
  for each row execute function sehat_create_primary_location();

create or replace function sehat_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger businesses_touch before update on businesses
  for each row execute function sehat_touch_updated_at();
create trigger practitioners_touch before update on practitioners
  for each row execute function sehat_touch_updated_at();
create trigger business_practitioners_touch before update on business_practitioners
  for each row execute function sehat_touch_updated_at();

-- The trigger above fires on INSERT, so the listings carried across in step 2
-- have no practice_location. Give each one its primary branch, as 0015 did.
insert into practice_locations (business_id, name, address, pin_code, phone, is_primary, is_active)
select b.id, coalesce(nullif(btrim(b.name), ''), 'Main branch'), b.address,
       case when array_length(b.pin_codes, 1) > 0 then b.pin_codes[1] end,
       b.phone, true, true
  from businesses b
 where not exists (select 1 from practice_locations p where p.business_id = b.id);


-- ============================================================================
-- 7. Tell the migration runner that 0037 is done.
--
-- Same reasoning as 2026-07-27_apply_0004-0007.sql: running SQL by hand leaves
-- schema_migrations empty, and `npm run migrate:prod` would then try to apply
-- 0037 — the destructive one — on top of this.
--
-- The checksum is sha256 of supabase/migrations/0037_businesses_and_practitioners.sql
-- as committed on 2026-08-19. If that file is ever edited, this value is stale
-- and `migrate verify` will say so.
-- ============================================================================

create table if not exists public.schema_migrations (
  version text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

insert into public.schema_migrations (version, checksum) values
  ('0037_businesses_and_practitioners',
   '62629a726db89d25a118e33b9db03fe48196558ef90fac7a17411df22bd67f6b')
on conflict (version) do nothing;


-- ============================================================================
-- 8. Verification. Read this output before you commit.
--
-- Everything above is inside the transaction, so a failed assertion here rolls
-- the whole thing back.
-- ============================================================================

do $$
declare
  v_old_doctors integer;
  v_mapped      integer;
  v_businesses  integer;
  v_orphan_appt integer;
  v_orphan_inv  integer;
  v_dupe_map    integer;
begin
  select count(*) into v_old_doctors from doctors_legacy_20260819;
  select count(*) into v_mapped      from rename_doctor_map;
  select count(*) into v_businesses  from businesses;

  if v_mapped <> v_old_doctors then
    raise exception 'map covers % of % old listings — every one must be accounted for',
      v_mapped, v_old_doctors;
  end if;

  -- The (name, created_at) re-identification in step 2 could in principle cross
  -- two rows over. If a business is claimed by two old listings, it did.
  select count(*) into v_dupe_map
    from (select business_id from rename_doctor_map
           where kind <> 'consultant'
           group by business_id having count(*) > 1) x;
  if v_dupe_map > 0 then
    raise exception '% businesses are claimed by more than one old listing — the map is not 1:1', v_dupe_map;
  end if;

  -- Nothing may be left pointing at an id that is no longer a business.
  select count(*) into v_orphan_appt from appointments a
   where a.business_id is not null
     and not exists (select 1 from businesses b where b.id = a.business_id);
  if v_orphan_appt > 0 then
    raise exception '% appointments point at a business that does not exist', v_orphan_appt;
  end if;

  select count(*) into v_orphan_inv from invoices i
   where i.business_id is not null
     and not exists (select 1 from businesses b where b.id = i.business_id);
  if v_orphan_inv > 0 then
    raise exception '% invoices point at a business that does not exist', v_orphan_inv;
  end if;

  raise notice 'old listings: %  ->  businesses: %  (consultants folded into their hospital)',
    v_old_doctors, v_businesses;
end $$;

-- Nothing was deleted. These must all match what you recorded before running.
select 'appointments' as t, count(*) from appointments
union all select 'invoices',      count(*) from invoices
union all select 'payments',      count(*) from payments
union all select 'ratings',       count(*) from ratings
union all select 'camps_offers',  count(*) from camps_offers
union all select 'subscriptions', count(*) from subscriptions
union all select 'businesses',    count(*) from businesses
union all select 'practitioners', count(*) from practitioners
union all select 'affiliations',  count(*) from business_practitioners
order by 1;

-- Anything flagged for review — consultants whose hospital listing was missing.
select kind, note, count(*)
  from rename_doctor_map
 where note is not null
 group by kind, note;

commit;

-- ── AFTER THE FACT, once you are satisfied ─────────────────────────────────
-- Run `npm run migrate:prod` to apply 0038-0044 (0037 is now recorded as done).
-- Then, and only then — no earlier than a week of the site running on the new
-- shape, with invoices and payments spot-checked against the map:
--
--   drop table doctors_legacy_20260819;
--   drop table organizations_legacy_20260819;
--   drop table clinic_users_legacy_20260819;
--   drop table rename_doctor_map;
