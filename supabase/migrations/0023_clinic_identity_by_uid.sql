-- ============================================================================
-- Sehatsandhi — a clinic is identified by who it is, not by an email it may not have
--
-- Run AFTER 0022. Safe to re-run.
--
-- WHY
-- Every doctor-facing policy asks `doctors.email = auth.jwt() ->> 'email'`. That
-- worked while the only signup path was the legacy /doctor form, which required
-- an email and a password. The business wizard — the one that takes payment —
-- collects email as OPTIONAL and creates no login at all, so a business can pay,
-- be activated, and have no way into the dashboard where its reports, roster,
-- GSTIN and appointments live.
--
-- Login is moving to a one-time code sent to the WhatsApp number, which is
-- required at signup and is how this audience already thinks. A phone login has
-- no email to match on, so identity moves to the auth user id.
--
-- ADDITIVE, NOT A REPLACEMENT
-- Every policy below resolves through sehat_caller_listing_ids(), which accepts
-- ALL of: the legacy email match, the new auth_uid link, and active clinic staff.
-- Anyone who can log in today still can; nothing is taken away.
-- ============================================================================

alter table doctors add column if not exists auth_uid uuid references auth.users(id) on delete set null;
create unique index if not exists doctors_auth_uid_key on doctors (auth_uid) where auth_uid is not null;

comment on column doctors.auth_uid is
  'The Supabase Auth user that owns this listing, linked on first phone login. '
  'Unique: one login owns at most one listing. Null until they first sign in.';

-- ── The one definition of "which listings does the caller own" ─────────────
-- SECURITY DEFINER so a policy can consult doctors and clinic_users without
-- recursing through their own policies.

create or replace function sehat_caller_listing_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  -- Linked by phone login.
  select d.id from doctors d
   where d.auth_uid is not null and d.auth_uid = auth.uid()
  union
  -- Legacy email/password login, still honoured.
  select d.id from doctors d
   where d.email is not null and d.email <> '' and d.email = auth.jwt() ->> 'email'
  union
  -- Reception and other staff the clinic has added.
  select cu.doctor_id from clinic_users cu
   where cu.supabase_user_id = auth.uid() and cu.is_active and cu.doctor_id is not null;
$$;

comment on function sehat_caller_listing_ids is
  'Listings the current session may act on, by any of three routes: the auth_uid '
  'linked at phone login, a matching email from the legacy password login, or '
  'active clinic_users staff. The single authority for doctor-facing RLS.';

grant execute on function sehat_caller_listing_ids() to authenticated;

-- ── Repoint the doctor-facing policies at it ───────────────────────────────
-- Same access as before plus the auth_uid route. Listed table by table so a
-- future reader can see exactly what a clinic reaches.

drop policy if exists "doctors_read_own" on doctors;
create policy "doctors_read_own" on doctors
  for select using (id in (select sehat_caller_listing_ids()));

drop policy if exists "doctors_update_own" on doctors;
create policy "doctors_update_own" on doctors
  for update using (id in (select sehat_caller_listing_ids()))
  with check (id in (select sehat_caller_listing_ids()));

drop policy if exists "doctors_read_own_appointments" on appointments;
create policy "doctors_read_own_appointments" on appointments
  for select using (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "doctors_update_own_appointments" on appointments;
create policy "doctors_update_own_appointments" on appointments
  for update using (doctor_id in (select sehat_caller_listing_ids()))
  with check (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "clinic_read_appointment_events" on appointment_events;
create policy "clinic_read_appointment_events" on appointment_events
  for select using (appointment_id in (
    select a.id from appointments a where a.doctor_id in (select sehat_caller_listing_ids())
  ));

drop policy if exists "doctors_read_own_camps" on camps_offers;
create policy "doctors_read_own_camps" on camps_offers
  for select using (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "doctors_insert_own_camps" on camps_offers;
create policy "doctors_insert_own_camps" on camps_offers
  for insert with check (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "doctor_manages_own_availability" on doctor_availability;
create policy "doctor_manages_own_availability" on doctor_availability
  for all using (doctor_id in (select sehat_caller_listing_ids()))
  with check (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "clinic_manages_own_locations" on practice_locations;
create policy "clinic_manages_own_locations" on practice_locations
  for all using (doctor_id in (select sehat_caller_listing_ids()))
  with check (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "owner_manages_own_clinic_users" on clinic_users;
create policy "owner_manages_own_clinic_users" on clinic_users
  for all using (doctor_id in (select sehat_caller_listing_ids()))
  with check (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "doctors_read_own_ratings" on ratings;
create policy "doctors_read_own_ratings" on ratings
  for select using (doctor_id in (select sehat_caller_listing_ids()));

drop policy if exists "doctors_insert_own_responses" on rating_responses;
create policy "doctors_insert_own_responses" on rating_responses
  for insert with check (rating_id in (
    select r.id from ratings r where r.doctor_id in (select sehat_caller_listing_ids())
  ));

drop policy if exists "doctors_read_own_code_usage" on discount_code_usage;
create policy "doctors_read_own_code_usage" on discount_code_usage
  for select using (doctor_id in (select sehat_caller_listing_ids()));

-- ── One-time login codes ───────────────────────────────────────────────────
-- Codes are stored hashed. A readable OTP table is a list of live credentials,
-- and this one is reachable from an edge function that anyone can call.

create table if not exists login_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,                        -- normalised, digits only with country code
  code_hash text not null,                    -- sha256 of the code, never the code
  doctor_id uuid references doctors(id) on delete cascade,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists login_codes_phone_idx on login_codes (phone, created_at desc);

comment on table login_codes is
  'Short-lived one-time codes for clinic login. Hashed, single-use, expiring. '
  'RLS on with no policies: only the service role behind the login functions '
  'touches this, never a browser.';

alter table login_codes enable row level security;

-- Housekeeping. Consumed and expired codes have no value and are a standing
-- liability, so they do not accumulate.
create or replace function sehat_purge_login_codes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v integer;
begin
  delete from login_codes
   where expires_at < now() - interval '1 day' or consumed_at is not null;
  get diagnostics v = row_count;
  return v;
end $$;
