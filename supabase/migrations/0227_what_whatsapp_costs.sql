-- ============================================================================
-- 0227 — What WhatsApp costs us, message by message; and the app, offered once
-- ============================================================================
-- AFTER 0226. Safe to re-run.
--
-- Since 1 Oct 2026 Meta prices every message it carries for us, the bot's
-- replies included (a monthly allowance of them is free). Nothing recorded
-- what each message was charged, so nothing could say what a booking costs or
-- whether a change to the bot saved anything. Decided 10 Oct 2026: measure
-- first, then cut.
--
--   wa_sent_log — one row per message WE sent, keyed by Meta's message id.
--        The bot writes it when it sends (what kind of message, and which
--        patient message it answered). Meta's delivery receipts then say what
--        it was charged as — `pricing` on each receipt: billable or not, its
--        category (service, utility, marketing, authentication) and type
--        (regular, free_customer_service, free_entry_point). A message sent
--        by anything else (a template, the old provider) appears from its
--        receipt alone. Receipts repeat and arrive out of order: one row per
--        id, and its status never goes backwards. Kept 400 days.
--
--   The estimate in rupees is Meta's own verdict (billable or not) times OUR
--        copy of its rate card (whatsapp_marketing_settings: service and
--        authentication join the two rates 0217 added). Meta's invoice is the
--        truth; this is close enough to steer by.
--
--   sehat_admin_wa_costs — the admin's view: messages and rupees by category,
--        the free allowance used this month, bot messages per patient message
--        and per booking, and a line per day.
--
--   THE APP, OFFERED ONCE. A patient with the app gets reminders by push,
--        which costs nothing, and keeps their prescriptions and reports there.
--        The bot adds one line with the link to a message it is sending
--        anyway — the first welcome, and the first booking confirmation —
--        never as a message of its own, never twice, and not to someone who
--        already has the app. The link is site_settings 'app_link'; with none
--        set, nothing is added.
-- ============================================================================

alter table whatsapp_marketing_settings
  add column if not exists meta_service_cost_paise numeric(8,2) not null default 11.50 check (meta_service_cost_paise >= 0);
alter table whatsapp_marketing_settings
  add column if not exists meta_auth_cost_paise numeric(8,2) not null default 11.50 check (meta_auth_cost_paise >= 0);
-- The free service messages Meta gives each number a month.
alter table whatsapp_marketing_settings
  add column if not exists meta_free_service_per_month integer not null default 1000 check (meta_free_service_per_month >= 0);

create table if not exists wa_sent_log (
  wamid text primary key,
  phone text,                                -- who it went to, digits with country code
  phone_number_id text,                      -- which of our numbers sent it
  line text,                                 -- 'main' | 'clinic' when the bot sent it
  kind text,                                 -- text, buttons, list, location, template
  source text not null default 'receipt',    -- 'bot', or 'receipt': known only from Meta's receipt
  in_reply_to text,                          -- the patient's message the bot was answering
  bot_state text,                            -- where the conversation stood afterwards
  status text not null default 'accepted'
    check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  billable boolean,
  pricing_category text,
  pricing_type text,
  cost_paise numeric(8,2),
  sent_at timestamptz not null default now(),
  status_at timestamptz
);
create index if not exists wa_sent_log_sent_idx on wa_sent_log (sent_at);
create index if not exists wa_sent_log_reply_idx on wa_sent_log (in_reply_to) where in_reply_to is not null;
alter table wa_sent_log enable row level security;
revoke all on wa_sent_log from anon, authenticated;

-- The bot sent a message.
create or replace function sehat_wa_sent(
  p_wamid text, p_phone text, p_phone_number_id text, p_line text, p_kind text,
  p_in_reply_to text default null, p_bot_state text default null)
returns void
language sql security definer set search_path = public as $$
  insert into wa_sent_log (wamid, phone, phone_number_id, line, kind, source, in_reply_to, bot_state)
  select p_wamid, nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), p_phone_number_id, p_line, p_kind, 'bot',
         nullif(p_in_reply_to, ''), p_bot_state
   where coalesce(p_wamid, '') <> ''
  on conflict (wamid) do update            -- its receipt got here first
    set source = 'bot', line = excluded.line, kind = excluded.kind, in_reply_to = excluded.in_reply_to,
        bot_state = excluded.bot_state, phone = coalesce(wa_sent_log.phone, excluded.phone),
        phone_number_id = coalesce(wa_sent_log.phone_number_id, excluded.phone_number_id);
