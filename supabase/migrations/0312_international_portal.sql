-- ============================================================================
-- 0312 — Sehatsandhi International: patients from abroad, hospitals in all cities
-- ============================================================================
-- AFTER 0311. Safe to re-run.
--
-- Decided 3 Nov 2026 (plan doc "Sehatsandhi International: Hospital Eligibility
-- and Patient Checklists"). Patients from abroad compare hospitals in every
-- city in India by procedure, see an estimate, shortlist up to three and ask
-- for real quotes. Sehatsandhi arranges travel and every quote goes through
-- us. Joining is free for a hospital; the patient sees the hospital's price
-- plus our fee (10%, site_settings 'intl_fee_pct'), and the page says so.
--
-- Only hospitals with a proper IPD can apply. A hospital's listing opens on the
-- portal only after Sehatsandhi has checked its documents and video walkthrough
-- and the hospital has accepted the agreement.
--
--   intl_procedures    the procedures patients pick from, with how complex
--                      each is (routine / major / complex / very complex);
--                      that group drives the "which size of city" suggestion.
--   intl_city_levels   big metro / regional city by city name; any city not
--                      listed is a smaller city. An admin can override per
--                      hospital.
--   intl_hospitals     one per applying hospital: facts patients see,
--                      the checklist (ticks + uploaded documents + expiry),
--                      the agreement acceptance, and the review status.
--   intl_packages      the hospital's rough price per procedure, with what is
--                      in and out, days in hospital and in India, and a date
--                      the price is good until (6 months by default).
--   intl_enquiries     a patient's request for quotes, with the hospitals they
--                      shortlisted, consent and the estimate acknowledgment.
--
-- Public reads go through sehat_intl_catalogue(), which returns only listed
-- hospitals and only the price the patient pays — never the hospital's own.
-- Hospitals (owner and manager) write through RPCs; they cannot set their own
-- status, star level or city level. Admins review in the admin International tab.
-- ============================================================================

-- ── Settings ────────────────────────────────────────────────────────────────
insert into site_settings (key, value) values ('intl_fee_pct', '10')
on conflict (key) do nothing;
-- Rupees per one unit of each currency, set by an admin; {} = show rupees only.
insert into site_settings (key, value) values ('intl_fx', '{}')
on conflict (key) do nothing;

-- ── Reference: procedures ───────────────────────────────────────────────────
create table if not exists intl_procedures (
  code text primary key,
  name text not null,
  speciality text not null,
  grp text not null check (grp in ('routine', 'major', 'complex', 'very_complex')),
  -- Typical figures for the information pages; each hospital gives its own.
  hospital_days integer,
  india_days integer,
  summary text,
  reports text,
  sort integer not null default 100,
  active boolean not null default true
);

insert into intl_procedures (code, name, speciality, grp, hospital_days, india_days, summary, reports, sort) values
  ('cataract', 'Cataract surgery (one eye)', 'Eye', 'routine', 0, 6,
   'The cloudy natural lens is replaced with a clear artificial lens through a small cut. Usually a day-care procedure.',
   'Recent eye examination, any eye scans, list of medicines, blood sugar and blood pressure readings', 10),
  ('lasik', 'LASIK / laser vision correction', 'Eye', 'routine', 0, 4,
   'A laser reshapes the front of the eye to reduce dependence on glasses.',
   'Current glasses or lens prescription, any previous eye reports', 20),
  ('glaucoma', 'Glaucoma surgery', 'Eye', 'routine', 1, 8,
   'Surgery to lower eye pressure when drops are not enough.',
   'Eye pressure readings, visual field test, OCT scan, current eye drops', 30),
  ('dental_implant', 'Dental implants', 'Dental', 'routine', 0, 8,
   'A titanium post replaces a missing tooth root and holds a crown. Some cases need a second visit.',
   'Dental X-ray or CBCT scan if you have one, photos of your teeth, medical history', 40),
  ('dental_smile', 'Crowns, bridges and root canal', 'Dental', 'routine', 0, 6,
   'Restoring damaged teeth with root canal treatment, crowns or bridges.',
   'Dental X-ray if you have one, photos of your teeth', 50),
  ('hernia', 'Hernia repair', 'General surgery', 'routine', 2, 8,
   'Repair of a hernia with a mesh, usually by keyhole (laparoscopic) surgery.',
   'Ultrasound report if done, blood tests, list of medicines', 60),
  ('gallbladder', 'Gallbladder removal', 'General surgery', 'routine', 2, 8,
   'Keyhole removal of the gallbladder, usually for gallstones.',
   'Abdominal ultrasound, liver function tests, list of medicines', 70),
  ('piles', 'Piles, fissure or fistula treatment', 'General surgery', 'routine', 1, 7,
   'Laser or surgical treatment for piles, fissure or fistula.',
   'Doctor''s notes, any scans, list of medicines', 80),
  ('kidney_stone', 'Kidney stone treatment', 'Urology', 'routine', 2, 8,
   'Removal or breaking of kidney stones, often by laser through natural passages.',
   'CT scan or ultrasound of kidneys, kidney function tests, urine test', 90),
  ('varicose', 'Varicose vein treatment', 'Vascular', 'routine', 1, 7,
   'Laser or radio-frequency closure of swollen leg veins.',
   'Doppler ultrasound of the legs if done', 100),
  ('ent_sinus', 'Sinus, nose or tonsil surgery', 'ENT', 'routine', 1, 8,
   'Endoscopic sinus surgery, septoplasty or tonsil removal.',
   'CT scan of sinuses if done, ENT doctor''s notes', 110),
  ('health_checkup', 'Full body health check-up', 'Preventive', 'routine', 0, 3,
   'A day of tests and consultations, with reports explained the same or next day.',
   'Previous reports, list of medicines', 120),
  ('knee_replacement', 'Knee replacement (one knee)', 'Orthopaedics', 'major', 5, 21,
   'The worn knee joint surfaces are replaced with an implant. Physiotherapy starts the next day.',
   'Standing X-ray of the knee, blood tests, ECG, list of medicines', 200),
  ('hip_replacement', 'Hip replacement', 'Orthopaedics', 'major', 5, 21,
   'The damaged hip joint is replaced with an implant.',
   'X-ray of the pelvis and hip, blood tests, ECG, list of medicines', 210),
  ('shoulder_arthroscopy', 'Shoulder or knee arthroscopy', 'Orthopaedics', 'major', 2, 10,
   'Keyhole repair inside a joint, for example a ligament or cartilage tear.',
   'MRI of the joint, doctor''s notes', 220),
  ('spine_disc', 'Slip disc surgery', 'Spine', 'major', 4, 14,
   'Removal of the part of a disc pressing on a nerve, often by keyhole surgery.',
   'MRI of the spine, nerve test if done, doctor''s notes', 230),
  ('hysterectomy', 'Hysterectomy', 'Gynaecology', 'major', 3, 12,
   'Removal of the uterus, often by keyhole surgery.',
   'Pelvic ultrasound, Pap test if done, blood tests', 240),
  ('ivf', 'IVF and fertility treatment', 'Fertility', 'major', 0, 21,
   'Eggs are fertilised in a laboratory and an embryo is placed in the uterus. One cycle takes about 3 weeks.',
   'Hormone tests (AMH, FSH), semen analysis, previous treatment records', 250),
  ('angioplasty', 'Angioplasty with stent', 'Cardiology', 'major', 3, 8,
   'A narrowed heart artery is opened with a balloon and a stent.',
   'Angiography report or CD, ECG, echo, blood tests', 260),
  ('prostate', 'Prostate surgery (TURP or laser)', 'Urology', 'major', 3, 10,
   'Removal of the part of an enlarged prostate blocking urine flow.',
   'PSA test, ultrasound, urine flow test if done', 270),
  ('thyroid', 'Thyroid surgery', 'ENT / Endocrine', 'major', 3, 10,
   'Removal of part or all of the thyroid gland.',
   'Thyroid ultrasound, thyroid function tests, FNAC report if done', 280),
  ('bariatric', 'Weight-loss (bariatric) surgery', 'General surgery', 'major', 3, 14,
   'Keyhole surgery on the stomach to help long-term weight loss.',
   'Weight and height, blood tests, sleep study if done, list of medicines', 290),
  ('heart_bypass', 'Heart bypass surgery (CABG)', 'Cardiac surgery', 'complex', 7, 21,
   'Blocked heart arteries are bypassed using blood vessels from elsewhere in the body.',
   'Angiography report or CD, echo, ECG, blood tests, list of medicines', 300),
  ('heart_valve', 'Heart valve replacement', 'Cardiac surgery', 'complex', 8, 24,
   'A damaged heart valve is repaired or replaced.',
   'Echo report, angiography if done, ECG, blood tests', 310),
  ('spine_fusion', 'Spinal fusion', 'Spine', 'complex', 6, 21,
   'Two or more bones of the spine are joined to stop painful movement or correct shape.',
   'MRI and X-rays of the spine, CT if done, doctor''s notes', 320),
  ('brain_tumour', 'Brain tumour surgery', 'Neurosurgery', 'complex', 8, 25,
   'Removal of a tumour in or around the brain by a neurosurgical team.',
   'MRI of the brain with contrast, biopsy report if done, doctor''s notes', 330),
  ('cancer_surgery', 'Cancer surgery', 'Oncology', 'complex', 7, 25,
   'Removal of a tumour, planned with medical and radiation cancer specialists.',
   'Biopsy report, PET-CT or CT scan, blood tests, treatment history', 340),
  ('kidney_transplant', 'Kidney transplant', 'Transplant', 'very_complex', 10, 45,
   'A kidney from a related living donor replaces a failed kidney. Needs government approvals for foreign nationals.',
   'Kidney function tests, dialysis records, donor''s details and relationship proof', 400),
  ('liver_transplant', 'Liver transplant', 'Transplant', 'very_complex', 21, 60,
   'Part of a liver from a related living donor replaces a failed liver. Needs government approvals for foreign nationals.',
   'Liver function tests, CT or MRI of the liver, donor''s details and relationship proof', 410),
  ('bone_marrow', 'Bone marrow transplant', 'Haematology', 'very_complex', 30, 90,
   'Healthy stem cells replace diseased bone marrow, for some blood cancers and disorders.',
   'Bone marrow biopsy, blood counts, HLA typing of patient and donor if done', 420),
  ('child_heart', 'Children''s heart surgery', 'Paediatric cardiac', 'very_complex', 10, 30,
   'Surgery to correct a heart defect a child is born with.',
   'Echo report, any angiography or CT, child''s weight and medicines', 430)
on conflict (code) do update set
  name = excluded.name, speciality = excluded.speciality, grp = excluded.grp,
  hospital_days = excluded.hospital_days, india_days = excluded.india_days,
  summary = excluded.summary, reports = excluded.reports, sort = excluded.sort;

-- ── Reference: city levels ──────────────────────────────────────────────────
create table if not exists intl_city_levels (
  city text primary key check (city = lower(btrim(city))),
  level text not null check (level in ('metro', 'regional'))
);
insert into intl_city_levels (city, level) values
  ('delhi', 'metro'), ('new delhi', 'metro'), ('mumbai', 'metro'), ('navi mumbai', 'metro'), ('thane', 'metro'),
  ('bengaluru', 'metro'), ('bangalore', 'metro'), ('chennai', 'metro'), ('hyderabad', 'metro'),
  ('kolkata', 'metro'), ('pune', 'metro'), ('ahmedabad', 'metro'), ('gurugram', 'metro'), ('gurgaon', 'metro'),
  ('noida', 'metro'), ('greater noida', 'metro'), ('faridabad', 'metro'), ('ghaziabad', 'metro'),
  ('chandigarh', 'regional'), ('mohali', 'regional'), ('sas nagar', 'regional'), ('panchkula', 'regional'),
  ('dehradun', 'regional'), ('jaipur', 'regional'), ('lucknow', 'regional'), ('ludhiana', 'regional'),
  ('amritsar', 'regional'), ('jalandhar', 'regional'), ('kochi', 'regional'), ('coimbatore', 'regional'),
  ('indore', 'regional'), ('nagpur', 'regional'), ('bhopal', 'regional'), ('vadodara', 'regional'),
  ('surat', 'regional'), ('visakhapatnam', 'regional'), ('bhubaneswar', 'regional'), ('patna', 'regional'),
  ('kanpur', 'regional'), ('mysuru', 'regional'), ('madurai', 'regional'), ('thiruvananthapuram', 'regional'),
  ('guwahati', 'regional'), ('raipur', 'regional'), ('ranchi', 'regional'), ('varanasi', 'regional'),
  ('meerut', 'regional'), ('agra', 'regional')
on conflict (city) do update set level = excluded.level;

create or replace function sehat_intl_city_level(p_city text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select level from intl_city_levels where city = lower(btrim(coalesce(p_city, '')))), 'smaller')
$$;

