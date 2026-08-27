-- ============================================================================
-- Sehatsandhi — what an eye doctor writes down is not what a dentist writes down
--
-- Run AFTER 0065. Safe to re-run.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
-- A visit has chief_complaint, diagnosis, advice — all free text — and vitals
-- has a fixed set of columns for BP, pulse, weight and sugar. That is the
-- general physician's consultation and nobody else's.
--
-- An eye doctor's finding IS the refraction: sphere, cylinder and axis for each
-- eye, and whether it has moved since last time. A dentist's finding is a chart
-- of thirty-two teeth. An orthopaedist measures range of motion per joint.
-- Typing "R -1.25/-0.50 x 90, L -1.00 DS" into an advice box records the words
-- and loses the data — it cannot be trended, compared or reported on, which for
-- refraction is the entire clinical point.
--
-- ── WHY NOT A COLUMN PER SPECIALITY ─────────────────────────────────────────
-- Because there are twelve specialities and the table would be a hundred mostly
-- null columns, and adding the thirteenth would be a migration. And because the
-- shapes are not all scalars: eyes come in pairs, teeth in thirty-twos.
--
-- ── THE SHAPE THAT FITS ALL OF THEM ─────────────────────────────────────────
-- A field definition, plus values carrying a SITE. Site is 'R'/'L' for eyes, an
-- FDI tooth number for dental, a joint for orthopaedics, and null for a plain
-- scalar. One mechanism covers a pair, a chart of thirty-two, and a single
-- number, and a new speciality is rows rather than a schema change.
--
-- ── WHY NOT JSONB ───────────────────────────────────────────────────────────
-- A blob on the visit would have been quicker and cannot be trended without
-- unpacking it, cannot be constrained, and lets two clinics record "sphere" and
-- "SPH" and mean the same thing. The value of refraction is the series, so the
-- series has to be queryable: one row per field per site per visit.
-- ============================================================================


-- ============================================================================
-- 1. What each speciality asks
-- ============================================================================

create table if not exists speciality_fields (
  id uuid primary key default gen_random_uuid(),
  speciality text not null,                 -- matches practitioners.speciality
  section text,                             -- groups fields on screen
  code text not null,                       -- stable key; never shown
  label text not null,                      -- what the doctor reads
  kind text not null default 'text'
    check (kind in ('number','text','select','boolean')),
  unit text,
  options text[],                           -- for kind = 'select'
  -- Null means one value. Otherwise the field repeats once per entry, and the
  -- entry is the site: R/L, an FDI tooth number, a joint name.
  sites text[],
  min_value numeric,
  max_value numeric,
  help text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (speciality, code)
);

create index if not exists speciality_fields_lookup
  on speciality_fields (speciality, sort_order) where is_active;

comment on table speciality_fields is
  'The examination a speciality actually performs, as data. A new speciality is '
  'rows here, not a migration — and `sites` is what lets one mechanism carry a '
  'pair of eyes, a chart of thirty-two teeth, and a single number.';


-- ============================================================================
-- 2. What was found
-- ============================================================================

