-- ============================================================================
-- Sehatsandhi — a clinic records a patient's address
--
-- Run AFTER 0182. Safe to re-run.
--
-- Decided 30 Sep 2026: registering a patient asked for a PIN code but no
-- address, and there was no way to add one later. patients (the family's
-- account, one per phone number) has had address / city since the baseline.
-- Staff of a clinic the patient is registered with may set it — at
-- registration, or later from the patient's record.
-- ============================================================================

create or replace function sehat_set_patient_address(
  p_business uuid, p_member uuid, p_address text, p_city text default null, p_pin_code text default null
) returns void language plpgsql volatile security definer set search_path = public as $$
declare v_patient uuid;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  if not exists (select 1 from business_patients where business_id = p_business and patient_member_id = p_member) then
    raise exception 'That patient is not registered here.' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(p_pin_code, '')), '') is not null and btrim(p_pin_code) !~ '^[1-9][0-9]{5}$' then
    raise exception 'Enter a 6-digit PIN code.' using errcode = 'P0001';
  end if;
  select patient_id into v_patient from patient_members where id = p_member;
  update patients
     set address  = nullif(left(btrim(coalesce(p_address, '')), 300), ''),
         city     = coalesce(nullif(left(btrim(coalesce(p_city, '')), 80), ''), city),
         pin_code = coalesce(nullif(btrim(coalesce(p_pin_code, '')), ''), pin_code),
         updated_at = now()
   where id = v_patient;
end $$;
revoke all on function sehat_set_patient_address(uuid, uuid, text, text, text) from public, anon;
grant execute on function sehat_set_patient_address(uuid, uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
