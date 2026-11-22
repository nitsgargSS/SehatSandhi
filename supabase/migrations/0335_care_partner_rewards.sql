-- ============================================================================
-- 0335 — Care Partner Program, Phase 5: refunds, Partner Rewards, payouts, KYC, TDS
-- ============================================================================
-- AFTER 0334. Safe to re-run. Plan: docs/2026-11-partner-program-plan.md, brief §2 and §5.
--
-- REFUNDS (Nitin, 22 Nov: fix for every partner)
--   payments.refunded_amount / refunded_at / razorpay_refund_id. Recorded from
--   Razorpay's refund.processed webhook (razorpay-webhook) or by an admin.
--   0255's agency statements now take back online refunds too (before, only
--   offline refunds were clawed back).
--
-- PARTNER REWARDS (care partners only; agencies keep 0255's percentage)
--   One row per eligible payment in care_partner_rewards:
--     eligible  paid, business credited to an active Care Partner, a 12-month
--               term (period_months = 12 — add-ons carry the plan's term, so an
--               add-on bought during a 12-month term counts), base = taxable
--               value (before GST, after coupons). Wallet top-ups never reach it.
--     Start     within 12 months of the business confirming the partner, at the
--               partner's level rate (15 / 20 / 25 %), until partner_start_reward_cap
--               per business (₹15,000).
--     Renewal   later, 10 %, while the business keeps renewing — a gap longer
--               than partner_renewal_grace_days after the last term ends the chain.
--   pending → approved after partner_refund_window_days (15, nightly) → paid with
--   the statement. A refund reverses a pending reward, or adds a clawback line.
--   PAYOUT MONTH (Nitin, 22 Nov): partners are paid monthly. A reward whose
--   payment was made on or before partner_payout_cutoff_day (15) of a month is
--   in that month's payout; after it, in the next month's. Clawbacks go in the
--   month of the refund. A month's statement takes approved rewards whose
--   payout month is that month or earlier (anything held carries forward).
--
-- STATEMENTS AND PAYOUTS (0255's, one money system)
--   A care partner's monthly statement lists its approved rewards not yet on a
--   statement (carried forward until paid). Finalising checks: PAN and bank
--   verified, every current contract accepted, total ≥ partner_min_payout;
--   it works out TDS (194H) from partner_tds_rate once the partner's financial-
--   year total passes partner_tds_threshold (CHECK with the CA). Marking it
--   paid marks the rewards paid.
--
-- KYC
--   PAN and bank details live in Vault (one secret per partner), never in a
--   table; the table keeps keyed hashes (so two partners cannot share a PAN or
--   an account) and the last four characters. Only an admin with role 'owner'
--   can read the full values, and every read is logged.
--
-- LEVELS
--   Nightly: active businesses (credited, with a paid term not yet ended) set
--   associate / senior (partner_level_senior, 10) / elite (partner_level_elite, 30).
--   A partner with an open report is never moved up.
-- ============================================================================

insert into site_settings (key, value) values
  ('partner_rate_start_associate', '15'),
  ('partner_rate_start_senior', '20'),
  ('partner_rate_start_elite', '25'),
  ('partner_rate_renewal', '10'),
  ('partner_level_senior', '10'),
  ('partner_level_elite', '30'),
  ('partner_tds_rate', '2'),
  ('partner_tds_threshold', '20000'),
  ('partner_payout_cutoff_day', '15')
on conflict (key) do nothing;
-- 15 days, in step with the 15th cut-off (Nitin, 22 Nov). Only the old default is moved.
update site_settings set value = '15', updated_at = now() where key = 'partner_refund_window_days' and value = '14';

-- ── Refunds on online payments ──────────────────────────────────────────────
alter table payments add column if not exists refunded_amount numeric(12,2) not null default 0;
alter table payments add column if not exists refunded_at timestamptz;
alter table payments add column if not exists razorpay_refund_ids text[] not null default '{}';

-- ── The reward ledger ───────────────────────────────────────────────────────
create table if not exists care_partner_rewards (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references care_partners(id) on delete restrict,
  business_id     uuid references businesses(id) on delete set null,
  payment_id      uuid references payments(id) on delete restrict,
  reward_type     text not null check (reward_type in ('start', 'renewal', 'clawback')),
  base_amount     numeric(12,2) not null,
  rate            numeric(5,2) not null,
  amount          numeric(12,2) not null,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'reversed')),
  approve_after   timestamptz not null,
  approved_at     timestamptz,
  payout_month    date,                     -- the month whose payout includes it (cut-off day rule)
  statement_month date,                     -- set when a statement that includes it is finalised
  note            text,
  created_at      timestamptz not null default now()
);
alter table care_partner_rewards add column if not exists payout_month date;