alter table intl_procedures enable row level security;
alter table intl_city_levels enable row level security;
drop policy if exists intl_procedures_read on intl_procedures;
create policy intl_procedures_read on intl_procedures for select using (true);
drop policy if exists intl_city_levels_read on intl_city_levels;
create policy intl_city_levels_read on intl_city_levels for select using (true);
revoke insert, update, delete on intl_procedures, intl_city_levels from anon, authenticated;
grant select on intl_procedures, intl_city_levels to anon, authenticated;

-- ── Hospitals ───────────────────────────────────────────────────────────────
create table if not exists intl_hospitals (
  business_id uuid primary key references businesses(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'reviewing', 'listed', 'paused', 'rejected')),
  -- Set by an admin on review; null = derive from the city.
  city_level text check (city_level in ('metro', 'regional', 'smaller')),
  star text check (star in ('4', '5')),
  -- What the hospital says; checked against its documents.
  nabh text not null default 'none' check (nabh in ('full', 'entry', 'applied', 'none')),
  jci boolean not null default false,
  beds integer check (beds between 0 and 5000),
  icu_beds integer check (icu_beds between 0 and 1000),
  panels text[] not null default '{}',
  languages text[] not null default '{English,Hindi}',
  specialities text[] not null default '{}',
  about text,
  coordinator_name text,
  coordinator_phone text,
  coordinator_email text,
  nearest_airport text,
  airport_hours numeric(4,1) check (airport_hours between 0 and 48),
  -- { "<item key>": { "ok": bool, "doc": "<storage path>", "expires": "YYYY-MM-DD", "note": "…" } }
  checklist jsonb not null default '{}'::jsonb,
  agreement_version text,
  agreement_signatory text,
  agreement_accepted_at timestamptz,
  agreement_accepted_by uuid,
  submitted_at timestamptz,
  docs_checked_at timestamptz,
  video_checked_at timestamptz,
  listed_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists intl_packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references intl_hospitals(business_id) on delete cascade,
  procedure_code text not null references intl_procedures(code),
  -- The hospital's own price in rupees. Never sent to the public as it is.
  price_min integer not null check (price_min > 0),
  price_max integer not null,
  room_type text,
  included text,
  excluded text,
  hospital_days integer check (hospital_days between 0 and 120),
  india_days integer check (india_days between 0 and 180),
  fly_after_days integer check (fly_after_days between 0 and 120),
  doctor_name text,
  notes text,
  valid_until date not null default (current_date + 180),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (business_id, procedure_code),
  check (price_max >= price_min)
);

