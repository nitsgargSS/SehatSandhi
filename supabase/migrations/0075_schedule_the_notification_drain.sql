-- ============================================================================
-- Sehatsandhi — actually send the appointment notifications
--
-- Run AFTER 0074. Safe to re-run: the job is unscheduled before it is scheduled.
--
-- ── WHAT HAS BEEN SITTING THERE ─────────────────────────────────────────────
-- 0008 built the outbox, the trigger that fills it, and the edge function that
-- drains it — and left the cron job as a comment for somebody to paste in. It
-- was never pasted. 0059 scheduled the two purges the same way and named this
-- one as the next to look at, in as many words: "if it has never run,
-- appointment notifications have never been delivered."
--
-- They have not. Measured on 2026-08-28: sandbox holds 9 rows at
-- status='pending', the oldest from 2026-08-27 15:18 UTC — one 'booked' for a
-- clinic and eight 'rescheduled' for a patient. Prod's outbox is empty only
-- because prod has never had an appointment.
--
-- ── WHY IT IS SAFE TO SCHEDULE NOW, WHICH 0059 WAS RIGHT TO DOUBT ───────────
-- 0059 declined to schedule this because it was written before the 0037 rename
-- and had never been checked against the schema that exists. That check is what
-- this migration is standing on, and it passes — appointment-notify reads and
-- writes only these, all of them present today:
--
--   notification_outbox   id, status, created_at, appointment_id, phone,
--                         event, recipient, payload, attempts, sent_channel,
--                         sent_at, last_error
--   message_log           phone, channel, provider, campaign, body_preview,
--                         status, error_detail, sent_at
--
-- and status='sending' is admitted by the table's own CHECK. The drain's query
-- — pending, oldest first, 50 at a time — is served by
-- notification_outbox_pending_idx, which is already a partial index on exactly
-- that predicate. Nothing here needed repairing first, which is not what the
-- other pre-rename crons will look like.
--
-- ── THE KEY IS NOT IN THIS FILE ─────────────────────────────────────────────
-- Same as 0059, for the same reason: pasting a service-role key into
-- cron.schedule puts it in cron.job.command in plain text. Resolved from Vault
-- at run time instead. `project_url` and `service_role_key` must exist or every
-- run fails — as the two purges are failing 25 times a day on both databases
-- right now. This migration warns and schedules anyway; a job that exists and
-- fails loudly is findable, and one that was never created is not.
-- ============================================================================


-- ── A drain that loses nothing when it is misconfigured ─────────────────────
--
-- The reason this needs to exist before the job does. appointment-notify marks
-- a row 'failed' when no provider is configured — last_error 'AISENSY env not
-- set' — and nothing ever looks at a failed row again. So scheduling the drain
-- before AISENSY_API_KEY and the MSG91 keys are set would quietly burn every
-- pending notification to a permanent failure on its first run. The row would
-- be gone, the patient untold, and the outbox would read empty and healthy.
--
-- Two states are recoverable and this returns both to 'pending':
--
--   'sending' claimed more than 15 minutes ago. The drain claims a row before
--   calling the provider so two overlapping runs cannot send twice; a crash
--   between claim and result leaves it claimed forever. Fifteen minutes is
--   three drain cycles — long enough that a slow provider is not mistaken for
--   a crash.
--
--   That test needs to know when the row was CLAIMED, and the table only
--   recorded when it was queued. Using created_at would requeue a row queued
--   twenty minutes ago and claimed ten seconds ago — handing a second drain the
--   row the first one is still sending, which is the exact double-send the
--   claim exists to prevent. So `claimed_at` is added below, stamped by a
--   trigger rather than by the edge function: appointment-notify already writes
--   status='sending' and does not need redeploying to get this right.
--
--   'failed' where the failure was ours, not the provider's. Matched on the
--   exact string the function emits when no channel is configured. A provider
--   that answered and refused is a real failure and stays failed; 'no phone
--   number' stays failed too, because retrying it will not find one.
--
-- Capped by attempts so nothing retries forever.

alter table notification_outbox add column if not exists claimed_at timestamptz;

comment on column notification_outbox.claimed_at is
  'When the drain claimed this row to send it. Stamped in 0075 by a trigger, so '
  'the edge function that sets status did not have to be redeployed to record it.';

create or replace function sehat_stamp_notification_claim()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Only on the transition INTO 'sending'. Re-stamping on every update would
  -- make a crashed row look freshly claimed each time anything touched it.
  if new.status = 'sending' and old.status is distinct from 'sending' then
    new.claimed_at := now();
  elsif new.status = 'pending' then
    -- Requeued, or queued again. It is not claimed by anybody.
    new.claimed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists notification_outbox_stamp_claim on notification_outbox;
create trigger notification_outbox_stamp_claim
  before update of status on notification_outbox
  for each row execute function sehat_stamp_notification_claim();

