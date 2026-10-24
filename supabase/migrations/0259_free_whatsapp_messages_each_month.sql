-- ============================================================================
-- 0259 — Free WhatsApp messages every month with the add-on
-- ============================================================================
-- AFTER 0258. Safe to re-run.
--
-- Decided 24 Oct 2026: a clinic paying the WhatsApp add-on (₹500 a month, or
-- the 6- and 12-month terms) gets 200 free messages a month. Unused ones lapse
-- at the end of the month; the next month starts at 200 again.
--
--   WHAT THEY COVER. Messages to one patient — a prescription, bill, lab
--     report, discharge summary or review request: everything that goes
--     through sehat_wallet_charge_direct. Broadcasts and test broadcasts stay
--     on the wallet. 200 of these cost us about ₹23 at Meta's utility rate.
--
--   THE MONTH. A clinic's own, counted from the day its add-on started
--     (business_wa_accounts.subscription_started_at, which renewal keeps) —
--     so a clinic that joins on the 17th renews on the 17th. India dates.
--     Nothing runs on a timer: a month's row opens the first time it is used
--     or looked at, holding that month's allowance.
--
--   ORDER. Free messages first, then the wallet. A message not delivered is
--     given back — the free one to the month it came from, as the wallet's
--     money is (0217). Same two functions, so no sender changes: a free
--     message answers ok, tx (its own id), rate_paise 0.
--
--   WHO. Any clinic WhatsApp is open to (sehat_wa_addon_blocker is null) —
--     paid, in its grace days, or complimentary (0157).
--
--   ADMIN. whatsapp_marketing_settings.free_messages_per_month is the
--     default (200). A clinic can have its own number instead (0 switches it
--     off), and an admin can add extra free messages to a clinic's current
--     month, with a reason — logged, and lapsing with the month like the rest.
-- ============================================================================

-- ── Settings and the per-clinic number ──────────────────────────────────────

alter table whatsapp_marketing_settings
  add column if not exists free_messages_per_month integer not null default 200
  check (free_messages_per_month between 0 and 100000);

alter table business_wa_accounts
  add column if not exists free_messages_override integer
  check (free_messages_override is null or free_messages_override between 0 and 100000);
alter table business_wa_accounts add column if not exists free_messages_override_note text;

-- ── The months, the uses, the grants ────────────────────────────────────────

create table if not exists wa_free_allowances (
  business_id uuid not null references businesses(id) on delete cascade,
  period_start date not null,
  period_end date not null,            -- last day of the month, inclusive
  allowance integer not null check (allowance >= 0),
  extra integer not null default 0 check (extra >= 0),
  used integer not null default 0 check (used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, period_start)
);

-- One row per free message. Its id is what the senders hold as the charge,
-- so a refund finds it the way it finds a wallet charge.
create table if not exists wa_free_uses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  period_start date not null,
  note text,
  created_at timestamptz not null default now(),
  refunded_at timestamptz,
  foreign key (business_id, period_start) references wa_free_allowances(business_id, period_start) on delete cascade
);
create index if not exists wa_free_uses_month_idx on wa_free_uses (business_id, period_start);
create index if not exists wa_free_uses_created_idx on wa_free_uses (created_at);

create table if not exists wa_free_grants (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  period_start date not null,
  messages integer not null check (messages > 0),
  reason text not null,
  granted_by text,
  created_at timestamptz not null default now(),
  foreign key (business_id, period_start) references wa_free_allowances(business_id, period_start) on delete cascade
);

alter table wa_free_allowances enable row level security;
alter table wa_free_uses enable row level security;
alter table wa_free_grants enable row level security;
revoke all on wa_free_allowances, wa_free_uses, wa_free_grants from anon, authenticated;

-- ── Which month a day falls in, for a clinic ────────────────────────────────