$$;
revoke all on function sehat_wa_sent(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function sehat_wa_sent(text, text, text, text, text, text, text) to service_role;

-- Meta's receipt for a message: where it has got to, and what it is charged as.
create or replace function sehat_wa_receipt(
  p_wamid text, p_status text, p_phone text default null, p_phone_number_id text default null,
  p_billable boolean default null, p_category text default null, p_type text default null,
  p_at timestamptz default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text := case when p_status in ('sent', 'delivered', 'read', 'failed') then p_status else 'accepted' end;
  v_rank integer := case v_status when 'accepted' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end;
  v_cat text := nullif(lower(coalesce(p_category, '')), '');
  v_cost numeric(8,2);
begin
  if coalesce(p_wamid, '') = '' then return; end if;
  if p_billable is not null then
    select case when not p_billable then 0
                when v_cat = 'marketing' then s.meta_marketing_cost_paise
                when v_cat = 'utility' then s.meta_utility_cost_paise
                when v_cat like 'authentication%' then s.meta_auth_cost_paise
                else s.meta_service_cost_paise end
      into v_cost from whatsapp_marketing_settings s limit 1;
  end if;
  insert into wa_sent_log (wamid, phone, phone_number_id, status, billable, pricing_category, pricing_type, cost_paise, sent_at, status_at)
  values (p_wamid, nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), p_phone_number_id, v_status,
          p_billable, v_cat, nullif(lower(coalesce(p_type, '')), ''), v_cost, coalesce(p_at, now()), coalesce(p_at, now()))
  on conflict (wamid) do update
    set status = case when v_rank > (case wa_sent_log.status when 'accepted' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end)
                      then excluded.status else wa_sent_log.status end,
        status_at = greatest(coalesce(wa_sent_log.status_at, excluded.status_at), excluded.status_at),
        billable = coalesce(excluded.billable, wa_sent_log.billable),
        pricing_category = coalesce(excluded.pricing_category, wa_sent_log.pricing_category),
        pricing_type = coalesce(excluded.pricing_type, wa_sent_log.pricing_type),
        cost_paise = coalesce(excluded.cost_paise, wa_sent_log.cost_paise),
        phone = coalesce(wa_sent_log.phone, excluded.phone),
        phone_number_id = coalesce(wa_sent_log.phone_number_id, excluded.phone_number_id);
end $$;
revoke all on function sehat_wa_receipt(text, text, text, text, boolean, text, text, timestamptz) from public, anon, authenticated;
grant execute on function sehat_wa_receipt(text, text, text, text, boolean, text, text, timestamptz) to service_role;

-- ── The admin's view ────────────────────────────────────────────────────────
create or replace function sehat_admin_wa_costs(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_from date := coalesce(p_from, date_trunc('month', v_today)::date);
  v_to date := coalesce(p_to, v_today);
  v_a timestamptz;
  v_b timestamptz;
  v_month timestamptz := date_trunc('month', v_today)::timestamp at time zone 'Asia/Kolkata';
  v_free integer;
  v jsonb;
begin
  if not sehat_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  if v_from > v_to then v_from := v_to; end if;
  v_a := v_from::timestamp at time zone 'Asia/Kolkata';
  v_b := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';
  select meta_free_service_per_month into v_free from whatsapp_marketing_settings limit 1;

  with m as (select * from wa_sent_log where sent_at >= v_a and sent_at < v_b and status <> 'failed'),
       bot as (select * from m where source = 'bot'),
       booked as (select count(*) n from appointments a where a.booked_via = 'whatsapp_bot' and a.created_at >= v_a and a.created_at < v_b)
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'sent', (select count(*) from m),
    'billable', (select count(*) from m where billable),
    'free', (select count(*) from m where billable is false),
    'unpriced', (select count(*) from m where billable is null),
    'cost_rupees', (select round(coalesce(sum(cost_paise), 0) / 100, 2) from m),
    'by_kind', (select coalesce(jsonb_agg(t order by t.messages desc), '[]'::jsonb) from (
        select coalesce(pricing_category, 'not priced yet') as category, coalesce(pricing_type, '') as type,
               count(*) as messages, count(*) filter (where billable) as billable,
               round(coalesce(sum(cost_paise), 0) / 100, 2) as rupees
          from m group by 1, 2) t),
    'by_day', (select coalesce(jsonb_agg(t order by t.day), '[]'::jsonb) from (
        select (sent_at at time zone 'Asia/Kolkata')::date as day, count(*) as messages,
               count(*) filter (where billable) as billable, round(coalesce(sum(cost_paise), 0) / 100, 2) as rupees
          from m group by 1) t),
    'bot', jsonb_build_object(
        'messages', (select count(*) from bot),
        'patient_messages', (select count(distinct in_reply_to) from bot where in_reply_to is not null),
        'two_or_more', (select count(*) from (select in_reply_to from bot where in_reply_to is not null group by 1 having count(*) > 1) x),
        'bookings', (select n from booked),
        'patients', (select count(distinct phone) from bot)),
    -- This month's free service messages, per number: what Meta did not charge for.
    'free_tier', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select coalesce(phone_number_id, 'unknown') as phone_number_id,
               count(*) filter (where pricing_category = 'service') as service_messages,
               count(*) filter (where pricing_type = 'free_customer_service') as free_used,
               v_free as free_allowance
          from wa_sent_log where sent_at >= v_month and status <> 'failed' group by 1) t),
    'rates', (select jsonb_build_object('service', meta_service_cost_paise, 'utility', meta_utility_cost_paise,
                                        'marketing', meta_marketing_cost_paise, 'authentication', meta_auth_cost_paise)
                from whatsapp_marketing_settings limit 1)
  ) into v;
  return v;
