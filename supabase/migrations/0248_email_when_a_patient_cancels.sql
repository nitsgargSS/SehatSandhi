-- ============================================================================
-- 0248 — The clinic is emailed when a patient cancels an appointment
-- ============================================================================
-- AFTER 0247. Safe to re-run.
--
-- A new booking is emailed to the clinic (0136); a patient cancelling one was
-- not, and booking alerts no longer go to clinics on WhatsApp (0233). The
-- clinic and the doctor are now emailed when the patient cancels a booking
-- that was still to come — from the app, WhatsApp or the website. A
-- cancellation by the clinic itself, or by Sehatsandhi, is not emailed back.
-- ============================================================================

alter table email_outbox drop constraint if exists email_outbox_kind_check;
alter table email_outbox add constraint email_outbox_kind_check check (kind = any (array[
  'business_welcome', 'admin_new_business', 'clinic_new_booking', 'doctor_invite', 'nurse_unassigned',
  'wa_broadcast_rejected', 'signup_reminder', 'wa_broadcast_waiting', 'clinic_booking_cancelled']));
create unique index if not exists email_outbox_cancelled_once_idx
  on email_outbox (appointment_id) where kind = 'clinic_booking_cancelled';

create or replace function sehat_queue_cancel_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status in ('booked', 'confirmed')
     and (new.cancelled_by = 'patient' or (new.cancelled_by is null and new.last_actor = 'patient'))
     and new.slot_datetime > now() - interval '1 hour' then
    insert into email_outbox (kind, business_id, appointment_id)
    values ('clinic_booking_cancelled', new.business_id, new.id)
    on conflict do nothing;
  end if;
  return new;
exception when others then
  return new;   -- an email that cannot be queued must never stop a cancellation
end $$;

drop trigger if exists appointments_queue_cancel_email on appointments;
create trigger appointments_queue_cancel_email
  after update of status on appointments
  for each row execute function sehat_queue_cancel_email();
