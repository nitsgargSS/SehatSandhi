-- ============================================================================
-- Sehatsandhi — slots and booking answer in JSON too
--
-- Run AFTER 0103. Safe to re-run.
--
-- 0103 wrapped the search for AiSensy's capture, which maps fields of a JSON
-- object and cannot take a bare string. The next two nodes in the booking path
-- have the same problem, so they get the same treatment. The originals are
-- untouched; these call them.
--
--   POST /rest/v1/rpc/bot_available_slots_json          anon key
--     {"p_speciality": "{{Any_speciality_code}}", "p_pincode": "{{Any_Pincode}}",
--      "p_selection": "{{Any_Selection}}", "p_type": "doctor"}
--   →  {"found": true,  "text": "1. शनि 19 सितंबर — 01:00 PM\n2. …"}
--   →  {"found": false, "text": ""}      no free window in 7 days, or a
--                                        selection that matched no row
--
--   POST /rest/v1/rpc/bot_book_appointment_json         SERVICE ROLE key
--     the same body as bot_book_appointment
--   →  {"booked": true,  "text": "आपका अपॉइंटमेंट बुक हो गया ✅ …"}
--   →  {"booked": false, "text": "वह समय अब उपलब्ध नहीं है। …"}
--
-- booked is read off the confirmation line bot_book_at returns, the only
-- success path: every other return is a refusal the patient must act on.
-- ============================================================================

create or replace function bot_available_slots_json(
  p_speciality text, p_pincode text, p_selection text, p_type text default 'doctor'
) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'found', r.text is not null,
           'text',  coalesce(r.text, '')
         )
    from (select bot_available_slots(p_speciality, p_pincode, p_selection, p_type) as text) r;
$$;

comment on function bot_available_slots_json is
  'bot_available_slots as {found, text} for AiSensy. found is false exactly '
  'where bot_available_slots returns null.';

create or replace function bot_book_appointment_json(
  p_speciality text,
  p_pincode text,
  p_selection text,
  p_patient_info text,
  p_slot_selection text,
  p_phone text,
  p_type text default 'doctor'
) returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
           'booked', r.text like 'आपका अपॉइंटमेंट बुक हो गया%',
           'text',   coalesce(r.text, '')
         )
    from (select bot_book_appointment(p_speciality, p_pincode, p_selection,
                                      p_patient_info, p_slot_selection, p_phone,
                                      p_type) as text) r;
$$;

comment on function bot_book_appointment_json is
  'bot_book_appointment as {booked, text} for AiSensy. Service role only, as '
  'the function it wraps: it writes appointments.';

-- Both grants that reach anon, per 0088.
revoke all on function bot_available_slots_json(text, text, text, text) from public, anon, authenticated;
grant execute on function bot_available_slots_json(text, text, text, text) to anon, authenticated;

revoke all on function bot_book_appointment_json(text, text, text, text, text, text, text)
  from public, anon, authenticated;
