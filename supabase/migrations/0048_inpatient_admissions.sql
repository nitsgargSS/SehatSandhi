-- ============================================================================
-- Sehatsandhi — inpatients: a stay, a bed, and what happened each day
--
-- Run AFTER 0047. Safe to re-run.
--
-- ── WHY AN ADMISSION IS NOT A VISIT ─────────────────────────────────────────
-- patient_visits already carries a visit_type of 'ipd', and it would have been
-- tempting to stop there. It does not fit. A visit happens at a moment: one
-- date, one complaint, one prescription. An admission is a span — it opens,
-- occupies a bed for days, accumulates a note per shift, and closes with a
-- discharge summary. Modelling that as a visit means either one row that is
-- edited daily, losing the history that is the whole point, or a visit per day,
-- losing the fact that they are one stay.
--
-- So: admissions are their own thing, and the patient's chart shows both.
--
-- ── WHY BEDS ARE A TABLE AND NOT A TEXT FIELD ───────────────────────────────
-- 'Ward 2, bed 7' as free text is enough to record where somebody is, and
-- useless for the question a hospital actually asks all day: what is free? You
-- cannot count empty beds you never listed. Beds are rows, and occupancy is a
-- query rather than a whiteboard.
--
-- One bed holds one patient: enforced by a partial unique index rather than by
-- the UI remembering, because a double-booked bed is discovered at 2am by a
-- porter with a trolley.
--
-- ── WHAT IS DELIBERATELY SIMPLE ─────────────────────────────────────────────
-- No order sets, no drug charts, no nurse rostering, no theatre scheduling.
-- This records where a patient is, who is looking after them, what has been
-- written about them, and how the stay ended. A small hospital does the rest on
-- paper today and will keep doing so; pretending otherwise builds screens
-- nobody fills in.
-- ============================================================================


-- ============================================================================
-- 1. Where the beds are
-- ============================================================================

create table if not exists wards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,                      -- 'General Ward', 'ICU', 'Maternity'
  kind text not null default 'general'
    check (kind in ('general','icu','hdu','private','semi_private','maternity','paediatric','isolation','emergency')),
  floor text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists wards_business_idx on wards (business_id) where is_active;

create table if not exists beds (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references wards(id) on delete cascade,
  -- Denormalised from the ward so every policy on this table reads the same
  -- way as every other one, without a join to find out whose bed it is.
  business_id uuid not null references businesses(id) on delete cascade,
  label text not null,                     -- '7', '7A', 'ICU-3'
  daily_charge integer,                    -- what the bed costs per day, if fixed
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (ward_id, label)
);

create index if not exists beds_business_idx on beds (business_id) where is_active;

comment on table beds is
  'One row per physical bed. Free text would record where a patient is and '
  'answer nothing about what is free — you cannot count beds you never listed.';


-- ============================================================================
-- 2. The stay
-- ============================================================================

create table if not exists admission_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  fy text not null,
  last_number integer not null default 0,
  primary key (business_id, fy)
);

create or replace function sehat_next_admission_number(p_business uuid, p_date date default current_date)
returns text language plpgsql security definer set search_path = public as $$
declare v_fy text; v_n integer;
begin
  v_fy := sehat_financial_year(p_date);
  insert into admission_counters (business_id, fy, last_number)
  values (p_business, v_fy, 0) on conflict (business_id, fy) do nothing;
  select last_number + 1 into v_n from admission_counters
   where business_id = p_business and fy = v_fy for update;
  update admission_counters set last_number = v_n
   where business_id = p_business and fy = v_fy;
  return 'IP/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;

