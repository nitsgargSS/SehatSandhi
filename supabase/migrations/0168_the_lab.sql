-- ============================================================================
-- Sehatsandhi — the lab: tests, packages, orders, results, signed reports
--
-- Run AFTER 0167. Safe to re-run.
--
-- ── WHO GETS IT ─────────────────────────────────────────────────────────────
-- Every business registered as a Diagnostic Lab, and any clinic or hospital an
-- admin switches it on for (businesses.lab_module) — the in-house lab, like the
-- in-house pharmacy (0158). Decided 28 Sep 2026.
--
-- ── THE FLOW ────────────────────────────────────────────────────────────────
--   catalogue → the lab's own tests & packages (its prices, its ranges)
--   → an order for a patient: at the desk, or by a doctor from the visit
--     (charged to the patient's account as it is placed)
--   → sample collected (at the lab or at home)
--   → results entered, parameter by parameter; out-of-range values flagged
--     against the patient's sex where the range differs
--   → a doctor (pathologist / radiologist) approves → a numbered report
--   → sent to the patient automatically (the app calls lab-report-send on
--     approval; WhatsApp link, email fallback) and viewable at /lab/<token>.
--
-- ── WHO DOES WHAT ───────────────────────────────────────────────────────────
-- Tests, packages, prices: owner, manager, doctor.
-- Orders and sample collection: anyone on the staff.
-- Results: owner, doctor, nurse — lab technicians join a lab as "nurse".
--   Lab work is department-wide, so results are not narrowed to one doctor's
--   patients the way the clinical record is (0138/0149): a pathologist reads
--   every sample. Reception sees orders and their status, never the values.
-- Approval: owner or doctor only — the signing pathologist or radiologist.
--
-- ── HOME COLLECTION ─────────────────────────────────────────────────────────
-- An order can be collected at the patient's home: the address, a preferred
-- slot, which staff member goes (collector), and the lab's home-collection fee
-- (businesses.lab_home_fee, changeable per order) charged to the patient.
-- "Home collections" on the lab screen is the day's round, with a map link.
--
-- ── PATHOLOGISTS AND RADIOLOGISTS ───────────────────────────────────────────
-- They are doctors: added to a hospital or lab like any doctor, with the
-- specialities Pathology (PATH) and Radiology (RAD), at the same extra-doctor
-- price, and it is their approval that releases a report.
--
-- ── THE CATALOGUE ───────────────────────────────────────────────────────────
-- lab_catalogue is reference data we author: common blood, urine and stool
-- tests with parameters, units and adult reference ranges (sex-specific where
-- they differ), and report templates for X-ray, ultrasound, CT, MRI, ECG, echo
-- and TMT. A lab imports it once and edits its copy; the ranges printed on a
-- report are the lab's own, snapshotted onto each result.
-- ============================================================================


-- ============================================================================
-- 1. Switch
-- ============================================================================

alter table businesses add column if not exists lab_module boolean not null default false;
alter table businesses add column if not exists lab_module_set_by text;
-- The lab's usual home-collection charge; 0 = free. Each order can change it.
alter table businesses add column if not exists lab_home_fee numeric(10,2) not null default 0 check (lab_home_fee >= 0);

create or replace function sehat_lab_on(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select b.lab_module or b.vertical = 'lab' from businesses b where b.id = p_business), false);
$$;
revoke all on function sehat_lab_on(uuid) from public, anon;
grant execute on function sehat_lab_on(uuid) to authenticated;

create or replace function sehat_admin_set_lab(p_business uuid, p_on boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is not null and not sehat_is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  update businesses set lab_module = coalesce(p_on, false),
         lab_module_set_by = coalesce((select email from auth.users where id = auth.uid()), 'database')
   where id = p_business;
  if not found then raise exception 'No such business.' using errcode = 'P0002'; end if;
  return (select jsonb_build_object('lab_module', lab_module) from businesses where id = p_business);
end $$;
revoke all on function sehat_admin_set_lab(uuid, boolean) from public, anon;
grant execute on function sehat_admin_set_lab(uuid, boolean) to authenticated;

-- ok: 'staff' anyone at the clinic, 'manage' owner/manager/doctor,
-- 'results' owner/doctor/nurse, 'approve' owner/doctor.
create or replace function sehat_lab_check(p_business uuid, p_need text)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_role text := sehat_caller_role(p_business);
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  if not sehat_lab_on(p_business) then
    raise exception 'The lab is not switched on for this business.' using errcode = 'P0001';
  end if;
  if sehat_is_admin() then return; end if;
  if p_need = 'manage' and coalesce(v_role in ('owner','manager','doctor'), false) is not true then
    raise exception 'Only the owner, a manager or a doctor can change tests and packages.' using errcode = '42501';
  elsif p_need = 'results' and coalesce(v_role in ('owner','doctor','nurse'), false) is not true then
    raise exception 'Only a doctor or a lab technician (nurse role) can enter results.' using errcode = '42501';
  elsif p_need = 'approve' and coalesce(v_role in ('owner','doctor'), false) is not true then
    raise exception 'Only a doctor (pathologist / radiologist) can approve a report.' using errcode = '42501';
  end if;
end $$;
revoke all on function sehat_lab_check(uuid, text) from public, anon, authenticated;

create or replace function sehat_lab_reads_results(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select sehat_is_admin() or (sehat_caller_owns_business(p_business)
         and coalesce(sehat_caller_role(p_business) in ('owner','doctor','nurse'), false));
$$;
revoke all on function sehat_lab_reads_results(uuid) from public, anon;
grant execute on function sehat_lab_reads_results(uuid) to authenticated;


-- ============================================================================
-- 2. Tables
-- ============================================================================

create table if not exists lab_catalogue (
  code text primary key,
  name text not null,
  category text not null check (category in ('pathology','radiology','cardiology','other')),
  department text,
  sample_type text,
  report_kind text not null default 'parameters' check (report_kind in ('parameters','narrative')),
  default_price numeric(10,2),
  tat_hours integer,
  parameters jsonb not null default '[]'::jsonb,
  sort_order integer not null default 100
);

create table if not exists lab_tests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  catalogue_code text,
  name text not null check (btrim(name) <> ''),
  category text not null default 'pathology' check (category in ('pathology','radiology','cardiology','other')),
  department text,
  sample_type text,
  report_kind text not null default 'parameters' check (report_kind in ('parameters','narrative')),
  price numeric(10,2) not null default 0 check (price >= 0),
  tat_hours integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists lab_tests_one_name on lab_tests (business_id, lower(name));

create table if not exists lab_test_parameters (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references lab_tests(id) on delete cascade,
  name text not null,
  unit text,
  kind text not null default 'number' check (kind in ('number','text','select','long_text')),
  options text[],
  ref_low numeric, ref_high numeric,
  ref_low_f numeric, ref_high_f numeric,
  ref_text text,
  sort_order integer not null default 0
);
create index if not exists lab_test_parameters_test_idx on lab_test_parameters (test_id, sort_order);

create table if not exists lab_packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  price numeric(10,2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists lab_packages_one_name on lab_packages (business_id, lower(name));

create table if not exists lab_package_tests (
  package_id uuid not null references lab_packages(id) on delete cascade,
  test_id uuid not null references lab_tests(id) on delete cascade,
  primary key (package_id, test_id)
);

create table if not exists lab_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('order','report')),
  fy text not null,
  last_number integer not null default 0,
  primary key (business_id, kind, fy)
);

create table if not exists lab_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_no text not null,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  visit_id uuid references patient_visits(id) on delete set null,
  source text not null default 'desk' check (source in ('desk','doctor')),
  ordered_by uuid references practitioners(id) on delete set null,
  ordered_by_name text,
  referred_by text,
  collection text not null default 'lab' check (collection in ('lab','home')),
  collection_address text,
  collection_slot timestamptz,
  collector_id uuid references practitioners(id) on delete set null,
  collector_name text,
  home_fee numeric(10,2) not null default 0,
  priority text not null default 'routine' check (priority in ('routine','urgent')),
  notes text,
  status text not null default 'ordered'
    check (status in ('ordered','collected','in_progress','ready','reported','cancelled')),
  collected_at timestamptz,
  collected_by_name text,
  reported_at timestamptz,
  cancelled_reason text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (business_id, order_no)
);
create index if not exists lab_orders_business_idx on lab_orders (business_id, created_at desc);
create index if not exists lab_orders_member_idx on lab_orders (patient_member_id);

