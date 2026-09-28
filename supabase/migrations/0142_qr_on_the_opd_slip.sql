-- ============================================================================
-- Sehatsandhi — the clinic's QR code on its OPD slip, and the number it opens
--
-- Run AFTER 0141. Safe to re-run.
--
-- sehat_business_wa_number: the WhatsApp number a clinic's QR code opens —
-- its own once its AiSensy account is live (partner plan), Sehatsandhi's
-- otherwise. The poster and the OPD slip both ask this, so switching a clinic
-- to its own number needs no reprint of anything but the QR image.
--
-- sehat_opd_slip (0135) now also returns the clinic's code and that number.
-- ============================================================================

create or replace function sehat_business_wa_number(p_business uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select regexp_replace(a.whatsapp_number, '\D', '', 'g')
       from business_wa_accounts a
      where a.business_id = p_business and a.status = 'live'
        and length(regexp_replace(coalesce(a.whatsapp_number, ''), '\D', '', 'g')) >= 10),
    '917015399355')
$$;
revoke all on function sehat_business_wa_number(uuid) from public, anon;
grant execute on function sehat_business_wa_number(uuid) to authenticated;

create or replace function public.sehat_opd_slip(p_queue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q opd_queue;
  v jsonb;
begin
  select * into q from opd_queue where id = p_queue;
  if q.id is null or not sehat_caller_owns_business(q.business_id) then
    raise exception 'No such token.' using errcode = 'no_data_found';
  end if;

  select jsonb_build_object(
    'clinic', (select jsonb_build_object('name', b.name, 'address', b.address, 'phone', b.phone,
                 'email', b.email, 'reg_number', b.reg_number, 'gstin', b.gstin, 'letterhead_url', b.letterhead_url, 'qr_code', b.qr_code, 'wa_number', sehat_business_wa_number(b.id))
                 from businesses b where b.id = q.business_id),
    'token', jsonb_build_object('number', q.token_number, 'date', q.queue_date, 'issued_at', q.created_at,
                 'reason', q.reason, 'priority', q.priority, 'priority_reason', q.priority_reason, 'status', q.status),
    'doctor', (select jsonb_build_object('name', p.full_name, 'speciality', p.speciality,
                 'qualification', p.qualification, 'reg_number', p.reg_number)
                 from practitioners p where p.id = q.practitioner_id),
    'patient', (select jsonb_build_object('name', m.full_name, 'age', m.age_years, 'gender', m.gender,
                 'blood_group', m.blood_group, 'phone', pt.phone, 'mrn', bp.mrn,
                 'visit_count', bp.visit_count)
                 from patient_members m
                 left join patients pt on pt.id = m.patient_id
                 left join business_patients bp on bp.business_id = q.business_id and bp.patient_member_id = m.id
                where m.id = q.patient_member_id),
    'vitals', (select to_jsonb(x) from (
                 select recorded_at, bp_systolic, bp_diastolic, pulse, temperature_c, weight_kg, height_cm,
                        spo2, blood_sugar_mg_dl, blood_sugar_type, notes
                   from patient_vitals
                  where patient_member_id = q.patient_member_id and business_id = q.business_id
                    and recorded_at::date = q.queue_date
                  order by recorded_at desc limit 1) x),
    'allergies', coalesce((select jsonb_agg(jsonb_build_object('substance', a.substance, 'reaction', a.reaction,
                   'severity', a.severity) order by a.severity nulls last)
                   from patient_allergies a
                  where a.patient_member_id = q.patient_member_id and a.is_active), '[]'::jsonb),
    'conditions', coalesce((select jsonb_agg(c.condition)
                   from patient_conditions c
                  where c.patient_member_id = q.patient_member_id and c.business_id = q.business_id
                    and coalesce(c.status, 'active') = 'active'), '[]'::jsonb),
    'charge', (select jsonb_build_object('amount', c.amount, 'list_price', c.list_price,
                 'discount_kind', c.discount_kind, 'discount_reason', c.discount_reason)
                 from patient_charges c
                where c.business_id = q.business_id and c.patient_member_id = q.patient_member_id
                  and c.category = 'consultation' and c.charged_on = q.queue_date
                  and c.practitioner_id is not distinct from q.practitioner_id
                order by c.created_at desc limit 1)
  ) into v;
  return v;
end $function$;

notify pgrst, 'reload schema';
