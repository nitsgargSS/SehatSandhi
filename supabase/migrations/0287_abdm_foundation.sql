-- ============================================================================
-- 0287 — ABDM, the groundwork: health IDs, and where sharing will be recorded
-- ============================================================================
-- Decided 29 Oct 2026. Doctors ask for "ABDM compatible" software; the sandbox
-- registration went in the same day (M1 ABHA, M2 HIP, M3 HIU, M4 HPR/HFR).
-- This is everything that does not need ABDM's credentials, so that when they
-- come only the gateway is left to connect.
--
--   businesses.abdm_enabled      off until an admin switches a clinic on — the
--                                screens stay hidden for everyone else. Only an
--                                admin (or a script) changes it.
--   businesses.hfr_id            the clinic's Health Facility Registry ID.
--   practitioners.hpr_id         the doctor's Healthcare Professionals Registry ID.
--   patient_members.abha_*       the ABHA number and address (0047 made room)
--                                are now checked, one person per ABHA number,
--                                and abha_verified_at says whether ABDM itself
--                                confirmed them (an OTP, a scan) or staff typed
--                                them in. Typed in is never "verified".
--   sehat_set_abha               any staff member links or unlinks an ABHA,
--                                logged like every other detail (0193).
--   sehat_set_hfr_id / _hpr_id   the owner or a manager; a doctor their own.
--   abdm_care_contexts           each visit, stay or report linked to an ABHA.
--   abdm_consents                consents received (as HIP) and asked for (as HIU).
--   abdm_share_log               every record sent or received, for the audit
--                                ABDM's data policy asks of a provider.
--
-- The three tables are written by the gateway function with the service key;
-- the clinic's doctors read them. Nobody writes them from the browser.
-- ============================================================================

-- ── The switch, and the registry IDs ────────────────────────────────────────
alter table businesses add column if not exists abdm_enabled boolean not null default false;
alter table businesses add column if not exists hfr_id text;
alter table practitioners add column if not exists hpr_id text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_hfr_id_shape') then
    -- HFR IDs read like IN2710000123: IN, then digits and capitals.
    alter table businesses add constraint businesses_hfr_id_shape
      check (hfr_id is null or hfr_id ~ '^IN[0-9A-Z]{6,16}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practitioners_hpr_id_shape') then
    -- An HPR ID is 14 digits (71-1234-5678-9012) or an HPR address (name@hpr.abdm).
    alter table practitioners add constraint practitioners_hpr_id_shape
      check (hpr_id is null or hpr_id ~ '^[0-9]{2}-[0-9]{4}-[0-9]{4}-[0-9]{4}$' or hpr_id ~ '^[a-z0-9._-]{3,64}@hpr(\.abdm)?$');
  end if;
end $$;

-- Only an admin or a script turns ABDM on for a clinic: the owner can update
-- their own listing (RLS), so the column is held as it was for anyone else.
create or replace function sehat_abdm_switch_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if sehat_is_admin() or coalesce(auth.role(), '') = 'service_role' or auth.uid() is null then
    return new;
  end if;
  new.abdm_enabled := old.abdm_enabled;
  return new;
end $$;

drop trigger if exists businesses_abdm_switch_guard on businesses;
create trigger businesses_abdm_switch_guard before update of abdm_enabled on businesses
  for each row execute function sehat_abdm_switch_guard();


-- ── The patient's ABHA ──────────────────────────────────────────────────────
alter table patient_members add column if not exists abha_verified_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patient_members_abha_number_shape') then
    -- Stored the way ABDM writes it: 91-1234-5678-9012.
    alter table patient_members add constraint patient_members_abha_number_shape
      check (abha_number is null or abha_number ~ '^[0-9]{2}-[0-9]{4}-[0-9]{4}-[0-9]{4}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_members_abha_address_shape') then
    -- name@abdm in production, name@sbx in ABDM's sandbox.
    alter table patient_members add constraint patient_members_abha_address_shape
      check (abha_address is null or abha_address ~ '^[a-z0-9][a-z0-9._]{2,31}@(abdm|sbx)$');
  end if;
end $$;

-- One person, one ABHA: the same number on two records means a duplicate
-- patient (merge them, 0258) or a typing mistake.
create unique index if not exists patient_members_one_abha_number
  on patient_members (abha_number) where abha_number is not null and status = 'active';
create unique index if not exists patient_members_one_abha_address
  on patient_members (abha_address) where abha_address is not null and status = 'active';

