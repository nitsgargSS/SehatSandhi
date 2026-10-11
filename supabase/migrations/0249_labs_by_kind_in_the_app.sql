-- ============================================================================
-- 0249 — In the app too: labs by kind of test, and a scan only at the centre
-- ============================================================================
-- AFTER 0248. Safe to re-run.
--
-- 0245 taught the WhatsApp bot that a blood test and a scan are different
-- labs, and that a scan is never a home collection. The app still listed
-- every lab for every test and took a home collection for an MRI.
--   • sehat_labs_near: the labs near a place that do one kind of test, with
--     each lab's offer line (0246) — what the app's search now lists.
--   • sehat_lab_order_place refuses a home collection that includes a scan,
--     or at a centre that does no pathology — whoever asks.
-- ============================================================================

create or replace function sehat_labs_near(p_pincode text, p_kind text default null)
returns table (business_id uuid, title text, phone text, address text, avg_rating numeric, total_reviews bigint, offer text, kinds text[])
language sql stable security definer set search_path = public as $$
  select b.business_id, b.title, b.phone, b.address, b.avg_rating, b.total_reviews,
         nullif(btrim(x.lab_offer), ''), x.lab_categories
    from bot_bookable('business', 'lab', bot_pincode(p_pincode)) b
    join businesses x on x.id = b.business_id
   where sehat_lab_does(b.business_id, nullif(btrim(coalesce(p_kind, '')), ''))
   order by b.rn;
$$;
revoke all on function sehat_labs_near(text, text) from public;
grant execute on function sehat_labs_near(text, text) to anon, authenticated, service_role;

