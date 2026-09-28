-- ============================================================================
-- Sehatsandhi — ask for the rating at booking, follow up the next day
--
-- Run AFTER 0163. Safe to re-run. Written as 0114 and held back; renumbered
-- 0164 on 28 Sep 2026. Checked then against production: bot_book_at was last
-- defined in 0111 and the four rating functions in 0102, unchanged by hand, so
-- this still replaces exactly what it was written to replace.
--
-- ── WHAT CHANGES FROM 0102, AND WHY ─────────────────────────────────────────
-- 0102 asked for a rating only by a paid template three hours after the slot,
-- through a campaign of its own. Two things made that the wrong first move:
--
--   1. The AiSensy plan allows five API campaigns and five are spoken for. A
--      rating campaign would need a slot the login OTP is still waiting on.
--   2. Every business-initiated message outside the 24-hour window is charged.
--      The one moment we are certainly inside that window is the booking
--      itself: the patient has just been talking to the bot.
--
-- So the ask now happens in two steps:
--
--   • FREE — the bot's booking confirmation carries one more line: after the
--     visit, send a number from 1 to 5 here. It is part of the same reply, so
--     it is not even an extra message.
--   • PAID, ONLY IF NEEDED — the day after the visit, between 10:00 and 20:00
--     IST, anyone who has not rated yet gets one follow-up. It goes through
--     the existing APPOINTMENT campaign, whose template is a single {{1}} that
--     carries the whole text (appointment-notify sends it the same way), so it
--     needs no new template and no new campaign.
--
-- Waiting for the next day rather than three hours also gives the clinic the
-- rest of the day to mark a no-show, and a no-show is never asked.
--
-- ── WHAT ELSE HAD TO MOVE FOR THAT ──────────────────────────────────────────
-- sehat_record_rating accepted a reply only for a visit we had sent a
-- rating_request about — "no request, no rating". A patient who remembers
-- on their own has, by design, never been sent one. The bound is now the visit
-- itself: a past, unrated, not-cancelled visit on that number in the last 30
-- days. That is still no visit, no rating — a number cannot rate a clinic it
-- never booked — and it is still service-role only.
--
-- ── WHAT REMAINS MANUAL ─────────────────────────────────────────────────────
-- In the AiSensy flow, one branch at the ENTRY trigger (not inside the booking
-- path, whose lists are also answered with numbers): a message that is 1-5
-- calls bot_record_rating_json with the service role key and replies with its
-- `text`. Then messaging_settings.rating_campaign is set to the appointment
-- campaign's exact name and sending is switched on — see the foot of this file.
-- ============================================================================


-- ============================================================================
-- 1. The booking confirmation asks, for free
--
-- 0111's bot_book_at, unchanged but for the last line. The confirmation still
-- begins 'आपका अपॉइंटमेंट बुक हो गया', which is what bot_book_appointment_json
-- reads `booked` off — that prefix must not move.
-- ============================================================================