create or replace function sehat_requeue_stuck_notifications(
  p_max_attempts integer default 5
) returns integer
language sql
security definer
set search_path to 'public'
as $$
  with requeued as (
    update notification_outbox
       set status = 'pending', last_error = null
     where coalesce(attempts, 0) < p_max_attempts
       and (
         -- coalesce for the rows already sitting at 'sending' from before this
         -- migration existed: they have no claimed_at and are certainly stale.
         (status = 'sending'
          and coalesce(claimed_at, created_at) < now() - interval '15 minutes')
         or (status = 'failed' and last_error = 'AISENSY env not set')
       )
    returning 1
  )
  select count(*)::integer from requeued;
$$;

comment on function sehat_requeue_stuck_notifications is
  'Added in 0075. Returns notifications to pending when the failure was ours — a '
  'drain that crashed between claiming and sending, or a run with no messaging '
  'provider configured. A provider that answered and refused stays failed.';

revoke all on function sehat_requeue_stuck_notifications(integer) from public, anon, authenticated;
grant execute on function sehat_requeue_stuck_notifications(integer) to service_role;


-- ── The job ─────────────────────────────────────────────────────────────────

do $$
declare
  has_cron boolean;
  has_net  boolean;
  has_url  boolean;
  has_key  boolean;
begin
  select exists (select 1 from pg_extension where extname = 'pg_cron') into has_cron;
  select exists (select 1 from pg_extension where extname = 'pg_net')  into has_net;

  if not has_cron or not has_net then
    raise warning
      'pg_cron=% pg_net=% — the notification drain is NOT scheduled. Enable both '
      'under Database > Extensions, then re-run this migration.', has_cron, has_net;
    return;
  end if;

  begin
    select exists (select 1 from vault.decrypted_secrets where name = 'project_url')
      into has_url;
    select exists (select 1 from vault.decrypted_secrets where name = 'service_role_key')
      into has_key;
  exception when others then
    has_url := false; has_key := false;
  end;

  if not has_url or not has_key then
    raise warning
      'Vault secrets missing (project_url=% service_role_key=%) — the drain is '
      'scheduled but every run will fail until both exist, exactly as the two '
      'purges are failing now. Nothing is lost while that is true: the requeue '
      'in the same job returns the rows to pending.', has_url, has_key;
  end if;

  begin perform cron.unschedule('drain-appointment-notifications');
  exception when others then null; end;

  -- Every five minutes, which is 0008's own figure. It is a safety net rather
  -- than the delivery path — appointmentApi.ts calls the function directly
  -- after a change — so the interval sets the worst case for a notification
  -- whose immediate call failed, not the usual one.
  --
  -- The requeue runs first, in the same statement list, so a row that failed
  -- for want of configuration is back at 'pending' before the drain that might
  -- finally be able to send it looks for work.
  perform cron.schedule(
    'drain-appointment-notifications',
    '*/5 * * * *',
    $job$
    select sehat_requeue_stuck_notifications();
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/appointment-notify',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
    $job$
  );

  raise notice 'scheduled drain-appointment-notifications (every 5 minutes)';
end $$;


-- ── Seeing whether it ran ───────────────────────────────────────────────────
--
-- 0059's principle, applied to the job it declined to schedule: a cron that
-- fails silently is worse than none, because the outbox looks drained. The view
-- keeps its name — renaming it would break the admin screen reading it — but it
-- is no longer only about purges, which is what the comment now says.
--
-- Still SECURITY DEFINER and still admin-gated in its own WHERE, for the reason
-- 0074 gives: `authenticated` holds no grant in the cron schema, and granting
-- one to fix an admin screen hands every clinic the platform's job history.

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
                               'drain-appointment-notifications'::text])
    and sehat_is_admin()
  order by r.start_time desc;

comment on view purge_job_history is
  'Recent runs of our scheduled jobs. Named for the purges it was created for in '
  '0059; 0075 added the notification drain. SECURITY DEFINER deliberately — see '
  '0074''s closing note.';


-- ============================================================================
-- STILL UNSCHEDULED, AND NOT IN THIS FILE
--
--   0005  purge-wa-bodies        WhatsApp message body retention
--   0046  queue-rating-requests  the "how was your visit" prompt, 3h after a slot
--
--   Both are still comments, and both are pre-rename and unverified against the
--   current schema — which is the check this migration did for the drain before
--   scheduling it, and the reason 0059 held back. queue-rating-requests writes
--   INTO the outbox this job now drains, so it should be checked and scheduled
--   second, not first: scheduling it while the drain is failing would build a
--   backlog of prompts nobody can send.
--
--   And the thing this job cannot fix. The drain needs AISENSY_API_KEY,
--   AISENSY_APPOINTMENT_CAMPAIGN, MSG91_AUTHKEY, MSG91_SENDER_ID and
--   MSG91_APPOINTMENT_DLT_TEMPLATE set on the FUNCTION, not in Vault. Until
--   they are, every run requeues rather than sends, which is the correct
--   failure but is not delivery.
-- ============================================================================
