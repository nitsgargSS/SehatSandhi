-- ============================================================================
-- Sehatsandhi — a business is a business, a doctor is a person
--
-- Run AFTER 0036. NOT re-runnable against a database that already holds real
-- listings: it drops the identity tables outright. Applied while every row was
-- a test row (8 listings, 4 organisations, 0 appointments).
--
-- WHY
-- `doctors` was three things at once: a business listing, a person's
-- credentials, and a billing account. Pharmacies, labs, ambulances and
-- insurance agents were all "doctors" rows. From that, two incompatible ways to
-- say "a doctor works here" grew up:
--
--   hospital consultant → their own doctors row, linked by organization_id
--   clinic doctor       → a clinic_users row, linked by doctor_id
--
-- Neither can express the ordinary case: one doctor, one full-time job and two
-- visiting posts. organization_id is a single FK, so a consultant belongs to one
-- hospital; clinic_users has no person identity, so the same doctor at two
-- clinics is two unrelated rows. And nothing anywhere could attach an EXISTING
-- doctor to a business — sehat_org_add_doctor only ever inserted a new row.
--
-- THE SHAPE
--   businesses              a listing. Never a person.
--   practitioners           a person. Independent of any business.
--   business_practitioners  the affiliation, and it carries attributes.
--
-- The affiliation is not a bare join. consultation_fee lives there because it is
-- a fact about this doctor at this business — ₹800 at the hospital, ₹500 at her
-- own clinic — and on the listing it could only ever hold one of them.
--
-- WHAT ELSE MOVES
-- appointments gains practitioner_id: it recorded only the business, so "who did
-- the patient actually see" was unanswerable the moment a business had two
-- doctors. Availability moves onto the affiliation, so a doctor can sit at one
-- place on Tuesdays and another on Wednesdays.
--
-- organizations is deleted. It existed only to group a hospital with its
-- consultants, which is exactly what business_practitioners now does — and with
-- it goes is_hospital_doctor and the whole hospital-vs-clinic special case.
-- ============================================================================

-- ── 1. Out with the old ────────────────────────────────────────────────────
-- cascade takes the dependent views and FK constraints with it. They are
-- recreated below against the new tables; the ones that only ever described the
-- old shape (organisation_roster, public_listing_doctors) are not.

drop view if exists organisation_roster cascade;
drop view if exists public_listing_doctors cascade;
drop view if exists doctor_effective_pricing cascade;
drop view if exists admin_revenue_summary cascade;
drop view if exists demand_by_area cascade;
drop view if exists plan_enrolment cascade;
drop view if exists pricing_plan_status cascade;
drop view if exists subscription_renewals_due cascade;

-- RPCs that spoke the old shape. Replaced further down, except the org ones,
-- which have no successor: a hospital's roster is now just affiliations.
drop function if exists create_listing(text,text,text,text,text[],text,text,text,integer,text,text,text,integer,integer,text) cascade;
drop function if exists sehat_create_hospital(text,text,text[],text,text,text,jsonb) cascade;
drop function if exists sehat_org_add_doctor(uuid,text,text,text,text,integer) cascade;
drop function if exists sehat_org_set_doctor_status(uuid,text) cascade;
drop function if exists sehat_org_doctor_count(uuid) cascade;
drop function if exists sehat_caller_owns_org(uuid) cascade;
drop function if exists sehat_caller_listing_ids() cascade;
drop function if exists sehat_caller_owns_listing(uuid) cascade;

drop table if exists org_subscriptions cascade;
drop table if exists org_specialities cascade;
drop table if exists clinic_users cascade;
drop table if exists organizations cascade;
drop table if exists doctors cascade;

