-- 0206: a demo clinic and demo patient for the Google Play reviewer.
--
-- Google needs working logins to review the app. This makes:
--   • "Sehatsandhi Demo Clinic (Play review)" — status 'pending', so it is never
--     listed to patients (public search, the bot and the app list only
--     'active' businesses) yet its staff can sign in and use everything.
--     DO NOT APPROVE it; the note on it says so.
--   • its doctor, "Dr Demo Reviewer" (General), signing in with
--     nits.garg+playreview@gmail.com — the owner signs in once with the email
--     code, sets a password in the app, and gives Google that email and
--     password. Booking hours every day 09:00–20:00.
--   • a demo patient family on 9416479792 (a spare SIM of ours) with two past
--     visits. The reviewer signs in to the patient side with the fixed code set
--     in patient-otp's REVIEW_* secrets (until 31 Dec 2026).
--   • a guard (below): the demo number can never reach a real business.
-- Safe to run again: everything is found by its email / phone first.
do $$
declare
  v_email text := 'nits.garg+playreview@gmail.com';
  v_phone text := sehat_patient_phone('9416479792');
  v_biz uuid;
  v_doc uuid;
  v_bp uuid;
  v_loc uuid;
  v_patient uuid;
  v_self uuid;
  v_child uuid;
  d int;
begin
  select id into v_biz from businesses where lower(email) = v_email;
  if v_biz is null then
    insert into businesses (name, vertical, status, email, phone, address, own_pin_code, own_city, own_district, own_state,
                            pin_codes, opd_module, ipd_module, verification_notes)
    values ('Sehatsandhi Demo Clinic (Play review)', 'clinic', 'pending', v_email, '918570889188',
            'Demo address — not a real clinic, Yamuna Nagar', '135001', 'Yamuna Nagar', 'Yamuna Nagar', 'Haryana',
            array['135001'], true, false,
            'PLAY STORE REVIEW DEMO (0206) — DO NOT APPROVE. Kept pending so patients never see it; logins work for Google''s reviewer.')
    returning id into v_biz;
  end if;

  select id into v_doc from practitioners where lower(email) = v_email;
  if v_doc is null then
    insert into practitioners (full_name, speciality, qualification, email, status)
    values ('Dr Demo Reviewer', 'GEN', 'MBBS (demo)', v_email, 'active')
    returning id into v_doc;
  end if;

  select id into v_bp from business_practitioners where business_id = v_biz and practitioner_id = v_doc;
  if v_bp is null then
    insert into business_practitioners (business_id, practitioner_id, role, is_primary, status, consultation_fee, can_login_web)
    values (v_biz, v_doc, 'doctor', true, 'active', 300, true)
    returning id into v_bp;
  else
    update business_practitioners set status = 'active', can_login_web = true where id = v_bp;
  end if;

  select id into v_loc from practice_locations where business_id = v_biz order by is_primary desc nulls last limit 1;
  if v_loc is null then
    insert into practice_locations (business_id, name, address, pin_code, is_primary, is_active, city, district, state)
    values (v_biz, 'Demo Clinic', 'Demo address — not a real clinic', '135001', true, true, 'Yamuna Nagar', 'Yamuna Nagar', 'Haryana')
    returning id into v_loc;
  end if;

  if not exists (select 1 from availability where business_practitioner_id = v_bp) then
    for d in 0..6 loop
      insert into availability (business_id, day_of_week, start_time, end_time, slot_duration_minutes, slot_capacity, is_active, business_practitioner_id)
      values (v_biz, d, '09:00', '20:00', 30, 3, true, v_bp);
    end loop;
  end if;

  -- The demo patient family, with history at the demo clinic.
  select id into v_patient from patients where phone = v_phone;
  if v_patient is null then
    insert into patients (phone) values (v_phone) returning id into v_patient;
  end if;
  select id into v_self from patient_members where patient_id = v_patient and full_name = 'Demo Patient';
  if v_self is null then
    insert into patient_members (patient_id, full_name, relation, gender, age_years, is_self)
    values (v_patient, 'Demo Patient', 'self', 'male', 35,
            not exists (select 1 from patient_members where patient_id = v_patient and is_self))
    returning id into v_self;
  end if;
  select id into v_child from patient_members where patient_id = v_patient and full_name = 'Demo Child';
  if v_child is null then
    insert into patient_members (patient_id, full_name, relation, gender, age_years, is_self)
    values (v_patient, 'Demo Child', 'child', 'female', 7, false)
    returning id into v_child;
  end if;
  perform sehat_link_patient_to_business(v_self, v_biz, 'walk_in', 'Play review demo (0206)');
  perform sehat_link_patient_to_business(v_child, v_biz, 'walk_in', 'Play review demo (0206)');

  if not exists (select 1 from patient_visits where business_id = v_biz) then
    insert into patient_visits (patient_id, patient_member_id, business_id, practitioner_id, visit_date, visit_type,
                                chief_complaint, diagnosis, advice, follow_up_due)
    values
      (v_patient, v_self, v_biz, v_doc, current_date - 14, 'opd',
       'Fever and cough for 3 days (demo)', 'Viral fever (demo)', 'Rest, plenty of fluids. Come back if the fever lasts beyond 5 days.', current_date - 7),
      (v_patient, v_child, v_biz, v_doc, current_date - 30, 'opd',
       'Ear pain (demo)', 'Ear infection (demo)', 'Keep the ear dry. Review in one week.', current_date - 23);
  end if;
end $$;

-- ── The demo patient never reaches a real business ───────────────────────────
-- The reviewer sees real clinics, pharmacies, ambulances and advisors in the
-- app. A booking, order, ambulance request, insurance request or message from
-- the demo number to any of them is refused here, in the database (whatever
-- screen or channel it comes from) — so nobody real is alerted. At the demo
-- clinic everything works. Ends with the review logins on 31 Dec 2026, after
-- which 9416479792 is an ordinary number again.
create or replace function sehat_review_demo_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if right(regexp_replace(coalesce(new.patient_phone, ''), '\D', '', 'g'), 10) <> '9416479792'
     or (now() at time zone 'Asia/Kolkata')::date > date '2026-12-31' then
    return new;
  end if;
  if tg_table_name in ('appointments', 'clinic_messages')
     and new.business_id = (select id from businesses where lower(email) = 'nits.garg+playreview@gmail.com') then
    return new;
  end if;
  raise exception 'Demo account (app review): bookings and requests are not sent to real clinics, pharmacies, ambulances or advisors. Everything else works, including messages to Sehatsandhi Demo Clinic.'
    using errcode = 'P0001';
end $$;
revoke all on function sehat_review_demo_guard() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['appointments', 'medicine_orders', 'ambulance_requests', 'insurance_leads', 'clinic_messages'] loop
    execute format('drop trigger if exists review_demo_guard on %I', t);
    execute format('create trigger review_demo_guard before insert on %I for each row execute function sehat_review_demo_guard()', t);
  end loop;
end $$;