create table if not exists intl_enquiries (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  name text not null,
  country text,
  phone text,
  email text,
  procedure_code text references intl_procedures(code),
  problem text,
  urgency text check (urgency in ('planned', 'soon', 'urgent')),
  travel_when text,
  companions integer check (companions between 0 and 2),
  budget text,
  prefs jsonb not null default '{}'::jsonb,
  shortlist uuid[] not null default '{}',
  chosen_hospital uuid references businesses(id) on delete set null,
  consent_share boolean not null default false,
  ack_estimate boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'reports', 'quotes', 'visa', 'travel', 'arrived', 'discharged', 'followup', 'closed', 'cancelled')),
  coordinator text,
  admin_note text,
  page text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intl_enquiries_created_idx on intl_enquiries (created_at desc);

alter table intl_hospitals enable row level security;
alter table intl_packages enable row level security;
alter table intl_enquiries enable row level security;

drop policy if exists intl_hospitals_read on intl_hospitals;
create policy intl_hospitals_read on intl_hospitals for select to authenticated
  using (sehat_is_admin() or sehat_is_staff() or sehat_caller_is_business(business_id));
drop policy if exists intl_packages_read on intl_packages;
create policy intl_packages_read on intl_packages for select to authenticated
  using (sehat_is_admin() or sehat_is_staff() or sehat_caller_is_business(business_id));
