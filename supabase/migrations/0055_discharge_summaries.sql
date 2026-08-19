-- ============================================================================
-- Sehatsandhi — the document a patient carries out of the building
--
-- Run AFTER 0054. Safe to re-run.
--
-- ── WHY A COLUMN WAS NOT ENOUGH ─────────────────────────────────────────────
-- 0050 put discharge_summary on admissions as text, and that is where it
-- stopped. A prescription gets a number, a token, a print layout and a way to
-- reach the patient; a discharge summary — the thing the patient physically
-- hands to the next doctor, often in another town — got a column nobody outside
-- the clinic could read.
--
-- It is also the document that matters most when it is read: the next clinician
-- has no access to this clinic's chart and knows only what the patient carries.
--
-- ── IMMUTABLE, AND SNAPSHOTTED, FOR THE SAME REASONS AS A PRESCRIPTION ──────
-- Issued once, corrected by supersession rather than editing, with every party
-- detail copied in at issue. A summary read two years later must still say
-- which ward, which doctor and which registration number — after the doctor has
-- moved on and the ward has been renamed. admissions keeps changing; a document
-- must not.
--
-- ── WHAT IT DOES NOT DUPLICATE ──────────────────────────────────────────────
-- Discharge medication is a prescription, so this points at one rather than
-- copying drug names into a second table where the two could drift. The public
-- page renders both together, which is what the patient needs and what a
-- pharmacist reads.
-- ============================================================================


-- ============================================================================
-- 0. message_log can carry email
--
-- Found while extracting the shared sender. message_log dates from when the
-- only outbound channels were WhatsApp and SMS, so it has channel in
-- ('whatsapp','sms') and phone NOT NULL. Both senders now log email too, and
-- an email-only send has no phone at all — so a patient who asked for a soft
-- copy by email and gave no number would blow up the log insert on both
-- constraints. The send itself would have gone; only the record of it would
-- have failed, which is the worst way for this to break.
-- ============================================================================

alter table message_log drop constraint if exists message_log_channel_check;
alter table message_log add constraint message_log_channel_check
  check (channel in ('whatsapp', 'sms', 'email')) not valid;

alter table message_log alter column phone drop not null;

comment on column message_log.phone is
  'Null for email-only sends. Every other channel is addressed by number.';


-- ============================================================================
-- 1. Numbering — a series per clinic, per financial year
-- ============================================================================

create table if not exists discharge_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  fy text not null,
  last_number integer not null default 0,
  primary key (business_id, fy)
);

create or replace function sehat_next_discharge_number(p_business uuid, p_date date default current_date)
returns text language plpgsql security definer set search_path = public as $$
declare v_fy text; v_n integer;
begin
  v_fy := sehat_financial_year(p_date);
  insert into discharge_counters (business_id, fy, last_number)
  values (p_business, v_fy, 0) on conflict (business_id, fy) do nothing;
  select last_number + 1 into v_n from discharge_counters
   where business_id = p_business and fy = v_fy for update;
  update discharge_counters set last_number = v_n
   where business_id = p_business and fy = v_fy;
  return 'DS/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;


-- ============================================================================
-- 2. The document
-- ============================================================================