end $$;
revoke all on function sehat_admin_wa_costs(date, date) from public, anon;
grant execute on function sehat_admin_wa_costs(date, date) to authenticated;

-- ── The app, offered once ───────────────────────────────────────────────────
alter table wa_contacts add column if not exists app_offered_welcome_at timestamptz;
alter table wa_contacts add column if not exists app_offered_booked_at timestamptz;

-- The link to add to this message, or '' — and it is marked as offered.
-- p_moment: 'welcome' | 'booked'.
create or replace function sehat_wa_app_offer(p_phone text, p_moment text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_link text;
  v_done timestamptz;
begin
  select nullif(btrim(value), '') into v_link from site_settings where key = 'app_link';
  if v_link is null or v_phone = '' or p_moment not in ('welcome', 'booked') then return jsonb_build_object('link', ''); end if;
  if exists (select 1 from patient_app_accounts a where regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') in (v_phone, right(v_phone, 10))) then
    return jsonb_build_object('link', '');            -- has the app already
  end if;
  select case p_moment when 'welcome' then app_offered_welcome_at else app_offered_booked_at end into v_done
    from wa_contacts where phone = v_phone;
  if not found or v_done is not null then return jsonb_build_object('link', ''); end if;
  if p_moment = 'welcome' then update wa_contacts set app_offered_welcome_at = now() where phone = v_phone;
  else update wa_contacts set app_offered_booked_at = now() where phone = v_phone; end if;
  return jsonb_build_object('link', v_link);
end $$;
revoke all on function sehat_wa_app_offer(text, text) from public, anon, authenticated;
grant execute on function sehat_wa_app_offer(text, text) to service_role;

-- ── Housekeeping ────────────────────────────────────────────────────────────
create or replace function sehat_purge_wa_bot_sessions()
returns integer language sql security definer set search_path = public as $$
  with t as (delete from wa_clinic_threads where last_at < now() - interval '1 year' returning 1),
       l as (delete from wa_sent_log where sent_at < now() - interval '400 days' returning 1),
       d as (delete from wa_bot_sessions where updated_at < now() - interval '7 days' returning 1)
  select (select count(*) from d)::integer + 0 * ((select count(*) from t) + (select count(*) from l))::integer;
$$;
revoke all on function sehat_purge_wa_bot_sessions() from public, anon, authenticated;

notify pgrst, 'reload schema';
