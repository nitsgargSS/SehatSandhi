-- ============================================================================
-- Sehatsandhi — insurance leads: free to list, a flat fee per lead accepted
--
-- Run AFTER 0191. Safe to re-run.
--
-- Decided 4 Oct 2026. Section 40 of the Insurance Act bars paying anyone but a
-- licensed intermediary for soliciting insurance, so Sehatsandhi takes nothing
-- tied to a policy or its premium. Instead:
--   • Advisors list free. They pay a FLAT FEE for each lead they choose to
--     accept (vertical_billing.lead_fee, default ₹100, set in admin), taken
--     from the prepaid wallet the WhatsApp add-on already uses (0116).
--   • An advisor must have their IRDAI licence / POSP code on the listing
--     (businesses.reg_number) to accept, and the person is shown it.
--   • Each advisor chooses the PIN codes they serve (delivery_pin_codes, as
--     pharmacies and ambulances do). None chosen, no leads.
--
-- A LEAD (insurance_leads, 0046's table, widened)
--   open      every advisor serving that PIN sees it — area, cover wanted, who
--             is to be covered, when to call; never the name or number
--   accepted  the first advisor to accept pays the fee and gets the lead
--             alone: name, phone, everything
--   contacted / won / lost   the advisor's own follow-up. Won records the
--             insurer and plan — never the premium: nothing here depends on it
--   disputed  the advisor reports a wrong number or a fake; a Sehatsandhi admin
--             refunds the fee to the wallet or rejects the claim
--   expired   nobody accepted in 24 hours: the person gets advisors to call
--   The person follows it on /i/<token>: the advisor's name, phone and licence,
--   "the advisor has not called me", and afterwards did they buy, and a rating.
--
-- THE BOT
--   The existing insurance API node (bot_submit_insurance_lead_json, phone +
--   PIN) keeps working and now creates a proper lead. The search node takes a
--   richer one, keyed like 0188:
--   p_type 'insurance_lead'
--   p_filter_value '<flow key>|<PIN>|<name>|<cover wanted>|<who is covered>|<when to call>'
--   p_pincode      the WhatsApp number
-- ============================================================================

-- ── 1. Free to list; the lead fee ───────────────────────────────────────────
alter table vertical_billing add column if not exists lead_fee integer not null default 0 check (lead_fee >= 0);
update vertical_billing
   set billing_model = 'commission', monthly_enabled = false, commission_enabled = false, commission_percent = 0,
       commission_basis = 'flat fee per accepted lead — nothing on policies',
       lead_fee = case when lead_fee = 0 then 100 else lead_fee end
 where vertical = 'insurance';

-- Public: what a lead costs, for the signup and landing pages.
create or replace function sehat_lead_fee()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select lead_fee from vertical_billing where vertical = 'insurance'), 100);
$$;
revoke all on function sehat_lead_fee() from public;
grant execute on function sehat_lead_fee() to anon, authenticated;

-- Sehatsandhi admins change it (owner/admin only, as other prices).
create or replace function sehat_admin_set_lead_fee(p_rupees integer)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Only a Sehatsandhi admin can change the lead fee.' using errcode = '42501'; end if;
  if p_rupees is null or p_rupees < 0 or p_rupees > 10000 then raise exception 'Enter a fee between ₹0 and ₹10,000.' using errcode = '22023'; end if;
  update vertical_billing set lead_fee = p_rupees where vertical = 'insurance';
  return p_rupees;
end $$;
revoke all on function sehat_admin_set_lead_fee(integer) from public, anon;
grant execute on function sehat_admin_set_lead_fee(integer) to authenticated;

-- An advisor has no OPD or IPD.
create or replace function sehat_insurance_shape()
returns trigger language plpgsql as $$
begin
  if new.vertical = 'insurance' then new.opd_module := false; new.ipd_module := false; end if;
  return new;
end $$;
drop trigger if exists insurance_shape on businesses;
create trigger insurance_shape before insert or update of vertical, opd_module, ipd_module
  on businesses for each row execute function sehat_insurance_shape();
update businesses set vertical = vertical where vertical = 'insurance';
revoke all on function sehat_insurance_shape() from public, anon, authenticated;

-- The wallet learns a lead fee.
alter table business_wallet_transactions drop constraint if exists business_wallet_transactions_type_check;
alter table business_wallet_transactions add constraint business_wallet_transactions_type_check
  check (type in ('recharge', 'message_send', 'refund', 'adjustment', 'lead_fee'));