create table if not exists discharge_summaries (
  id uuid primary key default gen_random_uuid(),
  summary_no text not null,

  admission_id uuid not null references admissions(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  -- Not nullable. A discharge summary is signed by a person with a
  -- registration number, the same as a prescription — that is what makes it
  -- something the next clinician can act on.
  practitioner_id uuid not null references practitioners(id),

  -- Snapshots. Everything below is what was true at discharge.
  patient_name text not null,
  patient_age integer,
  patient_gender text,
  patient_phone text,
  clinic_name text,
  clinic_address text,
  clinic_phone text,
  doctor_name text not null,
  doctor_qualification text,
  doctor_reg_number text,
  ward_bed text,

  admitted_at timestamptz,
  discharged_at timestamptz,
  days_stayed integer,

  admitting_diagnosis text,
  discharge_diagnosis text,
  condition_on_discharge text,
  -- What actually happened between admission and discharge. The part the next
  -- clinician reads first and the part a column on `admissions` never had room
  -- to hold properly.
  course_in_hospital text,
  investigations text,
  procedures text,
  advice text,
  diet_advice text,
  activity_advice text,
  -- When to come back, and what would mean coming back sooner. A summary that
  -- omits this is the reason people return to A&E instead of a clinic.
  follow_up_date date,
  follow_up_with text,
  warning_signs text,

  -- Discharge medication lives in a prescription, not copied here.
  prescription_id uuid references prescriptions(id) on delete set null,

  issued_at timestamptz not null default now(),
  status text not null default 'issued' check (status in ('issued','cancelled','superseded')),
  supersedes uuid references discharge_summaries(id) on delete set null,
  superseded_by uuid references discharge_summaries(id) on delete set null,
  cancelled_reason text,

  public_token uuid not null default gen_random_uuid(),
  -- Longer than a prescription's 90 days: a discharge summary is a document
  -- people are told to keep and produce at the next appointment, which may be
  -- months away.
  token_expires_at timestamptz not null default now() + interval '1 year',

  sent_at timestamptz,
  sent_channels text[] default '{}',
  send_error text,

  created_at timestamptz not null default now()
);

create unique index if not exists discharge_summaries_token_idx on discharge_summaries (public_token);
create unique index if not exists discharge_summaries_no_idx on discharge_summaries (business_id, summary_no);
create index if not exists discharge_summaries_admission_idx on discharge_summaries (admission_id);
create index if not exists discharge_summaries_patient_idx
  on discharge_summaries (patient_member_id, issued_at desc);

comment on table discharge_summaries is
  'The document a patient carries to their next doctor. Immutable once issued — '
  'a correction supersedes — with every party detail snapshotted, because it is '
  'read by someone with no access to this clinic''s chart, possibly years later.';
comment on column discharge_summaries.prescription_id is
  'Discharge medication is a prescription. Pointed at rather than copied, so the '
  'two cannot drift; the public page renders both together.';

-- Same discipline as prescriptions: status may move, content may not.
create or replace function sehat_discharge_summary_is_immutable()
returns trigger language plpgsql as $$
begin
  if new.summary_no          is distinct from old.summary_no
  or new.admission_id        is distinct from old.admission_id
  or new.practitioner_id     is distinct from old.practitioner_id
  or new.patient_name        is distinct from old.patient_name
  or new.doctor_name         is distinct from old.doctor_name
  or new.doctor_reg_number   is distinct from old.doctor_reg_number
  or new.discharge_diagnosis is distinct from old.discharge_diagnosis
  or new.course_in_hospital  is distinct from old.course_in_hospital
  or new.advice              is distinct from old.advice
  or new.issued_at           is distinct from old.issued_at
  then
    raise exception
      'a discharge summary cannot be edited once issued — issue a correction that supersedes it'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists discharge_summaries_immutable on discharge_summaries;
create trigger discharge_summaries_immutable before update on discharge_summaries
  for each row execute function sehat_discharge_summary_is_immutable();


-- ============================================================================
-- 3. Issuing one
--
-- Everything that can be read off the admission is read off the admission. A
-- discharge summary is written at the end of a long week, and every field the
-- system can fill is a field a tired registrar cannot get wrong.
-- ============================================================================

create or replace function sehat_issue_discharge_summary(
  p_admission_id uuid,
  p_practitioner_id uuid,
  p_course_in_hospital text default null,
  p_investigations text default null,
  p_procedures text default null,
  p_advice text default null,
  p_diet_advice text default null,
  p_activity_advice text default null,
  p_warning_signs text default null,
  p_follow_up_with text default null,
  p_prescription_id uuid default null,
  p_supersedes uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  a record;
  d record;
  m record;
  b record;
begin
  select * into a from admissions where id = p_admission_id;
  if not found then raise exception 'no such admission'; end if;
  if not sehat_caller_owns_business(a.business_id) then raise exception 'not your business'; end if;
  if a.status = 'admitted' then
    raise exception 'discharge the patient before issuing a summary';
  end if;

  select p.full_name, p.qualification, p.reg_number into d
    from practitioners p where p.id = p_practitioner_id;
  if not found then raise exception 'no such practitioner'; end if;

  select mm.full_name, mm.age_years, mm.gender, pa.phone into m
    from patient_members mm join patients pa on pa.id = mm.patient_id
   where mm.id = a.patient_member_id;

  select bb.name, bb.address, bb.phone into b from businesses bb where bb.id = a.business_id;

  insert into discharge_summaries (
    summary_no, admission_id, business_id, patient_member_id, practitioner_id,
    patient_name, patient_age, patient_gender, patient_phone,
    clinic_name, clinic_address, clinic_phone,
    doctor_name, doctor_qualification, doctor_reg_number, ward_bed,
    admitted_at, discharged_at, days_stayed,
    admitting_diagnosis, discharge_diagnosis, condition_on_discharge,
    course_in_hospital, investigations, procedures,
    advice, diet_advice, activity_advice, warning_signs,
    follow_up_date, follow_up_with, prescription_id, supersedes
  )
  select
    sehat_next_discharge_number(a.business_id), a.id, a.business_id, a.patient_member_id, p_practitioner_id,
    m.full_name, m.age_years, m.gender, m.phone,
    b.name, b.address, b.phone,
    d.full_name, d.qualification, d.reg_number,
    -- Where they actually were. The first bed of the stay, since a summary
    -- reads as a stay rather than a snapshot of the last bed.
    (select string_agg(distinct concat_ws(' / ', s.ward_name, 'bed ' || s.bed_label), ', ')
       from admission_bed_stays s where s.admission_id = a.id),
    a.admitted_at, a.discharged_at,
    greatest(1, ceil(extract(epoch from coalesce(a.discharged_at, now()) - a.admitted_at) / 86400.0)::integer),
    a.admitting_diagnosis, a.discharge_diagnosis, a.condition_on_discharge,
    coalesce(p_course_in_hospital, a.discharge_summary),
    p_investigations, p_procedures,
    coalesce(p_advice, a.discharge_summary), p_diet_advice, p_activity_advice, p_warning_signs,
    a.follow_up_date, p_follow_up_with, p_prescription_id, p_supersedes
  returning id into v_id;

  if p_supersedes is not null then
    update discharge_summaries
       set status = 'superseded', superseded_by = v_id
     where id = p_supersedes and business_id = a.business_id;
  end if;

  return v_id;
end $$;

comment on function sehat_issue_discharge_summary is
  'Builds the document from the admission, the patient and the practitioner, '
  'so the only things anyone types are the parts only they know. Refuses while '
  'the patient is still admitted — a summary of an unfinished stay is not one.';


-- ============================================================================
-- 4. Reading it back
-- ============================================================================

create or replace view discharge_summary_detail as
  select
    ds.*,
    a.reason as admission_reason,
    p.prescription_no,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'drug_name', i.drug_name, 'strength', i.strength, 'dosage', i.dosage,
        'duration', i.duration, 'instructions', i.instructions) order by i.sort_order), '[]'::jsonb)
       from prescription_items i where i.prescription_id = ds.prescription_id) as medicines
  from discharge_summaries ds
  join admissions a on a.id = ds.admission_id
  left join prescriptions p on p.id = ds.prescription_id
 where ds.business_id in (select sehat_caller_business_ids());


-- ============================================================================
-- 5. RLS
-- ============================================================================

alter table discharge_summaries enable row level security;
alter table discharge_counters  enable row level security;

drop policy if exists "clinic_reads_discharge_summaries" on discharge_summaries;
create policy "clinic_reads_discharge_summaries" on discharge_summaries
  for select using (sehat_caller_owns_business(business_id));

-- No insert policy: issuing goes through the RPC, which numbers the document
-- and refuses an unfinished stay. A direct insert would bypass both.
drop policy if exists "clinic_updates_discharge_summaries" on discharge_summaries;
create policy "clinic_updates_discharge_summaries" on discharge_summaries
  for update using (sehat_caller_owns_business(business_id))
  with check (sehat_caller_owns_business(business_id));

drop policy if exists "admins_read_discharge_counters" on discharge_counters;
create policy "admins_read_discharge_counters" on discharge_counters
  for select using (sehat_is_admin());

grant select on discharge_summary_detail to authenticated;
grant execute on function sehat_issue_discharge_summary(uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid) to authenticated;

revoke all on function sehat_issue_discharge_summary(uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid) from anon;
revoke all on function sehat_next_discharge_number(uuid, date) from anon, authenticated;