create table if not exists admissions (
  id uuid primary key default gen_random_uuid(),
  admission_no text not null,

  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  -- Where they are now. Nullable: a patient can be admitted and waiting for a
  -- bed, which is a real state and not a data error.
  bed_id uuid references beds(id) on delete set null,
  -- Who is responsible. Set null rather than cascade: if a doctor leaves, the
  -- admission still happened and the record must not lose it.
  attending_practitioner_id uuid references practitioners(id) on delete set null,

  admitted_at timestamptz not null default now(),
  expected_discharge date,
  discharged_at timestamptz,

  status text not null default 'admitted'
    check (status in ('admitted','discharged','lama','transferred_out','deceased')),

  reason text,                             -- why they came in
  admitting_diagnosis text,

  -- Filled at discharge. Kept on the stay rather than as a separate document so
  -- the summary cannot drift from the admission it describes.
  discharge_diagnosis text,
  discharge_summary text,
  condition_on_discharge text
    check (condition_on_discharge is null or condition_on_discharge in
      ('recovered','improved','unchanged','worse','referred','deceased')),
  follow_up_date date,
  discharged_by uuid references practitioners(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists admissions_no_idx on admissions (business_id, admission_no);
create index if not exists admissions_patient_idx on admissions (patient_member_id, admitted_at desc);
create index if not exists admissions_open_idx
  on admissions (business_id, admitted_at desc) where status = 'admitted';

-- One bed, one patient. A UI can forget; an index cannot. The alternative is
-- found at 2am by a porter with a trolley.
create unique index if not exists admissions_one_patient_per_bed
  on admissions (bed_id) where status = 'admitted' and bed_id is not null;

-- And one open admission per person per hospital: admitting somebody who is
-- already an inpatient is a mistake, not a second stay.
create unique index if not exists admissions_one_open_per_patient
  on admissions (business_id, patient_member_id) where status = 'admitted';

comment on column admissions.bed_id is
  'Nullable on purpose: admitted and waiting for a bed is a real state, and a '
  'record that cannot express it gets a fake bed instead.';

-- 'lama' is the term a ward actually uses for a patient who leaves against
-- advice. Spelled out here so nobody has to guess.
comment on column admissions.status is
  'admitted | discharged | lama (left against medical advice) | '
  'transferred_out | deceased.';

drop trigger if exists admissions_touch on admissions;
create trigger admissions_touch before update on admissions
  for each row execute function sehat_touch_updated_at();


-- ============================================================================
-- 3. What happened each day
-- ============================================================================

create table if not exists admission_notes (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references admissions(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,

  note_type text not null default 'progress'
    check (note_type in ('progress','nursing','procedure','handover','bed_move','status_change')),
  body text not null,

  recorded_by uuid references practitioners(id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index if not exists admission_notes_admission_idx
  on admission_notes (admission_id, recorded_at desc);

comment on table admission_notes is
  'Append-only in practice: a ward note is a record of what somebody thought at '
  'a time, and editing yesterday''s entry is how a chart stops being evidence. '
  'The UI offers no edit; bed moves and status changes write their own entries.';

-- A move is written by the database, not remembered by the caller. Where a
-- patient slept last night is exactly the sort of thing nobody thinks to log
-- and everybody later needs.
create or replace function sehat_admission_logs_bed_move()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_from text; v_to text;
begin
  if new.bed_id is not distinct from old.bed_id then return new; end if;

  select w.name || ' / ' || b.label into v_from
    from beds b join wards w on w.id = b.ward_id where b.id = old.bed_id;
  select w.name || ' / ' || b.label into v_to
    from beds b join wards w on w.id = b.ward_id where b.id = new.bed_id;

  insert into admission_notes (admission_id, business_id, note_type, body)
  values (new.id, new.business_id, 'bed_move',
          'Moved from ' || coalesce(v_from, 'no bed') || ' to ' || coalesce(v_to, 'no bed'));
  return new;
end $$;

drop trigger if exists admissions_log_bed_move on admissions;
create trigger admissions_log_bed_move after update of bed_id on admissions
  for each row execute function sehat_admission_logs_bed_move();

-- Vitals taken on a ward belong to the stay, not to an outpatient visit.
alter table patient_vitals
  add column if not exists admission_id uuid references admissions(id) on delete cascade;
create index if not exists patient_vitals_admission_idx
  on patient_vitals (admission_id, recorded_at desc) where admission_id is not null;


-- ============================================================================
-- 4. Admitting, moving, discharging
--
-- RPCs rather than table writes: each of these is several statements that must
-- agree, and the checks below are the ones a busy ward gets wrong.
-- ============================================================================

create or replace function sehat_admit_patient(
  p_patient_member_id uuid,
  p_business_id uuid,
  p_bed_id uuid default null,
  p_attending_practitioner_id uuid default null,
  p_reason text default null,
  p_admitting_diagnosis text default null,
  p_expected_discharge date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not sehat_caller_owns_business(p_business_id) then
    raise exception 'not your business';
  end if;

  if p_bed_id is not null then
    if not exists (select 1 from beds b
                    where b.id = p_bed_id and b.business_id = p_business_id and b.is_active) then
      raise exception 'that bed does not belong to this hospital, or is out of service';
    end if;
    if exists (select 1 from admissions a
                where a.bed_id = p_bed_id and a.status = 'admitted') then
      raise exception 'that bed is already occupied';
    end if;
  end if;

  insert into admissions (
    admission_no, business_id, patient_member_id, bed_id,
    attending_practitioner_id, reason, admitting_diagnosis, expected_discharge
  ) values (
    sehat_next_admission_number(p_business_id), p_business_id, p_patient_member_id,
    p_bed_id, p_attending_practitioner_id, p_reason, p_admitting_diagnosis, p_expected_discharge
  ) returning id into v_id;

  -- An inpatient is a patient of this hospital, however they arrived.
  perform sehat_link_patient_to_business(p_patient_member_id, p_business_id, 'walk_in', 'admitted as inpatient');

  insert into admission_notes (admission_id, business_id, note_type, body)
  values (v_id, p_business_id, 'status_change',
          'Admitted' || case when p_admitting_diagnosis is not null
                             then ' — ' || p_admitting_diagnosis else '' end);
  return v_id;
exception
  when unique_violation then
    raise exception 'this patient is already admitted here, or that bed is taken';
end $$;

create or replace function sehat_discharge_patient(
  p_admission_id uuid,
  p_status text default 'discharged',
  p_discharge_diagnosis text default null,
  p_discharge_summary text default null,
  p_condition text default null,
  p_follow_up date default null,
  p_practitioner_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from admissions where id = p_admission_id;
  if not found then raise exception 'no such admission'; end if;
  if not sehat_caller_owns_business(v_biz) then raise exception 'not your business'; end if;

  if p_status not in ('discharged','lama','transferred_out','deceased') then
    raise exception 'a stay ends as discharged, lama, transferred_out or deceased';
  end if;

  update admissions set
    status = p_status,
    discharged_at = coalesce(discharged_at, now()),
    discharge_diagnosis = coalesce(p_discharge_diagnosis, discharge_diagnosis),
    discharge_summary = coalesce(p_discharge_summary, discharge_summary),
    condition_on_discharge = coalesce(p_condition, condition_on_discharge),
    follow_up_date = coalesce(p_follow_up, follow_up_date),
    discharged_by = coalesce(p_practitioner_id, discharged_by),
    -- The bed is freed by the status change, not by clearing bed_id: which bed
    -- they were in is part of the record. The partial unique index only counts
    -- rows still 'admitted', so the bed is available the moment this commits.
    updated_at = now()
  where id = p_admission_id and status = 'admitted';

  if not found then raise exception 'that admission is already closed'; end if;

  insert into admission_notes (admission_id, business_id, note_type, body, recorded_by)
  values (p_admission_id, v_biz, 'status_change',
          initcap(replace(p_status, '_', ' '))
          || case when p_condition is not null then ' — ' || p_condition else '' end,
          p_practitioner_id);
end $$;

comment on function sehat_discharge_patient is
  'Ends a stay. bed_id is left as it was: the partial unique index counts only '
  'rows still admitted, so the bed frees itself and the record keeps where the '
  'patient actually slept.';


-- ============================================================================
-- 5. The bed board, and one patient's stay
-- ============================================================================

create or replace view ward_occupancy as
  select
    w.business_id, w.id as ward_id, w.name as ward_name, w.kind, w.floor,
    b.id as bed_id, b.label as bed_label, b.daily_charge, b.is_active as bed_active,
    a.id as admission_id, a.admission_no, a.admitted_at, a.expected_discharge,
    m.id as patient_member_id, m.full_name as patient_name, m.age_years, m.gender,
    p.full_name as attending_name,
    (a.id is not null) as occupied
  from wards w
  join beds b on b.ward_id = w.id
  left join admissions a
    on a.bed_id = b.id and a.status = 'admitted'
  left join patient_members m on m.id = a.patient_member_id
  left join practitioners p on p.id = a.attending_practitioner_id
 where w.business_id in (select sehat_caller_business_ids())
   and w.is_active and b.is_active;

comment on view ward_occupancy is
  'Every active bed and who is in it — the board a ward runs the day from. '
  'Empty beds are rows with a null admission, which is what makes "what is '
  'free" a query rather than a whiteboard.';

create or replace view admission_detail as
  select
    a.*,
    m.full_name as patient_name, m.age_years, m.gender,
    pt.phone as patient_phone,
    w.name as ward_name, b.label as bed_label,
    p.full_name as attending_name,
    d.full_name as discharged_by_name,
    case when a.discharged_at is null
         then greatest(0, extract(day from now() - a.admitted_at)::integer)
         else greatest(0, extract(day from a.discharged_at - a.admitted_at)::integer)
    end as days_stayed
  from admissions a
  join patient_members m on m.id = a.patient_member_id
  join patients pt on pt.id = m.patient_id
  left join beds b on b.id = a.bed_id
  left join wards w on w.id = b.ward_id
  left join practitioners p on p.id = a.attending_practitioner_id
  left join practitioners d on d.id = a.discharged_by
 where a.business_id in (select sehat_caller_business_ids());


-- ============================================================================
-- 6. RLS
-- ============================================================================

alter table wards              enable row level security;
alter table beds               enable row level security;
alter table admissions         enable row level security;
alter table admission_notes    enable row level security;
alter table admission_counters enable row level security;

do $$
declare t text;
begin
  foreach t in array array['wards','beds','admissions','admission_notes'] loop
    execute format('drop policy if exists "clinic_reads_%1$s" on %1$I', t);
    execute format('create policy "clinic_reads_%1$s" on %1$I for select using (sehat_caller_owns_business(business_id))', t);
    execute format('drop policy if exists "clinic_writes_%1$s" on %1$I', t);
    execute format('create policy "clinic_writes_%1$s" on %1$I for insert with check (sehat_caller_owns_business(business_id))', t);
    execute format('drop policy if exists "clinic_updates_%1$s" on %1$I', t);
    execute format('create policy "clinic_updates_%1$s" on %1$I for update using (sehat_caller_owns_business(business_id)) with check (sehat_caller_owns_business(business_id))', t);
  end loop;
end $$;

-- Wards and beds are furniture; a clinic may remove one it typed wrong. An
-- admission and a ward note are records and have no delete policy at all.
drop policy if exists "clinic_removes_wards" on wards;
create policy "clinic_removes_wards" on wards
  for delete using (sehat_caller_owns_business(business_id));
drop policy if exists "clinic_removes_beds" on beds;
create policy "clinic_removes_beds" on beds
  for delete using (sehat_caller_owns_business(business_id));

drop policy if exists "admins_read_admission_counters" on admission_counters;
create policy "admins_read_admission_counters" on admission_counters
  for select using (sehat_is_admin());

grant select on ward_occupancy, admission_detail to authenticated;
grant execute on function sehat_admit_patient(uuid, uuid, uuid, uuid, text, text, date) to authenticated;
grant execute on function sehat_discharge_patient(uuid, text, text, text, text, date, uuid) to authenticated;

revoke all on function sehat_admit_patient(uuid, uuid, uuid, uuid, text, text, date) from anon;
revoke all on function sehat_discharge_patient(uuid, text, text, text, text, date, uuid) from anon;
revoke all on function sehat_next_admission_number(uuid, date) from anon, authenticated;


-- ============================================================================
-- NOT HERE, ON PURPOSE
--   Drug charts and order sets. A ward drug chart is a safety-critical
--     artefact with its own signing rules, and half of one is worse than none.
--   Theatre lists, nurse rostering, diet orders.
--   IPD billing — bed-days, procedures, consumables. That is the money slice,
--     and beds.daily_charge is the only hook it needs from here.
-- ============================================================================