-- The payout month of a payment date: on or before the cut-off day → that month, after → the next.
create or replace function sehat_care_payout_month(p_at timestamptz)
returns date language sql stable security definer set search_path = public as $$
  select case when extract(day from (p_at at time zone 'Asia/Kolkata')) <= sehat_care_setting_int('payout_cutoff_day', 15)
              then date_trunc('month', p_at at time zone 'Asia/Kolkata')::date
              else (date_trunc('month', p_at at time zone 'Asia/Kolkata') + interval '1 month')::date end
$$;
revoke all on function sehat_care_payout_month(timestamptz) from public, anon, authenticated;

create unique index if not exists care_partner_rewards_once on care_partner_rewards (payment_id) where reward_type in ('start', 'renewal');
create index if not exists care_partner_rewards_partner_idx on care_partner_rewards (partner_id, status);
alter table care_partner_rewards enable row level security;
revoke all on care_partner_rewards from anon;
drop policy if exists care_partner_rewards_read on care_partner_rewards;
create policy care_partner_rewards_read on care_partner_rewards for select to authenticated
  using (sehat_is_admin() or exists (select 1 from care_partners p where p.id = partner_id and p.user_id = auth.uid()));

alter table marketing_statements add column if not exists tds_amount numeric(12,2);
alter table marketing_statements add column if not exists net_amount numeric(12,2);

