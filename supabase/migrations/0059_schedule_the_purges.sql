-- ============================================================================
-- Sehatsandhi — actually schedule the two purges
--
-- Run AFTER 0058, and only once the edge functions are deployed. Safe to
-- re-run: every job is unscheduled before it is scheduled.
--
-- ── WHY THIS IS A MIGRATION AND NOT ANOTHER COMMENT ─────────────────────────
-- 0005, 0008, 0046 and 0052 each end with a cron job written out as a comment
-- for somebody to paste in by hand. Four of them. None has ever been scheduled,
-- which is the entirely predictable outcome of that convention, and in 0052's
-- case it now matters: since audio is deleted at transcription time, that
-- sweeper is the ONLY thing that removes audio from a transcription that
-- failed. Unscheduled, it sits for seven days.
--
-- ── AND WHY THE KEY IS NOT IN THIS FILE ─────────────────────────────────────
-- The pasted-comment convention also requires putting the service-role key into
-- SQL. That key then lives in cron.job.command in plain text, readable by
-- anything that can select from it, and usually in a shell history and a notes
-- file too. A production database password has already reached a transcript
-- once in this project's history; this is the same shape of mistake waiting to
-- happen, so the jobs below resolve the key from Vault AT RUN TIME. Nothing
-- secret is stored in this file, in git, or in the cron table.
--
-- ── BEFORE THIS WORKS ───────────────────────────────────────────────────────
-- Two Vault secrets must exist. Create them in the dashboard (Settings →
-- Vault), or in SQL — from a session whose history you are willing to lose:
--
--     select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--     select vault.create_secret('<service-role-key>',        'service_role_key');
--
-- This migration does not create them, because doing so would mean this file
-- containing the value.
-- ============================================================================


-- ============================================================================
-- 1. Is any of this available?
--
-- pg_cron and pg_net are extensions a project may not have enabled. Failing
-- the whole migration over that would block everything behind it, so this
-- warns and does nothing instead — and the warning says exactly what to do.
-- ============================================================================

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
      'pg_cron=% pg_net=% — the purges are NOT scheduled. Enable both under '
      'Database > Extensions, then re-run this migration.', has_cron, has_net;
    return;
  end if;

  -- Present but unreadable is the same as absent for our purposes, and the
  -- vault schema may not exist at all on an older project.
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
      'Vault secrets missing (project_url=% service_role_key=%) — the jobs are '
      'scheduled but every run will fail until both exist. See this file''s header.',
      has_url, has_key;
  end if;

  -- ── The jobs ──
  -- Unschedule first so this migration is idempotent. cron.unschedule throws
  -- when the job is not there, which on a first run is the normal case.

  -- Documents. Daily, not hourly: retention is measured in years and a
  -- document a few hours past its date is not an incident. 21:30 UTC is 03:00
  -- IST — nobody is uploading, and a clinic that opens at 8 sees a settled
  -- state rather than files disappearing under them.
  begin perform cron.unschedule('purge-patient-documents');
  exception when others then null; end;

  perform cron.schedule(
    'purge-patient-documents',
    '30 21 * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/purge-documents',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
    $job$
  );

  -- Consultation audio. Hourly, because this one is about exposure rather than
  -- tidiness: it catches audio from a FAILED transcription, which is kept on
  -- purpose so it can be retried. An hour is a retry window; a day is a
  -- recording of a patient sitting in a bucket for a day.
  begin perform cron.unschedule('purge-consultation-audio');
  exception when others then null; end;

  perform cron.schedule(
    'purge-consultation-audio',
    '17 * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/transcribe-consultation',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{"action":"purge"}'::jsonb)
    $job$
  );

  raise notice 'scheduled purge-patient-documents (daily 03:00 IST) and purge-consultation-audio (hourly)';
end $$;


-- ============================================================================
-- 2. Seeing whether they actually ran
--
-- A cron job that fails silently is worse than no cron job, because the bucket
-- looks managed. cron.job_run_details is where the truth is; this view puts the
-- two purges' recent history in one place so it can be checked without knowing
-- the pg_cron schema.
-- ============================================================================

do $$
begin
  execute $v$
    create or replace view purge_job_history as
      select j.jobname, r.status, r.return_message,
             r.start_time, r.end_time
        from cron.job j
        join cron.job_run_details r on r.jobid = j.jobid
       where j.jobname in ('purge-patient-documents', 'purge-consultation-audio')
       order by r.start_time desc
  $v$;
  execute 'grant select on purge_job_history to authenticated';
exception when others then
  -- No pg_cron, or no rights on its tables. The jobs above will have warned.
  raise warning 'could not create purge_job_history — check cron.job_run_details by hand';
end $$;


-- ============================================================================
-- NOT HERE
--   The three other unscheduled crons this repo documents as comments:
--     0005  purge-wa-bodies              (message body retention)
--     0008  drain-appointment-notifications
--     0046  queue-rating-requests
--   All three are still unscheduled. 0008's is the one to look at first — if
--   it has never run, appointment notifications have never been delivered.
--   Left alone deliberately: they were written before the rename and none has
--   been verified against the current schema, and scheduling something
--   unverified to run every five minutes is not a thing to do in passing.
-- ============================================================================
