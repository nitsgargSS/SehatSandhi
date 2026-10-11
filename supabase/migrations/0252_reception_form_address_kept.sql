-- ============================================================================
-- 0252 — The address typed on the reception form is kept on the patient
-- ============================================================================
-- AFTER 0251. Safe to re-run.
--
-- A patient may give their address and PIN code on the reception form (0251).
-- When the receptionist gives the token, the entry is closed against the
-- patient it became, and the address goes onto that patient's record — by
-- whoever is at the desk, not only the clinic's owner. A PIN code already on
-- record is left alone; the address is what the patient wrote today.
-- ============================================================================

drop function if exists sehat_clinic_checkin_close(uuid, text);
create or replace function sehat_clinic_checkin_close(p_id uuid, p_status text, p_member uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare c clinic_checkins;
begin
  if p_status not in ('registered', 'dismissed') then raise exception 'unknown status' using errcode = 'P0001'; end if;
  update clinic_checkins set status = p_status, handled_by = auth.uid(), handled_at = now()
   where id = p_id and business_id in (select sehat_caller_business_ids())
  returning * into c;
  if c.id is null then raise exception 'not your business' using errcode = '42501'; end if;

  if p_status = 'registered' and p_member is not null and (c.address is not null or c.pin_code is not null) then
    update patients p
       set address = coalesce(c.address, p.address),
           pin_code = coalesce(p.pin_code, c.pin_code)
      from patient_members m
      join business_patients bp on bp.patient_member_id = m.id and bp.business_id = c.business_id
     where m.id = p_member and p.id = m.patient_id;
  end if;
end $$;
revoke all on function sehat_clinic_checkin_close(uuid, text, uuid) from public, anon;
grant execute on function sehat_clinic_checkin_close(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
