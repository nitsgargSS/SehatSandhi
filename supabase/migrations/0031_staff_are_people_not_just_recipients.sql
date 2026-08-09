-- ============================================================================
-- Sehatsandhi — a listing has staff, and some of them are doctors
--
-- Run AFTER 0030. Safe to re-run.
--
-- WHY
-- A listing is a business, not a person. A clinic with three doctors buys one
-- listing, and until now there was nowhere to record the other two: doctors.
-- reg_number and doctors.qualification are single columns describing the
-- business, so whoever signed up is the only doctor the system knows about.
--
-- The shape we want is business → staff, many, each with a role. clinic_users is
-- already exactly that — doctor_id, full_name, role in (owner, doctor,
-- receptionist, manager) — but it was built to decide who gets which WhatsApp
-- notification, so it knows how to reach someone and nothing about who they are.
-- Adding a parallel table would leave two staff lists to keep in step. These
-- columns finish the one we have.
--
-- WHAT THIS IS NOT
-- Staff do not become listings. sehat_create_hospital gives a consultant their
-- own doctors row because a hospital's consultants are separately searchable and
-- separately billed; a clinic's doctors are not. They appear on the clinic's
-- profile, under the clinic's listing, on the clinic's one bill.
--
-- Profiles for staff come later. This is the record those will hang off.
-- ============================================================================

-- Credentials, for the staff who have them. All nullable: a receptionist has no
-- registration number, and a clinic that only wants to name its doctors should
-- not be forced to hold their paperwork.
alter table clinic_users add column if not exists qualification text;
alter table clinic_users add column if not exists reg_number text;
alter table clinic_users add column if not exists speciality text;

-- Which council issued reg_number. Same reason it is needed on a listing: a
-- registration number means nothing without one, since the same digits belong to
-- a different doctor in each of seventeen councils.
alter table clinic_users add column if not exists smc_id int;

-- Whether a human has checked this person's registration against the register.
-- Deliberately mirrors doctors.imr_status: an admin reviewing a clinic is
-- reviewing its doctors, and the answer should read the same in both places.
alter table clinic_users add column if not exists imr_status text
  check (imr_status in ('unchecked','matched','confirmed','no_match','ambiguous','error'));
alter table clinic_users add column if not exists imr_checked_at timestamptz;

-- Ordering for display. A clinic wants its senior doctor first, not whoever was
-- typed in first.
alter table clinic_users add column if not exists sort_order int not null default 0;

comment on table clinic_users is
  'The people at a listing: owner, doctors, reception, managers. One row per '
  'person, many per listing. Carries both how to reach them (the notify_* flags, '
  'can_login_web) and who they are (qualification, reg_number, speciality). '
  'Staff are not listings — a clinic''s doctors are shown under the clinic and '
  'billed as one. Hospitals are the exception and use sehat_create_hospital, '
  'where each consultant is separately searchable and separately charged.';

comment on column clinic_users.role is
  'owner | doctor | receptionist | manager. Drives both what they can do and how '
  'they are shown: only doctors appear as practitioners on the public profile.';

comment on column clinic_users.reg_number is
  'Medical registration, for staff who hold one. Null for non-clinical roles. '
  'Meaningless without smc_id — the same number belongs to a different doctor in '
  'each council.';

-- The public profile lists a clinic's doctors, so it needs to read them for an
-- active listing — and only them. Reception and managers are internal, and the
-- notify_* flags and whatsapp_number on every row are staff contact details that
-- do not belong on a public page.
--
-- A view rather than a policy on the table: RLS in Postgres is row-level, so a
-- policy allowing the public to read doctor rows would expose every column of
-- those rows, whatsapp_number included.
create or replace view public_listing_doctors as
  select
    cu.doctor_id  as listing_id,
    cu.full_name,
    cu.qualification,
    cu.speciality,
    cu.sort_order
  from clinic_users cu
  join doctors d on d.id = cu.doctor_id
  where cu.role = 'doctor'
    and cu.is_active
    and d.status = 'active';

comment on view public_listing_doctors is
  'The doctors a patient sees under a clinic listing. Name, qualification and '
  'speciality only — not registration numbers, not contact details, and not '
  'non-clinical staff. Exists because a policy on clinic_users would expose '
  'whole rows, and most of a staff row is nobody''s business.';

grant select on public_listing_doctors to anon, authenticated;

create index if not exists clinic_users_doctor_role_idx
  on clinic_users (doctor_id, role) where is_active;