-- Link, change or remove a patient's ABHA by hand. A typed number is not
-- verified; the gateway sets abha_verified_at when ABDM confirms one.
create or replace function sehat_set_abha(p_business uuid, p_member uuid, p_number text, p_address text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m patient_members;
  v_digits text := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g');
  v_number text;
  v_address text := nullif(lower(btrim(coalesce(p_address, ''))), '');
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  if not exists (select 1 from business_patients where business_id = p_business and patient_member_id = p_member) then
    raise exception 'That patient is not registered here.' using errcode = 'P0002';
  end if;

  if v_digits <> '' then
    if length(v_digits) <> 14 then
      raise exception 'An ABHA number has 14 digits.' using errcode = '22023';
    end if;
    v_number := substr(v_digits, 1, 2) || '-' || substr(v_digits, 3, 4) || '-' || substr(v_digits, 7, 4) || '-' || substr(v_digits, 11, 4);
  end if;
  -- An address typed without its ending gets the production one.
  if v_address is not null and position('@' in v_address) = 0 then v_address := v_address || '@abdm'; end if;
  if v_address is not null and v_address !~ '^[a-z0-9][a-z0-9._]{2,31}@(abdm|sbx)$' then
    raise exception 'An ABHA address looks like name@abdm.' using errcode = '22023';
  end if;

  select * into m from patient_members where id = p_member for update;
  if m.abha_number is not distinct from v_number and m.abha_address is not distinct from v_address then
    return jsonb_build_object('changed', 0);
  end if;

  if v_number is not null and exists (select 1 from patient_members where abha_number = v_number and status = 'active' and id <> p_member) then
    raise exception 'This ABHA number is already on another patient''s record. Check the number, or merge the two records.' using errcode = '23505';
  end if;
  if v_address is not null and exists (select 1 from patient_members where abha_address = v_address and status = 'active' and id <> p_member) then
    raise exception 'This ABHA address is already on another patient''s record. Check it, or merge the two records.' using errcode = '23505';
  end if;

  update patient_members
     set abha_number = v_number, abha_address = v_address,
         -- Typed by staff: whatever ABDM had confirmed no longer applies.
         abha_verified_at = null, updated_at = now()
   where id = p_member;

  if m.abha_number is distinct from v_number then
    insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
    values (p_business, p_member, 'ABHA number', m.abha_number, v_number, auth.uid(), sehat_mo_actor_name(p_business));
  end if;
  if m.abha_address is distinct from v_address then
    insert into patient_detail_changes (business_id, patient_member_id, field, old_value, new_value, changed_by, changed_by_name)
    values (p_business, p_member, 'ABHA address', m.abha_address, v_address, auth.uid(), sehat_mo_actor_name(p_business));
  end if;
  return jsonb_build_object('changed', 1, 'abha_number', v_number, 'abha_address', v_address);
end $$;
revoke all on function sehat_set_abha(uuid, uuid, text, text) from public, anon;
grant execute on function sehat_set_abha(uuid, uuid, text, text) to authenticated;


-- ── Registry IDs ────────────────────────────────────────────────────────────
create or replace function sehat_set_hfr_id(p_business uuid, p_hfr text)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare v text := nullif(upper(regexp_replace(coalesce(p_hfr, ''), '\s', '', 'g')), '');
begin
  if not sehat_caller_is_business(p_business) then
    raise exception 'Only the owner or a manager sets the facility ID.' using errcode = '42501';
  end if;
  if v is not null and v !~ '^IN[0-9A-Z]{6,16}$' then
    raise exception 'An HFR ID starts with IN, like IN2710000123.' using errcode = '22023';
  end if;
  update businesses set hfr_id = v where id = p_business;
  return v;
end $$;
revoke all on function sehat_set_hfr_id(uuid, text) from public, anon;
grant execute on function sehat_set_hfr_id(uuid, text) to authenticated;

-- The owner or a manager for anyone on the team; a doctor for themselves.
create or replace function sehat_set_hpr_id(p_business uuid, p_practitioner uuid, p_hpr text)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v text := nullif(lower(btrim(coalesce(p_hpr, ''))), '');
  v_digits text;
begin
  if not exists (select 1 from business_practitioners where business_id = p_business and practitioner_id = p_practitioner) then
    raise exception 'That doctor is not on this clinic''s team.' using errcode = 'P0002';
  end if;
  if not (sehat_caller_is_business(p_business)
          or exists (select 1 from practitioners where id = p_practitioner and auth_uid = auth.uid())) then
    raise exception 'Only the owner, a manager or the doctor sets the HPR ID.' using errcode = '42501';
  end if;
  if v is not null and position('@' in v) = 0 then
    v_digits := regexp_replace(v, '[^0-9]', '', 'g');
    if length(v_digits) <> 14 then
      raise exception 'An HPR ID has 14 digits, or is an address like name@hpr.abdm.' using errcode = '22023';
    end if;
    v := substr(v_digits, 1, 2) || '-' || substr(v_digits, 3, 4) || '-' || substr(v_digits, 7, 4) || '-' || substr(v_digits, 11, 4);
  elsif v is not null and v !~ '^[a-z0-9._-]{3,64}@hpr(\.abdm)?$' then
    raise exception 'An HPR address looks like name@hpr.abdm.' using errcode = '22023';
  end if;
  update practitioners set hpr_id = v where id = p_practitioner;
  return v;
end $$;
revoke all on function sehat_set_hpr_id(uuid, uuid, text) from public, anon;
grant execute on function sehat_set_hpr_id(uuid, uuid, text) to authenticated;


-- ── Where sharing is recorded ───────────────────────────────────────────────
-- A care context is ABDM's word for one thing a patient's records hang off:
-- an OPD visit, a stay, a lab report. Linked to their ABHA once, it shows in
-- their ABHA app, and its records can be asked for with their consent.
create table if not exists abdm_care_contexts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  kind text not null check (kind in ('opd_visit','admission','prescription','lab_report','discharge_summary','bill')),
  source_id uuid not null,
  -- What the patient sees in their app, e.g. "OPD visit, 29 Oct 2026, Dr Sharma".
  display text not null,
  -- ABDM's health information types this context carries.
  hi_types text[] not null default '{}',
  abha_address text,
  status text not null default 'pending' check (status in ('pending','linked','failed')),
  error text,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, kind, source_id)
);
create index if not exists abdm_care_contexts_member_idx on abdm_care_contexts (patient_member_id, created_at desc);

