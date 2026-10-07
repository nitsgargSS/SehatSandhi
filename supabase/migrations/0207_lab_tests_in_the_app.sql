-- 0207: patients book lab tests in the app — choose the tests, sample at the
-- lab or at home, and a time.
--
-- Until now a lab order was made only by the lab's staff (0168). Now a signed-
-- in patient can make one too:
--   • sehat_lab_menu(lab)       — the lab's tests and packages with prices and
--                                  its home-collection fee (public, like a price list)
--   • sehat_app_lab_order(...)  — the order, for 'lab' (sample given at the lab)
--                                  or 'home' (collected from the address), at a
--                                  time the lab has open — booked as a real
--                                  appointment, so it is in the lab's Bookings
--                                  with what it is for (appointments.purpose),
--                                  and the lab's staff get an alert.
-- The order itself is made by the same code as the lab's own orders
-- (sehat_lab_order_insert, split out of 0168's sehat_lab_create_order), so the
-- two cannot drift: same items, same charges, same home-collection line.
-- The patient pays the lab (at the counter or to the collector); the report
-- reaches them in My records as before.

alter table lab_orders drop constraint if exists lab_orders_source_check;
alter table lab_orders add constraint lab_orders_source_check check (source in ('desk', 'doctor', 'app'));
alter table lab_orders add column if not exists appointment_id uuid references appointments(id) on delete set null;
alter table appointments add column if not exists purpose text;
comment on column appointments.purpose is
  '0207: what a booking is for when it is not a consultation, e.g. "Lab tests: CBC, HbA1c · home collection". Shown in Bookings.';

-- ── 1. One way to write an order (0168's body, unchanged) ────────────────────
create or replace function sehat_lab_order_insert(
  p_business uuid, p_member uuid, p_test_ids uuid[], p_package_ids uuid[], p_visit_id uuid,
  p_collection text, p_address text, p_priority text, p_notes text, p_referred_by text,
  p_slot timestamptz, p_home_fee numeric, p_source text, p_ordered_by uuid, p_ordered_by_name text,
  p_recorded_by uuid, p_created_by uuid, p_created_by_name text
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_order uuid; pk record; t record; v_seen uuid[] := '{}'; i integer := 0;
begin
  insert into lab_orders (business_id, order_no, patient_member_id, visit_id, source, ordered_by, ordered_by_name, referred_by,
                          collection, collection_address, collection_slot, home_fee, priority, notes, created_by, created_by_name)
  values (p_business, sehat_lab_next_number(p_business, 'order'), p_member, p_visit_id,
          p_source, p_ordered_by, p_ordered_by_name,
          nullif(btrim(coalesce(p_referred_by,'')), ''),
          case when p_collection = 'home' then 'home' else 'lab' end, nullif(btrim(coalesce(p_address,'')), ''),
          p_slot,
          case when p_collection = 'home'
               then greatest(coalesce(p_home_fee, (select lab_home_fee from businesses where id = p_business), 0), 0) else 0 end,
          case when p_priority = 'urgent' then 'urgent' else 'routine' end, nullif(btrim(coalesce(p_notes,'')), ''),
          p_created_by, p_created_by_name)
  returning id into v_order;

  for pk in select * from lab_packages where id = any(coalesce(p_package_ids,'{}')) and business_id = p_business and is_active loop
    insert into patient_charges (business_id, patient_member_id, visit_id, category, description, quantity, unit_price, amount, recorded_by)
    values (p_business, p_member, p_visit_id, 'lab', 'Lab package: ' || pk.name || ' (' || (select order_no from lab_orders where id = v_order) || ')',
            1, pk.price, pk.price, p_recorded_by);
    for t in select lt.* from lab_package_tests x join lab_tests lt on lt.id = x.test_id where x.package_id = pk.id order by lt.name loop
      continue when t.id = any(v_seen);
      insert into lab_order_items (order_id, test_id, package_id, package_name, name, category, department, report_kind, sort_order)
      values (v_order, t.id, pk.id, pk.name, t.name, t.category, t.department, t.report_kind, i);
      v_seen := v_seen || t.id; i := i + 1;
    end loop;
  end loop;

  for t in select * from lab_tests where id = any(coalesce(p_test_ids,'{}')) and business_id = p_business and is_active order by name loop
    continue when t.id = any(v_seen);
    insert into patient_charges (business_id, patient_member_id, visit_id, category, description, quantity, unit_price, amount, recorded_by)
    values (p_business, p_member, p_visit_id, 'lab', 'Lab: ' || t.name || ' (' || (select order_no from lab_orders where id = v_order) || ')',
            1, t.price, t.price, p_recorded_by);
    insert into lab_order_items (order_id, test_id, name, category, department, report_kind, sort_order)
    values (v_order, t.id, t.name, t.category, t.department, t.report_kind, i);
    v_seen := v_seen || t.id; i := i + 1;
  end loop;

  if i = 0 then raise exception 'None of those tests are active at this lab.' using errcode = 'P0001'; end if;

  -- The home visit is its own line on the bill.
  insert into patient_charges (business_id, patient_member_id, visit_id, category, description, quantity, unit_price, amount, recorded_by)
  select p_business, p_member, p_visit_id, 'lab', 'Home sample collection (' || o.order_no || ')', 1, o.home_fee, o.home_fee, p_recorded_by
    from lab_orders o where o.id = v_order and o.home_fee > 0;
  return v_order;
end $$;
revoke all on function sehat_lab_order_insert(uuid, uuid, uuid[], uuid[], uuid, text, text, text, text, text, timestamptz, numeric, text, uuid, text, uuid, uuid, text) from public, anon, authenticated;

-- The lab's own order (0168): the same checks, then the shared body.
create or replace function sehat_lab_create_order(
  p_business uuid, p_member uuid,
  p_test_ids uuid[] default '{}', p_package_ids uuid[] default '{}',
  p_visit_id uuid default null, p_collection text default 'lab', p_address text default null,
  p_priority text default 'routine', p_notes text default null, p_referred_by text default null,
  p_slot timestamptz default null, p_home_fee numeric default null
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_role text := sehat_caller_role(p_business); v_me uuid := sehat_caller_practitioner_id(); v_name text := sehat_lab_staff_name(p_business);
begin
  perform sehat_lab_check(p_business, 'staff');
  if coalesce(array_length(p_test_ids,1),0) + coalesce(array_length(p_package_ids,1),0) = 0 then
    raise exception 'Choose at least one test or package.' using errcode = '22023';
  end if;
  if not exists (select 1 from business_patients bp where bp.business_id = p_business and bp.patient_member_id = p_member) then
    raise exception 'Register the patient at this lab first.' using errcode = 'P0002';
  end if;
  if p_collection = 'home' and btrim(coalesce(p_address,'')) = '' then
    raise exception 'Give the address for home collection.' using errcode = '22023';
  end if;
  if p_visit_id is not null and not exists (select 1 from patient_visits v where v.id = p_visit_id and v.business_id = p_business and v.patient_member_id = p_member) then
    raise exception 'That visit is not this patient''s here.' using errcode = 'P0002';
  end if;
  return sehat_lab_order_insert(p_business, p_member, p_test_ids, p_package_ids, p_visit_id, p_collection, p_address,
    p_priority, p_notes, p_referred_by,
    case when p_collection = 'home' then p_slot end, p_home_fee,
    case when v_role = 'doctor' then 'doctor' else 'desk' end,
    case when v_role in ('doctor','owner') then v_me end,
    case when v_role in ('doctor','owner') then v_name end,
    v_me, auth.uid(), v_name);
end $$;
revoke all on function sehat_lab_create_order(uuid, uuid, uuid[], uuid[], uuid, text, text, text, text, text, timestamptz, numeric) from public, anon;
grant execute on function sehat_lab_create_order(uuid, uuid, uuid[], uuid[], uuid, text, text, text, text, text, timestamptz, numeric) to authenticated;

-- ── 2. The price list ────────────────────────────────────────────────────────
create or replace function sehat_lab_menu(p_business uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when b.id is null then null else jsonb_build_object(
    'id', b.id, 'name', b.name, 'address', b.address, 'phone', b.phone, 'area', nullif(btrim(b.own_city), ''),
    'home_fee', coalesce(b.lab_home_fee, 0),
    'tests', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
                 'sample', t.sample_type, 'price', t.price, 'hours', t.tat_hours) order by t.category nulls last, t.name)
               from lab_tests t where t.business_id = b.id and t.is_active), '[]'),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price', p.price,
                 'tests', (select coalesce(jsonb_agg(lt.name order by lt.name), '[]') from lab_package_tests x join lab_tests lt on lt.id = x.test_id where x.package_id = p.id))
                 order by p.price)
               from lab_packages p where p.business_id = b.id and p.is_active), '[]')
  ) end
  from (select 1) one
  left join businesses b on b.id = p_business and b.status = 'active' and (b.vertical = 'lab' or coalesce(b.lab_module, false));
