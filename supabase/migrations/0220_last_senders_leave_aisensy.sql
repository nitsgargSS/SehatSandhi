-- ============================================================================
-- 0220 — The last two senders can leave AiSensy
-- ============================================================================
-- AFTER 0219. Safe to re-run.
--
-- Two kinds of message are sent by the database itself, not by an edge
-- function: the rating request three hours after a visit (0102, 0164) and a
-- pharmacy's medicine-order messages (0189). Both posted straight to AiSensy
-- with the key from the Vault, so they were the last thing holding AiSensy in
-- place. They can now go through Meta's Cloud API instead:
--
--   messaging_settings.provider   'aisensy' (as before, the default) or 'meta'.
--                                 One switch for both, so they move together.
--   messaging_settings.meta_language   the language the two templates were
--                                 approved in. Both texts are Hindi: 'hi'.
--
-- With 'meta', the database needs three secrets in its Vault — put there by
-- hand, like aisensy_api_key was (never in a migration):
--
--   meta_access_token            the system user's token
--   meta_phone_number_id         the main number: rating requests go from it
--   meta_clinic_phone_number_id  the number kept for businesses: order
--                                messages go from it (the main one if unset)
--
-- THE TEMPLATES (docs/whatsapp-templates.md)
--   rating_request  three blanks — who, the doctor, the day — where AiSensy's
--                   took the whole sentence as one. Meta approves a sentence
--                   with blanks in it far more readily than a blank that is
--                   the sentence. messaging_settings.rating_campaign names it.
--   order_update    one blank, the pharmacy's message, as before.
--                   messaging_settings.order_campaign names it.
--
-- Nothing changes until provider is set to 'meta'. What a sent request waits
-- on is unchanged too: net.http_post answers later, and the reconcile reads a
-- 2xx as sent — which is Meta's answer as well as AiSensy's.
-- ============================================================================

alter table messaging_settings add column if not exists provider text not null default 'aisensy';
alter table messaging_settings drop constraint if exists messaging_settings_provider_check;
alter table messaging_settings add constraint messaging_settings_provider_check check (provider in ('aisensy', 'meta'));
alter table messaging_settings add column if not exists meta_language text not null default 'hi';

-- Are Meta's secrets in the Vault?
create or replace function sehat_meta_ready()
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return (select count(*) = 2 from vault.decrypted_secrets
           where name in ('meta_access_token', 'meta_phone_number_id') and coalesce(decrypted_secret, '') <> '');
exception when others then
  return false;
end $$;
revoke all on function sehat_meta_ready() from public, anon, authenticated;

-- One template message to Meta. Returns pg_net's request id (the answer comes
-- later, in net._http_response), or null when Meta is not set up.
-- Meta refuses a blank holding a line break or a run of spaces, so each is
-- flattened to one line.
create or replace function sehat_meta_template_post(p_template text, p_language text, p_to text, p_params text[], p_clinic boolean default false)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_from text;
  v_params jsonb;
begin
  begin
    select decrypted_secret into v_token from vault.decrypted_secrets where name = 'meta_access_token';
    if p_clinic then
      select decrypted_secret into v_from from vault.decrypted_secrets where name = 'meta_clinic_phone_number_id';
    end if;
    if coalesce(v_from, '') = '' then
      select decrypted_secret into v_from from vault.decrypted_secrets where name = 'meta_phone_number_id';
    end if;
  exception when others then
    return null;
  end;
  if coalesce(v_token, '') = '' or coalesce(v_from, '') = '' then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('type', 'text',
           'text', left(btrim(regexp_replace(coalesce(x, ''), '\s+', ' ', 'g')), 1000)) order by ord), '[]'::jsonb)
    into v_params from unnest(p_params) with ordinality t(x, ord);

  return net.http_post(
    url := 'https://graph.facebook.com/v25.0/' || v_from || '/messages',
    body := jsonb_build_object(
      'messaging_product', 'whatsapp', 'to', p_to, 'type', 'template',
      'template', jsonb_build_object(
        'name', p_template, 'language', jsonb_build_object('code', coalesce(nullif(p_language, ''), 'hi')),
        'components', jsonb_build_array(jsonb_build_object('type', 'body', 'parameters', v_params)))),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
    timeout_milliseconds := 10000);
end $$;
revoke all on function sehat_meta_template_post(text, text, text, text[], boolean) from public, anon, authenticated;

-- The rating request's three blanks, from what sehat_rating_request_text
-- makes its one sentence of: who, the doctor, the day (day and month only —
-- see that function for why the weekday is left out).
create or replace function sehat_rating_request_params(p_payload jsonb)
returns text[]
language sql stable set search_path = public as $$
  select array[
    coalesce(nullif(btrim(p_payload ->> 'patient_name'), ''), 'जी'),
    coalesce(nullif(btrim(p_payload ->> 'doctor_name'), ''), 'डॉक्टर'),
    coalesce(extract(day from ((p_payload ->> 'new_slot')::timestamptz at time zone 'Asia/Kolkata'))::int
             || ' ' || bot_hi_month(extract(month from ((p_payload ->> 'new_slot')::timestamptz at time zone 'Asia/Kolkata'))::int), 'हाल')
  ];
