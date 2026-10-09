-- ============================================================================
-- 0219 — Clinic broadcasts go out (0116's "phase 2"), through Meta
-- ============================================================================
-- AFTER 0218. Safe to re-run.
--
-- 0116 built everything about a clinic's WhatsApp broadcast except sending
-- it, which waited on AiSensy's Partner API. Decided 9 Oct 2026: it is sent
-- through Meta's Cloud API from Sehatsandhi's second number (the one kept for
-- everything a clinic sends its patients), by the wa-broadcast-send edge
-- function. This migration is what that function stands on.
--
--   MORE TEMPLATES   a festival greeting, a new speciality, a new doctor with
--                    timings, and a plain message in the clinic's own words —
--                    which, like every broadcast, a person at Sehatsandhi
--                    reads before it goes (0155).
--   META'S NAME      wa_message_templates.meta_name / meta_language: the
--                    template as it is called in WhatsApp Manager. Unset, the
--                    code is the name and the language is English.
--   TERMS            the clinic's owner accepts the messaging terms once (and
--                    again when they change) before a broadcast can be made.
--                    Who, when and which version are kept.
--   A TEST           the owner can send the message to the clinic's own
--                    number before sending it to patients; it costs one
--                    message. A reviewer at Sehatsandhi can send one to any
--                    number, free.
--   THE SENDER       claims approved broadcasts, sends each patient the
--                    template, records what WhatsApp said, and gives back the
--                    price of every message that did not go — at once when
--                    WhatsApp refuses it, later when WhatsApp reports that it
--                    could not be delivered.
-- ============================================================================

-- ── Templates ───────────────────────────────────────────────────────────────
alter table wa_message_templates add column if not exists meta_name text;
alter table wa_message_templates add column if not exists meta_language text not null default 'en';

-- {{1}} is always the clinic's name, filled in by us (0116).
insert into wa_message_templates (code, name, category, body, placeholders, sort_order) values
  ('festival_greeting', 'Festival or occasion greeting', 'marketing',
   'Namaste from {{1}}. Wishing you and your family a very happy {{2}}. {{3}}',
   array['Clinic name','Occasion, e.g. "Diwali"','Your wishes, e.g. "May it bring you good health and joy."'], 60),
  ('new_speciality', 'New speciality at the clinic', 'marketing',
   'Namaste from {{1}}. We have added {{2}} at our clinic. {{3}} Reply here to know more or to book.',
   array['Clinic name','Speciality, e.g. "a skin (dermatology) OPD"','Details, e.g. "Open Monday to Saturday, 10 am to 1 pm."'], 70),
  ('new_doctor', 'New doctor and timings', 'marketing',
   'Namaste from {{1}}. {{2}} ({{3}}) has joined us and is available {{4}}. Reply here to book an appointment.',
   array['Clinic name','Doctor, e.g. "Dr. Anita Verma"','Speciality, e.g. "MD, skin specialist"','Timings, e.g. "Monday to Friday, 5 pm to 8 pm"'], 80),
  ('clinic_message', 'A message in your own words', 'marketing',
   'A message from {{1}}: {{2}} To book or to ask a question, reply here.',
   array['Clinic name','Your message — one paragraph. Sehatsandhi reads it before it goes out.'], 90)
on conflict (code) do nothing;

-- ── Terms ───────────────────────────────────────────────────────────────────
-- The words themselves live in the website (src/lib/waTerms.ts) with this
-- version beside them; changing the version there and here asks every clinic
-- to accept again.
alter table whatsapp_marketing_settings add column if not exists terms_version text not null default '2026-10-09';
alter table business_wa_accounts add column if not exists terms_version text;
alter table business_wa_accounts add column if not exists terms_accepted_at timestamptz;
alter table business_wa_accounts add column if not exists terms_accepted_by uuid;
alter table business_wa_accounts add column if not exists terms_accepted_label text;

