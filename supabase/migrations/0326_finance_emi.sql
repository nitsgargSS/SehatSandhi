-- ============================================================================
-- 0326 — Treatment on EMI (Phase 1): lenders, finance cases, hospital payees
-- ============================================================================
-- AFTER 0325. Safe to re-run. Plan: docs/2026-11-finance-emi-phase1.md
--
-- A patient who cannot pay up front gets an EMI loan from a regulated lender
-- (bank / NBFC) and the lender pays the HOSPITAL directly. Sehatsandhi only
-- connects the three parties and tracks the case: it is never the lender, never
-- holds loan money, never decides credit, never collects repayments, and never
-- collects or stores the patient's KYC (that happens in the lender's journey).
--
--   site_settings 'finance_enabled'  'off' until the first real lender signs.
--   businesses.vertical 'lender'     lenders log in like any business.
--   businesses.finance_module        a hospital/clinic opts in (default off).
--   lender_profiles                  RBI details, terms, commission; admin approves.
--   lender_hospital_links            the lender approves a hospital as payee once.
--   finance_cases                    one per request; hospital- or patient-started.
--   finance_case_lenders             the case as shared with each chosen lender.
--   finance_case_events              audit log — every change and every lender view.
--   patient_payments method 'finance' recorded when the HOSPITAL confirms the
--                                    lender's money arrived (lenders never write
--                                    into a hospital's books).
--
-- Decisions (Nitin, 16 Nov 2026): hospitals + clinics only; minimum ₹10,000;
-- free for hospitals (we earn a commission from the lender); the lender collects
-- the hospital's bank details in its own onboarding; lenders that pay the patient
-- instead of the hospital are allowed as a fallback.
--
-- Tables are read-only to clients (RLS select); every write goes through a
-- security-definer function below that checks who is asking.
-- ============================================================================

-- ── Switch ──────────────────────────────────────────────────────────────────
insert into site_settings (key, value) values ('finance_enabled', 'off')
on conflict (key) do nothing;

create or replace function sehat_finance_enabled()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'on' from site_settings where key = 'finance_enabled'), false)
$$;
revoke all on function sehat_finance_enabled() from public;
grant execute on function sehat_finance_enabled() to anon, authenticated, service_role;

-- ── Lenders are businesses; hospitals opt in ────────────────────────────────
alter table businesses drop constraint if exists businesses_vertical_check;
alter table businesses add constraint businesses_vertical_check
  check (vertical in ('clinic','hospital','pharmacy','lab','insurance','ambulance','lender'));

alter table businesses add column if not exists finance_module boolean not null default false;

alter table patient_payments drop constraint if exists patient_payments_method_check;
alter table patient_payments add constraint patient_payments_method_check
  check (method in ('cash','upi','credit_card','debit_card','card','netbanking','cheque','insurance','finance','other'));

