-- ============================================================================
-- Sehatsandhi — managers: a second, narrower kind of admin login
--
-- Run AFTER 0144. Safe to re-run.
--
-- Decided 28 Sep 2026:
--
--   • admin_users.role gains 'manager'. A manager works the business side:
--     approves and rejects registrations, disables a business (emailed code),
--     approves camps and offers, works leads, reads reports, and can SEE the
--     billing plans. A manager cannot touch coupons, pricing, GST or invoices,
--     insights, wallet money, the WhatsApp settings, or the team.
--   • Admins add and deactivate managers from the panel (admin-team function).
--   • Everything a manager changes is recorded in staff_activity, so admin can
--     see who approved what.
--
-- ── WHY sehat_is_admin() GETS NARROWER RATHER THAN WIDER ────────────────────
-- sehat_is_admin() is read by ~60 policies and ~45 functions, and through the
-- ownership helpers (sehat_caller_owns_business and friends) it opens every
-- clinic's patients, prescriptions and bills. Letting managers pass it would
-- hand them all of that. So it now means a full admin only, and managers get
-- sehat_is_staff() / sehat_is_manager(), granted table by table below. A
-- manager's reach is exactly what this file lists and nothing more.
--
-- ── ALSO FIXED: businesses could not submit a camp or offer ─────────────────
-- camps_offers had no INSERT policy in production or sandbox — the one from
-- 0023 was lost in the doctors → businesses rename — so the business
-- dashboard's insert was refused, silently. It is back, and a business can now
-- only insert its own camp as 'pending_approval': it cannot approve itself.
-- ============================================================================

-- ── admin_users: role, name, phone ──────────────────────────────────────────
alter table admin_users add column if not exists full_name text;
alter table admin_users add column if not exists phone text;          -- 91XXXXXXXXXX
alter table admin_users add column if not exists deactivated_at timestamptz;

do $$ begin
  alter table admin_users drop constraint if exists admin_users_role_check;
  alter table admin_users add constraint admin_users_role_check
    check (role in ('admin', 'owner', 'manager'));
end $$;

do $$ begin
  alter table admin_users add constraint admin_users_phone_format
    check (phone is null or phone ~ '^91[6-9][0-9]{9}$');
exception when duplicate_object then null; end $$;

create unique index if not exists admin_users_phone_uniq on admin_users (phone) where phone is not null;
create unique index if not exists admin_users_email_uniq on admin_users (lower(email)) where email is not null;

-- ── Who is asking ───────────────────────────────────────────────────────────
-- All three refuse a caller whose password has expired (0081), like before.

-- A full admin: 'admin' or 'owner'. Unchanged for them; false for managers.
create or replace function sehat_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not sehat_caller_password_expired()
     and exists (
       select 1 from admin_users
        where auth_uid = auth.uid() and is_active and role in ('admin', 'owner')
     );
$$;

create or replace function sehat_is_manager()
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select not sehat_caller_password_expired()
     and exists (
       select 1 from admin_users
        where auth_uid = auth.uid() and is_active and role = 'manager'
     );
$$;

-- Admin or manager: the screens both of them use.
create or replace function sehat_is_staff()
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select not sehat_caller_password_expired()
     and exists (select 1 from admin_users where auth_uid = auth.uid() and is_active);
$$;

grant execute on function sehat_is_manager() to authenticated;
grant execute on function sehat_is_staff() to authenticated;

-- Everyone may read their own admin_users row. The login screen and App.tsx
-- read it to learn the role; before this only a full admin could, which would
-- have bounced every manager straight back to the login.
drop policy if exists "staff_read_own_admin_row" on admin_users;
create policy "staff_read_own_admin_row" on admin_users
  for select using (auth_uid = auth.uid());

