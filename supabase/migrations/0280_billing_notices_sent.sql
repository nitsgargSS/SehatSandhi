-- ============================================================================
-- 0280 — Billing notices are sent, not just queued
-- ============================================================================
-- Since 0083 the daily cron has queued renewal reminders and auto-debit
-- notices into billing_notifications, and 0279 adds the plan-change notice —
-- but nothing ever sent them. billing-notify now does: WhatsApp from our
-- number and an email, to the business's own phone and address.
--
--   claim: up to 25 due rows, pending (or failed fewer than 3 times), oldest
--     first, skipping any another run holds. A reminder whose date has passed,
--     or that sat unsent for more than 3 days, is marked skipped instead — the
--     first run must not send weeks of old reminders at once.
--   done: sent (with which channel went), failed (tried again next run, up to
--     3 times), or skipped.
-- Sent 9 am to 8 pm in India only (the schedule below), and only when there is
-- something to send. And only when the BILLING_NOTIFY_MODE secret says so:
-- unset = preview only (nothing sent, nothing marked); 'test:98xxxxxxxx,…' =
-- only to those numbers; 'live' = everyone.
-- ============================================================================

create or replace function sehat_billing_notices_claim(p_limit integer default 25, p_only_phones text[] default null)
returns setof billing_notifications
language plpgsql volatile security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- Too late to be useful.
  update billing_notifications set status = 'skipped', last_error = 'out of date before it could be sent'
   where status in ('pending', 'failed') and attempts < 3
     and kind in ('renewal_reminder', 'pre_debit_notice')
     and (term_end < v_today or created_at < now() - interval '3 days');
  -- Nothing would send these (nothing queues them yet either).
  update billing_notifications set status = 'skipped', last_error = 'no message for this kind yet'
   where status = 'pending' and kind in ('renewal_charged', 'renewal_failed');
  -- A run that died mid-send: its rows go back after 15 minutes.
  update billing_notifications set status = 'failed', last_error = coalesce(last_error, 'send interrupted')
   where status = 'sending' and claimed_at < now() - interval '15 minutes';

  return query
  update billing_notifications n set status = 'sending', claimed_at = now(), attempts = n.attempts + 1
   where n.id in (select id from billing_notifications
                   where (status = 'pending' or (status = 'failed' and attempts < 3))
                     -- Test mode: only rows for these numbers (last 10 digits).
                     and (p_only_phones is null or right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = any(p_only_phones))
                   order by created_at limit greatest(1, least(coalesce(p_limit, 25), 100))
                   for update skip locked)
  returning n.*;
end $$;
revoke all on function sehat_billing_notices_claim(integer, text[]) from public, anon, authenticated;
grant execute on function sehat_billing_notices_claim(integer, text[]) to service_role;

create or replace function sehat_billing_notice_done(p_id uuid, p_status text, p_whatsapp boolean, p_email boolean, p_error text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'bad status' using errcode = '22023'; end if;
  update billing_notifications
     set status = p_status,
         sent_whatsapp_at = case when p_whatsapp then now() else sent_whatsapp_at end,
         sent_email_at = case when p_email then now() else sent_email_at end,
         last_error = left(p_error, 300)
   where id = p_id;
end $$;
revoke all on function sehat_billing_notice_done(uuid, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function sehat_billing_notice_done(uuid, text, boolean, boolean, text) to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'billing-notify';
  -- Every 15 minutes, 03:30–14:45 UTC = 9:00–20:15 in India.
  perform cron.schedule('billing-notify', '*/15 3-14 * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/billing-notify',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb)
    where exists (select 1 from billing_notifications where status = 'pending' or (status = 'failed' and attempts < 3))
      and (now() at time zone 'Asia/Kolkata')::time between time '09:00' and time '20:15'
  $job$);
end $$;
