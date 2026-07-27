-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Sehatsandhi Database Schema

create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qualification text,
  reg_number text,
  speciality text,
  clinic_name text,
  address text,
  pin_codes text[],
  phone text,
  email text,
  consultation_fee integer default 0,
  working_hours text,
  photo_url text,
  status text default 'pending' check (status in ('pending','active','suspended')),
  created_at timestamptz default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references doctors(id) on delete cascade,
  pin_codes text[],
  base_fee integer,
  start_date date,
  end_date date,
  status text default 'active' check (status in ('active','expired','cancelled')),
  razorpay_subscription_id text,
  created_at timestamptz default now()
);

create table if not exists premium_slots (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references doctors(id) on delete cascade,
  pin_code text,
  speciality text,
  position integer check (position in (1,2,3)),
  week_start date,
  week_end date,
  price integer,
  status text default 'booked' check (status in ('booked','available','expired')),
  razorpay_payment_id text,
  created_at timestamptz default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  patient_phone text,
  patient_name text,
  patient_age integer,
  doctor_id uuid references doctors(id) on delete cascade,
  slot_datetime timestamptz,
  status text default 'booked' check (status in ('booked','confirmed','completed','cancelled')),
  booked_via text default 'whatsapp_bot',
  confirmation_sent boolean default false,
  reminder_sent boolean default false,
  created_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references doctors(id),
  amount integer,
  type text check (type in ('subscription','premium_slot')),
  razorpay_payment_id text,
  status text default 'pending' check (status in ('pending','paid','failed')),
  created_at timestamptz default now()
);

