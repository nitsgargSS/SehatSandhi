-- ============================================================================
-- Sehatsandhi — a manager can do everything reception and nurses do
--
-- Run AFTER 0179. Safe to re-run.
--
-- Decided 30 Sep 2026: in a small clinic one or two people do everything, and
-- they are added as Manager. A manager could run the listing, invoices and
-- reports but not the patients' side. Now a manager also:
--   • reads and writes the medical record like a nurse — vitals, notes, the
--     drug chart, admissions, discharge — for every patient of the clinic, as
--     the owner does (a nurse sees only their doctors' patients);
--   • enters lab results and reads lab reports.
-- Still doctors only: prescribing (sehat_caller_may_prescribe) and approving a
-- lab report. Reception keeps its narrower role.
--
-- Four access checks, each 0067/0149/0168's body with 'manager' added.
-- ============================================================================

create or replace function sehat_caller_is_clinical(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(sehat_caller_role(p_business) in ('owner', 'manager', 'doctor', 'nurse'), false);
$$;

create or replace function sehat_caller_sees_patient(p_business uuid, p_member uuid)
returns boolean
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_role text := sehat_caller_role(p_business);
  v_me   uuid;
begin
  -- 0180: a manager covers the whole clinic, as the owner does.
  if v_role in ('owner', 'manager') then return true; end if;
  if v_role not in ('doctor', 'nurse') or p_member is null then return false; end if;
  v_me := sehat_caller_practitioner_id();
  if v_me is null then return false; end if;

  if v_role = 'doctor' then
    return sehat_patient_is_under(p_business, p_member, v_me);
  end if;

  -- A nurse: anyone admitted, if a ward nurse; otherwise their doctors' patients.
  if sehat_caller_is_ward_nurse(p_business)
     and exists (select 1 from admissions a where a.business_id = p_business and a.patient_member_id = p_member) then
    return true;
  end if;
  return exists (
    select 1 from nurse_doctor_links l
     where l.business_id = p_business and l.nurse_id = v_me
       and sehat_patient_is_under(p_business, p_member, l.doctor_id));
end $$;

create or replace function sehat_lab_reads_results(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select sehat_is_admin() or (sehat_caller_owns_business(p_business)
         and coalesce(sehat_caller_role(p_business) in ('owner','manager','doctor','nurse'), false));
$$;

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
  elsif p_need = 'results' and coalesce(v_role in ('owner','manager','doctor','nurse'), false) is not true then
    raise exception 'Only a doctor, a manager or a lab technician (nurse role) can enter results.' using errcode = '42501';
  elsif p_need = 'approve' and coalesce(v_role in ('owner','doctor'), false) is not true then
    raise exception 'Only a doctor (pathologist / radiologist) can approve a report.' using errcode = '42501';
  end if;
end $$;

notify pgrst, 'reload schema';