create or replace function sehat_accept_wa_terms(p_business uuid, p_version text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_current text;
begin
  if not sehat_caller_is_owner(p_business) then
    raise exception 'Only the clinic''s owner can accept these terms.' using errcode = '42501';
  end if;
  select terms_version into v_current from whatsapp_marketing_settings where id;
  if p_version is distinct from v_current then
    raise exception 'These terms have changed. Reload the page and read them again.' using errcode = 'P0001';
  end if;
  update business_wa_accounts
     set terms_version = v_current, terms_accepted_at = now(), terms_accepted_by = auth.uid(),
         terms_accepted_label = coalesce((select email from auth.users where id = auth.uid()), 'owner')
   where business_id = p_business;
  if not found then raise exception 'Add WhatsApp to your plan first.' using errcode = 'P0001'; end if;
  return jsonb_build_object('terms_version', v_current, 'accepted_at', now());
end $$;
revoke all on function sehat_accept_wa_terms(uuid, text) from public, anon, authenticated;
grant execute on function sehat_accept_wa_terms(uuid, text) to authenticated;

-- May this clinic broadcast right now? As before (0116 → 0157), and the terms.
create or replace function sehat_wa_broadcast_blocker(p_business uuid)
returns text
language sql stable security definer set search_path = public as $$
  with s as (select * from whatsapp_marketing_settings where id),
       a as (select * from business_wa_accounts where business_id = p_business)
  select case
    when not (select sending_enabled from s)
      then 'Sending starts once WhatsApp is connected. Nothing has been charged.'
    when not exists (select 1 from a) or (select subscription_status from a) = 'inactive'
      then 'Add WhatsApp to your plan to send broadcasts.'
    when (select status from a) <> 'live'
      then 'Your WhatsApp number is not live yet.'
    when (select subscription_status from a) = 'paused'
      then 'WhatsApp is paused for this clinic.'
    when (select next_billing_date from a) is not null
         and (select next_billing_date from a) + (select grace_days from s) < current_date
      then 'Your WhatsApp add-on has ended. Renew your plan with WhatsApp to send broadcasts.'
    when (select subscription_status from a) = 'past_due'
         and (select past_due_since from a) + make_interval(days => (select grace_days from s)) <= now()
      then 'Your WhatsApp fee is unpaid, so broadcasts are paused until it is paid.'
    when (select terms_accepted_at from a) is null
         or (select terms_version from a) is distinct from (select terms_version from s)
      then 'Read and accept the WhatsApp messaging terms to send broadcasts.'
    else null
  end;
$$;

-- ── What the sender records ─────────────────────────────────────────────────
alter table wa_broadcast_recipients drop constraint if exists wa_broadcast_recipients_status_check;
alter table wa_broadcast_recipients add constraint wa_broadcast_recipients_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'refunded'));
alter table wa_broadcast_recipients add column if not exists wa_message_id text;
alter table wa_broadcast_recipients add column if not exists claimed_at timestamptz;
alter table wa_broadcast_recipients add column if not exists refunded_at timestamptz;
create index if not exists wa_broadcast_recipients_wa_id_idx on wa_broadcast_recipients (wa_message_id) where wa_message_id is not null;
create index if not exists wa_broadcast_recipients_queue_idx on wa_broadcast_recipients (broadcast_id) where status in ('queued', 'sending');

-- Give back the price of every failed message not yet given back. Called with
-- the broadcast row locked. Returns how many.
create or replace function sehat_wa_refund_failed(p_broadcast uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  b wa_broadcasts%rowtype;
  n integer;
  v_balance integer;
begin
  select * into b from wa_broadcasts where id = p_broadcast;
  with x as (
    update wa_broadcast_recipients set refunded_at = now()
     where broadcast_id = p_broadcast and status = 'failed' and refunded_at is null
    returning 1)
  select count(*) into n from x;
  if n = 0 then return 0; end if;

  select balance_paise into v_balance from business_wallets where business_id = b.business_id for update;
  update business_wallets set balance_paise = balance_paise + n * b.rate_paise, updated_at = now()
   where business_id = b.business_id;
  insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, broadcast_id, note, created_by)
  values (b.business_id, 'refund', n * b.rate_paise, coalesce(v_balance, 0) + n * b.rate_paise, b.id,
          n || ' not delivered', 'system');
  return n;
