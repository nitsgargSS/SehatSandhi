-- ============================================================================
-- Sehatsandhi — the clinical search keeps a nurse to their doctors' patients
--
-- Run AFTER 0149 and 0162. Safe to re-run.
--
-- 0162's search let everyone but a doctor search the whole clinic. 0149 keeps
-- a nurse to the patients of the doctors they are linked to (and the wards they
-- cover), everywhere in the record — so a nurse could still find, by
-- keyword, patients whose record they cannot open. The search now applies
-- sehat_caller_sees_patient to nurses as it already did to doctors. Owner,
-- manager and Sehatsandhi admins still search the whole clinic.
--
-- Only that one line of sehat_clinical_search changes.
-- ============================================================================

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
  -- 0163: owner and manager see the clinic; a doctor their own patients
  -- (0138) and a nurse their doctors' patients (0149) — the same rule as the
  -- record itself, through sehat_caller_sees_patient.
  v_all := sehat_is_admin() or v_role in ('owner', 'manager');

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
