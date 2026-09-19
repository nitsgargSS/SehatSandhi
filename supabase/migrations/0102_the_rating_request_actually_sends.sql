-- ============================================================================
-- Sehatsandhi — the rating request sends, and the reply is captured
--
-- Run AFTER 0101. Safe to re-run.
--
-- ── WHY THIS IS SQL AND NOT THE EDGE FUNCTION ───────────────────────────────
-- 0046 built `sehat_queue_rating_requests` and left it unscheduled for a good
-- reason: nothing listened for the reply. 0075 scheduled the outbox drain and
-- named this as the job to check and schedule second. Both notes assumed the
-- send would go through `appointment-notify`. It cannot, for two measured
-- reasons:
--
--   1. The DEPLOYED appointment-notify is the 2026-07-27 build. `rating_request`
--      was added to its `messageFor` on 2026-08-19 (f1df02e). So the deployed
--      function has no branch for the event at all — a queued rating request
--      falls to `default:` and sends "Update on your appointment with … on …",
--      which is not a question and asks for nothing. Setting the function's
--      secrets would not fix that; only a redeploy would.
--
--   2. The redeploy is blocked. `SUPABASE_ACCESS_TOKEN` still 401s with
--      "JWT could not be decoded" (checked 2026-09-15 via
--      scripts/check-supabase-token.mjs), so `functions deploy` and
--      `secrets set` both fail from this machine.
--
-- The AiSensy key now lives in Vault, which SQL can read and an edge function
-- cannot. So the send happens here, in the one place that has both the key and
-- a working deploy path. This is the spec's own instinct; what follows differs
-- from that draft in that it is written against the schema that exists and does
-- not lose a message when a send fails.
--
-- ── WHY IT CANNOT COLLIDE WITH THE DRAIN THAT IS ALREADY RUNNING ────────────
-- `drain-appointment-notifications` selects `status = 'pending'` and takes every
-- event it finds. If a rating request ever sat at 'pending' it would send the
-- wrong text. So rating requests never use that status: they are queued at
-- 'pending_wa' and move to 'awaiting_provider', neither of which the drain
-- selects. The two senders share a table and never the same row.
--
-- `sehat_requeue_stuck_notifications` (0075) is the other way a row could reach
-- 'pending' behind our back. It matches `status='sending'` gone stale, or
-- `status='failed' and last_error='AISENSY env not set'`. Rating rows never take
-- the first status, and every failure written below is prefixed 'rating:' so it
-- can never equal the second string.
--
-- ── WHAT REMAINS MANUAL, AND WHY SENDING STARTS SWITCHED OFF ────────────────
-- Two things must exist in the AiSensy dashboard, and neither can be created or
-- verified from here:
--
--   • an approved Utility template with TWO body variables, {{1}} the patient's
--     name and {{2}} the doctor's or clinic's name;
--   • an API Campaign attached to it, whose name goes in
--     messaging_settings.rating_campaign (default 'rating_request');
--   • a flow branch that captures the 1-5 reply and POSTs it to
--     sehat_record_rating, with the SERVICE ROLE key — the same posture 0046
--     documents for bot_book_appointment.
--
-- Sending to a campaign that does not exist fails every message, and a run of
-- failures is charged against the WhatsApp number's quality rating. So
-- messaging_settings.rating_sending_enabled defaults to FALSE and both the queue
-- and the sender no-op until it is true. Turning it on is one statement, at the
-- foot of this file. Gating the QUEUE too is deliberate: queueing while sending
-- is off would build a backlog that all left at once on the day it was enabled,
-- which is the blast the 7-day bound exists to prevent.
-- ============================================================================


-- ============================================================================
-- 1. Two statuses the existing drain does not select, and somewhere to keep the
--    pg_net request id.
--
-- net.http_post is ASYNCHRONOUS: it returns a request id and the response lands
-- in net._http_response later, after this transaction commits. The spec's draft
-- treated it as synchronous and stamped the appointment as asked the moment the
-- call was enqueued — so a rejected send was recorded as a successful one and
-- never retried. Keeping the id is what makes the outcome knowable.
-- ============================================================================