end $$;
revoke all on function sehat_wa_refund_failed(uuid) from public, anon, authenticated;

-- Where a broadcast stands once the sender has been through it. Does nothing
-- while anyone is still waiting to be sent to.
create or replace function sehat_finish_wa_broadcast(p_broadcast uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  b wa_broadcasts%rowtype;
  v_sent integer;
  v_failed integer;
  v_status text;
begin
  select * into b from wa_broadcasts where id = p_broadcast for update;
  if b.id is null or b.status not in ('queued', 'sending', 'sent', 'partly_sent', 'failed') then return coalesce(b.status, 'missing'); end if;

  -- A send that began and never reported back: counted as not sent, so the
  -- clinic is not charged for a message nobody can vouch for.
  update wa_broadcast_recipients set status = 'failed', error = 'no answer from WhatsApp'
   where broadcast_id = p_broadcast and status = 'sending' and claimed_at < now() - interval '15 minutes';

  if exists (select 1 from wa_broadcast_recipients where broadcast_id = p_broadcast and status in ('queued', 'sending')) then
    return 'sending';
  end if;

  perform sehat_wa_refund_failed(p_broadcast);
  select count(*) filter (where status = 'sent'), count(*) filter (where status = 'failed')
    into v_sent, v_failed from wa_broadcast_recipients where broadcast_id = p_broadcast;
  v_status := case when v_sent = 0 then 'failed' when v_failed > 0 then 'partly_sent' else 'sent' end;
  update wa_broadcasts set status = v_status where id = p_broadcast;
  return v_status;
end $$;
revoke all on function sehat_finish_wa_broadcast(uuid) from public, anon, authenticated;
grant execute on function sehat_finish_wa_broadcast(uuid) to service_role;

-- WhatsApp accepted the message and later reported it could not deliver it
-- (the number is not on WhatsApp, the patient blocked us, Meta's own limit on
-- promotions to one person). The webhook calls this with Meta's message id.
create or replace function sehat_wa_delivery_failed(p_wa_message_id text, p_error text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r wa_broadcast_recipients%rowtype;
begin
  select * into r from wa_broadcast_recipients where wa_message_id = p_wa_message_id;
  if r.id is null or r.status <> 'sent' then return false; end if;
  perform 1 from wa_broadcasts where id = r.broadcast_id for update;
  update wa_broadcast_recipients set status = 'failed', error = left(coalesce(p_error, 'not delivered'), 300) where id = r.id;
  perform sehat_finish_wa_broadcast(r.broadcast_id);
  return true;
end $$;
revoke all on function sehat_wa_delivery_failed(text, text) from public, anon, authenticated;
grant execute on function sehat_wa_delivery_failed(text, text) to service_role;

-- ── A test before it goes to patients ───────────────────────────────────────
-- Checks who is asking, takes the price of one message from the wallet when
-- it is the clinic, and answers with exactly what to send. The edge function
-- sends it and, if WhatsApp refuses, gives the money back (0217's refund).
--
-- The owner's test goes to the clinic's own registered number and nowhere
-- else: a "test" to any number would be a way to message people who never
-- agreed, around the review. A reviewer at Sehatsandhi may name the number.
create or replace function sehat_wa_test_prepare(p_business uuid, p_template uuid, p_params text[], p_phone text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_staff boolean := sehat_is_staff();
  v_tpl wa_message_templates;
  v_biz businesses;
  v_phone text;
  v_block text;
  v_rate integer;
  v_balance integer;
  v_tx uuid;
  v_today integer;
begin
  if not (v_staff or sehat_caller_is_owner(p_business)) then
    raise exception 'Only the clinic''s owner can send a test.' using errcode = '42501';
  end if;
  select * into v_tpl from wa_message_templates where id = p_template;
  if v_tpl.id is null or not v_tpl.is_active or not v_tpl.approved then
    raise exception 'That message is not available yet.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_params, 1), 0) <> greatest(cardinality(v_tpl.placeholders) - 1, 0)
     or exists (select 1 from unnest(p_params) x where btrim(x) = '') then
    raise exception 'Fill in every blank in the message.' using errcode = 'P0001';
  end if;
  select * into v_biz from businesses where id = p_business;

  if v_staff then
    v_phone := sehat_norm_phone(coalesce(p_phone, ''));
  else
    v_phone := sehat_norm_phone(coalesce(v_biz.phone, ''));
    v_block := sehat_wa_addon_blocker(p_business);
    if v_block is not null then raise exception '%', v_block using errcode = 'P0001'; end if;
  end if;
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception '%', case when v_staff then 'Enter a 10-digit mobile number for the test.'
                              else 'Your clinic has no mobile number on its profile to send the test to.' end using errcode = 'P0001';
  end if;

  if not v_staff then
    select count(*) into v_today from business_wallet_transactions
     where business_id = p_business and type = 'message_send' and broadcast_id is null
       and note like 'Test: %' and created_at > now() - interval '24 hours';
    if v_today >= 10 then raise exception 'That is enough tests for today.' using errcode = 'P0001'; end if;

    select per_message_paise into v_rate from whatsapp_marketing_settings where id;
    insert into business_wallets (business_id) values (p_business) on conflict do nothing;
    select balance_paise into v_balance from business_wallets where business_id = p_business for update;
    if v_balance < v_rate then
      raise exception 'A test costs ₹%, and the wallet has ₹%. Top up to send it.',
        to_char(v_rate / 100.0, 'FM999990.00'), to_char(v_balance / 100.0, 'FM999990.00') using errcode = 'P0001';
    end if;
    update business_wallets set balance_paise = balance_paise - v_rate, updated_at = now() where business_id = p_business;
    insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, note, created_by)
    values (p_business, 'message_send', -v_rate, v_balance - v_rate, 'Test: ' || v_tpl.name, auth.uid()::text)
    returning id into v_tx;
  end if;

  return jsonb_build_object(
    'to', '91' || v_phone,
    'meta_name', coalesce(v_tpl.meta_name, v_tpl.code), 'meta_language', v_tpl.meta_language,
    'params', to_jsonb(array[v_biz.name] || coalesce(p_params, '{}')),
    'tx', v_tx, 'charged_paise', coalesce(v_rate, 0));
end $$;
revoke all on function sehat_wa_test_prepare(uuid, uuid, text[], text) from public, anon, authenticated;
grant execute on function sehat_wa_test_prepare(uuid, uuid, text[], text) to authenticated;

-- The reviewer's test of a broadcast that is waiting: the message exactly as
-- the clinic wrote it, to a number the reviewer names.
create or replace function sehat_wa_test_for_review(p_broadcast uuid, p_phone text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b wa_broadcasts%rowtype;
begin
  if not sehat_is_staff() then raise exception 'Admins and managers only.' using errcode = '42501'; end if;
  select * into b from wa_broadcasts where id = p_broadcast;
  if b.id is null then raise exception 'Not found.' using errcode = 'P0002'; end if;
  return sehat_wa_test_prepare(b.business_id, b.template_id, b.params, p_phone);
end $$;
revoke all on function sehat_wa_test_for_review(uuid, text) from public, anon, authenticated;
grant execute on function sehat_wa_test_for_review(uuid, text) to authenticated;

-- ── The sender runs every minute ────────────────────────────────────────────
-- As 0075 does for appointment messages: pg_cron calls the edge function with
-- the service role key from the Vault. Skipped where either is not there.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'send-wa-broadcasts';
  perform cron.schedule(
    'send-wa-broadcasts',
    '* * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/wa-broadcast-send',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
     where exists (select 1 from wa_broadcasts where status in ('queued', 'sending'))
    $job$
  );
end $$;

notify pgrst, 'reload schema';