$$;
revoke all on function sehat_rating_request_params(jsonb) from public, anon, authenticated;

-- ── The rating request (0164's, with the choice of provider) ────────────────
create or replace function sehat_send_rating_requests()
returns integer
language plpgsql security definer set search_path = public as $function$
declare
  rec       record;
  v_key     text;
  v_campaign text;
  v_enabled boolean;
  v_batch   integer;
  v_phone   text;
  v_req     bigint;
  v_provider text;
  v_lang    text;
  n         integer := 0;
begin
  select rating_sending_enabled, rating_campaign, rating_send_batch, provider, meta_language
    into v_enabled, v_campaign, v_batch, v_provider, v_lang
    from messaging_settings where id;

  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  if v_provider = 'meta' then
    if not sehat_meta_ready() then
      raise warning 'meta_access_token / meta_phone_number_id are not in this database''s Vault — no rating '
                    'request sent. Rows stay at pending_wa and lose nothing.';
      return 0;
    end if;
  else
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'aisensy_api_key';
  exception when others then
    v_key := null;
  end;
  end if;

  if v_provider <> 'meta' and coalesce(v_key, '') = '' then
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

    if v_provider = 'meta' then
      -- The rating_request template's three blanks: who, with whom, which day.
      v_req := sehat_meta_template_post(v_campaign, v_lang, v_phone, sehat_rating_request_params(rec.payload));
    else
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
    end if;

    update notification_outbox set provider_request_id = v_req where id = rec.id;
    n := n + 1;
  end loop;

  return n;
end $function$;

-- ── Medicine-order messages (0189's, with the choice of provider) ───────────
create or replace function sehat_send_order_messages()
returns integer
language plpgsql security definer set search_path = public as $function$
declare rec record; v_key text; v_campaign text; v_phone text; v_req bigint; n integer := 0; v_provider text; v_lang text; v_order text;
begin
  select coalesce(order_campaign, rating_campaign), provider, meta_language, order_campaign into v_campaign, v_provider, v_lang, v_order
    from messaging_settings where order_sending_enabled limit 1;
  if v_campaign is null then return 0; end if;
  if v_provider = 'meta' and not sehat_meta_ready() then return 0; end if;
  begin select decrypted_secret into v_key from vault.decrypted_secrets where name = 'aisensy_api_key';
  exception when others then v_key := null; end;
  if v_provider <> 'meta' and coalesce(v_key, '') = '' then return 0; end if;
  for rec in select id, phone, payload from notification_outbox
              where event = 'medicine_order' and status = 'pending_wa' order by created_at limit 50 for update skip locked loop
    v_phone := sehat_normalise_phone(rec.phone);
    if v_phone is null then
      update notification_outbox set status = 'failed', last_error = 'not a valid Indian mobile' where id = rec.id; continue;
    end if;
    if v_provider = 'meta' then
      -- A pharmacy writing to its customer: from the number kept for businesses.
      v_req := sehat_meta_template_post(coalesce(v_order, 'order_update'), v_lang, v_phone, array[rec.payload ->> 'text'], true);
    else
    v_req := net.http_post(
      url := 'https://backend.aisensy.com/campaign/t1/api/v2',
      body := jsonb_build_object('apiKey', v_key, 'campaignName', v_campaign, 'destination', v_phone,
        'userName', coalesce(rec.payload ->> 'patient_name', 'Patient'), 'source', 'medicine-order',
        'templateParams', jsonb_build_array(rec.payload ->> 'text')),
      headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 10000);
    end if;
    update notification_outbox set status = 'sent', sent_channel = 'whatsapp', sent_at = now(),
           attempts = coalesce(attempts, 0) + 1, provider_request_id = v_req where id = rec.id;
    n := n + 1;
  end loop;
  return n;
end $function$;

-- ── The reconcile logs who carried it ───────────────────────────────────────
create or replace function sehat_reconcile_rating_requests(p_max_attempts integer DEFAULT 5)
returns integer
language plpgsql security definer set search_path = public as $function$
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
    values (rec.phone, 'whatsapp', coalesce((select provider from messaging_settings where id), 'aisensy'), 'rating_request', v_campaign,
            left(sehat_rating_request_text(rec.payload), 160),
            case when v_ok then 'sent' else 'failed' end,
            v_detail, rec.claimed_at, case when v_ok then now() else null end);

    n := n + 1;
  end loop;

  return n;
end $function$;

notify pgrst, 'reload schema';
