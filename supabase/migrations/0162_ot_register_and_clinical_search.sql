-- ============================================================================
-- Sehatsandhi — the OT register, and finding patients by anything written
--
-- Run AFTER 0140 on production (or after 0161 on sandbox). Uses 0047–0138
-- only, nothing from 0141–0161, so it can go to production on its own. Safe
-- to re-run.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- "Which patients had a lap chole last year?" "Everyone from the minor OT in
-- March." "Who did I put a mesh in?" "Whose discharge said no driving for six
-- weeks?" A doctor finds patients by what was done and what was written, not
-- by name. Two things stood in the way:
--
--   1. No surgery was ever recorded as a surgery. An operation existed only as
--      free text in discharge_summaries.procedures, written at discharge, with
--      no date performed, no major/minor OT, no surgeon, no anaesthesia — and
--      nothing at all for a minor OT procedure on an outpatient. So:
--      `surgeries`, one row per operation — the OT register.
--
--   2. The diagnosis search (0086) looks at diagnoses and discharge
--      procedures only, one phrase at a time, for owner/doctor/nurse. Doctors
--      search by what they wrote: instructions, course in hospital, findings,
--      implants, advice, drugs. So: sehat_clinical_search, over every clinical
--      text there is, every word must match (in any order), filterable by date,
--      record type, major/minor OT and doctor — and with no words at all it
--      lists: "all major OTs in March" is a filter, not a keyword.
--
-- ── WHO ─────────────────────────────────────────────────────────────────────
-- Owner, clinic manager, doctors, nurses, Sehatsandhi admins. Not reception.
-- 0086 kept this to clinical staff because it lists people BY CONDITION;
-- the clinic asked (28 Sep 2026) that managers can search too. A doctor sees
-- only the patients they are involved with (0138's rule, which the old search
-- did not apply). Every search is logged in patient_record_access with who
-- ran it and what for — server-side, so it cannot be skipped.
-- ============================================================================


-- ============================================================================
-- 1. The OT register
-- ============================================================================

create table if not exists surgeries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  -- IPD surgery hangs off its admission; a minor OT procedure on an
  -- outpatient has none.
  admission_id uuid references admissions(id) on delete set null,
  visit_id uuid references patient_visits(id) on delete set null,

  performed_on date not null,
  start_time time,
  end_time time,
  ot_type text not null default 'major' check (ot_type in ('major', 'minor')),
  urgency text not null default 'elective' check (urgency in ('elective', 'emergency')),

  procedure_name text not null check (btrim(procedure_name) <> ''),
  indication text,                          -- pre-operative diagnosis / why
  -- A surgeon on the staff list, or a visiting one by name.
  surgeon_id uuid references practitioners(id) on delete set null,
  surgeon_name text,
  assistants text,
  anaesthetist text,
  anaesthesia text check (anaesthesia is null or anaesthesia in
    ('general', 'spinal', 'epidural', 'regional', 'local', 'sedation', 'none')),

  findings text,
  procedure_notes text,
  implants text,                            -- mesh, plates, IOL — with lot numbers if given
  specimen text,                            -- sent for histopathology
  complications text,
  post_op_instructions text,

  status text not null default 'done' check (status in ('done', 'cancelled')),
  cancelled_reason text,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists surgeries_business_date_idx on surgeries (business_id, performed_on desc);
create index if not exists surgeries_member_idx on surgeries (patient_member_id);
create index if not exists surgeries_procedure_trgm on surgeries using gin (procedure_name gin_trgm_ops);