drop policy if exists intl_enquiries_read on intl_enquiries;
create policy intl_enquiries_read on intl_enquiries for select to authenticated
  using (sehat_is_admin() or sehat_is_staff());

revoke all on intl_hospitals, intl_packages, intl_enquiries from anon;
revoke insert, update, delete on intl_hospitals, intl_packages, intl_enquiries from authenticated;
grant select on intl_hospitals, intl_packages, intl_enquiries to authenticated;

-- ── Documents: private bucket, <business id>/<file> ─────────────────────────
insert into storage.buckets (id, name, public) values ('intl-docs', 'intl-docs', false)
on conflict (id) do nothing;
drop policy if exists intl_docs_read on storage.objects;
create policy intl_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'intl-docs'
    and (sehat_is_admin() or sehat_is_staff() or sehat_caller_is_business(nullif(split_part(name, '/', 1), '')::uuid)));
drop policy if exists intl_docs_write on storage.objects;
create policy intl_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'intl-docs'
    and (sehat_is_admin() or sehat_caller_is_business(nullif(split_part(name, '/', 1), '')::uuid)));
drop policy if exists intl_docs_delete on storage.objects;
create policy intl_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'intl-docs'
    and (sehat_is_admin() or sehat_caller_is_business(nullif(split_part(name, '/', 1), '')::uuid)));

-- ── Hospital side ───────────────────────────────────────────────────────────
-- Only places with in-patient beds can apply.
create or replace function sehat_intl_can_apply(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from businesses b where b.id = p_business
                  and (b.vertical = 'hospital' or coalesce(b.ipd_module, false)))
$$;

