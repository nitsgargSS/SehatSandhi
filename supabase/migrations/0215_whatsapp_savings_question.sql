-- ============================================================================
-- 0215 — The savings question on WhatsApp
-- ============================================================================
-- AFTER 0214. Safe to re-run.
--
-- After a WhatsApp rating (1–5), the thank-you asks one optional question:
--   "Sehatsandhi से आपका कितना समय/खर्च बचा?" 1 both · 2 time · 3 money · 4 no difference
-- No new AiSensy step: the answer is a bare 1–4, which the existing 1–5
-- keyword step sends to the rating handler; within an hour of this phone's
-- rating, and before it has answered, that reply is the savings answer. (A
-- 'saved' node type, '<flow key>|{{message}}' with the phone, also takes it,
-- for a flow that prefers its own step.) Recorded in visit_savings (0214)
-- against the visit just rated — the same table the app and the website
-- fill. Answers only, nothing medical. On by default; an admin can turn it
-- off (Insights → Business metrics).
-- ============================================================================

insert into site_settings (key, value) values ('wa_savings_question', 'on') on conflict (key) do nothing;

create or replace function sehat_wa_savings_on()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'on' from site_settings where key = 'wa_savings_question'), false);
$$;
revoke all on function sehat_wa_savings_on() from public, anon, authenticated;

create or replace function sehat_savings_question()
returns text language sql immutable as $$
  select 'एक छोटा सवाल (जवाब देना ज़रूरी नहीं): Sehatsandhi से आपका कितना समय/खर्च बचा?' || E'\n'
      || '1 — समय और पैसा दोनों' || E'\n' || '2 — समय' || E'\n' || '3 — पैसा' || E'\n' || '4 — कोई फ़र्क नहीं' || E'\n'
      || 'बस नंबर भेजें।';
$$;

