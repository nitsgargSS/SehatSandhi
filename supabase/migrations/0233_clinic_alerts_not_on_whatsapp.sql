-- ============================================================================
-- 0233 — A clinic is told of a booking by email and in the app, not on WhatsApp
-- ============================================================================
-- AFTER 0232. Safe to re-run.
--
-- The first booking alert sent through our own Meta account (11 Oct 2026) was
-- billed: a message we start is a paid template, and this one Sehatsandhi
-- pays for, on every booking. The clinic already gets the booking by email
-- (0136) and as a notification in the app (push_on_appointment). Decided the
-- same day: no WhatsApp alert to the clinic.
--
--   messaging_settings.clinic_alerts_whatsapp — off. While off, a new booking
--        queues no WhatsApp message for the clinic, and a patient's
--        cancellation or change reaches it as an app notification instead.
--        On, both go on WhatsApp as before.
--
-- Messages to the PATIENT (their appointment moved or cancelled by the clinic)
-- are untouched.
-- ============================================================================

alter table messaging_settings add column if not exists clinic_alerts_whatsapp boolean not null default false;

create or replace function sehat_clinic_alerts_on_whatsapp()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select clinic_alerts_whatsapp from messaging_settings limit 1), false);
$$;
revoke all on function sehat_clinic_alerts_on_whatsapp() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sehat_appointment_booked()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_who text;
  v_phone text;
begin
  -- Imports and backfills land historic rows. Telling a business about an
  -- appointment that already happened is noise, not news.
  if new.slot_datetime is null or new.slot_datetime < now() then
    return new;
  end if;
  if new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  insert into appointment_events (
    appointment_id, business_id, practitioner_id, event, actor, actor_detail,
    to_status, to_slot
  ) values (
    new.id, new.business_id, new.practitioner_id, 'booked',
    coalesce(new.last_actor, 'patient'),
    coalesce(new.last_actor_detail, new.booked_via),
    new.status, new.slot_datetime
  );

  -- A business booking at its own front desk does not need telling about it.
  if coalesce(new.last_actor, 'patient') in ('clinic', 'admin') then
    return new;
  end if;

  -- 0233: the clinic hears of a booking by email and in the app, which cost
  -- nothing. A WhatsApp alert is a paid template message, sent only if switched on.
  if not sehat_clinic_alerts_on_whatsapp() then
    return new;
  end if;

  select coalesce(
           (select p.full_name from practitioners p where p.id = new.practitioner_id),
           b.name),
         b.phone
    into v_who, v_phone
    from businesses b where b.id = new.business_id;

  insert into notification_outbox (appointment_id, recipient, phone, event, payload)
  values (
    new.id, 'clinic', v_phone, 'booked',
    jsonb_build_object(
      'patient_name', new.patient_name,
      'patient_phone', new.patient_phone,
      'doctor_name', v_who,
      'new_slot', new.slot_datetime,
      'booked_via', new.booked_via
    )
  );

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.sehat_appointment_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event text;
  v_doctor_name text;
  v_slot_changed boolean := new.slot_datetime is distinct from old.slot_datetime;
  v_status_changed boolean := new.status is distinct from old.status;
begin
  if not v_slot_changed and not v_status_changed then
    return new;
  end if;

  -- A slot move is a reschedule even when the status is untouched; a status
  -- change to cancelled during a move is still a cancellation.
  v_event := case
    when v_status_changed and new.status = 'cancelled' then 'cancelled'
    when v_status_changed and new.status = 'no_show'   then 'no_show'
    when v_status_changed and new.status = 'completed' then 'completed'
    when v_status_changed and new.status = 'confirmed' then 'confirmed'
    when v_slot_changed then 'rescheduled'
    else 'updated'
  end;

  insert into appointment_events (
    appointment_id, business_id, practitioner_id, event, actor, actor_detail,
    from_status, to_status, from_slot, to_slot, reason
  ) values (
    new.id, new.business_id, new.practitioner_id, v_event,
    coalesce(new.last_actor, 'system'), new.last_actor_detail,
    old.status, new.status, old.slot_datetime, new.slot_datetime,
    new.cancel_reason
  );

  -- Only events the other party actually needs to act on. 'completed' and
  -- 'no_show' are record-keeping: messaging a patient to say they did not turn
  -- up is a bad message to send, and one nobody can do anything about.
  if v_event not in ('cancelled', 'rescheduled', 'confirmed') then
    return new;
  end if;

  -- Name the doctor when the booking has one, the business otherwise. This used
  -- to be coalesce(clinic_name, name) off the listing, which was the best it
  -- could do when a listing was the only thing an appointment pointed at.
  select coalesce(
           (select p.full_name from practitioners p where p.id = new.practitioner_id),
           b.name)
    into v_doctor_name
    from businesses b where b.id = new.business_id;

  -- Tell the party who did NOT make the change. A clinic cancelling must reach
  -- the patient; a patient cancelling must reach the clinic.
  if coalesce(new.last_actor, 'system') = 'patient' and not sehat_clinic_alerts_on_whatsapp() then
    -- 0233: told in the app, not by a paid WhatsApp message.
    perform sehat_queue_push('appointment', new.business_id,
      array[(select p.auth_uid from practitioners p where p.id = new.practitioner_id),
            (select b.auth_uid from businesses b where b.id = new.business_id)],
      case v_event when 'cancelled' then 'Appointment cancelled' when 'rescheduled' then 'Appointment moved' else 'Appointment updated' end,
      coalesce(split_part(new.patient_name, ' ', 1), 'A patient') || ' · '
        || to_char(coalesce(case when v_event = 'cancelled' then old.slot_datetime end, new.slot_datetime) at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM')
        || case when v_event = 'rescheduled' then ' (was ' || to_char(old.slot_datetime at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || ')' else '' end,
      jsonb_build_object('kind', 'appointment', 'appointment_id', new.id));
  elsif coalesce(new.last_actor, 'system') = 'patient' then
    insert into notification_outbox (appointment_id, recipient, phone, event, payload)
    select new.id, 'clinic', b.phone, v_event,
           jsonb_build_object('patient_name', new.patient_name, 'doctor_name', v_doctor_name,
                              'old_slot', old.slot_datetime, 'new_slot', new.slot_datetime,
                              'reason', new.cancel_reason)
      from businesses b where b.id = new.business_id;
  else
    insert into notification_outbox (appointment_id, recipient, phone, event, payload)
    values (new.id, 'patient', new.patient_phone, v_event,
            jsonb_build_object('patient_name', new.patient_name, 'doctor_name', v_doctor_name,
                               'old_slot', old.slot_datetime, 'new_slot', new.slot_datetime,
                               'reason', new.cancel_reason));
  end if;

  return new;
end $function$;

notify pgrst, 'reload schema';
