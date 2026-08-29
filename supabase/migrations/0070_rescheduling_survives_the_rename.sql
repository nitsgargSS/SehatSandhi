-- ============================================================================
-- Sehatsandhi — rescheduling has been broken since the rename
--
-- Run AFTER 0069. Safe to re-run.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- sehat_reschedule_appointment still selected appointments.doctor_id, a column
-- that stopped existing when 0037 split doctors into businesses and
-- practitioners. Calling it fails outright:
--
--     column "doctor_id" does not exist
--
-- 0045 went through the booking path and repaired what it found; this one was
-- missed because a function body is only checked when it runs, and rescheduling
-- had never run. It is not an obscure corner either — appointmentApi.ts:54 calls
-- it from the dashboard, and the WhatsApp flow offers it to the patient. Every
-- reschedule attempted since the rename would have failed.
--
-- Found by scripts/test-suite.mjs, which rescheduled a real appointment.
--
-- A sweep of every function body for pre-rename names turned up exactly one
-- more mention of doctor_id, clinic_id, clinic_users or doctors — and all of
-- those are in comments. This is the last of them.
--
-- ── THE SECOND BUG IN THE SAME FUNCTION ─────────────────────────────────────
-- It decided the appointment did not exist by testing whether the doctor came
-- back null:
--
--     select doctor_id into v_doctor from appointments where id = ...;
--     if v_doctor is null then raise exception 'no such appointment: %'
--
-- practitioner_id is nullable — bot_book_appointment books against a business
-- with no named practitioner, which is how a lab or a pharmacy is booked. So a
-- perfectly real appointment would be reported as missing. Uses FOUND instead,
-- which is the question actually being asked.
--
-- The clash check has to change with it: with no practitioner named, two
-- bookings clash when they are at the same business at the same moment, not
-- when they share a null.
-- ============================================================================

create or replace function sehat_reschedule_appointment(
  p_appointment_id uuid,
  p_new_slot timestamptz,
  p_actor text default 'clinic',
  p_reason text default null,
  p_actor_detail text default null
) returns appointments
language plpgsql
as $$
declare
  v_row      appointments;
  v_pract    uuid;
  v_business uuid;
  v_clash    integer;
begin
  select practitioner_id, business_id into v_pract, v_business
    from appointments where id = p_appointment_id;
  if not found then
    raise exception 'no such appointment: %', p_appointment_id;
  end if;

  -- Two patients in one slot is worse than a failed reschedule, so check first.
  -- Match on the practitioner when there is one, and on the business when there
  -- is not: `practitioner_id = null` is never true, so the old shape would have
  -- waved through every clash at a listing with no named doctor.
  select count(*) into v_clash from appointments
   where slot_datetime = p_new_slot
     and id <> p_appointment_id
     and status in ('booked', 'confirmed')
     and case when v_pract is null
              then business_id = v_business and practitioner_id is null
              else practitioner_id = v_pract
         end;
  if v_clash > 0 then
    raise exception 'that slot is already taken';
  end if;

  update appointments set
    previous_slot_datetime = slot_datetime,
    slot_datetime          = p_new_slot,
    rescheduled_at         = now(),
    rescheduled_by         = p_actor,
    reschedule_count       = coalesce(reschedule_count, 0) + 1,
    cancel_reason          = p_reason,
    -- a rescheduled appointment needs confirming again
    status                 = case when status = 'cancelled' then 'booked' else status end,
    last_actor             = p_actor,
    last_actor_detail      = p_actor_detail
  where id = p_appointment_id
  returning * into v_row;

  return v_row;
end $$;

comment on function sehat_reschedule_appointment is
  'Fixed in 0070. Selected doctor_id, dropped in 0037, so every reschedule since '
  'has failed at runtime; and treated a null practitioner as a missing '
  'appointment, which a lab booking legitimately is.';


-- ============================================================================
-- NOT DONE HERE, AND WORTH DECIDING
--
-- This function writes p_reason into `cancel_reason` on a reschedule. The
-- appointment is not cancelled, so a rescheduled booking ends up carrying what
-- reads as a cancellation reason, and anything rendering that column will show
-- it. The reason is already recorded properly on the appointment_events row
-- that the trigger writes, which is where it belongs.
--
-- Left alone because it is a behaviour change rather than a repair, and the
-- dashboard may be reading the column today. Worth a look next time somebody is
-- in this file.
-- ============================================================================
