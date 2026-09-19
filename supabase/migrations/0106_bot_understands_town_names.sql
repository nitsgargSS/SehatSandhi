-- ============================================================================
-- Sehatsandhi — the bot understands a town name, and says why it found nothing
--
-- Run AFTER 0105. Safe to re-run.
--
-- The flow asks "अपना शहर का नाम या PIN कोड भेजें" — town OR pincode — and
-- patients take it at its word. On 2026-09-19 a test sent "Jagadhri":
-- bot_pincode (0046) keeps only six digits, so the search got nothing, logged
-- pin_code 'Jagadhri', and the flow walked an empty list all the way to a
-- failed booking. 0046 called town names out of scope "until there is
-- area-to-PIN data"; service_areas (0098) is that data.
--
-- 1. bot_pincode: six digits anywhere in the reply still win, so
--    "Jagadhri, 135001" means 135001. Otherwise the reply is matched to
--    service_areas.area_name ignoring case, spaces and punctuation, so
--    "jagadhri", "Yamunanagar" and "Yamuna Nagar" all resolve. Every branch
--    reads the pincode through this, so pharmacy, ambulance, camps and
--    insurance gain it too.
--
-- 2. bot_generic_search_json: found stays false when nothing matched, but text
--    is now a sentence the flow can send as it is, and it tells the two cases
--    apart — a reply we could not read as a place, and a place with nobody in
--    it yet. The branches that already always answer (pharmacy, ambulance,
--    camps, lab call-back) are unchanged.
-- ============================================================================

-- STABLE, not IMMUTABLE as in 0046: it now reads a table.
create or replace function bot_pincode(p_value text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select d from (select substring(coalesce(p_value, '') from '[1-9][0-9]{5}') as d) s
      where d is not null),
    (select a.pin_code
       from service_areas a
      where regexp_replace(lower(a.area_name), '[^a-z]', '', 'g')
          = nullif(regexp_replace(lower(coalesce(p_value, '')), '[^a-z]', '', 'g'), '')
      order by a.population desc nulls last
      limit 1)
  );
$$;

comment on function bot_pincode is
  'The pincode a patient meant: six digits anywhere in the reply, else a town '
  'in service_areas matched ignoring case, spaces and punctuation. Null when '
  'neither — the caller says so rather than searching nothing.';

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
    return jsonb_build_object('found', true, 'text', v_text);
  end if;

  return jsonb_build_object('found', false, 'text',
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

revoke all on function bot_pincode(text) from public, anon, authenticated;
grant execute on function bot_pincode(text) to anon, authenticated;

revoke all on function bot_generic_search_json(text, text, text) from public, anon, authenticated;
grant execute on function bot_generic_search_json(text, text, text) to anon, authenticated;