-- ── Lender profiles ─────────────────────────────────────────────────────────
create table if not exists lender_profiles (
  business_id        uuid primary key references businesses(id) on delete cascade,
  legal_name         text not null,
  entity_type        text not null check (entity_type in ('bank','nbfc')),
  rbi_reg_no         text,                    -- NBFC certificate of registration / bank licence
  grievance_name     text,
  grievance_email    text,
  grievance_phone    text,
  terms_summary      text,                    -- headline shown to patients, e.g. "0% EMI up to 6 months"
  min_amount         numeric(12,2) not null default 10000 check (min_amount >= 10000),
  max_amount         numeric(12,2) check (max_amount is null or max_amount >= min_amount),
  tenures            text,                    -- e.g. "3, 6, 9, 12 months"
  pays_to            text not null default 'hospital' check (pays_to in ('hospital','patient')),
  journey_url        text,                    -- where the patient continues (KYC, e-sign) — lender's own
  commission_pct     numeric(5,2) check (commission_pct is null or commission_pct between 0 and 10),
  status             text not null default 'pending' check (status in ('pending','approved','suspended')),
  approved_at        timestamptz,
  approved_by        uuid,
  lsp_agreement_on   date,                    -- our sourcing (LSP) agreement with them, signed on
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table lender_profiles is
  'A lender (bank/NBFC) on Sehatsandhi. Patients only ever see approved ones. '
  'commission_pct is what the lender pays Sehatsandhi per disbursed loan — never the patient.';

-- ── Lender ↔ hospital: the lender approves a hospital as a payee once ───────
create table if not exists lender_hospital_links (
  id                 uuid primary key default gen_random_uuid(),
  lender_id          uuid not null references businesses(id) on delete cascade,
  hospital_id        uuid not null references businesses(id) on delete cascade,
  status             text not null default 'requested' check (status in ('requested','approved','rejected')),
  requested_by       uuid not null references businesses(id),
  requested_at       timestamptz not null default now(),
  decided_at         timestamptz,
  decision_note      text,
  no_cost_emi        boolean not null default false,  -- hospital pays the interest (subvention)
  subvention_note    text,
  agreement_done_on  date,                             -- lender's merchant agreement e-signed
  unique (lender_id, hospital_id)
);

-- ── Finance cases ───────────────────────────────────────────────────────────
create sequence if not exists finance_case_no_seq;

create table if not exists finance_cases (
  id                     uuid primary key default gen_random_uuid(),
  case_no                text not null unique default ('EMI-' || lpad(nextval('finance_case_no_seq')::text, 6, '0')),
  business_id            uuid not null references businesses(id) on delete cascade,   -- the hospital/clinic
  patient_member_id      uuid references patient_members(id) on delete set null,
  patient_name           text not null,
  patient_phone          text not null,
  treatment              text not null,
  treatment_category     text,
  estimate_amount        numeric(12,2) not null check (estimate_amount >= 10000),
  requested_amount       numeric(12,2) not null check (requested_amount >= 10000),
  planned_on             date,
  admission_id           uuid references admissions(id) on delete set null,
  planned_surgery_id     uuid references planned_surgeries(id) on delete set null,
  bill_id                uuid references patient_bills(id) on delete set null,
  started_by             text not null check (started_by in ('hospital','patient')),
  status                 text not null default 'requested' check (status in
                           ('requested','hospital_confirmed','shared','offered','sanctioned',
                            'disbursed','closed','declined','withdrawn','expired')),
  hospital_confirmed_at  timestamptz,
  hospital_confirmed_by  text,
  admission_confirmed_at timestamptz,    -- hospital: the patient is admitted / treatment date fixed
  consent_at             timestamptz,
  consent_version        text,
  consent_channel        text check (consent_channel is null or consent_channel in ('web','whatsapp','app')),
  received_at            timestamptz,    -- hospital confirmed the lender's money arrived
  payment_id             uuid references patient_payments(id) on delete set null,
  closed_reason          text,
  public_token           text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists finance_cases_business_idx on finance_cases (business_id, status, created_at desc);
create index if not exists finance_cases_phone_idx on finance_cases (patient_phone);

create table if not exists finance_case_lenders (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references finance_cases(id) on delete cascade,
  lender_id          uuid not null references businesses(id) on delete cascade,
  status             text not null default 'shared' check (status in
                       ('shared','offered','sanctioned','disbursed','declined','withdrawn')),
  shared_at          timestamptz not null default now(),
  lender_ref         text,
  offer_amount       numeric(12,2),
  offer_tenure_months integer,
  offer_emi          numeric(12,2),      -- the lender's own numbers, shown for information only
  decline_reason     text,
  disbursed_amount   numeric(12,2),
  disbursed_on       date,
  utr                text,
  updated_at         timestamptz not null default now(),
  unique (case_id, lender_id)
);
create index if not exists finance_case_lenders_lender_idx on finance_case_lenders (lender_id, status, shared_at desc);

create table if not exists finance_case_events (
  id          bigserial primary key,
  case_id     uuid not null references finance_cases(id) on delete cascade,
  lender_id   uuid references businesses(id) on delete set null,
  actor       text not null check (actor in ('hospital','patient','lender','admin','system')),
  actor_uid   uuid,
  actor_name  text,
  event       text not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists finance_case_events_case_idx on finance_case_events (case_id, created_at);

-- ── Read access (writes only through the functions below) ───────────────────
alter table lender_profiles enable row level security;
alter table lender_hospital_links enable row level security;
alter table finance_cases enable row level security;
alter table finance_case_lenders enable row level security;
alter table finance_case_events enable row level security;

drop policy if exists lender_profiles_read on lender_profiles;
create policy lender_profiles_read on lender_profiles for select to authenticated
  using (status = 'approved' or sehat_is_admin() or sehat_caller_role(business_id) is not null);

drop policy if exists lender_hospital_links_read on lender_hospital_links;
create policy lender_hospital_links_read on lender_hospital_links for select to authenticated
  using (sehat_is_admin() or sehat_caller_role(lender_id) is not null or sehat_caller_role(hospital_id) is not null);

-- Hospital staff see their own cases. Lenders do NOT read this table: they get
-- the minimal columns through sehat_lender_cases().
drop policy if exists finance_cases_read on finance_cases;
create policy finance_cases_read on finance_cases for select to authenticated
  using (sehat_is_admin() or sehat_caller_role(business_id) is not null);

drop policy if exists finance_case_lenders_read on finance_case_lenders;
create policy finance_case_lenders_read on finance_case_lenders for select to authenticated
  using (sehat_is_admin() or sehat_caller_role(lender_id) is not null
         or exists (select 1 from finance_cases c where c.id = case_id and sehat_caller_role(c.business_id) is not null));

drop policy if exists finance_case_events_read on finance_case_events;
create policy finance_case_events_read on finance_case_events for select to authenticated
  using (sehat_is_admin()
         or exists (select 1 from finance_cases c where c.id = case_id and sehat_caller_role(c.business_id) is not null)
         or (lender_id is not null and sehat_caller_role(lender_id) is not null));

revoke all on lender_profiles, lender_hospital_links, finance_cases, finance_case_lenders, finance_case_events from anon;
revoke insert, update, delete on lender_profiles, lender_hospital_links, finance_cases, finance_case_lenders, finance_case_events from authenticated;
grant select on lender_profiles, lender_hospital_links, finance_cases, finance_case_lenders, finance_case_events to authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function sehat_finance_log(p_case uuid, p_lender uuid, p_actor text, p_event text, p_note text default null)
returns void language sql volatile security definer set search_path = public as $$
  insert into finance_case_events (case_id, lender_id, actor, actor_uid, actor_name, event, note)
  values (p_case, p_lender, p_actor, auth.uid(),
          case when p_lender is not null and p_actor = 'lender' then sehat_caller_staff_name(p_lender)
               when p_actor = 'hospital' then sehat_caller_staff_name((select business_id from finance_cases where id = p_case))
               else null end,
          p_event, p_note)
$$;
revoke all on function sehat_finance_log(uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function sehat_finance_check_on()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_finance_enabled() and not sehat_is_admin() then
    raise exception 'Treatment on EMI is not available yet.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function sehat_finance_check_on() from public, anon, authenticated;

-- Can this business offer EMI? (hospital or clinic, active, opted in)
create or replace function sehat_finance_hospital_ok(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses b where b.id = p_business and b.status = 'active'
                   and b.vertical in ('clinic','hospital') and b.finance_module)
$$;
revoke all on function sehat_finance_hospital_ok(uuid) from public, anon;
grant execute on function sehat_finance_hospital_ok(uuid) to authenticated, service_role;

-- Staff of the case's hospital, or admin
create or replace function sehat_finance_hospital_staff(p_case uuid)
returns finance_cases language plpgsql stable security definer set search_path = public as $$
declare c finance_cases;
begin
  select * into c from finance_cases where id = p_case;
  if c.id is null then raise exception 'No such EMI case.' using errcode = 'P0002'; end if;
  if not (sehat_is_admin() or sehat_caller_role(c.business_id) is not null) then
    raise exception 'Only the hospital''s staff can do this.' using errcode = '42501';
  end if;
  return c;
end $$;
revoke all on function sehat_finance_hospital_staff(uuid) from public, anon, authenticated;

-- ── Hospital: opt in ────────────────────────────────────────────────────────
create or replace function sehat_finance_module_set(p_business uuid, p_on boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_is_business(p_business)) then
    raise exception 'Only the owner or a manager can switch EMI on or off.' using errcode = '42501';
  end if;
  if p_on and not exists (select 1 from businesses where id = p_business and vertical in ('clinic','hospital')) then
    raise exception 'EMI is for hospitals and clinics.' using errcode = 'P0001';
  end if;
  update businesses set finance_module = coalesce(p_on, false), updated_at = now() where id = p_business;
end $$;
revoke all on function sehat_finance_module_set(uuid, boolean) from public, anon;
grant execute on function sehat_finance_module_set(uuid, boolean) to authenticated;

-- ── Hospital: start a case ("Offer EMI") — confirmed by the hospital at once ─
create or replace function sehat_finance_case_create(
  p_business uuid, p_member uuid, p_patient_name text, p_patient_phone text,
  p_treatment text, p_category text, p_estimate numeric, p_requested numeric,
  p_planned_on date default null, p_admission uuid default null,
  p_surgery uuid default null, p_bill uuid default null)
returns finance_cases language plpgsql volatile security definer set search_path = public as $$
declare c finance_cases; v_name text := btrim(coalesce(p_patient_name, '')); v_phone text := btrim(coalesce(p_patient_phone, ''));
begin
  perform sehat_finance_check_on();
  if not (sehat_is_admin() or sehat_caller_role(p_business) is not null) then
    raise exception 'Only the hospital''s staff can offer EMI.' using errcode = '42501';
  end if;
  if not sehat_finance_hospital_ok(p_business) then
    raise exception 'Switch on EMI for this hospital first.' using errcode = 'P0001';
  end if;
  if p_member is not null then
    select coalesce(nullif(v_name, ''), m.full_name), coalesce(nullif(v_phone, ''), p.phone)
      into v_name, v_phone
      from patient_members m join patients p on p.id = m.patient_id where m.id = p_member;
  end if;
  if v_name = '' or v_phone = '' then raise exception 'Patient name and phone are needed.' using errcode = '22023'; end if;
  if btrim(coalesce(p_treatment, '')) = '' then raise exception 'Say what the treatment is.' using errcode = '22023'; end if;
  if coalesce(p_estimate, 0) < 10000 or coalesce(p_requested, 0) < 10000 then
    raise exception 'EMI is for treatments of ₹10,000 or more.' using errcode = '22023';
  end if;
  if p_requested > p_estimate then raise exception 'The loan can''t be more than the estimate.' using errcode = '22023'; end if;

  insert into finance_cases (business_id, patient_member_id, patient_name, patient_phone, treatment, treatment_category,
                             estimate_amount, requested_amount, planned_on, admission_id, planned_surgery_id, bill_id,
                             started_by, status, hospital_confirmed_at, hospital_confirmed_by)
  values (p_business, p_member, v_name, v_phone, btrim(p_treatment), nullif(btrim(coalesce(p_category, '')), ''),
          p_estimate, p_requested, p_planned_on, p_admission, p_surgery, p_bill,
          'hospital', 'hospital_confirmed', now(), sehat_caller_staff_name(p_business))
  returning * into c;
  perform sehat_finance_log(c.id, null, 'hospital', 'created', format('Estimate ₹%s, loan ₹%s', c.estimate_amount, c.requested_amount));
  return c;
end $$;
revoke all on function sehat_finance_case_create(uuid, uuid, text, text, text, text, numeric, numeric, date, uuid, uuid, uuid) from public, anon;
grant execute on function sehat_finance_case_create(uuid, uuid, text, text, text, text, numeric, numeric, date, uuid, uuid, uuid) to authenticated;

-- ── Patient: request EMI for a treatment at a hospital (app / WhatsApp bot) ─
-- Callable by a signed-in patient (their own phone) or by the bot (service_role).
create or replace function sehat_finance_case_request(
  p_business uuid, p_patient_name text, p_patient_phone text, p_treatment text,
  p_amount numeric, p_planned_on date default null, p_channel text default 'app')
returns finance_cases language plpgsql volatile security definer set search_path = public as $$
declare c finance_cases; v_phone text := btrim(coalesce(p_patient_phone, ''));
begin
  perform sehat_finance_check_on();
  if auth.role() <> 'service_role' and not sehat_is_admin() then
    v_phone := coalesce(sehat_my_phone(), '');
    if v_phone = '' then raise exception 'Sign in to ask for EMI.' using errcode = '42501'; end if;
  end if;
  if not sehat_finance_hospital_ok(p_business) then
    raise exception 'This hospital doesn''t offer EMI through Sehatsandhi yet.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_patient_name, '')) = '' or v_phone = '' or btrim(coalesce(p_treatment, '')) = '' then
    raise exception 'Name, phone and treatment are needed.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) < 10000 then raise exception 'EMI is for treatments of ₹10,000 or more.' using errcode = '22023'; end if;

  insert into finance_cases (business_id, patient_name, patient_phone, treatment, estimate_amount, requested_amount,
                             planned_on, started_by, status, consent_channel)
  values (p_business, btrim(p_patient_name), v_phone, btrim(p_treatment), p_amount, p_amount,
          p_planned_on, 'patient', 'requested', case when p_channel in ('web','whatsapp','app') then p_channel end)
  returning * into c;
  perform sehat_finance_log(c.id, null, 'patient', 'requested', format('₹%s for %s', c.requested_amount, c.treatment));
  return c;
end $$;
revoke all on function sehat_finance_case_request(uuid, text, text, text, numeric, date, text) from public, anon;
grant execute on function sehat_finance_case_request(uuid, text, text, text, numeric, date, text) to authenticated, service_role;

-- ── Hospital: confirm (or correct) a patient-started request ────────────────
create or replace function sehat_finance_case_confirm(p_case uuid, p_treatment text, p_estimate numeric,
                                                      p_requested numeric, p_planned_on date default null,
                                                      p_member uuid default null)
returns finance_cases language plpgsql volatile security definer set search_path = public as $$
declare c finance_cases;
begin
  perform sehat_finance_check_on();
  c := sehat_finance_hospital_staff(p_case);
  if c.status not in ('requested','hospital_confirmed') then
    raise exception 'This case has already gone to the lender.' using errcode = 'P0001';
  end if;
  if coalesce(p_estimate, 0) < 10000 or coalesce(p_requested, 0) < 10000 or p_requested > p_estimate then
    raise exception 'Loan must be ₹10,000 or more and not more than the estimate.' using errcode = '22023';
  end if;
  update finance_cases set treatment = coalesce(nullif(btrim(coalesce(p_treatment, '')), ''), treatment),
         estimate_amount = p_estimate, requested_amount = p_requested,
         planned_on = coalesce(p_planned_on, planned_on), patient_member_id = coalesce(p_member, patient_member_id),
         status = 'hospital_confirmed', hospital_confirmed_at = now(),
         hospital_confirmed_by = sehat_caller_staff_name(c.business_id), updated_at = now()
   where id = p_case returning * into c;
  perform sehat_finance_log(c.id, null, 'hospital', 'confirmed', format('Estimate ₹%s, loan ₹%s', c.estimate_amount, c.requested_amount));
  return c;
end $$;
revoke all on function sehat_finance_case_confirm(uuid, text, numeric, numeric, date, uuid) from public, anon;
grant execute on function sehat_finance_case_confirm(uuid, text, numeric, numeric, date, uuid) to authenticated;

-- ── Patient (no login, by link): see the case and the lenders on offer ──────
create or replace function sehat_finance_case_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c finance_cases; v jsonb;
begin
  select * into c from finance_cases where public_token = p_token;
  if c.id is null then return null; end if;
  select jsonb_build_object(
    'case_no', c.case_no, 'status', c.status, 'treatment', c.treatment,
    'estimate', c.estimate_amount, 'requested', c.requested_amount, 'planned_on', c.planned_on,
    'patient_name', c.patient_name, 'hospital', b.name, 'hospital_address', b.address,
    'hospital_confirmed', c.hospital_confirmed_at is not null, 'consent_at', c.consent_at,
    'received', c.received_at is not null,
    'lenders_shared', coalesce((select jsonb_agg(jsonb_build_object(
          'lender_id', l.lender_id, 'name', lp.legal_name, 'status', l.status,
          'journey_url', lp.journey_url, 'grievance_email', lp.grievance_email, 'grievance_phone', lp.grievance_phone,
          'offer_amount', l.offer_amount, 'offer_tenure_months', l.offer_tenure_months, 'offer_emi', l.offer_emi)
          order by l.shared_at)
        from finance_case_lenders l join lender_profiles lp on lp.business_id = l.lender_id where l.case_id = c.id), '[]'::jsonb),
    'lenders_available', case when c.status = 'hospital_confirmed' then coalesce((select jsonb_agg(jsonb_build_object(
          'lender_id', lp.business_id, 'name', lp.legal_name, 'entity_type', lp.entity_type,
          'terms', lp.terms_summary, 'tenures', lp.tenures, 'pays_to', lp.pays_to,
          'no_cost_emi', coalesce(k.no_cost_emi, false))
          order by (lp.pays_to = 'hospital') desc, (k.status = 'approved') desc nulls last, lp.legal_name)
        from lender_profiles lp
        join businesses lb on lb.id = lp.business_id and lb.status = 'active'
        left join lender_hospital_links k on k.lender_id = lp.business_id and k.hospital_id = c.business_id
        where lp.status = 'approved' and coalesce(k.status, 'requested') <> 'rejected'
          and c.requested_amount >= lp.min_amount and (lp.max_amount is null or c.requested_amount <= lp.max_amount)), '[]'::jsonb)
      else '[]'::jsonb end)
  into v from businesses b where b.id = c.business_id;
  return v;
end $$;
revoke all on function sehat_finance_case_by_token(text) from public;
grant execute on function sehat_finance_case_by_token(text) to anon, authenticated;

-- ── Patient (by link): consent and share with up to 2 lenders ───────────────
create or replace function sehat_finance_case_share(p_token text, p_lenders uuid[], p_consent_version text,
                                                    p_channel text default 'web')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c finance_cases; v_l uuid; n int := 0;
begin
  perform sehat_finance_check_on();
  select * into c from finance_cases where public_token = p_token for update;
  if c.id is null then raise exception 'This link is not valid.' using errcode = 'P0002'; end if;
  if c.status <> 'hospital_confirmed' then
    raise exception 'This request can''t be sent to a lender right now.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_lenders, 1), 0) not between 1 and 2 then
    raise exception 'Choose one or two lenders.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_consent_version, '')) = '' then raise exception 'Consent is needed.' using errcode = '22023'; end if;
  foreach v_l in array p_lenders loop
    if not exists (select 1 from lender_profiles lp join businesses lb on lb.id = lp.business_id
                    where lp.business_id = v_l and lp.status = 'approved' and lb.status = 'active'
                      and c.requested_amount >= lp.min_amount and (lp.max_amount is null or c.requested_amount <= lp.max_amount))
       or exists (select 1 from lender_hospital_links k where k.lender_id = v_l and k.hospital_id = c.business_id and k.status = 'rejected') then
      raise exception 'One of the chosen lenders is not available for this request.' using errcode = 'P0001';
    end if;
    insert into finance_case_lenders (case_id, lender_id) values (c.id, v_l) on conflict (case_id, lender_id) do nothing;
    -- First case at this hospital for this lender: ask the lender to approve the hospital as a payee.
    insert into lender_hospital_links (lender_id, hospital_id, requested_by) values (v_l, c.business_id, c.business_id)
      on conflict (lender_id, hospital_id) do nothing;
    perform sehat_finance_log(c.id, v_l, 'patient', 'shared_with_lender', null);
    n := n + 1;
  end loop;
  update finance_cases set status = 'shared', consent_at = now(), consent_version = btrim(p_consent_version),
         consent_channel = case when p_channel in ('web','whatsapp','app') then p_channel else 'web' end, updated_at = now()
   where id = c.id;
  return jsonb_build_object('shared', n);
end $$;
revoke all on function sehat_finance_case_share(text, uuid[], text, text) from public;
grant execute on function sehat_finance_case_share(text, uuid[], text, text) to anon, authenticated;

-- ── Patient or hospital: withdraw before the loan is sanctioned ─────────────
create or replace function sehat_finance_case_withdraw(p_case uuid, p_token text, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c finance_cases; v_actor text;
begin
  if p_token is not null then
    select * into c from finance_cases where public_token = p_token and (p_case is null or id = p_case);
    v_actor := 'patient';
  else
    c := sehat_finance_hospital_staff(p_case);
    v_actor := 'hospital';
  end if;
  if c.id is null then raise exception 'No such EMI case.' using errcode = 'P0002'; end if;
  if c.status in ('sanctioned','disbursed','closed','withdrawn','declined','expired') then
    raise exception 'This case can''t be withdrawn now.' using errcode = 'P0001';
  end if;
  update finance_cases set status = 'withdrawn', closed_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now() where id = c.id;
  update finance_case_lenders set status = 'withdrawn', updated_at = now() where case_id = c.id and status in ('shared','offered');
  perform sehat_finance_log(c.id, null, v_actor, 'withdrawn', p_reason);
end $$;
revoke all on function sehat_finance_case_withdraw(uuid, text, text) from public;
grant execute on function sehat_finance_case_withdraw(uuid, text, text) to anon, authenticated;

-- ── Hospital: patient admitted / treatment date fixed (needed before payout) ─
create or replace function sehat_finance_case_admission_confirm(p_case uuid, p_planned_on date default null, p_admission uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare c finance_cases;
begin
  c := sehat_finance_hospital_staff(p_case);
  if c.status not in ('shared','offered','sanctioned') then
    raise exception 'Confirm admission once a lender has the case.' using errcode = 'P0001';
  end if;
  update finance_cases set admission_confirmed_at = now(), planned_on = coalesce(p_planned_on, planned_on),
         admission_id = coalesce(p_admission, admission_id), updated_at = now() where id = c.id;
  perform sehat_finance_log(c.id, null, 'hospital', 'admission_confirmed', coalesce(p_planned_on, c.planned_on)::text);
end $$;
revoke all on function sehat_finance_case_admission_confirm(uuid, date, uuid) from public, anon;
grant execute on function sehat_finance_case_admission_confirm(uuid, date, uuid) to authenticated;

-- ── Hospital: the lender's money arrived → a 'finance' payment on the bill ──
create or replace function sehat_finance_case_received(p_case uuid, p_amount numeric, p_received_on date default current_date)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare c finance_cases; l finance_case_lenders; v_pay uuid;
begin
  c := sehat_finance_hospital_staff(p_case);
  if c.status <> 'disbursed' then raise exception 'The lender hasn''t marked this loan as paid yet.' using errcode = 'P0001'; end if;
  if c.received_at is not null then raise exception 'Already recorded.' using errcode = 'P0001'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount received.' using errcode = '22023'; end if;
  select * into l from finance_case_lenders where case_id = c.id and status = 'disbursed' limit 1;
  if c.patient_member_id is not null then
    insert into patient_payments (business_id, patient_member_id, admission_id, bill_id, amount, method, reference, received_on, notes)
    values (c.business_id, c.patient_member_id, c.admission_id, c.bill_id, p_amount, 'finance',
            coalesce(l.utr, l.lender_ref), coalesce(p_received_on, current_date),
            format('EMI %s — %s, ref %s', c.case_no, (select legal_name from lender_profiles where business_id = l.lender_id), coalesce(l.lender_ref, '-')))
    returning id into v_pay;
  end if;
  update finance_cases set received_at = now(), payment_id = v_pay, status = 'closed', closed_reason = 'paid', updated_at = now() where id = c.id;
  perform sehat_finance_log(c.id, l.lender_id, 'hospital', 'money_received', format('₹%s', p_amount));
  return v_pay;
end $$;
revoke all on function sehat_finance_case_received(uuid, numeric, date) from public, anon;
grant execute on function sehat_finance_case_received(uuid, numeric, date) to authenticated;

-- ── Lender: own profile ─────────────────────────────────────────────────────
create or replace function sehat_lender_profile_save(p_lender uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_is_business(p_lender)) then
    raise exception 'Only the lender''s owner or manager can edit this.' using errcode = '42501';
  end if;
  if not exists (select 1 from businesses where id = p_lender and vertical = 'lender') then
    raise exception 'Not a lender account.' using errcode = 'P0001';
  end if;
  insert into lender_profiles (business_id, legal_name, entity_type, rbi_reg_no, grievance_name, grievance_email, grievance_phone,
                               terms_summary, min_amount, max_amount, tenures, pays_to, journey_url)
  values (p_lender, p->>'legal_name', p->>'entity_type', p->>'rbi_reg_no', p->>'grievance_name', p->>'grievance_email',
          p->>'grievance_phone', p->>'terms_summary', greatest(coalesce((p->>'min_amount')::numeric, 10000), 10000),
          (p->>'max_amount')::numeric, p->>'tenures', coalesce(p->>'pays_to', 'hospital'), p->>'journey_url')
  on conflict (business_id) do update set
    legal_name = excluded.legal_name, entity_type = excluded.entity_type, rbi_reg_no = excluded.rbi_reg_no,
    grievance_name = excluded.grievance_name, grievance_email = excluded.grievance_email, grievance_phone = excluded.grievance_phone,
    terms_summary = excluded.terms_summary, min_amount = excluded.min_amount, max_amount = excluded.max_amount,
    tenures = excluded.tenures, pays_to = excluded.pays_to, journey_url = excluded.journey_url, updated_at = now();
  -- Changing the legal entity or RBI details sends an approved lender back for review.
  update lender_profiles set status = 'pending', approved_at = null, approved_by = null
   where business_id = p_lender and status = 'approved' and not sehat_is_admin()
     and (legal_name is distinct from p->>'legal_name' or rbi_reg_no is distinct from p->>'rbi_reg_no'
          or entity_type is distinct from p->>'entity_type');
end $$;
revoke all on function sehat_lender_profile_save(uuid, jsonb) from public, anon;
grant execute on function sehat_lender_profile_save(uuid, jsonb) to authenticated;

-- ── Lender: inbox — only cases shared with them, minimal columns ────────────
create or replace function sehat_lender_cases(p_lender uuid)
returns table (case_lender_id uuid, case_id uuid, case_no text, lender_status text, case_status text,
               patient_name text, patient_phone text, treatment text, treatment_category text,
               estimate_amount numeric, requested_amount numeric, planned_on date,
               hospital_id uuid, hospital_name text, hospital_address text, hospital_gstin text, hospital_reg_no text,
               hospital_confirmed_at timestamptz, admission_confirmed_at timestamptz, payee_status text,
               shared_at timestamptz, lender_ref text, offer_amount numeric, offer_tenure_months integer, offer_emi numeric,
               disbursed_amount numeric, disbursed_on date, utr text, received boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_role(p_lender) is not null) then
    raise exception 'Not your lender account.' using errcode = '42501';
  end if;
  return query
  select l.id, c.id, c.case_no, l.status, c.status,
         c.patient_name, c.patient_phone, c.treatment, c.treatment_category,
         c.estimate_amount, c.requested_amount, c.planned_on,
         b.id, b.name, b.address, b.gstin, b.reg_number,
         c.hospital_confirmed_at, c.admission_confirmed_at, k.status,
         l.shared_at, l.lender_ref, l.offer_amount, l.offer_tenure_months, l.offer_emi,
         l.disbursed_amount, l.disbursed_on, l.utr, c.received_at is not null
    from finance_case_lenders l
    join finance_cases c on c.id = l.case_id
    join businesses b on b.id = c.business_id
    left join lender_hospital_links k on k.lender_id = l.lender_id and k.hospital_id = c.business_id
   where l.lender_id = p_lender
   order by l.shared_at desc;
end $$;
revoke all on function sehat_lender_cases(uuid) from public, anon;
grant execute on function sehat_lender_cases(uuid) to authenticated;

-- Lender opened a case — logged, so hospitals and admin can see who looked.
create or replace function sehat_lender_case_viewed(p_case_lender uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare l finance_case_lenders;
begin
  select * into l from finance_case_lenders where id = p_case_lender;
  if l.id is null or not (sehat_is_admin() or sehat_caller_role(l.lender_id) is not null) then
    raise exception 'Not your case.' using errcode = '42501';
  end if;
  perform sehat_finance_log(l.case_id, l.lender_id, 'lender', 'viewed', null);
end $$;
revoke all on function sehat_lender_case_viewed(uuid) from public, anon;
grant execute on function sehat_lender_case_viewed(uuid) to authenticated;

-- ── Lender: approve / reject a hospital as a payee ──────────────────────────
create or replace function sehat_lender_payee_decide(p_lender uuid, p_hospital uuid, p_approve boolean, p_note text default null,
                                                     p_no_cost_emi boolean default null, p_agreement_on date default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_is_business(p_lender)) then
    raise exception 'Only the lender''s owner or manager can approve a hospital.' using errcode = '42501';
  end if;
  insert into lender_hospital_links (lender_id, hospital_id, requested_by) values (p_lender, p_hospital, p_lender)
    on conflict (lender_id, hospital_id) do nothing;
  update lender_hospital_links
     set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         no_cost_emi = coalesce(p_no_cost_emi, no_cost_emi), agreement_done_on = coalesce(p_agreement_on, agreement_done_on)
   where lender_id = p_lender and hospital_id = p_hospital;
end $$;
revoke all on function sehat_lender_payee_decide(uuid, uuid, boolean, text, boolean, date) from public, anon;
grant execute on function sehat_lender_payee_decide(uuid, uuid, boolean, text, boolean, date) to authenticated;

-- ── Lender: post an update on a case ────────────────────────────────────────
-- offered → sanctioned → disbursed, or declined. Disbursal to a hospital needs
-- the hospital approved as payee and the admission confirmed by the hospital.
create or replace function sehat_lender_case_update(p_case_lender uuid, p_status text, p jsonb default '{}'::jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare l finance_case_lenders; c finance_cases; lp lender_profiles; v_ok boolean;
begin
  select * into l from finance_case_lenders where id = p_case_lender for update;
  if l.id is null or not (sehat_is_admin() or sehat_caller_role(l.lender_id) is not null) then
    raise exception 'Not your case.' using errcode = '42501';
  end if;
  select * into c from finance_cases where id = l.case_id for update;
  select * into lp from lender_profiles where business_id = l.lender_id;
  if c.status in ('withdrawn','expired','closed') then raise exception 'This case is closed.' using errcode = 'P0001'; end if;

  v_ok := case p_status
            when 'offered'    then l.status in ('shared','offered')
            when 'sanctioned' then l.status in ('shared','offered','sanctioned')
            when 'disbursed'  then l.status = 'sanctioned'
            when 'declined'   then l.status in ('shared','offered','sanctioned')
            else false end;
  if not v_ok then raise exception 'Can''t move from % to %.', l.status, p_status using errcode = 'P0001'; end if;
  if p_status in ('sanctioned','disbursed') and exists (select 1 from finance_case_lenders o where o.case_id = c.id and o.id <> l.id and o.status in ('sanctioned','disbursed')) then
    raise exception 'Another lender has already sanctioned this loan.' using errcode = 'P0001';
  end if;
  if p_status = 'disbursed' then
    if lp.pays_to = 'hospital' and not exists (select 1 from lender_hospital_links k where k.lender_id = l.lender_id
                                                 and k.hospital_id = c.business_id and k.status = 'approved') then
      raise exception 'Approve the hospital as a payee first.' using errcode = 'P0001';
    end if;
    if c.admission_confirmed_at is null then
      raise exception 'Wait for the hospital to confirm the admission / treatment date.' using errcode = 'P0001';
    end if;
    if coalesce((p->>'disbursed_amount')::numeric, 0) <= 0 or btrim(coalesce(p->>'utr', '')) = '' then
      raise exception 'Enter the amount paid and the UTR.' using errcode = '22023';
    end if;
  end if;
  if p_status = 'declined' and btrim(coalesce(p->>'reason', '')) = '' then
    raise exception 'Give a short reason.' using errcode = '22023';
  end if;

  update finance_case_lenders set
    status = p_status,
    lender_ref = coalesce(nullif(btrim(coalesce(p->>'lender_ref', '')), ''), lender_ref),
    offer_amount = coalesce((p->>'offer_amount')::numeric, offer_amount),
    offer_tenure_months = coalesce((p->>'offer_tenure_months')::integer, offer_tenure_months),
    offer_emi = coalesce((p->>'offer_emi')::numeric, offer_emi),
    decline_reason = case when p_status = 'declined' then btrim(p->>'reason') else decline_reason end,
    disbursed_amount = case when p_status = 'disbursed' then (p->>'disbursed_amount')::numeric else disbursed_amount end,
    disbursed_on = case when p_status = 'disbursed' then coalesce((p->>'disbursed_on')::date, current_date) else disbursed_on end,
    utr = case when p_status = 'disbursed' then btrim(p->>'utr') else utr end,
    updated_at = now()
  where id = l.id;

  -- The case moves with the furthest lender; it is declined only when every lender declined.
  update finance_cases set status = case
      when exists (select 1 from finance_case_lenders where case_id = c.id and status = 'disbursed')  then 'disbursed'
      when exists (select 1 from finance_case_lenders where case_id = c.id and status = 'sanctioned') then 'sanctioned'
      when exists (select 1 from finance_case_lenders where case_id = c.id and status = 'offered')    then 'offered'
      when not exists (select 1 from finance_case_lenders where case_id = c.id and status <> 'declined') then 'declined'
      else 'shared' end,
    updated_at = now()
  where id = c.id;
  -- Once one lender sanctions, the others step back.
  if p_status = 'sanctioned' then
    update finance_case_lenders set status = 'withdrawn', updated_at = now()
     where case_id = c.id and id <> l.id and status in ('shared','offered');
  end if;
  perform sehat_finance_log(c.id, l.lender_id, 'lender', p_status, coalesce(p->>'reason', p->>'utr', p->>'lender_ref'));
end $$;
revoke all on function sehat_lender_case_update(uuid, text, jsonb) from public, anon;
grant execute on function sehat_lender_case_update(uuid, text, jsonb) to authenticated;

-- ── Admin: approve / suspend a lender, set commission ───────────────────────
create or replace function sehat_admin_lender_set(p_lender uuid, p_status text, p_commission_pct numeric default null,
                                                  p_lsp_agreement_on date default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if p_status not in ('pending','approved','suspended') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  if p_status = 'approved' and coalesce(p_lsp_agreement_on, (select lsp_agreement_on from lender_profiles where business_id = p_lender)) is null then
    raise exception 'Record the date our sourcing (LSP) agreement was signed before approving.' using errcode = 'P0001';
  end if;
  update lender_profiles set status = p_status,
         commission_pct = coalesce(p_commission_pct, commission_pct),
         lsp_agreement_on = coalesce(p_lsp_agreement_on, lsp_agreement_on),
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         updated_at = now()
   where business_id = p_lender;
  if not found then raise exception 'That lender has no profile yet.' using errcode = 'P0002'; end if;
end $$;
revoke all on function sehat_admin_lender_set(uuid, text, numeric, date) from public, anon;
grant execute on function sehat_admin_lender_set(uuid, text, numeric, date) to authenticated;

notify pgrst, 'reload schema';