create table if not exists visit_findings (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references patient_visits(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,

  speciality text not null,
  field_code text not null,
  -- 'R', 'L', '36', 'knee_left', or null for a scalar.
  site text,

  -- Both, not one: a number that can be trended and the text a doctor actually
  -- typed. Visual acuity is "6/9", which is neither a number nor free prose,
  -- and forcing it into one column would lose either the ordering or the
  -- notation.
  value_num numeric,
  value_text text,
  unit text,

  recorded_by uuid references practitioners(id) on delete set null,
  recorded_at timestamptz not null default now(),

  -- One value per field per site per visit. Recording the right eye's sphere
  -- twice is a mistake, not a second reading.
  unique (visit_id, field_code, site)
);

create index if not exists visit_findings_visit_idx on visit_findings (visit_id);
-- The trending query: this field, for this patient, over time.
create index if not exists visit_findings_series_idx
  on visit_findings (patient_member_id, field_code, site, recorded_at desc);

comment on table visit_findings is
  'One row per field per site per visit. Clinical: gated to doctors and owners '
  'by the same rule as conditions and prescriptions — vitals stay open to '
  'reception, an examination does not.';


-- ============================================================================
-- 3. EYE — refraction
--
-- The prescription a patient walks out with, and the series that says whether
-- their sight is changing. Sphere and cylinder are dioptres and can be
-- negative; axis is 0-180 degrees; acuity is written 6/6, not measured.
-- ============================================================================

insert into speciality_fields (speciality, section, code, label, kind, unit, sites, min_value, max_value, help, sort_order) values
  ('EYE','Refraction','sph','Sphere','number','D',  array['R','L'], -30, 30, 'Minus for short sight, plus for long sight', 10),
  ('EYE','Refraction','cyl','Cylinder','number','D', array['R','L'], -15, 15, 'Astigmatism. Leave blank if none', 20),
  ('EYE','Refraction','axis','Axis','number','°',    array['R','L'],   0, 180, 'Only meaningful with a cylinder', 30),
  ('EYE','Refraction','va_unaided','Vision unaided','text',null, array['R','L'], null, null, 'As written: 6/6, 6/9, CF, HM', 40),
  ('EYE','Refraction','va_corrected','Vision with glasses','text',null, array['R','L'], null, null, null, 50),
  ('EYE','Pressure','iop','Eye pressure','number','mmHg', array['R','L'], 0, 80, 'Normal is roughly 10-21', 60),
  ('EYE','Examination','lens','Lens','select',null, array['R','L'], null, null, null, 70),
  ('EYE','Examination','fundus','Fundus','text',null, array['R','L'], null, null, null, 80)
on conflict (speciality, code) do update
  set label=excluded.label, kind=excluded.kind, unit=excluded.unit, sites=excluded.sites,
      min_value=excluded.min_value, max_value=excluded.max_value, help=excluded.help,
      section=excluded.section, sort_order=excluded.sort_order;

update speciality_fields
   set options = array['Clear','Early cataract','Immature cataract','Mature cataract','Pseudophakic (IOL)','Aphakic']
 where speciality='EYE' and code='lens';


-- ============================================================================
-- 4. DENT — the chart
--
-- FDI two-digit notation: quadrant then tooth, 11-18 upper right through 41-48
-- lower right. Thirty-two sites on one field, which is exactly the case a
-- column-per-finding design cannot express.
-- ============================================================================

insert into speciality_fields (speciality, section, code, label, kind, sites, help, sort_order) values
  ('DENT','Tooth chart','tooth','Finding','select',
   array['11','12','13','14','15','16','17','18',
         '21','22','23','24','25','26','27','28',
         '31','32','33','34','35','36','37','38',
         '41','42','43','44','45','46','47','48'],
   'FDI numbering. Leave a tooth blank if it is sound', 10)
on conflict (speciality, code) do update
  set label=excluded.label, sites=excluded.sites, help=excluded.help, sort_order=excluded.sort_order;

update speciality_fields
   set options = array['Caries','Filled','Root canal','Crown','Missing','Impacted','Mobile','Fractured','Sensitive']
 where speciality='DENT' and code='tooth';

insert into speciality_fields (speciality, section, code, label, kind, options, sort_order) values
  ('DENT','General','oral_hygiene','Oral hygiene','select', array['Good','Fair','Poor'], 20),
  ('DENT','General','gingiva','Gums','select', array['Healthy','Gingivitis','Periodontitis'], 30),
  ('DENT','General','calculus','Calculus','select', array['None','Mild','Moderate','Heavy'], 40)
on conflict (speciality, code) do update
  set label=excluded.label, kind=excluded.kind, options=excluded.options,
      section=excluded.section, sort_order=excluded.sort_order;


-- ============================================================================
-- 5. Writing findings
--
-- One call for a whole examination rather than a row at a time: a refraction is
-- eight fields across two eyes and a half-saved one is worse than none.
-- Replaces the visit's findings wholesale, so correcting a typo is re-saving
-- the form rather than reconciling what changed.
-- ============================================================================

create or replace function sehat_save_findings(
  p_visit_id uuid,
  p_speciality text,
  -- [{ code, site, num, text }]
  p_findings jsonb,
  p_recorded_by uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v record;
  f jsonb;
  n integer := 0;
  v_unit text;
begin
  select pv.business_id, pv.patient_member_id into v
    from patient_visits pv where pv.id = p_visit_id;
  if not found then raise exception 'no such visit'; end if;

  -- An examination is clinical. Reception records vitals; it does not record a
  -- refraction, and 0057 draws that line everywhere else too.
  if not sehat_caller_is_clinical(v.business_id) then
    raise exception 'only a doctor can record an examination'
      using errcode = 'insufficient_privilege';
  end if;

  delete from visit_findings where visit_id = p_visit_id;

  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb))
  loop
    -- Blank means "not examined", and storing it would make an empty tooth
    -- indistinguishable from a sound one.
    continue when coalesce(btrim(f ->> 'text'), '') = ''
             and (f ->> 'num') is null;

    select sf.unit into v_unit from speciality_fields sf
     where sf.speciality = p_speciality and sf.code = f ->> 'code';

    insert into visit_findings (
      visit_id, business_id, patient_member_id, speciality,
      field_code, site, value_num, value_text, unit, recorded_by
    ) values (
      p_visit_id, v.business_id, v.patient_member_id, p_speciality,
      f ->> 'code', nullif(btrim(coalesce(f ->> 'site','')), ''),
      (nullif(btrim(coalesce(f ->> 'num','')), ''))::numeric,
      nullif(btrim(coalesce(f ->> 'text','')), ''),
      v_unit, p_recorded_by
    );
    n := n + 1;
  end loop;

  return n;