create or replace function sehat_intl_check(p_business uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_caller_is_business(p_business)) then
    raise exception 'Only the owner or a manager can do this.' using errcode = '42501';
  end if;
  if not sehat_intl_can_apply(p_business) then
    raise exception 'International patients are for hospitals with in-patient beds (IPD).' using errcode = 'P0001';
  end if;
end $$;
revoke all on function sehat_intl_check(uuid) from public, anon, authenticated;

-- Save the hospital's own details and checklist. Status, star and city level
-- are an admin's. A listed hospital that changes its checklist stays listed;
-- the admin sees the change in its review.
create or replace function sehat_intl_profile_save(p_business uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_nabh text := coalesce(p->>'nabh', 'none');
  v_check jsonb := coalesce(p->'checklist', '{}'::jsonb);
begin
  perform sehat_intl_check(p_business);
  if v_nabh not in ('full', 'entry', 'applied', 'none') then v_nabh := 'none'; end if;
  if jsonb_typeof(v_check) <> 'object' or length(v_check::text) > 40000 then
    raise exception 'The checklist could not be saved.' using errcode = '22023';
  end if;
  insert into intl_hospitals (business_id) values (p_business) on conflict (business_id) do nothing;
  update intl_hospitals set
    nabh = v_nabh,
    jci = coalesce((p->>'jci')::boolean, false),
    beds = nullif(p->>'beds', '')::integer,
    icu_beds = nullif(p->>'icu_beds', '')::integer,
    panels = coalesce(array(select left(btrim(x), 80) from jsonb_array_elements_text(coalesce(p->'panels', '[]')) x where btrim(x) <> '' limit 30), '{}'),
    languages = coalesce(array(select left(btrim(x), 40) from jsonb_array_elements_text(coalesce(p->'languages', '[]')) x where btrim(x) <> '' limit 20), '{}'),
    specialities = coalesce(array(select left(btrim(x), 80) from jsonb_array_elements_text(coalesce(p->'specialities', '[]')) x where btrim(x) <> '' limit 40), '{}'),
    about = nullif(left(btrim(coalesce(p->>'about', '')), 1500), ''),
    coordinator_name = nullif(left(btrim(coalesce(p->>'coordinator_name', '')), 120), ''),
    coordinator_phone = nullif(left(regexp_replace(coalesce(p->>'coordinator_phone', ''), '[^0-9+]', '', 'g'), 20), ''),
    coordinator_email = nullif(left(lower(btrim(coalesce(p->>'coordinator_email', ''))), 120), ''),
    nearest_airport = nullif(left(btrim(coalesce(p->>'nearest_airport', '')), 120), ''),
    airport_hours = nullif(p->>'airport_hours', '')::numeric,
    checklist = v_check,
    updated_at = now()
  where business_id = p_business;
end $$;

-- Accept the agreement (the signatory's name is typed in) and send for review.
create or replace function sehat_intl_submit(p_business uuid, p_signatory text, p_version text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare h intl_hospitals;
begin
  perform sehat_intl_check(p_business);
  select * into h from intl_hospitals where business_id = p_business;
  if h.business_id is null then raise exception 'Save your details first.' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_signatory, ''))) < 3 then
    raise exception 'Type the full name of the person accepting the agreement.' using errcode = '22023';
  end if;
  if h.coordinator_name is null or h.coordinator_phone is null then
    raise exception 'Add your international patient coordinator first.' using errcode = '22023';
  end if;
  if coalesce(h.beds, 0) < 1 then raise exception 'Add your number of beds first.' using errcode = '22023'; end if;
  update intl_hospitals set
    agreement_version = left(coalesce(p_version, 'v1'), 40),
    agreement_signatory = left(btrim(p_signatory), 120),
    agreement_accepted_at = now(),
    agreement_accepted_by = auth.uid(),
    status = case when status in ('draft', 'rejected') then 'submitted' else status end,
    submitted_at = case when status in ('draft', 'rejected') then now() else submitted_at end,
    updated_at = now()
  where business_id = p_business;
end $$;