create or replace function sehat_lab_order_place(
  p_phone text, p_source text, p_business uuid, p_tests uuid[], p_packages uuid[], p_collection text,
  p_slot timestamptz, p_name text, p_age integer default null, p_address text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public
AS $function$
declare
  v_phone text := coalesce(sehat_normalise_phone(p_phone), p_phone);
  v_app boolean := coalesce(p_source, 'app') = 'app';
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_home boolean := p_collection = 'home';
  v_biz record;
  v_appt uuid;
  v_member uuid;
  v_order uuid;
  v_names text;
  v_no text;
  v_total numeric;
  v_menu boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_phone is null then raise exception 'We could not read the mobile number.' using errcode = 'P0001'; end if;
  -- 0206: the Play review number never reaches a real business.
  if right(v_phone, 10) = '9416479792' and (now() at time zone 'Asia/Kolkata')::date <= date '2026-12-31'
     and p_business is distinct from (select id from businesses where lower(email) = 'nits.garg+playreview@gmail.com') then
    raise exception 'Demo account (app review): bookings and requests are not sent to real clinics, pharmacies, ambulances or advisors. Everything else works, including messages to Sehatsandhi Demo Clinic.'
      using errcode = 'P0001';
  end if;
  if v_name is null then raise exception 'Enter the patient''s name.' using errcode = 'P0001'; end if;
  if p_age is not null and (p_age < 0 or p_age > 120) then raise exception 'Check the age.' using errcode = 'P0001'; end if;
  if coalesce(p_collection, '') not in ('lab', 'home') then raise exception 'Choose sample at the lab or at home.' using errcode = 'P0001'; end if;
  if v_home and btrim(coalesce(p_address, '')) = '' then raise exception 'Give the address for home collection.' using errcode = 'P0001'; end if;
  -- 0249: a scan is done at the centre — from the app as from WhatsApp.
  if v_home and (exists (select 1 from lab_tests t where t.id = any(coalesce(p_tests, '{}')) and t.business_id = p_business
                           and t.category in ('radiology', 'cardiology'))
                 or not sehat_lab_does(p_business, 'pathology')) then
    raise exception 'A scan is done at the centre, not as a home collection. Choose "At the lab".' using errcode = 'P0001';
  end if;

  select b.id, b.name, b.address, b.phone into v_biz
    from businesses b where b.id = p_business and b.status = 'active' and (b.vertical = 'lab' or coalesce(b.lab_module, false));
  if not found then raise exception 'This lab is not taking orders just now.' using errcode = 'P0001'; end if;
  v_menu := exists (select 1 from lab_tests t where t.business_id = p_business and t.is_active)
         or exists (select 1 from lab_packages p where p.business_id = p_business and p.is_active);
  -- 0245: with nothing chosen but the tests written (WhatsApp: "the lab will
  -- advise the package"), it is an order by words, as at a lab with no list.
  if coalesce(array_length(p_tests, 1), 0) + coalesce(array_length(p_packages, 1), 0) = 0 then
    if v_menu and v_note is null then raise exception 'Choose at least one test or package.' using errcode = 'P0001'; end if;
    v_menu := false;
  end if;
  if not v_menu and v_note is null then
    raise exception 'Write which tests you need — this lab has not listed its prices yet.' using errcode = 'P0001';
  end if;

  -- A time the lab has open (its booking hours: the counter, or its collectors).
  if p_slot is null or p_slot < now() + interval '10 minutes' then
    raise exception 'That time has passed. Choose a later time.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sehat_open_windows(p_business, (p_slot at time zone 'Asia/Kolkata')::date, null) w
                  where w.window_start = p_slot and w.seats_left > 0) then
    raise exception 'That time has just filled up. Choose another time.' using errcode = 'P0001';
  end if;

  if v_menu then
    select string_agg(n, ', ') into v_names from (
      select p.name n from lab_packages p where p.id = any(coalesce(p_packages, '{}')) and p.business_id = p_business and p.is_active
      union all
      select t.name from lab_tests t where t.id = any(coalesce(p_tests, '{}')) and t.business_id = p_business and t.is_active
    ) x;
    if v_names is null then raise exception 'None of those tests are available at this lab.' using errcode = 'P0001'; end if;
  else
    v_names := v_note;
  end if;

  -- The appointment (sehat_appointment_links_patient finds or makes the family member).
  insert into appointments (patient_phone, patient_name, patient_age, business_id, practitioner_id,
                            slot_datetime, status, booked_via, last_actor, last_actor_detail, purpose)
  values (v_phone, v_name, p_age, p_business, null, p_slot, 'booked', case when v_app then 'app' else 'whatsapp_bot' end, 'patient', case when v_app then 'app' else 'whatsapp' end,
          left('Lab tests: ' || v_names || case when v_home then ' · home collection: ' || btrim(p_address) else ' · sample at the lab' end, 500))
  returning id, patient_member_id into v_appt, v_member;
  if v_member is null then
    raise exception 'Could not register the patient at this lab. Please try again.' using errcode = 'P0001';
  end if;

  if v_menu then
    v_order := sehat_lab_order_insert(p_business, v_member, p_tests, p_packages, null,
      case when v_home then 'home' else 'lab' end, case when v_home then p_address end, 'routine', v_note, null,
      p_slot, null, case when v_app then 'app' else 'whatsapp' end, null, null, null, auth.uid(), v_name || case when v_app then ' (app)' else ' (WhatsApp)' end);
    update lab_orders set appointment_id = v_appt where id = v_order returning order_no into v_no;
    select coalesce(sum(c.amount), 0) into v_total from patient_charges c
     where c.business_id = p_business and c.patient_member_id = v_member and c.description like '%(' || v_no || ')%';
  end if;

  -- Tell the lab.
  perform sehat_queue_push('lab_order', p_business, sehat_mo_users(p_business, array['owner', 'manager', 'receptionist', 'nurse', 'doctor']),
    case when v_home then '🏠 Home collection booked' else '🧪 Lab tests booked' end,
    v_name || ' · ' || to_char(p_slot at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || ' · ' || left(v_names, 120),
    jsonb_build_object('kind', 'lab_order', 'order_id', v_order, 'appointment_id', v_appt));

  return jsonb_build_object('order_id', v_order, 'order_no', v_no, 'appointment_id', v_appt, 'lab', v_biz.name,
    'address', v_biz.address, 'phone', v_biz.phone, 'at', p_slot, 'collection', case when v_home then 'home' else 'lab' end,
    'tests', v_names, 'total', v_total, 'name', v_name);
exception
  when check_violation then
    raise exception 'That time has just filled up. Choose another time.' using errcode = 'P0001';
end $function$;;

notify pgrst, 'reload schema';
