-- ============================================================================
-- 0232 — A review is asked for by the clinic, from its panel, on its wallet
-- ============================================================================
-- AFTER 0231. Safe to re-run.
--
-- A rating request used to go out by itself three hours after a visit, paid
-- for by Sehatsandhi (0164) — and only for a visit that was BOOKED, so a
-- clinic working on walk-in tokens could never be rated at all. Decided 11
-- Oct 2026: the clinic asks, from its panel, for the patients it chooses; the
-- message is one of its own WhatsApp messages, paid from its wallet (0217).
-- The automatic send stays off (messaging_settings.rating_sending_enabled).
--
--   rating_asks — one row per patient asked: who asked, for which visit, what
--        became of the message, and the rating it led to.
--
--   Who may be asked: a patient of that clinic with a visit, token or
--        admission there in the last 60 days, who has a mobile number, has
--        not said STOP, has not been asked by this clinic in the last 30 days
--        and has not rated it in that time. One ask per patient, not per visit.
--
--   The reply: the patient answers 1 to 5 on WhatsApp, as before. With no
--        booked visit to attach it to, the rating goes to the clinic that
--        asked. A rating sent without words is followed by one invitation to
--        add a line; what they send next is kept as the review
--        (sehat_rating_add_review).
--
--   THE BUTTON ON A BOOKING. The bot's booking confirmation carries a
--        "⭐ रेटिंग दें" button, good for 24 hours — the window in which a tap
--        and our answer cost nothing. A tap before the visit time says so and
--        records nothing; after it, the patient picks 1 to 5 from a list and
--        can add their words. bot_rating_ready_json answers "has the visit
--        time passed?".
--
-- A rating is still only ever written by the patient's own reply.
-- ============================================================================

create table if not exists rating_asks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  patient_member_id uuid not null references patient_members(id) on delete cascade,
  practitioner_id uuid references practitioners(id) on delete set null,
  phone text not null,
  visit_on date not null,
  asked_by uuid,
  asked_by_name text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'rated')),
  wa_message_id text,
  wallet_tx uuid,
  error text,
  rating_id uuid references ratings(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists rating_asks_business_idx on rating_asks (business_id, created_at desc);
create index if not exists rating_asks_phone_idx on rating_asks (phone) where status = 'sent';
alter table rating_asks enable row level security;
revoke all on rating_asks from anon;
grant select on rating_asks to authenticated;
drop policy if exists clinic_reads_rating_asks on rating_asks;
create policy clinic_reads_rating_asks on rating_asks for select to authenticated
  using (sehat_caller_owns_business(business_id));

-- ── May this patient be asked? If so, the ask is opened ─────────────────────
-- Called as the clinic's own user. Returns { ok, ask, phone, name, doctor,
-- visit } to send, or { ok: false, text } saying why not.
create or replace function sehat_rating_ask_open(p_business uuid, p_member uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_phone text;
  v_name text;
  v_day date;
  v_doc uuid;
  v_last timestamptz;
  v_ask uuid;
begin
  if not sehat_caller_owns_business(p_business) then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  select sehat_normalise_phone(pa.phone), pm.full_name into v_phone, v_name
    from business_patients bp
    join patient_members pm on pm.id = bp.patient_member_id
    join patients pa on pa.id = pm.patient_id
   where bp.business_id = p_business and bp.patient_member_id = p_member;
  if not found then return jsonb_build_object('ok', false, 'text', 'Not a patient of this clinic.'); end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'text', 'No mobile number on record.'); end if;

  -- Their latest day here: a written visit, a token, or an admission.
  select x.d, x.doc into v_day, v_doc from (
    select v.visit_date d, v.practitioner_id doc from patient_visits v
     where v.business_id = p_business and v.patient_member_id = p_member and v.visit_date is not null
    union all
    select q.queue_date, q.practitioner_id from opd_queue q
     where q.business_id = p_business and q.patient_member_id = p_member and q.status not in ('skipped', 'left')
    union all
    select (a.admitted_at at time zone 'Asia/Kolkata')::date, a.attending_practitioner_id from admissions a
     where a.business_id = p_business and a.patient_member_id = p_member) x
   where x.d <= v_today order by x.d desc limit 1;
  if v_day is null or v_day < v_today - 60 then
    return jsonb_build_object('ok', false, 'text', 'No visit here in the last 60 days.');
  end if;

  if exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(v_phone)) then
    return jsonb_build_object('ok', false, 'text', 'This patient has asked not to be messaged (STOP).');
  end if;
  select max(a.created_at) into v_last from rating_asks a
   where a.business_id = p_business and a.phone = v_phone and a.status in ('pending', 'sent', 'rated')
     and a.created_at > now() - interval '30 days';
  if v_last is not null then
    return jsonb_build_object('ok', false, 'text', 'Already asked on ' || to_char(v_last at time zone 'Asia/Kolkata', 'DD Mon') || '.');
  end if;
  if exists (select 1 from ratings r where r.business_id = p_business and r.patient_phone_hash = sehat_phone_hash(v_phone)
                and r.created_at > now() - interval '30 days') then
    return jsonb_build_object('ok', false, 'text', 'This patient has already rated the clinic.');
  end if;

  insert into rating_asks (business_id, patient_member_id, practitioner_id, phone, visit_on, asked_by, asked_by_name)
  values (p_business, p_member, v_doc, v_phone, v_day, auth.uid(), sehat_caller_staff_name(p_business))
  returning id into v_ask;
  return jsonb_build_object('ok', true, 'ask', v_ask, 'phone', v_phone,
    'name', split_part(btrim(coalesce(v_name, '')), ' ', 1),
    'doctor', coalesce((select p.full_name from practitioners p where p.id = v_doc), (select b.name from businesses b where b.id = p_business)),
    'visit', bot_hi_date(v_day));