alter table business_wallet_transactions add column if not exists lead_id uuid;

-- "Where you serve" for advisors too (0191's, widened once more).
create or replace function sehat_area_role(p_business uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_vertical text;
begin
  if p_business is null or not sehat_caller_owns_business(p_business) then
    raise exception 'Not your business.' using errcode = '42501';
  end if;
  v_vertical := (select vertical from businesses where id = p_business);
  if v_vertical not in ('pharmacy', 'ambulance', 'insurance') then
    raise exception 'Only pharmacies, ambulance services and insurance advisors choose where they serve.' using errcode = 'P0001';
  end if;
  return coalesce(sehat_caller_role(p_business), 'owner');
end $$;

-- ── 2. The lead ─────────────────────────────────────────────────────────────
alter table insurance_leads drop constraint if exists insurance_leads_status_check;
alter table insurance_leads
  add column if not exists code text,
  add column if not exists token text,
  add column if not exists patient_name text,
  add column if not exists cover text,
  add column if not exists members text,
  add column if not exists call_time text,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by_name text,
  add column if not exists fee_paise integer,
  add column if not exists fee_refunded boolean not null default false,
  add column if not exists contacted_at timestamptz,
  add column if not exists outcome_at timestamptz,
  add column if not exists insurer text,
  add column if not exists plan_name text,
  add column if not exists lost_reason text,
  add column if not exists dispute_reason text,
  add column if not exists disputed_at timestamptz,
  add column if not exists dispute_resolution text,
  add column if not exists patient_not_called_at timestamptz,
  add column if not exists patient_bought boolean,
  add column if not exists rating smallint check (rating between 1 and 5),
  add column if not exists review text,
  add column if not exists rated_at timestamptz,
  add column if not exists ended_reason text,
  add column if not exists updated_at timestamptz not null default now();
-- 0046's statuses (new/contacted/closed) stay readable; new leads use the rest.
alter table insurance_leads add constraint insurance_leads_status_check
  check (status in ('new', 'contacted', 'closed', 'open', 'accepted', 'won', 'lost', 'disputed', 'expired', 'cancelled')) not valid;
create unique index if not exists insurance_leads_code_key on insurance_leads (code) where code is not null;
create unique index if not exists insurance_leads_token_key on insurance_leads (token) where token is not null;
create index if not exists insurance_leads_open_idx on insurance_leads (pincode, created_at) where status = 'open';
create index if not exists insurance_leads_agent_idx on insurance_leads (agent_business_id, updated_at desc);
alter table insurance_leads enable row level security;
revoke all on insurance_leads from anon, authenticated;

create table if not exists insurance_lead_declines (
  lead_id uuid not null references insurance_leads(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lead_id, business_id)
);
alter table insurance_lead_declines enable row level security;
revoke all on insurance_lead_declines from anon, authenticated;

create table if not exists insurance_lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references insurance_leads(id) on delete cascade,
  business_id uuid,
  event text not null,
  actor_uid uuid,
  actor_name text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists insurance_lead_events_idx on insurance_lead_events (lead_id, created_at);
alter table insurance_lead_events enable row level security;
revoke all on insurance_lead_events from anon, authenticated;

-- ── 3. Helpers ──────────────────────────────────────────────────────────────
-- Advisors who may take a lead here: serve the PIN, listed there, live, licensed.
create or replace function sehat_il_advisors(p_pin text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id from businesses b
   where b.vertical = 'insurance' and b.status = 'active'
     and p_pin = any(b.delivery_pin_codes)
     and p_pin = any(coalesce(b.pin_codes, '{}'))
     and nullif(btrim(coalesce(b.reg_number, '')), '') is not null
     and (b.term_end is null or b.term_end >= (now() at time zone 'Asia/Kolkata')::date);
$$;

create or replace function sehat_il_log(p_lead uuid, p_business uuid, p_event text, p_note text default null, p_who text default null)
returns void language sql security definer set search_path = public as $$
  insert into insurance_lead_events (lead_id, business_id, event, actor_uid, actor_name, note)
  values (p_lead, p_business, p_event, case when p_who is null then auth.uid() end,
          coalesce(p_who, case when auth.uid() is null then 'Sehatsandhi' else sehat_mo_actor_name(p_business) end), p_note);
$$;

create or replace function sehat_il_url(p_token text)
returns text language sql stable security definer set search_path = public as $$
  select sehat_site_url() || '/i/' || p_token;
$$;

create or replace function sehat_il_wa(p_lead uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare l insurance_leads;
begin
  if not coalesce((select order_sending_enabled from messaging_settings limit 1), false) then return; end if;
  select * into l from insurance_leads where id = p_lead;
  insert into notification_outbox (recipient, phone, event, payload, status)
  values ('patient', l.patient_phone, 'medicine_order',   -- 0189's sender
          jsonb_build_object('insurance_lead_id', l.id, 'patient_name', l.patient_name, 'text', p_text), 'pending_wa');
exception when others then null;
end $$;

create or replace function sehat_il_offer(p_lead uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare l insurance_leads; b uuid; n integer := 0;
begin
  select * into l from insurance_leads where id = p_lead;
  for b in select x from sehat_il_advisors(l.pincode) x
            where not exists (select 1 from insurance_lead_declines d where d.lead_id = p_lead and d.business_id = x)
  loop
    begin
      perform sehat_queue_push('insurance_lead', b, sehat_mo_users(b, array['owner', 'manager']),
        'New insurance lead · ' || l.pincode,
        l.code || ' — ' || coalesce(nullif(l.cover, ''), 'health cover') || coalesce(' for ' || nullif(l.members, ''), '') || '. ₹' || sehat_lead_fee() || ' to accept.',
        jsonb_build_object('kind', 'insurance_lead', 'lead_id', l.id));
    exception when others then null;
    end;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['sehat_il_advisors(text)', 'sehat_il_log(uuid, uuid, text, text, text)', 'sehat_il_url(text)',
    'sehat_il_wa(uuid, text)', 'sehat_il_offer(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $$;

-- ── 4. A new lead (from the bot; service only) ──────────────────────────────
create or replace function sehat_create_insurance_lead(
  p_phone text, p_pin text, p_name text, p_cover text, p_members text, p_call_time text, p_source text default 'whatsapp_bot'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_pin text := bot_pincode(p_pin);
  l insurance_leads; v_code text; n integer; v_dir text;
begin
  if v_phone is null then return jsonb_build_object('ok', false, 'text', 'हमें आपका मोबाइल नंबर सही से नहीं मिला। / We could not read your number.'); end if;
  if v_pin is null then return jsonb_build_object('ok', false, 'text', 'कृपया 6 अंकों का PIN कोड भेजें (जैसे 135001)। / Please send a 6-digit PIN code.'); end if;

  -- One open lead per person a week: a second ask returns the first.
  select * into l from insurance_leads
   where patient_phone = v_phone and status in ('open', 'accepted', 'contacted') and token is not null
     and created_at > now() - interval '7 days'
   order by created_at desc limit 1;
  if l.id is not null then
    return jsonb_build_object('ok', true, 'code', l.code, 'token', l.token, 'text',
      'आपका अनुरोध ' || l.code || ' पहले से चल रहा है। / Your request ' || l.code || ' is already with advisors.' || E'\n' || sehat_il_url(l.token));
  end if;

  if not exists (select 1 from sehat_il_advisors(v_pin)) then
    insert into insurance_leads (patient_phone, pincode, source, status, patient_name, cover, members, call_time, ended_reason)
    values (v_phone, v_pin, coalesce(p_source, 'whatsapp_bot'), 'expired', nullif(btrim(left(coalesce(p_name, ''), 80)), ''),
            nullif(btrim(left(coalesce(p_cover, ''), 120)), ''), nullif(btrim(left(coalesce(p_members, ''), 200)), ''),
            nullif(btrim(left(coalesce(p_call_time, ''), 80)), ''), 'no advisor serves this PIN');
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification) values ('bot', v_pin, 'insurance', false);
    v_dir := bot_partner_lines('insurance', v_pin, 3);
    return jsonb_build_object('ok', false, 'text',
      'आपकी जानकारी दर्ज हो गई है। आपके एरिया में अभी हमारे साथ कोई बीमा सलाहकार नहीं है।'
      || coalesce(E'\n' || 'आप इनसे बात कर सकते हैं:' || E'\n\n' || v_dir, ' हमारी टीम आपसे WhatsApp पर संपर्क करेगी।'));
  end if;

  loop
    v_code := 'IN-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from insurance_leads where code = v_code);
  end loop;
  insert into insurance_leads (code, token, patient_phone, pincode, source, status, patient_name, cover, members, call_time)
  values (v_code, encode(extensions.gen_random_bytes(12), 'hex'), v_phone, v_pin, coalesce(p_source, 'whatsapp_bot'), 'open',
          nullif(btrim(left(coalesce(p_name, ''), 80)), ''), nullif(btrim(left(coalesce(p_cover, ''), 120)), ''),
          nullif(btrim(left(coalesce(p_members, ''), 200)), ''), nullif(btrim(left(coalesce(p_call_time, ''), 80)), ''))
  returning * into l;
  perform sehat_il_log(l.id, null, 'created', p_source);
  begin
    perform sehat_wa_handle_inbound(v_phone, nullif(btrim(coalesce(p_name, '')), ''), null, 'insurance lead ' || v_code, null, null);
  exception when others then null;
  end;
  n := sehat_il_offer(l.id);
  return jsonb_build_object('ok', true, 'code', v_code, 'token', l.token, 'advisors', n, 'text',
    '✅ आपकी जानकारी (' || v_code || ') आपके एरिया के लाइसेंस वाले बीमा सलाहकारों को भेज दी गई है। जो पहले स्वीकार करेगा, वही आपको कॉल करेगा — आपका नंबर सिर्फ़ उसी को मिलेगा।' || E'\n'
    || 'Your request (' || v_code || ') has gone to licensed insurance advisors near you. The first to accept will call you — only they get your number.' || E'\n\n'
    || 'सलाहकार का नाम, नंबर और लाइसेंस यहाँ देखें / See the advisor''s name, number and licence here:' || E'\n' || sehat_il_url(l.token));
end $$;
revoke all on function sehat_create_insurance_lead(text, text, text, text, text, text, text) from public, anon, authenticated;

-- The existing insurance API node (phone + PIN) now makes a proper lead.
create or replace function bot_submit_insurance_lead(p_phone text, p_pincode text)
returns text language plpgsql security definer set search_path = public as $$
begin
  return sehat_create_insurance_lead(p_phone, p_pincode, null, null, null, null, 'whatsapp_bot') ->> 'text';
end $$;

-- ── 5. The bot's search node (0191 + 'insurance_lead') ──────────────────────
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

  -- 0188: hello / tips / rating, 0189: medicine, 0191: ambulance_request, 0192: insurance_lead — only with the flow key.
  if v_type in ('hello', 'tips', 'rating', 'medicine', 'ambulance_request', 'insurance_lead') then
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
    elsif v_type = 'insurance_lead' then
      -- '<PIN>|<name>|<cover wanted>|<who is covered>|<when to call — may contain |>'
      r := sehat_create_insurance_lead(p_pincode,
             split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 3), split_part(v_val, '|', 4),
             nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''), 'whatsapp_bot');
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    else
      r := bot_record_rating_json(p_pincode, v_val);
      return jsonb_build_object('found', coalesce((r ->> 'recorded')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    end if;
  end if;

  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;

-- ── 6. The advisor's side ───────────────────────────────────────────────────
create or replace function sehat_il_role(p_business uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if p_business is null or not sehat_caller_owns_business(p_business) then
    raise exception 'Not your listing.' using errcode = '42501';
  end if;
  if (select vertical from businesses where id = p_business) <> 'insurance' then
    raise exception 'Insurance leads are for insurance advisors.' using errcode = 'P0001';
  end if;
  v := coalesce(sehat_caller_role(p_business), 'owner');
  if v not in ('owner', 'manager') then raise exception 'Only the owner or a manager handles leads.' using errcode = '42501'; end if;
  return v;
end $$;
revoke all on function sehat_il_role(uuid) from public, anon, authenticated;

create or replace function sehat_il_row(l insurance_leads, p_business uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'code', l.code, 'status', l.status, 'pin_code', l.pincode,
    'cover', l.cover, 'members', l.members, 'call_time', l.call_time,
    'created_at', l.created_at, 'accepted_at', l.accepted_at, 'accepted_by_name', l.accepted_by_name,
    'fee_paise', case when l.agent_business_id = p_business then l.fee_paise end,
    'fee_refunded', l.fee_refunded, 'contacted_at', l.contacted_at, 'outcome_at', l.outcome_at,
    'insurer', l.insurer, 'plan_name', l.plan_name, 'lost_reason', l.lost_reason,
    'dispute_reason', l.dispute_reason, 'dispute_resolution', l.dispute_resolution,
    'patient_not_called_at', case when l.agent_business_id = p_business then l.patient_not_called_at end,
    'patient_bought', l.patient_bought, 'rating', l.rating, 'review', l.review, 'ended_reason', l.ended_reason,
    'mine', coalesce(l.agent_business_id = p_business, false),
    -- The lead itself, only for the advisor who paid for it; 90 days, then gone.
    'patient_name', case when l.agent_business_id = p_business and l.accepted_at > now() - interval '90 days' then l.patient_name end,
    'patient_phone', case when l.agent_business_id = p_business and l.accepted_at > now() - interval '90 days' then l.patient_phone end,
    'events', case when l.agent_business_id = p_business then (
        select coalesce(jsonb_agg(jsonb_build_object('event', e.event, 'by', e.actor_name, 'note', e.note, 'at', e.created_at) order by e.created_at), '[]')
          from insurance_lead_events e where e.lead_id = l.id and (e.business_id is null or e.business_id = p_business)) end
  );
$$;
revoke all on function sehat_il_row(insurance_leads, uuid) from public, anon, authenticated;

-- The advisor's page header: fee, wallet, licence, areas.
create or replace function sehat_il_summary(p_business uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b businesses;
begin
  perform sehat_il_role(p_business);
  select * into b from businesses where id = p_business;
  return jsonb_build_object(
    'lead_fee', sehat_lead_fee(),
    'balance_paise', coalesce((select balance_paise from business_wallets where business_id = p_business), 0),
    'licence', nullif(btrim(coalesce(b.reg_number, '')), ''),
    'areas', coalesce(array_length(b.delivery_pin_codes, 1), 0),
    'is_owner', coalesce(sehat_caller_role(p_business), 'owner') = 'owner');
end $$;
revoke all on function sehat_il_summary(uuid) from public, anon;
grant execute on function sehat_il_summary(uuid) to authenticated;

-- p_scope: 'new' (offered to us), 'active' (ours, in hand), 'done' (ours, closed, last 90 days)
create or replace function sehat_il_list(p_business uuid, p_scope text default 'active')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := sehat_il_role(p_business);
  v_pins text[] := (select delivery_pin_codes from businesses where id = p_business);
begin
  if p_scope = 'new' then
    return coalesce((select jsonb_agg(sehat_il_row(l, p_business) order by l.created_at)
      from insurance_leads l
     where l.status = 'open' and l.pincode = any(v_pins)
       and p_business in (select sehat_il_advisors(l.pincode))
       and not exists (select 1 from insurance_lead_declines d where d.lead_id = l.id and d.business_id = p_business)), '[]');
  end if;
  return coalesce((select jsonb_agg(sehat_il_row(l, p_business) order by l.updated_at desc)
    from insurance_leads l
   where l.agent_business_id = p_business and l.code is not null
     and (case when p_scope = 'done'
               then l.status in ('won', 'lost', 'disputed') and l.updated_at > now() - interval '90 days'
               else l.status in ('accepted', 'contacted') end)), '[]');
end $$;
revoke all on function sehat_il_list(uuid, text) from public, anon;
grant execute on function sehat_il_list(uuid, text) to authenticated;

-- accept | decline | contacted(note) | won(insurer, plan) | lost(reason) | dispute(reason)
create or replace function sehat_il_act(
  p_business uuid, p_lead uuid, p_action text,
  p_note text default null, p_insurer text default null, p_plan text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := sehat_il_role(p_business);
  v_name text := sehat_mo_actor_name(p_business);
  v_fee integer := sehat_lead_fee() * 100;
  v_bal integer;
  b businesses;
  l insurance_leads;
begin
  select * into b from businesses where id = p_business;
  select * into l from insurance_leads where id = p_lead for update;
  if l.id is null or l.code is null then raise exception 'Lead not found.' using errcode = 'P0002'; end if;

  if p_action = 'accept' then
    if l.status <> 'open' then
      raise exception '%', case when l.agent_business_id is not null then 'Another advisor has already taken this lead.' else 'This lead is no longer open.' end using errcode = 'P0001';
    end if;
    if nullif(btrim(coalesce(b.reg_number, '')), '') is null then
      raise exception 'Add your IRDAI licence or POSP code to your listing (Business tab) before accepting leads.' using errcode = 'P0001';
    end if;
    if p_business not in (select sehat_il_advisors(l.pincode))
       or exists (select 1 from insurance_lead_declines d where d.lead_id = l.id and d.business_id = p_business) then
      raise exception 'This lead is not offered to you.' using errcode = '42501';
    end if;
    -- Pay first, from the wallet; not enough, no lead.
    if v_fee > 0 then
      insert into business_wallets (business_id) values (p_business) on conflict do nothing;
      select balance_paise into v_bal from business_wallets where business_id = p_business for update;
      if v_bal < v_fee then
        raise exception 'Your wallet has ₹% — a lead costs ₹%. Top up to accept.', round(v_bal / 100.0), v_fee / 100 using errcode = 'P0001';
      end if;
      update business_wallets set balance_paise = balance_paise - v_fee, updated_at = now() where business_id = p_business;
      insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, lead_id, note, created_by)
      values (p_business, 'lead_fee', -v_fee, v_bal - v_fee, l.id, 'Insurance lead ' || l.code, v_name);
    end if;
    update insurance_leads set status = 'accepted', agent_business_id = p_business, accepted_at = now(), accepted_by_name = v_name,
           fee_paise = v_fee, updated_at = now() where id = l.id;
    perform sehat_il_log(l.id, p_business, 'accepted', case when v_fee > 0 then 'fee ₹' || v_fee / 100 end);
    perform sehat_il_wa(l.id, b.name || ' (IRDAI ' || btrim(b.reg_number) || ') आपको जल्द कॉल करेंगे। / will call you shortly.' || coalesce(' ☎ ' || b.phone, '') || E'\n' || sehat_il_url(l.token));

  elsif p_action = 'decline' then
    if l.status <> 'open' then raise exception 'This lead is no longer open.' using errcode = 'P0001'; end if;
    insert into insurance_lead_declines (lead_id, business_id) values (l.id, p_business) on conflict do nothing;
    perform sehat_il_log(l.id, p_business, 'declined', left(p_note, 200));

  elsif p_action in ('contacted', 'won', 'lost', 'dispute') then
    if l.agent_business_id is distinct from p_business then raise exception 'This lead is not yours.' using errcode = '42501'; end if;
    if p_action = 'contacted' then
      if l.status not in ('accepted', 'contacted') then raise exception 'This lead is closed.' using errcode = 'P0001'; end if;
      update insurance_leads set status = 'contacted', contacted_at = coalesce(contacted_at, now()), updated_at = now() where id = l.id;
      perform sehat_il_log(l.id, p_business, 'contacted', left(p_note, 300));
    elsif p_action = 'won' then
      if l.status not in ('accepted', 'contacted') then raise exception 'This lead is closed.' using errcode = 'P0001'; end if;
      if nullif(btrim(coalesce(p_insurer, '')), '') is null then raise exception 'Enter the insurer.' using errcode = '22023'; end if;
      update insurance_leads set status = 'won', contacted_at = coalesce(contacted_at, now()), outcome_at = now(),
             insurer = btrim(left(p_insurer, 80)), plan_name = nullif(btrim(left(coalesce(p_plan, ''), 120)), ''), updated_at = now() where id = l.id;
      perform sehat_il_log(l.id, p_business, 'won', btrim(left(p_insurer, 80)) || coalesce(' · ' || nullif(btrim(p_plan), ''), ''));
      perform sehat_il_wa(l.id, 'आपके बीमा सलाहकार के अनुभव को रेटिंग दें / Please rate your insurance advisor:' || E'\n' || sehat_il_url(l.token));
    elsif p_action = 'lost' then
      if l.status not in ('accepted', 'contacted') then raise exception 'This lead is closed.' using errcode = 'P0001'; end if;
      update insurance_leads set status = 'lost', outcome_at = now(), lost_reason = nullif(btrim(left(coalesce(p_note, ''), 200)), ''), updated_at = now() where id = l.id;
      perform sehat_il_log(l.id, p_business, 'lost', left(p_note, 200));
    else
      if l.status not in ('accepted', 'contacted') then raise exception 'Only a lead in hand can be reported.' using errcode = 'P0001'; end if;
      if l.accepted_at < now() - interval '7 days' then raise exception 'Problems must be reported within 7 days of accepting.' using errcode = 'P0001'; end if;
      if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Say what is wrong — e.g. wrong number, never asked for insurance.' using errcode = '22023'; end if;
      update insurance_leads set status = 'disputed', disputed_at = now(), dispute_reason = btrim(left(p_note, 300)), updated_at = now() where id = l.id;
      perform sehat_il_log(l.id, p_business, 'disputed', btrim(left(p_note, 300)));
    end if;
  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;

  select * into l from insurance_leads where id = p_lead;
  return sehat_il_row(l, p_business);
end $$;
revoke all on function sehat_il_act(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function sehat_il_act(uuid, uuid, text, text, text, text) to authenticated;

-- ── 7. The person's link (no login) ─────────────────────────────────────────
create or replace function sehat_il_public(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', l.code, 'status', l.status, 'pin_code', l.pincode, 'cover', l.cover, 'members', l.members, 'call_time', l.call_time,
    'patient_name', split_part(coalesce(l.patient_name, ''), ' ', 1),
    'created_at', l.created_at, 'accepted_at', l.accepted_at, 'contacted_at', l.contacted_at, 'outcome_at', l.outcome_at,
    'advisor', b.name, 'advisor_phone', b.phone, 'advisor_licence', nullif(btrim(coalesce(b.reg_number, '')), ''),
    'patient_not_called_at', l.patient_not_called_at, 'patient_bought', l.patient_bought,
    'rating', l.rating, 'review', l.review,
    'others', case when l.status = 'expired' then bot_partner_lines('insurance', l.pincode, 3) end)
  from insurance_leads l left join businesses b on b.id = l.agent_business_id
  where l.token = p_token and length(coalesce(p_token, '')) = 24;
$$;
revoke all on function sehat_il_public(text) from public;
grant execute on function sehat_il_public(text) to anon, authenticated;

-- not_called | cancel | feedback(bought, rating, review)
create or replace function sehat_il_patient(p_token text, p_action text,
  p_bought boolean default null, p_rating integer default null, p_review text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l insurance_leads;
begin
  select * into l from insurance_leads where token = p_token and length(coalesce(p_token, '')) = 24 for update;
  if l.id is null then raise exception 'This link is not valid.' using errcode = 'P0002'; end if;
  if p_action = 'not_called' then
    if l.status <> 'accepted' or l.accepted_at > now() - interval '24 hours' then
      raise exception 'You can tell us this if the advisor has not called within a day of accepting.' using errcode = 'P0001';
    end if;
    update insurance_leads set patient_not_called_at = now(), updated_at = now() where id = l.id;
    perform sehat_il_log(l.id, l.agent_business_id, 'patient_not_called', null, 'Patient');
  elsif p_action = 'cancel' then
    if l.status <> 'open' then raise exception 'An advisor already has your request. Tell them on the call if you are no longer interested.' using errcode = 'P0001'; end if;
    update insurance_leads set status = 'cancelled', ended_reason = 'person cancelled', updated_at = now() where id = l.id;
    perform sehat_il_log(l.id, null, 'patient_cancelled', null, 'Patient');
  elsif p_action = 'feedback' then
    if l.status not in ('accepted', 'contacted', 'won', 'lost') or l.accepted_at > now() - interval '1 hour' then
      raise exception 'You can rate the advisor after they have spoken to you.' using errcode = 'P0001';
    end if;
    if p_rating is null or p_rating not between 1 and 5 then raise exception 'Choose 1 to 5 stars.' using errcode = '22023'; end if;
    update insurance_leads set rating = p_rating, review = nullif(btrim(left(coalesce(p_review, ''), 500)), ''), patient_bought = p_bought,
           rated_at = now(), updated_at = now() where id = l.id;
    perform sehat_il_log(l.id, l.agent_business_id, 'patient_rated', p_rating || '★' || case when p_bought then ' · bought' when p_bought = false then ' · did not buy' else '' end, 'Patient');
    -- The person says they bought, the advisor never closed it: flag for admin.
    if p_bought and l.status in ('accepted', 'contacted', 'lost') then
      perform sehat_il_log(l.id, null, 'outcome_mismatch', 'person says they bought; advisor marked ' || l.status, 'Patient');
    end if;
  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;
  return sehat_il_public(p_token);
end $$;
revoke all on function sehat_il_patient(text, text, boolean, integer, text) from public;
grant execute on function sehat_il_patient(text, text, boolean, integer, text) to anon, authenticated;

-- ── 8. Clocks ───────────────────────────────────────────────────────────────
create or replace function sehat_il_tick()
returns integer language plpgsql security definer set search_path = public as $$
declare l insurance_leads; n integer := 0;
begin
  for l in select * from insurance_leads where status = 'open' and code is not null and created_at < now() - interval '24 hours'
            for update skip locked loop
    update insurance_leads set status = 'expired', ended_reason = 'no advisor accepted in 24 hours', updated_at = now() where id = l.id;
    perform sehat_il_log(l.id, null, 'expired', 'no advisor accepted');
    insert into unmet_demand_log (source, pin_code, speciality, patient_wants_notification) values ('bot', l.pincode, 'insurance', false);
    perform sehat_il_wa(l.id, 'माफ़ कीजिए, अभी कोई सलाहकार आपका अनुरोध नहीं ले पाया। इन्हें सीधे कॉल कर सकते हैं: / Sorry, no advisor took your request. You can call these:' || E'\n' || sehat_il_url(l.token));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function sehat_il_tick() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'insurance-lead-tick';
  perform cron.schedule('insurance-lead-tick', '*/15 * * * *', 'select public.sehat_il_tick()');
end $$;

-- ── 9. Sehatsandhi admins: the list, disputes, refunds ──────────────────────
create or replace function sehat_admin_insurance_leads(p_days integer default 30)
returns table (id uuid, code text, status text, pin_code text, created_at timestamptz, advisor text,
               fee_paise integer, fee_refunded boolean, dispute_reason text, dispute_resolution text,
               patient_not_called boolean, patient_bought boolean, rating smallint, outcome_mismatch boolean, ended_reason text)
language sql stable security definer set search_path = public as $$
  select l.id, l.code, l.status, l.pincode, l.created_at, b.name, l.fee_paise, l.fee_refunded, l.dispute_reason, l.dispute_resolution,
         l.patient_not_called_at is not null, l.patient_bought, l.rating,
         exists (select 1 from insurance_lead_events e where e.lead_id = l.id and e.event = 'outcome_mismatch'), l.ended_reason
    from insurance_leads l left join businesses b on b.id = l.agent_business_id
   where sehat_is_staff() and l.code is not null
     and l.created_at > now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
   order by (l.status = 'disputed' and l.dispute_resolution is null) desc, l.created_at desc;
$$;
revoke all on function sehat_admin_insurance_leads(integer) from public, anon;
grant execute on function sehat_admin_insurance_leads(integer) to authenticated;

-- Refund the fee to the advisor's wallet, or reject the claim.
create or replace function sehat_admin_resolve_lead(p_lead uuid, p_refund boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare l insurance_leads; v_bal integer;
begin
  if not sehat_is_admin() then raise exception 'Only a Sehatsandhi admin can do this.' using errcode = '42501'; end if;
  select * into l from insurance_leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
  if l.fee_refunded then raise exception 'Already refunded.' using errcode = 'P0001'; end if;
  if p_refund then
    if coalesce(l.fee_paise, 0) > 0 and l.agent_business_id is not null then
      insert into business_wallets (business_id) values (l.agent_business_id) on conflict do nothing;
      update business_wallets set balance_paise = balance_paise + l.fee_paise, updated_at = now()
       where business_id = l.agent_business_id returning balance_paise into v_bal;
      insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, lead_id, note, created_by)
      values (l.agent_business_id, 'refund', l.fee_paise, v_bal, l.id, 'Lead fee refunded — ' || l.code, 'Sehatsandhi admin');
    end if;
    update insurance_leads set fee_refunded = true, dispute_resolution = 'refunded' || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
           status = case when status = 'disputed' then 'lost' else status end, updated_at = now() where id = l.id;
    perform sehat_il_log(l.id, l.agent_business_id, 'refunded', p_note, 'Sehatsandhi');
    return 'refunded';
  end if;
  update insurance_leads set dispute_resolution = 'rejected' || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
         status = case when status = 'disputed' then 'contacted' else status end, updated_at = now() where id = l.id;
  perform sehat_il_log(l.id, l.agent_business_id, 'dispute_rejected', p_note, 'Sehatsandhi');
  return 'rejected';
end $$;
revoke all on function sehat_admin_resolve_lead(uuid, boolean, text) from public, anon;
grant execute on function sehat_admin_resolve_lead(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
