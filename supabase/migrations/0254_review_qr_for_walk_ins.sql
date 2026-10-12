-- ============================================================================
-- 0254 — A review QR code for walk-in patients
-- ============================================================================
-- AFTER 0253. Safe to re-run.
--
-- A patient who booked through Sehatsandhi can rate the visit; a walk-in could
-- only do so if the clinic sent them a request (0232, paid from its wallet).
-- A third QR code at the clinic now lets a walk-in rate on their own phone:
-- it opens WhatsApp with "Review <the clinic's code>", and the bot asks for
-- the stars and their words. Because the patient writes first, it costs the
-- clinic nothing.
--
-- A review must be a real patient's: the number writing has to be one the
-- clinic's records show visiting in the last 30 days (a token, a written
-- visit or an admission), and one number rates a clinic once in 30 days.
-- Otherwise nothing is recorded and the bot says why.
-- ============================================================================

create or replace function bot_review_start_json(p_phone text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_code text := substring(upper(coalesce(p_code, '')) from 'SS-[A-Z0-9]{5}');
  b record;
  v record;
begin
  select x.id, x.name into b from businesses x where x.qr_code = v_code and x.status = 'active';
  if b.id is null or v_phone is null then
    return jsonb_build_object('ok', false, 'text', 'यह QR कोड अभी सक्रिय नहीं है। 🙏' || E'\n' || 'This code is not active right now.');
  end if;

  if exists (select 1 from ratings r where r.business_id = b.id and r.patient_phone_hash = sehat_phone_hash(v_phone)
                and r.created_at > now() - interval '30 days') then
    return jsonb_build_object('ok', false, 'text',
      'आप ' || b.name || ' की रेटिंग पहले ही दे चुके हैं। धन्यवाद 🙏' || E'\n' || 'You have already rated this clinic. Thank you.');
  end if;

  -- Their latest day here in the last 30: a token, a written visit, or an admission.
  select x.member, x.d, x.doc into v from (
    select q.patient_member_id member, q.queue_date d, q.practitioner_id doc from opd_queue q
     where q.business_id = b.id and q.queue_date > current_date - 30
    union all
    select pv.patient_member_id, pv.visit_date, pv.practitioner_id from patient_visits pv
     where pv.business_id = b.id and pv.visit_date > current_date - 30
    union all
    select a.patient_member_id, (a.admitted_at at time zone 'Asia/Kolkata')::date, a.attending_practitioner_id from admissions a
     where a.business_id = b.id and a.admitted_at > now() - interval '30 days'
  ) x
    join patient_members m on m.id = x.member
    join patients p on p.id = m.patient_id
   where p.phone = v_phone
   order by x.d desc nulls last limit 1;
  if v.member is null then
    return jsonb_build_object('ok', false, 'text',
      'हमें पिछले 30 दिनों में ' || b.name || ' में इस नंबर से कोई विज़िट नहीं मिली। रेटिंग उसी नंबर से दें जो आपने रिसेप्शन पर दिया था। 🙏' || E'\n'
      || 'We could not find a visit to ' || b.name || ' from this number in the last 30 days. Please rate from the number you gave at the reception.');
  end if;

  -- The request this rating will answer (0232's own path records it) — one open at a time.
  update rating_asks set sent_at = now() where business_id = b.id and phone = v_phone and status = 'sent';
  if not found then
    insert into rating_asks (business_id, patient_member_id, practitioner_id, phone, visit_on, asked_by_name, status, sent_at)
    values (b.id, v.member, v.doc, v_phone, v.d, 'Review QR', 'sent', now());
  end if;

  return jsonb_build_object('ok', true, 'name', b.name, 'text',
    '⭐ *' || b.name || '*' || E'\n' || 'आपकी विज़िट कैसी रही? नीचे से चुनें 👇' || E'\n' || 'How was your visit?');
end $$;
revoke all on function bot_review_start_json(text, text) from public, anon, authenticated;
grant execute on function bot_review_start_json(text, text) to service_role;

-- The rating itself (0232), which now knows a review QR was just scanned.
CREATE OR REPLACE FUNCTION public.bot_record_rating_json(p_phone text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone  text := sehat_normalise_phone(p_phone);
  v_m      text[];
  v_score  integer;
  v_review text;
  v_appt   uuid;
  v_who    text;
  v_ask    rating_asks;
  v_rating uuid;
begin
  if v_phone is null then
    return jsonb_build_object('recorded', false,
      'text', 'हमें आपका मोबाइल नंबर सही से नहीं मिला।');
  end if;

  -- 0215: a bare 1–4 just after this phone rated (and before it answered the
  -- savings question) is that answer — the AiSensy 1–5 keyword step brings it here.
  if sehat_wa_savings_on() and coalesce(p_message, '') ~ '^\s*[1-4]\s*$'
     and exists (select 1 from ratings r join appointments a on a.id = r.appointment_id
                  where sehat_normalise_phone(a.patient_phone) = v_phone and r.created_at > now() - interval '60 minutes'
                    and not exists (select 1 from visit_savings v where v.kind = 'booking' and v.ref_id = a.id)) then
    return bot_saved_json(p_phone, p_message);
  end if;

  v_m := regexp_match(coalesce(p_message, ''), '^\s*([1-5])(?![0-9])(.*)$');
  if v_m is null then
    return jsonb_build_object('recorded', false,
      'text', 'कृपया 1 से 5 तक एक नंबर भेजें — 1 (खराब) से 5 (बहुत अच्छा)।');
  end if;
  v_score  := v_m[1]::integer;
  v_review := nullif(btrim(regexp_replace(v_m[2], '^[\s.,:;)⭐★/-]+', '')), '');

  -- 0254: they have just scanned a clinic's review QR — the rating is for that
  -- clinic, even if a booked visit somewhere else is also waiting to be rated.
  if not exists (select 1 from rating_asks a where a.phone = v_phone and a.status = 'sent'
                    and a.asked_by_name = 'Review QR' and a.sent_at > now() - interval '30 minutes') then
    v_appt := sehat_rateable_visit(v_phone);
  end if;

  -- 0232: no booked visit to rate, but a clinic asked this patient for a
  -- review of a walk-in visit: the rating is for that clinic.
  if v_appt is null then
    select * into v_ask from rating_asks a
     where a.phone = v_phone and a.status = 'sent' and a.sent_at > now() - interval '30 days'
     order by a.sent_at desc limit 1;
    if v_ask.id is not null then
      insert into ratings (business_id, patient_phone_hash, overall_rating, review_text)
      values (v_ask.business_id, sehat_phone_hash(v_phone), v_score, v_review)
      returning id into v_rating;
      update rating_asks set status = 'rated', rating_id = v_rating where id = v_ask.id;
      select coalesce(p.full_name, b.name) into v_who
        from businesses b left join practitioners p on p.id = v_ask.practitioner_id where b.id = v_ask.business_id;
      return jsonb_build_object('recorded', true, 'ask_saved', false, 'has_review', v_review is not null,
        'text', 'धन्यवाद 🙏 ' || v_who || ' के लिए आपकी रेटिंग ' || repeat('⭐', v_score) || ' दर्ज हो गई।'
                || case when v_review is null
                        then E'\n\nअपना अनुभव एक-दो लाइन में लिखकर भेजें — इससे दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद मिलेगी।'
                        else ' इससे दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद मिलेगी।' end);
    end if;
  end if;

  if v_appt is null then
    if exists (
      select 1 from appointments a
       where sehat_normalise_phone(a.patient_phone) = v_phone
         and a.status in ('booked', 'confirmed')
         and a.slot_datetime >= now()) then
      return jsonb_build_object('recorded', false,
        'text', 'आपकी विज़िट अभी बाकी है। डॉक्टर से मिलने के बाद यहीं रेटिंग भेजें 🙏');
    end if;

    if exists (
      select 1 from ratings r
        join appointments a on a.id = r.appointment_id
       where sehat_normalise_phone(a.patient_phone) = v_phone
         and a.slot_datetime > now() - interval '30 days') then
      return jsonb_build_object('recorded', false,
        'text', 'आप अपनी पिछली विज़िट की रेटिंग पहले ही दे चुके हैं। धन्यवाद 🙏');
    end if;

    return jsonb_build_object('recorded', false,
      'text', 'हमें आपकी कोई हाल की विज़िट नहीं मिली जिसकी रेटिंग दी जा सके।');
  end if;

  perform sehat_record_rating(v_phone, v_score, v_review);

  select coalesce(p.full_name, b.name) into v_who
    from appointments a
    join businesses b on b.id = a.business_id
    left join practitioners p on p.id = a.practitioner_id
   where a.id = v_appt;

  return jsonb_build_object('recorded', true, 'ask_saved', sehat_wa_savings_on(),
    'text', 'धन्यवाद 🙏 ' || v_who || ' के लिए आपकी रेटिंग '
            || repeat('⭐', v_score) || ' दर्ज हो गई। '
            || 'इससे दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद मिलेगी।'
            -- 0215: one optional question, once the AiSensy step that catches the answer is in place.
            || case when sehat_wa_savings_on() then E'\n\n' || sehat_savings_question() else '' end);
end $function$;

notify pgrst, 'reload schema';
