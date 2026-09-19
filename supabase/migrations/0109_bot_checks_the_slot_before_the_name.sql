-- ============================================================================
-- Sehatsandhi — the slot is checked before the patient is asked their name
--
-- Run AFTER 0108. Safe to re-run.
--
-- 0108 caught a doctor/lab number that is not on the list. The same thing
-- happens one question later: shown ten slots, a WhatsApp test replied "11",
-- was asked for a name and age, and only then heard "वह समय अब उपलब्ध नहीं है".
--
-- bot_check_slot_json sits between the slot question and the name question.
-- It matches the reply exactly as bot_book_appointment will — the label first,
-- then a leading number — so "ok" here means the booking will find the slot
-- (barring someone taking it in between, which the booking still reports).
--
-- One field, because every spare attribute in the flow is already spoken for:
--   {"text": "ok"}                              → go on to the name question
--   {"text": "यह समय सूची में नहीं है… <slots>"} → show it, ask for the slot again
--
-- Read-only and STABLE, so anon may call it.
-- ============================================================================

create or replace function bot_check_slot_json(
  p_speciality text,
  p_pincode text,
  p_selection text,
  p_slot_selection text,
  p_type text default 'doctor'
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_branch   text := bot_branch(p_type, p_speciality);
  v_business uuid;
  v_pract    uuid;
  v_sel      text := btrim(coalesce(p_slot_selection, ''));
  v_n        integer := nullif(substring(btrim(coalesce(p_slot_selection, '')) from '^[0-9]+'), '')::integer;
  v_ok       boolean := false;
  v_list     text;
begin
  select k.business_id, k.practitioner_id into v_business, v_pract
    from bot_pick(case when v_branch = 'lab_booking' then 'business' else 'doctor' end,
                  case when v_branch = 'lab_booking' then 'lab' else p_speciality end,
                  p_pincode, p_selection) k;

  if v_business is not null and v_sel <> '' then
    select exists (
      select 1 from bot_slot_options(v_business, v_pract) s
       where v_sel = s.label or v_sel like '%' || s.label || '%' or s.rn = v_n
    ) into v_ok;
  end if;

  if v_ok then
    return jsonb_build_object('text', 'ok');
  end if;

  select string_agg(s.rn || '. ' || s.label, E'\n' order by s.rn) into v_list
    from bot_slot_options(v_business, v_pract) s
   where v_business is not null;

  return jsonb_build_object('text',
    'यह समय सूची में नहीं है। कृपया सूची में से नंबर भेजें:'
    || coalesce(E'\n\n' || v_list, ''));
end $$;

comment on function bot_check_slot_json is
  'Whether the slot reply matches an offered slot, matched as '
  'bot_book_appointment matches it. {"text":"ok"} or the reason plus the slots.';

revoke all on function bot_check_slot_json(text, text, text, text, text) from public, anon, authenticated;
grant execute on function bot_check_slot_json(text, text, text, text, text) to anon, authenticated;
