-- ============================================================================
-- Sehatsandhi — STOP / START on WhatsApp, and deleting old logs on a schedule
--
-- Run AFTER 0172. Safe to re-run.
--
-- ── 1. STOP and START ───────────────────────────────────────────────────────
-- The opt-in message (0141) says "send STOP any time", but nothing acted on it.
-- Messages reach AiSensy, not us, and all five of the flow's API nodes are in
-- use, so — exactly like the QR opt-in (0143) — STOP and START ride the search
-- node: the flow's keyword triggers call bot_generic_search_json with
--
--   p_type 'stop'  (STOP, UNSUBSCRIBE, रोकें, बंद …)   or  'start'  (START, शुरू …)
--   p_filter_value the patient's message text (kept as the reason)
--   p_pincode      the patient's WhatsApp number (AiSensy's phone attribute)
--
-- and show the returned text, as for the info branches.
--
-- STOP adds the number to opt_outs (the suppression list: stored as a hash,
-- one row per phone) and records a 'withdrawn' marketing consent for every
-- clinic the number had agreed to. That stops clinic promotions (0116) and
-- rating requests (0102/0164), which both check opt_outs. It does NOT stop
-- appointment confirmations, reminders, prescriptions, bills or reports: those
-- are the service the patient asked for, not marketing, and nothing about them
-- reads opt_outs — the reply says so.
--
-- START removes the number from opt_outs and re-grants marketing consent to
-- exactly the clinics STOP withdrew it from — no clinic the patient never
-- agreed to. It is the patient's own affirmative message, so it is valid
-- consent under the DPDP Act.
--
-- ── 2. Old logs, deleted daily (the Privacy Policy lists these) ─────────────
--   message_log                 12 months   (phone number + delivery status)
--   notification_outbox         90 days once sent or failed
--   email_outbox                90 days once sent or failed
--   phone_verifications         30 days after verified or expired
--   wa_sessions                 12 months after the conversation closed
--   wa_contacts                 24 months after the number last wrote to us
--   bot_search_log, unmet_demand_log   24 months (no phone number; tidy-up)
-- ============================================================================

-- ── 1. STOP / START ─────────────────────────────────────────────────────────

create or replace function bot_opt_out(p_phone text, p_text text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_patient uuid;
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'text', 'मोबाइल नंबर समझ नहीं आया। / We could not read your number.');
  end if;
  select id into v_patient from patients where phone = v_phone;

  insert into opt_outs (phone_hash, phone, patient_id, channel, reason)
  values (sehat_phone_hash(v_phone), v_phone, v_patient, 'whatsapp',
          'STOP keyword' || coalesce(': ' || nullif(left(btrim(p_text), 60), ''), ''))
  on conflict (phone_hash) do nothing;

  -- A withdrawal row per clinic the number had agreed to, so the consent
  -- history says what happened and START can restore exactly these.
  -- clock_timestamp(), not now(): everything in one call shares now(), and
  -- sehat_has_consent reads the newest row, so a tie would be a coin toss.
  insert into patient_consents (patient_id, patient_member_id, business_id, phone, channel, action, basis, purpose, recorded_by, created_at)
  select distinct on (c.patient_member_id, c.business_id)
         c.patient_id, c.patient_member_id, c.business_id, v_phone, 'whatsapp', 'withdrawn', 'stop_keyword', 'marketing', 'system:stop_keyword', clock_timestamp()
    from patient_consents c
   where c.phone = v_phone and c.purpose = 'marketing' and c.business_id is not null
     and sehat_has_consent(c.patient_member_id, 'marketing', c.business_id)
   order by c.patient_member_id, c.business_id, c.created_at desc;

  return jsonb_build_object('ok', true, 'text',
    'आपको अब किसी भी क्लिनिक से प्रचार वाले मैसेज और रेटिंग के अनुरोध नहीं आएंगे। अपॉइंटमेंट, पर्चे, बिल और रिपोर्ट के मैसेज आते रहेंगे। दोबारा शुरू करने के लिए START भेजें।'
    || E'\n\n' ||
    'You will no longer get promotional messages or rating requests from any clinic. Appointment, prescription, bill and report messages will continue. Send START to turn them back on.');
end $$;
revoke all on function bot_opt_out(text, text) from public, anon, authenticated;
grant execute on function bot_opt_out(text, text) to service_role;

