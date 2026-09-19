-- ============================================================================
-- Sehatsandhi — the bot's search answers in JSON AiSensy can capture
--
-- Run AFTER 0102. Safe to re-run.
--
-- bot_generic_search (0046) returns a bare JSON string, and null when nothing
-- matches. Wired into AiSensy's API Request node on 2026-09-19, the call itself
-- worked (200, the numbered list) but the node could not use the answer:
--
--   1. "Capture response in Attribute" maps fields of a JSON object ($.text).
--      A bare string has no field to map.
--   2. null is not something a Condition node can branch on, so the doctor and
--      lab_booking "nobody yet — shall we tell you?" path had no signal.
--
-- This wraps the same function rather than changing it, so the search, the
-- ranking and the unmet_demand_log row on an empty answer are unchanged, and
-- nothing already pointed at bot_generic_search breaks.
--
--   POST /rest/v1/rpc/bot_generic_search_json          anon key
--     {"p_type": "doctor", "p_filter_value": "{{Any_speciality_code}}",
--      "p_pincode": "{{Any_Pincode}}"}
--   →  {"found": true,  "text": "1. Dr. … "}
--   →  {"found": false, "text": ""}
--
-- Capture $.text and $.found; branch the Condition node on found.
-- ============================================================================

create or replace function bot_generic_search_json(
  p_type text,
  p_filter_value text,
  p_pincode text
) returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
           'found', r.text is not null,
           'text',  coalesce(r.text, '')
         )
    from (select bot_generic_search(p_type, p_filter_value, p_pincode) as text) r;
$$;

comment on function bot_generic_search_json is
  'bot_generic_search as {found, text} for AiSensy: capture $.text, branch on '
  '$.found. found is false exactly where bot_generic_search returns null.';

-- Both grants that reach anon, per 0088, then the one the bot needs.
revoke all on function bot_generic_search_json(text, text, text) from public, anon, authenticated;
grant execute on function bot_generic_search_json(text, text, text) to anon, authenticated;