-- ── Create a reward for a payment (fulfilment calls this; idempotent) ───────
create or replace function sehat_care_reward_for_payment(p_payment uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare pay payments; c business_partner_credits; p care_partners; v_paid timestamptz; v_confirmed timestamptz;
        v_type text; v_rate numeric(5,2); v_base numeric(12,2); v_amount numeric(12,2); v_cap numeric; v_used numeric;
        v_prev_end date; v_id uuid;
begin
  select * into pay from payments where id = p_payment;
  if pay.id is null or pay.status <> 'paid' or pay.business_id is null or pay.type not in ('listing', 'subscription') then
    return jsonb_build_object('skipped', 'not a business plan payment');
  end if;
  if exists (select 1 from care_partner_rewards where payment_id = pay.id and reward_type in ('start', 'renewal')) then
    return jsonb_build_object('skipped', 'already recorded');
  end if;
  if coalesce(pay.period_months, 0) <> 12 then return jsonb_build_object('skipped', 'not a 12-month term'); end if;
  v_base := coalesce(pay.taxable_value, 0);
  if v_base <= 0 then return jsonb_build_object('skipped', 'nothing taxable'); end if;

  select * into c from business_partner_credits where business_id = pay.business_id;
  if c.status is distinct from 'approved' or c.partner_id is null then return jsonb_build_object('skipped', 'no confirmed partner'); end if;
  select * into p from care_partners where marketing_partner_id = c.partner_id;
  if p.id is null then return jsonb_build_object('skipped', 'not a care partner'); end if;

  v_paid := pay.created_at;
  if p.status <> 'active' or (p.valid_until is not null and p.valid_until < (v_paid at time zone 'Asia/Kolkata')::date) then
    return jsonb_build_object('skipped', 'partner not active');
  end if;

  v_confirmed := coalesce(c.care_answered_at, c.decided_at, c.created_at);
  if v_paid < v_confirmed + interval '12 months' then
    v_type := 'start';
    v_rate := case p.level when 'elite' then sehat_care_setting_int('rate_start_elite', 25)
                           when 'senior' then sehat_care_setting_int('rate_start_senior', 20)
                           else sehat_care_setting_int('rate_start_associate', 15) end;
    v_amount := round(v_base * v_rate / 100, 2);
    v_cap := sehat_care_setting_int('start_reward_cap', 15000);
    select coalesce(sum(amount), 0) into v_used from care_partner_rewards
     where business_id = pay.business_id and partner_id = p.id and reward_type in ('start', 'clawback') and status <> 'reversed';
    v_amount := least(v_amount, greatest(v_cap - v_used, 0));
    if v_amount <= 0 then return jsonb_build_object('skipped', 'start reward cap reached'); end if;
  else
    v_type := 'renewal';
    v_rate := sehat_care_setting_int('rate_renewal', 10);
    -- The chain ends when the business let its plan lapse longer than the grace window.
    select max(pp.term_end) into v_prev_end from payments pp
     where pp.business_id = pay.business_id and pp.status = 'paid' and pp.id <> pay.id and pp.created_at < pay.created_at
       and coalesce(pp.subscription_amount, 1) > 0;
    if v_prev_end is not null and (v_paid at time zone 'Asia/Kolkata')::date > v_prev_end + sehat_care_setting_int('renewal_grace_days', 60) then
      return jsonb_build_object('skipped', 'renewal chain ended');
    end if;
    v_amount := round(v_base * v_rate / 100, 2);
  end if;

  insert into care_partner_rewards (partner_id, business_id, payment_id, reward_type, base_amount, rate, amount, approve_after, payout_month)
  values (p.id, pay.business_id, pay.id, v_type, v_base, v_rate, v_amount,
          v_paid + make_interval(days => sehat_care_setting_int('refund_window_days', 15)), sehat_care_payout_month(v_paid))
  on conflict do nothing
  returning id into v_id;
  return jsonb_build_object('reward_id', v_id, 'type', v_type, 'amount', v_amount);
end $$;
revoke all on function sehat_care_reward_for_payment(uuid) from public, anon, authenticated;
grant execute on function sehat_care_reward_for_payment(uuid) to service_role;

-- ── A refund on a payment: rewards follow it ────────────────────────────────
create or replace function sehat_care_rewards_on_refund(p_payment uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare pay payments; r care_partner_rewards; v_frac numeric; v_target numeric(12,2); v_have numeric(12,2);
begin
  select * into pay from payments where id = p_payment;
  if pay.id is null or coalesce(pay.amount, 0) <= 0 then return; end if;
  v_frac := least(coalesce(pay.refunded_amount, 0) / pay.amount, 1);
  for r in select * from care_partner_rewards where payment_id = pay.id and reward_type in ('start', 'renewal') and status <> 'reversed' for update loop
    if r.status = 'pending' then
      if v_frac >= 1 then
        update care_partner_rewards set status = 'reversed', note = 'Payment refunded' where id = r.id;
      else
        update care_partner_rewards set amount = round(base_amount * rate / 100 * (1 - v_frac), 2),
               note = format('Partly refunded (%s%%)', round(v_frac * 100)) where id = r.id;
      end if;
    else
      -- Already approved or paid: take back the refunded share as a clawback line.
      v_target := -round(r.amount * v_frac, 2);
      select coalesce(sum(amount), 0) into v_have from care_partner_rewards
       where payment_id = pay.id and reward_type = 'clawback' and partner_id = r.partner_id and status <> 'reversed';
      if v_target < v_have then
        insert into care_partner_rewards (partner_id, business_id, payment_id, reward_type, base_amount, rate, amount, status, approve_after, approved_at, payout_month, note)
        values (r.partner_id, r.business_id, pay.id, 'clawback', -round(r.base_amount * v_frac, 2), r.rate, v_target - v_have,
                'approved', now(), now(), date_trunc('month', now() at time zone 'Asia/Kolkata')::date, 'Refund of a payment that had a reward');
      end if;
    end if;
  end loop;
end $$;
revoke all on function sehat_care_rewards_on_refund(uuid) from public, anon, authenticated;

-- Razorpay (webhook) or admin: record a refund. Idempotent per Razorpay refund id.
create or replace function sehat_payment_refund_record(p_razorpay_payment_id text, p_refund_id text, p_amount_paise bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare pay payments;
begin
  select * into pay from payments where razorpay_payment_id = p_razorpay_payment_id for update;
  if pay.id is null then return jsonb_build_object('ignored', 'no such payment'); end if;
  if p_refund_id is not null and p_refund_id = any(pay.razorpay_refund_ids) then return jsonb_build_object('ignored', 'already recorded'); end if;
  update payments set refunded_amount = least(coalesce(refunded_amount, 0) + coalesce(p_amount_paise, 0) / 100.0, amount),
         refunded_at = now(), razorpay_refund_ids = case when p_refund_id is null then razorpay_refund_ids else razorpay_refund_ids || p_refund_id end
   where id = pay.id;
  perform sehat_care_rewards_on_refund(pay.id);
  return jsonb_build_object('payment_id', pay.id, 'refunded', (select refunded_amount from payments where id = pay.id));
end $$;
revoke all on function sehat_payment_refund_record(text, text, bigint) from public, anon, authenticated;
grant execute on function sehat_payment_refund_record(text, text, bigint) to service_role;

create or replace function sehat_admin_payment_refund(p_payment uuid, p_amount numeric, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare pay payments;
begin
  if not coalesce(sehat_is_admin(), false) then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into pay from payments where id = p_payment for update;
  if pay.id is null or pay.status <> 'paid' then raise exception 'Only a paid payment can be refunded.' using errcode = 'P0001'; end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(pay.refunded_amount, 0) + p_amount > pay.amount then
    raise exception 'The refund must be more than 0 and not more than what is left of the payment.' using errcode = '22023';
  end if;
  update payments set refunded_amount = coalesce(refunded_amount, 0) + p_amount, refunded_at = now() where id = pay.id;
  perform sehat_care_rewards_on_refund(pay.id);
  perform sehat_log_staff_action('payment_refund_recorded', 'payment', pay.id, null, jsonb_build_object('amount', p_amount, 'note', p_note));
end $$;
revoke all on function sehat_admin_payment_refund(uuid, numeric, text) from public, anon;
grant execute on function sehat_admin_payment_refund(uuid, numeric, text) to authenticated;

-- ── 0255 lines: agency refunds online; care partners from their rewards ─────
create or replace function sehat_partner_lines(p_partner uuid, p_month date)
returns table (ref text, business_id uuid, business text, kind text, paid_on date, base numeric, percent numeric, incentive numeric, detail text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_kind text; v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  select mp.kind into v_kind from marketing_partners mp where mp.id = p_partner;
  if v_kind = 'care' then
    -- Approved rewards not yet on a statement whose payout month is this month or earlier (held ones carry forward).
    return query
      select 'rw:' || r.id, r.business_id, coalesce(b.name, '—'), r.reward_type,
             (coalesce(pay.created_at, r.created_at) at time zone 'Asia/Kolkata')::date, r.base_amount, r.rate, r.amount,
             case r.reward_type when 'start' then 'Start Reward' when 'renewal' then 'Renewal Reward' else 'Clawback' end
               || coalesce(' · invoice ' || i.invoice_number, '') || coalesce(' · ' || r.note, '')
        from care_partner_rewards r
        join care_partners cp on cp.id = r.partner_id and cp.marketing_partner_id = p_partner
        left join businesses b on b.id = r.business_id
        left join payments pay on pay.id = r.payment_id
        left join invoices i on i.payment_id = r.payment_id and i.status is distinct from 'cancelled'
       where r.status = 'approved' and r.statement_month is null and coalesce(r.payout_month, date_trunc('month', r.approved_at)::date) < v_end
       order by 5, 3;
    return;
  end if;
  return query
  with p as (select * from marketing_partners where id = p_partner),
  m as (select date_trunc('month', p_month)::date as a, v_end as z),
  mine as (select c.business_id, b.name from business_partner_credits c join businesses b on b.id = c.business_id
            where c.partner_id = p_partner and c.status = 'approved'),
  online as (
    select 'pay:' || pay.id as ref, mine.business_id, mine.name, 'payment'::text as kind,
           coalesce(i.invoice_date, (pay.created_at at time zone 'Asia/Kolkata')::date) as d,
           pay.taxable_value as base,
           'Plan' || coalesce(' · ' || pay.period_months || ' months', '') || coalesce(' · invoice ' || i.invoice_number, '') as detail
      from payments pay join mine on mine.business_id = pay.business_id
      left join invoices i on i.payment_id = pay.id and i.status is distinct from 'cancelled'
     where pay.status = 'paid' and pay.type in ('listing', 'subscription') and coalesce(pay.taxable_value, 0) > 0
  ),
  offline as (
    select 'off:' || o.id, mine.business_id, mine.name, 'payment', o.paid_at, o.amount_inr,
           'Received by ' || upper(coalesce(o.method, 'other')) || coalesce(' · ' || o.reference_no, '')
      from offline_payments o join mine on mine.business_id = o.business_id
     where o.purpose in ('pilot_registration', 'subscription') and coalesce(o.amount_inr, 0) > 0
  ),
  refunds as (
    select 'ref:' || o.id, mine.business_id, mine.name, 'refund', o.refunded_at, -o.refunded_amount,
           'Refund of the payment of ' || to_char(o.paid_at, 'DD Mon YYYY'), o.paid_at as earned_on
      from offline_payments o join mine on mine.business_id = o.business_id
     where o.purpose in ('pilot_registration', 'subscription') and coalesce(o.refunded_amount, 0) > 0 and o.refunded_at is not null
  ),
  -- 0335: online refunds too — the refunded share of the taxable value, in the refund's month.
  online_refunds as (
    select 'prf:' || pay.id, mine.business_id, mine.name, 'refund', (pay.refunded_at at time zone 'Asia/Kolkata')::date,
           -round(pay.taxable_value * least(pay.refunded_amount / nullif(pay.amount, 0), 1), 2),
           'Refund of the payment of ' || to_char(pay.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'),
           (pay.created_at at time zone 'Asia/Kolkata')::date as earned_on
      from payments pay join mine on mine.business_id = pay.business_id
     where pay.status = 'paid' and pay.type in ('listing', 'subscription') and coalesce(pay.refunded_amount, 0) > 0 and pay.refunded_at is not null
  ),
  everything as (
    select x.ref, x.business_id, x.name, x.kind, x.d, x.base, x.detail, x.d as earned_on from online x
    union all select o.*, o.paid_at from offline o
    union all select * from refunds
    union all select * from online_refunds
  )
  select e.ref, e.business_id, e.name, e.kind, e.d, e.base,
         sehat_partner_rate(p_partner, e.earned_on), round(e.base * sehat_partner_rate(p_partner, e.earned_on) / 100, 2), e.detail
    from everything e, p, m
   where e.d >= m.a and e.d < m.z
     and e.earned_on >= p.active_from and (p.active_to is null or e.earned_on <= p.active_to)
   order by e.d, e.name;
end $$;

-- ── Statements for care partners: checks, TDS, and the rewards they cover ───
create or replace function sehat_care_statement_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare p care_partners; v_min int := sehat_care_setting_int('min_payout', 500); v_fy_start date; v_fy_total numeric;
        v_rate numeric := (select nullif(value, '')::numeric from site_settings where key = 'partner_tds_rate');
        v_threshold numeric := (select nullif(value, '')::numeric from site_settings where key = 'partner_tds_threshold');
begin
  select cp.* into p from care_partners cp where cp.marketing_partner_id = new.partner_id;
  if p.id is null then return new; end if;   -- agency and field partners: unchanged
  if p.kyc_status <> 'verified' then raise exception 'Payout blocked: this partner''s PAN and bank details are not verified.' using errcode = 'P0001'; end if;
  if exists (select 1 from care_partner_contracts c where c.is_current
              and not exists (select 1 from care_partner_acceptances a where a.contract_id = c.id and a.partner_id = p.id)) then
    raise exception 'Payout blocked: the partner has not accepted the current agreement.' using errcode = 'P0001';
  end if;
  if coalesce(new.total, 0) < v_min then
    raise exception 'Below the minimum payout of ₹% — the rewards carry forward to next month.', v_min using errcode = 'P0001';
  end if;
  v_fy_start := make_date(extract(year from new.month - interval '3 months')::int, 4, 1);
  select coalesce(sum(total), 0) into v_fy_total from marketing_statements
   where partner_id = new.partner_id and month >= v_fy_start and month < v_fy_start + interval '1 year' and id is distinct from new.id;
  new.tds_amount := case when v_rate > 0 and v_fy_total + new.total > coalesce(v_threshold, 0) then round(new.total * v_rate / 100, 2) else 0 end;
  new.net_amount := new.total - new.tds_amount;
  return new;
end $$;
drop trigger if exists marketing_statements_care_checks on marketing_statements;
create trigger marketing_statements_care_checks before insert on marketing_statements
  for each row execute function sehat_care_statement_checks();

create or replace function sehat_care_statement_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from marketing_partners where id = new.partner_id and kind = 'care') then return new; end if;
  if tg_op = 'INSERT' then
    -- The rewards on this statement (left-out lines stay for a later month).
    update care_partner_rewards r set statement_month = new.month
     where r.statement_month is null and r.status = 'approved'
       and ('rw:' || r.id) in (select l ->> 'ref' from jsonb_array_elements(new.lines) l where not coalesce((l ->> 'excluded')::boolean, false));
  elsif new.status = 'paid' and old.status is distinct from 'paid' then
    update care_partner_rewards r set status = 'paid'
     where r.statement_month = new.month and r.status = 'approved'
       and r.partner_id = (select id from care_partners where marketing_partner_id = new.partner_id);
  end if;
  return new;
end $$;
drop trigger if exists marketing_statements_care_after on marketing_statements;
create trigger marketing_statements_care_after after insert or update on marketing_statements
  for each row execute function sehat_care_statement_after();

-- ── Nightly: approve rewards past the refund window, set levels ─────────────
create or replace function sehat_care_rewards_nightly()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_approved int; v_levels int := 0; p record; v_active int; v_level text;
        v_senior int := sehat_care_setting_int('level_senior', 10); v_elite int := sehat_care_setting_int('level_elite', 30);
begin
  update care_partner_rewards r set status = 'approved', approved_at = now()
   where r.status = 'pending' and r.approve_after <= now()
     and not exists (select 1 from payments pay where pay.id = r.payment_id and coalesce(pay.refunded_amount, 0) >= pay.amount);
  get diagnostics v_approved = row_count;
  for p in select cp.id, cp.level, cp.marketing_partner_id from care_partners cp where cp.marketing_partner_id is not null loop
    select count(*) into v_active from business_partner_credits c
     where c.partner_id = p.marketing_partner_id and c.status = 'approved'
       and exists (select 1 from payments pay where pay.business_id = c.business_id and pay.status = 'paid' and pay.term_end >= current_date);
    v_level := case when v_active >= v_elite then 'elite' when v_active >= v_senior then 'senior' else 'associate' end;
    -- Never up while a report about the partner is open; down is always applied.
    if v_level <> p.level and not (
         (case v_level when 'elite' then 3 when 'senior' then 2 else 1 end) > (case p.level when 'elite' then 3 when 'senior' then 2 else 1 end)
         and exists (select 1 from care_partner_reports rp where rp.partner_id = p.id and rp.status = 'open')) then
      update care_partners set level = v_level, updated_at = now() where id = p.id;
      v_levels := v_levels + 1;
    end if;
  end loop;
  return jsonb_build_object('approved', v_approved, 'levels_changed', v_levels);
end $$;
revoke all on function sehat_care_rewards_nightly() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'care-rewards-nightly';
    perform cron.schedule('care-rewards-nightly', '35 21 * * *', 'select sehat_care_rewards_nightly()');   -- 03:05 IST
  end if;
end $$;

-- ── KYC: PAN and bank in Vault ──────────────────────────────────────────────
create or replace function sehat_care_kyc_hash(p_kind text, p_value text)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to((select decrypted_secret from vault.decrypted_secrets where name = 'care_lead_pepper') || ':' || p_kind || ':' || upper(btrim(p_value)), 'UTF8')), 'hex')
$$;
revoke all on function sehat_care_kyc_hash(text, text) from public, anon, authenticated;

create or replace function sehat_care_kyc_submit(p_pan text, p_account text, p_ifsc text, p_holder text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; v_pan text := upper(btrim(coalesce(p_pan, ''))); v_acc text := regexp_replace(coalesce(p_account, ''), '\s', '', 'g');
        v_ifsc text := upper(btrim(coalesce(p_ifsc, ''))); v_name text := 'care_kyc_' || (select id from care_partners where user_id = auth.uid());
        v_secret uuid; v_ph text; v_bh text;
begin
  p := sehat_care_me_row();
  if p.id is null or p.partner_code is null then raise exception 'Get your Partner ID first.' using errcode = 'P0001'; end if;
  if p.kyc_status = 'verified' then raise exception 'Your details are already verified. Open a ticket to change them.' using errcode = 'P0001'; end if;
  if v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'Check your PAN (10 characters, like ABCDE1234F).' using errcode = '22023'; end if;
  if v_acc !~ '^[0-9]{9,18}$' then raise exception 'Check your bank account number.' using errcode = '22023'; end if;
  if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'Check the IFSC code (11 characters, like SBIN0001234).' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_holder, ''))) < 3 then raise exception 'Enter the account holder''s name.' using errcode = '22023'; end if;
  v_ph := sehat_care_kyc_hash('PAN', v_pan);
  v_bh := sehat_care_kyc_hash('BANK', v_ifsc || ':' || v_acc);
  if exists (select 1 from care_partners where pan_hash = v_ph and id <> p.id) then raise exception 'This PAN is already used by another partner.' using errcode = 'P0001'; end if;
  if exists (select 1 from care_partners where bank_hash = v_bh and id <> p.id) then raise exception 'This bank account is already used by another partner.' using errcode = 'P0001'; end if;
  select id into v_secret from vault.secrets where name = v_name;
  if v_secret is null then
    perform vault.create_secret(jsonb_build_object('pan', v_pan, 'account', v_acc, 'ifsc', v_ifsc, 'holder', btrim(p_holder))::text, v_name, 'Care Partner PAN and bank (0335)');
  else
    perform vault.update_secret(v_secret, jsonb_build_object('pan', v_pan, 'account', v_acc, 'ifsc', v_ifsc, 'holder', btrim(p_holder))::text);
  end if;
  update care_partners set pan_hash = v_ph, bank_hash = v_bh, pan_last4 = right(v_pan, 4), bank_last4 = right(v_acc, 4),
         kyc_status = 'submitted', kyc_verified_at = null, updated_at = now()
   where id = p.id;
  return jsonb_build_object('kyc_status', 'submitted', 'pan_last4', right(v_pan, 4), 'bank_last4', right(v_acc, 4));
end $$;
revoke all on function sehat_care_kyc_submit(text, text, text, text) from public, anon;
grant execute on function sehat_care_kyc_submit(text, text, text, text) to authenticated;

create or replace function sehat_is_admin_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(sehat_is_admin(), false)
     and exists (select 1 from admin_users a where a.auth_uid = auth.uid() and a.role = 'owner' and coalesce(a.is_active, true))
$$;
revoke all on function sehat_is_admin_owner() from public, anon, authenticated;

-- The full PAN and bank details — owner admins only, every read logged.
create or replace function sehat_admin_care_kyc_details(p_partner uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p care_partners; v jsonb;
begin
  if not sehat_is_admin_owner() then raise exception 'Only an owner admin can see full PAN and bank details.' using errcode = '42501'; end if;
  select * into p from care_partners where id = p_partner;
  if p.id is null then raise exception 'No such partner.' using errcode = 'P0002'; end if;
  select decrypted_secret::jsonb into v from vault.decrypted_secrets where name = 'care_kyc_' || p.id;
  perform sehat_log_staff_action('care_kyc_viewed', 'care_partner', p.id, p.full_name, null);
  return coalesce(v, '{}'::jsonb) || jsonb_build_object('full_name', p.full_name, 'partner_code', p.partner_code, 'kyc_status', p.kyc_status);
end $$;
revoke all on function sehat_admin_care_kyc_details(uuid) from public, anon;
grant execute on function sehat_admin_care_kyc_details(uuid) to authenticated;

create or replace function sehat_admin_care_kyc_set(p_partner uuid, p_verified boolean, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare p care_partners;
begin
  perform sehat_care_admin_only();
  select * into p from care_partners where id = p_partner;
  if p.id is null or p.kyc_status = 'not_started' then raise exception 'Nothing submitted to check.' using errcode = 'P0001'; end if;
  if not p_verified and btrim(coalesce(p_note, '')) = '' then raise exception 'Say what is wrong, so the partner can fix it.' using errcode = '22023'; end if;
  update care_partners set kyc_status = case when p_verified then 'verified' else 'rejected' end,
         kyc_verified_at = case when p_verified then now() end, status_reason = case when p_verified then status_reason else 'KYC: ' || btrim(p_note) end,
         updated_at = now()
   where id = p.id;
  perform sehat_log_staff_action(case when p_verified then 'care_kyc_verified' else 'care_kyc_rejected' end, 'care_partner', p.id, p.full_name, jsonb_build_object('note', p_note));
end $$;
revoke all on function sehat_admin_care_kyc_set(uuid, boolean, text) from public, anon;
grant execute on function sehat_admin_care_kyc_set(uuid, boolean, text) to authenticated;

-- Finalised, unpaid care statements with bank details, for the bank upload. Owner admins only; logged.
create or replace function sehat_admin_care_payout_export(p_month date)
returns table (partner_code text, full_name text, month date, gross numeric, tds numeric, net numeric,
               holder text, account text, ifsc text, pan text)
language plpgsql volatile security definer set search_path = public as $$
begin
  if not sehat_is_admin_owner() then raise exception 'Only an owner admin can export payout details.' using errcode = '42501'; end if;
  perform sehat_log_staff_action('care_payout_export', 'payout', null, to_char(p_month, 'Mon YYYY'), null);
  return query
    select cp.partner_code, cp.full_name, s.month, s.total, s.tds_amount, s.net_amount,
           k.v ->> 'holder', k.v ->> 'account', k.v ->> 'ifsc', k.v ->> 'pan'
      from marketing_statements s
      join care_partners cp on cp.marketing_partner_id = s.partner_id
      left join lateral (select decrypted_secret::jsonb as v from vault.decrypted_secrets where name = 'care_kyc_' || cp.id) k on true
     where s.month = date_trunc('month', p_month)::date and s.status = 'final'
     order by cp.full_name;
end $$;
revoke all on function sehat_admin_care_payout_export(date) from public, anon;
grant execute on function sehat_admin_care_payout_export(date) to authenticated;

-- Admin overview: what is owed, KYC to check, statements.
create or replace function sehat_admin_care_money()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform sehat_care_admin_only();
  return jsonb_build_object(
    'pending', (select coalesce(sum(amount), 0) from care_partner_rewards where status = 'pending'),
    'approved_unpaid', (select coalesce(sum(amount), 0) from care_partner_rewards where status = 'approved'),
    'paid', (select coalesce(sum(amount), 0) from care_partner_rewards where status = 'paid'),
    'kyc_queue', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'partner_code', p.partner_code,
        'pan_last4', p.pan_last4, 'bank_last4', p.bank_last4, 'updated_at', p.updated_at) order by p.updated_at)
      from care_partners p where p.kyc_status = 'submitted'), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(jsonb_build_object('partner_code', cp.partner_code, 'full_name', cp.full_name, 'month', s.month,
        'gross', s.total, 'tds', s.tds_amount, 'net', s.net_amount, 'status', s.status, 'paid_on', s.paid_on, 'reference', s.paid_reference)
        order by s.month desc, cp.full_name)
      from marketing_statements s join care_partners cp on cp.marketing_partner_id = s.partner_id), '[]'::jsonb),
    'partners_with_rewards', coalesce((select jsonb_agg(jsonb_build_object('partner_code', cp.partner_code, 'full_name', cp.full_name, 'level', cp.level,
        'kyc_status', cp.kyc_status, 'approved', x.approved, 'pending', x.pending))
      from care_partners cp join (select partner_id, sum(amount) filter (where status = 'approved') approved, sum(amount) filter (where status = 'pending') pending
                                    from care_partner_rewards group by partner_id) x on x.partner_id = cp.id), '[]'::jsonb));