-- Admins: read (p_on null) or set the switch.
create or replace function sehat_admin_wa_savings(p_on boolean default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if p_on is not null then
    insert into site_settings (key, value, updated_at) values ('wa_savings_question', case when p_on then 'on' else 'off' end, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  return sehat_wa_savings_on();
end $$;
revoke all on function sehat_admin_wa_savings(boolean) from public, anon;
grant execute on function sehat_admin_wa_savings(boolean) to authenticated;

-- The answer: "1".."4", or the words (दोनों / समय / पैसा / फ़र्क नहीं, both / time / money / no).
create or replace function bot_saved_json(p_phone text, p_message text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone  text := sehat_normalise_phone(p_phone);
  v_text   text := lower(btrim(coalesce(p_message, '')));
  v_answer text;
  v_appt   uuid;
begin
  if v_phone is null then return jsonb_build_object('recorded', false, 'text', ''); end if;
  v_answer := case
    when v_text ~ '^\s*1(?![0-9])' or v_text ~ '(दोनों|दोनो|dono|both)' then 'time_and_money'
    when v_text ~ '^\s*2(?![0-9])' then 'time'
    when v_text ~ '^\s*3(?![0-9])' then 'money'
    when v_text ~ '^\s*4(?![0-9])' or v_text ~ '(फ़र्क|फर्क|farak|fark|no difference|कोई नहीं)' then 'none'
    when v_text ~ '(समय|samay|time)' then 'time'
    when v_text ~ '(पैसा|पैसे|खर्च|paisa|paise|money|kharcha)' then 'money'
  end;
  if v_answer is null then
    return jsonb_build_object('recorded', false, 'text', 'कृपया 1, 2, 3 या 4 भेजें।');
  end if;
  -- The visit this phone rated most recently (within 7 days) that has no answer yet.
  select a.id into v_appt
    from ratings r join appointments a on a.id = r.appointment_id
   where sehat_normalise_phone(a.patient_phone) = v_phone and r.created_at > now() - interval '7 days'
     and not exists (select 1 from visit_savings v where v.kind = 'booking' and v.ref_id = a.id)
   order by r.created_at desc limit 1;
  if v_appt is null then
    return jsonb_build_object('recorded', false, 'text', 'धन्यवाद 🙏');
  end if;
  insert into visit_savings (kind, ref_id, patient_id, answer, channel)
  values ('booking', v_appt, (select id from patients where phone = v_phone), v_answer, 'whatsapp')
  on conflict (kind, ref_id) do nothing;
  return jsonb_build_object('recorded', true, 'text', 'धन्यवाद 🙏 आपका जवाब दर्ज हो गया। इससे हमें Sehatsandhi को और बेहतर बनाने में मदद मिलेगी।');
end $$;
revoke all on function bot_saved_json(text, text) from public, anon, authenticated;

create or replace function bot_record_rating_json(p_phone text, p_message text)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v_phone  text := sehat_normalise_phone(p_phone);
  v_m      text[];
  v_score  integer;
  v_review text;
  v_appt   uuid;
  v_who    text;
begin
  if v_phone is null then
    return jsonb_build_object('recorded', false,
      'text', 'हमें आपका मोबाइल नंबर सही से नहीं मिला।');
  end if;

  -- 0215: a bare 1–4 just after this phone rated (and before it answered the
  -- savings question) is that answer — the AiSensy 1–5 keyword step brings it here.
  if sehat_wa_savings_on() and coalesce(p_message, '') ~ '^\s*[1-4]\s*$'
     and exists (select 1 from ratings r join appointments a on a.id = r.appointment_id
                  where sehat_normalise_phone(a.patient_phone) = v_phone and r.created_at > now() - interval '60 minutes'
                    and not exists (select 1 from visit_savings v where v.kind = 'booking' and v.ref_id = a.id)) then
    return bot_saved_json(p_phone, p_message);
  end if;

  v_m := regexp_match(coalesce(p_message, ''), '^\s*([1-5])(?![0-9])(.*)$');
  if v_m is null then
    return jsonb_build_object('recorded', false,
      'text', 'कृपया 1 से 5 तक एक नंबर भेजें — 1 (खराब) से 5 (बहुत अच्छा)।');
  end if;
  v_score  := v_m[1]::integer;
  v_review := nullif(btrim(regexp_replace(v_m[2], '^[\s.,:;)⭐★/-]+', '')), '');

  v_appt := sehat_rateable_visit(v_phone);

  if v_appt is null then
    if exists (
      select 1 from appointments a
       where sehat_normalise_phone(a.patient_phone) = v_phone
         and a.status in ('booked', 'confirmed')
         and a.slot_datetime >= now()) then
      return jsonb_build_object('recorded', false,
        'text', 'आपकी विज़िट अभी बाकी है। डॉक्टर से मिलने के बाद यहीं रेटिंग भेजें 🙏');
    end if;

    if exists (
      select 1 from ratings r
        join appointments a on a.id = r.appointment_id
       where sehat_normalise_phone(a.patient_phone) = v_phone
         and a.slot_datetime > now() - interval '30 days') then
      return jsonb_build_object('recorded', false,
        'text', 'आप अपनी पिछली विज़िट की रेटिंग पहले ही दे चुके हैं। धन्यवाद 🙏');
    end if;

    return jsonb_build_object('recorded', false,
      'text', 'हमें आपकी कोई हाल की विज़िट नहीं मिली जिसकी रेटिंग दी जा सके।');
  end if;

  perform sehat_record_rating(v_phone, v_score, v_review);

  select coalesce(p.full_name, b.name) into v_who
    from appointments a
    join businesses b on b.id = a.business_id
    left join practitioners p on p.id = a.practitioner_id
   where a.id = v_appt;

  return jsonb_build_object('recorded', true, 'ask_saved', sehat_wa_savings_on(),
    'text', 'धन्यवाद 🙏 ' || v_who || ' के लिए आपकी रेटिंग '
            || repeat('⭐', v_score) || ' दर्ज हो गई। '
            || 'इससे दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद मिलेगी।'
            -- 0215: one optional question, once the AiSensy step that catches the answer is in place.
            || case when sehat_wa_savings_on() then E'\n\n' || sehat_savings_question() else '' end);
end $$;
revoke all on function bot_record_rating_json(text, text) from public, anon, authenticated;
grant execute on function bot_record_rating_json(text, text) to service_role;

create or replace function bot_generic_search_json(p_type text, p_filter_value text, p_pincode text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  r jsonb;
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_val text;
  v_msg text;
  v_code text;
begin
  -- 0201: what the patient typed.
  if v_type = 'text' then
    v_val := sehat_bot_keyed(p_filter_value);
    if v_val is null then
      r := match_message(array_to_string((string_to_array(coalesce(p_filter_value, ''), '|'))[3:], '|'), split_part(coalesce(p_filter_value, ''), '|', 2));
      return jsonb_build_object('found', false, 'route', case when (r ->> 'is_emergency')::boolean then 'emergency' else 'menu' end,
        'text', case when (r ->> 'is_emergency')::boolean then sehat_ft_fill('emergency', '{}') else sehat_ft_fill('menu', '{}') end);
    end if;
    return sehat_free_text_whatsapp(p_pincode, v_val);
  end if;

  -- 0143: the QR opt-in rides this node (all five AiSensy API nodes are used).
  if v_type = 'optin' then
    r := bot_clinic_optin(p_filter_value, p_pincode, null);
    -- 0210: a clinic's QR is where this patient came from, if nothing came first.
    perform sehat_note_first_touch_by_phone(p_pincode, 'doctor_referral',
      substring(upper(coalesce(p_filter_value, '')) from 'SS-[A-Z0-9]{5}'), 'whatsapp',
      (select coalesce(b.own_pin_code, b.pin_codes[1]) from businesses b where b.qr_code = substring(upper(coalesce(p_filter_value, '')) from 'SS-[A-Z0-9]{5}')));
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
  if v_type in ('hello', 'tips', 'rating', 'saved', 'medicine', 'ambulance_request', 'insurance_lead') then
    v_val := sehat_bot_keyed(p_filter_value);
    if v_val is null then
      -- An ambulance request without the key still gets the numbers: never leave an emergency empty-handed.
      if v_type = 'ambulance_request' then
        return jsonb_build_object('found', false, 'route', 'info', 'text', coalesce(bot_ambulance(split_part(coalesce(p_filter_value, ''), '|', 2)), 'Call 108.'));
      end if;
      return jsonb_build_object('found', false, 'route', 'info', 'text', '');
    end if;
    if v_type = 'hello' then
      -- 0210: '<name>' or '<name>|<first message>'. The first message carries
      -- a campaign code (#REEL07, a known pre-filled text, a clinic's SS-code):
      -- recorded as where this patient came from.
      begin
        v_msg := nullif(btrim(substr(v_val, length(split_part(v_val, '|', 1)) + 2)), '');
        v_code := sehat_entry_code_from_text(v_msg);
        perform sehat_wa_handle_inbound(p_pincode, nullif(btrim(split_part(v_val, '|', 1)), ''), null, coalesce(v_msg, 'Hi'), v_code, null);
        if v_code is not null then
          perform sehat_note_first_touch_by_phone(p_pincode,
            coalesce((select e.source_type from wa_entry_points e where e.code = v_code), 'other'), v_code, 'whatsapp', null);
        elsif v_msg ~* 'SS-[A-Z0-9]{5}' then
          perform sehat_note_first_touch_by_phone(p_pincode, 'doctor_referral', substring(upper(v_msg) from 'SS-[A-Z0-9]{5}'), 'whatsapp', null);
        else
          perform sehat_note_first_touch_by_phone(p_pincode, null, null, 'whatsapp', null);
        end if;
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
      r := sehat_create_medicine_order(p_pincode,
             split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 4),
             nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''),
             split_part(v_val, '|', 3), 'whatsapp_bot');
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    elsif v_type = 'ambulance_request' then
      begin
        r := sehat_create_ambulance_request(p_pincode,
               split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 3), split_part(v_val, '|', 4),
               nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''), 'whatsapp_bot');
      exception when others then
        r := jsonb_build_object('ok', false, 'text', coalesce(bot_ambulance(split_part(v_val, '|', 1)), 'Call 108.'));
      end;
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    elsif v_type = 'insurance_lead' then
      r := sehat_create_insurance_lead(p_pincode,
             split_part(v_val, '|', 1), split_part(v_val, '|', 2), split_part(v_val, '|', 3), split_part(v_val, '|', 4),
             nullif(array_to_string((string_to_array(v_val, '|'))[5:], '|'), ''), 'whatsapp_bot');
      return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    elsif v_type = 'saved' then
      -- 0215: the answer to "Sehatsandhi से आपका कितना समय/खर्च बचा?" after a rating.
      r := bot_saved_json(p_pincode, v_val);
      return jsonb_build_object('found', coalesce((r ->> 'recorded')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    else
      r := bot_record_rating_json(p_pincode, v_val);
      return jsonb_build_object('found', coalesce((r ->> 'recorded')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    end if;
  end if;

  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;

notify pgrst, 'reload schema';