end $$;
revoke all on function sehat_rating_ask_open(uuid, uuid) from public, anon;
grant execute on function sehat_rating_ask_open(uuid, uuid) to authenticated;

-- What became of the message.
create or replace function sehat_rating_ask_close(p_ask uuid, p_sent boolean, p_message_id text default null, p_tx uuid default null, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update rating_asks set status = case when p_sent then 'sent' else 'failed' end, sent_at = case when p_sent then now() end,
         wa_message_id = nullif(p_message_id, ''), wallet_tx = p_tx, error = left(p_error, 300)
   where id = p_ask and status = 'pending';
$$;
revoke all on function sehat_rating_ask_close(uuid, boolean, text, uuid, text) from public, anon, authenticated;
grant execute on function sehat_rating_ask_close(uuid, boolean, text, uuid, text) to service_role;

-- ── The words after a bare number ───────────────────────────────────────────
-- The patient's next message, kept as the review of the rating they just gave.
create or replace function sehat_rating_add_review(p_phone text, p_text text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_text text := nullif(left(btrim(coalesce(p_text, '')), 600), '');
  v_id uuid;
begin
  if v_phone is null or v_text is null or length(v_text) < 3 then return jsonb_build_object('saved', false); end if;
  update ratings set review_text = v_text
   where id = (select r.id from ratings r
                where r.patient_phone_hash = sehat_phone_hash(v_phone) and r.review_text is null
                  and r.created_at > now() - interval '2 hours'
                order by r.created_at desc limit 1)
  returning id into v_id;
  return jsonb_build_object('saved', v_id is not null,
    'text', case when v_id is not null then 'धन्यवाद 🙏 आपका अनुभव दर्ज हो गया।' end);
end $$;
revoke all on function sehat_rating_add_review(text, text) from public, anon, authenticated;
grant execute on function sehat_rating_add_review(text, text) to service_role;

-- ── Is there a visit this number can rate now? ──────────────────────────────
create or replace function bot_rating_ready_json(p_phone text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_next timestamptz;
begin
  if v_phone is null then return jsonb_build_object('ready', false, 'text', 'हमें आपका मोबाइल नंबर सही से नहीं मिला।'); end if;
  if sehat_rateable_visit(v_phone) is not null
     or exists (select 1 from rating_asks a where a.phone = v_phone and a.status = 'sent' and a.sent_at > now() - interval '30 days') then
    return jsonb_build_object('ready', true);
  end if;
  select min(a.slot_datetime) into v_next from appointments a
   where sehat_normalise_phone(a.patient_phone) = v_phone and a.status in ('booked', 'confirmed') and a.slot_datetime >= now();
  if v_next is not null then
    return jsonb_build_object('ready', false,
      'text', 'आपकी विज़िट अभी बाकी है (' || bot_hi_when(v_next) || ')। डॉक्टर से मिलने के बाद यही बटन दबाकर रेटिंग दें 🙏');
  end if;
  if exists (select 1 from ratings r where r.patient_phone_hash = sehat_phone_hash(v_phone) and r.created_at > now() - interval '30 days') then
    return jsonb_build_object('ready', false, 'text', 'आप अपनी विज़िट की रेटिंग दे चुके हैं। धन्यवाद 🙏');
  end if;
  return jsonb_build_object('ready', false, 'text', 'हमें आपकी कोई हाल की विज़िट नहीं मिली जिसकी रेटिंग दी जा सके।');
end $$;
revoke all on function bot_rating_ready_json(text) from public, anon, authenticated;
grant execute on function bot_rating_ready_json(text) to service_role;

-- ── A rating with no booked visit goes to the clinic that asked ─────────────
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

  v_appt := sehat_rateable_visit(v_phone);

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