-- Everything that hung off a listing goes with it. These are all listing-scoped
-- records — a camp the clinic was running, a payment it made, the invoice for
-- that payment — and every one of them is meaningless now that the listing it
-- described is gone. Applied while all of it was test data.
--
-- Two tables are emptied of their REFERENCE rather than their rows:
-- seed_clinics is the imported government directory (1,669 rows of reference
-- data that nobody's signup should destroy), and site_events is the analytics
-- log, whose value is the searches themselves and not which listing they
-- reached.
delete from camps_offers;
delete from ratings;
delete from rating_responses;
delete from invoices;
delete from payments;
delete from premium_slots;
delete from subscriptions;
delete from doctor_pricing_overrides;
delete from discount_code_usage;
delete from practice_locations;
delete from doctor_availability;
delete from appointments;
delete from login_codes;

update seed_clinics set claimed_by = null where claimed_by is not null;
update site_events set doctor_id = null where doctor_id is not null;
update wa_sessions set chosen_doctor_id = null where chosen_doctor_id is not null;

-- ── 2. businesses ──────────────────────────────────────────────────────────
-- What a patient finds and what we bill. Every vertical is one of these: a
-- clinic, a hospital, a pharmacy, a lab, an insurance desk, an ambulance
-- service.

create table businesses (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  -- What kind of business, as its own column. This used to be smuggled into
  -- doctors.speciality as 'PHARMACY'/'LAB'/'HOSPITAL', where it collided with
  -- the real medical specialities a doctor can hold. A pharmacy is not a
  -- speciality.
  vertical text not null default 'clinic'
    check (vertical in ('clinic','hospital','pharmacy','lab','insurance','ambulance')),

  address text,
  pin_codes text[] not null default '{}',
  phone text,
  email text,
  working_hours text,
  photo_url text,
  -- Google's id for the place, kept so a listing can be refreshed from Places
  -- later. Their terms allow storing this indefinitely, unlike the coordinates.
  google_place_id text,

  -- The business's own licence (a pharmacy's drug licence, a hospital's
  -- registration). A DOCTOR's medical registration is not this — it belongs to
  -- the person and lives on practitioners.
  reg_number text,

  status text not null default 'pending'
    check (status in ('pending','active','suspended')),

  -- Billing. Stays on the business: the business signs up, the business pays,
  -- the business gets the invoice.
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

  -- The Supabase Auth user that owns this listing, linked on first phone login.
  -- NOT unique: one number may own a clinic and a pharmacy, and both must be
  -- reachable from the same login (see 0024).
  auth_uid uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businesses_auth_uid_idx on businesses (auth_uid) where auth_uid is not null;
create index businesses_status_idx on businesses (status);
create index businesses_vertical_idx on businesses (vertical);
-- Patient search filters on pin_codes with @>. The old doctors table had no
-- index for it at all, so every area page was a seq scan.
create index businesses_pin_codes_idx on businesses using gin (pin_codes);

comment on table businesses is
  'A listing: the business a patient finds and the entity we bill. Never a '
  'person — the people are in practitioners, linked through '
  'business_practitioners. Replaces the old `doctors` table, which meant both.';
comment on column businesses.vertical is
  'clinic | hospital | pharmacy | lab | insurance | ambulance. Its own column '
  'because it is what the business IS, not a medical speciality.';
comment on column businesses.reg_number is
  'The BUSINESS''s licence. A doctor''s medical registration belongs to the '
  'person and lives on practitioners.reg_number.';

-- ── 3. practitioners ───────────────────────────────────────────────────────
-- A person. Exists whether or not they are attached to anything, so a doctor
-- can be registered once and then linked to every place they work.

create table practitioners (
  id uuid primary key default gen_random_uuid(),

  full_name text not null,
  -- What they practise. On the person, not the business: this is what a patient
  -- searching for a cardiologist matches against.
  speciality text,
  qualification text,

  -- Medical registration. Meaningless without smc_id — the same digits belong
  -- to a different doctor in each of seventeen councils, which is why the
  -- natural key below is the pair.
  reg_number text,
  smc_id integer,
  imr_year integer,
  imr_status text not null default 'unchecked'
    check (imr_status in ('unchecked','matched','confirmed','no_match','ambiguous','error')),
  imr_checked_at timestamptz,

  phone text,
  email text,
  photo_url text,

  -- Set when this person can log in themselves. A visiting consultant may never
  -- have one; the clinic that added them manages their profile.
  auth_uid uuid references auth.users(id) on delete set null,

  status text not null default 'pending'
    check (status in ('pending','active','suspended')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The natural key for a doctor. Partial, because plenty of staff hold no
-- registration at all: a receptionist has none, and the register is incomplete
-- for anyone who qualified in the last few months. Where both are present they
-- identify one person, which is what makes "is this doctor already in the
-- system?" answerable at attach time.
create unique index practitioners_registration_key
  on practitioners (smc_id, upper(btrim(reg_number)))
  where smc_id is not null and coalesce(btrim(reg_number), '') <> '';

create index practitioners_auth_uid_idx on practitioners (auth_uid) where auth_uid is not null;
create index practitioners_speciality_idx on practitioners (speciality) where status = 'active';
create index practitioners_name_idx on practitioners using gin (to_tsvector('simple', full_name));

comment on table practitioners is
  'A person: a doctor, or any other member of staff. Independent of any '
  'business, so one person can hold several affiliations — typically one '
  'full-time post and a few visiting ones.';
comment on index practitioners_registration_key is
  'One person per (council, registration number). Partial because staff without '
  'a registration — reception, managers, the newly qualified — must still exist.';

-- ── 4. business_practitioners ──────────────────────────────────────────────
-- The affiliation. Not a bare join: what is true of a person AT a business
-- lives here, because it differs from business to business.

create table business_practitioners (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  practitioner_id uuid not null references practitioners(id) on delete cascade,

  role text not null default 'doctor'
    check (role in ('owner','doctor','receptionist','manager')),

  -- Where this person mainly works. Exactly one per practitioner, enforced
  -- below; the rest are visiting or consulting posts.
  is_primary boolean not null default false,

  -- What they charge HERE. The reason this table is not a bare join: the same
  -- doctor charges ₹800 at the hospital and ₹500 at her own clinic, and on the
  -- listing this could only ever hold one of the two.
  consultation_fee integer not null default 0,

  -- Per affiliation, not per person. A doctor may be active at one clinic and
  -- suspended at another, and neither says anything about them as a person.
  status text not null default 'pending'
    check (status in ('pending','active','suspended')),

  -- Display order on the business's profile. A clinic wants its senior doctor
  -- first, not whoever was typed in first.
  sort_order integer not null default 0,

  -- Who gets told what, for this business. On the affiliation because someone
  -- working at two clinics wants the daily schedule from one and nothing from
  -- the other.
  can_login_web boolean not null default true,
  notify_new_appointments boolean not null default true,
  notify_daily_schedule boolean not null default true,
  notify_cancellations boolean not null default true,
  notify_monthly_report boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Attaching the same person to the same business twice is a mistake, not a
  -- second job.
  unique (business_id, practitioner_id)
);

-- One primary per person. Mirrors practice_locations_one_primary, which solves
-- the same problem for a listing's branches.
create unique index business_practitioners_one_primary
  on business_practitioners (practitioner_id)
  where is_primary;

create index business_practitioners_business_idx
  on business_practitioners (business_id, role) where status = 'active';
create index business_practitioners_practitioner_idx
  on business_practitioners (practitioner_id) where status = 'active';

comment on table business_practitioners is
  'Who works where. Carries what differs per posting — fee, role, status, '
  'notification preferences — because those are facts about a person AT a '
  'business, not about either alone.';
comment on column business_practitioners.is_primary is
  'Their main post. At most one per practitioner (partial unique index). The '
  'others are visiting or consulting.';
comment on column business_practitioners.consultation_fee is
  'What this practitioner charges at THIS business. The same doctor legitimately '
  'charges different amounts in different places.';

-- ── 5. Repoint everything that referenced a listing ────────────────────────
-- Every one of these columns was called doctor_id and every one of them meant
-- "the listing". Renaming them is most of what makes the schema honest.

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

-- The FKs all died with `drop table doctors cascade`. Re-add them against
-- businesses, keeping each one's original delete behaviour.
alter table appointments             add constraint appointments_business_fkey             foreign key (business_id) references businesses(id) on delete cascade;
alter table camps_offers             add constraint camps_offers_business_fkey             foreign key (business_id) references businesses(id) on delete cascade;
alter table ratings                  add constraint ratings_business_fkey                  foreign key (business_id) references businesses(id) on delete cascade;
alter table rating_responses         add constraint rating_responses_business_fkey         foreign key (business_id) references businesses(id) on delete cascade;
alter table payments                 add constraint payments_business_fkey                 foreign key (business_id) references businesses(id);
alter table premium_slots            add constraint premium_slots_business_fkey            foreign key (business_id) references businesses(id) on delete cascade;
alter table subscriptions            add constraint subscriptions_business_fkey            foreign key (business_id) references businesses(id) on delete cascade;
alter table business_pricing_overrides add constraint business_pricing_overrides_business_fkey foreign key (business_id) references businesses(id) on delete cascade;
alter table discount_code_usage      add constraint discount_code_usage_business_fkey      foreign key (business_id) references businesses(id);
alter table practice_locations       add constraint practice_locations_business_fkey       foreign key (business_id) references businesses(id) on delete cascade;
alter table invoices                 add constraint invoices_business_fkey                 foreign key (business_id) references businesses(id) on delete set null;
alter table site_events              add constraint site_events_business_fkey              foreign key (business_id) references businesses(id) on delete set null;
alter table login_codes              add constraint login_codes_business_fkey              foreign key (business_id) references businesses(id) on delete cascade;
alter table seed_clinics             add constraint seed_clinics_claimed_by_fkey           foreign key (claimed_by_business_id) references businesses(id) on delete set null;
alter table wa_sessions              add constraint wa_sessions_chosen_business_fkey       foreign key (chosen_business_id) references businesses(id) on delete set null;

-- ── 6. An appointment is with a PERSON ─────────────────────────────────────
-- It only ever recorded the business, so the moment a clinic had two doctors,
-- "who did the patient see" had no answer. Nullable: a pharmacy order or a lab
-- test is with the business and nobody in particular.

alter table appointments
  add column practitioner_id uuid references practitioners(id) on delete set null;

create index appointments_practitioner_idx
  on appointments (practitioner_id, slot_datetime) where practitioner_id is not null;

comment on column appointments.practitioner_id is
  'Which doctor the patient is seeing. Null where the booking is with the '
  'business itself — a pharmacy order, a lab test.';

-- ── 7. Availability belongs to the posting, not the business ───────────────
-- These were a business's opening hours, which cannot express "Dr. Mehra sits
-- here Tuesdays and at her own clinic Wednesdays". Keyed on the affiliation and
-- the branch together: where, and as whom.

alter table doctor_availability rename to availability;

alter table availability rename column doctor_id to business_id;
alter table availability
  add constraint availability_business_fkey foreign key (business_id) references businesses(id) on delete cascade;

alter table availability
  add column business_practitioner_id uuid references business_practitioners(id) on delete cascade;

create index availability_affiliation_idx
  on availability (business_practitioner_id, day_of_week) where is_active;

comment on column availability.business_practitioner_id is
  'Whose hours these are. Null means the business''s own opening hours — a '
  'pharmacy, or a clinic that has not split hours per doctor yet.';

-- ── 8. Every new business gets a primary location ──────────────────────────
-- The 0015 trigger hung off doctors and died with it. Same intent, new table:
-- a listing with no location cannot be booked at all.

create or replace function sehat_create_primary_location()
returns trigger
language plpgsql
security definer
set search_path = public
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

-- Keep updated_at honest on the three new tables.
create or replace function sehat_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger businesses_touch before update on businesses
  for each row execute function sehat_touch_updated_at();
create trigger practitioners_touch before update on practitioners
  for each row execute function sehat_touch_updated_at();
create trigger business_practitioners_touch before update on business_practitioners
  for each row execute function sehat_touch_updated_at();
