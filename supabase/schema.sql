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


Token git - 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

Sb publishble key - Anon
sb_publishable_3f7_Q4jM5jwpXT4sNltCBQ_vLGyc87n

Secret keys;
sb_secret_dqw4bWeBDNQjv3BzNiVWsg_rTbDVO62

Sup abase url:
https://ctxkkqqtasegoowuqbmi.supabase.com
