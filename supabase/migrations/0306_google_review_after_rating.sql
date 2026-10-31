-- ============================================================================
-- 0306 — After a WhatsApp rating, ask for a Google review too (everyone)
-- ============================================================================
-- AFTER 0305. Safe to re-run.
--
-- Decided 31 Oct 2026 (SN Eye first, every clinic with a Google listing): when
-- a patient rates a visit on WhatsApp, the thank-you also offers the clinic's
-- Google review link.
--
-- EVERY RATING, NOT ONLY GOOD ONES. Google's review policy forbids selectively
-- asking happy customers for reviews ("review gating"); a business caught doing
-- it can lose reviews or its listing. So the line is the same for 1 star and
-- for 5, worded neutrally, and appears only for clinics whose Google place ID
-- is known (businesses.google_place_id).
--
-- bot_record_rating_json is 0254's function unchanged except for that line on
-- its two "recorded" replies (booked visit; walk-in or review-QR rating).
-- ============================================================================

create or replace function sehat_google_review_line(p_business uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select E'\n\n' || 'क्या आप Google पर भी अपना अनुभव लिखेंगे? बस एक मिनट लगेगा 👇'
           || E'\n' || 'Would you also share your experience on Google? It takes a minute.'
           || E'\n' || 'https://search.google.com/local/writereview?placeid=' || b.google_place_id
      from businesses b
     where b.id = p_business and coalesce(btrim(b.google_place_id), '') <> ''), '');
$$;
revoke all on function sehat_google_review_line(uuid) from public, anon, authenticated;
grant execute on function sehat_google_review_line(uuid) to service_role;

-- The rating itself (0232/0254), now with the Google line.
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
                        else ' इससे दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद मिलेगी।' end
                || sehat_google_review_line(v_ask.business_id));
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
            -- 0306: the clinic's Google review link, for every rating.
            || sehat_google_review_line((select a.business_id from appointments a where a.id = v_appt))
            -- 0215: one optional question, once the AiSensy step that catches the answer is in place.
            || case when sehat_wa_savings_on() then E'\n\n' || sehat_savings_question() else '' end);
end $function$;

notify pgrst, 'reload schema';