create or replace function bot_book_at(
  p_business_id uuid,
  p_practitioner_id uuid,
  p_patient_info text,          -- "Sunita, 34" — one attribute holding two fields
  p_slot_datetime timestamptz,
  p_phone text,
  p_pin_code text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_phone text := sehat_normalise_phone(p_phone);
  v_info  text := btrim(coalesce(p_patient_info, ''));
  v_pin   text := case when p_pin_code ~ '^[1-9][0-9]{5}$' then p_pin_code end;
  v_name  text;
  v_age   integer;
  v_biz   record;
  v_who   text;
begin
  if v_phone is null then
    return 'हमें आपका मोबाइल नंबर सही से नहीं मिला। कृपया 10 अंकों का नंबर भेजें।';
  end if;
  if p_business_id is null or p_slot_datetime is null then
    return 'आपका चयन समझ नहीं आया। कृपया सूची में से दोबारा चुनें।';
  end if;

  select b.id, b.name, b.address, b.phone
    into v_biz
    from businesses b
   where b.id = p_business_id and b.status = 'active';
  if not found then
    return 'यह लिस्टिंग अभी उपलब्ध नहीं है। कृपया सूची में से कोई और चुनें।';
  end if;

  select coalesce(
           (select p.full_name from practitioners p where p.id = p_practitioner_id),
           v_biz.name)
    into v_who;

  v_name := nullif(btrim(split_part(v_info, ',', 1)), '');
  v_age  := nullif(substring(v_info from '([0-9]{1,3})[^0-9]*$'), '')::integer;
  if v_age is not null and (v_age < 1 or v_age > 120) then v_age := null; end if;
  if v_info not like '%,%' and v_age is not null then
    v_name := nullif(btrim(regexp_replace(v_name, '[0-9]{1,3}[^0-9]*$', '')), '');
  end if;

  insert into appointments (
    patient_phone, patient_name, patient_age, business_id, practitioner_id,
    slot_datetime, status, booked_via, last_actor, last_actor_detail, patient_pin_code
  ) values (
    v_phone, v_name, v_age, v_biz.id, p_practitioner_id,
    p_slot_datetime, 'booked', 'whatsapp_bot', 'patient', 'whatsapp_bot', v_pin
  );

  return 'आपका अपॉइंटमेंट बुक हो गया ✅'
      || E'\n\n' || v_who
      || case when v_who <> v_biz.name then E'\n' || v_biz.name else '' end
      || E'\n' || bot_hi_when(p_slot_datetime)
      || case when coalesce(v_biz.address, '') <> '' then E'\n' || v_biz.address else '' end
      || E'\n\nकृपया 10 मिनट पहले पहुँचें। बदलाव के लिए यहीं मैसेज करें।'
      || E'\n\n⭐ डॉक्टर से मिलने के बाद यहीं 1 से 5 तक एक नंबर भेजकर रेटिंग दें। '
      || 'इससे दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद मिलती है।';
exception
  when check_violation then
    return 'यह समय अभी-अभी भर गया। कृपया दूसरा समय चुनें।';
end $$;

revoke all on function bot_book_at(uuid, uuid, text, timestamptz, text, text)
  from public, anon, authenticated;


-- ============================================================================
-- 2. Which visit a reply is about
--
-- One function, so the recorder, the bot's answer and nothing else can
-- disagree about it. The most recent visit on this number that has happened,
-- was not cancelled or a no-show, is unrated, and is at most 30 days old.
-- ============================================================================

create or replace function sehat_rateable_visit(p_phone text)
returns uuid language sql stable security definer
set search_path = public
as $$
  select a.id
    from appointments a
   where sehat_normalise_phone(a.patient_phone) = sehat_normalise_phone(p_phone)
     and a.business_id is not null
     and a.status in ('booked', 'confirmed', 'completed')
     and a.slot_datetime < now()
     and a.slot_datetime > now() - interval '30 days'
     and not exists (select 1 from ratings r where r.appointment_id = a.id)
   order by a.slot_datetime desc
   limit 1;
$$;

comment on function sehat_rateable_visit is
  'The visit a 1-5 reply from this number would rate: most recent, already '
  'happened, not cancelled or no-show, unrated, within 30 days. Null if none.';


-- ============================================================================
-- 3. Recording it, without needing a request to have been sent
-- ============================================================================

create or replace function sehat_record_rating(
  p_phone  text,
  p_score  integer,
  p_review text default null
) returns uuid language plpgsql security definer
set search_path = public
as $$
declare
  v_phone text;
  v_appt  uuid;
  v_id    uuid;
begin
  v_phone := sehat_normalise_phone(p_phone);
  if v_phone is null then
    raise exception 'not a valid Indian mobile number' using errcode = '22023';
  end if;

  if p_score is null or p_score < 1 or p_score > 5 then
    raise exception 'rating must be a whole number from 1 to 5' using errcode = '22023';
  end if;

  v_appt := sehat_rateable_visit(v_phone);

  -- Nothing unrated. A patient who replies twice ('4', then '5') must not get an
  -- error the AiSensy flow would have to handle, so return what they already
  -- said rather than raising.
  if v_appt is null then
    select r.id into v_id
      from ratings r
      join appointments a on a.id = r.appointment_id
     where sehat_normalise_phone(a.patient_phone) = v_phone
       and a.slot_datetime > now() - interval '30 days'
     order by a.slot_datetime desc
     limit 1;

    if v_id is not null then
      return v_id;                       -- already rated; the reply is a no-op
    end if;

    raise exception 'no past visit to rate for this number'
      using errcode = 'P0002';
  end if;

  -- Two replies landing together both find the same unrated visit;
  -- UNIQUE(appointment_id) lets one in and the other reads it back.
  insert into ratings (appointment_id, business_id, patient_phone_hash,
                       overall_rating, review_text)
  select a.id, a.business_id, sehat_phone_hash(a.patient_phone), p_score,
         nullif(btrim(coalesce(p_review, '')), '')
    from appointments a
   where a.id = v_appt
  on conflict (appointment_id) do nothing
  returning id into v_id;

  if v_id is null then
    select r.id into v_id from ratings r where r.appointment_id = v_appt;
  end if;

  return v_id;
end $$;

comment on function sehat_record_rating is
  'Records a patient''s 1-5 reply against sehat_rateable_visit. Since 0114 it no '
  'longer needs a rating_request to have been sent: the booking confirmation '
  'asks for free, and a patient who remembers is answered. Idempotent: a second '
  'reply returns the first rating''s id. Service role only.';


-- ============================================================================
-- 4. What the bot says back
--
-- Takes the patient's raw message so the flow does not have to parse it. "5",
-- "5 बहुत अच्छे डॉक्टर" and "4⭐" all work; the words after the number become
-- the review. "10" does not read as a 1.
--
--   POST /rest/v1/rpc/bot_record_rating_json            SERVICE ROLE key
--     {"p_phone": "{{phone}}", "p_message": "{{message}}"}
--   →  {"recorded": true,  "text": "धन्यवाद 🙏 …"}
--   →  {"recorded": false, "text": "<what to tell the patient>"}
-- ============================================================================

create or replace function bot_record_rating_json(p_phone text, p_message text)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v_phone  text := sehat_normalise_phone(p_phone);
  v_m      text[];
  v_score  integer;
  v_review text;
  v_appt   uuid;
  v_who    text;
begin
  if v_phone is null then
    return jsonb_build_object('recorded', false,
      'text', 'हमें आपका मोबाइल नंबर सही से नहीं मिला।');
  end if;

  v_m := regexp_match(coalesce(p_message, ''), '^\s*([1-5])(?![0-9])(.*)$');
  if v_m is null then
    return jsonb_build_object('recorded', false,
      'text', 'कृपया 1 से 5 तक एक नंबर भेजें — 1 (खराब) से 5 (बहुत अच्छा)।');
  end if;
  v_score  := v_m[1]::integer;
  v_review := nullif(btrim(regexp_replace(v_m[2], '^[\s.,:;)⭐★/-]+', '')), '');

  v_appt := sehat_rateable_visit(v_phone);

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

  return jsonb_build_object('recorded', true,
    'text', 'धन्यवाद 🙏 ' || v_who || ' के लिए आपकी रेटिंग '
            || repeat('⭐', v_score) || ' दर्ज हो गई। '
            || 'इससे दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद मिलेगी।');
end $$;

comment on function bot_record_rating_json is
  'The AiSensy flow''s 1-5 branch. Parses the raw reply, records it against '
  'sehat_rateable_visit, and returns {recorded, text} for the bot to send back. '
  'Service role only.';


-- ============================================================================
-- 5. The follow-up, the day after, only for those who have not rated
--
-- Same shape as 0102's queue. What changed: the slot must be on an EARLIER
-- IST calendar day than today, and nothing is queued outside 10:00-20:00 IST,
-- so a visit on Monday evening is asked about on Tuesday morning, not at
-- midnight. rating_delay_hours still applies as a floor. p_hours is kept only
-- so the signature and its grants do not change.
-- ============================================================================

create or replace function sehat_queue_rating_requests(p_hours integer default null)
returns integer language plpgsql security definer
set search_path = public
as $$
declare
  n integer;
  v_enabled boolean;
  v_hours integer;
  v_now_ist timestamp := now() at time zone 'Asia/Kolkata';
begin
  select rating_sending_enabled, coalesce(p_hours, rating_delay_hours)
    into v_enabled, v_hours
    from messaging_settings where id;

  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  if extract(hour from v_now_ist) < 10 or extract(hour from v_now_ist) >= 20 then
    return 0;
  end if;

  insert into notification_outbox (appointment_id, recipient, phone, event, payload, status)
  select a.id, 'patient', a.patient_phone, 'rating_request',
         jsonb_build_object(
           'patient_name', a.patient_name,
           'doctor_name', coalesce(p.full_name, b.name),
           'new_slot', a.slot_datetime
         ),
         'pending_wa'
    from appointments a
    join businesses b on b.id = a.business_id
    left join practitioners p on p.id = a.practitioner_id
   where a.status in ('booked', 'confirmed', 'completed')
     and (a.slot_datetime at time zone 'Asia/Kolkata')::date < v_now_ist::date
     and a.slot_datetime < now() - make_interval(hours => greatest(coalesce(v_hours, 3), 1))
     and a.slot_datetime > now() - interval '7 days'
     and coalesce(a.patient_phone, '') <> ''
     and not exists (select 1 from ratings r where r.appointment_id = a.id)
     and not exists (
       select 1 from notification_outbox o
        where o.appointment_id = a.id and o.event = 'rating_request')
     and not exists (
       select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(a.patient_phone));

  get diagnostics n = row_count;
  return n;
end $$;

comment on function sehat_queue_rating_requests is
  'Queues one follow-up per visit that happened on an earlier IST day and is '
  'still unrated, skipping anyone already asked or opted out, bounded to 7 days. '
  'Runs only 10:00-20:00 IST. Since 0114 this is the second ask; the first is '
  'the free line in the booking confirmation.';


-- ============================================================================
-- 6. The follow-up's wording
--
-- Lives here now, not in AiSensy: the appointment template is a bare {{1}}.
-- ONE LINE on purpose — WhatsApp rejects a template variable containing a
-- newline, a tab or more than four spaces in a row, and it rejects the whole
-- message, not just the formatting.
-- ============================================================================

create or replace function sehat_rating_request_text(p_payload jsonb)
returns text language sql stable
set search_path = public
as $$
  select 'नमस्ते'
      || coalesce(' ' || nullif(btrim(p_payload ->> 'patient_name'), ''), '')
      || ' 🙏 '
      -- Day and month only. bot_hi_date leads with the short weekday, and
      -- "रवि 20 सितंबर" (Sun 20 Sep) reads as a person called Ravi here.
      || coalesce(extract(day from ((p_payload ->> 'new_slot')::timestamptz at time zone 'Asia/Kolkata'))::int
                  || ' ' || bot_hi_month(extract(month from ((p_payload ->> 'new_slot')::timestamptz at time zone 'Asia/Kolkata'))::int)
                  || ' को ', '')
      || coalesce(nullif(btrim(p_payload ->> 'doctor_name'), ''), 'डॉक्टर')
      || ' के साथ आपकी विज़िट कैसी रही? '
      || '1 (खराब) से 5 (बहुत अच्छा) तक एक नंबर भेजें। '
      || 'आपकी रेटिंग दूसरे मरीज़ों को सही डॉक्टर चुनने में मदद करती है।';
$$;

comment on function sehat_rating_request_text is
  'The follow-up rating question, as the single {{1}} of the appointment '
  'template. Must stay on one line: WhatsApp refuses newlines in a variable.';


-- ============================================================================
-- 7. The sender, on the appointment campaign
--
-- 0102's sender, with one change: templateParams is ONE element, the whole
-- text, matching the appointment template. 0102 sent two (name, doctor) for a
-- two-variable template that was never created.
-- ============================================================================

create or replace function sehat_send_rating_requests()
returns integer language plpgsql security definer
set search_path = public
as $$
declare
  rec       record;
  v_key     text;
  v_campaign text;
  v_enabled boolean;
  v_batch   integer;
  v_phone   text;
  v_req     bigint;
  n         integer := 0;
begin
  select rating_sending_enabled, rating_campaign, rating_send_batch
    into v_enabled, v_campaign, v_batch
    from messaging_settings where id;

  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'aisensy_api_key';
  exception when others then
    v_key := null;
  end;

  if coalesce(v_key, '') = '' then
    raise warning 'aisensy_api_key is not in this database''s Vault — no rating '
                  'request sent. Rows stay at pending_wa and lose nothing.';
    return 0;
  end if;

  for rec in
    select o.id, o.phone, o.payload
      from notification_outbox o
     where o.event = 'rating_request'
       and o.status = 'pending_wa'
     order by o.created_at
     limit greatest(coalesce(v_batch, 50), 1)
     for update skip locked
  loop
    v_phone := sehat_normalise_phone(rec.phone);

    if v_phone is null then
      update notification_outbox
         set status = 'failed',
             attempts = coalesce(attempts, 0) + 1,
             last_error = 'rating: not a valid Indian mobile'
       where id = rec.id;
      continue;
    end if;

    -- A patient who rated between queueing and sending is not asked.
    if exists (select 1 from ratings r
                 join notification_outbox o on o.appointment_id = r.appointment_id
                where o.id = rec.id) then
      update notification_outbox
         set status = 'failed', last_error = 'rating: already rated, not sent'
       where id = rec.id;
      continue;
    end if;

    update notification_outbox
       set status = 'awaiting_provider',
           attempts = coalesce(attempts, 0) + 1,
           last_error = null
     where id = rec.id and status = 'pending_wa';
    if not found then continue; end if;

    v_req := net.http_post(
      url := 'https://backend.aisensy.com/campaign/t1/api/v2',
      body := jsonb_build_object(
        'apiKey',         v_key,
        'campaignName',   v_campaign,
        'destination',    v_phone,
        'userName',       coalesce(rec.payload ->> 'patient_name', 'Patient'),
        'source',         'rating-cron',
        'templateParams', jsonb_build_array(sehat_rating_request_text(rec.payload))
      ),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );

    update notification_outbox set provider_request_id = v_req where id = rec.id;
    n := n + 1;
  end loop;

  return n;
end $$;

comment on function sehat_send_rating_requests is
  'Posts queued rating follow-ups to AiSensy through the appointment campaign, '
  'the whole text as its single {{1}}. Claims each row first so overlapping '
  'runs cannot double-send; the outcome is settled by '
  'sehat_reconcile_rating_requests, because net.http_post is asynchronous.';


-- ============================================================================
-- 8. Settling, with the message it actually sent in the log
--
-- 0102's reconcile, unchanged but for body_preview: the wording now lives here,
-- so the log quotes it instead of describing a template.
-- ============================================================================

create or replace function sehat_reconcile_rating_requests(
  p_max_attempts integer default 5
) returns integer language plpgsql security definer
set search_path = public
as $$
declare
  rec      record;
  v_key    text;
  v_campaign text;
  v_code   integer;
  v_body   text;
  v_err    text;
  v_detail text;
  v_ok     boolean;
  n        integer := 0;
begin
  select rating_campaign into v_campaign from messaging_settings where id;

  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'aisensy_api_key';
  exception when others then
    v_key := null;
  end;

  for rec in
    select o.id, o.phone, o.payload, o.attempts, o.claimed_at, o.provider_request_id
      from notification_outbox o
     where o.event = 'rating_request'
       and o.status = 'awaiting_provider'
     order by o.claimed_at
     for update skip locked
  loop
    v_code := null; v_body := null; v_err := null;

    if rec.provider_request_id is not null then
      select r.status_code, r.content, r.error_msg
        into v_code, v_body, v_err
        from net._http_response r
       where r.id = rec.provider_request_id;
    end if;

    if v_code is null and v_err is null then
      if coalesce(rec.claimed_at, now()) > now() - interval '15 minutes' then
        continue;
      end if;
      v_detail := 'rating: no provider response within 15 minutes';
      v_ok := false;
    elsif v_code between 200 and 299 then
      v_detail := null;
      v_ok := true;
    else
      -- Never store a body that contains the key; see 0102.
      if v_key is not null and coalesce(v_body, '') <> ''
         and position(v_key in v_body) > 0 then
        v_detail := 'rating: provider refused (' || coalesce(v_code, 0)
                    || '); response withheld, it echoed the API key';
      else
        v_detail := 'rating: provider refused (' || coalesce(v_code, 0) || ') '
                    || left(coalesce(nullif(v_body, ''), v_err, 'no detail'), 300);
      end if;
      v_ok := false;
    end if;

    if v_ok then
      update notification_outbox
         set status = 'sent', sent_channel = 'whatsapp', sent_at = now(),
             last_error = null
       where id = rec.id;
    elsif coalesce(rec.attempts, 0) < greatest(coalesce(p_max_attempts, 5), 1) then
      update notification_outbox
         set status = 'pending_wa', last_error = v_detail, provider_request_id = null
       where id = rec.id;
    else
      update notification_outbox
         set status = 'failed', last_error = v_detail
       where id = rec.id;
    end if;

    insert into message_log (phone, channel, provider, campaign, template_name,
                             body_preview, status, error_detail, queued_at, sent_at)
    values (rec.phone, 'whatsapp', 'aisensy', 'rating_request', v_campaign,
            left(sehat_rating_request_text(rec.payload), 160),
            case when v_ok then 'sent' else 'failed' end,
            v_detail, rec.claimed_at, case when v_ok then now() else null end);

    n := n + 1;
  end loop;

  return n;
end $$;

comment on function sehat_reconcile_rating_requests is
  'Turns an enqueued pg_net request into sent, retried or failed, and writes the '
  'message_log row quoting what was sent. A retry goes back to ''pending_wa'' '
  'and never to ''pending'', which is the edge drain''s queue.';


-- ============================================================================
-- 9. Settings and grants
-- ============================================================================

comment on column messaging_settings.rating_campaign is
  'Since 0114: the APPOINTMENT campaign''s exact name in AiSensy — the one whose '
  'template is a single {{1}}. Not a campaign of its own; the plan has no slot '
  'for one.';
comment on column messaging_settings.rating_delay_hours is
  'Floor only. Since 0114 the follow-up waits for the next IST day and goes out '
  'between 10:00 and 20:00, which is always longer than this.';

revoke all on function sehat_rateable_visit(text)                 from public, anon, authenticated;
revoke all on function sehat_record_rating(text, integer, text)   from public, anon, authenticated;
revoke all on function bot_record_rating_json(text, text)         from public, anon, authenticated;
revoke all on function sehat_rating_request_text(jsonb)           from public, anon, authenticated;
revoke all on function sehat_queue_rating_requests(integer)       from public, anon, authenticated;
revoke all on function sehat_send_rating_requests()               from public, anon, authenticated;
revoke all on function sehat_reconcile_rating_requests(integer)   from public, anon, authenticated;

grant execute on function sehat_record_rating(text, integer, text) to service_role;
grant execute on function bot_record_rating_json(text, text)       to service_role;


-- ============================================================================
-- TURNING ON THE FOLLOW-UP — after the flow's 1-5 branch exists, not before
--
-- The free line in the confirmation is live as soon as this runs. The paid
-- follow-up stays off until:
--
--   update messaging_settings
--      set rating_campaign = '<appointment campaign name, exactly as in AiSensy>',
--          rating_sending_enabled = true,
--          updated_by = 'nitin', updated_at = now()
--    where id;
--
-- VERIFYING
--
--   select bot_record_rating_json('919812345678', '5 बहुत अच्छे डॉक्टर');
--   select sehat_rating_request_text(
--     '{"patient_name":"Sunita","doctor_name":"Dr. Sharma","new_slot":"2026-09-20T11:00:00+05:30"}');
--   select status, count(*), max(last_error)
--     from notification_outbox where event = 'rating_request' group by status;
-- ============================================================================
