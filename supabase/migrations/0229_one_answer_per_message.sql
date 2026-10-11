-- ============================================================================
-- 0229 — One answer per message, however many times it arrives
-- ============================================================================
-- AFTER 0228. Safe to re-run.
--
-- 11 Oct 2026: with a number linked to two WhatsApp accounts, Meta delivered
-- each patient message twice within the same second — once through each — and
-- the bot answered both. Its guard compared the message id with the one saved
-- on the session, but both copies read the session before either had written
-- it. Meta also redelivers on its own when it thinks a webhook was missed.
--
-- A message is now CLAIMED before it is answered: the first copy inserts its
-- id here and goes on; any other copy finds it taken and stops. Kept 3 days.
-- ============================================================================

create table if not exists wa_answered_messages (
  message_id text primary key,
  line text,
  claimed_at timestamptz not null default now()
);
alter table wa_answered_messages enable row level security;
revoke all on wa_answered_messages from anon, authenticated;

-- true: this caller is the one to answer it.
create or replace function sehat_wa_claim_message(p_message_id text, p_line text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(p_message_id, '') = '' then return true; end if;      -- nothing to tell copies apart by
  insert into wa_answered_messages (message_id, line) values (p_message_id, p_line)
  on conflict (message_id) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function sehat_wa_claim_message(text, text) from public, anon, authenticated;
grant execute on function sehat_wa_claim_message(text, text) to service_role;

create or replace function sehat_purge_wa_bot_sessions()
returns integer language sql security definer set search_path = public as $$
  with t as (delete from wa_clinic_threads where last_at < now() - interval '1 year' returning 1),
       l as (delete from wa_sent_log where sent_at < now() - interval '400 days' returning 1),
       a as (delete from wa_answered_messages where claimed_at < now() - interval '3 days' returning 1),
       d as (delete from wa_bot_sessions where updated_at < now() - interval '7 days' returning 1)
  select (select count(*) from d)::integer + 0 * ((select count(*) from t) + (select count(*) from l) + (select count(*) from a))::integer;
$$;
revoke all on function sehat_purge_wa_bot_sessions() from public, anon, authenticated;

notify pgrst, 'reload schema';