alter table notification_outbox
  add column if not exists provider_request_id bigint;

comment on column notification_outbox.provider_request_id is
  'pg_net request id for a send issued from SQL, joined to net._http_response by '
  'sehat_reconcile_rating_requests. Null for anything the edge drain sent.';

alter table notification_outbox drop constraint if exists notification_outbox_status_check;
alter table notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending','sending','sent','failed','pending_wa','awaiting_provider'))
  not valid;

-- Not merged into notification_outbox_pending_idx: that one is partial on
-- ('pending','sending') and is what makes the edge drain's query cheap. Widening
-- it would make the drain scan rows it must never touch.
create index if not exists notification_outbox_rating_idx
  on notification_outbox (created_at)
  where status in ('pending_wa', 'awaiting_provider');

-- 0075 stamps claimed_at on the way into 'sending' so a crashed claim can be
-- told from a slow provider. The same question is asked below of
-- 'awaiting_provider', so the trigger has to know about it. The existing
-- branches are unchanged — the edge drain's behaviour must not move.
create or replace function sehat_stamp_notification_claim()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status in ('sending', 'awaiting_provider')
     and old.status is distinct from new.status then
    new.claimed_at := now();
  elsif new.status in ('pending', 'pending_wa') then
    new.claimed_at := null;
  end if;
  return new;
end $$;