-- Who wrote it, the surgeon's name from the staff list, and that an
-- admission or visit belongs to the same patient at the same clinic.
create or replace function sehat_surgery_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.admission_id is not null and not exists (
       select 1 from admissions a where a.id = new.admission_id
          and a.business_id = new.business_id and a.patient_member_id = new.patient_member_id) then
    raise exception 'That admission is not this patient''s at this clinic.' using errcode = '23514';
  end if;
  if new.surgeon_id is not null then
    new.surgeon_name := coalesce(nullif(btrim(new.surgeon_name), ''),
                                 (select full_name from practitioners where id = new.surgeon_id));
  end if;
  if tg_op = 'INSERT' then
    new.recorded_by := auth.uid();
    new.recorded_by_name := case when auth.uid() is not null then
      coalesce((select p.full_name from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
                 where bp.business_id = new.business_id and p.auth_uid = auth.uid() limit 1),
               (select 'Owner' from businesses b where b.id = new.business_id and b.auth_uid = auth.uid()),
               'Unknown') end;
  else
    new.recorded_by := old.recorded_by;
    new.recorded_by_name := old.recorded_by_name;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists a_surgery_stamp on surgeries;
create trigger a_surgery_stamp before insert or update on surgeries
  for each row execute function sehat_surgery_stamp();

alter table surgeries enable row level security;

-- Read: owner and manager see the whole register; a doctor or nurse sees the
-- patients they may see (0138).
drop policy if exists "clinic_reads_surgeries" on surgeries;
create policy "clinic_reads_surgeries" on surgeries for select using (
  sehat_is_admin() or sehat_caller_is_business(business_id)
  or (sehat_caller_is_clinical(business_id) and sehat_caller_sees_patient(business_id, patient_member_id)));

-- Write: clinical staff, for patients they may see. No delete — an operation
-- recorded by mistake is cancelled with a reason, and stays.
drop policy if exists "clinic_writes_surgeries" on surgeries;
create policy "clinic_writes_surgeries" on surgeries for insert with check (
  sehat_caller_is_clinical(business_id) and sehat_caller_sees_patient(business_id, patient_member_id));
drop policy if exists "clinic_updates_surgeries" on surgeries;
create policy "clinic_updates_surgeries" on surgeries for update
  using (sehat_caller_is_clinical(business_id) and sehat_caller_sees_patient(business_id, patient_member_id))
  with check (sehat_caller_is_clinical(business_id) and sehat_caller_sees_patient(business_id, patient_member_id));

grant select, insert, update on surgeries to authenticated;
revoke delete on surgeries from authenticated;
revoke all on surgeries from anon;


-- ============================================================================
-- 2. The search
-- ============================================================================

-- Trigram indexes for the long texts the old search did not read.
create index if not exists discharge_summaries_procedures_trgm on discharge_summaries using gin (procedures gin_trgm_ops);
create index if not exists discharge_summaries_advice_trgm on discharge_summaries using gin (advice gin_trgm_ops);
create index if not exists discharge_summaries_course_trgm on discharge_summaries using gin (course_in_hospital gin_trgm_ops);
create index if not exists patient_visits_advice_trgm on patient_visits using gin (advice gin_trgm_ops);

-- p_sources: any of surgery, discharge, visit, admission, prescription,
-- condition (null = all). p_ot_type: major | minor (implies surgeries only).
create or replace function sehat_clinical_search(
  p_business uuid,
  p_query text default null,
  p_from date default null,
  p_to date default null,
  p_sources text[] default null,
  p_ot_type text default null,
  p_practitioner uuid default null,
  p_limit integer default 300
) returns table (
  patient_member_id uuid, full_name text, phone text, age_years integer, gender text, mrn text,
  source text, source_id uuid, event_date date, title text, matched_field text, snippet text,
  doctor_name text, ot_type text, admission_no text
)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_role text := sehat_caller_role(p_business);
  v_all boolean;
  v_words text[];
  v_first text;
  v_src text[] := coalesce(p_sources, array['surgery','discharge','visit','admission','prescription','condition']);
  v_lim integer := greatest(1, least(coalesce(p_limit, 300), 1000));