-- ── What a manager did ──────────────────────────────────────────────────────
create table if not exists staff_activity (
  id uuid primary key default gen_random_uuid(),
  actor_uid uuid,
  actor_email text,
  actor_role text,
  action text not null,           -- business_approved, camp_rejected, lead_stage, manager_added …
  entity_type text not null,      -- business, practitioner, camp, lead, admin_user
  entity_id uuid,
  entity_name text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_activity_created_idx on staff_activity (created_at desc);
create index if not exists staff_activity_actor_idx on staff_activity (actor_uid, created_at desc);
create index if not exists staff_activity_entity_idx on staff_activity (entity_type, entity_id, created_at desc);

alter table staff_activity enable row level security;
revoke all on staff_activity from anon, authenticated;
grant select on staff_activity to authenticated;
-- Admin reads everyone's; a manager reads their own. Nobody writes from the
-- browser: rows come from the triggers below and from edge functions.
drop policy if exists "staff_read_activity" on staff_activity;
create policy "staff_read_activity" on staff_activity
  for select using (sehat_is_admin() or (actor_uid = auth.uid() and sehat_is_staff()));

create or replace function sehat_log_staff_action(
  p_action text, p_entity_type text, p_entity_id uuid, p_entity_name text, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql volatile security definer set search_path = public as $$
declare a admin_users%rowtype;
begin
  select * into a from admin_users where auth_uid = auth.uid();
  insert into staff_activity (actor_uid, actor_email, actor_role, action, entity_type, entity_id, entity_name, detail)
  values (auth.uid(), a.email, a.role, p_action, p_entity_type, p_entity_id, p_entity_name, coalesce(p_detail, '{}'::jsonb));
end $$;

revoke all on function sehat_log_staff_action(text, text, uuid, text, jsonb) from public, anon, authenticated;

-- ── A manager may change only these columns ─────────────────────────────────
-- RLS decides WHICH rows; this decides WHICH COLUMNS. Column GRANTs cannot do
-- it — they apply to the whole authenticated role, businesses included. The
-- allowed list comes in as trigger arguments. Admins, the service role and
-- businesses editing their own rows pass straight through.
--
-- Named a_… so it fires before the other BEFORE triggers on these tables:
-- it must judge what the manager sent, not what later triggers derive from it.
create or replace function sehat_manager_column_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_allowed text[] := tg_argv || array['updated_at'];
begin
  if not sehat_is_manager() or sehat_is_admin() then return new; end if;
  if (to_jsonb(old) - v_allowed) is distinct from (to_jsonb(new) - v_allowed) then
    raise exception 'A manager can change only: %', array_to_string(tg_argv, ', ')
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists a_manager_column_guard on businesses;
create trigger a_manager_column_guard before update on businesses
  for each row execute function sehat_manager_column_guard('status', 'verification_notes', 'phone_verified_at');

drop trigger if exists a_manager_column_guard on practitioners;
create trigger a_manager_column_guard before update on practitioners
  for each row execute function sehat_manager_column_guard('speciality', 'imr_status', 'imr_checked_at');

drop trigger if exists a_manager_column_guard on camps_offers;
create trigger a_manager_column_guard before update on camps_offers
  for each row execute function sehat_manager_column_guard('status', 'admin_notes', 'reviewed_by', 'reviewed_at');

-- ── What a manager may read and change ──────────────────────────────────────
-- Businesses and their doctors: read all, update through the guard above.
drop policy if exists "staff_read_businesses" on businesses;
create policy "staff_read_businesses" on businesses for select using (sehat_is_staff());
drop policy if exists "manager_updates_businesses" on businesses;
create policy "manager_updates_businesses" on businesses
  for update using (sehat_is_manager()) with check (sehat_is_manager());

drop policy if exists "staff_read_practitioners" on practitioners;
create policy "staff_read_practitioners" on practitioners for select using (sehat_is_staff());
drop policy if exists "manager_updates_practitioners" on practitioners;
create policy "manager_updates_practitioners" on practitioners
  for update using (sehat_is_manager()) with check (sehat_is_manager());

drop policy if exists "staff_read_affiliations" on business_practitioners;
create policy "staff_read_affiliations" on business_practitioners for select using (sehat_is_staff());

drop policy if exists "staff_read_locations" on practice_locations;
create policy "staff_read_locations" on practice_locations for select using (sehat_is_staff());

-- Camps and offers: review.
drop policy if exists "admins_read_camps" on camps_offers;
create policy "admins_read_camps" on camps_offers for select using (sehat_is_staff());
drop policy if exists "admins_update_camps" on camps_offers;
create policy "admins_update_camps" on camps_offers
  for update using (sehat_is_staff()) with check (sehat_is_staff());

-- The lost insert policy, now unable to self-approve.
drop policy if exists "doctors_insert_own_camps" on camps_offers;
drop policy if exists "clinic_inserts_own_camps" on camps_offers;
create policy "clinic_inserts_own_camps" on camps_offers
  for insert with check (sehat_caller_owns_business(business_id) and status = 'pending_approval');

-- Leads: the whole desk. Phase 2 adds assignment and the activity trail.
drop policy if exists "admins_read_doctor_leads" on doctor_leads;
create policy "admins_read_doctor_leads" on doctor_leads for select using (sehat_is_staff());
drop policy if exists "admins_insert_doctor_leads" on doctor_leads;
create policy "admins_insert_doctor_leads" on doctor_leads for insert with check (sehat_is_staff());
drop policy if exists "admins_update_doctor_leads" on doctor_leads;
create policy "admins_update_doctor_leads" on doctor_leads
  for update using (sehat_is_staff()) with check (sehat_is_staff());
drop policy if exists "admins_read_doctor_lead_notes" on doctor_lead_notes;
create policy "admins_read_doctor_lead_notes" on doctor_lead_notes for select using (sehat_is_staff());
drop policy if exists "admins_insert_doctor_lead_notes" on doctor_lead_notes;
create policy "admins_insert_doctor_lead_notes" on doctor_lead_notes for insert with check (sehat_is_staff());

-- The business search and the two reports: admin or manager. Rewritten from
-- whatever definition this database has, so production and sandbox — whose
-- bodies may differ — each keep their own and change only the check.
do $$
declare f record; def text;
begin
  for f in select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('sehat_admin_find_businesses', 'sehat_platform_report', 'sehat_demand_report')
  loop
    def := pg_get_functiondef(f.oid);
    if position('sehat_is_admin()' in def) > 0 then
      execute replace(def, 'sehat_is_admin()', 'sehat_is_staff()');
    end if;
  end loop;
end $$;

-- ── Recording who did what ──────────────────────────────────────────────────
-- AFTER triggers, so a refused change records nothing. Only staff are logged:
-- a business editing itself is not a review.
create or replace function sehat_log_business_review()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_is_staff() then return null; end if;
  if old.status is distinct from new.status then
    perform sehat_log_staff_action(
      case
        when old.status = 'pending' and new.status = 'active' then 'business_approved'
        when old.status = 'pending' and new.status = 'suspended' then 'business_rejected'
        when old.status = 'suspended' and new.status = 'active' then 'business_reactivated'
        when new.status = 'suspended' then 'business_disabled'
        else 'business_status'
      end,
      'business', new.id, new.name,
      jsonb_build_object('from', old.status, 'to', new.status,
                         'note', split_part(coalesce(new.verification_notes, ''), E'\n', 1)));
  end if;
  if old.phone_verified_at is null and new.phone_verified_at is not null then
    perform sehat_log_staff_action('phone_verified', 'business', new.id, new.name, jsonb_build_object('phone', new.phone));
  end if;
  return null;
end $$;

drop trigger if exists staff_activity_business on businesses;
create trigger staff_activity_business after update on businesses
  for each row execute function sehat_log_business_review();

create or replace function sehat_log_camp_review()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_is_staff() or old.status is not distinct from new.status then return null; end if;
  perform sehat_log_staff_action(
    case new.status when 'approved' then 'camp_approved' when 'rejected' then 'camp_rejected' else 'camp_status' end,
    'camp', new.id, new.title,
    jsonb_build_object('from', old.status, 'to', new.status, 'business_id', new.business_id, 'note', new.admin_notes));
  return null;
end $$;

drop trigger if exists staff_activity_camp on camps_offers;
create trigger staff_activity_camp after update on camps_offers
  for each row execute function sehat_log_camp_review();

create or replace function sehat_log_practitioner_review()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_is_staff() then return null; end if;
  if old.imr_status is distinct from new.imr_status then
    perform sehat_log_staff_action('imr_' || coalesce(new.imr_status, 'unchecked'), 'practitioner', new.id, new.full_name,
      jsonb_build_object('reg_number', new.reg_number));
  end if;
  if old.speciality is distinct from new.speciality then
    perform sehat_log_staff_action('speciality_changed', 'practitioner', new.id, new.full_name,
      jsonb_build_object('from', old.speciality, 'to', new.speciality));
  end if;
  return null;
end $$;

drop trigger if exists staff_activity_practitioner on practitioners;
create trigger staff_activity_practitioner after update on practitioners
  for each row execute function sehat_log_practitioner_review();

create or replace function sehat_log_lead_work()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not sehat_is_staff() then return null; end if;
  if tg_op = 'INSERT' then
    perform sehat_log_staff_action('lead_created', 'lead', new.id, new.name, jsonb_build_object('stage', new.stage));
  elsif old.stage is distinct from new.stage or old.next_followup is distinct from new.next_followup then
    perform sehat_log_staff_action('lead_updated', 'lead', new.id, new.name,
      jsonb_build_object('stage_from', old.stage, 'stage_to', new.stage,
                         'followup_from', old.next_followup, 'followup_to', new.next_followup));
  end if;
  return null;
end $$;

drop trigger if exists staff_activity_lead on doctor_leads;
create trigger staff_activity_lead after insert or update on doctor_leads
  for each row execute function sehat_log_lead_work();

notify pgrst, 'reload schema';
