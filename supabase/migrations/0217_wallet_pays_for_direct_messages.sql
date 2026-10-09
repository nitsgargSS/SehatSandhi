-- ============================================================================
-- 0217 — The wallet pays for one-to-one WhatsApp messages too
-- ============================================================================
-- AFTER 0216. Safe to re-run.
--
-- Decided 9 Oct 2026: everything a clinic sends a patient on WhatsApp comes
-- out of its wallet (0116) — not only broadcasts. Two prices, both set by an
-- admin on the one settings row:
--
--   per_message_paise     ₹1.59  a promotional template, sent in bulk (as before)
--   direct_message_paise  ₹0.50  a prescription, bill, lab report or discharge
--                                summary sent to one patient
--
-- Since 1 Oct 2026 Meta charges for every one of these, so none can be free.
--
-- The edge functions that send a document (supabase/functions/_shared/
-- deliver.ts) charge first and send second:
--
--   sehat_wallet_charge_direct  takes the price, or says the wallet is short —
--                               then nothing is sent on WhatsApp (email, where
--                               an address was given, still goes).
--   sehat_wallet_refund_direct  puts it back when WhatsApp did not accept the
--                               message. Once per charge, however often called.
--
-- Charging first, under the wallet's row lock, is what stops two sends in the
-- same second from both spending the last fifty paise.
--
-- WHERE THE MONEY IS. A top-up lands in our bank through Razorpay; the wallet
-- is our own record of what the clinic has left to spend. Meta bills us
-- afterwards for what was sent. sehat_admin_wallet_report shows the three
-- side by side, month by month: money in, money spent on messages, and what
-- Meta is expected to charge for them — at the two rates below, which an
-- admin keeps in step with Meta's rate card (before GST).
--
--   meta_marketing_cost_paise  86.31  a promotional template
--   meta_utility_cost_paise    11.50  a prescription, bill or report
-- ============================================================================

alter table whatsapp_marketing_settings
  add column if not exists direct_message_paise integer not null default 50 check (direct_message_paise > 0);

-- A refund names the charge it undoes; UNIQUE makes a second refund impossible.
alter table business_wallet_transactions
  add column if not exists reverses uuid unique references business_wallet_transactions(id);

create or replace function sehat_wallet_charge_direct(p_business uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rate integer;
  v_balance integer;
  v_tx uuid;
begin
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
begin
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

-- ── What Meta charges us, for the estimate ──────────────────────────────────
alter table whatsapp_marketing_settings
  add column if not exists meta_marketing_cost_paise numeric(8,2) not null default 86.31 check (meta_marketing_cost_paise >= 0);
alter table whatsapp_marketing_settings
  add column if not exists meta_utility_cost_paise numeric(8,2) not null default 11.50 check (meta_utility_cost_paise >= 0);

-- ── The wallet's money, month by month (India time) ─────────────────────────
-- A one-to-one charge that was refunded is left out of its month altogether:
-- the message did not go, so it is neither revenue nor a Meta cost.
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
  ), rows as (
    select months.m,
      coalesce(a.topups, 0) as topups, coalesce(a.direct_messages, 0) as direct_messages, coalesce(a.direct_spent, 0) as direct_spent,
      coalesce(b.messages, 0) as broadcast_messages, coalesce(a.broadcast_spent, 0) as broadcast_spent,
      coalesce(a.lead_fees, 0) as lead_fees, coalesce(a.other_refunds, 0) as other_refunds, coalesce(a.adjustments, 0) as adjustments,
      round(coalesce(a.direct_messages, 0) * v_ut + coalesce(b.messages, 0) * v_mk) as meta_cost
    from months left join agg a on a.m = months.m left join bc b on b.m = months.m
  )
  select jsonb_build_object(
    'months', coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(m, 'YYYY-MM'),
      'topups_paise', topups,
      'direct_messages', direct_messages, 'direct_spent_paise', direct_spent,
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