begin
  if not (sehat_is_admin() or coalesce(v_role in ('owner', 'manager', 'doctor', 'nurse'), false)) then
    raise exception 'Only the owner, a manager, a doctor or a nurse can search medical records.' using errcode = '42501';
  end if;
  -- A doctor is kept to their own patients (0138); everyone else sees the clinic.
  v_all := sehat_is_admin() or v_role is distinct from 'doctor';

  -- Words of 2+ characters, each escaped for LIKE. Every one must appear.
  select array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    into v_words
    from regexp_split_to_table(lower(btrim(coalesce(p_query, ''))), '\s+') w
   where length(w) >= 2;
  v_first := coalesce(v_words[1], '%');

  if v_words is null and p_from is null and p_to is null and p_ot_type is null and p_practitioner is null and p_sources is null then
    raise exception 'Type a word to search for, or choose dates, OT type or a doctor to list.' using errcode = '22023';
  end if;
  if p_ot_type is not null then v_src := array['surgery']; end if;

  insert into patient_record_access (business_id, patient_member_id, action, detail)
  values (p_business, null, 'search',
          left('clinical: ' || coalesce(btrim(p_query), '') ||
               coalesce(' ' || p_from::text, '') || coalesce('..' || p_to::text, '') ||
               coalesce(' ' || p_ot_type, ''), 120));

  return query
  with hits as (
    -- The OT register
    select s.patient_member_id as member, 'surgery'::text as src, s.id as sid, s.performed_on as d,
           s.procedure_name as ttl, s.surgeon_id as doc, coalesce(s.surgeon_name, pr.full_name) as docname,
           s.ot_type as ot, a.admission_no as adm,
           array[['procedure', s.procedure_name], ['indication', s.indication], ['findings', s.findings],
                 ['notes', s.procedure_notes], ['implants', s.implants], ['specimen', s.specimen],
                 ['complications', s.complications], ['post-op instructions', s.post_op_instructions],
                 ['surgeon', s.surgeon_name], ['assistants', s.assistants], ['anaesthetist', s.anaesthetist],
                 ['anaesthesia', s.anaesthesia]] as f
      from surgeries s
      left join practitioners pr on pr.id = s.surgeon_id
      left join admissions a on a.id = s.admission_id
     where 'surgery' = any(v_src) and s.business_id = p_business and s.status = 'done'
       and (p_ot_type is null or s.ot_type = p_ot_type)
    union all
    -- Discharge summaries: every section a doctor writes in
    select ds.patient_member_id, 'discharge', ds.id, (ds.discharged_at at time zone 'Asia/Kolkata')::date,
           coalesce(nullif(ds.discharge_diagnosis, ''), ds.admitting_diagnosis), ds.practitioner_id, ds.doctor_name, null, a.admission_no,
           array[['discharge diagnosis', ds.discharge_diagnosis], ['admitting diagnosis', ds.admitting_diagnosis],
                 ['procedures', ds.procedures], ['course in hospital', ds.course_in_hospital],
                 ['investigations', ds.investigations], ['advice', ds.advice], ['diet', ds.diet_advice],
                 ['activity', ds.activity_advice], ['warning signs', ds.warning_signs],
                 ['condition on discharge', ds.condition_on_discharge], ['follow up with', ds.follow_up_with]]
      from discharge_summaries ds
      left join admissions a on a.id = ds.admission_id
     where 'discharge' = any(v_src) and ds.business_id = p_business and ds.status = 'issued'
    union all
    select v.patient_member_id, 'visit', v.id, v.visit_date, coalesce(v.diagnosis, v.chief_complaint),
           v.practitioner_id, pr.full_name, null, null,
           array[['diagnosis', v.diagnosis], ['complaint', v.chief_complaint], ['ICD-10', v.icd10_code],
                 ['advice', v.advice], ['notes', v.notes]]
      from patient_visits v left join practitioners pr on pr.id = v.practitioner_id
     where 'visit' = any(v_src) and v.business_id = p_business and v.patient_member_id is not null
    union all
    select a.patient_member_id, 'admission', a.id, (a.admitted_at at time zone 'Asia/Kolkata')::date,
           coalesce(a.discharge_diagnosis, a.admitting_diagnosis, a.reason), a.attending_practitioner_id, pr.full_name, null, a.admission_no,
           array[['reason', a.reason], ['admitting diagnosis', a.admitting_diagnosis],
                 ['discharge diagnosis', a.discharge_diagnosis], ['discharge note', a.discharge_summary]]
      from admissions a left join practitioners pr on pr.id = a.attending_practitioner_id
     where 'admission' = any(v_src) and a.business_id = p_business
    union all
    select rx.patient_member_id, 'prescription', rx.id, (rx.issued_at at time zone 'Asia/Kolkata')::date,
           coalesce(rx.diagnosis, rx.prescription_no), rx.practitioner_id, rx.prescriber_name, null, null,
           array[['diagnosis', rx.diagnosis], ['advice', rx.advice],
                 ['medicines', (select string_agg(concat_ws(' ', pi.drug_name, pi.strength, pi.instructions), '; ')
                                  from prescription_items pi where pi.prescription_id = rx.id)]]
      from prescriptions rx
     where 'prescription' = any(v_src) and rx.business_id = p_business and rx.status = 'issued'
    union all
    select c.patient_member_id, 'condition', c.id, coalesce(c.onset_date, (c.created_at at time zone 'Asia/Kolkata')::date),
           c.condition, c.recorded_by, pr.full_name, null, null,
           array[['condition', c.condition], ['ICD-10', c.icd10_code], ['notes', c.notes]]
      from patient_conditions c left join practitioners pr on pr.id = c.recorded_by
     where 'condition' = any(v_src) and c.business_id = p_business
  ),
  matched as (
    select h.*,
           -- The first field holding the first word: what to show as "found in".
           (select x.fld from (select f[i][1] as fld, f[i][2] as txt from generate_subscripts(h.f, 1) i) x
             where x.txt ilike v_first limit 1) as mfield,
           (select x.txt from (select f[i][1] as fld, f[i][2] as txt from generate_subscripts(h.f, 1) i) x
             where x.txt ilike v_first limit 1) as mtext
      from hits h
     where (p_from is null or h.d >= p_from)
       and (p_to is null or h.d <= p_to)
       and (p_practitioner is null or h.doc = p_practitioner)
       and (v_words is null or not exists (
             select 1 from unnest(v_words) w
              where not exists (select 1 from generate_subscripts(h.f, 1) i where h.f[i][2] ilike w)))
  )
  select m.member, pm.full_name, pa.phone, pm.age_years, pm.gender, bp.mrn,
         m.src, m.sid, m.d, m.ttl,
         case when v_words is null then null else m.mfield end,
         case when v_words is null or m.mtext is null then null
              when length(m.mtext) <= 160 then m.mtext
              else '…' || substr(m.mtext,
                     greatest(1, strpos(lower(m.mtext), replace(replace(replace(trim(both '%' from v_first), '\%', '%'), '\_', '_'), '\\', '\')) - 60),
                     160) || '…' end,
         m.docname, m.ot, m.adm
    from matched m
    join patient_members pm on pm.id = m.member
    join patients pa on pa.id = pm.patient_id
    left join business_patients bp on bp.business_id = p_business and bp.patient_member_id = m.member
   where v_all or sehat_caller_sees_patient(p_business, m.member)
   order by m.d desc nulls last
   limit v_lim;
end $$;

revoke all on function sehat_clinical_search(uuid, text, date, date, text[], text, uuid, integer) from public, anon;
grant execute on function sehat_clinical_search(uuid, text, date, date, text[], text, uuid, integer) to authenticated;

notify pgrst, 'reload schema';

-- ── NOT HERE ────────────────────────────────────────────────────────────────
-- • Charging for an operation. The OT fee is a charge in Billing (category
--   'procedure') as today; linking the two is a later step.
-- • OT scheduling (booking the theatre ahead). This records what was done.
-- • Replacing 0086's sehat_search_by_diagnosis. It stays for anything that
--   calls it; the dashboard uses the new search.