create or replace function sehat_intl_package_save(p_business uuid, p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_min integer; v_max integer; v_valid date;
begin
  perform sehat_intl_check(p_business);
  if not exists (select 1 from intl_hospitals where business_id = p_business) then
    raise exception 'Save your hospital details first.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from intl_procedures where code = p->>'procedure_code' and active) then
    raise exception 'Choose a procedure from the list.' using errcode = '22023';
  end if;
  v_min := nullif(p->>'price_min', '')::integer;
  v_max := coalesce(nullif(p->>'price_max', '')::integer, v_min);
  if v_min is null or v_min < 1000 then raise exception 'Enter the lowest price in rupees.' using errcode = '22023'; end if;
  if v_max < v_min then raise exception 'The highest price cannot be below the lowest.' using errcode = '22023'; end if;
  if v_max > v_min * 4 then raise exception 'Keep the range close: the highest at most 4 times the lowest.' using errcode = '22023'; end if;
  -- A price is good for at most a year; 6 months when not given.
  v_valid := least(coalesce(nullif(p->>'valid_until', '')::date, current_date + 180), current_date + 365);
  if v_valid < current_date then raise exception 'The valid-until date has passed.' using errcode = '22023'; end if;

  insert into intl_packages (business_id, procedure_code, price_min, price_max, room_type, included, excluded,
                             hospital_days, india_days, fly_after_days, doctor_name, notes, valid_until, active, updated_at)
  values (p_business, p->>'procedure_code', v_min, v_max,
          nullif(left(btrim(coalesce(p->>'room_type', '')), 80), ''),
          nullif(left(btrim(coalesce(p->>'included', '')), 1500), ''),
          nullif(left(btrim(coalesce(p->>'excluded', '')), 1500), ''),
          nullif(p->>'hospital_days', '')::integer, nullif(p->>'india_days', '')::integer,
          nullif(p->>'fly_after_days', '')::integer,
          nullif(left(btrim(coalesce(p->>'doctor_name', '')), 120), ''),
          nullif(left(btrim(coalesce(p->>'notes', '')), 1000), ''),
          v_valid, coalesce((p->>'active')::boolean, true), now())
  on conflict (business_id, procedure_code) do update set
    price_min = excluded.price_min, price_max = excluded.price_max, room_type = excluded.room_type,
    included = excluded.included, excluded = excluded.excluded, hospital_days = excluded.hospital_days,
    india_days = excluded.india_days, fly_after_days = excluded.fly_after_days, doctor_name = excluded.doctor_name,
    notes = excluded.notes, valid_until = excluded.valid_until, active = excluded.active, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function sehat_intl_package_delete(p_business uuid, p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform sehat_intl_check(p_business);
  delete from intl_packages where id = p_id and business_id = p_business;
end $$;

-- ── Admin side ──────────────────────────────────────────────────────────────
create or replace function sehat_intl_admin_review(p_business uuid, p_status text, p_star text default null,
                                                   p_city_level text default null, p_note text default null,
                                                   p_docs_checked boolean default null, p_video_checked boolean default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare h intl_hospitals;
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into h from intl_hospitals where business_id = p_business;
  if h.business_id is null then raise exception 'No application from this hospital.' using errcode = 'P0002'; end if;
  if p_status not in ('submitted', 'reviewing', 'listed', 'paused', 'rejected') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if p_star is not null and p_star not in ('4', '5') then raise exception 'Star level is 4 or 5.' using errcode = '22023'; end if;
  if p_city_level is not null and p_city_level not in ('metro', 'regional', 'smaller') then
    raise exception 'Unknown city level.' using errcode = '22023';
  end if;
  -- The gate: no listing without the agreement and both checks.
  if p_status = 'listed' then
    if h.agreement_accepted_at is null then raise exception 'The hospital has not accepted the agreement.' using errcode = 'P0001'; end if;
    if coalesce(p_docs_checked, h.docs_checked_at is not null) is not true then
      raise exception 'Tick "documents checked" first.' using errcode = 'P0001';
    end if;
    if coalesce(p_video_checked, h.video_checked_at is not null) is not true then
      raise exception 'Tick "video walkthrough done" first.' using errcode = 'P0001';
    end if;
    if coalesce(p_star, h.star) is null then raise exception 'Set the star level (4 or 5) first.' using errcode = 'P0001'; end if;
  end if;
  update intl_hospitals set
    status = p_status,
    star = coalesce(p_star, star),
    city_level = case when p_city_level is null then city_level else p_city_level end,
    admin_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), admin_note),
    docs_checked_at = case when p_docs_checked is null then docs_checked_at when p_docs_checked then coalesce(docs_checked_at, now()) else null end,
    video_checked_at = case when p_video_checked is null then video_checked_at when p_video_checked then coalesce(video_checked_at, now()) else null end,
    listed_at = case when p_status = 'listed' then coalesce(listed_at, now()) else listed_at end,
    updated_at = now()
  where business_id = p_business;
end $$;

create or replace function sehat_intl_admin_enquiry(p_id uuid, p_status text, p_coordinator text default null,
                                                    p_note text default null, p_chosen uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not (sehat_is_admin() or sehat_is_staff()) then raise exception 'Sehatsandhi team only.' using errcode = '42501'; end if;
  if p_status not in ('new', 'reports', 'quotes', 'visa', 'travel', 'arrived', 'discharged', 'followup', 'closed', 'cancelled') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update intl_enquiries set
    status = p_status,
    coordinator = coalesce(nullif(btrim(coalesce(p_coordinator, '')), ''), coordinator),
    admin_note = case when p_note is null then admin_note else nullif(btrim(p_note), '') end,
    chosen_hospital = coalesce(p_chosen, chosen_hospital),
    updated_at = now()
  where id = p_id;
end $$;

create or replace function sehat_intl_admin_settings(p_fee numeric, p_fx jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if p_fee is null or p_fee < 0 or p_fee > 30 then raise exception 'The fee is 0 to 30%%.' using errcode = '22023'; end if;
  if p_fx is null or jsonb_typeof(p_fx) <> 'object' then raise exception 'Rates must be a list.' using errcode = '22023'; end if;
  insert into site_settings (key, value) values ('intl_fee_pct', p_fee::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into site_settings (key, value) values ('intl_fx', p_fx::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ── Public ──────────────────────────────────────────────────────────────────
create or replace function sehat_intl_fee_pct()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value, '')::numeric from site_settings where key = 'intl_fee_pct'), 10)
$$;

-- Everything the portal shows: procedures, and listed hospitals with the price
-- the patient pays (hospital price + our fee, rounded up to ₹100).
create or replace function sehat_intl_catalogue()
returns jsonb language sql stable security definer set search_path = public as $$
  with fee as (select sehat_intl_fee_pct() as pct)
  select jsonb_build_object(
    'fee_pct', (select pct from fee),
    'fx', coalesce((select value::jsonb from site_settings where key = 'intl_fx'), '{}'::jsonb),
    'procedures', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'speciality', p.speciality, 'grp', p.grp,
        'hospital_days', p.hospital_days, 'india_days', p.india_days, 'summary', p.summary, 'reports', p.reports)
        order by p.sort) from intl_procedures p where p.active), '[]'::jsonb),
    'hospitals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name,
        'city', coalesce(nullif(b.own_city, ''), nullif(b.own_district, '')),
        'state', b.own_state,
        'city_level', coalesce(h.city_level, sehat_intl_city_level(coalesce(nullif(b.own_city, ''), b.own_district))),
        'star', h.star, 'nabh', h.nabh, 'jci', h.jci, 'beds', h.beds, 'icu_beds', h.icu_beds,
        'panels', to_jsonb(h.panels), 'languages', to_jsonb(h.languages), 'specialities', to_jsonb(h.specialities),
        'about', h.about, 'photo_url', b.photo_url,
        'nearest_airport', h.nearest_airport, 'airport_hours', h.airport_hours,
        'packages', coalesce((select jsonb_agg(jsonb_build_object(
            'procedure_code', k.procedure_code,
            'price_min', (ceil(k.price_min * (1 + (select pct from fee) / 100.0) / 100.0) * 100)::integer,
            'price_max', (ceil(k.price_max * (1 + (select pct from fee) / 100.0) / 100.0) * 100)::integer,
            'room_type', k.room_type, 'included', k.included, 'excluded', k.excluded,
            'hospital_days', k.hospital_days, 'india_days', k.india_days, 'fly_after_days', k.fly_after_days,
            'doctor_name', k.doctor_name, 'valid_until', k.valid_until))
            from intl_packages k where k.business_id = b.id and k.active and k.valid_until >= current_date), '[]'::jsonb))
        order by b.name)
        from intl_hospitals h join businesses b on b.id = h.business_id
        where h.status = 'listed' and b.status = 'active'), '[]'::jsonb)
  )