end $$;
revoke all on function sehat_admin_care_money() from public, anon;
grant execute on function sehat_admin_care_money() to authenticated;

-- ── The partner's own money view ────────────────────────────────────────────
create or replace function sehat_care_my_money()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p care_partners;
begin
  p := sehat_care_me_row();
  if p.id is null then return null; end if;
  return jsonb_build_object(
    'level', p.level, 'kyc_status', p.kyc_status, 'pan_last4', p.pan_last4, 'bank_last4', p.bank_last4,
    'status_reason', case when p.kyc_status = 'rejected' then p.status_reason end,
    'min_payout', sehat_care_setting_int('min_payout', 500),
    'totals', jsonb_build_object(
      'pending', (select coalesce(sum(amount), 0) from care_partner_rewards where partner_id = p.id and status = 'pending'),
      'approved', (select coalesce(sum(amount), 0) from care_partner_rewards where partner_id = p.id and status = 'approved'),
      'paid', (select coalesce(sum(amount), 0) from care_partner_rewards where partner_id = p.id and status = 'paid')),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'business', b.name, 'type', r.reward_type, 'base', r.base_amount,
        'rate', r.rate, 'amount', r.amount, 'status', r.status, 'approve_after', r.approve_after, 'created_at', r.created_at, 'note', r.note,
        'payout_month', r.payout_month)
        order by r.created_at desc)
      from care_partner_rewards r left join businesses b on b.id = r.business_id where r.partner_id = p.id), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(jsonb_build_object('month', s.month, 'gross', s.total, 'tds', s.tds_amount, 'net', s.net_amount,
        'status', s.status, 'paid_on', s.paid_on, 'reference', s.paid_reference) order by s.month desc)
      from marketing_statements s where s.partner_id = p.marketing_partner_id), '[]'::jsonb));
end $$;
revoke all on function sehat_care_my_money() from public, anon;
grant execute on function sehat_care_my_money() to authenticated;

notify pgrst, 'reload schema';
