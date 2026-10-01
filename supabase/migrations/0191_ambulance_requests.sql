-- ============================================================================
-- Sehatsandhi — ambulance requests: nobody waits, the nearest crew accepts
--
-- Run AFTER 0190. Safe to re-run.
--
-- Decided 1 Oct 2026, the same model as pharmacies (0189):
--   • Ambulance services pay the listing fee (clinic prices until an admin
--     changes them in Admin → Pricing) — no commission on trips.
--   • No OPD, IPD or pharmacy counter. A team of their own: driver (and
--     manager). Each service says where it serves (businesses.delivery_pin_codes,
--     the same column pharmacies use); none chosen, no requests.
--
-- THE PATIENT NEVER WAITS FOR AN ACCEPT. The bot's reply to a request lists the
-- nearest services' numbers and 108 straight away; the request is sent to every
-- service in that PIN at the same moment, and the first to accept gets it.
-- Then the patient's link (/a/<token>) shows the service, driver, phone,
-- vehicle number and ETA.
--
-- A TRIP
--   open → accepted (driver, vehicle, ETA) → on_the_way → picked_up → completed
--   (fare and how it was paid) → the patient says what they paid and rates.
--   cancelled / expired: an emergency nobody accepts in 10 minutes expires and
--   the patient is told to call 108; a scheduled trip (transfer, discharge)
--   waits until an hour before its pickup time.
--   Because it is an emergency, an accepting service sees the patient's name,
--   phone and pickup address at once — before accepting it sees only the area,
--   the kind of trip and what is needed.
--
-- THE BOT, keyed like 0188:
--   p_type 'ambulance_request'
--   p_filter_value '<flow key>|<PIN>|<name>|<emergency or scheduled>|<pickup address>|<what is needed / when>'
--   p_pincode      the WhatsApp number
-- ============================================================================

-- ── 1. The listing fee, and what an ambulance service has ───────────────────
update vertical_billing
   set billing_model = 'pincode_monthly', monthly_enabled = true,
       commission_enabled = false, commission_percent = 0,
       commission_basis = 'listing fee — no commission on trips'
 where vertical = 'ambulance';

update vertical_term_prices p
   set subscription_price = c.subscription_price
  from vertical_term_prices c
 where p.vertical = 'ambulance' and c.vertical = 'clinic' and c.months = p.months
   and coalesce(p.subscription_price, 0) = 0;

create or replace function sehat_ambulance_shape()
returns trigger language plpgsql as $$
begin
  if new.vertical = 'ambulance' then
    new.opd_module := false;
    new.ipd_module := false;
  end if;
  return new;
end $$;
drop trigger if exists ambulance_shape on businesses;
create trigger ambulance_shape before insert or update of vertical, opd_module, ipd_module
  on businesses for each row execute function sehat_ambulance_shape();
update businesses set vertical = vertical where vertical = 'ambulance';
revoke all on function sehat_ambulance_shape() from public, anon, authenticated;

-- ── 2. The driver ───────────────────────────────────────────────────────────
alter table business_practitioners drop constraint if exists business_practitioners_role_check;
alter table business_practitioners add constraint business_practitioners_role_check
  check (role in ('owner', 'doctor', 'nurse', 'receptionist', 'manager', 'pharmacist', 'delivery', 'driver'));
alter table staff_invitations drop constraint if exists staff_invitations_role_check;
alter table staff_invitations add constraint staff_invitations_role_check
  check (role in ('doctor', 'nurse', 'receptionist', 'manager', 'pharmacist', 'delivery', 'driver'));