$$;
revoke all on function sehat_lab_menu(uuid) from public;
grant execute on function sehat_lab_menu(uuid) to anon, authenticated;

-- ── 3. The patient's order ───────────────────────────────────────────────────
-- A lab with no price list yet still takes the booking: the patient writes
-- what they need (p_note) and the booking carries it; the lab adds the tests
-- when the sample is taken. With a price list, tests / packages are chosen.
drop function if exists sehat_app_lab_order(uuid, uuid[], uuid[], text, timestamptz, text, integer, text);
create or replace function sehat_app_lab_order(
  p_business uuid, p_tests uuid[], p_packages uuid[], p_collection text, p_slot timestamptz,
  p_name text, p_age integer default null, p_address text default null, p_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_phone text := sehat_my_phone();
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

  select b.id, b.name, b.address, b.phone into v_biz
    from businesses b where b.id = p_business and b.status = 'active' and (b.vertical = 'lab' or coalesce(b.lab_module, false));
  if not found then raise exception 'This lab is not taking orders just now.' using errcode = 'P0001'; end if;
  v_menu := exists (select 1 from lab_tests t where t.business_id = p_business and t.is_active)
         or exists (select 1 from lab_packages p where p.business_id = p_business and p.is_active);
  if v_menu and coalesce(array_length(p_tests, 1), 0) + coalesce(array_length(p_packages, 1), 0) = 0 then
    raise exception 'Choose at least one test or package.' using errcode = 'P0001';
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
  values (v_phone, v_name, p_age, p_business, null, p_slot, 'booked', 'app', 'patient', 'app',
          left('Lab tests: ' || v_names || case when v_home then ' · home collection: ' || btrim(p_address) else ' · sample at the lab' end, 500))
  returning id, patient_member_id into v_appt, v_member;
  if v_member is null then
    raise exception 'Could not register the patient at this lab. Please try again.' using errcode = 'P0001';
  end if;

  if v_menu then
    v_order := sehat_lab_order_insert(p_business, v_member, p_tests, p_packages, null,
      case when v_home then 'home' else 'lab' end, case when v_home then p_address end, 'routine', v_note, null,
      p_slot, null, 'app', null, null, null, auth.uid(), v_name || ' (app)');
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
end $$;
revoke all on function sehat_app_lab_order(uuid, uuid[], uuid[], text, timestamptz, text, integer, text, text) from public, anon;
grant execute on function sehat_app_lab_order(uuid, uuid[], uuid[], text, timestamptz, text, integer, text, text) to authenticated;


-- ── 4. The patient's lists: what a booking is for (0196 + purpose) ───────────
create or replace function sehat_my_activity()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_phone text := sehat_my_phone();
begin
  return jsonb_build_object(
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'when', a.slot_datetime, 'status', a.status, 'name', a.patient_name, 'purpose', a.purpose,
        'place', b.name, 'doctor', pr.full_name,
        'rated', exists (select 1 from ratings r where r.appointment_id = a.id),
        'rateable', a.status in ('completed', 'booked', 'confirmed') and a.slot_datetime < now() and a.slot_datetime > now() - interval '30 days'
                    and not exists (select 1 from ratings r where r.appointment_id = a.id)) order by a.slot_datetime desc)
      from appointments a left join businesses b on b.id = a.business_id left join practitioners pr on pr.id = a.practitioner_id
      where a.patient_phone = v_phone and a.slot_datetime > now() - interval '180 days'), '[]'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'code', o.code, 'token', o.token, 'status', o.status, 'created_at', o.created_at,
        'pharmacy', b.name, 'total', o.quote_amount + o.delivery_fee, 'rated', o.rating is not null,
        'rateable', o.status = 'delivered' and o.rating is null) order by o.created_at desc)
      from medicine_orders o left join businesses b on b.id = o.business_id
      where o.patient_phone = v_phone and o.created_at > now() - interval '180 days'), '[]'),
    'trips', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'code', r.code, 'token', r.token, 'status', r.status, 'kind', r.kind, 'created_at', r.created_at,
        'service', b.name, 'rated', r.rating is not null, 'rateable', r.status = 'completed' and r.rating is null) order by r.created_at desc)
      from ambulance_requests r left join businesses b on b.id = r.business_id
      where r.patient_phone = v_phone and r.created_at > now() - interval '180 days'), '[]'),
    'insurance', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'code', l.code, 'token', l.token, 'status', l.status, 'created_at', l.created_at,
        'advisor', b.name, 'rated', l.rating is not null,
        'rateable', l.status in ('accepted', 'contacted', 'won', 'lost') and l.accepted_at < now() - interval '1 hour' and l.rating is null) order by l.created_at desc)
      from insurance_leads l left join businesses b on b.id = l.agent_business_id
      where l.patient_phone = v_phone and l.code is not null and l.created_at > now() - interval '180 days'), '[]'),
    'site', sehat_site_url());