$$;

-- A patient's request for quotes. Rate-limited; a hidden field catches bots.
create or replace function sehat_intl_enquire(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := left(btrim(coalesce(p->>'name', '')), 120);
  v_phone text := nullif(left(regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'), 20), '');
  v_email text := nullif(left(lower(btrim(coalesce(p->>'email', ''))), 120), '');
  v_proc text := nullif(p->>'procedure_code', '');
  v_short uuid[];
  v_token text;
  v_comp integer := least(greatest(coalesce(nullif(p->>'companions', '')::integer, 0), 0), 2);
  v_prefs jsonb := coalesce(p->'prefs', '{}'::jsonb);
begin
  if coalesce(btrim(p->>'website'), '') <> '' then return jsonb_build_object('ok', true, 'token', null); end if;
  if length(v_name) < 2 then return jsonb_build_object('ok', false, 'error', 'Please tell us your name.'); end if;
  if v_phone is null and v_email is null then
    return jsonb_build_object('ok', false, 'error', 'Please give a WhatsApp number or email so we can reply.');
  end if;
  if v_phone is not null and length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Please include your country code, for example +44 7700 900123.');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'That email address does not look right.');
  end if;
  if v_proc is not null and not exists (select 1 from intl_procedures where code = v_proc) then v_proc := null; end if;
  if v_proc is null and length(btrim(coalesce(p->>'problem', ''))) < 3 then
    return jsonb_build_object('ok', false, 'error', 'Please choose a treatment or tell us briefly what is troubling you.');
  end if;
  if coalesce((p->>'consent_share')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'Please agree that we may share your reports with the hospitals you chose.');
  end if;
  if coalesce((p->>'ack_estimate')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'Please confirm you understand prices are estimates.');
  end if;
  if jsonb_typeof(v_prefs) <> 'object' or length(v_prefs::text) > 4000 then v_prefs := '{}'::jsonb; end if;
  -- Shortlist: up to 3 listed hospitals.
  v_short := coalesce(array(
    select h.business_id from intl_hospitals h
     where h.status = 'listed'
       and h.business_id::text in (select jsonb_array_elements_text(coalesce(p->'shortlist', '[]')))
     limit 3), '{}');

  if (select count(*) from intl_enquiries
       where created_at > now() - interval '1 day'
         and ((v_phone is not null and phone = v_phone) or (v_email is not null and email = v_email))) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'We already have your requests. Our coordinator will reply on WhatsApp soon.');
  end if;
  if (select count(*) from intl_enquiries where created_at > now() - interval '1 hour') >= 120 then
    return jsonb_build_object('ok', false, 'error', 'We are receiving many requests. Please try again in a few minutes or message us on WhatsApp.');
  end if;

  insert into intl_enquiries (name, country, phone, email, procedure_code, problem, urgency, travel_when,
                              companions, budget, prefs, shortlist, consent_share, ack_estimate, page)
  values (v_name, nullif(left(btrim(coalesce(p->>'country', '')), 80), ''), v_phone, v_email, v_proc,
          nullif(left(btrim(coalesce(p->>'problem', '')), 3000), ''),
          case when p->>'urgency' in ('planned', 'soon', 'urgent') then p->>'urgency' end,
          nullif(left(btrim(coalesce(p->>'travel_when', '')), 80), ''),
          v_comp, nullif(left(btrim(coalesce(p->>'budget', '')), 80), ''), v_prefs, v_short, true, true,
          nullif(left(coalesce(p->>'page', ''), 200), ''))
  returning token into v_token;
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- What the patient's tracking page shows.
create or replace function sehat_intl_track(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', split_part(e.name, ' ', 1),
    'status', e.status,
    'procedure', (select name from intl_procedures where code = e.procedure_code),
    'problem', e.problem,
    'coordinator', e.coordinator,
    'created_at', e.created_at,
    'updated_at', e.updated_at,
    'hospitals', coalesce((select jsonb_agg(b.name) from businesses b where b.id = any(e.shortlist)), '[]'::jsonb),
    'chosen', (select name from businesses where id = e.chosen_hospital))
  from intl_enquiries e where e.token = p_token and length(coalesce(p_token, '')) >= 16
$$;

revoke all on function sehat_intl_city_level(text) from public;
revoke all on function sehat_intl_can_apply(uuid) from public;
revoke all on function sehat_intl_profile_save(uuid, jsonb) from public, anon;
revoke all on function sehat_intl_submit(uuid, text, text) from public, anon;
revoke all on function sehat_intl_package_save(uuid, jsonb) from public, anon;
revoke all on function sehat_intl_package_delete(uuid, uuid) from public, anon;
revoke all on function sehat_intl_admin_review(uuid, text, text, text, text, boolean, boolean) from public, anon;
revoke all on function sehat_intl_admin_enquiry(uuid, text, text, text, uuid) from public, anon;
revoke all on function sehat_intl_admin_settings(numeric, jsonb) from public, anon;
revoke all on function sehat_intl_fee_pct() from public;
revoke all on function sehat_intl_catalogue() from public;
revoke all on function sehat_intl_enquire(jsonb) from public;
revoke all on function sehat_intl_track(text) from public;
grant execute on function sehat_intl_city_level(text), sehat_intl_fee_pct(), sehat_intl_catalogue(),
  sehat_intl_enquire(jsonb), sehat_intl_track(text) to anon, authenticated;
grant execute on function sehat_intl_can_apply(uuid), sehat_intl_profile_save(uuid, jsonb), sehat_intl_submit(uuid, text, text),
  sehat_intl_package_save(uuid, jsonb), sehat_intl_package_delete(uuid, uuid),
  sehat_intl_admin_review(uuid, text, text, text, text, boolean, boolean),
  sehat_intl_admin_enquiry(uuid, text, text, text, uuid), sehat_intl_admin_settings(numeric, jsonb) to authenticated;

notify pgrst, 'reload schema';
