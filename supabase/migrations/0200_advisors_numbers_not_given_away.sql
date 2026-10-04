-- ============================================================================
-- Sehatsandhi — advisors' phone numbers are never handed out for free
--
-- Run AFTER 0199. Safe to re-run.
--
-- Insurance advisors pay a flat fee per lead (0192): the lead is the patient's
-- number, and the patient gets the advisor who accepted. But when no advisor
-- took leads for a PIN, two places fell back to a directory of advisors WITH
-- their phone numbers (bot_partner_lines):
--   sehat_create_insurance_lead   the WhatsApp bot's and the app's answer
--   sehat_il_public               the patient's lead page ('others', expired)
-- So an advisor who never set up leads still got the calls, for nothing — and
-- none would have a reason to pay. Both now say the request is recorded and the
-- team will be in touch when an advisor joins; the lead stays logged as unmet
-- demand (Admin → Demand) exactly as before.
-- ============================================================================

create or replace function sehat_create_insurance_lead(
  p_phone text, p_pin text, p_name text, p_cover text, p_members text, p_call_time text, p_source text default 'whatsapp_bot'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_pin text := bot_pincode(p_pin);
  l insurance_leads; v_code text; n integer;
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
    -- No directory of advisors here: their numbers are what a lead sells.
    return jsonb_build_object('ok', false, 'text',
      'आपकी जानकारी दर्ज हो गई है। आपके एरिया में अभी हमारे साथ कोई बीमा सलाहकार नहीं है — '
      || 'जैसे ही कोई जुड़ेगा, हमारी टीम आपसे संपर्क करेगी।' || E'\n'
      || 'We have your request. No licensed advisor works with us in your area yet — our team will contact you as soon as one joins.');
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

create or replace function sehat_il_public(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'code', l.code, 'status', l.status, 'pin_code', l.pincode, 'cover', l.cover, 'members', l.members, 'call_time', l.call_time,
    'patient_name', split_part(coalesce(l.patient_name, ''), ' ', 1),
    'created_at', l.created_at, 'accepted_at', l.accepted_at, 'contacted_at', l.contacted_at, 'outcome_at', l.outcome_at,
    'advisor', b.name, 'advisor_phone', b.phone, 'advisor_licence', nullif(btrim(coalesce(b.reg_number, '')), ''),
    'patient_not_called_at', l.patient_not_called_at, 'patient_bought', l.patient_bought,
    'rating', l.rating, 'review', l.review,
    'others', null)
  from insurance_leads l left join businesses b on b.id = l.agent_business_id
  where l.token = p_token and length(coalesce(p_token, '')) = 24;
$$;
revoke all on function sehat_il_public(text) from public;
grant execute on function sehat_il_public(text) to anon, authenticated;
revoke all on function sehat_il_public(text) from public;
grant execute on function sehat_il_public(text) to anon, authenticated;

notify pgrst, 'reload schema';
