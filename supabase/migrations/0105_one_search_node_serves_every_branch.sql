-- ============================================================================
-- Sehatsandhi — one search node serves every branch
--
-- Run AFTER 0104. Safe to re-run.
--
-- 0046 planned p_type as a literal typed into each branch's request body. That
-- needs a search node per branch — doctor, lab booking, lab call-back,
-- pharmacy, ambulance, camps — and AiSensy allows five API Request nodes in
-- total, two of which booking and insurance need. So the branch travels in the
-- attribute the flow already has instead:
--
--   Each menu branch runs a Set Attribute node first:
--     Any_speciality_code = CARD | SKIN | … (doctor branches, as now)
--                         = lab_booking | lab_callback | pharmacy | ambulance | camps
--
--   One search node, body unchanged from 0103:
--     {"p_type": "doctor", "p_filter_value": "{{Any_speciality_code}}",
--      "p_pincode": "{{Any_Pincode}}"}
--
-- When p_filter_value is one of those five words it is the branch, and p_type
-- is ignored. A p_type other than 'doctor' still wins, so a body that names
-- its branch outright keeps working.
--
-- The slots and booking wrappers read 'lab_booking' out of p_speciality the
-- same way, so the lab path reuses the doctor path's two nodes as well.
--
-- Insurance gets a JSON wrapper like the others. Service role only, as the
-- function it wraps: it stores the patient's phone number.
-- ============================================================================

create or replace function bot_branch(p_type text, p_filter_value text)
returns text language sql immutable as $$
  select case
    when lower(btrim(coalesce(p_type, ''))) not in ('', 'doctor')
      then lower(btrim(p_type))
    when lower(btrim(coalesce(p_filter_value, '')))
         in ('lab_booking', 'lab_callback', 'pharmacy', 'ambulance', 'camps')
      then lower(btrim(p_filter_value))
    else 'doctor'
  end;
$$;

comment on function bot_branch is
  'Which bot branch a request is for: an explicit non-doctor p_type, else a '
  'branch word carried in the speciality attribute, else doctor.';

create or replace function bot_generic_search_json(
  p_type text,
  p_filter_value text,
  p_pincode text
) returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
           'found', r.text is not null,
           'text',  coalesce(r.text, '')
         )
    from (select bot_generic_search(bot_branch(p_type, p_filter_value),
                                    p_filter_value, p_pincode) as text) r;
$$;

create or replace function bot_available_slots_json(
  p_speciality text, p_pincode text, p_selection text, p_type text default 'doctor'
) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'found', r.text is not null,
           'text',  coalesce(r.text, '')
         )
    from (select bot_available_slots(p_speciality, p_pincode, p_selection,
                                     bot_branch(p_type, p_speciality)) as text) r;
$$;

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
                                      bot_branch(p_type, p_speciality)) as text) r;
$$;

create or replace function bot_submit_insurance_lead_json(p_phone text, p_pincode text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('text', coalesce(bot_submit_insurance_lead(p_phone, p_pincode), ''));
$$;

comment on function bot_submit_insurance_lead_json is
  'bot_submit_insurance_lead as {text} for AiSensy. Service role only: it '
  'stores the patient''s phone number.';

-- Grants, per 0088. bot_branch is pure and harmless, but nothing outside these
-- wrappers needs it.
revoke all on function bot_branch(text, text) from public, anon, authenticated;

revoke all on function bot_generic_search_json(text, text, text) from public, anon, authenticated;
grant execute on function bot_generic_search_json(text, text, text) to anon, authenticated;

revoke all on function bot_available_slots_json(text, text, text, text) from public, anon, authenticated;
grant execute on function bot_available_slots_json(text, text, text, text) to anon, authenticated;

revoke all on function bot_book_appointment_json(text, text, text, text, text, text, text)
  from public, anon, authenticated;

revoke all on function bot_submit_insurance_lead_json(text, text) from public, anon, authenticated;
