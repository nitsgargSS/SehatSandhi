-- ============================================================================
-- Sehatsandhi — a hospital is many doctors, and is billed like one
--
-- Run AFTER 0015. Safe to re-run.
--
-- WHAT WAS WRONG
-- The signup wizard treated Hospital as one ordinary listing: a single doctors
-- row with speciality = 'HOSPITAL'. A hospital with forty consultants therefore
-- registered as one nameless entry, none of its doctors were findable, and it
-- paid exactly what a single GP pays.
--
-- The baseline already had organizations, org_subscriptions,
-- doctors.organization_id and doctors.is_hospital_doctor. Nothing in the app
-- ever wrote to any of them. This connects that structure to the wizard rather
-- than inventing a parallel one.
--
-- THE SHAPE
-- One organizations row is the hospital. Its own listing (the row patients find
-- when searching for the hospital) points at it, and so does every consultant.
-- Consultants are ordinary doctors rows, which means they get profiles, search
-- results, appointments, practice locations and hourly windows with no extra
-- work — all of which already exist.
--
-- BILLING: BASE PLUS PER EXTRA DOCTOR
-- The pincode price covers the hospital and a few consultants; beyond that each
-- one adds a monthly amount. A two-doctor nursing home pays close to what it
-- pays today and a forty-doctor hospital pays properly, without a cliff at any
-- particular headcount.
-- ============================================================================

-- ── Plans learn about doctor count ─────────────────────────────────────────

alter table pricing_plans
  add column if not exists included_doctors integer not null default 1;
alter table pricing_plans
  add column if not exists extra_doctor_price integer not null default 0;

do $$ begin
  alter table pricing_plans add constraint pricing_plans_doctor_pricing_sane
    check (included_doctors >= 1 and extra_doctor_price >= 0) not valid;
exception when duplicate_object then null; end $$;

comment on column pricing_plans.included_doctors is
  'Consultants covered by the base price. Beyond this each one costs '
  'extra_doctor_price per month. Only consulted for listings that belong to an '
  'organisation — a solo doctor is never charged for being one doctor.';

comment on column pricing_plans.extra_doctor_price is
  '₹ per month for each consultant past included_doctors. Zero disables '
  'headcount pricing entirely, which is the default and what every '
  'non-hospital listing sees.';

-- A sensible starting point for the live plans: three consultants included,
-- ₹300/month each after that. Editable from admin like every other price.
update pricing_plans
   set included_doctors = 3, extra_doctor_price = 300
 where extra_doctor_price = 0 and included_doctors = 1;

-- ── Organisations get the columns the wizard needs ─────────────────────────

alter table organizations add column if not exists pin_codes text[];
alter table organizations add column if not exists updated_at timestamptz default now();

drop trigger if exists organizations_touch on organizations;
create trigger organizations_touch before update on organizations
  for each row execute function sehat_touch_updated_at();

create index if not exists doctors_org_member_idx
  on doctors (organization_id) where is_hospital_doctor;

-- ── How many consultants a listing is billed for ───────────────────────────
-- One place, so the quote, the charge and the admin screen cannot disagree.

create or replace function sehat_org_doctor_count(p_doctor_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select count(*)
      from doctors m
     where m.organization_id = (select organization_id from doctors where id = p_doctor_id)
       and m.organization_id is not null
       and m.is_hospital_doctor
       -- Suspended consultants are not listed, so they are not billed. Pending
       -- ones are: the hospital entered them and is paying to have them live.
       and m.status <> 'suspended'
  ), 0)::integer;
$$;

comment on function sehat_org_doctor_count is
  'Billable consultants for the organisation a listing belongs to. Zero for a '
  'listing with no organisation, which is every solo practice.';

grant execute on function sehat_org_doctor_count(uuid) to anon, authenticated;

-- ── Create a hospital, its listing and its consultants, atomically ─────────
-- SECURITY DEFINER for the same reason as create_listing: a just-created
-- 'pending' row is invisible to its own creator under allow_read_active_doctors,
-- so a plain insert cannot read back the id it needs.

create or replace function sehat_create_hospital(
  p_name        text,
  p_address     text,
  p_pin_codes   text[],
  p_phone       text,
  p_email       text,
  p_reg_number  text default null,
  p_doctors     jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_listing uuid;
  v_doc jsonb;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a hospital needs a name';
  end if;

  insert into organizations (name, type, registration_number, address, phone, email, pin_codes, status)
  values (p_name, 'hospital', p_reg_number, p_address, p_phone, p_email, p_pin_codes, 'pending')
  returning id into v_org;

  -- The hospital's own listing — what a patient finds when searching for the
  -- hospital by name, as opposed to for a speciality.
  insert into doctors (
    name, speciality, qualification, clinic_name, address, pin_codes,
    phone, email, status, organization_id, is_hospital_doctor
  ) values (
    p_name, 'HOSPITAL', 'Hospital', p_name, p_address, p_pin_codes,
    p_phone, p_email, 'pending', v_org, false
  )
  returning id into v_listing;

  -- Each consultant is an ordinary doctors row, so it inherits profiles,
  -- search, appointments and practice locations with no special casing.
  for v_doc in select * from jsonb_array_elements(coalesce(p_doctors, '[]'::jsonb))
  loop
    continue when coalesce(btrim(v_doc ->> 'name'), '') = '';
    insert into doctors (
      name, speciality, qualification, clinic_name, address, pin_codes,
      phone, email, consultation_fee, status, organization_id, is_hospital_doctor
    ) values (
      v_doc ->> 'name',
      coalesce(nullif(v_doc ->> 'speciality', ''), 'GEN'),
      v_doc ->> 'qualification',
      p_name,
      p_address,
      p_pin_codes,
      coalesce(nullif(v_doc ->> 'phone', ''), p_phone),
      nullif(v_doc ->> 'email', ''),
      coalesce((v_doc ->> 'consultation_fee')::integer, 0),
      'pending',
      v_org,
      true
    );
  end loop;

  return v_listing;
end $$;

comment on function sehat_create_hospital is
  'Creates the organisation, its own listing and its consultants in one '
  'transaction, returning the listing id the payment flow charges against. '
  'Status is forced to pending server-side so a caller cannot self-activate.';

grant execute on function sehat_create_hospital(text, text, text[], text, text, text, jsonb)
  to anon, authenticated;

-- ── Roster, for the hospital page and the admin screen ─────────────────────

create or replace view organisation_roster
with (security_invoker = on) as
select
  d.organization_id,
  o.name        as organisation_name,
  d.id          as doctor_id,
  d.name        as doctor_name,
  d.speciality,
  d.qualification,
  d.status,
  d.consultation_fee
from doctors d
join organizations o on o.id = d.organization_id
where d.is_hospital_doctor;

comment on view organisation_roster is
  'Consultants by hospital. security_invoker so a patient sees only the active '
  'ones their own policies allow, while an admin sees the pending queue too.';

-- ── RLS on organizations ───────────────────────────────────────────────────

alter table organizations enable row level security;

drop policy if exists "read_active_organizations" on organizations;
create policy "read_active_organizations" on organizations
  for select using (status = 'active');

drop policy if exists "admins_manage_organizations" on organizations;
create policy "admins_manage_organizations" on organizations
  for all using (sehat_is_admin()) with check (sehat_is_admin());
