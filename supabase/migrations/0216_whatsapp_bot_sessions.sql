-- ============================================================================
-- 0216 — The WhatsApp bot runs in our own code
-- ============================================================================
-- AFTER 0215. Safe to re-run.
--
-- Decided 9 Oct 2026: the conversation leaves AiSensy's flow builder. Meta's
-- Cloud API posts each message to the whatsapp-inbound edge function, which
-- now also answers it (supabase/functions/_shared/bot.ts) by calling the same
-- bot_*_json functions the AiSensy flow called. The flow builder remembered
-- where each patient was in the conversation; this table does that now.
--
--   wa_bot_sessions — one row per phone: the step they are on and what they
--                     have answered so far (speciality, PIN, pick, slot,
--                     name and age). Service only. A conversation idle for an
--                     hour starts again from the menu; rows untouched for 7
--                     days are deleted.
-- ============================================================================

create table if not exists wa_bot_sessions (
  phone text primary key,                  -- digits with country code, as Meta sends it
  state text not null default 'idle',
  vars jsonb not null default '{}',
  last_message_id text,                    -- Meta redelivers a webhook it thinks we missed
  updated_at timestamptz not null default now()
);
create index if not exists wa_bot_sessions_updated_idx on wa_bot_sessions (updated_at);
alter table wa_bot_sessions enable row level security;
revoke all on wa_bot_sessions from anon, authenticated;

create or replace function sehat_purge_wa_bot_sessions()
returns integer language sql security definer set search_path = public as $$
  with d as (delete from wa_bot_sessions where updated_at < now() - interval '7 days' returning 1)
  select count(*)::integer from d;
$$;
revoke all on function sehat_purge_wa_bot_sessions() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-wa-bot-sessions';
  perform cron.schedule('purge-wa-bot-sessions', '23 3 * * *', 'select public.sehat_purge_wa_bot_sessions()');
end $$;

-- The edge function calls these as the service role.
grant execute on function bot_generic_search_json(text, text, text) to service_role;
grant execute on function bot_available_slots_json(text, text, text, text) to service_role;
grant execute on function bot_check_slot_json(text, text, text, text, text) to service_role;
grant execute on function bot_book_appointment_json(text, text, text, text, text, text, text) to service_role;
grant execute on function bot_submit_insurance_lead_json(text, text) to service_role;

notify pgrst, 'reload schema';