create table if not exists opt_outs (
  id uuid primary key default gen_random_uuid(),
  phone_hash text unique not null,
  opted_out_at timestamptz default now(),
  channel text,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table doctors      enable row level security;
alter table appointments enable row level security;
alter table payments     enable row level security;

-- Allow public insert for doctor registration
create policy "allow_insert_doctors" on doctors for insert with check (true);
create policy "allow_insert_appointments" on appointments for insert with check (true);

-- Allow public read of active doctors (for bot and listing page)
create policy "allow_read_active_doctors" on doctors for select using (status = 'active');

-- Allow doctors to read their own record
create policy "doctors_read_own" on doctors for select using (auth.jwt() ->> 'email' = email);
create policy "doctors_update_own" on doctors for update using (auth.jwt() ->> 'email' = email);

-- Allow anon read of opt_outs for suppression check
create policy "allow_read_optouts" on opt_outs for select using (true);
create policy "allow_insert_optouts" on opt_outs for insert with check (true);

-- ============================================================================
-- Business coverage & pricing (Task 1: landing + onboarding wizard)
-- service_areas + pricing_tiers already exist in the live DB and are read by
-- src/hooks/useServiceAreas.ts. Defined here so the schema is the source of
-- truth and a fresh project matches production. `population` is added so the
-- wizard can show true "residents reached" instead of a tier estimate.
-- ============================================================================

create table if not exists pricing_tiers (
  tier_number integer primary key,
  tier_name text not null,
  monthly_price integer not null,          -- ₹ / pincode / month
  premium_slot_1_weekly integer default 0,
  premium_slot_2_weekly integer default 0,
  premium_slot_3_weekly integer default 0,
  is_active boolean default true
);

create table if not exists service_areas (
  pin_code text primary key,
  area_name text not null,
  district text,
  state text,
  population integer default 0,            -- true residents in the pincode
  tier_number integer references pricing_tiers(tier_number),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Seed the four population tiers from the pricing spec. Village < 15k (₹400),
-- Town 15-50k (₹1,000), Large town 50-100k (₹2,000), City 100k+ (₹3,000).
insert into pricing_tiers (tier_number, tier_name, monthly_price) values
  (4, 'Village',    400),
  (3, 'Town',       1000),
  (2, 'Large town', 2000),
  (1, 'City',       3000)
on conflict (tier_number) do update
  set tier_name = excluded.tier_name, monthly_price = excluded.monthly_price;

-- ============================================================================
-- Per-vertical billing model. Not every vertical pays for reach: doctors,
-- hospitals and labs buy pincodes monthly (pricing_tiers above), while
-- pharmacies, insurance agents and ambulance services list free and pay a
-- percentage of what they bill instead. This table is the authority the edge
-- functions read — src/pages/business/shared.ts mirrors it for display only.
--
-- A listing's vertical is inferred from doctors.speciality (there is no
-- vertical column), so db_speciality is the join key back to a listing.
-- ============================================================================

create table if not exists vertical_billing (
  vertical text primary key,                 -- doctors|hospital|pharmacy|lab|insurance|ambulance
  db_speciality text not null,               -- doctors.speciality written by the wizard
  billing_model text not null default 'pincode_monthly'
    check (billing_model in ('pincode_monthly','commission')),
  commission_percent numeric(5,2) default 0, -- only meaningful when model = 'commission'
  commission_basis text,                     -- what the % is taken of, shown to the business
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
on conflict (vertical) do update
  set db_speciality      = excluded.db_speciality,
      billing_model      = excluded.billing_model,
      commission_percent = excluded.commission_percent,
      commission_basis   = excluded.commission_basis;

-- ============================================================================
-- Business auth: a login per registered business (used by /doctor/login and
-- the future business dashboard). Kept minimal; passwords live in Supabase Auth.
-- ============================================================================

create table if not exists clinic_users (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid unique,                    -- Supabase auth.users id
  doctor_id uuid references doctors(id) on delete cascade,
  email text,
  role text default 'owner' check (role in ('owner','staff')),
  created_at timestamptz default now()
);

-- ============================================================================
-- Payments: extend to cover the onboarding "listing" charge and carry the
-- coverage the payment was for, so the server can reconcile against tiers.
-- ============================================================================

alter table payments add column if not exists pin_codes text[];
alter table payments add column if not exists razorpay_order_id text;
alter table payments add column if not exists period_months integer default 1;
-- widen the allowed payment types to include the onboarding listing fee
alter table payments drop constraint if exists payments_type_check;
alter table payments add constraint payments_type_check
  check (type in ('subscription','premium_slot','listing'));

-- ============================================================================
-- Booking-side tables the WhatsApp bot will use (bot backend is a SEPARATE
-- effort — see README). Defined now so the schema is complete and the wizard/
-- pricing logic can reference discounts/overrides.
-- ============================================================================

-- NOTE: patients is extended substantially by supabase/migrations/0004_patient_register_import.sql (register
-- imports, consent, visits, messaging views for AISensy/MSG91). Run that file
-- after this one; it also enables RLS on this table.
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,              -- WhatsApp number, country code, no +
  name text,
  area text,
  pin_code text,
  lang text default 'hi' check (lang in ('en','hi')),
  created_at timestamptz default now()
);

-- Per-doctor pricing overrides (custom / discounted listing price).
create table if not exists doctor_pricing_overrides (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references doctors(id) on delete cascade,
  tier_number integer references pricing_tiers(tier_number),
  monthly_price integer not null,          -- overrides pricing_tiers.monthly_price
  reason text,
  created_at timestamptz default now()
);

-- Discount codes applied at booking / onboarding.
create table if not exists discount_codes (
  code text primary key,
  percent_off integer check (percent_off between 0 and 100),
  amount_off integer,                      -- flat ₹ off (alternative to percent)
  applies_to text default 'booking' check (applies_to in ('booking','listing')),
  active boolean default true,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- Post-visit ratings (patient phone stored hashed for privacy).
create table if not exists ratings (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references appointments(id) on delete set null,
  doctor_id uuid references doctors(id) on delete cascade,
  patient_phone_hash text,
  overall_rating integer check (overall_rating between 1 and 5),
  waiting_time integer check (waiting_time between 1 and 5),
  communication integer check (communication between 1 and 5),
  value_for_money integer check (value_for_money between 1 and 5),
  review_text text,
  created_at timestamptz default now()
);

-- Snapshot the fee & any discount on the appointment at booking time, so later
-- price/override changes don't rewrite history.
alter table appointments add column if not exists consultation_fee integer;
alter table appointments add column if not exists discount_code text;

-- RLS for the new public-read reference tables
alter table service_areas enable row level security;
alter table pricing_tiers enable row level security;
alter table vertical_billing enable row level security;
create policy "read_service_areas" on service_areas for select using (is_active = true);
create policy "read_pricing_tiers" on pricing_tiers for select using (is_active = true);
-- Read-only to the world: rates change in the SQL editor, never from the client.
create policy "read_vertical_billing" on vertical_billing for select using (is_active = true);
