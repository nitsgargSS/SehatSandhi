-- ============================================================================
-- Sehatsandhi — a doctor opens the records of their own patients
--
-- Run AFTER 0137. Safe to re-run.
--
-- Decided 26 Sep 2026. Patient records belong to the business. Inside it:
--
--   owner (incl. an owner who is a doctor)  every patient
--   nurse                                   every patient — ward and vitals work
--   doctor                                  patients they have been involved
--                                           with here, whole record including
--                                           other doctors' visits:
--                                             seen in their OPD queue, a visit or
--                                             consultation by them, an appointment
--                                             with them, admitted under them,
--                                             referred to or by them, registered
--                                             under them, a charge credited to them
--   reception, manager                      no medical record (unchanged, 0057)
--
-- 0121 left every doctor able to open every patient of the hospital. The
-- clinical tables' policies asked sehat_caller_is_clinical(business_id); each
-- now asks sehat_caller_sees_patient(business_id, <that row's patient>). A
-- referral (0134) is what opens a patient to a second doctor.
--
-- Unchanged, deliberately: who may WRITE a new record (inserts keep their
-- policies, so a doctor can start a consultation), and the basics the front
-- desk works with — name, vitals, allergies, queue, billing, the OPD slip.
-- ============================================================================

create or replace function sehat_caller_sees_patient(p_business uuid, p_member uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := sehat_caller_role(p_business);
  v_me   uuid;
begin
  if v_role in ('owner', 'nurse') then return true; end if;
  if v_role is distinct from 'doctor' or p_member is null then return false; end if;
  v_me := sehat_caller_practitioner_id();
  if v_me is null then return false; end if;
  return exists (select 1 from opd_queue q where q.business_id = p_business and q.patient_member_id = p_member and q.practitioner_id = v_me)
      or exists (select 1 from patient_visits v where v.business_id = p_business and v.patient_member_id = p_member and v.practitioner_id = v_me)
      or exists (select 1 from appointments a where a.business_id = p_business and a.patient_member_id = p_member and a.practitioner_id = v_me)
      or exists (select 1 from admissions a where a.business_id = p_business and a.patient_member_id = p_member and a.attending_practitioner_id = v_me)
      or exists (select 1 from patient_referrals r where r.business_id = p_business and r.patient_member_id = p_member
                  and (r.to_practitioner_id = v_me or r.from_practitioner_id = v_me))
      or exists (select 1 from business_patients bp where bp.business_id = p_business and bp.patient_member_id = p_member
                  and bp.primary_practitioner_id = v_me)
      or exists (select 1 from patient_charges c where c.business_id = p_business and c.patient_member_id = p_member
                  and c.practitioner_id = v_me);
end $$;
revoke all on function sehat_caller_sees_patient(uuid, uuid) from public, anon;
grant execute on function sehat_caller_sees_patient(uuid, uuid) to authenticated;

create or replace function sehat_caller_sees_admission(p_business uuid, p_admission uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select sehat_caller_sees_patient(p_business,
           (select a.patient_member_id from admissions a where a.id = p_admission))
$$;
revoke all on function sehat_caller_sees_admission(uuid, uuid) from public, anon;
grant execute on function sehat_caller_sees_admission(uuid, uuid) to authenticated;

-- Rewrite the read/update/delete policies of the clinical tables.
do $$
declare
  r record;
  v_new text;
  v_expr text;
  v_old constant text := 'sehat_caller_is_clinical(business_id)';
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and tablename in ('admission_medication_orders', 'admission_notes', 'consultation_recordings',
                         'discharge_summaries', 'medication_administrations', 'patient_conditions',
                         'patient_documents', 'patient_medications', 'patient_visits', 'prescriptions',
                         'visit_findings')
       and cmd in ('SELECT', 'UPDATE', 'DELETE')
       and (qual like '%' || v_old || '%' or coalesce(with_check, '') like '%' || v_old || '%')
  loop
    v_expr := case when r.tablename in ('admission_notes', 'medication_administrations')
                   then 'sehat_caller_sees_admission(business_id, admission_id)'
                   else 'sehat_caller_sees_patient(business_id, patient_member_id)' end;
    if r.qual like '%' || v_old || '%' then
      v_new := replace(r.qual, v_old, v_expr);
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, v_new);
    end if;
    if coalesce(r.with_check, '') like '%' || v_old || '%' then
      v_new := replace(r.with_check, v_old, v_expr);
      execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, v_new);
    end if;
    raise notice 'narrowed %.% (%)', r.tablename, r.policyname, r.cmd;
  end loop;
end $$;

notify pgrst, 'reload schema';
