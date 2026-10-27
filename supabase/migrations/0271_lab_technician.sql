-- ============================================================================
-- 0271 — The lab technician
-- ============================================================================
-- Asked for on 27 Oct 2026. Lab staff had no role of their own and were added
-- as nurses or reception. A LAB TECHNICIAN now:
--   - adds and edits tests, their normal ranges and their prices;
--   - makes packages from tests, at a package price of the lab's choosing;
--   - takes orders, collects samples and enters results;
-- and does NOT approve (sign) a report — that stays with a doctor
-- (pathologist / radiologist) — nor see patients' records, money or any tab
-- but the Lab. The screen shows them the Lab tab only; the database holds the
-- same line (sehat_lab_check, sehat_caller_is_clinical leaves them out).
-- ============================================================================

alter table business_practitioners drop constraint if exists business_practitioners_role_check;
alter table business_practitioners add constraint business_practitioners_role_check
  check (role in ('owner', 'doctor', 'nurse', 'receptionist', 'manager', 'pharmacist', 'delivery', 'driver', 'lab_technician'));
alter table staff_invitations drop constraint if exists staff_invitations_role_check;
alter table staff_invitations add constraint staff_invitations_role_check
  check (role in ('doctor', 'nurse', 'receptionist', 'manager', 'pharmacist', 'delivery', 'driver', 'lab_technician'));

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
  if p_need = 'manage' and coalesce(v_role in ('owner','manager','doctor','lab_technician'), false) is not true then
    raise exception 'Only the owner, a manager, a doctor or a lab technician can change tests, packages and prices.' using errcode = '42501';
  elsif p_need = 'results' and coalesce(v_role in ('owner','manager','doctor','nurse','lab_technician'), false) is not true then
    raise exception 'Only a doctor, a manager, a nurse or a lab technician can enter results.' using errcode = '42501';
  elsif p_need = 'approve' and coalesce(v_role in ('owner','doctor'), false) is not true then
    raise exception 'Only a doctor (pathologist / radiologist) can approve a report.' using errcode = '42501';
  end if;
end $$;

notify pgrst, 'reload schema';
