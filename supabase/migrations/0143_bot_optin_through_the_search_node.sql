-- ============================================================================
-- Sehatsandhi — "Yes, send me updates" through the bot's existing search node
--
-- Run AFTER 0142. Safe to re-run.
--
-- The AiSensy project has five API Request nodes and all five are used, so the
-- QR opt-in (0141's bot_clinic_optin) cannot have a node of its own. The
-- search node already calls bot_generic_search_json(p_type, p_filter_value,
-- p_pincode) with values the flow sets; with p_type = 'optin' it now records
-- the opt-in instead of searching:
--
--   p_type         'optin'
--   p_filter_value the clinic code the patient scanned (SS-XXXXX), or the whole
--                  first message — the code is found inside it
--   p_pincode      the patient's WhatsApp number (AiSensy's phone attribute)
--
-- It answers { found: true, route: 'info', text: <thank-you in Hindi> }, the
-- shape the flow already shows for the info branches. Nothing is logged as a
-- search.
-- ============================================================================

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('bot_generic_search_json(text, text, text)'::regprocedure) into v_def;
  if position('0143' in v_def) > 0 then return; end if;   -- already done
end $$;

create or replace function bot_generic_search_json_0143_inner(p_type text, p_filter_value text, p_pincode text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_branch text := bot_branch(p_type, p_filter_value);
  v_pin    text := bot_pincode(p_pincode);
  v_text   text := bot_generic_search(v_branch, p_filter_value, p_pincode);
begin
  insert into bot_search_log (branch, speciality, pin_code, raw_place, found)
  values (v_branch,
          case when v_branch = 'doctor' then bot_speciality_code(p_filter_value) end,
          v_pin,
          case when v_pin is null then nullif(left(btrim(coalesce(p_pincode, '')), 40), '') end,
          v_text is not null);

  if v_text is not null then
    return jsonb_build_object(
      'found', true,
      'route', case when v_branch in ('doctor', 'lab_booking') then 'list' else 'info' end,
      'text',  v_text);
  end if;

  return jsonb_build_object('found', false, 'route', 'none', 'text',
    case
      when v_pin is null then
        'हमें आपका शहर या PIN कोड समझ नहीं आया। '
        || 'कृपया अपना 6 अंकों का PIN कोड भेजें (जैसे 135001)।'
      when v_branch = 'lab_booking' then
        'आपके क्षेत्र में अभी कोई जांच लैब उपलब्ध नहीं है। '
        || 'कृपया पास का PIN कोड आज़माएँ।'
      else
        'आपके क्षेत्र में अभी इस स्पेशलिटी के डॉक्टर उपलब्ध नहीं हैं। '
        || 'कृपया दूसरी स्पेशलिटी या पास का PIN कोड आज़माएँ।'
    end);
end $function$;
revoke all on function bot_generic_search_json_0143_inner(text, text, text) from public, anon, authenticated;

create or replace function bot_generic_search_json(p_type text, p_filter_value text, p_pincode text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  r jsonb;
begin
  -- 0143: the QR opt-in rides this node (all five AiSensy API nodes are used).
  if lower(btrim(coalesce(p_type, ''))) = 'optin' then
    r := bot_clinic_optin(p_filter_value, p_pincode, null);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;
  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;

notify pgrst, 'reload schema';
