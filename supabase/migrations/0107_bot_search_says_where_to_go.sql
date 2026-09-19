-- ============================================================================
-- Sehatsandhi — the search says where the flow goes next
--
-- Run AFTER 0106. Safe to re-run.
--
-- Every branch shares one search node (0105), and the node after it is a
-- Condition on `found`. That is enough for doctors and lab booking, but the
-- read-out branches — pharmacy, ambulance, camps, lab call-back — always come
-- back found, so a pharmacy list walked on into "which number do you want to
-- book?". The Condition needs three ways out, not two:
--
--   route = 'list'  numbered doctors or labs  → ask which number, then book
--           'info'  a finished answer         → send it, done
--           'none'  nothing / unreadable place → send the reason, ask again
--
-- AiSensy compares one attribute to one value per Condition, so the flow
-- chains two: route = list, else route = info, else the retry question.
-- `found` stays, unchanged, for anything already reading it.
-- ============================================================================

create or replace function bot_generic_search_json(
  p_type text,
  p_filter_value text,
  p_pincode text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_branch text := bot_branch(p_type, p_filter_value);
  v_text   text := bot_generic_search(v_branch, p_filter_value, p_pincode);
begin
  if v_text is not null then
    return jsonb_build_object(
      'found', true,
      'route', case when v_branch in ('doctor', 'lab_booking') then 'list' else 'info' end,
      'text',  v_text);
  end if;

  return jsonb_build_object('found', false, 'route', 'none', 'text',
    case
      when bot_pincode(p_pincode) is null then
        'हमें आपका शहर या PIN कोड समझ नहीं आया। '
        || 'कृपया अपना 6 अंकों का PIN कोड भेजें (जैसे 135001)।'
      when v_branch = 'lab_booking' then
        'आपके क्षेत्र में अभी कोई जांच लैब उपलब्ध नहीं है। '
        || 'कृपया पास का PIN कोड आज़माएँ।'
      else
        'आपके क्षेत्र में अभी इस स्पेशलिटी के डॉक्टर उपलब्ध नहीं हैं। '
        || 'कृपया दूसरी स्पेशलिटी या पास का PIN कोड आज़माएँ।'
    end);
end $$;

revoke all on function bot_generic_search_json(text, text, text) from public, anon, authenticated;
grant execute on function bot_generic_search_json(text, text, text) to anon, authenticated;