create table if not exists abdm_consents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- 'hip': a consent to send our records; 'hiu': one we asked for, to receive.
  role text not null check (role in ('hip','hiu')),
  -- ABDM's ids: the request (HIU side) and the artefact once granted.
  request_id text,
  consent_id text,
  patient_member_id uuid references patient_members(id) on delete set null,
  abha_address text not null,
  purpose text,
  hi_types text[] not null default '{}',
  date_from timestamptz,
  date_to timestamptz,
  expires_at timestamptz,
  status text not null default 'requested'
    check (status in ('requested','granted','denied','expired','revoked')),
  requested_by uuid,
  artefact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists abdm_consents_consent_id on abdm_consents (consent_id) where consent_id is not null;
create index if not exists abdm_consents_business_idx on abdm_consents (business_id, created_at desc);

create table if not exists abdm_share_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  direction text not null check (direction in ('sent','received')),
  consent_id text,
  transaction_id text,
  care_context_id uuid references abdm_care_contexts(id) on delete set null,
  hi_type text,
  status text not null check (status in ('ok','failed')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists abdm_share_log_business_idx on abdm_share_log (business_id, created_at desc);

-- Medical records: the clinic's doctors (and owner) read them; no browser writes.
alter table abdm_care_contexts enable row level security;
alter table abdm_consents enable row level security;
alter table abdm_share_log enable row level security;

drop policy if exists abdm_care_contexts_read on abdm_care_contexts;
create policy abdm_care_contexts_read on abdm_care_contexts for select to authenticated
  using (sehat_caller_is_clinical(business_id));
drop policy if exists abdm_consents_read on abdm_consents;
create policy abdm_consents_read on abdm_consents for select to authenticated
  using (sehat_caller_is_clinical(business_id));
drop policy if exists abdm_share_log_read on abdm_share_log;
create policy abdm_share_log_read on abdm_share_log for select to authenticated
  using (sehat_caller_is_clinical(business_id));

revoke insert, update, delete on abdm_care_contexts, abdm_consents, abdm_share_log from anon, authenticated;
grant select on abdm_care_contexts, abdm_consents, abdm_share_log to authenticated;


-- ── The patient's header carries the ABHA address and whether it is verified ─
-- Same as 0267, two columns added at the end.
create or replace view patient_summary as
  select
    m.id as patient_member_id,
    bp.business_id,
    m.full_name, m.relation, m.gender, m.age_years, m.date_of_birth,
    m.blood_group, m.abha_number,
    p.phone, p.lang, p.pin_code, p.area,
    bp.mrn, bp.source, bp.first_seen_at, bp.last_seen_at, bp.visit_count,
    (select count(*) from patient_visits v
      where v.patient_member_id = m.id and v.business_id = bp.business_id) as visits_here,
    (select array_agg(a.substance order by a.severity desc nulls last)
       from patient_allergies a
      where a.patient_member_id = m.id and a.business_id = bp.business_id and a.is_active) as allergies,
    case when sehat_caller_is_clinical(bp.business_id) then
      (select array_agg(c.condition order by c.created_at)
         from patient_conditions c
        where c.patient_member_id = m.id and c.business_id = bp.business_id and c.status = 'active')
    end as conditions,
    case when sehat_caller_is_clinical(bp.business_id) then
      (select max(v.follow_up_due) from patient_visits v
        where v.patient_member_id = m.id and v.business_id = bp.business_id
          and v.follow_up_due >= current_date)
    end as next_follow_up,
    sehat_has_consent(m.id, 'recording', bp.business_id) as recording_consent,
    m.also_known_as,
    -- 0287
    m.abha_address,
    m.abha_verified_at
  from business_patients bp
  join patient_members m on m.id = bp.patient_member_id
  join patients p on p.id = m.patient_id
 where bp.business_id in (select sehat_caller_business_ids());

notify pgrst, 'reload schema';