comment on function sehat_stamp_notification_claim is
  'When the row was claimed to send. 0075 added it for the edge drain''s '
  '''sending''; 0102 extended it to ''awaiting_provider'', which is the SQL '
  'sender''s equivalent.';


-- ============================================================================
-- 2. Where the campaign name lives
--
-- The API KEY is in Vault and is read straight from there at run time. A
-- campaign name is not a secret and changing it should not need a migration, so
-- it sits in a table an admin can edit. Same singleton shape as
-- billing_settings.
-- ============================================================================

create table if not exists messaging_settings (
  id boolean primary key default true check (id),
  rating_campaign text not null default 'rating_request',
  rating_sending_enabled boolean not null default false,
  rating_delay_hours integer not null default 3 check (rating_delay_hours >= 1),
  rating_send_batch integer not null default 50 check (rating_send_batch between 1 and 500),
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into messaging_settings (id) values (true) on conflict (id) do nothing;

comment on table messaging_settings is
  'Outbound messaging configuration that is not secret. Added in 0102 for the '
  'rating request; the AiSensy API key is NOT here, it is in Vault as '
  'aisensy_api_key.';
comment on column messaging_settings.rating_campaign is
  'Must match an API Campaign that exists in AiSensy, attached to an approved '
  'two-variable template. A name that does not exist there fails every send.';
comment on column messaging_settings.rating_sending_enabled is
  'False until the AiSensy template, campaign and reply branch all exist. Gates '
  'the queue as well as the sender, so enabling it does not release a backlog.';
comment on column messaging_settings.rating_send_batch is
  'Ceiling per run. With the job at */10 this caps the first hour after enabling '
  'at six batches rather than one blast.';

alter table messaging_settings enable row level security;

drop policy if exists messaging_settings_admin_all on messaging_settings;
create policy messaging_settings_admin_all on messaging_settings
  using (sehat_is_admin()) with check (sehat_is_admin());

grant select, update on messaging_settings to authenticated;
grant all on messaging_settings to service_role;


-- ============================================================================
-- 3. Queue at 'pending_wa', and only when sending is on
--
-- Everything else about 0046's function is kept: the 7-day bound, the opt-out
-- check, the skip for anyone already rated or already asked, and the
-- coalesce(practitioner, business) name. Those were right and are verified
-- against today's columns.
-- ============================================================================

create or replace function sehat_queue_rating_requests(p_hours integer default null)
returns integer language plpgsql security definer
set search_path = public
as $$
declare
  n integer;
  v_enabled boolean;
  v_hours integer;
begin
  select rating_sending_enabled, coalesce(p_hours, rating_delay_hours)
    into v_enabled, v_hours
    from messaging_settings where id;

  if not coalesce(v_enabled, false) then
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
  'Queues one rating request per visit whose slot passed, skipping anyone already '
  'rated, already asked, or opted out, bounded to the last 7 days. 0102 changed '
  'two things: the row is queued at ''pending_wa'' so the edge drain cannot send '
  'it with the wrong text, and nothing is queued while '
  'messaging_settings.rating_sending_enabled is false. p_hours now defaults to '
  'the settings row rather than a hardcoded 3.';


-- ============================================================================
-- 4. The sender
--
-- Reads the key from Vault per run rather than caching it, so rotating the
-- secret takes effect on the next run with no redeploy and no migration.
--
-- On the key's exposure, honestly: net.http_post writes the request body into
-- net.http_request_queue, and the body carries apiKey. pg_net deletes the row
-- when the request completes. This is the same exposure 0075 already accepts for
-- service_role_key in an Authorization header, and it is inside the database
-- rather than in cron.job.command — which was the thing 0059 and 0075 were
-- protecting against, because cron.job is world-readable to anyone who can
-- reach the schema.
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

  -- Vault may be unreadable (absent extension, no grant); treat that exactly
  -- like a missing secret rather than failing the whole run.
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

    -- Not a retryable failure: a second attempt will not find a valid number.
    if v_phone is null then
      update notification_outbox
         set status = 'failed',
             attempts = coalesce(attempts, 0) + 1,
             last_error = 'rating: not a valid Indian mobile'
       where id = rec.id;
      continue;
    end if;

    -- Claim before calling, conditional on the status we read, so two
    -- overlapping runs cannot both send this row.
    update notification_outbox
       set status = 'awaiting_provider',
           attempts = coalesce(attempts, 0) + 1,
           last_error = null
     where id = rec.id and status = 'pending_wa';
    if not found then continue; end if;

    -- templateParams is POSITIONAL and must match the approved template:
    -- {{1}} patient name, {{2}} doctor or clinic name. Reordering these silently
    -- addresses the patient by the doctor's name.
    v_req := net.http_post(
      url := 'https://backend.aisensy.com/campaign/t1/api/v2',
      body := jsonb_build_object(
        'apiKey',         v_key,
        'campaignName',   v_campaign,
        'destination',    v_phone,
        'userName',       coalesce(rec.payload ->> 'patient_name', 'Patient'),
        'source',         'rating-cron',
        'templateParams', jsonb_build_array(
                            coalesce(rec.payload ->> 'patient_name', 'there'),
                            coalesce(rec.payload ->> 'doctor_name', 'the clinic'))
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
  'Posts queued rating requests to AiSensy, reading the key from Vault each run. '
  'Claims each row first so overlapping runs cannot double-send, and records the '
  'pg_net request id — the outcome is settled later by '
  'sehat_reconcile_rating_requests, because net.http_post is asynchronous.';


-- ============================================================================
-- 5. Settling the outcome
--
-- Without this a send is fire-and-forget and every failure is invisible. Three
-- cases: a response that arrived, a response that will never arrive, and one
-- still in flight.
--
-- pg_net keeps responses for a few hours and then deletes them, so "no row in
-- net._http_response" means either "not yet" or "gone". claimed_at separates
-- them: under 15 minutes is in flight, over is lost.
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
    select o.id, o.phone, o.attempts, o.claimed_at, o.provider_request_id
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
      -- Still in flight. Leave it; a later run will settle it.
      if coalesce(rec.claimed_at, now()) > now() - interval '15 minutes' then
        continue;
      end if;
      v_detail := 'rating: no provider response within 15 minutes';
      v_ok := false;
    elsif v_code between 200 and 299 then
      v_detail := null;
      v_ok := true;
    else
      -- Never store a body that contains the key. This is a positive
      -- containment check that defaults to withholding, not a redaction that
      -- can fall through to the original — see the 0102 note and the two leaks
      -- that taught it.
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
      -- Back to our own status, never to 'pending': that is the edge drain's
      -- queue and it would send the wrong message.
      update notification_outbox
         set status = 'pending_wa', last_error = v_detail, provider_request_id = null
       where id = rec.id;
    else
      update notification_outbox
         set status = 'failed', last_error = v_detail
       where id = rec.id;
    end if;

    -- One log row per settled attempt. body_preview describes the template
    -- rather than quoting it: the wording lives in AiSensy, not here.
    insert into message_log (phone, channel, provider, campaign, template_name,
                             body_preview, status, error_detail, queued_at, sent_at)
    values (rec.phone, 'whatsapp', 'aisensy', v_campaign, v_campaign,
            'rating request (2 params: patient name, doctor name)',
            case when v_ok then 'sent' else 'failed' end,
            v_detail, rec.claimed_at, case when v_ok then now() else null end);

    n := n + 1;
  end loop;

  return n;
end $$;

comment on function sehat_reconcile_rating_requests is
  'Turns an enqueued pg_net request into sent, retried or failed, and writes the '
  'message_log row. A retry goes back to ''pending_wa'' and never to ''pending'', '
  'which is the edge drain''s queue.';


-- ============================================================================
-- 6. Capturing the reply — the half that has never existed
--
-- Nothing in this repo has ever inserted into ratings. The table, its 1-5 check
-- and its UNIQUE(appointment_id) have been there since the 0001 baseline with no
-- writer, which is what made 0046 right to leave the request unscheduled.
--
-- Matching is by NORMALISED phone, not by hash. sehat_phone_hash hashes the raw
-- digits, so '9812345678' and '919812345678' hash differently — and AiSensy
-- sends the second form while a register import may hold the first. A hash
-- comparison would silently match nothing.
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
  v_biz   uuid;
  v_raw   text;
  v_id    uuid;
begin
  v_phone := sehat_normalise_phone(p_phone);
  if v_phone is null then
    raise exception 'not a valid Indian mobile number' using errcode = '22023';
  end if;

  if p_score is null or p_score < 1 or p_score > 5 then
    raise exception 'rating must be a whole number from 1 to 5' using errcode = '22023';
  end if;

  -- The most recent UNRATED visit this number was actually asked about. Joining
  -- to the outbox is what stops an arbitrary number rating an arbitrary clinic:
  -- no request, no rating. Bounded to requests sent in the last 14 days so a
  -- stray '5' cannot land on a visit from six months ago that was asked about
  -- once and never answered.
  select a.id, a.business_id, a.patient_phone
    into v_appt, v_biz, v_raw
    from appointments a
    join notification_outbox o
      on o.appointment_id = a.id and o.event = 'rating_request'
   where sehat_normalise_phone(a.patient_phone) = v_phone
     and a.business_id is not null
     and o.created_at > now() - interval '14 days'
     and not exists (select 1 from ratings r where r.appointment_id = a.id)
   order by a.slot_datetime desc
   limit 1;

  -- Nothing unrated. A patient who replies twice ('4', then '5') must not get an
  -- error the AiSensy flow would have to handle, so return what they already
  -- said rather than raising. UNIQUE(appointment_id) means there is at most one.
  if v_appt is null then
    select r.id into v_id
      from ratings r
      join appointments a on a.id = r.appointment_id
      join notification_outbox o
        on o.appointment_id = a.id and o.event = 'rating_request'
     where sehat_normalise_phone(a.patient_phone) = v_phone
       and o.created_at > now() - interval '14 days'
     order by a.slot_datetime desc
     limit 1;

    if v_id is not null then
      return v_id;                       -- already rated; the reply is a no-op
    end if;

    raise exception 'no rating request is open for this number'
      using errcode = 'P0002';
  end if;

  insert into ratings (appointment_id, business_id, patient_phone_hash,
                       overall_rating, review_text)
  values (v_appt, v_biz, sehat_phone_hash(v_raw), p_score,
          nullif(btrim(coalesce(p_review, '')), ''))
  returning id into v_id;

  return v_id;
end $$;

comment on function sehat_record_rating is
  'Records a patient''s 1-5 reply against the most recent visit that number was '
  'asked about. Added in 0102 — nothing had ever written to ratings. Idempotent: '
  'a second reply returns the first rating''s id. Service role only; the AiSensy '
  'node must use the service key, as the booking node already does.';


-- ============================================================================
-- 7. Closing the hole the capture path replaces
--
-- `allow_insert_ratings` is `FOR INSERT WITH CHECK (true)` and anon holds the
-- INSERT grant, so anyone with the anon key that ships in the website bundle can
-- post a review for any business, as many times as they like, and is_visible
-- defaults to true so it renders publicly at once.
--
-- 0068 counted ratings among the eight genuine anonymous-write paths and kept
-- the grant deliberately. That was reasonable when a web review form looked
-- likely; measured today it is not used by anything. src/pages/doctor/Profile.tsx
-- only SELECTs, and no function in any migration inserts. The writer is now
-- sehat_record_rating, which is SECURITY DEFINER and so needs neither the policy
-- nor the grant. So this reverses 0068 on this one table, with the reason
-- recorded rather than left to be re-derived.
--
-- Both grants have to go: Postgres grants to PUBLIC and Supabase's ALTER DEFAULT
-- PRIVILEGES grants anon explicitly, and revoking either alone leaves the other.
-- ============================================================================

drop policy if exists allow_insert_ratings on ratings;

revoke insert on ratings from public, anon, authenticated;

comment on table ratings is
  'Patient reviews. Written ONLY by sehat_record_rating since 0102 — the '
  'anon-insert policy and grant that let anyone with the published key post a '
  'review were removed there. UNIQUE(appointment_id) caps it at one per visit.';


-- ============================================================================
-- 8. Who may call what
-- ============================================================================

-- The cron job runs as the database owner and needs no grant. Nobody else has
-- any business triggering a send.
revoke all on function sehat_queue_rating_requests(integer)        from public, anon, authenticated;
revoke all on function sehat_send_rating_requests()                from public, anon, authenticated;
revoke all on function sehat_reconcile_rating_requests(integer)    from public, anon, authenticated;
revoke all on function sehat_record_rating(text, integer, text)    from public, anon, authenticated;

-- AiSensy's reply branch posts as the service role, the same as the booking
-- node. Not anon: an anon-callable version would let anyone with the website's
-- key rate any clinic that had been asked, which is the hole section 7 closes.
grant execute on function sehat_record_rating(text, integer, text) to service_role;
grant execute on function sehat_send_rating_requests()             to service_role;
grant execute on function sehat_reconcile_rating_requests(integer) to service_role;


-- ============================================================================
-- 9. The job
--
-- One job, three statements, in this order: settle what is outstanding, queue
-- what is due, send what is queued. Reconciling first means a row that failed
-- last round is back at 'pending_wa' before the sender looks for work.
--
-- Every ten minutes. The delay that matters is rating_delay_hours (3), so the
-- interval only decides how long a settled response waits to be recorded.
-- ============================================================================

do $$
declare
  has_cron boolean;
  has_net  boolean;
  has_key  boolean;
  is_on    boolean;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into has_cron;
  select exists (select 1 from pg_extension where extname = 'pg_net')  into has_net;

  if not has_cron or not has_net then
    raise warning
      'pg_cron=% pg_net=% — the rating job is NOT scheduled. Enable both under '
      'Database > Extensions, then re-run this migration.', has_cron, has_net;
    return;
  end if;

  begin
    select exists (select 1 from vault.decrypted_secrets where name = 'aisensy_api_key')
      into has_key;
  exception when others then
    has_key := false;
  end;

  select rating_sending_enabled into is_on from messaging_settings where id;

  if not has_key then
    raise warning
      'aisensy_api_key is NOT in this database''s Vault. The job is scheduled and '
      'will no-op rather than fail: nothing is queued and nothing is sent. Add it '
      'with vault.create_secret in THIS project, not the other one.';
  end if;

  if not coalesce(is_on, false) then
    raise notice
      'rating sending is OFF (messaging_settings.rating_sending_enabled = false). '
      'The job is scheduled and will do nothing until the AiSensy template, '
      'campaign and reply branch exist and the flag is set true.';
  end if;

  begin perform cron.unschedule('rating-requests');
  exception when others then null; end;

  perform cron.schedule(
    'rating-requests',
    '*/10 * * * *',
    $job$
    select sehat_reconcile_rating_requests();
    select sehat_queue_rating_requests();
    select sehat_send_rating_requests();
    $job$
  );

  raise notice 'scheduled rating-requests (every 10 minutes)';
end $$;


-- The job history view is how anyone sees whether this ran. Same name, one more
-- job in the list — renaming it would break the admin screen reading it.
create or replace view purge_job_history as
 select j.jobname,
    r.status,
    r.return_message,
    r.start_time,
    r.end_time
   from cron.job j
     join cron.job_run_details r on r.jobid = j.jobid
  where j.jobname = any (array['purge-patient-documents'::text,
                               'purge-consultation-audio'::text,
                               'drain-appointment-notifications'::text,
                               'queue-billing-notices'::text,
                               'rating-requests'::text])
    and sehat_is_admin()
  order by r.start_time desc;

comment on view purge_job_history is
  'Recent runs of our scheduled jobs. Named for the purges it was created for in '
  '0059; 0075 added the notification drain, 0102 the rating job and the billing '
  'notices. SECURITY DEFINER deliberately — see 0074''s closing note.';


-- ============================================================================
-- TURNING IT ON — after the AiSensy side exists, not before
--
--   update messaging_settings
--      set rating_campaign = 'rating_request',   -- the API Campaign's exact name
--          rating_sending_enabled = true,
--          updated_by = 'nitin', updated_at = now()
--    where id;
--
-- VERIFYING
--
--   -- the job, and its last few runs
--   select jobname, schedule, active from cron.job where jobname = 'rating-requests';
--   select * from purge_job_history where jobname = 'rating-requests' limit 5;
--
--   -- the secret is present and readable, WITHOUT printing it
--   select name, length(decrypted_secret) as value_length
--     from vault.decrypted_secrets where name = 'aisensy_api_key';
--
--   -- where the rating requests are
--   select status, count(*), max(last_error) as an_error
--     from notification_outbox where event = 'rating_request' group by status;
--
--   -- end to end, once a real request has gone out
--   select sehat_record_rating('919812345678', 5, 'Good doctor');
--
-- WHAT THIS STILL DOES NOT DO
--
-- The other outbox events — booked, cancelled, rescheduled, confirmed — are
-- still the edge function's, and it is still the stale 27 July build with no
-- secrets set. Sandbox has 11 'rescheduled' rows at 'pending' that nobody will
-- ever receive. That needs a working SUPABASE_ACCESS_TOKEN: redeploy
-- appointment-notify, then set AISENSY_API_KEY and AISENSY_APPOINTMENT_CAMPAIGN
-- on the FUNCTION. A Vault secret does not reach an edge function.
--
-- When that happens, this file's sender can be retired in favour of the
-- function — queue at 'pending' instead of 'pending_wa' and drop the job. It is
-- deliberately one word of change, because the SQL sender exists to work around
-- a dead token rather than because SQL is the right place to render a message.
-- ============================================================================
