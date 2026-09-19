-- ============================================================================
-- Sehatsandhi — the slot step explains a bad pick instead of going blank
--
-- Run AFTER 0107. Safe to re-run.
--
-- On 2026-09-19 a WhatsApp test was shown three labs and replied "4". There is
-- no row 4, so bot_available_slots returned null, the slot question went out
-- with no slots in it, the patient picked one anyway, and the booking refused
-- at the very end with "आपका चयन समझ नहीं आया".
--
-- The slots answer now carries a route like the search does (0107):
--
--   route = 'slots'  text is the numbered slot list    → ask which slot
--           'retry'  text is the reason AND the list   → ask which number again
--                    the patient was choosing from
--
-- Repeating the list in the retry text matters: the flow's retry question
-- shows only this text, and "pick again" is useless without the options.
-- `found` stays for anything already reading it.
-- ============================================================================

create or replace function bot_available_slots_json(
  p_speciality text, p_pincode text, p_selection text, p_type text default 'doctor'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_branch text := bot_branch(p_type, p_speciality);
  v_kind   text := case when v_branch = 'lab_booking' then 'business' else 'doctor' end;
  v_filter text := case when v_branch = 'lab_booking' then 'lab' else p_speciality end;
  v_slots  text := bot_available_slots(p_speciality, p_pincode, p_selection, v_branch);
  v_picked boolean;
  v_list   text;
begin
  if v_slots is not null then
    return jsonb_build_object('found', true, 'route', 'slots', 'text', v_slots);
  end if;

  v_picked := exists (select 1 from bot_pick(v_kind, v_filter, p_pincode, p_selection));

  -- The same numbered list the patient saw. Read through bot_bookable directly
  -- rather than bot_generic_search, which logs an empty result as demand and
  -- is not STABLE.
  select string_agg(b.rn || '. ' || b.title
           || case when coalesce(b.subtitle, '') not in ('', b.title)
                   then ' — ' || b.subtitle else '' end,
           E'\n' order by b.rn)
    into v_list
    from bot_bookable(v_kind,
                      case when v_kind = 'doctor' then bot_speciality_code(p_speciality)
                           else 'lab' end,
                      bot_pincode(p_pincode)) b;

  return jsonb_build_object('found', false, 'route', 'retry', 'text',
    case when v_picked
         then 'इनके पास अगले 7 दिन कोई समय खाली नहीं है। कृपया कोई और नंबर चुनें:'
         else 'यह नंबर सूची में नहीं है। कृपया सूची में से नंबर भेजें:'
    end
    || coalesce(E'\n\n' || v_list, ''));
end $$;

revoke all on function bot_available_slots_json(text, text, text, text) from public, anon, authenticated;
grant execute on function bot_available_slots_json(text, text, text, text) to anon, authenticated;