create table if not exists lab_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references lab_orders(id) on delete cascade,
  test_id uuid references lab_tests(id) on delete set null,
  package_id uuid references lab_packages(id) on delete set null,
  package_name text,
  name text not null,
  category text,
  department text,
  report_kind text not null default 'parameters',
  status text not null default 'pending' check (status in ('pending','entered','approved')),
  entered_by_name text,
  entered_at timestamptz,
  sort_order integer not null default 0
);
create index if not exists lab_order_items_order_idx on lab_order_items (order_id);

create table if not exists lab_results (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references lab_order_items(id) on delete cascade,
  parameter_id uuid references lab_test_parameters(id) on delete set null,
  name text not null,
  unit text,
  kind text not null default 'number',
  value_num numeric,
  value_text text,
  ref_low numeric, ref_high numeric, ref_text text,
  flag text check (flag is null or flag in ('L','H','N')),
  sort_order integer not null default 0
);
create unique index if not exists lab_results_one on lab_results (order_item_id, parameter_id);

create table if not exists lab_reports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references lab_orders(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  report_no text not null,
  version integer not null default 1,
  approved_by uuid references practitioners(id) on delete set null,
  approved_by_name text,
  approved_by_qualification text,
  approved_at timestamptz not null default now(),
  public_token uuid not null default gen_random_uuid(),
  token_expires_at timestamptz not null default now() + interval '1 year',
  sent_at timestamptz,
  sent_channels text[] not null default '{}',
  send_error text,
  unique (business_id, report_no)
);
create index if not exists lab_reports_order_idx on lab_reports (order_id, version desc);
create unique index if not exists lab_reports_token on lab_reports (public_token);


-- ============================================================================
-- 3. The catalogue
-- ============================================================================