create or replace function sehat_wa_free_period(p_business uuid, p_on date default null)
returns table (period_start date, period_end date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_anchor date;
  v_today date := coalesce(p_on, (now() at time zone 'Asia/Kolkata')::date);
  n integer;
begin
  select (coalesce(subscription_started_at, complimentary_since, created_at) at time zone 'Asia/Kolkata')::date
    into v_anchor from business_wa_accounts where business_id = p_business;
  if v_anchor is null then return; end if;
  if v_today < v_anchor then v_today := v_anchor; end if;

  n := (extract(year from age(v_today, v_anchor)) * 12 + extract(month from age(v_today, v_anchor)))::integer;
  -- A month-end start (the 31st) is clamped by Postgres; step forward if that left today outside.
  if (v_anchor + make_interval(months => n + 1))::date <= v_today then n := n + 1; end if;

  period_start := (v_anchor + make_interval(months => n))::date;
  period_end := (v_anchor + make_interval(months => n + 1))::date - 1;
  return next;
end $$;
revoke all on function sehat_wa_free_period(uuid, date) from public, anon, authenticated;

create or replace function sehat_wa_free_allowance_for(p_business uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(a.free_messages_override, s.free_messages_per_month, 0)
    from whatsapp_marketing_settings s
    left join business_wa_accounts a on a.business_id = p_business
   where s.id;
$$;
revoke all on function sehat_wa_free_allowance_for(uuid) from public, anon, authenticated;

-- Opens this month's row if it is not there yet.
create or replace function sehat_wa_free_open(p_business uuid)
returns wa_free_allowances
language plpgsql security definer set search_path = public as $$
declare
  p record;
  r wa_free_allowances;
begin
  select * into p from sehat_wa_free_period(p_business);
  if p.period_start is null then return null; end if;
  insert into wa_free_allowances (business_id, period_start, period_end, allowance)
  values (p_business, p.period_start, p.period_end, sehat_wa_free_allowance_for(p_business))
  on conflict (business_id, period_start) do nothing;
  select * into r from wa_free_allowances where business_id = p_business and period_start = p.period_start;
  return r;
end $$;
revoke all on function sehat_wa_free_open(uuid) from public, anon, authenticated;

-- This month, as the clinic and the admin see it. Read-only: a month not
-- opened yet shows its full allowance.
create or replace function sehat_wa_free_status(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p record;
  r wa_free_allowances;
  v_total integer;
  v_used integer;
begin
  if sehat_wa_addon_blocker(p_business) is not null then
    return jsonb_build_object('eligible', false, 'total', 0, 'used', 0, 'left', 0);
  end if;
  select * into p from sehat_wa_free_period(p_business);
  if p.period_start is null then
    return jsonb_build_object('eligible', false, 'total', 0, 'used', 0, 'left', 0);
  end if;
  select * into r from wa_free_allowances where business_id = p_business and period_start = p.period_start;
  v_total := coalesce(r.allowance, sehat_wa_free_allowance_for(p_business)) + coalesce(r.extra, 0);
  v_used := coalesce(r.used, 0);
  return jsonb_build_object(
    'eligible', true, 'total', v_total, 'used', v_used, 'left', greatest(v_total - v_used, 0),
    'extra', coalesce(r.extra, 0), 'period_start', p.period_start, 'period_end', p.period_end,
    'renews_on', p.period_end + 1);
end $$;
revoke all on function sehat_wa_free_status(uuid) from public, anon, authenticated;

-- Takes one free message, or answers null when the month has none left.
create or replace function sehat_wa_free_take(p_business uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r wa_free_allowances;
  v_id uuid;
begin
  r := sehat_wa_free_open(p_business);
  if r.business_id is null then return null; end if;
  -- Under the row's lock, so two sends in the same second cannot both take the last one.
  select * into r from wa_free_allowances
   where business_id = p_business and period_start = r.period_start for update;
  if r.used >= r.allowance + r.extra then return null; end if;
  update wa_free_allowances set used = used + 1, updated_at = now()
   where business_id = p_business and period_start = r.period_start;
  insert into wa_free_uses (business_id, period_start, note)
  values (p_business, r.period_start, left(coalesce(p_note, 'WhatsApp message'), 200))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function sehat_wa_free_take(uuid, text) from public, anon, authenticated;

-- ── Charging and refunding: free first, then the wallet ─────────────────────

create or replace function sehat_wallet_charge_direct(p_business uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_block text;
  v_rate integer;
  v_balance integer;
  v_tx uuid;
  v_free uuid;
begin
  v_block := sehat_wa_addon_blocker(p_business);
  if v_block is not null then
    return jsonb_build_object('ok', false, 'needs_plan', true, 'text', v_block);
  end if;

  -- 0259: this month's free messages go first.
  v_free := sehat_wa_free_take(p_business, p_note);
  if v_free is not null then
    return jsonb_build_object('ok', true, 'tx', v_free, 'free', true, 'rate_paise', 0,
      'balance_paise', coalesce((select balance_paise from business_wallets where business_id = p_business), 0),
      'free_left', (sehat_wa_free_status(p_business) ->> 'left')::integer);
  end if;

  select direct_message_paise into v_rate from whatsapp_marketing_settings where id;
  if v_rate is null then raise exception 'whatsapp_marketing_settings has no row'; end if;

  insert into business_wallets (business_id) values (p_business) on conflict do nothing;
  select balance_paise into v_balance from business_wallets where business_id = p_business for update;
  if v_balance < v_rate then
    return jsonb_build_object('ok', false, 'rate_paise', v_rate, 'balance_paise', v_balance);
  end if;

  update business_wallets set balance_paise = balance_paise - v_rate, updated_at = now()
   where business_id = p_business;
  insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, note, created_by)
  values (p_business, 'message_send', -v_rate, v_balance - v_rate, left(coalesce(p_note, 'WhatsApp message'), 200), 'system')
  returning id into v_tx;

  return jsonb_build_object('ok', true, 'tx', v_tx, 'rate_paise', v_rate, 'balance_paise', v_balance - v_rate);
end $$;
revoke all on function sehat_wallet_charge_direct(uuid, text) from public, anon, authenticated;
grant execute on function sehat_wallet_charge_direct(uuid, text) to service_role;

create or replace function sehat_wallet_refund_direct(p_tx uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_charge business_wallet_transactions;
  v_balance integer;
  v_use wa_free_uses;
begin
  -- 0259: a free message goes back to the month it came from. Once only: the
  -- update matches nothing the second time.
  update wa_free_uses set refunded_at = now() where id = p_tx and refunded_at is null
  returning * into v_use;
  if v_use.id is not null then
    update wa_free_allowances set used = greatest(used - 1, 0), updated_at = now()
     where business_id = v_use.business_id and period_start = v_use.period_start;
    return true;
  end if;
  if exists (select 1 from wa_free_uses where id = p_tx) then return false; end if;

  select * into v_charge from business_wallet_transactions
   where id = p_tx and type = 'message_send' and broadcast_id is null and amount_paise < 0;
  if v_charge.id is null then return false; end if;

  select balance_paise into v_balance from business_wallets where business_id = v_charge.business_id for update;
  -- Checked under the lock: the charge has not been refunded already.
  if exists (select 1 from business_wallet_transactions where reverses = p_tx) then return false; end if;

  update business_wallets set balance_paise = balance_paise - v_charge.amount_paise, updated_at = now()
   where business_id = v_charge.business_id;
  insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, note, created_by, reverses)
  values (v_charge.business_id, 'refund', -v_charge.amount_paise, v_balance - v_charge.amount_paise,
          left('Not delivered: ' || coalesce(v_charge.note, 'WhatsApp message'), 200), 'system', p_tx);
  return true;
end $$;
revoke all on function sehat_wallet_refund_direct(uuid) from public, anon, authenticated;
grant execute on function sehat_wallet_refund_direct(uuid) to service_role;

-- ── What a Send button shows ────────────────────────────────────────────────

create or replace function sehat_send_options(p_business uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_free jsonb;
begin
  if sehat_caller_role(p_business) is null and not sehat_is_admin() then
    raise exception 'Not your clinic.' using errcode = '42501';
  end if;
  v_free := sehat_wa_free_status(p_business);
  return jsonb_build_object(
    'whatsapp_blocker', sehat_wa_addon_blocker(p_business),
    'whatsapp_paise', (select direct_message_paise from whatsapp_marketing_settings where id),
    'balance_paise', coalesce((select balance_paise from business_wallets where business_id = p_business), 0),
    -- 0259
    'free_total', (v_free ->> 'total')::integer,
    'free_left', (v_free ->> 'left')::integer,
    'free_renews_on', v_free ->> 'renews_on');
end $$;
revoke all on function sehat_send_options(uuid) from public, anon, authenticated;
grant execute on function sehat_send_options(uuid) to authenticated;

-- ── Admin ───────────────────────────────────────────────────────────────────

-- Every clinic with a WhatsApp account: this month, its own number if set, and
-- its last six months with any extra given.
create or replace function sehat_admin_wa_free_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'business_id', a.business_id, 'business_name', b.name,
      'blocker', sehat_wa_addon_blocker(a.business_id),
      'complimentary', a.complimentary,
      'override', a.free_messages_override, 'override_note', a.free_messages_override_note,
      'now', sehat_wa_free_status(a.business_id),
      'months', coalesce((
        select jsonb_agg(jsonb_build_object(
          'period_start', m.period_start, 'period_end', m.period_end,
          'allowance', m.allowance, 'extra', m.extra, 'used', m.used,
          'grants', coalesce((select jsonb_agg(jsonb_build_object('messages', g.messages, 'reason', g.reason,
                                'by', g.granted_by, 'at', g.created_at) order by g.created_at)
                                from wa_free_grants g
                               where g.business_id = m.business_id and g.period_start = m.period_start), '[]'::jsonb))
          order by m.period_start desc)
          from (select * from wa_free_allowances x where x.business_id = a.business_id
                 order by x.period_start desc limit 6) m), '[]'::jsonb))
      order by b.name)
      from business_wa_accounts a join businesses b on b.id = a.business_id
     where a.subscription_status <> 'inactive' or a.complimentary), '[]'::jsonb);
end $$;
revoke all on function sehat_admin_wa_free_overview() from public, anon, authenticated;
grant execute on function sehat_admin_wa_free_overview() to authenticated;

-- A clinic's own monthly number (null = the default). Applies to the month
-- already running too, so "give them 500" takes effect today.
create or replace function sehat_admin_wa_free_set(p_business uuid, p_messages integer, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p record;
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_messages is not null and (p_messages < 0 or p_messages > 100000) then
    raise exception 'Free messages a month is 0 to 100000.';
  end if;
  update business_wa_accounts
     set free_messages_override = p_messages,
         free_messages_override_note = case when p_messages is null then null else nullif(btrim(coalesce(p_note, '')), '') end,
         updated_at = now()
   where business_id = p_business;
  if not found then raise exception 'This clinic has no WhatsApp account.'; end if;

  select * into p from sehat_wa_free_period(p_business);
  update wa_free_allowances set allowance = sehat_wa_free_allowance_for(p_business), updated_at = now()
   where business_id = p_business and period_start = p.period_start;
  return sehat_wa_free_status(p_business);
end $$;
revoke all on function sehat_admin_wa_free_set(uuid, integer, text) from public, anon, authenticated;
grant execute on function sehat_admin_wa_free_set(uuid, integer, text) to authenticated;

-- Extra free messages for this month only, with a reason.
create or replace function sehat_admin_wa_free_grant(p_business uuid, p_messages integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_by text := coalesce((select email from auth.users where id = auth.uid()), 'database');
  r wa_free_allowances;
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_messages is null or p_messages < 1 or p_messages > 10000 then
    raise exception 'Give 1 to 10000 extra messages.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why — it is kept with the grant.'; end if;
  if sehat_wa_addon_blocker(p_business) is not null then
    raise exception 'WhatsApp is not open to this clinic: %', sehat_wa_addon_blocker(p_business);
  end if;

  r := sehat_wa_free_open(p_business);
  if r.business_id is null then raise exception 'This clinic has no WhatsApp account.'; end if;
  update wa_free_allowances set extra = extra + p_messages, updated_at = now()
   where business_id = p_business and period_start = r.period_start;
  insert into wa_free_grants (business_id, period_start, messages, reason, granted_by)
  values (p_business, r.period_start, p_messages, btrim(p_reason), v_by);
  return sehat_wa_free_status(p_business);
end $$;
revoke all on function sehat_admin_wa_free_grant(uuid, integer, text) from public, anon, authenticated;
grant execute on function sehat_admin_wa_free_grant(uuid, integer, text) to authenticated;

-- ── The money report: free messages cost us Meta's rate too ─────────────────
-- As 0217, plus free_messages per month (delivered ones), counted into Meta's
-- cost so the margin stays honest.
create or replace function sehat_admin_wallet_report(p_months integer default 6)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mk numeric;
  v_ut numeric;
  v_out jsonb;
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select meta_marketing_cost_paise, meta_utility_cost_paise into v_mk, v_ut
    from whatsapp_marketing_settings where id;

  with months as (
    select generate_series(
      date_trunc('month', now() at time zone 'Asia/Kolkata') - make_interval(months => greatest(least(coalesce(p_months, 6), 24), 1) - 1),
      date_trunc('month', now() at time zone 'Asia/Kolkata'), interval '1 month') as m
  ), tx as (
    select date_trunc('month', t.created_at at time zone 'Asia/Kolkata') as m, t.type, t.amount_paise, t.broadcast_id, t.reverses,
           exists (select 1 from business_wallet_transactions r where r.reverses = t.id) as undone
      from business_wallet_transactions t
  ), agg as (
    select m,
      coalesce(sum(amount_paise) filter (where type = 'recharge'), 0) as topups,
      count(*) filter (where type = 'message_send' and broadcast_id is null and not undone) as direct_messages,
      coalesce(-sum(amount_paise) filter (where type = 'message_send' and broadcast_id is null and not undone), 0) as direct_spent,
      coalesce(-sum(amount_paise) filter (where type = 'message_send' and broadcast_id is not null), 0) as broadcast_spent,
      coalesce(-sum(amount_paise) filter (where type = 'lead_fee'), 0) as lead_fees,
      coalesce(sum(amount_paise) filter (where type = 'refund' and reverses is null), 0) as other_refunds,
      coalesce(sum(amount_paise) filter (where type = 'adjustment'), 0) as adjustments
    from tx group by m
  ), bc as (
    select date_trunc('month', created_at at time zone 'Asia/Kolkata') as m, coalesce(sum(recipient_count), 0) as messages
      from wa_broadcasts group by 1
  ), fr as (
    select date_trunc('month', created_at at time zone 'Asia/Kolkata') as m, count(*) as messages
      from wa_free_uses where refunded_at is null group by 1
  ), rows as (
    select months.m,
      coalesce(a.topups, 0) as topups, coalesce(a.direct_messages, 0) as direct_messages, coalesce(a.direct_spent, 0) as direct_spent,
      coalesce(b.messages, 0) as broadcast_messages, coalesce(a.broadcast_spent, 0) as broadcast_spent,
      coalesce(a.lead_fees, 0) as lead_fees, coalesce(a.other_refunds, 0) as other_refunds, coalesce(a.adjustments, 0) as adjustments,
      coalesce(f.messages, 0) as free_messages,
      round((coalesce(a.direct_messages, 0) + coalesce(f.messages, 0)) * v_ut + coalesce(b.messages, 0) * v_mk) as meta_cost
    from months left join agg a on a.m = months.m left join bc b on b.m = months.m left join fr f on f.m = months.m
  )
  select jsonb_build_object(
    'months', coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(m, 'YYYY-MM'),
      'topups_paise', topups,
      'direct_messages', direct_messages, 'direct_spent_paise', direct_spent,
      'free_messages', free_messages,
      'broadcast_messages', broadcast_messages, 'broadcast_spent_paise', broadcast_spent,
      'lead_fees_paise', lead_fees, 'refunds_paise', other_refunds, 'adjustments_paise', adjustments,
      'meta_cost_paise', meta_cost,
      'margin_paise', direct_spent + broadcast_spent - meta_cost) order by m desc), '[]'::jsonb),
    'unspent_paise', (select coalesce(sum(balance_paise), 0) from business_wallets),
    'wallets_with_balance', (select count(*) from business_wallets where balance_paise > 0),
    'meta_marketing_cost_paise', v_mk, 'meta_utility_cost_paise', v_ut)
  into v_out from rows;
  return v_out;
end $$;
revoke all on function sehat_admin_wallet_report(integer) from public, anon, authenticated;
grant execute on function sehat_admin_wallet_report(integer) to authenticated;

notify pgrst, 'reload schema';
