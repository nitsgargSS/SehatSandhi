-- ============================================================================
-- Sehatsandhi — vitals travel with the token; the desk books appointments
--
-- Run AFTER 0151. Safe to re-run.
--
-- Decided 28 Sep 2026:
--
--   • When a patient's vitals are recorded, today's open queue token for them
--     is stamped vitals_at. Everyone on the queue sees "Vitals ✓" — reception
--     included, although reception cannot read the numbers (0149). The doctor
--     and the patient's nurse see the numbers on the queue and when the
--     patient is opened.
--   • The desk can book an appointment into a real open slot for a doctor
--     (sehat_desk_book). It uses the same slots the bot offers, so leave,
--     clashes with other clinics and full slots are all respected; the leave
--     trigger (0150) refuses anything that slips through.
-- ============================================================================

-- ── Vitals done ─────────────────────────────────────────────────────────────
alter table opd_queue add column if not exists vitals_at timestamptz;

create or replace function sehat_vitals_stamp_queue()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update opd_queue q
     set vitals_at = coalesce(q.vitals_at, now())
   where q.business_id = new.business_id
     and q.patient_member_id = new.patient_member_id
     and q.queue_date = (now() at time zone 'Asia/Kolkata')::date
     and q.status not in ('completed', 'cancelled', 'no_show');
  return null;
end $$;

drop trigger if exists vitals_stamp_queue on patient_vitals;
create trigger vitals_stamp_queue after insert on patient_vitals
  for each row execute function sehat_vitals_stamp_queue();

-- ── Booking at the desk ─────────────────────────────────────────────────────
create or replace function sehat_desk_book(
  p_business uuid, p_practitioner uuid, p_slot timestamptz,
  p_name text, p_phone text, p_age integer default null
) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'You do not work at this clinic.' using errcode = '42501';
  end if;
  if not sehat_nurse_may_see_doctor(p_business, p_practitioner) then
    raise exception 'You can book only for the doctors you work with.' using errcode = '42501';
  end if;
  if v_phone is null then raise exception 'Enter a 10-digit mobile number.' using errcode = 'P0001'; end if;
  if v_name is null then raise exception 'Enter the patient''s name.' using errcode = 'P0001'; end if;
  if p_age is not null and (p_age < 0 or p_age > 120) then raise exception 'Check the age.' using errcode = 'P0001'; end if;

  -- The very slots the bot offers: open, not full, not on leave, not elsewhere.
  if not exists (
    select 1 from sehat_open_windows(p_business, (p_slot at time zone 'Asia/Kolkata')::date, p_practitioner) w
     where w.window_start = p_slot and w.seats_left > 0) then
    raise exception 'That time is not free. Choose another slot.' using errcode = 'P0001';
  end if;

  insert into appointments (
    patient_phone, patient_name, patient_age, business_id, practitioner_id,
    slot_datetime, status, booked_via, last_actor, last_actor_detail
  ) values (
    v_phone, v_name, p_age, p_business, p_practitioner,
    p_slot, 'booked', 'desk', 'clinic', coalesce((select email from auth.users where id = auth.uid()), 'desk')
  ) returning id into v_id;
  return v_id;
end $$;

revoke all on function sehat_desk_book(uuid, uuid, timestamptz, text, text, integer) from public, anon;
grant execute on function sehat_desk_book(uuid, uuid, timestamptz, text, text, integer) to authenticated;

notify pgrst, 'reload schema';
