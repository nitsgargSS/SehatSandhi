-- 0210: where people come from, on every channel (business metrics, stage B).
--
--   WhatsApp  the bot's "hello" can now send the first message too
--             ('<name>|<first message>'); a campaign code in it — '#REEL07',
--             a campaign's pre-filled text, or a clinic's SS-code — is stored
--             (wa_contacts.entry_code, as the webhook would) and becomes the
--             patient's first source. A clinic QR opt-in counts as a doctor
--             referral. Old '<name>' payloads keep working.
--   Campaigns wa_entry_points.source_type says what each code is (Instagram
--             reel, poster, camp…); admins add codes in Insights.
--   App/web   sehat_my_first_touch — a signed-in patient's first source (the
--             app asks "where did you hear about us" once; the website sends
--             the UTM tags it landed with).
-- A first source is set once (sehat_note_first_touch, 0209).

alter table wa_entry_points add column if not exists source_type text not null default 'other';
alter table wa_entry_points drop constraint if exists wa_entry_points_source_type_check;
alter table wa_entry_points add constraint wa_entry_points_source_type_check check (source_type in (
  'meta_ctwa_ad', 'instagram_reel', 'website_organic', 'google', 'sms_campaign', 'doctor_referral', 'patient_referral',
  'qr_poster', 'camp', 'direct', 'other'));
update wa_entry_points set source_type = 'website_organic' where code like 'web%' and source_type = 'other';
update wa_entry_points set source_type = 'qr_poster' where code in ('qr_reception_consent', 'opd_slip') and source_type = 'other';

-- A campaign code in a message: '#CODE' / a code as a word, or a code's exact pre-filled text.
create or replace function sehat_entry_code_from_text(p_text text)
returns text language sql stable security definer set search_path = public as $$
  select e.code from wa_entry_points e
   where e.is_active and p_text is not null
     and (lower(p_text) ~ ('(^|[^a-z0-9_])#?' || lower(e.code) || '([^a-z0-9_]|$)')
          or lower(btrim(p_text)) = lower(btrim(coalesce(e.prefilled_text, ''))))
   order by (lower(p_text) like '%#' || lower(e.code) || '%') desc, length(e.code) desc
   limit 1;
$$;

-- By phone: the patient row for that number (made if this is their first contact).
create or replace function sehat_note_first_touch_by_phone(p_phone text, p_type text, p_detail text, p_channel text, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text := sehat_normalise_phone(p_phone); v_id uuid;
begin
  if v_phone is null then return; end if;
  select id into v_id from patients where phone = v_phone;
  if v_id is null then return; end if;   -- the inbound handler makes the row; nothing to note without one
  perform sehat_note_first_touch(v_id, p_type, p_detail, p_channel, p_pin);
end $$;
revoke all on function sehat_note_first_touch_by_phone(text, text, text, text, text) from public, anon, authenticated;
revoke all on function sehat_entry_code_from_text(text) from public, anon, authenticated;

-- The signed-in patient (app or website): their own first source, once.
create or replace function sehat_my_first_touch(p_type text default null, p_detail text default null, p_channel text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_phone text := sehat_my_phone(); v_id uuid; r record;
begin
  select id into v_id from patients where phone = v_phone;
  if v_id is null then
    insert into patients (phone, source, source_detail) values (v_phone, 'appointment', 'signed in on the ' || coalesce(nullif(p_channel, ''), 'app'))
    returning id into v_id;
  end if;
  if p_type is not null or p_channel is not null then
    if p_type is not null and p_type not in ('meta_ctwa_ad', 'instagram_reel', 'website_organic', 'google', 'sms_campaign', 'doctor_referral',
                                              'patient_referral', 'qr_poster', 'camp', 'direct', 'other') then
      raise exception 'Unknown source.' using errcode = '22023';
    end if;
    perform sehat_note_first_touch(v_id, p_type, p_detail, case when p_channel in ('app', 'website') then p_channel end, null);
  end if;
  select first_source_type, first_channel into r from patients where id = v_id;
  return jsonb_build_object('source', r.first_source_type, 'channel', r.first_channel);
end $$;
revoke all on function sehat_my_first_touch(text, text, text) from public, anon;
grant execute on function sehat_my_first_touch(text, text, text) to authenticated;

-- Campaign codes, kept by admins (Insights → Business metrics).
create or replace function sehat_admin_save_entry_point(p_code text, p_label text, p_source_type text, p_prefilled text default null, p_location text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9_-]', '', 'g'));
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if length(v_code) < 3 then raise exception 'A code of at least 3 letters or digits.' using errcode = '22023'; end if;
  if v_code ~ '^SS-[A-Z0-9]{5}$' then raise exception 'SS- codes belong to clinics.' using errcode = '22023'; end if;
  insert into wa_entry_points (code, label, location, prefilled_text, source_type, is_active)
  values (v_code, coalesce(nullif(btrim(p_label), ''), v_code), nullif(btrim(p_location), ''),
          coalesce(nullif(btrim(p_prefilled), ''), 'नमस्ते #' || v_code), p_source_type, true)
  on conflict (code) do update set label = excluded.label, location = excluded.location,
    prefilled_text = excluded.prefilled_text, source_type = excluded.source_type, is_active = true;
  return v_code;
end $$;
revoke all on function sehat_admin_save_entry_point(text, text, text, text, text) from public, anon;
grant execute on function sehat_admin_save_entry_point(text, text, text, text, text) to authenticated;

-- The search node: 0201's, with the hello and opt-in branches above.
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
    else
      r := bot_record_rating_json(p_pincode, v_val);
      return jsonb_build_object('found', coalesce((r ->> 'recorded')::boolean, false), 'route', 'info', 'text', r ->> 'text');
    end if;
  end if;

  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;

notify pgrst, 'reload schema';