end $$;

comment on function sehat_save_findings is
  'Replaces a visit''s examination findings in one call. Blank entries are '
  'dropped rather than stored, so an unexamined tooth stays distinguishable '
  'from a sound one.';


-- ============================================================================
-- 6. Reading them back
-- ============================================================================

create or replace view visit_findings_detail as
  select
    vf.*,
    sf.label, sf.section, sf.kind, sf.options, sf.sort_order,
    pv.visit_date
  from visit_findings vf
  join patient_visits pv on pv.id = vf.visit_id
  left join speciality_fields sf
    on sf.speciality = vf.speciality and sf.code = vf.field_code
 where sehat_caller_is_clinical(vf.business_id);

comment on view visit_findings_detail is
  'Findings with their labels attached. Left join on the definition on purpose: '
  'a field retired from speciality_fields must not erase what was recorded with '
  'it while it existed.';


-- ============================================================================
-- 7. RLS
-- ============================================================================

alter table speciality_fields enable row level security;
alter table visit_findings   enable row level security;

-- The catalogue is not patient data. Anyone signed in may read it — the form
-- has to render before a finding exists.
drop policy if exists speciality_fields_read on speciality_fields;
create policy speciality_fields_read on speciality_fields for select using (true);

drop policy if exists speciality_fields_admin on speciality_fields;
create policy speciality_fields_admin on speciality_fields
  using (sehat_is_admin()) with check (sehat_is_admin());

drop policy if exists clinic_reads_findings on visit_findings;
create policy clinic_reads_findings on visit_findings
  for select using (sehat_caller_is_clinical(business_id));

-- No insert or update policy: writing goes through sehat_save_findings, which
-- checks the role and drops blanks. A direct insert would skip both.

grant select on speciality_fields to authenticated;
grant select on visit_findings_detail to authenticated;
grant execute on function sehat_save_findings(uuid, text, jsonb, uuid) to authenticated;
revoke all on function sehat_save_findings(uuid, text, jsonb, uuid) from public, anon;


-- ============================================================================
-- NOT HERE
--   The other ten specialities. The mechanism is proven by the two hardest
--     shapes — a pair and a chart of thirty-two — and clinical content is worth
--     getting right one speciality at a time with somebody who practises it.
--     Wrong fields are worse than absent ones.
--   Per-clinic customisation. Every clinic shaping its own fields makes
--     trending across a patient's visits to two clinics meaningless.
--   Trend charts. The data model carries the series (see visit_findings_series_idx);
--     drawing it is a screen, not a schema.
-- ============================================================================