insert into lab_catalogue (code, name, category, department, sample_type, report_kind, default_price, tat_hours, parameters, sort_order) values
  ('CBC', 'Complete Blood Count (CBC)', 'pathology', 'Haematology', 'Blood (EDTA)', 'parameters', 300, 6, '[{"name": "Haemoglobin", "unit": "g/dL", "kind": "number", "ref_low": 13, "ref_high": 17, "ref_low_f": 12, "ref_high_f": 15.5}, {"name": "Total RBC count", "unit": "million/cumm", "kind": "number", "ref_low": 4.5, "ref_high": 5.5, "ref_low_f": 3.8, "ref_high_f": 4.8}, {"name": "Haematocrit (PCV)", "unit": "%", "kind": "number", "ref_low": 40, "ref_high": 50, "ref_low_f": 36, "ref_high_f": 46}, {"name": "MCV", "unit": "fL", "kind": "number", "ref_low": 80, "ref_high": 100}, {"name": "MCH", "unit": "pg", "kind": "number", "ref_low": 27, "ref_high": 32}, {"name": "MCHC", "unit": "g/dL", "kind": "number", "ref_low": 31.5, "ref_high": 34.5}, {"name": "RDW-CV", "unit": "%", "kind": "number", "ref_low": 11.5, "ref_high": 14.5}, {"name": "Total WBC count", "unit": "/cumm", "kind": "number", "ref_low": 4000, "ref_high": 11000}, {"name": "Neutrophils", "unit": "%", "kind": "number", "ref_low": 40, "ref_high": 75}, {"name": "Lymphocytes", "unit": "%", "kind": "number", "ref_low": 20, "ref_high": 45}, {"name": "Monocytes", "unit": "%", "kind": "number", "ref_low": 2, "ref_high": 10}, {"name": "Eosinophils", "unit": "%", "kind": "number", "ref_low": 1, "ref_high": 6}, {"name": "Basophils", "unit": "%", "kind": "number", "ref_low": 0, "ref_high": 1}, {"name": "Platelet count", "unit": "lakh/cumm", "kind": "number", "ref_low": 1.5, "ref_high": 4.5}]'::jsonb, 10),
  ('ESR', 'ESR', 'pathology', 'Haematology', 'Blood (Citrate)', 'parameters', 100, 4, '[{"name": "ESR", "unit": "mm/hr", "kind": "number", "ref_low": 0, "ref_high": 15, "ref_low_f": 0, "ref_high_f": 20}]'::jsonb, 20),
  ('BGRP', 'Blood Group & Rh', 'pathology', 'Haematology', 'Blood (EDTA)', 'parameters', 100, 2, '[{"name": "Blood group", "kind": "select", "options": ["A", "B", "AB", "O"]}, {"name": "Rh factor", "kind": "select", "options": ["Positive", "Negative"]}]'::jsonb, 30),
  ('PTINR', 'Prothrombin Time (PT / INR)', 'pathology', 'Haematology', 'Blood (Citrate)', 'parameters', 400, 6, '[{"name": "Prothrombin time", "unit": "seconds", "kind": "number", "ref_low": 11, "ref_high": 13.5}, {"name": "Control", "unit": "seconds", "kind": "number"}, {"name": "INR", "kind": "number", "ref_low": 0.8, "ref_high": 1.2}]'::jsonb, 40),
  ('MP', 'Malaria Antigen', 'pathology', 'Haematology', 'Blood (EDTA)', 'parameters', 400, 4, '[{"name": "Malaria antigen", "kind": "select", "options": ["Negative", "P. vivax", "P. falciparum", "Mixed infection"]}]'::jsonb, 50),
  ('FBS', 'Blood Sugar — Fasting', 'pathology', 'Biochemistry', 'Blood (Fluoride)', 'parameters', 60, 2, '[{"name": "Glucose, fasting", "unit": "mg/dL", "kind": "number", "ref_low": 70, "ref_high": 100}]'::jsonb, 60),
  ('PPBS', 'Blood Sugar — Post Prandial', 'pathology', 'Biochemistry', 'Blood (Fluoride)', 'parameters', 60, 2, '[{"name": "Glucose, 2 hr after meal", "unit": "mg/dL", "kind": "number", "ref_low": 70, "ref_high": 140}]'::jsonb, 70),
  ('RBS', 'Blood Sugar — Random', 'pathology', 'Biochemistry', 'Blood (Fluoride)', 'parameters', 60, 2, '[{"name": "Glucose, random", "unit": "mg/dL", "kind": "number", "ref_low": 70, "ref_high": 140}]'::jsonb, 80),
  ('HBA1C', 'HbA1c (Glycated Haemoglobin)', 'pathology', 'Biochemistry', 'Blood (EDTA)', 'parameters', 450, 6, '[{"name": "HbA1c", "unit": "%", "kind": "number", "ref_low": 4, "ref_high": 5.6, "ref_text": "Below 5.7 normal · 5.7–6.4 prediabetes · 6.5 and above diabetes"}, {"name": "Estimated average glucose", "unit": "mg/dL", "kind": "number"}]'::jsonb, 90),
  ('LIPID', 'Lipid Profile', 'pathology', 'Biochemistry', 'Blood (Serum), fasting', 'parameters', 500, 6, '[{"name": "Total cholesterol", "unit": "mg/dL", "kind": "number", "ref_low": 0, "ref_high": 200}, {"name": "Triglycerides", "unit": "mg/dL", "kind": "number", "ref_low": 0, "ref_high": 150}, {"name": "HDL cholesterol", "unit": "mg/dL", "kind": "number", "ref_low": 40, "ref_low_f": 50}, {"name": "LDL cholesterol", "unit": "mg/dL", "kind": "number", "ref_low": 0, "ref_high": 100}, {"name": "VLDL cholesterol", "unit": "mg/dL", "kind": "number", "ref_low": 2, "ref_high": 30}, {"name": "Total cholesterol / HDL ratio", "kind": "number", "ref_low": 0, "ref_high": 5}]'::jsonb, 100),
  ('LFT', 'Liver Function Test (LFT)', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 550, 6, '[{"name": "Bilirubin, total", "unit": "mg/dL", "kind": "number", "ref_low": 0.2, "ref_high": 1.2}, {"name": "Bilirubin, direct", "unit": "mg/dL", "kind": "number", "ref_low": 0, "ref_high": 0.3}, {"name": "Bilirubin, indirect", "unit": "mg/dL", "kind": "number", "ref_low": 0.2, "ref_high": 0.9}, {"name": "SGOT (AST)", "unit": "U/L", "kind": "number", "ref_low": 0, "ref_high": 40}, {"name": "SGPT (ALT)", "unit": "U/L", "kind": "number", "ref_low": 0, "ref_high": 41}, {"name": "Alkaline phosphatase", "unit": "U/L", "kind": "number", "ref_low": 44, "ref_high": 147}, {"name": "GGT", "unit": "U/L", "kind": "number", "ref_low": 0, "ref_high": 60}, {"name": "Total protein", "unit": "g/dL", "kind": "number", "ref_low": 6, "ref_high": 8.3}, {"name": "Albumin", "unit": "g/dL", "kind": "number", "ref_low": 3.5, "ref_high": 5.2}, {"name": "Globulin", "unit": "g/dL", "kind": "number", "ref_low": 2, "ref_high": 3.5}, {"name": "A/G ratio", "kind": "number", "ref_low": 1, "ref_high": 2.2}]'::jsonb, 110),
  ('KFT', 'Kidney Function Test (KFT)', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 550, 6, '[{"name": "Blood urea", "unit": "mg/dL", "kind": "number", "ref_low": 15, "ref_high": 40}, {"name": "BUN", "unit": "mg/dL", "kind": "number", "ref_low": 7, "ref_high": 20}, {"name": "Serum creatinine", "unit": "mg/dL", "kind": "number", "ref_low": 0.7, "ref_high": 1.3, "ref_low_f": 0.6, "ref_high_f": 1.1}, {"name": "Uric acid", "unit": "mg/dL", "kind": "number", "ref_low": 3.5, "ref_high": 7.2, "ref_low_f": 2.6, "ref_high_f": 6}, {"name": "Sodium", "unit": "mmol/L", "kind": "number", "ref_low": 135, "ref_high": 145}, {"name": "Potassium", "unit": "mmol/L", "kind": "number", "ref_low": 3.5, "ref_high": 5.1}, {"name": "Chloride", "unit": "mmol/L", "kind": "number", "ref_low": 98, "ref_high": 107}, {"name": "Calcium", "unit": "mg/dL", "kind": "number", "ref_low": 8.5, "ref_high": 10.5}]'::jsonb, 120),
  ('CREAT', 'Serum Creatinine', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 150, 4, '[{"name": "Serum creatinine", "unit": "mg/dL", "kind": "number", "ref_low": 0.7, "ref_high": 1.3, "ref_low_f": 0.6, "ref_high_f": 1.1}]'::jsonb, 130),
  ('URIC', 'Uric Acid', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 150, 4, '[{"name": "Uric acid", "unit": "mg/dL", "kind": "number", "ref_low": 3.5, "ref_high": 7.2, "ref_low_f": 2.6, "ref_high_f": 6}]'::jsonb, 140),
  ('ELEC', 'Serum Electrolytes', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 400, 4, '[{"name": "Sodium", "unit": "mmol/L", "kind": "number", "ref_low": 135, "ref_high": 145}, {"name": "Potassium", "unit": "mmol/L", "kind": "number", "ref_low": 3.5, "ref_high": 5.1}, {"name": "Chloride", "unit": "mmol/L", "kind": "number", "ref_low": 98, "ref_high": 107}]'::jsonb, 150),
  ('CALC', 'Serum Calcium', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 200, 4, '[{"name": "Calcium", "unit": "mg/dL", "kind": "number", "ref_low": 8.5, "ref_high": 10.5}]'::jsonb, 160),
  ('AMYL', 'Amylase & Lipase', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 800, 6, '[{"name": "Amylase", "unit": "U/L", "kind": "number", "ref_low": 28, "ref_high": 100}, {"name": "Lipase", "unit": "U/L", "kind": "number", "ref_low": 13, "ref_high": 60}]'::jsonb, 170),
  ('IRON', 'Iron Studies', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 900, 12, '[{"name": "Serum iron", "unit": "µg/dL", "kind": "number", "ref_low": 60, "ref_high": 170}, {"name": "TIBC", "unit": "µg/dL", "kind": "number", "ref_low": 250, "ref_high": 450}, {"name": "Transferrin saturation", "unit": "%", "kind": "number", "ref_low": 20, "ref_high": 50}, {"name": "Ferritin", "unit": "ng/mL", "kind": "number", "ref_low": 30, "ref_high": 400, "ref_low_f": 13, "ref_high_f": 150}]'::jsonb, 180),
  ('CRP', 'C-Reactive Protein (CRP)', 'pathology', 'Biochemistry', 'Blood (Serum)', 'parameters', 450, 4, '[{"name": "CRP", "unit": "mg/L", "kind": "number", "ref_low": 0, "ref_high": 5}]'::jsonb, 190),
  ('THY', 'Thyroid Profile (T3, T4, TSH)', 'pathology', 'Endocrinology', 'Blood (Serum)', 'parameters', 550, 12, '[{"name": "T3, total", "unit": "ng/dL", "kind": "number", "ref_low": 80, "ref_high": 200}, {"name": "T4, total", "unit": "µg/dL", "kind": "number", "ref_low": 5.1, "ref_high": 14.1}, {"name": "TSH", "unit": "µIU/mL", "kind": "number", "ref_low": 0.27, "ref_high": 4.2}]'::jsonb, 200),
  ('TSH', 'TSH', 'pathology', 'Endocrinology', 'Blood (Serum)', 'parameters', 300, 12, '[{"name": "TSH", "unit": "µIU/mL", "kind": "number", "ref_low": 0.27, "ref_high": 4.2}]'::jsonb, 210),
  ('VITD', 'Vitamin D (25-OH)', 'pathology', 'Endocrinology', 'Blood (Serum)', 'parameters', 1200, 24, '[{"name": "Vitamin D (25-OH)", "unit": "ng/mL", "kind": "number", "ref_low": 30, "ref_high": 100, "ref_text": "Below 20 deficient · 20–29 insufficient · 30–100 sufficient"}]'::jsonb, 220),
  ('B12', 'Vitamin B12', 'pathology', 'Endocrinology', 'Blood (Serum)', 'parameters', 900, 24, '[{"name": "Vitamin B12", "unit": "pg/mL", "kind": "number", "ref_low": 200, "ref_high": 900}]'::jsonb, 230),
  ('INSF', 'Insulin — Fasting', 'pathology', 'Endocrinology', 'Blood (Serum)', 'parameters', 700, 24, '[{"name": "Insulin, fasting", "unit": "µIU/mL", "kind": "number", "ref_low": 2, "ref_high": 25}]'::jsonb, 240),
  ('PSA', 'PSA (Prostate Specific Antigen)', 'pathology', 'Endocrinology', 'Blood (Serum)', 'parameters', 800, 24, '[{"name": "PSA, total", "unit": "ng/mL", "kind": "number", "ref_low": 0, "ref_high": 4}]'::jsonb, 250),
  ('BHCG', 'Beta hCG', 'pathology', 'Endocrinology', 'Blood (Serum)', 'parameters', 700, 12, '[{"name": "Beta hCG", "unit": "mIU/mL", "kind": "number", "ref_text": "Below 5 not pregnant"}]'::jsonb, 260),
  ('WIDAL', 'Widal Test', 'pathology', 'Serology', 'Blood (Serum)', 'parameters', 200, 6, '[{"name": "S. typhi O", "kind": "select", "options": ["<1:20", "1:40", "1:80", "1:160", "1:320"]}, {"name": "S. typhi H", "kind": "select", "options": ["<1:20", "1:40", "1:80", "1:160", "1:320"]}, {"name": "S. paratyphi AH", "kind": "select", "options": ["<1:20", "1:40", "1:80", "1:160", "1:320"]}, {"name": "S. paratyphi BH", "kind": "select", "options": ["<1:20", "1:40", "1:80", "1:160", "1:320"]}]'::jsonb, 270),
  ('TYPHI', 'Typhoid IgM', 'pathology', 'Serology', 'Blood (Serum)', 'parameters', 500, 4, '[{"name": "Typhoid IgM", "kind": "select", "options": ["Negative", "Positive"]}]'::jsonb, 280),
  ('DENGUE', 'Dengue Profile (NS1, IgM, IgG)', 'pathology', 'Serology', 'Blood (Serum)', 'parameters', 1200, 6, '[{"name": "NS1 antigen", "kind": "select", "options": ["Negative", "Positive"]}, {"name": "IgM antibody", "kind": "select", "options": ["Negative", "Positive"]}, {"name": "IgG antibody", "kind": "select", "options": ["Negative", "Positive"]}]'::jsonb, 290),
  ('VIRAL', 'Viral Markers (HIV, HBsAg, HCV, VDRL)', 'pathology', 'Serology', 'Blood (Serum)', 'parameters', 900, 6, '[{"name": "HIV 1 & 2", "kind": "select", "options": ["Non-reactive", "Reactive"]}, {"name": "HBsAg", "kind": "select", "options": ["Non-reactive", "Reactive"]}, {"name": "HCV antibody", "kind": "select", "options": ["Non-reactive", "Reactive"]}, {"name": "VDRL", "kind": "select", "options": ["Non-reactive", "Reactive"]}]'::jsonb, 300),
  ('RAF', 'RA Factor', 'pathology', 'Serology', 'Blood (Serum)', 'parameters', 400, 6, '[{"name": "RA factor", "unit": "IU/mL", "kind": "number", "ref_low": 0, "ref_high": 14}]'::jsonb, 310),
  ('ASO', 'ASO Titre', 'pathology', 'Serology', 'Blood (Serum)', 'parameters', 400, 6, '[{"name": "ASO", "unit": "IU/mL", "kind": "number", "ref_low": 0, "ref_high": 200}]'::jsonb, 320),
  ('UPT', 'Urine Pregnancy Test', 'pathology', 'Clinical pathology', 'Urine', 'parameters', 150, 1, '[{"name": "Urine pregnancy test", "kind": "select", "options": ["Negative", "Positive"]}]'::jsonb, 330),
  ('URINE', 'Urine Routine & Microscopy', 'pathology', 'Clinical pathology', 'Urine', 'parameters', 150, 3, '[{"name": "Colour", "kind": "text", "ref_text": "Pale yellow"}, {"name": "Appearance", "kind": "select", "options": ["Clear", "Slightly turbid", "Turbid"]}, {"name": "pH", "kind": "number", "ref_low": 4.6, "ref_high": 8}, {"name": "Specific gravity", "kind": "number", "ref_low": 1.005, "ref_high": 1.03}, {"name": "Protein", "kind": "select", "options": ["Nil", "Trace", "+", "++", "+++", "++++"], "ref_text": "Nil"}, {"name": "Glucose", "kind": "select", "options": ["Nil", "Trace", "+", "++", "+++", "++++"], "ref_text": "Nil"}, {"name": "Ketones", "kind": "select", "options": ["Negative", "Positive"], "ref_text": "Negative"}, {"name": "Bilirubin", "kind": "select", "options": ["Negative", "Positive"], "ref_text": "Negative"}, {"name": "Blood", "kind": "select", "options": ["Nil", "Trace", "+", "++", "+++", "++++"], "ref_text": "Nil"}, {"name": "Pus cells", "kind": "text", "ref_text": "0–5 /hpf"}, {"name": "RBC", "kind": "text", "ref_text": "0–2 /hpf"}, {"name": "Epithelial cells", "kind": "text", "ref_text": "Few /hpf"}, {"name": "Casts", "kind": "text", "ref_text": "Nil"}, {"name": "Crystals", "kind": "text", "ref_text": "Nil"}, {"name": "Bacteria", "kind": "text", "ref_text": "Nil"}]'::jsonb, 340),
  ('STOOL', 'Stool Routine', 'pathology', 'Clinical pathology', 'Stool', 'parameters', 150, 4, '[{"name": "Colour", "kind": "text"}, {"name": "Consistency", "kind": "select", "options": ["Formed", "Semi-formed", "Loose", "Watery"]}, {"name": "Mucus", "kind": "select", "options": ["Absent", "Present"]}, {"name": "Occult blood", "kind": "select", "options": ["Negative", "Positive"], "ref_text": "Negative"}, {"name": "Pus cells", "kind": "text", "ref_text": "0–5 /hpf"}, {"name": "Ova / cysts", "kind": "text", "ref_text": "Not seen"}]'::jsonb, 350),
  ('BCULT', 'Blood Culture & Sensitivity', 'pathology', 'Microbiology', 'Blood (culture bottle)', 'parameters', 900, 72, '[{"name": "Organism isolated", "kind": "text", "ref_text": "No growth"}, {"name": "Antibiotic sensitivity", "kind": "long_text"}]'::jsonb, 360),
  ('UCULT', 'Urine Culture & Sensitivity', 'pathology', 'Microbiology', 'Urine (sterile)', 'parameters', 700, 72, '[{"name": "Organism isolated", "kind": "text", "ref_text": "No growth"}, {"name": "Colony count", "kind": "text"}, {"name": "Antibiotic sensitivity", "kind": "long_text"}]'::jsonb, 370),
  ('XRCHEST', 'X-Ray Chest PA View', 'radiology', 'Radiology', null, 'narrative', 400, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 380),
  ('XRAY', 'X-Ray (other region)', 'radiology', 'Radiology', null, 'narrative', 400, 24, '[{"name": "Region / view", "kind": "text"}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 390),
  ('USGABD', 'Ultrasound — Whole Abdomen', 'radiology', 'Radiology', null, 'narrative', 1200, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 400),
  ('USGKUB', 'Ultrasound — KUB', 'radiology', 'Radiology', null, 'narrative', 1000, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 410),
  ('USGPEL', 'Ultrasound — Pelvis', 'radiology', 'Radiology', null, 'narrative', 1000, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 420),
  ('USGOBS', 'Ultrasound — Obstetric', 'radiology', 'Radiology', null, 'narrative', 1200, 24, '[{"name": "Gestational age", "unit": "weeks", "kind": "number"}, {"name": "Foetal heart rate", "unit": "bpm", "kind": "number", "ref_low": 110, "ref_high": 160}, {"name": "Presentation", "kind": "select", "options": ["Cephalic", "Breech", "Transverse", "Variable"]}, {"name": "Placenta", "kind": "text"}, {"name": "Liquor", "kind": "select", "options": ["Adequate", "Reduced", "Increased"]}, {"name": "Estimated foetal weight", "unit": "g", "kind": "number"}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 430),
  ('USGNECK', 'Ultrasound — Thyroid / Neck', 'radiology', 'Radiology', null, 'narrative', 1000, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 440),
  ('DOPPLER', 'Colour Doppler', 'radiology', 'Radiology', null, 'narrative', 2000, 24, '[{"name": "Region", "kind": "text"}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 450),
  ('CTHEAD', 'CT Scan — Head / Brain', 'radiology', 'Radiology', null, 'narrative', 3000, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 460),
  ('CTCHEST', 'CT Scan — Chest', 'radiology', 'Radiology', null, 'narrative', 4500, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 470),
  ('CTABD', 'CT Scan — Abdomen', 'radiology', 'Radiology', null, 'narrative', 6000, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 480),
  ('CT', 'CT Scan (other region)', 'radiology', 'Radiology', null, 'narrative', 4000, 24, '[{"name": "Region", "kind": "text"}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 490),
  ('MRIBRAIN', 'MRI — Brain', 'radiology', 'Radiology', null, 'narrative', 6500, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 500),
  ('MRISPINE', 'MRI — Spine', 'radiology', 'Radiology', null, 'narrative', 7000, 24, '[{"name": "Region", "kind": "select", "options": ["Cervical", "Dorsal", "Lumbar", "Whole spine"]}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 510),
  ('MRIJOINT', 'MRI — Joint', 'radiology', 'Radiology', null, 'narrative', 7000, 24, '[{"name": "Joint", "kind": "text"}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 520),
  ('MRI', 'MRI (other region)', 'radiology', 'Radiology', null, 'narrative', 7000, 24, '[{"name": "Region", "kind": "text"}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 530),
  ('MAMMO', 'Mammography', 'radiology', 'Radiology', null, 'narrative', 2000, 24, '[{"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 540),
  ('ECG', 'ECG', 'cardiology', 'Cardiology', null, 'narrative', 300, 1, '[{"name": "Heart rate", "unit": "bpm", "kind": "number", "ref_low": 60, "ref_high": 100}, {"name": "Rhythm", "kind": "select", "options": ["Sinus rhythm", "Sinus tachycardia", "Sinus bradycardia", "Atrial fibrillation", "Other"]}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 550),
  ('ECHO', '2D Echo', 'cardiology', 'Cardiology', null, 'narrative', 2000, 24, '[{"name": "Ejection fraction", "unit": "%", "kind": "number", "ref_low": 55, "ref_high": 70}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 560),
  ('TMT', 'Treadmill Test (TMT)', 'cardiology', 'Cardiology', null, 'narrative', 2000, 24, '[{"name": "Result", "kind": "select", "options": ["Negative for inducible ischaemia", "Positive for inducible ischaemia", "Inconclusive"]}, {"name": "Findings", "kind": "long_text"}, {"name": "Impression", "kind": "long_text"}]'::jsonb, 570)
on conflict (code) do update set
  name = excluded.name, category = excluded.category, department = excluded.department,
  sample_type = excluded.sample_type, report_kind = excluded.report_kind,
  default_price = excluded.default_price, tat_hours = excluded.tat_hours,
  parameters = excluded.parameters, sort_order = excluded.sort_order;


-- ============================================================================
-- 4. Tests and packages
-- ============================================================================

create or replace function sehat_lab_staff_name(p_business uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.full_name from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
      where bp.business_id = p_business and p.auth_uid = auth.uid() limit 1),
    (select 'Owner' from businesses b where b.id = p_business and b.auth_uid = auth.uid()),
    (select 'Sehatsandhi: ' || email from auth.users where id = auth.uid()),
    'Unknown');
$$;
revoke all on function sehat_lab_staff_name(uuid) from public, anon, authenticated;

-- Copies catalogue tests into the lab's own list (all, or the codes given),
-- skipping any it already has by name. Returns how many were added.
create or replace function sehat_lab_import_catalogue(p_business uuid, p_codes text[] default null)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare c record; v_test uuid; n integer := 0; p jsonb; i integer;
begin
  perform sehat_lab_check(p_business, 'manage');
  for c in select * from lab_catalogue where p_codes is null or code = any(p_codes) order by sort_order loop
    continue when exists (select 1 from lab_tests t where t.business_id = p_business and lower(t.name) = lower(c.name));
    insert into lab_tests (business_id, catalogue_code, name, category, department, sample_type, report_kind, price, tat_hours)
    values (p_business, c.code, c.name, c.category, c.department, c.sample_type, c.report_kind, coalesce(c.default_price, 0), c.tat_hours)
    returning id into v_test;
    i := 0;
    for p in select * from jsonb_array_elements(c.parameters) loop
      insert into lab_test_parameters (test_id, name, unit, kind, options, ref_low, ref_high, ref_low_f, ref_high_f, ref_text, sort_order)
      values (v_test, p->>'name', p->>'unit', coalesce(p->>'kind', 'number'),
              case when p ? 'options' then array(select jsonb_array_elements_text(p->'options')) end,
              (p->>'ref_low')::numeric, (p->>'ref_high')::numeric, (p->>'ref_low_f')::numeric, (p->>'ref_high_f')::numeric,
              p->>'ref_text', i);
      i := i + 1;
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_lab_import_catalogue(uuid, text[]) from public, anon;
grant execute on function sehat_lab_import_catalogue(uuid, text[]) to authenticated;

-- p_test: {id?, name, category, department, sample_type, report_kind, price, tat_hours, is_active}
-- p_params: [{id?, name, unit, kind, options[], ref_low, ref_high, ref_low_f, ref_high_f, ref_text}] — replaces the list.
create or replace function sehat_lab_save_test(p_business uuid, p_test jsonb, p_params jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p_test->>'id', '')::uuid; v_pid uuid; p jsonb; i integer := 0; v_keep uuid[] := '{}';
begin
  perform sehat_lab_check(p_business, 'manage');
  if btrim(coalesce(p_test->>'name', '')) = '' then raise exception 'Give the test a name.' using errcode = '22023'; end if;
  if v_id is null then
    insert into lab_tests (business_id, name, category, department, sample_type, report_kind, price, tat_hours)
    values (p_business, btrim(p_test->>'name'), coalesce(nullif(p_test->>'category',''), 'pathology'),
            nullif(btrim(coalesce(p_test->>'department','')), ''), nullif(btrim(coalesce(p_test->>'sample_type','')), ''),
            coalesce(nullif(p_test->>'report_kind',''), 'parameters'), coalesce(nullif(p_test->>'price','')::numeric, 0),
            nullif(p_test->>'tat_hours','')::integer)
    returning id into v_id;
  else
    update lab_tests set name = btrim(p_test->>'name'),
           category = coalesce(nullif(p_test->>'category',''), category),
           department = nullif(btrim(coalesce(p_test->>'department','')), ''),
           sample_type = nullif(btrim(coalesce(p_test->>'sample_type','')), ''),
           report_kind = coalesce(nullif(p_test->>'report_kind',''), report_kind),
           price = coalesce(nullif(p_test->>'price','')::numeric, price),
           tat_hours = nullif(p_test->>'tat_hours','')::integer,
           is_active = coalesce((p_test->>'is_active')::boolean, is_active)
     where id = v_id and business_id = p_business;
    if not found then raise exception 'No such test at this lab.' using errcode = 'P0002'; end if;
  end if;

  if p_params is not null then
    for p in select * from jsonb_array_elements(p_params) loop
      continue when btrim(coalesce(p->>'name','')) = '';
      if nullif(p->>'id','') is not null and exists (select 1 from lab_test_parameters where id = (p->>'id')::uuid and test_id = v_id) then
        update lab_test_parameters set name = btrim(p->>'name'), unit = nullif(btrim(coalesce(p->>'unit','')), ''),
               kind = coalesce(nullif(p->>'kind',''), 'number'),
               options = case when jsonb_typeof(p->'options') = 'array' then array(select jsonb_array_elements_text(p->'options')) end,
               ref_low = nullif(p->>'ref_low','')::numeric, ref_high = nullif(p->>'ref_high','')::numeric,
               ref_low_f = nullif(p->>'ref_low_f','')::numeric, ref_high_f = nullif(p->>'ref_high_f','')::numeric,
               ref_text = nullif(btrim(coalesce(p->>'ref_text','')), ''), sort_order = i
         where id = (p->>'id')::uuid;
        v_keep := v_keep || (p->>'id')::uuid;
      else
        insert into lab_test_parameters (test_id, name, unit, kind, options, ref_low, ref_high, ref_low_f, ref_high_f, ref_text, sort_order)
        values (v_id, btrim(p->>'name'), nullif(btrim(coalesce(p->>'unit','')), ''), coalesce(nullif(p->>'kind',''), 'number'),
                case when jsonb_typeof(p->'options') = 'array' then array(select jsonb_array_elements_text(p->'options')) end,
                nullif(p->>'ref_low','')::numeric, nullif(p->>'ref_high','')::numeric,
                nullif(p->>'ref_low_f','')::numeric, nullif(p->>'ref_high_f','')::numeric,
                nullif(btrim(coalesce(p->>'ref_text','')), ''), i)
        returning id into v_pid;
        v_keep := v_keep || v_pid;
      end if;
      i := i + 1;
    end loop;
    delete from lab_test_parameters where test_id = v_id and not (id = any(v_keep));
  end if;
  return v_id;
end $$;
revoke all on function sehat_lab_save_test(uuid, jsonb, jsonb) from public, anon;
grant execute on function sehat_lab_save_test(uuid, jsonb, jsonb) to authenticated;

create or replace function sehat_lab_save_package(p_business uuid, p_package jsonb, p_test_ids uuid[])
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p_package->>'id','')::uuid;
begin
  perform sehat_lab_check(p_business, 'manage');
  if btrim(coalesce(p_package->>'name','')) = '' then raise exception 'Give the package a name.' using errcode = '22023'; end if;
  if coalesce(array_length(p_test_ids, 1), 0) = 0 then raise exception 'Add at least one test to the package.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_test_ids) t where not exists (select 1 from lab_tests lt where lt.id = t and lt.business_id = p_business)) then
    raise exception 'A test in this package is not one of this lab''s.' using errcode = 'P0002';
  end if;
  if v_id is null then
    insert into lab_packages (business_id, name, description, price)
    values (p_business, btrim(p_package->>'name'), nullif(btrim(coalesce(p_package->>'description','')), ''),
            coalesce(nullif(p_package->>'price','')::numeric, 0))
    returning id into v_id;
  else
    update lab_packages set name = btrim(p_package->>'name'),
           description = nullif(btrim(coalesce(p_package->>'description','')), ''),
           price = coalesce(nullif(p_package->>'price','')::numeric, price),
           is_active = coalesce((p_package->>'is_active')::boolean, is_active)
     where id = v_id and business_id = p_business;
    if not found then raise exception 'No such package at this lab.' using errcode = 'P0002'; end if;
    delete from lab_package_tests where package_id = v_id;
  end if;
  insert into lab_package_tests (package_id, test_id) select v_id, t from unnest(p_test_ids) t on conflict do nothing;
  return v_id;
exception when unique_violation then
  raise exception 'This lab already has a package with that name.' using errcode = '23505';
end $$;
revoke all on function sehat_lab_save_package(uuid, jsonb, uuid[]) from public, anon;
grant execute on function sehat_lab_save_package(uuid, jsonb, uuid[]) to authenticated;


-- ============================================================================
-- 5. Orders
-- ============================================================================

create or replace function sehat_lab_next_number(p_business uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare v_fy text := sehat_financial_year(current_date); v_n integer;
begin
  insert into lab_counters (business_id, kind, fy) values (p_business, p_kind, v_fy) on conflict do nothing;
  update lab_counters set last_number = last_number + 1
   where business_id = p_business and kind = p_kind and fy = v_fy returning last_number into v_n;
  return case p_kind when 'order' then 'LAB/' else 'LR/' end || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;
revoke all on function sehat_lab_next_number(uuid, text) from public, anon, authenticated;

-- Tests and packages for one patient. Each package and each single test is
-- one charge on the patient's account (category 'lab'), so it shows on their
-- bill like everything else; a test already inside a chosen package is not
-- charged or run twice.
create or replace function sehat_lab_create_order(
  p_business uuid, p_member uuid,
  p_test_ids uuid[] default '{}', p_package_ids uuid[] default '{}',
  p_visit_id uuid default null, p_collection text default 'lab', p_address text default null,
  p_priority text default 'routine', p_notes text default null, p_referred_by text default null,
  p_slot timestamptz default null, p_home_fee numeric default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_order uuid; v_role text := sehat_caller_role(p_business); v_me uuid := sehat_caller_practitioner_id();
  pk record; t record; v_seen uuid[] := '{}'; i integer := 0; v_name text := sehat_lab_staff_name(p_business);
begin
  perform sehat_lab_check(p_business, 'staff');
  if coalesce(array_length(p_test_ids,1),0) + coalesce(array_length(p_package_ids,1),0) = 0 then
    raise exception 'Choose at least one test or package.' using errcode = '22023';
  end if;
  if not exists (select 1 from business_patients bp where bp.business_id = p_business and bp.patient_member_id = p_member) then
    raise exception 'Register the patient at this lab first.' using errcode = 'P0002';
  end if;
  if p_collection = 'home' and btrim(coalesce(p_address,'')) = '' then
    raise exception 'Give the address for home collection.' using errcode = '22023';
  end if;
  if p_visit_id is not null and not exists (select 1 from patient_visits v where v.id = p_visit_id and v.business_id = p_business and v.patient_member_id = p_member) then
    raise exception 'That visit is not this patient''s here.' using errcode = 'P0002';
  end if;

  insert into lab_orders (business_id, order_no, patient_member_id, visit_id, source, ordered_by, ordered_by_name, referred_by,
                          collection, collection_address, collection_slot, home_fee, priority, notes, created_by, created_by_name)
  values (p_business, sehat_lab_next_number(p_business, 'order'), p_member, p_visit_id,
          case when v_role = 'doctor' then 'doctor' else 'desk' end,
          case when v_role in ('doctor','owner') then v_me end,
          case when v_role in ('doctor','owner') then v_name end,
          nullif(btrim(coalesce(p_referred_by,'')), ''),
          case when p_collection = 'home' then 'home' else 'lab' end, nullif(btrim(coalesce(p_address,'')), ''),
          case when p_collection = 'home' then p_slot end,
          case when p_collection = 'home'
               then greatest(coalesce(p_home_fee, (select lab_home_fee from businesses where id = p_business), 0), 0) else 0 end,
          case when p_priority = 'urgent' then 'urgent' else 'routine' end, nullif(btrim(coalesce(p_notes,'')), ''),
          auth.uid(), v_name)
  returning id into v_order;

  for pk in select * from lab_packages where id = any(coalesce(p_package_ids,'{}')) and business_id = p_business and is_active loop
    insert into patient_charges (business_id, patient_member_id, visit_id, category, description, quantity, unit_price, amount, recorded_by)
    values (p_business, p_member, p_visit_id, 'lab', 'Lab package: ' || pk.name || ' (' || (select order_no from lab_orders where id = v_order) || ')',
            1, pk.price, pk.price, v_me);
    for t in select lt.* from lab_package_tests x join lab_tests lt on lt.id = x.test_id where x.package_id = pk.id order by lt.name loop
      continue when t.id = any(v_seen);
      insert into lab_order_items (order_id, test_id, package_id, package_name, name, category, department, report_kind, sort_order)
      values (v_order, t.id, pk.id, pk.name, t.name, t.category, t.department, t.report_kind, i);
      v_seen := v_seen || t.id; i := i + 1;
    end loop;
  end loop;

  for t in select * from lab_tests where id = any(coalesce(p_test_ids,'{}')) and business_id = p_business and is_active order by name loop
    continue when t.id = any(v_seen);
    insert into patient_charges (business_id, patient_member_id, visit_id, category, description, quantity, unit_price, amount, recorded_by)
    values (p_business, p_member, p_visit_id, 'lab', 'Lab: ' || t.name || ' (' || (select order_no from lab_orders where id = v_order) || ')',
            1, t.price, t.price, v_me);
    insert into lab_order_items (order_id, test_id, name, category, department, report_kind, sort_order)
    values (v_order, t.id, t.name, t.category, t.department, t.report_kind, i);
    v_seen := v_seen || t.id; i := i + 1;
  end loop;

  if i = 0 then raise exception 'None of those tests are active at this lab.' using errcode = 'P0001'; end if;

  -- The home visit is its own line on the bill.
  insert into patient_charges (business_id, patient_member_id, visit_id, category, description, quantity, unit_price, amount, recorded_by)
  select p_business, p_member, p_visit_id, 'lab', 'Home sample collection (' || o.order_no || ')', 1, o.home_fee, o.home_fee, v_me
    from lab_orders o where o.id = v_order and o.home_fee > 0;
  return v_order;
end $$;
revoke all on function sehat_lab_create_order(uuid, uuid, uuid[], uuid[], uuid, text, text, text, text, text, timestamptz, numeric) from public, anon;
grant execute on function sehat_lab_create_order(uuid, uuid, uuid[], uuid[], uuid, text, text, text, text, text, timestamptz, numeric) to authenticated;

-- Who goes to the patient's home, and when.
create or replace function sehat_lab_assign_collector(p_order uuid, p_collector uuid, p_slot timestamptz default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o record;
begin
  select * into o from lab_orders where id = p_order for update;
  if not found then raise exception 'No such order.' using errcode = 'P0002'; end if;
  perform sehat_lab_check(o.business_id, 'staff');
  if o.collection <> 'home' then raise exception 'This order is collected at the lab.' using errcode = 'P0001'; end if;
  if p_collector is not null and not exists (select 1 from business_practitioners bp
       where bp.business_id = o.business_id and bp.practitioner_id = p_collector and bp.status <> 'suspended') then
    raise exception 'That person is not on this lab''s staff.' using errcode = 'P0002';
  end if;
  update lab_orders set collector_id = p_collector,
         collector_name = (select full_name from practitioners where id = p_collector),
         collection_slot = coalesce(p_slot, collection_slot)
   where id = p_order;
end $$;
revoke all on function sehat_lab_assign_collector(uuid, uuid, timestamptz) from public, anon;
grant execute on function sehat_lab_assign_collector(uuid, uuid, timestamptz) to authenticated;

-- The lab's usual home-collection fee. Owner or manager.
create or replace function sehat_lab_settings(p_business uuid, p_home_fee numeric)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform sehat_lab_check(p_business, 'manage');
  update businesses set lab_home_fee = greatest(coalesce(p_home_fee, 0), 0) where id = p_business;
end $$;
revoke all on function sehat_lab_settings(uuid, numeric) from public, anon;
grant execute on function sehat_lab_settings(uuid, numeric) to authenticated;

create or replace function sehat_lab_mark_collected(p_order uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o record;
begin
  select * into o from lab_orders where id = p_order for update;
  if not found then raise exception 'No such order.' using errcode = 'P0002'; end if;
  perform sehat_lab_check(o.business_id, 'staff');
  if o.status <> 'ordered' then return; end if;
  update lab_orders set status = 'collected', collected_at = now(), collected_by_name = sehat_lab_staff_name(o.business_id)
   where id = p_order;
end $$;
revoke all on function sehat_lab_mark_collected(uuid) from public, anon;
grant execute on function sehat_lab_mark_collected(uuid) to authenticated;

-- Unbilled charges go with the order; a billed one means the bill is cancelled first.
create or replace function sehat_lab_cancel_order(p_order uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare o record;
begin
  select * into o from lab_orders where id = p_order for update;
  if not found then raise exception 'No such order.' using errcode = 'P0002'; end if;
  perform sehat_lab_check(o.business_id, 'manage');
  if o.status in ('reported','cancelled') or exists (select 1 from lab_reports r where r.order_id = p_order) then
    raise exception 'A report has already gone out on this order, so it cannot be cancelled.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'Say why the order is being cancelled.' using errcode = '22023'; end if;
  if exists (select 1 from patient_charges c where c.business_id = o.business_id and c.patient_member_id = o.patient_member_id
              and c.category = 'lab' and c.description like '%(' || o.order_no || ')' and c.bill_id is not null) then
    raise exception 'This order is already on a bill — cancel the bill first.' using errcode = 'P0001';
  end if;
  delete from patient_charges c where c.business_id = o.business_id and c.patient_member_id = o.patient_member_id
     and c.category = 'lab' and c.description like '%(' || o.order_no || ')' and c.bill_id is null;
  update lab_orders set status = 'cancelled', cancelled_reason = btrim(p_reason) where id = p_order;
end $$;
revoke all on function sehat_lab_cancel_order(uuid, text) from public, anon;
grant execute on function sehat_lab_cancel_order(uuid, text) to authenticated;


-- ============================================================================
-- 6. Results
-- ============================================================================

-- p_values: [{parameter_id, value}]. Numbers are flagged L/H/N against the
-- range for the patient's sex (the female range where one is set), and the
-- range used is copied onto the result so the report never changes under it.
create or replace function sehat_lab_save_results(p_item uuid, p_values jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  it record; o record; v_female boolean; p record; v jsonb; v_raw text; v_num numeric; v_lo numeric; v_hi numeric; v_flag text;
begin
  select * into it from lab_order_items where id = p_item for update;
  if not found then raise exception 'No such test on an order.' using errcode = 'P0002'; end if;
  select * into o from lab_orders where id = it.order_id for update;
  perform sehat_lab_check(o.business_id, 'results');
  if o.status = 'cancelled' then raise exception 'This order was cancelled.' using errcode = 'P0001'; end if;
  if it.status = 'approved' then raise exception 'This result is approved — it can no longer be changed.' using errcode = 'P0001'; end if;
  select pm.gender = 'female' into v_female from patient_members pm where pm.id = o.patient_member_id;

  for p in select * from lab_test_parameters where test_id = it.test_id order by sort_order loop
    select x into v from jsonb_array_elements(coalesce(p_values,'[]'::jsonb)) x where x->>'parameter_id' = p.id::text limit 1;
    v_raw := nullif(btrim(coalesce(v->>'value','')), '');
    if v_raw is null then
      delete from lab_results where order_item_id = p_item and parameter_id = p.id;
      continue;
    end if;
    v_num := null; v_flag := null;
    v_lo := case when v_female and (p.ref_low_f is not null or p.ref_high_f is not null) then p.ref_low_f else p.ref_low end;
    v_hi := case when v_female and (p.ref_low_f is not null or p.ref_high_f is not null) then p.ref_high_f else p.ref_high end;
    if p.kind = 'number' then
      begin v_num := v_raw::numeric;
      exception when others then raise exception '%: "%" is not a number.', p.name, v_raw using errcode = '22023';
      end;
      v_flag := case when v_lo is not null and v_num < v_lo then 'L'
                     when v_hi is not null and v_num > v_hi then 'H'
                     when v_lo is not null or v_hi is not null then 'N' end;
    end if;
    insert into lab_results (order_item_id, parameter_id, name, unit, kind, value_num, value_text, ref_low, ref_high, ref_text, flag, sort_order)
    values (p_item, p.id, p.name, p.unit, p.kind, v_num, case when p.kind = 'number' then null else v_raw end,
            v_lo, v_hi, p.ref_text, v_flag, p.sort_order)
    on conflict (order_item_id, parameter_id) do update set
      value_num = excluded.value_num, value_text = excluded.value_text, ref_low = excluded.ref_low,
      ref_high = excluded.ref_high, ref_text = excluded.ref_text, flag = excluded.flag, name = excluded.name, unit = excluded.unit;
  end loop;

  update lab_order_items set
    status = case when exists (select 1 from lab_results r where r.order_item_id = p_item) then 'entered' else 'pending' end,
    entered_by_name = sehat_lab_staff_name(o.business_id), entered_at = now()
   where id = p_item;
  update lab_orders set status = case
      when not exists (select 1 from lab_order_items i where i.order_id = o.id and i.status = 'pending') then 'ready'
      else 'in_progress' end
   where id = o.id and status not in ('reported','cancelled');
end $$;
revoke all on function sehat_lab_save_results(uuid, jsonb) from public, anon;
grant execute on function sehat_lab_save_results(uuid, jsonb) to authenticated;

-- The signing doctor approves everything entered; a report is numbered and
-- its link made. Anything still pending stays open and is reported later as
-- a new version.
create or replace function sehat_lab_approve(p_order uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare o record; v_rep uuid; v_token uuid; v_ver integer; v_me uuid := sehat_caller_practitioner_id(); v_qual text; v_name text;
begin
  select * into o from lab_orders where id = p_order for update;
  if not found then raise exception 'No such order.' using errcode = 'P0002'; end if;
  perform sehat_lab_check(o.business_id, 'approve');
  if not exists (select 1 from lab_order_items where order_id = p_order and status = 'entered') then
    raise exception 'Nothing new to approve — enter results first.' using errcode = 'P0001';
  end if;
  select p.full_name, p.qualification into v_name, v_qual from practitioners p where p.id = v_me;
  v_name := coalesce(v_name, sehat_lab_staff_name(o.business_id));
  update lab_order_items set status = 'approved' where order_id = p_order and status = 'entered';
  select coalesce(max(version), 0) + 1 into v_ver from lab_reports where order_id = p_order;
  insert into lab_reports (order_id, business_id, report_no, version, approved_by, approved_by_name, approved_by_qualification)
  values (p_order, o.business_id, sehat_lab_next_number(o.business_id, 'report'), v_ver, v_me, v_name, v_qual)
  returning id, public_token into v_rep, v_token;
  update lab_orders set status = case when exists (select 1 from lab_order_items where order_id = p_order and status = 'pending')
                                      then 'in_progress' else 'reported' end,
         reported_at = now()
   where id = p_order;
  return jsonb_build_object('report_id', v_rep, 'token', v_token, 'version', v_ver);
end $$;
revoke all on function sehat_lab_approve(uuid) from public, anon;
grant execute on function sehat_lab_approve(uuid) to authenticated;


-- ============================================================================
-- 7. What screens read
-- ============================================================================

create or replace view lab_order_detail with (security_invoker = true) as
  select o.*,
         pm.full_name as patient_name, pm.age_years as patient_age, pm.gender as patient_gender, pa.phone as patient_phone,
         bp.mrn,
         (select count(*) from lab_order_items i where i.order_id = o.id)::integer as item_count,
         (select count(*) from lab_order_items i where i.order_id = o.id and i.status = 'pending')::integer as pending_count,
         (select count(*) from lab_order_items i where i.order_id = o.id and i.status = 'entered')::integer as entered_count,
         coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'package_name', i.package_name, 'status', i.status,
                                                       'report_kind', i.report_kind, 'test_id', i.test_id, 'category', i.category) order by i.sort_order)
                     from lab_order_items i where i.order_id = o.id), '[]'::jsonb) as items,
         (select jsonb_build_object('id', r.id, 'report_no', r.report_no, 'version', r.version, 'token', r.public_token,
                                    'approved_by_name', r.approved_by_name, 'approved_at', r.approved_at,
                                    'sent_at', r.sent_at, 'sent_channels', r.sent_channels, 'send_error', r.send_error)
            from lab_reports r where r.order_id = o.id order by r.version desc limit 1) as latest_report
    from lab_orders o
    join patient_members pm on pm.id = o.patient_member_id
    join patients pa on pa.id = pm.patient_id
    left join business_patients bp on bp.business_id = o.business_id and bp.patient_member_id = o.patient_member_id;
grant select on lab_order_detail to authenticated;

-- The patient's report, by its link. Approved results only, with the lab's
-- letterhead details and who signed. 410-equivalent when expired.
create or replace function sehat_lab_report_public(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; o record; b record; pm record;
begin
  select * into r from lab_reports where public_token = p_token;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if r.token_expires_at < now() then return jsonb_build_object('error', 'expired'); end if;
  select * into o from lab_orders where id = r.order_id;
  select name, address, phone, letterhead_url, reg_number into b from businesses where id = o.business_id;
  select mm.full_name, mm.age_years, mm.gender into pm from patient_members mm where mm.id = o.patient_member_id;
  return jsonb_build_object(
    'report_no', r.report_no, 'version', r.version, 'approved_at', r.approved_at,
    'approved_by_name', r.approved_by_name, 'approved_by_qualification', r.approved_by_qualification,
    'lab', jsonb_build_object('name', b.name, 'address', b.address, 'phone', b.phone, 'letterhead_url', b.letterhead_url, 'reg_number', b.reg_number),
    'patient', jsonb_build_object('name', pm.full_name, 'age', pm.age_years, 'gender', pm.gender),
    'order', jsonb_build_object('order_no', o.order_no, 'created_at', o.created_at, 'collected_at', o.collected_at,
                                'referred_by', coalesce(o.referred_by, o.ordered_by_name)),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'name', i.name, 'department', i.department, 'report_kind', i.report_kind,
                'results', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'unit', x.unit, 'kind', x.kind,
                                        'value', coalesce(x.value_text, x.value_num::text), 'flag', x.flag,
                                        'ref_low', x.ref_low, 'ref_high', x.ref_high, 'ref_text', x.ref_text) order by x.sort_order)
                                     from lab_results x where x.order_item_id = i.id), '[]'::jsonb)) order by i.sort_order)
              from lab_order_items i where i.order_id = o.id and i.status = 'approved'), '[]'::jsonb)
  );
end $$;
revoke all on function sehat_lab_report_public(uuid) from public;
grant execute on function sehat_lab_report_public(uuid) to anon, authenticated;


-- ============================================================================
-- 8. RLS
-- ============================================================================

alter table lab_catalogue enable row level security;
drop policy if exists "anyone_reads_lab_catalogue" on lab_catalogue;
create policy "anyone_reads_lab_catalogue" on lab_catalogue for select using (true);
grant select on lab_catalogue to authenticated;

do $$
declare t text;
begin
  foreach t in array array['lab_tests','lab_packages','lab_orders','lab_reports','lab_counters'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "clinic_reads_%1$s" on %1$I', t);
    execute format('create policy "clinic_reads_%1$s" on %1$I for select using (sehat_caller_owns_business(business_id))', t);
  end loop;
end $$;

alter table lab_test_parameters enable row level security;
drop policy if exists "clinic_reads_lab_test_parameters" on lab_test_parameters;
create policy "clinic_reads_lab_test_parameters" on lab_test_parameters for select
  using (exists (select 1 from lab_tests t where t.id = test_id and sehat_caller_owns_business(t.business_id)));

alter table lab_package_tests enable row level security;
drop policy if exists "clinic_reads_lab_package_tests" on lab_package_tests;
create policy "clinic_reads_lab_package_tests" on lab_package_tests for select
  using (exists (select 1 from lab_packages p where p.id = package_id and sehat_caller_owns_business(p.business_id)));

alter table lab_order_items enable row level security;
drop policy if exists "clinic_reads_lab_order_items" on lab_order_items;
create policy "clinic_reads_lab_order_items" on lab_order_items for select
  using (exists (select 1 from lab_orders o where o.id = order_id and sehat_caller_owns_business(o.business_id)));

-- The values themselves: clinical roles only. Reception sees the order, not the result.
alter table lab_results enable row level security;
drop policy if exists "clinic_reads_lab_results" on lab_results;
create policy "clinic_reads_lab_results" on lab_results for select
  using (exists (select 1 from lab_order_items i join lab_orders o on o.id = i.order_id
                  where i.id = order_item_id and sehat_lab_reads_results(o.business_id)));

grant select on lab_tests, lab_test_parameters, lab_packages, lab_package_tests, lab_orders, lab_order_items,
                lab_results, lab_reports, lab_counters to authenticated;
revoke insert, update, delete on lab_catalogue, lab_tests, lab_test_parameters, lab_packages, lab_package_tests,
                lab_orders, lab_order_items, lab_results, lab_reports, lab_counters from anon, authenticated;

notify pgrst, 'reload schema';

-- ── NOT HERE ────────────────────────────────────────────────────────────────
-- • Ordering from a DIFFERENT business's lab (a clinic sending samples to a
--   standalone lab). Doctors order into their own clinic's lab.
-- • Machine interfacing (analysers writing results directly).
-- • Report PDFs: the report is a link that renders and prints on any phone.
