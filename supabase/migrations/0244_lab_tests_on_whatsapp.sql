-- ============================================================================
-- 0244 — Lab tests booked on WhatsApp as in the app
-- ============================================================================
-- AFTER 0243. Safe to re-run.
--
-- The app books lab tests from the lab's own price list — tests and packages,
-- at the lab or a home collection, at a time the lab has open (0207). On
-- WhatsApp the bot only booked "a visit to the lab". The app's function is
-- split so both use one body: sehat_lab_order_place takes the phone and where
-- it came from; sehat_app_lab_order is the app's door to it, unchanged for the
-- app. The bot gets the lab's list, its open times, and its own door.
-- ============================================================================

alter table lab_orders drop constraint if exists lab_orders_source_check;
alter table lab_orders add constraint lab_orders_source_check check (source = any (array['desk', 'doctor', 'app', 'whatsapp']));

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
end $function$;
revoke all on function sehat_lab_order_place(text, text, uuid, uuid[], uuid[], text, timestamptz, text, integer, text, text) from public, anon, authenticated;
grant execute on function sehat_lab_order_place(text, text, uuid, uuid[], uuid[], text, timestamptz, text, integer, text, text) to service_role;

create or replace function sehat_app_lab_order(
  p_business uuid, p_tests uuid[], p_packages uuid[], p_collection text, p_slot timestamptz, p_name text,
  p_age integer default null, p_address text default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return sehat_lab_order_place(sehat_my_phone(), 'app', p_business, p_tests, p_packages, p_collection, p_slot, p_name, p_age, p_address, p_note);
end $$;

-- The lab the patient picked from the bot's list, and up to nine things to
-- choose from: its packages, then its tests — or those matching what they typed.
create or replace function bot_lab_menu_json(p_pincode text, p_selection text, p_query text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_biz uuid;
  b record;
  q text := nullif(btrim(coalesce(p_query, '')), '');
  v_rows jsonb; v_total integer;
begin
  select k.business_id into v_biz from bot_pick('business', 'lab', p_pincode, p_selection) k limit 1;
  if v_biz is null and coalesce(p_selection, '') ~* '^[0-9a-f-]{36}$' then v_biz := p_selection::uuid; end if;
  select x.id, x.name, coalesce(x.lab_home_fee, 0) as home_fee into b
    from businesses x where x.id = v_biz and x.status = 'active' and (x.vertical = 'lab' or coalesce(x.lab_module, false));
  if b.id is null then return jsonb_build_object('ok', false); end if;

  with items as (
    select 0 as grp, 'p:' || p.id as id, p.name, p.price,
           coalesce(nullif(btrim(p.description), ''), 'Package') as about
      from lab_packages p where p.business_id = b.id and p.is_active
       and (q is null or p.name ilike '%' || q || '%' or p.description ilike '%' || q || '%')
    union all
    select 1, 't:' || t.id, t.name, t.price, coalesce(nullif(btrim(t.sample_type), ''), t.category, 'Test')
      from lab_tests t where t.business_id = b.id and t.is_active
       and (q is null or t.name ilike '%' || q || '%' or t.category ilike '%' || q || '%')
  ), ranked as (
    select i.*, row_number() over (order by i.grp, i.name) rn, count(*) over () n from items i
  )
  select jsonb_agg(jsonb_build_object('id', 'lab:i:' || r.id, 'title', left(r.name, 24),
           'description', left('₹' || trim(to_char(coalesce(r.price, 0), '99,99,990')) || ' · ' || r.name || ' · ' || r.about, 72),
           'name', r.name) order by r.rn), max(r.n)
    into v_rows, v_total from ranked r where r.rn <= 9;

  return jsonb_build_object('ok', true, 'business', b.id, 'name', b.name, 'home_fee', b.home_fee,
    'has_menu', exists (select 1 from lab_tests t where t.business_id = b.id and t.is_active)
             or exists (select 1 from lab_packages p where p.business_id = b.id and p.is_active),
    'rows', coalesce(v_rows, '[]'::jsonb), 'total', coalesce(v_total, 0));
end $$;

-- The lab's next open times, as rows to tap.
create or replace function bot_lab_slots_json(p_business text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('rows', coalesce(jsonb_agg(jsonb_build_object(
           'id', 'lab:s:' || extract(epoch from o.window_start)::bigint,
           'title', to_char(o.window_start at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM'),
           'description', left(o.label, 72)) order by o.rn), '[]'::jsonb))
    from bot_slot_options(p_business::uuid, null, 7) as o(rn, window_start, label);
$$;

-- The order itself. Whatever stops it is said back in words, never thrown.
create or replace function bot_lab_order_json(
  p_phone text, p_business text, p_items text, p_collection text, p_slot text, p_patient_info text, p_address text, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_info text := btrim(coalesce(p_patient_info, ''));
  v_name text := nullif(btrim(split_part(v_info, ',', 1)), '');
  v_age integer := nullif(substring(v_info from '([0-9]{1,3})[^0-9]*$'), '')::integer;
  v_tests uuid[]; v_packs uuid[];
  r jsonb;
begin
  if v_age is not null and (v_age < 1 or v_age > 120) then v_age := null; end if;
  if v_info not like '%,%' and v_age is not null then
    v_name := nullif(btrim(regexp_replace(v_name, '[0-9]{1,3}[^0-9]*$', '')), '');
  end if;
  select array_agg(substr(x, 3)::uuid) filter (where x like 't:%'), array_agg(substr(x, 3)::uuid) filter (where x like 'p:%')
    into v_tests, v_packs
    from unnest(string_to_array(coalesce(p_items, ''), ',')) x where x ~* '^[tp]:[0-9a-f-]{36}$';
  begin
    r := sehat_lab_order_place(p_phone, 'whatsapp_bot', p_business::uuid, coalesce(v_tests, '{}'), coalesce(v_packs, '{}'),
           p_collection, to_timestamp(nullif(p_slot, '')::bigint), v_name, v_age, nullif(btrim(coalesce(p_address, '')), ''),
           nullif(btrim(coalesce(p_note, '')), ''));
  exception when others then
    return jsonb_build_object('ok', false, 'text', sqlerrm,
      'again', case when sqlerrm ilike '%time%' then 'slot' when sqlerrm ilike '%name%' then 'name' else '' end);
  end;
  return jsonb_build_object('ok', true, 'text',
    '✅ *लैब टेस्ट बुक हो गया* / Lab tests booked' || E'\n\n'
    || '🔬 ' || (r ->> 'lab') || E'\n'
    || '🧪 ' || (r ->> 'tests') || E'\n'
    || '👤 ' || (r ->> 'name') || E'\n'
    || '🗓 ' || bot_hi_when((r ->> 'at')::timestamptz) || E'\n'
    || case when r ->> 'collection' = 'home' then '🏠 घर से सैंपल / Home collection: ' || coalesce(p_address, '')
            else '🏥 सैंपल लैब पर / At the lab' || coalesce(': ' || nullif(r ->> 'address', ''), '') end
    || case when coalesce((r ->> 'total')::numeric, 0) > 0 then E'\n' || '💰 कुल / Total: ₹' || trim(to_char((r ->> 'total')::numeric, '99,99,990')) || ' — लैब पर या सैंपल के समय दें' else '' end
    || coalesce(E'\n' || '📞 ' || nullif(r ->> 'phone', ''), ''));
end $$;

revoke all on function bot_lab_menu_json(text, text, text) from public, anon, authenticated;
revoke all on function bot_lab_slots_json(text) from public, anon, authenticated;
revoke all on function bot_lab_order_json(text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function bot_lab_menu_json(text, text, text) to service_role;
grant execute on function bot_lab_slots_json(text) to service_role;
grant execute on function bot_lab_order_json(text, text, text, text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
