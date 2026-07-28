-- ============================================================================
-- Sehatsandhi — real admin authentication, and RLS that lets admin work
--
-- Run AFTER 0011. Safe to re-run.
--
-- WHAT WAS WRONG
-- The admin login compared typed values against VITE_ADMIN_EMAIL/VITE_ADMIN_PASS,
-- which Vite compiles into the public JS bundle — the credentials and the
-- "hidden" admin path were both readable by any visitor who opened the bundle.
-- Anyone could set sessionStorage.admin_auth and walk in.
--
-- It was also broken in the other direction. The dashboard reads with the anon
-- key, whose only policy on doctors is status = 'active' — so pending
-- registrations never appeared in the approval queue, and Activate had no UPDATE
-- policy to write through. Nobody noticed because no business has registered yet.
--
-- Both are the same missing piece: the database had no idea who an admin is.
--
-- HOW IT WORKS NOW
-- An admin is a Supabase Auth user listed in admin_users. Authentication happens
-- server-side against a hashed password; the browser holds a signed JWT it cannot
-- forge. sehat_is_admin() reads that JWT, and every policy below is written in
-- terms of it, so the same identity governs the UI and the data.
-- ============================================================================

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  -- The Supabase Auth user. On delete cascade: removing the login removes the
  -- grant, so a deleted account can never leave a live permission behind.
  auth_uid uuid not null unique references auth.users(id) on delete cascade,
  email text,
  role text not null default 'admin' check (role in ('admin', 'owner')),
  is_active boolean not null default true,
  created_at timestamptz default now(),
  created_by text
);

comment on table admin_users is
  'Who may use the admin dashboard. Membership here — not a password in the JS '
  'bundle — is what grants access. Revoke by setting is_active = false.';

-- ── The predicate every policy below is written against ────────────────────
-- SECURITY DEFINER so the policies can read admin_users without needing a
-- policy on admin_users itself, which would be circular. STABLE so Postgres
-- evaluates it once per statement rather than per row.

create or replace function sehat_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_users
    where auth_uid = auth.uid() and is_active
  );
$$;

comment on function sehat_is_admin is
  'True when the caller''s JWT belongs to an active admin. The anon key alone is '
  'never enough — auth.uid() is null without a signed-in user.';

alter table admin_users enable row level security;

-- An admin may see the admin list (to know who else has access) but never edit
-- it from the browser. Granting admin is a service-role operation, so a stolen
-- admin session cannot promote anyone.
drop policy if exists "admins_read_admin_users" on admin_users;
create policy "admins_read_admin_users" on admin_users
  for select using (sehat_is_admin());

-- ── Policies that make the dashboard function ──────────────────────────────
-- Each is additive: the existing public/doctor policies are untouched, so the
-- patient directory and the clinic dashboards keep working exactly as before.

-- doctors: the approval queue needs to see pending rows, and Activate needs to
-- write. This is the bug that would have surfaced on the first registration.
drop policy if exists "admins_read_doctors" on doctors;
create policy "admins_read_doctors" on doctors
  for select using (sehat_is_admin());

drop policy if exists "admins_update_doctors" on doctors;
create policy "admins_update_doctors" on doctors
  for update using (sehat_is_admin()) with check (sehat_is_admin());

-- appointments: read for support ("the patient says nobody called"), and update
-- so an admin can cancel on a clinic's behalf. No delete — the audit trail in
-- appointment_events is worth more than tidiness.
drop policy if exists "admins_read_appointments" on appointments;
create policy "admins_read_appointments" on appointments
  for select using (sehat_is_admin());

drop policy if exists "admins_update_appointments" on appointments;
create policy "admins_update_appointments" on appointments
  for update using (sehat_is_admin()) with check (sehat_is_admin());

-- payments and invoices: read only, always. Money rows are written by the
-- Razorpay functions on the service role and by sehat_issue_invoice; an admin
-- editing either by hand would put the books and the gateway out of step.
drop policy if exists "admins_read_payments" on payments;
create policy "admins_read_payments" on payments
  for select using (sehat_is_admin());

drop policy if exists "admins_read_invoices" on invoices;
create policy "admins_read_invoices" on invoices
  for select using (sehat_is_admin());

-- patients: deliberately NOT granted. The dashboard has no screen for it, and
-- the register import carries names, phone numbers and visit history. Access is
-- through the messaging views on the service role, which is auditable. Add a
-- policy here only alongside a screen that needs it.

-- ── Tighten tax_settings ───────────────────────────────────────────────────
-- read_tax_settings was `using (true)`, publishing legal name, GSTIN, registered
-- address, phone and email to anyone holding the public key. The public pages
-- need only enough to render a price correctly, so that is all they get; the
-- full row stays available to admins and to the invoice functions.

drop policy if exists "read_tax_settings" on tax_settings;

drop policy if exists "admins_read_tax_settings" on tax_settings;
create policy "admins_read_tax_settings" on tax_settings
  for select using (sehat_is_admin());

create or replace view public_tax_display
with (security_invoker = off) as
  select gst_enabled, gst_rate, state_code, sac_code,
         (gstin is not null) as has_gstin
  from tax_settings where id;

comment on view public_tax_display is
  'What /business and the signup wizard need to show a price with GST — the rate, '
  'whether it applies, and the supplier state for the CGST/SGST vs IGST split. '
  'security_invoker = off deliberately: it reads tax_settings on the view owner''s '
  'behalf so the underlying row stays admin-only.';

grant select on public_tax_display to anon, authenticated;

-- ── Seed the first admin from an existing auth user, if one matches ────────
-- Idempotent and safe on a project with no such user: creating auth users is a
-- service-role operation, done from the CLI, not from a migration.

insert into admin_users (auth_uid, email, role, created_by)
select u.id, u.email, 'owner', 'migration 0012'
from auth.users u
where u.email in ('nits.garg@gmail.com', 'admin@sehatsandhi.com')
on conflict (auth_uid) do nothing;