-- ── 3. Where a pharmacy delivers / an ambulance serves (0189's, widened) ────
create or replace function sehat_area_role(p_business uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text; v_vertical text;
begin
  if p_business is null or not sehat_caller_owns_business(p_business) then
    raise exception 'Not your business.' using errcode = '42501';
  end if;
  v_vertical := (select vertical from businesses where id = p_business);
  if v_vertical not in ('pharmacy', 'ambulance') then
    raise exception 'Only pharmacies and ambulance services choose where they serve.' using errcode = 'P0001';
  end if;
  return coalesce(sehat_caller_role(p_business), 'owner');
end $$;
revoke all on function sehat_area_role(uuid) from public, anon, authenticated;

create or replace function sehat_mo_delivery_area(p_business uuid)
returns table (pin_code text, area_name text, chosen boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_area_role(p_business);
  return query
    select x.pin, (select string_agg(distinct sa.area_name, ', ') from service_areas sa where sa.pin_code = x.pin),
           x.pin = any(b.delivery_pin_codes)
      from businesses b, unnest(coalesce(b.pin_codes, '{}')) as x(pin)
     where b.id = p_business
     order by x.pin;
end $$;

create or replace function sehat_mo_set_delivery_area(p_business uuid, p_pins text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if sehat_area_role(p_business) not in ('owner', 'manager') then
    raise exception 'Only the owner or a manager can change where you serve.' using errcode = '42501';
  end if;
  update businesses b set delivery_pin_codes = array(
           select distinct p from unnest(coalesce(p_pins, '{}')) p where p = any(coalesce(b.pin_codes, '{}')) order by p)
   where b.id = p_business
  returning delivery_pin_codes into v;
  return v;
end $$;

-- ── 4. Requests ─────────────────────────────────────────────────────────────
create table if not exists ambulance_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  kind text not null default 'emergency' check (kind in ('emergency', 'scheduled')),
  status text not null default 'open' check (status in ('open', 'accepted', 'on_the_way', 'picked_up', 'completed', 'cancelled', 'expired')),
  source text not null default 'whatsapp_bot',
  patient_phone text not null,
  patient_name text,
  pickup_address text,
  pin_code text not null,
  need text,
  business_id uuid references businesses(id) on delete set null,
  accepted_at timestamptz, accepted_by_name text,
  driver_practitioner_id uuid references practitioners(id) on delete set null,
  driver_name text, driver_phone text, vehicle_no text, eta_minutes integer,
  on_way_at timestamptz, picked_at timestamptz, completed_at timestamptz, completed_by_name text,
  fare numeric(10, 2), paid_mode text check (paid_mode in ('cash', 'upi', 'card', 'other', 'free')),
  ended_reason text,
  patient_paid numeric(10, 2), rating smallint check (rating between 1 and 5), review text, rated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ambulance_requests_open_idx on ambulance_requests (pin_code, created_at) where status = 'open';
create index if not exists ambulance_requests_business_idx on ambulance_requests (business_id, updated_at desc);
create index if not exists ambulance_requests_phone_idx on ambulance_requests (patient_phone, created_at desc);
alter table ambulance_requests enable row level security;
revoke all on ambulance_requests from anon, authenticated;

create table if not exists ambulance_request_declines (
  request_id uuid not null references ambulance_requests(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (request_id, business_id)
);
alter table ambulance_request_declines enable row level security;
revoke all on ambulance_request_declines from anon, authenticated;

create table if not exists ambulance_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references ambulance_requests(id) on delete cascade,
  business_id uuid,
  event text not null,
  actor_uid uuid,
  actor_name text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists ambulance_request_events_idx on ambulance_request_events (request_id, created_at);
alter table ambulance_request_events enable row level security;
revoke all on ambulance_request_events from anon, authenticated;

-- ── 5. Helpers ──────────────────────────────────────────────────────────────
create or replace function sehat_am_services(p_pin text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id from businesses b
   where b.vertical = 'ambulance' and b.status = 'active'
     and p_pin = any(b.delivery_pin_codes)
     and p_pin = any(coalesce(b.pin_codes, '{}'))
     and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date);
$$;

create or replace function sehat_am_log(p_req uuid, p_business uuid, p_event text, p_note text default null, p_patient boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into ambulance_request_events (request_id, business_id, event, actor_uid, actor_name, note)
  values (p_req, p_business, p_event,
          case when p_patient then null else auth.uid() end,
          case when p_patient then 'Patient' when auth.uid() is null then 'Sehatsandhi' else sehat_mo_actor_name(p_business) end,
          p_note);
$$;

create or replace function sehat_am_url(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select sehat_site_url() || '/a/' || p_token;
$$;

create or replace function sehat_am_wa(p_req uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare r ambulance_requests;
begin
  if not coalesce((select order_sending_enabled from messaging_settings limit 1), false) then return; end if;
  select * into r from ambulance_requests where id = p_req;
  insert into notification_outbox (recipient, phone, event, payload, status)
  values ('patient', r.patient_phone, 'medicine_order',   -- same sender as 0189's order messages
          jsonb_build_object('ambulance_request_id', r.id, 'patient_name', r.patient_name, 'text', p_text), 'pending_wa');
exception when others then null;
end $$;

create or replace function sehat_am_push(p_req uuid, p_business uuid, p_users uuid[], p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform sehat_queue_push('ambulance', p_business, p_users, p_title, p_body,
    jsonb_build_object('kind', 'ambulance', 'request_id', p_req));
exception when others then null;
end $$;

create or replace function sehat_am_offer(p_req uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r ambulance_requests; b uuid; n integer := 0;
begin
  select * into r from ambulance_requests where id = p_req;
  for b in select x from sehat_am_services(r.pin_code) x
            where not exists (select 1 from ambulance_request_declines d where d.request_id = p_req and d.business_id = x)
  loop
    perform sehat_am_push(p_req, b, sehat_mo_users(b, array['owner', 'manager', 'driver']),
      case when r.kind = 'emergency' then '🚑 EMERGENCY · ' else '🚑 Scheduled trip · ' end || r.pin_code,
      r.code || ' — ' || coalesce(left(nullif(btrim(r.need), ''), 80), 'ambulance needed') || '. Accept if you can reach them.');
    n := n + 1;
  end loop;
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['sehat_am_services(text)', 'sehat_am_log(uuid, uuid, text, text, boolean)', 'sehat_am_url(text)',
    'sehat_am_wa(uuid, text)', 'sehat_am_push(uuid, uuid, uuid[], text, text)', 'sehat_am_offer(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;

-- ── 6. A new request (from the bot; service only) ───────────────────────────
create or replace function sehat_create_ambulance_request(
  p_phone text, p_pin text, p_name text, p_kind text, p_address text, p_need text, p_source text default 'whatsapp_bot'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_pin text := bot_pincode(p_pin);
  v_kind text := case when lower(coalesce(p_kind, '')) like 'sched%' or p_kind ilike '%transfer%' or p_kind ilike '%discharge%'
                      then 'scheduled' else 'emergency' end;
  v_code text; v_id uuid; v_token text; n integer;
  v_numbers text;
begin
  if v_phone is null then return jsonb_build_object('ok', false, 'text', 'तुरंत 108 पर कॉल करें। / Call 108 now.'); end if;
  if v_pin is null then
    return jsonb_build_object('ok', false, 'text', 'तुरंत 108 पर कॉल करें (मुफ़्त सरकारी एम्बुलेंस)। हमें आपका PIN कोड समझ नहीं आया — 6 अंक भेजें।' || E'\n'
      || 'Call 108 now (free government ambulance). We could not read your PIN code — send 6 digits.');
  end if;
  -- Numbers first, always: whatever happens next, they can call now.
  v_numbers := coalesce(bot_ambulance(v_pin), 'तुरंत 108 पर कॉल करें। / Call 108 now.');

  if (select count(*) from ambulance_requests where patient_phone = v_phone
        and status in ('open', 'accepted', 'on_the_way', 'picked_up')) >= 2 then
    return jsonb_build_object('ok', false, 'text', v_numbers);
  end if;
  if not exists (select 1 from sehat_am_services(v_pin)) then
    return jsonb_build_object('ok', false, 'text', v_numbers);
  end if;

  loop
    v_code := 'AM-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from ambulance_requests where code = v_code);
  end loop;
  insert into ambulance_requests (code, kind, source, patient_phone, patient_name, pickup_address, pin_code, need)
  values (v_code, v_kind, coalesce(p_source, 'whatsapp_bot'), v_phone, nullif(btrim(left(coalesce(p_name, ''), 80)), ''),
          nullif(btrim(left(coalesce(p_address, ''), 300)), ''), v_pin, nullif(btrim(left(coalesce(p_need, ''), 300)), ''))
  returning id, token into v_id, v_token;
  perform sehat_am_log(v_id, null, 'created', v_kind);
  begin
    perform sehat_wa_handle_inbound(v_phone, nullif(btrim(coalesce(p_name, '')), ''), null, 'ambulance request ' || v_code, null, null);
  exception when others then null;
  end;
  n := sehat_am_offer(v_id);

  return jsonb_build_object('ok', true, 'code', v_code, 'token', v_token, 'services', n, 'text',
    v_numbers || E'\n\n'
    || '🚑 हमने आपकी जानकारी (' || v_code || ') पास की ' || n || ' एम्बुलेंस सेवाओं को भी भेज दी है। जो पहले स्वीकार करेगी, वह आपको कॉल करेगी। इंतज़ार न करें — ऊपर के नंबर या 108 पर अभी कॉल कर सकते हैं।' || E'\n'
    || 'We have also sent your request (' || v_code || ') to ' || n || ' ambulance services nearby — the first to accept will call you. Do not wait: call a number above or 108 now if it is urgent.' || E'\n\n'
    || 'ड्राइवर, गाड़ी नंबर और समय यहाँ देखें / See driver, vehicle and ETA here:' || E'\n' || sehat_am_url(v_token));
end $$;
revoke all on function sehat_create_ambulance_request(text, text, text, text, text, text, text) from public, anon, authenticated;

-- ── 7. The bot's search node (0189 + 'ambulance_request') ───────────────────
create or replace function bot_generic_search_json(p_type text, p_filter_value text, p_pincode text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  r jsonb;
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_val text;
begin
  -- 0143: the QR opt-in rides this node (all five AiSensy API nodes are used).
  if v_type = 'optin' then
    r := bot_clinic_optin(p_filter_value, p_pincode, null);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;
  -- 0173: STOP and START ride it too.
  if v_type = 'stop' then
    r := bot_opt_out(p_pincode, p_filter_value);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;
  if v_type = 'start' then
    r := bot_opt_in_again(p_pincode);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;

  -- 0188: hello / tips / rating, 0189: medicine, 0191: ambulance_request — only with the flow key.
  if v_type in ('hello', 'tips', 'rating', 'medicine', 'ambulance_request') then
    v_val := sehat_bot_keyed(p_filter_value);
    if v_val is null then
      -- An ambulance request without the key still gets the numbers: never leave an emergency empty-handed.
      if v_type = 'ambulance_request' then
        return jsonb_build_object('found', false, 'route', 'info', 'text', coalesce(bot_ambulance(split_part(coalesce(p_filter_value, ''), '|', 2)), 'Call 108.'));
      end if;
      return jsonb_build_object('found', false, 'route', 'info', 'text', '');
    end if;
    if v_type = 'hello' then
      begin
        perform sehat_wa_handle_inbound(p_pincode, nullif(btrim(v_val), ''), null, 'Hi', null, null);
        return jsonb_build_object('found', true, 'route', 'hello', 'text', '');
      exception when others then
        return jsonb_build_object('found', false, 'route', 'hello', 'text', '');   -- never stop the welcome
      end;
    elsif v_type = 'tips' then
      r := sehat_wa_platform_optin(p_pincode, v_val, null);
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text',
        case when coalesce((r ->> 'ok')::boolean, false)
          then 'धन्यवाद! 🙏 अब आपको अपने एरिया के क्लिनिक्स से हेल्थ टिप्स और ऑफ़र मिलेंगे। बंद करने के लिए कभी भी STOP भेजें।'
               || E'\n\n' || 'Thank you! You''ll get health tips and offers from clinics near you. Send STOP any time to stop.'
          else 'हमें आपका नंबर समझ नहीं आया। / We could not read your number.' end);
    elsif v_type = 'medicine' then
      -- '<PIN>|<name>|<prescription URL>|<address>|<medicines — may contain |>'
      r := sehat_create_medicine_order(p_pincode,
             split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 4),
             nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''),
             split_part(v_val, '|', 3), 'whatsapp_bot');
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    elsif v_type = 'ambulance_request' then
      -- '<PIN>|<name>|<emergency|scheduled>|<pickup address>|<what is needed — may contain |>'
      begin
        r := sehat_create_ambulance_request(p_pincode,
               split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 3), split_part(v_val, '|', 4),
               nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''), 'whatsapp_bot');
      exception when others then
        r := jsonb_build_object('ok', false, 'text', coalesce(bot_ambulance(split_part(v_val, '|', 1)), 'Call 108.'));
      end;
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    else
      r := bot_record_rating_json(p_pincode, v_val);
      return jsonb_build_object('found', coalesce((r ->> 'recorded')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    end if;
  end if;

  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;

-- ── 8. The service's side ───────────────────────────────────────────────────
create or replace function sehat_am_role(p_business uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_business is null or not sehat_caller_owns_business(p_business) then
    raise exception 'Not your ambulance service.' using errcode = '42501';
  end if;
  if (select vertical from businesses where id = p_business) <> 'ambulance' then
    raise exception 'Ambulance requests are for ambulance services.' using errcode = 'P0001';
  end if;
  v := coalesce(sehat_caller_role(p_business), 'owner');
  if v not in ('owner', 'manager', 'driver') then
    raise exception 'Your role here does not handle trips.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function sehat_am_role(uuid) from public, anon, authenticated;

create or replace function sehat_am_row(r ambulance_requests, p_business uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'code', r.code, 'kind', r.kind, 'status', r.status, 'pin_code', r.pin_code, 'need', r.need,
    'created_at', r.created_at, 'accepted_at', r.accepted_at, 'accepted_by_name', r.accepted_by_name,
    'driver_practitioner_id', r.driver_practitioner_id, 'driver_name', r.driver_name, 'driver_phone', r.driver_phone,
    'vehicle_no', r.vehicle_no, 'eta_minutes', r.eta_minutes,
    'on_way_at', r.on_way_at, 'picked_at', r.picked_at, 'completed_at', r.completed_at, 'completed_by_name', r.completed_by_name,
    'fare', r.fare, 'paid_mode', r.paid_mode, 'ended_reason', r.ended_reason,
    'rating', r.rating, 'review', r.review, 'patient_paid', r.patient_paid,
    'mine', coalesce(r.business_id = p_business, false),
    -- An emergency: who and where as soon as it is ours, for 7 days after the trip.
    'patient_name', case when r.business_id = p_business and (r.completed_at is null or r.completed_at > now() - interval '7 days') then r.patient_name end,
    'patient_phone', case when r.business_id = p_business and r.status <> 'cancelled' and (r.completed_at is null or r.completed_at > now() - interval '7 days') then r.patient_phone end,
    'pickup_address', case when r.business_id = p_business and r.status <> 'cancelled' and (r.completed_at is null or r.completed_at > now() - interval '7 days') then r.pickup_address end,
    'events', case when r.business_id = p_business then (
        select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'by', e.actor_name, 'note', e.note, 'at', e.created_at) order by e.created_at), '[]')
          from ambulance_request_events e where e.request_id = r.id and (e.business_id is null or e.business_id = p_business)) end
  );
$$;
revoke all on function sehat_am_row(ambulance_requests, uuid) from public, anon, authenticated;

-- p_scope: 'new' (offered to us), 'active' (ours, under way), 'done' (ours, finished, last 30 days)
-- A driver sees new requests (to accept fast) and only their own trips.
create or replace function sehat_am_list(p_business uuid, p_scope text default 'active')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := sehat_am_role(p_business);
  v_pins text[] := (select delivery_pin_codes from businesses where id = p_business);
  v_me uuid := (select p.id from practitioners p where p.auth_uid = auth.uid() limit 1);
begin
  if p_scope = 'new' then
    return coalesce((select jsonb_agg(sehat_am_row(r, p_business) order by r.kind, r.created_at)
      from ambulance_requests r
     where r.status = 'open' and r.pin_code = any(v_pins)
       and p_business in (select sehat_am_services(r.pin_code))
       and not exists (select 1 from ambulance_request_declines d where d.request_id = r.id and d.business_id = p_business)), '[]');
  end if;
  return coalesce((select jsonb_agg(sehat_am_row(r, p_business) order by r.updated_at desc)
    from ambulance_requests r
   where r.business_id = p_business
     and (v_role <> 'driver' or r.driver_practitioner_id = v_me)
     and (case when p_scope = 'done'
               then r.status in ('completed', 'cancelled', 'expired') and r.updated_at > now() - interval '30 days'
               else r.status in ('accepted', 'on_the_way', 'picked_up') end)), '[]');
end $$;
revoke all on function sehat_am_list(uuid, text) from public, anon;
grant execute on function sehat_am_list(uuid, text) to authenticated;

create or replace function sehat_am_get(p_business uuid, p_req uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text := sehat_am_role(p_business); r ambulance_requests;
  v_pins text[] := (select delivery_pin_codes from businesses where id = p_business);
begin
  select * into r from ambulance_requests where id = p_req;
  if r.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if r.business_id is distinct from p_business and not (r.status = 'open' and r.pin_code = any(v_pins)) then
    raise exception 'This trip is with another service.' using errcode = '42501';
  end if;
  return sehat_am_row(r, p_business);
end $$;
revoke all on function sehat_am_get(uuid, uuid) from public, anon;
grant execute on function sehat_am_get(uuid, uuid) to authenticated;

-- accept(driver?, vehicle, eta) | decline(reason) | drop(reason)
-- on_the_way | picked_up | completed(fare, mode)
create or replace function sehat_am_act(
  p_business uuid, p_req uuid, p_action text,
  p_driver uuid default null, p_vehicle text default null, p_eta integer default null,
  p_note text default null, p_fare numeric default null, p_mode text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := sehat_am_role(p_business);
  v_name text := sehat_mo_actor_name(p_business);
  v_me uuid := (select p.id from practitioners p where p.auth_uid = auth.uid() limit 1);
  v_biz businesses;
  v_driver uuid;
  r ambulance_requests;
begin
  select * into v_biz from businesses where id = p_business;
  select * into r from ambulance_requests where id = p_req for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v_role = 'driver' and p_action not in ('accept', 'decline', 'on_the_way', 'picked_up', 'completed') then
    raise exception 'A driver cannot do this.' using errcode = '42501';
  end if;
  if v_role = 'driver' and r.business_id = p_business and r.driver_practitioner_id is distinct from v_me then
    raise exception 'This trip is with another driver.' using errcode = '42501';
  end if;

  if p_action = 'accept' then
    if r.status <> 'open' then
      raise exception '%', case when r.business_id is not null then 'Another ambulance has already taken this request.' else 'This request is no longer open.' end using errcode = 'P0001';
    end if;
    if p_business not in (select sehat_am_services(r.pin_code))
       or exists (select 1 from ambulance_request_declines d where d.request_id = r.id and d.business_id = p_business) then
      raise exception 'This request is not offered to you.' using errcode = '42501';
    end if;
    -- A driver who accepts drives; otherwise the chosen driver, or whoever accepted.
    v_driver := case when v_role = 'driver' then v_me else p_driver end;
    if v_driver is not null and not exists (select 1 from business_practitioners bp where bp.business_id = p_business
          and bp.practitioner_id = v_driver and bp.status <> 'suspended') then
      raise exception 'That driver is not on your team.' using errcode = '22023';
    end if;
    if p_eta is not null and (p_eta < 1 or p_eta > 600) then raise exception 'ETA should be in minutes.' using errcode = '22023'; end if;
    update ambulance_requests set status = 'accepted', business_id = p_business, accepted_at = now(), accepted_by_name = v_name,
           driver_practitioner_id = v_driver,
           driver_name = coalesce((select full_name from practitioners where id = v_driver), v_name),
           driver_phone = coalesce((select nullif(phone, '') from practitioners where id = v_driver), v_biz.phone),
           vehicle_no = nullif(upper(btrim(coalesce(p_vehicle, ''))), ''), eta_minutes = p_eta, updated_at = now()
     where id = r.id;
    perform sehat_am_log(r.id, p_business, 'accepted', coalesce(nullif(upper(btrim(p_vehicle)), ''), '') || coalesce(' · ETA ' || p_eta || ' min', ''));
    if v_driver is not null and v_driver is distinct from v_me then
      perform sehat_am_push(r.id, p_business, array[(select auth_uid from practitioners where id = v_driver)],
        '🚑 Your trip · ' || r.code, coalesce(r.need, 'Pickup') || ' · PIN ' || r.pin_code || '. Open for address and phone.');
    end if;
    select * into r from ambulance_requests where id = p_req;
    perform sehat_am_wa(r.id, '🚑 ' || v_biz.name || ' आ रही है / is coming.' || E'\n'
      || 'Driver: ' || coalesce(r.driver_name, '—') || ' ☎ ' || coalesce(r.driver_phone, v_biz.phone, '—')
      || coalesce(E'\nGaadi / Vehicle: ' || r.vehicle_no, '') || coalesce(E'\nETA: ' || r.eta_minutes || ' min', '')
      || E'\n' || sehat_am_url(r.token));

  elsif p_action = 'decline' then
    if r.status <> 'open' then raise exception 'This request is no longer open.' using errcode = 'P0001'; end if;
    insert into ambulance_request_declines (request_id, business_id, reason) values (r.id, p_business, left(p_note, 200)) on conflict do nothing;
    perform sehat_am_log(r.id, p_business, 'declined', left(p_note, 200));

  elsif p_action = 'drop' then
    if r.business_id is distinct from p_business or r.status not in ('accepted', 'on_the_way') then
      raise exception 'This trip cannot be given up now.' using errcode = 'P0001';
    end if;
    insert into ambulance_request_declines (request_id, business_id, reason) values (r.id, p_business, left(coalesce(p_note, 'dropped'), 200)) on conflict do nothing;
    update ambulance_requests set status = 'open', business_id = null, accepted_at = null, accepted_by_name = null,
           driver_practitioner_id = null, driver_name = null, driver_phone = null, vehicle_no = null, eta_minutes = null,
           on_way_at = null, created_at = now(), updated_at = now() where id = r.id;
    perform sehat_am_log(r.id, p_business, 'dropped', left(p_note, 200));
    if exists (select 1 from sehat_am_services(r.pin_code) x
                where not exists (select 1 from ambulance_request_declines d where d.request_id = r.id and d.business_id = x)) then
      perform sehat_am_offer(r.id);
      perform sehat_am_wa(r.id, 'आपका अनुरोध ' || r.code || ' दूसरी एम्बुलेंस को भेजा जा रहा है। ज़रूरी हो तो 108 पर कॉल करें। / Your request is going to another ambulance. Call 108 if urgent.');
    else
      update ambulance_requests set status = 'expired', ended_reason = 'no other ambulance — call 108', updated_at = now() where id = r.id;
      perform sehat_am_wa(r.id, 'माफ़ कीजिए, कोई और एम्बुलेंस उपलब्ध नहीं। तुरंत 108 पर कॉल करें। / Sorry, no other ambulance is free. Call 108 now.');
    end if;

  elsif p_action in ('on_the_way', 'picked_up') then
    if r.business_id is distinct from p_business
       or (p_action = 'on_the_way' and r.status <> 'accepted')
       or (p_action = 'picked_up' and r.status not in ('accepted', 'on_the_way')) then
      raise exception 'That step does not fit this trip now.' using errcode = 'P0001';
    end if;
    update ambulance_requests set status = p_action,
           on_way_at = case when p_action = 'on_the_way' then now() else coalesce(on_way_at, now()) end,
           picked_at = case when p_action = 'picked_up' then now() else picked_at end,
           eta_minutes = coalesce(p_eta, eta_minutes), updated_at = now() where id = r.id;
    perform sehat_am_log(r.id, p_business, p_action, case when p_eta is not null then 'ETA ' || p_eta || ' min' end);
    if p_action = 'on_the_way' then
      perform sehat_am_wa(r.id, '🚑 एम्बुलेंस रास्ते में है / The ambulance is on the way' || coalesce(' — ' || coalesce(p_eta, r.eta_minutes) || ' min', '') || '.');
    end if;

  elsif p_action = 'completed' then
    if r.business_id is distinct from p_business or r.status not in ('accepted', 'on_the_way', 'picked_up') then
      raise exception 'This trip is not under way.' using errcode = 'P0001';
    end if;
    if p_fare is null or p_fare < 0 then raise exception 'Enter the fare (0 if free).' using errcode = '22023'; end if;
    if p_mode is null or p_mode not in ('cash', 'upi', 'card', 'other', 'free') then raise exception 'Choose how they paid.' using errcode = '22023'; end if;
    update ambulance_requests set status = 'completed', completed_at = now(), completed_by_name = v_name,
           picked_at = coalesce(picked_at, now()), fare = round(p_fare, 2), paid_mode = p_mode, updated_at = now() where id = r.id;
    perform sehat_am_log(r.id, p_business, 'completed', '₹' || round(p_fare, 2) || ' ' || p_mode);
    perform sehat_am_wa(r.id, 'आशा है सब ठीक है। ' || v_biz.name || ' को रेटिंग दें / We hope all is well. Please rate ' || v_biz.name || ':' || E'\n' || sehat_am_url(r.token));
  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;

  select * into r from ambulance_requests where id = p_req;
  return sehat_am_row(r, p_business);
end $$;
revoke all on function sehat_am_act(uuid, uuid, text, uuid, text, integer, text, numeric, text) from public, anon;
grant execute on function sehat_am_act(uuid, uuid, text, uuid, text, integer, text, numeric, text) to authenticated;

create or replace function sehat_am_drivers(p_business uuid)
returns table (practitioner_id uuid, name text, role text, phone text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_am_role(p_business);
  return query
    select p.id, p.full_name, bp.role, p.phone from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
     where bp.business_id = p_business and bp.status <> 'suspended' and bp.role in ('driver', 'manager', 'owner')
     order by case bp.role when 'driver' then 0 else 1 end, p.full_name;
end $$;
revoke all on function sehat_am_drivers(uuid) from public, anon;
grant execute on function sehat_am_drivers(uuid) to authenticated;

-- ── 9. The patient's link (no login) ────────────────────────────────────────
create or replace function sehat_am_public(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', r.code, 'kind', r.kind, 'status', r.status, 'pin_code', r.pin_code, 'need', r.need,
    'patient_name', split_part(coalesce(r.patient_name, ''), ' ', 1),
    'created_at', r.created_at, 'accepted_at', r.accepted_at, 'on_way_at', r.on_way_at, 'picked_at', r.picked_at, 'completed_at', r.completed_at,
    'service', b.name, 'service_phone', b.phone,
    'driver_name', r.driver_name, 'driver_phone', r.driver_phone, 'vehicle_no', r.vehicle_no, 'eta_minutes', r.eta_minutes,
    'fare', r.fare, 'ended_reason', r.ended_reason, 'rating', r.rating, 'review', r.review, 'patient_paid', r.patient_paid,
    'numbers', case when r.status in ('open', 'expired', 'cancelled') then bot_ambulance(r.pin_code) end)
  from ambulance_requests r left join businesses b on b.id = r.business_id
  where r.token = p_token and length(coalesce(p_token, '')) = 24;
$$;
revoke all on function sehat_am_public(text) from public;
grant execute on function sehat_am_public(text) to anon, authenticated;

-- cancel | feedback(rating, review, paid)
create or replace function sehat_am_patient(p_token text, p_action text,
  p_rating integer default null, p_review text default null, p_paid numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r ambulance_requests;
begin
  select * into r from ambulance_requests where token = p_token and length(coalesce(p_token, '')) = 24 for update;
  if r.id is null then raise exception 'This link is not valid.' using errcode = 'P0002'; end if;
  if p_action = 'cancel' then
    if r.status not in ('open', 'accepted', 'on_the_way') then raise exception 'This trip can no longer be cancelled here. Please call the driver.' using errcode = 'P0001'; end if;
    update ambulance_requests set status = 'cancelled', ended_reason = 'patient cancelled', updated_at = now() where id = r.id;
    perform sehat_am_log(r.id, r.business_id, 'patient_cancelled', null, true);
    if r.business_id is not null then
      perform sehat_am_push(r.id, r.business_id, sehat_mo_users(r.business_id, array['owner', 'manager'])
        || array[(select auth_uid from practitioners where id = r.driver_practitioner_id)],
        'Cancelled · ' || r.code, 'The patient cancelled the ambulance.');
    end if;
  elsif p_action = 'feedback' then
    if r.status <> 'completed' then raise exception 'You can rate after the trip.' using errcode = 'P0001'; end if;
    if p_rating is null or p_rating not between 1 and 5 then raise exception 'Choose 1 to 5 stars.' using errcode = '22023'; end if;
    update ambulance_requests set rating = p_rating, review = nullif(btrim(left(coalesce(p_review, ''), 500)), ''),
           patient_paid = case when p_paid is not null and p_paid >= 0 then round(p_paid, 2) end, rated_at = now(), updated_at = now()
     where id = r.id;
    perform sehat_am_log(r.id, r.business_id, 'patient_rated', p_rating || '★' || coalesce(' paid ₹' || round(p_paid, 2), ''), true);
    if r.fare is not null and p_paid is not null and abs(p_paid - r.fare) >= 1 then
      perform sehat_am_log(r.id, null, 'amount_mismatch', 'service recorded ₹' || r.fare || ', patient says ₹' || round(p_paid, 2), true);
    end if;
  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;
  return sehat_am_public(p_token);
end $$;
revoke all on function sehat_am_patient(text, text, integer, text, numeric) from public;
grant execute on function sehat_am_patient(text, text, integer, text, numeric) to anon, authenticated;

-- ── 10. Clocks ──────────────────────────────────────────────────────────────
create or replace function sehat_am_tick()
returns integer language plpgsql security definer set search_path = public as $$
declare r ambulance_requests; n integer := 0;
begin
  for r in select * from ambulance_requests
            where status = 'open' and kind = 'emergency' and created_at < now() - interval '10 minutes'
            for update skip locked loop
    update ambulance_requests set status = 'expired', ended_reason = 'no ambulance accepted in 10 minutes', updated_at = now() where id = r.id;
    perform sehat_am_log(r.id, null, 'expired', 'no ambulance accepted');
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification) values ('bot', r.pin_code, 'ambulance', false);
    perform sehat_am_wa(r.id, 'माफ़ कीजिए, अभी कोई एम्बुलेंस उपलब्ध नहीं हुई। तुरंत 108 पर कॉल करें (मुफ़्त)। / Sorry, no ambulance accepted. Call 108 now (free).');
    n := n + 1;
  end loop;
  -- Scheduled: unaccepted after 2 hours.
  for r in select * from ambulance_requests
            where status = 'open' and kind = 'scheduled' and created_at < now() - interval '2 hours'
            for update skip locked loop
    update ambulance_requests set status = 'expired', ended_reason = 'no ambulance accepted in 2 hours', updated_at = now() where id = r.id;
    perform sehat_am_log(r.id, null, 'expired', 'no ambulance accepted');
    perform sehat_am_wa(r.id, 'माफ़ कीजिए, आपकी बुकिंग ' || r.code || ' कोई एम्बुलेंस नहीं ले पाई। / Sorry, no ambulance took booking ' || r.code || '.');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_am_tick() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'ambulance-request-tick';
  perform cron.schedule('ambulance-request-tick', '* * * * *', 'select public.sehat_am_tick()');
end $$;

-- ── 11. Sehatsandhi admins ──────────────────────────────────────────────────
create or replace function sehat_admin_ambulance_requests(p_days integer default 30)
returns table (code text, kind text, status text, pin_code text, created_at timestamptz, service text,
               minutes_to_accept integer, fare numeric, patient_paid numeric, rating smallint, mismatch boolean, ended_reason text)
language sql stable security definer set search_path = public as $$
  select r.code, r.kind, r.status, r.pin_code, r.created_at, b.name,
         case when r.accepted_at is not null then ceil(extract(epoch from r.accepted_at - r.created_at) / 60)::integer end,
         r.fare, r.patient_paid, r.rating,
         (r.fare is not null and r.patient_paid is not null and abs(r.fare - r.patient_paid) >= 1), r.ended_reason
    from ambulance_requests r left join businesses b on b.id = r.business_id
   where sehat_is_staff() and r.created_at > now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   order by r.created_at desc;
$$;
revoke all on function sehat_admin_ambulance_requests(integer) from public, anon;
grant execute on function sehat_admin_ambulance_requests(integer) to authenticated;

notify pgrst, 'reload schema';
