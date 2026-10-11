-- ============================================================================
-- 0241 — A patient who said STOP is asked again when they next write
-- ============================================================================
-- AFTER 0240. Safe to re-run.
--
-- After STOP nobody tells the patient how to get a clinic's updates back.
-- When they next write to the clinics' number, the clinic's menu says their
-- updates are off and offers the button that turns them on again — beside
-- booking, which works either way. This tells the bot which clinics that is.
-- ============================================================================

create or replace function sehat_wa_stopped_clinics(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  return jsonb_build_object(
    'all', exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(v_phone)),
    'codes', coalesce((
      select jsonb_agg(distinct b.qr_code)
        from patients p
        join patient_members m on m.patient_id = p.id
        join business_patients bp on bp.patient_member_id = m.id
        join businesses b on b.id = bp.business_id and b.qr_code is not null
       where p.phone = v_phone and not sehat_marketing_allowed(m.id, bp.business_id)), '[]'::jsonb));
end $$;
revoke all on function sehat_wa_stopped_clinics(text) from public, anon, authenticated;
grant execute on function sehat_wa_stopped_clinics(text) to service_role;

notify pgrst, 'reload schema';