end $$;
revoke all on function sehat_my_activity() from public, anon;
grant execute on function sehat_my_activity() to authenticated;

-- ── 5. Cancelling in the app cancels the lab order with it (0198 + lab) ──────
create or replace function sehat_app_cancel_booking(p_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := sehat_my_phone(); o record;
begin
  select lo.* into o from lab_orders lo join appointments a on a.id = lo.appointment_id
   where lo.appointment_id = p_id and sehat_normalise_phone(a.patient_phone) = v_phone and lo.status <> 'cancelled';
  if found and (o.status <> 'ordered'
      or exists (select 1 from patient_charges c where c.business_id = o.business_id and c.patient_member_id = o.patient_member_id
                  and c.category = 'lab' and c.description like '%(' || o.order_no || ')' and c.bill_id is not null)) then
    raise exception 'The sample has already been taken or billed. Please call the lab.' using errcode = 'P0001';
  end if;

  update appointments
     set status = 'cancelled', last_actor = 'patient', last_actor_detail = 'app'
   where id = p_id
     and sehat_normalise_phone(patient_phone) = v_phone
     and status in ('booked', 'confirmed')
     and slot_datetime > now();
  if not found then
    raise exception 'This booking cannot be cancelled here. Please call the clinic.' using errcode = 'P0001';
  end if;

  if o.id is not null then
    delete from patient_charges c where c.business_id = o.business_id and c.patient_member_id = o.patient_member_id
       and c.category = 'lab' and c.description like '%(' || o.order_no || ')' and c.bill_id is null;
    update lab_orders set status = 'cancelled', cancelled_reason = 'Cancelled by the patient in the app' where id = o.id;
  end if;
end $$;
revoke all on function sehat_app_cancel_booking(uuid) from public, anon;
grant execute on function sehat_app_cancel_booking(uuid) to authenticated;

notify pgrst, 'reload schema';
