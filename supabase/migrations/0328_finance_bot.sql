-- ============================================================================
-- 0328 — Treatment on EMI on the WhatsApp bot
-- ============================================================================
-- AFTER 0327. Safe to re-run. The bot (_shared/bot.ts) asks three things —
-- which hospital, what treatment, how much — and these two functions do the
-- rest, in the bot_*_json shape the other requests use ({ ok, text, … }).
-- Service role only: the bot is the caller; the phone is the WhatsApp sender's.
-- ============================================================================

-- Hospitals offering EMI that match what was typed, as WhatsApp list rows
-- (title ≤ 24 characters, description ≤ 72; at most 9 rows).
create or replace function bot_emi_hospitals_json(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not sehat_finance_enabled() then
    return jsonb_build_object('ok', false, 'text',
      'इलाज EMI पर अभी उपलब्ध नहीं है। 🙏' || chr(10) || 'Treatment on EMI is not available yet.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', 'req:hosp:' || h.id,
           'title', left(h.name, 24),
           'description', left(concat_ws(' · ', nullif(h.town, ''), case when length(h.name) > 24 then h.name end), 72))), '[]'::jsonb)
    into v_rows
    from (select * from sehat_finance_hospitals(p_query) limit 9) h;
  return jsonb_build_object('ok', jsonb_array_length(v_rows) > 0, 'rows', v_rows,
    'text', case when jsonb_array_length(v_rows) > 0
      then 'अस्पताल चुनें 👇' || chr(10) || 'Choose the hospital:'
      else 'इस नाम से EMI वाला कोई अस्पताल नहीं मिला। अस्पताल का नाम या शहर दोबारा लिखें।' || chr(10)
           || 'No hospital offering EMI matched that. Type the hospital''s name or town again.' end);
end $$;
revoke all on function bot_emi_hospitals_json(text) from public, anon, authenticated;
grant execute on function bot_emi_hospitals_json(text) to service_role;

-- The request itself, then the patient's link.
create or replace function bot_emi_request_json(p_phone text, p_name text, p_hospital text, p_treatment text, p_amount text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare c finance_cases; v_amt numeric; v_hosp text;
begin
  if p_hospital !~ '^[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'text', 'अस्पताल फिर से चुनें। / Please choose the hospital again.');
  end if;
  v_amt := nullif(regexp_replace(coalesce(p_amount, ''), '[^0-9]', '', 'g'), '')::numeric;
  c := sehat_finance_case_request(p_hospital::uuid, coalesce(nullif(btrim(p_name), ''), 'WhatsApp patient'),
                                  p_phone, p_treatment, v_amt, null, 'whatsapp');
  select name into v_hosp from businesses where id = c.business_id;
  return jsonb_build_object('ok', true, 'code', c.case_no, 'text',
    '✅ आपका EMI अनुरोध ' || v_hosp || ' को भेज दिया गया है (' || c.case_no || ')।' || chr(10)
    || 'अस्पताल इलाज और खर्च पक्का करेगा, फिर इस लिंक पर आप बैंक/NBFC चुनेंगे:' || chr(10)
    || sehat_site_url() || '/emi/' || c.public_token || chr(10) || chr(10)
    || 'Your EMI request has gone to ' || v_hosp || '. Once they confirm the estimate, choose a lender on this link.' || chr(10)
    || 'Sehatsandhi लेंडर नहीं है और आपसे कुछ नहीं लेता। / Sehatsandhi is not a lender and charges you nothing.');
exception when others then
  -- The checks in sehat_finance_case_request speak for themselves (minimum, switch off, hospital not offering).
  return jsonb_build_object('ok', false, 'text', sqlerrm);
end $$;
revoke all on function bot_emi_request_json(text, text, text, text, text) from public, anon, authenticated;
grant execute on function bot_emi_request_json(text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
