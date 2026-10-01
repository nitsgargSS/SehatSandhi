-- ============================================================================
-- Sehatsandhi — medicine orders: pharmacies deliver, on a listing fee
--
-- Run AFTER 0188. Safe to re-run.
--
-- Decided 1 Oct 2026:
--   • Pharmacies pay the listing fee, like clinics — no commission. Every
--     listing covers every PIN code we run in, so a pharmacy says separately
--     where it DELIVERS (businesses.delivery_pin_codes, a subset of its
--     listing). No delivery areas chosen, no orders.
--   • They get WhatsApp messaging, the pharmacy counter (stock, bills) and a
--     team, but no OPD or IPD: a medical store has no queue and no beds.
--   • Two staff roles of their own: pharmacist (prepares orders, keeps stock)
--     and delivery (delivers, records what was collected). A shop helper often
--     delivers too, so a pharmacist, manager or owner can be sent out with an
--     order just like a delivery person. Every step records who did it.
--
-- AN ORDER
--   open        the patient asked on WhatsApp; every pharmacy listed in that
--               PIN sees it — area and medicines only, never who or where
--   accepted    the first pharmacy to accept has it; it now sees the
--               prescription and the patient's first name, to price it
--   quoted      the pharmacy has priced it — medicines plus any delivery fee,
--               shown to the patient as two lines and a total; the pharmacist has ticked that
--               any prescription-only medicine is backed by the prescription
--   confirmed   the patient approved the price on their order link — only now
--               does the pharmacy get the name, phone and address
--   packed      prepared (who and when recorded)
--   out_for_delivery   handed to a delivery person
--   delivered   the delivery person records the amount collected and how
--   cancelled / expired / no_pharmacy   the ends that are not a delivery
--
--   A pharmacy that drops an order puts it back to open for the others.
--   Nobody accepts in 30 minutes → expired, and the patient is pointed to
--   pharmacies to call. Accepted but not priced in an hour → back to open.
--   A price not approved in 24 hours → expired.
--
-- THE PATIENT needs no login: the bot's reply carries a private link
-- (/o/<token>) to follow the order, approve or refuse the price, cancel, and
-- afterwards say what they paid and rate the pharmacy. WhatsApp updates go out
-- too once switched on (messaging_settings.order_sending_enabled).
--
-- THE BOT creates an order through the search node (all five API nodes are
-- used), keyed like 0188:
--   p_type 'medicine'
--   p_filter_value '<flow key>|<PIN>|<name>|<prescription image URL>|<address>|<medicines>'
--   p_pincode      the WhatsApp number
-- ============================================================================

-- ── 1. Pharmacies pay the listing fee ───────────────────────────────────────
update vertical_billing
   set billing_model = 'pincode_monthly', monthly_enabled = true,
       commission_enabled = false, commission_percent = 0,
       commission_basis = 'listing fee — no commission on orders'
 where vertical = 'pharmacy';

-- A pharmacy always has the counter and never OPD or IPD.
create or replace function sehat_pharmacy_shape()
returns trigger language plpgsql as $$
begin
  if new.vertical = 'pharmacy' then
    new.opd_module := false;
    new.ipd_module := false;
    if not coalesce(new.pharmacy_module, false) then
      new.pharmacy_module := true;
      new.pharmacy_module_since := coalesce(new.pharmacy_module_since, now());
      new.pharmacy_module_set_by := coalesce(new.pharmacy_module_set_by, 'system:pharmacy listing');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pharmacy_shape on businesses;
create trigger pharmacy_shape before insert or update of vertical, opd_module, ipd_module, pharmacy_module
  on businesses for each row execute function sehat_pharmacy_shape();
update businesses set vertical = vertical where vertical = 'pharmacy';

alter table businesses add column if not exists delivery_pin_codes text[] not null default '{}';

-- ── 2. Pharmacist and delivery ──────────────────────────────────────────────
alter table business_practitioners drop constraint if exists business_practitioners_role_check;
alter table business_practitioners add constraint business_practitioners_role_check
  check (role in ('owner', 'doctor', 'nurse', 'receptionist', 'manager', 'pharmacist', 'delivery'));
alter table staff_invitations drop constraint if exists staff_invitations_role_check;
alter table staff_invitations add constraint staff_invitations_role_check
  check (role in ('doctor', 'nurse', 'receptionist', 'manager', 'pharmacist', 'delivery'));

