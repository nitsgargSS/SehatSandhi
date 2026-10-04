-- ============================================================================
-- Sehatsandhi — patients book (and cancel) appointments inside the app
--
-- Run AFTER 0197. Safe to re-run.
--
-- Until now the app's "Find a doctor" handed the booking to WhatsApp, because
-- only there was the patient's number proven. A patient signed in to the app
-- has proven it too (patient-otp, 0196), so the app books directly:
--
--   sehat_app_book(business, doctor, slot, name, age)
--       The signed-in number; the very slots the bot and the desk offer (open,
--       not full, not on leave, not elsewhere — sehat_open_windows); booked_via
--       'app', so Admin → Channels counts it as the app. The clinic's alerts
--       (email, push) fire from the existing insert triggers.
--   sehat_app_cancel_booking(id)
--       A booking on the signed-in number that has not happened yet.
-- ============================================================================

create or replace function sehat_app_book(
  p_business uuid, p_practitioner uuid, p_slot timestamptz,
  p_name text, p_age integer default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone text := sehat_my_phone();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_biz record;
  v_doc text;
  v_id uuid;
begin
  if v_name is null then raise exception 'Enter the patient''s name.' using errcode = 'P0001'; end if;
  if p_age is not null and (p_age < 0 or p_age > 120) then raise exception 'Check the age.' using errcode = 'P0001'; end if;

  select b.id, b.name, b.address, b.phone into v_biz
    from businesses b where b.id = p_business and b.status = 'active';
  if not found then raise exception 'This clinic is not taking bookings just now.' using errcode = 'P0001'; end if;
  select full_name into v_doc from practitioners where id = p_practitioner;

  -- sehat_open_windows lists a day's windows whatever the day; the past is not bookable.
  if p_slot is null or p_slot < now() + interval '10 minutes' then
    raise exception 'That time has passed. Choose a later time.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from sehat_open_windows(p_business, (p_slot at time zone 'Asia/Kolkata')::date, p_practitioner) w
     where w.window_start = p_slot and w.seats_left > 0) then
    raise exception 'That time has just filled up. Choose another time.' using errcode = 'P0001';
  end if;

  -- One person, one doctor, one day: a second tap must not book twice.
  if exists (
    select 1 from appointments a
     where sehat_normalise_phone(a.patient_phone) = v_phone
       and a.practitioner_id is not distinct from p_practitioner
       and a.business_id = p_business
       and lower(coalesce(a.patient_name, '')) = lower(v_name)
       and (a.slot_datetime at time zone 'Asia/Kolkata')::date = (p_slot at time zone 'Asia/Kolkata')::date
       and a.status in ('booked', 'confirmed')) then
    raise exception '% already has a booking with this doctor that day.', v_name using errcode = 'P0001';
  end if;

  insert into appointments (
    patient_phone, patient_name, patient_age, business_id, practitioner_id,
    slot_datetime, status, booked_via, last_actor, last_actor_detail
  ) values (
    v_phone, v_name, p_age, p_business, p_practitioner,
    p_slot, 'booked', 'app', 'patient', 'app'
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'doctor', v_doc, 'clinic', v_biz.name, 'address', v_biz.address,
    'phone', v_biz.phone, 'at', p_slot, 'name', v_name);
exception
  when check_violation then
    raise exception 'That time has just filled up. Choose another time.' using errcode = 'P0001';
end $$;

revoke all on function sehat_app_book(uuid, uuid, timestamptz, text, integer) from public, anon;
grant execute on function sehat_app_book(uuid, uuid, timestamptz, text, integer) to authenticated;


create or replace function sehat_app_cancel_booking(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  update appointments
     set status = 'cancelled', last_actor = 'patient', last_actor_detail = 'app'
   where id = p_id
     and sehat_normalise_phone(patient_phone) = v_phone
     and status in ('booked', 'confirmed')
     and slot_datetime > now();
  if not found then
    raise exception 'This booking cannot be cancelled here. Please call the clinic.' using errcode = 'P0001';
  end if;
end $$;

revoke all on function sehat_app_cancel_booking(uuid) from public, anon;
grant execute on function sehat_app_cancel_booking(uuid) to authenticated;

notify pgrst, 'reload schema';