create or replace function bot_opt_in_again(p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_restored integer;
begin
  if length(v_phone) = 10 then v_phone := '91' || v_phone; end if;
  if v_phone !~ '^91[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'text', 'मोबाइल नंबर समझ नहीं आया। / We could not read your number.');
  end if;

  delete from opt_outs where phone_hash = sehat_phone_hash(v_phone);

  -- Re-grant only where STOP was the latest word for that member and clinic.
  with last as (
    select distinct on (c.patient_member_id, c.business_id) c.*
      from patient_consents c
     where c.phone = v_phone and c.purpose = 'marketing' and c.business_id is not null
     order by c.patient_member_id, c.business_id, c.created_at desc, (c.basis = 'stop_keyword') desc
  )
  insert into patient_consents (patient_id, patient_member_id, business_id, phone, channel, action, basis, purpose, recorded_by, created_at)
  select l.patient_id, l.patient_member_id, l.business_id, v_phone, 'whatsapp', 'granted', 'start_keyword', 'marketing', 'system:start_keyword', clock_timestamp()
    from last l where l.action = 'withdrawn' and l.basis = 'stop_keyword';
  get diagnostics v_restored = row_count;

  update patients set consent_status = 'granted'
   where phone = v_phone and consent_status = 'withdrawn' and v_restored > 0;

  return jsonb_build_object('ok', true, 'text',
    'स्वागत है! जिन क्लिनिक्स के अपडेट के लिए आपने हां कहा था, उनके मैसेज फिर से आएंगे। रोकने के लिए कभी भी STOP भेजें।'
    || E'\n\n' ||
    'Welcome back! Updates from the clinics you had agreed to will resume. Send STOP any time to stop them.');
end $$;
revoke all on function bot_opt_in_again(text) from public, anon, authenticated;
grant execute on function bot_opt_in_again(text) to service_role;

create or replace function bot_generic_search_json(p_type text, p_filter_value text, p_pincode text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  r jsonb;
  v_type text := lower(btrim(coalesce(p_type, '')));
begin
  -- 0143: the QR opt-in rides this node (all five AiSensy API nodes are used).
  if v_type = 'optin' then
    r := bot_clinic_optin(p_filter_value, p_pincode, null);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;
  -- 0173: STOP and START ride it too.
  if v_type = 'stop' then
    r := bot_opt_out(p_pincode, p_filter_value);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;
  if v_type = 'start' then
    r := bot_opt_in_again(p_pincode);
    return jsonb_build_object('found', coalesce((r ->> 'ok')::boolean, false), 'route', 'info', 'text', r ->> 'text');
  end if;
  return bot_generic_search_json_0143_inner(p_type, p_filter_value, p_pincode);
end $function$;
-- Grants unchanged from 0106 (anon, authenticated): create or replace keeps them.

-- ── 2. Old logs ─────────────────────────────────────────────────────────────

do $$
declare j record;
begin
  for j in
    select * from (values
      ('purge-message-log',         '45 21 * * *', $c$ delete from public.message_log where coalesce(sent_at, queued_at) < now() - interval '12 months' $c$),
      ('purge-notification-outbox', '50 21 * * *', $c$ delete from public.notification_outbox where status in ('sent', 'failed') and created_at < now() - interval '90 days' $c$),
      ('purge-email-outbox',        '52 21 * * *', $c$ delete from public.email_outbox where status in ('sent', 'failed') and created_at < now() - interval '90 days' $c$),
      ('purge-phone-verifications', '54 21 * * *', $c$ delete from public.phone_verifications where coalesce(verified_at, expires_at) < now() - interval '30 days' $c$),
      ('purge-wa-sessions',         '56 21 * * *', $c$ delete from public.wa_sessions where closed_at < now() - interval '12 months' $c$),
      ('purge-wa-contacts',         '58 21 * * *', $c$ delete from public.wa_contacts where coalesce(last_inbound_at, created_at) < now() - interval '24 months' $c$),
      ('purge-search-logs',         '0 22 * * *',  $c$ delete from public.bot_search_log where created_at < now() - interval '24 months'; delete from public.unmet_demand_log where created_at < now() - interval '24 months' $c$)
    ) v(name, sched, cmd)
  loop
    begin perform cron.unschedule(j.name);
    exception when others then null; end;
    perform cron.schedule(j.name, j.sched, j.cmd);
  end loop;
end $$;

notify pgrst, 'reload schema';