-- The pharmacist keeps the stock, as a manager does.
create or replace function sehat_pharmacy_may_manage(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_business is not null
     and (sehat_is_admin() or coalesce(sehat_caller_role(p_business) in ('owner', 'manager', 'doctor', 'pharmacist'), false));
$$;

-- ── 3. Orders ───────────────────────────────────────────────────────────────
create table if not exists medicine_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  status text not null default 'open' check (status in ('open', 'accepted', 'quoted', 'confirmed', 'packed',
    'out_for_delivery', 'delivered', 'cancelled', 'expired', 'no_pharmacy')),
  source text not null default 'whatsapp_bot',
  patient_phone text not null,
  patient_name text,
  address text,
  pin_code text not null,
  medicines text,
  prescription_url text,
  business_id uuid references businesses(id) on delete set null,
  accepted_at timestamptz, accepted_by uuid, accepted_by_name text,
  quote_amount numeric(10, 2), delivery_fee numeric(10, 2) not null default 0, quote_note text, quoted_at timestamptz, quoted_by_name text,
  rx_checked boolean not null default false,
  confirmed_at timestamptz,
  packed_at timestamptz, packed_by_name text,
  delivery_practitioner_id uuid references practitioners(id) on delete set null,
  delivery_name text, out_at timestamptz,
  delivered_at timestamptz, delivered_by_name text,
  collected_amount numeric(10, 2), collected_mode text check (collected_mode in ('cash', 'upi', 'card', 'other')),
  ended_reason text,
  patient_paid numeric(10, 2), rating smallint check (rating between 1 and 5), review text, rated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists medicine_orders_open_idx on medicine_orders (pin_code, created_at) where status = 'open';
create index if not exists medicine_orders_business_idx on medicine_orders (business_id, updated_at desc);
create index if not exists medicine_orders_phone_idx on medicine_orders (patient_phone, created_at desc);
alter table medicine_orders enable row level security;
revoke all on medicine_orders from anon, authenticated;

-- A pharmacy that said no (or dropped it) is not offered the order again.
create table if not exists medicine_order_declines (
  order_id uuid not null references medicine_orders(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (order_id, business_id)
);
alter table medicine_order_declines enable row level security;
revoke all on medicine_order_declines from anon, authenticated;

-- Who did what, when.
create table if not exists medicine_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references medicine_orders(id) on delete cascade,
  business_id uuid,
  event text not null,
  actor_uid uuid,
  actor_name text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists medicine_order_events_order_idx on medicine_order_events (order_id, created_at);
alter table medicine_order_events enable row level security;
revoke all on medicine_order_events from anon, authenticated;

alter table medicine_orders add column if not exists delivery_fee numeric(10, 2) not null default 0;
alter table messaging_settings add column if not exists order_sending_enabled boolean not null default false;
alter table messaging_settings add column if not exists order_campaign text;

-- ── 4. Helpers ──────────────────────────────────────────────────────────────
-- Pharmacies that deliver to this PIN: chose it, listed there, live, paid up.
create or replace function sehat_mo_pharmacies(p_pin text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id from businesses b
   where b.vertical = 'pharmacy' and b.status = 'active'
     and p_pin = any(b.delivery_pin_codes)
     and p_pin = any(coalesce(b.pin_codes, '{}'))
     and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date);
$$;

-- The logins at a business holding one of these roles ('owner' = who signed it up).
create or replace function sehat_mo_users(p_business uuid, p_roles text[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select array_remove(array(
    select b.auth_uid from businesses b where b.id = p_business and 'owner' = any(p_roles)
    union
    select p.auth_uid from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
     where bp.business_id = p_business and bp.role = any(p_roles) and bp.status <> 'suspended'
  ), null);
$$;

create or replace function sehat_mo_actor_name(p_business uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.full_name from practitioners p where p.auth_uid = auth.uid() limit 1),
    case when sehat_caller_role(p_business) = 'owner' then 'Owner' end,
    'Sehatsandhi');
$$;

create or replace function sehat_mo_log(p_order uuid, p_business uuid, p_event text, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into medicine_order_events (order_id, business_id, event, actor_uid, actor_name, note)
  values (p_order, p_business, p_event, auth.uid(), case when auth.uid() is null then 'Sehatsandhi' else sehat_mo_actor_name(p_business) end, p_note);
$$;

-- The patient's own steps, from their link: always 'Patient', whoever else is signed in on that browser.
create or replace function sehat_mo_log_patient(p_order uuid, p_business uuid, p_event text, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into medicine_order_events (order_id, business_id, event, actor_uid, actor_name, note)
  values (p_order, p_business, p_event, null, 'Patient', p_note);
$$;

create or replace function sehat_mo_url(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select sehat_site_url() || '/o/' || p_token;
$$;

-- A WhatsApp message to the patient, when sending is switched on.
create or replace function sehat_mo_wa(p_order uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare o medicine_orders;
begin
  if not coalesce((select order_sending_enabled from messaging_settings limit 1), false) then return; end if;
  select * into o from medicine_orders where id = p_order;
  insert into notification_outbox (recipient, phone, event, payload, status)
  values ('patient', o.patient_phone, 'medicine_order',
          jsonb_build_object('order_id', o.id, 'patient_name', o.patient_name, 'text', p_text), 'pending_wa');
exception when others then null;   -- a message must never undo an order step
end $$;

-- An app alert to some of a pharmacy's people.
create or replace function sehat_mo_push(p_order uuid, p_business uuid, p_roles text[], p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform sehat_queue_push('medicine_order', p_business, sehat_mo_users(p_business, p_roles), p_title, p_body,
    jsonb_build_object('kind', 'medicine_order', 'order_id', p_order));
exception when others then null;
end $$;

-- Tell every pharmacy that may take it.
create or replace function sehat_mo_offer(p_order uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare o medicine_orders; b uuid; n integer := 0;
begin
  select * into o from medicine_orders where id = p_order;
  for b in select x from sehat_mo_pharmacies(o.pin_code) x
            where not exists (select 1 from medicine_order_declines d where d.order_id = p_order and d.business_id = x)
  loop
    perform sehat_mo_push(p_order, b, array['owner', 'manager', 'pharmacist'],
      'New medicine order · ' || o.pin_code,
      o.code || ' — ' || coalesce(left(nullif(btrim(o.medicines), ''), 80), 'prescription photo') || '. Accept to price it.');
    n := n + 1;
  end loop;
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['sehat_mo_pharmacies(text)', 'sehat_mo_users(uuid, text[])', 'sehat_mo_actor_name(uuid)',
    'sehat_mo_log(uuid, uuid, text, text)', 'sehat_mo_log_patient(uuid, uuid, text, text)', 'sehat_mo_url(text)', 'sehat_mo_wa(uuid, text)',
    'sehat_mo_push(uuid, uuid, text[], text, text)', 'sehat_mo_offer(uuid)', 'sehat_pharmacy_shape()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;

-- ── 5. A new order (from the bot; service only) ─────────────────────────────
create or replace function sehat_create_medicine_order(
  p_phone text, p_pin text, p_name text, p_address text, p_medicines text, p_rx_url text, p_source text default 'whatsapp_bot'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_pin text := bot_pincode(p_pin);
  v_meds text := nullif(btrim(coalesce(p_medicines, '')), '');
  v_rx text := nullif(btrim(coalesce(p_rx_url, '')), '');
  v_code text; v_id uuid; v_token text; n integer;
begin
  if v_phone is null then return jsonb_build_object('ok', false, 'text', 'हमें आपका नंबर समझ नहीं आया। / We could not read your number.'); end if;
  if v_pin is null then return jsonb_build_object('ok', false, 'text', 'कृपया 6 अंकों का PIN कोड भेजें (जैसे 135001)। / Please send a 6-digit PIN code.'); end if;
  if v_meds is null and v_rx is null then
    return jsonb_build_object('ok', false, 'text', 'कृपया दवाइयों के नाम लिखें या पर्ची की फ़ोटो भेजें। / Please type the medicines or send a photo of the prescription.');
  end if;
  if v_rx is not null and v_rx !~* '^https://' then v_rx := null; end if;
  if (select count(*) from medicine_orders where patient_phone = v_phone
        and status in ('open', 'accepted', 'quoted', 'confirmed', 'packed', 'out_for_delivery')) >= 3 then
    return jsonb_build_object('ok', false, 'text', 'आपके 3 ऑर्डर पहले से चल रहे हैं। / You already have 3 orders in progress.');
  end if;

  loop
    v_code := 'MO-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from medicine_orders where code = v_code);
  end loop;

  insert into medicine_orders (code, source, patient_phone, patient_name, address, pin_code, medicines, prescription_url, status)
  values (v_code, coalesce(p_source, 'whatsapp_bot'), v_phone, nullif(btrim(left(coalesce(p_name, ''), 80)), ''),
          nullif(btrim(left(coalesce(p_address, ''), 300)), ''), v_pin, left(v_meds, 1000), v_rx,
          case when exists (select 1 from sehat_mo_pharmacies(v_pin)) then 'open' else 'no_pharmacy' end)
  returning id, token into v_id, v_token;
  perform sehat_mo_log(v_id, null, 'created', p_source);

  begin
    perform sehat_wa_handle_inbound(v_phone, nullif(btrim(coalesce(p_name, '')), ''), null, 'medicine order ' || v_code, null, null);
  exception when others then null;
  end;

  if (select status from medicine_orders where id = v_id) = 'no_pharmacy' then
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification)
    values ('bot', v_pin, 'medicine_delivery', false);
    return jsonb_build_object('ok', false, 'code', v_code, 'text',
      'माफ़ कीजिए, आपके PIN ' || v_pin || ' में अभी कोई फ़ार्मेसी होम डिलीवरी नहीं करती।' || E'\n\n'
      || coalesce(bot_pharmacy(v_pin), '') );
  end if;

  n := sehat_mo_offer(v_id);
  return jsonb_build_object('ok', true, 'code', v_code, 'token', v_token, 'pharmacies', n, 'text',
    '✅ आपका दवाई ऑर्डर ' || v_code || ' मिल गया।' || E'\n'
    || 'हमने इसे आपके एरिया की फ़ार्मेसी को भेज दिया है। जो फ़ार्मेसी इसे लेगी, वह कुल कीमत बताएगी — आपकी हाँ के बाद ही दवाई भेजी जाएगी।' || E'\n\n'
    || 'Your medicine order ' || v_code || ' has reached pharmacies near you. One will send you the total; nothing is delivered until you approve it.' || E'\n\n'
    || 'कीमत देखें और हाँ कहें / See the price and approve:' || E'\n' || sehat_mo_url(v_token));
end $$;
revoke all on function sehat_create_medicine_order(text, text, text, text, text, text, text) from public, anon, authenticated;

-- ── 6. The bot's search node, now also taking orders (0188 + 'medicine') ────
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

  -- 0188: hello / tips / rating, and 0189: medicine — only with the flow key.
  if v_type in ('hello', 'tips', 'rating', 'medicine') then
    v_val := sehat_bot_keyed(p_filter_value);
    if v_val is null then
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
    else
      r := bot_record_rating_json(p_pincode, v_val);
      return jsonb_build_object('found', coalesce((r ->> 'recorded')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    end if;
  end if;

  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;

-- ── 7. The pharmacy's side ──────────────────────────────────────────────────
-- What a pharmacy may see of an order depends on how far it has got:
--   offered (open, not ours)   area, medicines, whether there is a prescription
--   ours, before approval      + prescription, first name
--   ours, approved             + full name, phone, address — until 7 days after delivery
-- A delivery person sees only the orders handed to them.
create or replace function sehat_mo_row(o medicine_orders, p_business uuid, p_role text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'code', o.code, 'status', o.status, 'pin_code', o.pin_code,
    'medicines', o.medicines, 'has_prescription', o.prescription_url is not null,
    'created_at', o.created_at, 'accepted_at', o.accepted_at, 'accepted_by_name', o.accepted_by_name,
    'quote_amount', o.quote_amount, 'delivery_fee', o.delivery_fee, 'total', o.quote_amount + o.delivery_fee,
    'quote_note', o.quote_note, 'quoted_at', o.quoted_at, 'quoted_by_name', o.quoted_by_name,
    'rx_checked', o.rx_checked, 'confirmed_at', o.confirmed_at,
    'packed_at', o.packed_at, 'packed_by_name', o.packed_by_name,
    'delivery_practitioner_id', o.delivery_practitioner_id, 'delivery_name', o.delivery_name, 'out_at', o.out_at,
    'delivered_at', o.delivered_at, 'delivered_by_name', o.delivered_by_name,
    'collected_amount', o.collected_amount, 'collected_mode', o.collected_mode,
    'ended_reason', o.ended_reason, 'rating', o.rating, 'review', o.review, 'patient_paid', o.patient_paid,
    'mine', coalesce(o.business_id = p_business, false),
    'prescription_url', case when o.business_id = p_business and o.status not in ('cancelled', 'expired')
                              and (o.delivered_at is null or o.delivered_at > now() - interval '7 days') then o.prescription_url end,
    'patient_first_name', case when o.business_id = p_business then split_part(coalesce(o.patient_name, ''), ' ', 1) end,
    'patient_name', case when o.business_id = p_business and o.confirmed_at is not null
                          and (o.delivered_at is null or o.delivered_at > now() - interval '7 days') then o.patient_name end,
    'patient_phone', case when o.business_id = p_business and o.confirmed_at is not null
                           and o.status not in ('cancelled')
                           and (o.delivered_at is null or o.delivered_at > now() - interval '7 days') then o.patient_phone end,
    'address', case when o.business_id = p_business and o.confirmed_at is not null
                     and o.status not in ('cancelled')
                     and (o.delivered_at is null or o.delivered_at > now() - interval '7 days') then o.address end,
    'events', case when o.business_id = p_business then (
        select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'by', e.actor_name, 'note', e.note, 'at', e.created_at) order by e.created_at), '[]')
          from medicine_order_events e where e.order_id = o.id and (e.business_id is null or e.business_id = p_business)) end
  );
$$;
revoke all on function sehat_mo_row(medicine_orders, uuid, text) from public, anon, authenticated;

create or replace function sehat_mo_role(p_business uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_business is null or not sehat_caller_owns_business(p_business) then
    raise exception 'Not your pharmacy.' using errcode = '42501';
  end if;
  if (select vertical from businesses where id = p_business) <> 'pharmacy' then
    raise exception 'Medicine orders are for pharmacies.' using errcode = 'P0001';
  end if;
  v := coalesce(sehat_caller_role(p_business), 'owner');
  if v not in ('owner', 'manager', 'pharmacist', 'delivery') then
    raise exception 'Your role here does not handle orders.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function sehat_mo_role(uuid) from public, anon, authenticated;

-- p_scope: 'new' (offered to us), 'active' (ours, in progress), 'done' (ours, finished, last 30 days)
create or replace function sehat_mo_list(p_business uuid, p_scope text default 'active')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := sehat_mo_role(p_business);
  v_pins text[] := (select delivery_pin_codes from businesses where id = p_business);
  v_me uuid := (select p.id from practitioners p where p.auth_uid = auth.uid() limit 1);
begin
  if v_role = 'delivery' then
    return coalesce((select jsonb_agg(sehat_mo_row(o, p_business, v_role) order by o.out_at desc nulls last, o.updated_at desc)
      from medicine_orders o
     where o.business_id = p_business and o.delivery_practitioner_id = v_me
       and (case when p_scope = 'done' then o.status = 'delivered' and o.delivered_at > now() - interval '30 days'
                 else o.status in ('packed', 'out_for_delivery') end)), '[]');
  end if;
  if p_scope = 'new' then
    return coalesce((select jsonb_agg(sehat_mo_row(o, p_business, v_role) order by o.created_at)
      from medicine_orders o
     where o.status = 'open' and o.pin_code = any(v_pins)
       and p_business in (select sehat_mo_pharmacies(o.pin_code))
       and not exists (select 1 from medicine_order_declines d where d.order_id = o.id and d.business_id = p_business)), '[]');
  end if;
  return coalesce((select jsonb_agg(sehat_mo_row(o, p_business, v_role) order by o.updated_at desc)
    from medicine_orders o
   where o.business_id = p_business
     and (case when p_scope = 'done'
               then o.status in ('delivered', 'cancelled', 'expired') and o.updated_at > now() - interval '30 days'
               else o.status in ('accepted', 'quoted', 'confirmed', 'packed', 'out_for_delivery') end)), '[]');
end $$;
revoke all on function sehat_mo_list(uuid, text) from public, anon;
grant execute on function sehat_mo_list(uuid, text) to authenticated;

create or replace function sehat_mo_get(p_business uuid, p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text := sehat_mo_role(p_business); o medicine_orders;
  v_pins text[] := (select delivery_pin_codes from businesses where id = p_business);
begin
  select * into o from medicine_orders where id = p_order;
  if o.id is null then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_role = 'delivery' and o.delivery_practitioner_id is distinct from (select p.id from practitioners p where p.auth_uid = auth.uid() limit 1) then
    raise exception 'This order is not with you.' using errcode = '42501';
  end if;
  if o.business_id is distinct from p_business and not (o.status = 'open' and o.pin_code = any(v_pins)) then
    raise exception 'This order is with another pharmacy.' using errcode = '42501';
  end if;
  return sehat_mo_row(o, p_business, v_role);
end $$;
revoke all on function sehat_mo_get(uuid, uuid) from public, anon;
grant execute on function sehat_mo_get(uuid, uuid) to authenticated;

-- One entry point for every step a pharmacy takes.
--   accept | decline(reason) | quote(amount = medicines, fee = delivery, note, rx_checked) | drop(reason)
--   packed | assign(practitioner) | delivered(amount, mode)
create or replace function sehat_mo_act(
  p_business uuid, p_order uuid, p_action text,
  p_amount numeric default null, p_note text default null, p_rx_checked boolean default null,
  p_practitioner uuid default null, p_mode text default null, p_fee numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := sehat_mo_role(p_business);
  v_name text := sehat_mo_actor_name(p_business);
  v_me uuid := (select p.id from practitioners p where p.auth_uid = auth.uid() limit 1);
  v_biz text := (select name from businesses where id = p_business);
  o medicine_orders;
begin
  select * into o from medicine_orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_role = 'delivery' and p_action <> 'delivered' then
    raise exception 'A delivery person can only mark an order delivered.' using errcode = '42501';
  end if;

  if p_action = 'accept' then
    if o.status <> 'open' then
      raise exception '%', case when o.business_id is not null then 'Another pharmacy has already taken this order.' else 'This order is no longer open.' end using errcode = 'P0001';
    end if;
    if p_business not in (select sehat_mo_pharmacies(o.pin_code))
       or exists (select 1 from medicine_order_declines d where d.order_id = o.id and d.business_id = p_business) then
      raise exception 'This order is not offered to you.' using errcode = '42501';
    end if;
    update medicine_orders set status = 'accepted', business_id = p_business, accepted_at = now(),
           accepted_by = auth.uid(), accepted_by_name = v_name, updated_at = now() where id = o.id;
    perform sehat_mo_log(o.id, p_business, 'accepted');
    perform sehat_mo_wa(o.id, v_biz || ' ने आपका दवाई ऑर्डर ' || o.code || ' ले लिया है और जल्द ही कुल कीमत भेजेगी।' || E'\n'
      || v_biz || ' has taken your medicine order ' || o.code || ' and will send the total shortly.' || E'\n' || sehat_mo_url(o.token));

  elsif p_action = 'decline' then
    if o.status <> 'open' then raise exception 'This order is no longer open.' using errcode = 'P0001'; end if;
    insert into medicine_order_declines (order_id, business_id, reason) values (o.id, p_business, left(p_note, 200))
    on conflict do nothing;
    perform sehat_mo_log(o.id, p_business, 'declined', left(p_note, 200));

  elsif p_action = 'quote' then
    if o.business_id is distinct from p_business or o.status not in ('accepted', 'quoted') then
      raise exception 'Only an order you have accepted can be priced.' using errcode = 'P0001';
    end if;
    if p_amount is null or p_amount <= 0 or p_amount > 200000 then raise exception 'Enter the medicines total in rupees.' using errcode = '22023'; end if;
    if coalesce(p_fee, 0) < 0 or coalesce(p_fee, 0) > 2000 then raise exception 'The delivery fee should be between ₹0 and ₹2000.' using errcode = '22023'; end if;
    if not coalesce(p_rx_checked, false) then
      raise exception 'Tick that every prescription-only medicine is backed by the prescription.' using errcode = '22023';
    end if;
    update medicine_orders set status = 'quoted', quote_amount = round(p_amount, 2), delivery_fee = round(coalesce(p_fee, 0), 2), quote_note = nullif(btrim(left(coalesce(p_note, ''), 300)), ''),
           rx_checked = true, quoted_at = now(), quoted_by_name = v_name, updated_at = now() where id = o.id;
    perform sehat_mo_log(o.id, p_business, 'quoted', 'medicines ₹' || round(p_amount, 2)
      || case when coalesce(p_fee, 0) > 0 then ' + delivery ₹' || round(p_fee, 2) else '' end || coalesce(' — ' || nullif(btrim(p_note), ''), ''));
    perform sehat_mo_wa(o.id, v_biz || ' — ऑर्डर / order ' || o.code || E':\n'
      || 'दवाइयाँ / Medicines: ₹' || round(p_amount) || E'\n'
      || case when coalesce(p_fee, 0) > 0 then 'डिलीवरी / Delivery: ₹' || round(p_fee) else 'डिलीवरी / Delivery: free' end || E'\n'
      || 'कुल / Total: ₹' || round(p_amount + coalesce(p_fee, 0)) || E'\n\n'
      || 'हाँ कहने या मना करने के लिए यह लिंक खोलें / Open this link to approve or refuse:' || E'\n' || sehat_mo_url(o.token));

  elsif p_action = 'drop' then
    if o.business_id is distinct from p_business or o.status not in ('accepted', 'quoted', 'confirmed', 'packed') then
      raise exception 'This order cannot be given up now.' using errcode = 'P0001';
    end if;
    insert into medicine_order_declines (order_id, business_id, reason) values (o.id, p_business, left(coalesce(p_note, 'dropped'), 200))
    on conflict do nothing;
    update medicine_orders set status = 'open', business_id = null, accepted_at = null, accepted_by = null, accepted_by_name = null,
           quote_amount = null, delivery_fee = 0, quote_note = null, quoted_at = null, quoted_by_name = null, rx_checked = false,
           confirmed_at = null, packed_at = null, packed_by_name = null, delivery_practitioner_id = null, delivery_name = null,
           created_at = now(), updated_at = now() where id = o.id;
    perform sehat_mo_log(o.id, p_business, 'dropped', left(p_note, 200));
    if exists (select 1 from sehat_mo_pharmacies(o.pin_code) x
                where not exists (select 1 from medicine_order_declines d where d.order_id = o.id and d.business_id = x)) then
      perform sehat_mo_offer(o.id);
      perform sehat_mo_wa(o.id, 'आपका ऑर्डर ' || o.code || ' दूसरी फ़ार्मेसी को भेजा जा रहा है। / Your order ' || o.code || ' is going to another pharmacy.');
    else
      update medicine_orders set status = 'expired', ended_reason = 'no other pharmacy', updated_at = now() where id = o.id;
      perform sehat_mo_wa(o.id, 'माफ़ कीजिए, आपका ऑर्डर ' || o.code || ' कोई फ़ार्मेसी पूरा नहीं कर पाई। / Sorry, no pharmacy could fill order ' || o.code || '.');
    end if;

  elsif p_action = 'packed' then
    if o.business_id is distinct from p_business or o.status <> 'confirmed' then
      raise exception 'Only an approved order can be marked packed.' using errcode = 'P0001';
    end if;
    update medicine_orders set status = 'packed', packed_at = now(), packed_by_name = v_name, updated_at = now() where id = o.id;
    perform sehat_mo_log(o.id, p_business, 'packed');

  elsif p_action = 'assign' then
    if o.business_id is distinct from p_business or o.status not in ('confirmed', 'packed', 'out_for_delivery') then
      raise exception 'Only an approved order can go out for delivery.' using errcode = 'P0001';
    end if;
    if p_practitioner is not null and not exists (select 1 from business_practitioners bp where bp.business_id = p_business
          and bp.practitioner_id = p_practitioner and bp.status <> 'suspended') then
      raise exception 'That person is not on your team.' using errcode = '22023';
    end if;
    update medicine_orders set status = 'out_for_delivery', out_at = now(),
           packed_at = coalesce(packed_at, now()), packed_by_name = coalesce(packed_by_name, v_name),
           delivery_practitioner_id = p_practitioner,
           delivery_name = coalesce((select full_name from practitioners where id = p_practitioner), v_name),
           updated_at = now() where id = o.id;
    perform sehat_mo_log(o.id, p_business, 'out_for_delivery', (select full_name from practitioners where id = p_practitioner));
    if p_practitioner is not null then
      perform sehat_queue_push('medicine_order', p_business,
        array[(select auth_uid from practitioners where id = p_practitioner)],
        'Deliver ' || o.code, coalesce(split_part(o.patient_name, ' ', 1), 'Patient') || ' · ' || o.pin_code || ' · collect ₹' || round(o.quote_amount + o.delivery_fee),
        jsonb_build_object('kind', 'medicine_order', 'order_id', o.id));
    end if;
    perform sehat_mo_wa(o.id, 'आपकी दवाइयाँ (' || o.code || ') रास्ते में हैं। / Your medicines (' || o.code || ') are on the way.');

  elsif p_action = 'delivered' then
    if o.business_id is distinct from p_business or o.status not in ('confirmed', 'packed', 'out_for_delivery') then
      raise exception 'This order is not out for delivery.' using errcode = 'P0001';
    end if;
    if v_role = 'delivery' and o.delivery_practitioner_id is distinct from v_me then
      raise exception 'This order is not with you.' using errcode = '42501';
    end if;
    if p_amount is null or p_amount < 0 then raise exception 'Enter the amount collected.' using errcode = '22023'; end if;
    if p_mode is null or p_mode not in ('cash', 'upi', 'card', 'other') then raise exception 'Choose how they paid.' using errcode = '22023'; end if;
    update medicine_orders set status = 'delivered', delivered_at = now(), delivered_by_name = v_name,
           collected_amount = round(p_amount, 2), collected_mode = p_mode, updated_at = now() where id = o.id;
    perform sehat_mo_log(o.id, p_business, 'delivered', '₹' || round(p_amount, 2) || ' ' || p_mode);
    perform sehat_mo_wa(o.id, 'आपकी दवाइयाँ (' || o.code || ') पहुँच गईं। कृपया बताएँ आपने कितना दिया और ' || v_biz || ' को रेटिंग दें:' || E'\n'
      || 'Delivered. Please tell us what you paid and rate ' || v_biz || ':' || E'\n' || sehat_mo_url(o.token));
  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;

  select * into o from medicine_orders where id = p_order;
  return sehat_mo_row(o, p_business, v_role);
end $$;
revoke all on function sehat_mo_act(uuid, uuid, text, numeric, text, boolean, uuid, text, numeric) from public, anon;
grant execute on function sehat_mo_act(uuid, uuid, text, numeric, text, boolean, uuid, text, numeric) to authenticated;

-- Where this pharmacy delivers: every area it is listed in, and which it chose.
create or replace function sehat_mo_delivery_area(p_business uuid)
returns table (pin_code text, area_name text, chosen boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_mo_role(p_business);
  return query
    select x.pin, (select string_agg(distinct sa.area_name, ', ') from service_areas sa where sa.pin_code = x.pin),
           x.pin = any(b.delivery_pin_codes)
      from businesses b, unnest(coalesce(b.pin_codes, '{}')) as x(pin)
     where b.id = p_business
     order by x.pin;
end $$;
revoke all on function sehat_mo_delivery_area(uuid) from public, anon;
grant execute on function sehat_mo_delivery_area(uuid) to authenticated;

-- Owner or manager only; only areas it is listed in.
create or replace function sehat_mo_set_delivery_area(p_business uuid, p_pins text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare v text[];
begin
  if sehat_mo_role(p_business) not in ('owner', 'manager') then
    raise exception 'Only the owner or a manager can change where you deliver.' using errcode = '42501';
  end if;
  update businesses b set delivery_pin_codes = array(
           select distinct p from unnest(coalesce(p_pins, '{}')) p where p = any(coalesce(b.pin_codes, '{}')) order by p)
   where b.id = p_business
  returning delivery_pin_codes into v;
  return v;
end $$;
revoke all on function sehat_mo_set_delivery_area(uuid, text[]) from public, anon;
grant execute on function sehat_mo_set_delivery_area(uuid, text[]) to authenticated;

-- Who can take an order out.
create or replace function sehat_mo_delivery_people(p_business uuid)
returns table (practitioner_id uuid, name text, role text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_mo_role(p_business);
  return query
    select p.id, p.full_name, bp.role from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
     where bp.business_id = p_business and bp.status <> 'suspended' and bp.role in ('delivery', 'pharmacist', 'manager', 'owner')
     order by case bp.role when 'delivery' then 0 else 1 end, p.full_name;
end $$;
revoke all on function sehat_mo_delivery_people(uuid) from public, anon;
grant execute on function sehat_mo_delivery_people(uuid) to authenticated;

-- ── 8. The patient's link (no login; the token is the key) ──────────────────
create or replace function sehat_mo_public(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', o.code, 'status', o.status, 'pin_code', o.pin_code, 'medicines', o.medicines,
    'has_prescription', o.prescription_url is not null, 'patient_name', split_part(coalesce(o.patient_name, ''), ' ', 1),
    'created_at', o.created_at, 'accepted_at', o.accepted_at, 'quoted_at', o.quoted_at, 'confirmed_at', o.confirmed_at,
    'packed_at', o.packed_at, 'out_at', o.out_at, 'delivered_at', o.delivered_at,
    'quote_amount', o.quote_amount, 'delivery_fee', o.delivery_fee, 'total', o.quote_amount + o.delivery_fee,
    'quote_note', o.quote_note, 'ended_reason', o.ended_reason,
    'pharmacy', case when o.business_id is not null then b.name end,
    'pharmacy_phone', case when o.confirmed_at is not null then b.phone end,
    'pharmacy_address', case when o.confirmed_at is not null then b.address end,
    'delivery_name', case when o.status = 'out_for_delivery' then split_part(coalesce(o.delivery_name, ''), ' ', 1) end,
    'rating', o.rating, 'review', o.review, 'patient_paid', o.patient_paid,
    'others', case when o.status in ('expired', 'no_pharmacy', 'cancelled') then bot_pharmacy(o.pin_code) end)
  from medicine_orders o left join businesses b on b.id = o.business_id
  where o.token = p_token and length(coalesce(p_token, '')) = 24;
$$;
revoke all on function sehat_mo_public(text) from public;
grant execute on function sehat_mo_public(text) to anon, authenticated;

-- p_action: confirm | refuse | cancel | feedback(rating, review, paid)
create or replace function sehat_mo_patient(p_token text, p_action text,
  p_rating integer default null, p_review text default null, p_paid numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o medicine_orders;
begin
  select * into o from medicine_orders where token = p_token and length(coalesce(p_token, '')) = 24 for update;
  if o.id is null then raise exception 'This order link is not valid.' using errcode = 'P0002'; end if;

  if p_action = 'confirm' then
    if o.status <> 'quoted' then raise exception 'There is no price waiting for your approval.' using errcode = 'P0001'; end if;
    update medicine_orders set status = 'confirmed', confirmed_at = now(), updated_at = now() where id = o.id;
    perform sehat_mo_log_patient(o.id, o.business_id, 'patient_confirmed', '₹' || (o.quote_amount + o.delivery_fee));
    perform sehat_mo_push(o.id, o.business_id, array['owner', 'manager', 'pharmacist'],
      'Approved · ' || o.code, coalesce(split_part(o.patient_name, ' ', 1), 'The patient') || ' approved ₹' || round(o.quote_amount + o.delivery_fee) || '. Pack and send it.');
  elsif p_action in ('refuse', 'cancel') then
    if o.status not in ('open', 'accepted', 'quoted', 'confirmed', 'packed') then
      raise exception 'This order can no longer be cancelled here. Please call the pharmacy.' using errcode = 'P0001';
    end if;
    update medicine_orders set status = 'cancelled', ended_reason = case when p_action = 'refuse' then 'patient refused the price' else 'patient cancelled' end,
           updated_at = now() where id = o.id;
    perform sehat_mo_log_patient(o.id, o.business_id, 'patient_' || p_action || 'd');
    if o.business_id is not null then
      perform sehat_mo_push(o.id, o.business_id, array['owner', 'manager', 'pharmacist'],
        'Cancelled · ' || o.code, 'The patient ' || case when p_action = 'refuse' then 'refused the price.' else 'cancelled the order.' end);
    end if;
  elsif p_action = 'feedback' then
    if o.status <> 'delivered' then raise exception 'You can rate the pharmacy after delivery.' using errcode = 'P0001'; end if;
    if p_rating is null or p_rating not between 1 and 5 then raise exception 'Choose 1 to 5 stars.' using errcode = '22023'; end if;
    update medicine_orders set rating = p_rating, review = nullif(btrim(left(coalesce(p_review, ''), 500)), ''),
           patient_paid = case when p_paid is not null and p_paid >= 0 then round(p_paid, 2) end,
           rated_at = now(), updated_at = now() where id = o.id;
    perform sehat_mo_log_patient(o.id, o.business_id, 'patient_rated', p_rating || '★' || coalesce(' paid ₹' || round(p_paid, 2), ''));
    if o.collected_amount is not null and p_paid is not null and abs(p_paid - o.collected_amount) >= 1 then
      perform sehat_mo_log_patient(o.id, null, 'amount_mismatch', 'pharmacy recorded ₹' || o.collected_amount || ', patient says ₹' || round(p_paid, 2));
    end if;
  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;
  return sehat_mo_public(p_token);
end $$;
revoke all on function sehat_mo_patient(text, text, integer, text, numeric) from public;
grant execute on function sehat_mo_patient(text, text, integer, text, numeric) to anon, authenticated;

-- ── 9. Clocks ───────────────────────────────────────────────────────────────
create or replace function sehat_mo_tick()
returns integer language plpgsql security definer set search_path = public as $$
declare o medicine_orders; n integer := 0;
begin
  -- Nobody accepted in 30 minutes.
  for o in select * from medicine_orders where status = 'open' and created_at < now() - interval '30 minutes' for update skip locked loop
    update medicine_orders set status = 'expired', ended_reason = 'no pharmacy accepted in 30 minutes', updated_at = now() where id = o.id;
    perform sehat_mo_log(o.id, null, 'expired', 'no pharmacy accepted');
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification) values ('bot', o.pin_code, 'medicine_delivery', false);
    perform sehat_mo_wa(o.id, 'माफ़ कीजिए, अभी कोई फ़ार्मेसी आपका ऑर्डर ' || o.code || ' नहीं ले पाई। इन्हें सीधे कॉल कर सकते हैं:' || E'\n'
      || coalesce(bot_pharmacy(o.pin_code), '') || E'\n' || 'Sorry, no pharmacy could take order ' || o.code || ' right now.');
    n := n + 1;
  end loop;
  -- Accepted but not priced in an hour: back to the others.
  for o in select * from medicine_orders where status = 'accepted' and accepted_at < now() - interval '60 minutes' for update skip locked loop
    insert into medicine_order_declines (order_id, business_id, reason) values (o.id, o.business_id, 'not priced in an hour') on conflict do nothing;
    perform sehat_mo_log(o.id, o.business_id, 'released', 'not priced in an hour');
    update medicine_orders set status = 'open', business_id = null, accepted_at = null, accepted_by = null, accepted_by_name = null,
           created_at = now(), updated_at = now() where id = o.id;
    if exists (select 1 from sehat_mo_pharmacies(o.pin_code) x
                where not exists (select 1 from medicine_order_declines d where d.order_id = o.id and d.business_id = x)) then
      perform sehat_mo_offer(o.id);
    else
      update medicine_orders set created_at = now() - interval '31 minutes' where id = o.id;   -- expires on the next tick, with the message
    end if;
    n := n + 1;
  end loop;
  -- A price nobody approved in 24 hours.
  for o in select * from medicine_orders where status = 'quoted' and quoted_at < now() - interval '24 hours' for update skip locked loop
    update medicine_orders set status = 'expired', ended_reason = 'price not approved in 24 hours', updated_at = now() where id = o.id;
    perform sehat_mo_log(o.id, o.business_id, 'expired', 'price not approved in 24 hours');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_mo_tick() from public, anon, authenticated;

-- WhatsApp to patients, on the appointment campaign (one {{1}} carrying the text).
create or replace function sehat_send_order_messages()
returns integer language plpgsql security definer set search_path = public as $$
declare rec record; v_key text; v_campaign text; v_phone text; v_req bigint; n integer := 0;
begin
  select coalesce(order_campaign, rating_campaign) into v_campaign from messaging_settings
   where order_sending_enabled limit 1;
  if v_campaign is null then return 0; end if;
  begin select decrypted_secret into v_key from vault.decrypted_secrets where name = 'aisensy_api_key';
  exception when others then v_key := null; end;
  if coalesce(v_key, '') = '' then return 0; end if;
  for rec in select id, phone, payload from notification_outbox
              where event = 'medicine_order' and status = 'pending_wa' order by created_at limit 50 for update skip locked loop
    v_phone := sehat_normalise_phone(rec.phone);
    if v_phone is null then
      update notification_outbox set status = 'failed', last_error = 'not a valid Indian mobile' where id = rec.id; continue;
    end if;
    v_req := net.http_post(
      url := 'https://backend.aisensy.com/campaign/t1/api/v2',
      body := jsonb_build_object('apiKey', v_key, 'campaignName', v_campaign, 'destination', v_phone,
        'userName', coalesce(rec.payload ->> 'patient_name', 'Patient'), 'source', 'medicine-order',
        'templateParams', jsonb_build_array(rec.payload ->> 'text')),
      headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 10000);
    update notification_outbox set status = 'sent', sent_channel = 'whatsapp', sent_at = now(),
           attempts = coalesce(attempts, 0) + 1, provider_request_id = v_req where id = rec.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_send_order_messages() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('medicine-order-tick', 'medicine-order-messages');
  perform cron.schedule('medicine-order-tick', '*/5 * * * *', 'select public.sehat_mo_tick()');
  perform cron.schedule('medicine-order-messages', '* * * * *', 'select public.sehat_send_order_messages()');
end $$;

-- ── 10. Sehatsandhi admins ──────────────────────────────────────────────────
create or replace function sehat_admin_medicine_orders(p_days integer default 30)
returns table (code text, status text, pin_code text, created_at timestamptz, pharmacy text,
               quote_total numeric, collected_amount numeric, patient_paid numeric, rating smallint,
               mismatch boolean, ended_reason text)
language sql stable security definer set search_path = public as $$
  select o.code, o.status, o.pin_code, o.created_at, b.name, o.quote_amount + o.delivery_fee, o.collected_amount, o.patient_paid, o.rating,
         (o.collected_amount is not null and o.patient_paid is not null and abs(o.collected_amount - o.patient_paid) >= 1),
         o.ended_reason
    from medicine_orders o left join businesses b on b.id = o.business_id
   where sehat_is_staff() and o.created_at > now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   order by o.created_at desc;
$$;
revoke all on function sehat_admin_medicine_orders(integer) from public, anon;
grant execute on function sehat_admin_medicine_orders(integer) to authenticated;

notify pgrst, 'reload schema';
