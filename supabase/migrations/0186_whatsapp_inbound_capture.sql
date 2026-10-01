-- ============================================================================
-- Sehatsandhi — every WhatsApp message to the bot is saved as a contact
--
-- Run AFTER 0185. Safe to re-run.
--
-- Decided 1 Oct 2026: someone who writes "Hi" and leaves without booking was
-- lost — AiSensy does not keep them for us, and the flow's five API nodes are
-- all in use. AiSensy's project webhook (separate from the flow) now forwards
-- every incoming message to the whatsapp-inbound edge function, which calls
-- 0005's sehat_wa_handle_inbound: the number and WhatsApp name are saved
-- (patients + wa_contacts: first/last message, count), an existing patient is
-- matched not duplicated, and an opted-out number is never re-enrolled.
--
-- Saving a contact is NOT marketing consent (see 0005): they wrote to us, so
-- we may reply within 24 hours; business-initiated messages after that need
-- their consent (QR opt-in 0141, START 0173) and an approved template.
--
--   wa_inbound_log — what the webhook received, kept 7 days, so the payload
--                    shape can be checked and a failure traced. Service only.
-- ============================================================================

create table if not exists wa_inbound_log (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  phone text,
  ok boolean not null default false,
  note text,
  payload jsonb
);
create index if not exists wa_inbound_log_received_idx on wa_inbound_log (received_at desc);
alter table wa_inbound_log enable row level security;
revoke all on wa_inbound_log from anon, authenticated;

create or replace function sehat_purge_wa_inbound_log()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from wa_inbound_log where received_at < now() - interval '7 days' returning 1)
  select count(*)::integer from d;
$$;
revoke all on function sehat_purge_wa_inbound_log() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-wa-inbound-log';
  perform cron.schedule('purge-wa-inbound-log', '17 3 * * *', 'select public.sehat_purge_wa_inbound_log()');
end $$;

notify pgrst, 'reload schema';
