-- ============================================================================
-- Sehatsandhi — WhatsApp marketing for clinics, phase 1
--
-- Run AFTER 0115. Independent of 0114. Safe to re-run.
--
-- A clinic pays us to broadcast approved WhatsApp templates to its own
-- patients who agreed to hear from it. Phase 1 is everything that does not
-- need AiSensy's Partner API: prices, the clinic's wallet and its top-ups, the
-- template library, the audience, and the broadcast record with the money
-- taken for it. Actually sending is phase 2, and until then
-- whatsapp_marketing_settings.sending_enabled stays false and a broadcast
-- cannot be created — so no clinic is ever charged for a message that no code
-- is there to send.
--
-- ── WHO OWNS IT ─────────────────────────────────────────────────────────────
-- The business, not a doctor. The plan was written against a `doctors` table
-- that 0037 replaced with businesses + practitioners; the WhatsApp number, the
-- wallet and the subscription belong to the clinic or hospital, and its owner
-- or manager (sehat_caller_is_business) runs them.
--
-- ── PRICES ──────────────────────────────────────────────────────────────────
-- One settings row, admin-editable. A change applies to every clinic from its
-- next bill or its next message (decided 25 Sep 2026), so nothing is locked
-- per clinic. per_message_paise defaults to 159 (₹1.59): the plan's 15900
-- would have been ₹159 a message.
--
-- ── CONSENT IS PER CLINIC ───────────────────────────────────────────────────
-- patients.consent_status is one flag per phone for the whole platform; it
-- cannot say WHICH clinic a patient agreed to hear from. patient_consents can
-- (0047 added business_id and purpose), and sehat_has_consent reads it. So the
-- audience is: this clinic's active patients whose latest 'marketing' consent,
-- for this clinic or unscoped, is granted — and whose phone is not in
-- opt_outs. One message per phone, however many family members share it.
--
-- ── THE WALLET ──────────────────────────────────────────────────────────────
-- Paise, never negative (CHECK). Every movement is a row in the ledger with
-- the balance after it, so the balance can always be re-derived. A top-up is
-- credited once per payment (UNIQUE payment_id), whichever of the browser or
-- the webhook arrives first. It can be spent only on our own services: a
-- closed-system instrument. Refunding balances to a bank account is not built
-- — confirm the RBI position with a CA before adding it.
-- ============================================================================

-- ── Settings ────────────────────────────────────────────────────────────────
create table if not exists whatsapp_marketing_settings (
  id boolean primary key default true check (id),
  monthly_subscription_paise integer not null default 200000 check (monthly_subscription_paise >= 0),
  onboarding_fee_paise integer not null default 50000 check (onboarding_fee_paise >= 0),
  onboarding_fee_label text not null default 'WhatsApp Business Verification & Activation Fee',
  per_message_paise integer not null default 159 check (per_message_paise > 0),
  grace_days integer not null default 7 check (grace_days between 0 and 60),
  -- Off until phase 2 connects AiSensy. While off, no broadcast can be created.
  sending_enabled boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into whatsapp_marketing_settings (id) values (true) on conflict do nothing;

alter table whatsapp_marketing_settings enable row level security;
revoke all on whatsapp_marketing_settings from anon;
grant select, update on whatsapp_marketing_settings to authenticated;

-- Clinics read the prices (their dashboard shows them); only admins change them.
drop policy if exists "signed_in_reads_wa_marketing_settings" on whatsapp_marketing_settings;
create policy "signed_in_reads_wa_marketing_settings" on whatsapp_marketing_settings
  for select using (auth.uid() is not null);
drop policy if exists "admins_update_wa_marketing_settings" on whatsapp_marketing_settings;
create policy "admins_update_wa_marketing_settings" on whatsapp_marketing_settings
  for update using (sehat_is_admin()) with check (sehat_is_admin());

-- ── The clinic's WhatsApp account ───────────────────────────────────────────
create table if not exists business_wa_accounts (
  business_id uuid primary key references businesses(id) on delete cascade,
  waba_id text,
  whatsapp_number text,
  status text not null default 'pending'
    check (status in ('pending','live','suspended')),
  subscription_status text not null default 'inactive'
    check (subscription_status in ('inactive','active','past_due','paused')),
  -- When a monthly charge first failed. Broadcasts keep working until
  -- past_due_since + grace_days, then stop (decided 25 Sep 2026).
  past_due_since timestamptz,
  onboarding_fee_paid_at timestamptz,
  subscription_started_at timestamptz,
  next_billing_date date,
  onboarded_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table business_wa_accounts enable row level security;
revoke all on business_wa_accounts from anon;
grant select, insert, update on business_wa_accounts to authenticated;

drop policy if exists "business_reads_own_wa_account" on business_wa_accounts;
create policy "business_reads_own_wa_account" on business_wa_accounts
  for select using (sehat_caller_is_business(business_id) or sehat_is_admin());
drop policy if exists "admins_insert_wa_accounts" on business_wa_accounts;
create policy "admins_insert_wa_accounts" on business_wa_accounts
  for insert with check (sehat_is_admin());
drop policy if exists "admins_update_wa_accounts" on business_wa_accounts;
create policy "admins_update_wa_accounts" on business_wa_accounts
  for update using (sehat_is_admin()) with check (sehat_is_admin());

-- ── Wallet ──────────────────────────────────────────────────────────────────
create table if not exists business_wallets (
  business_id uuid primary key references businesses(id) on delete cascade,
  balance_paise integer not null default 0 check (balance_paise >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists business_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null check (type in ('recharge','message_send','refund','adjustment')),
  -- Positive in, negative out.
  amount_paise integer not null check (amount_paise <> 0),
  balance_after_paise integer not null check (balance_after_paise >= 0),
  payment_id uuid unique references payments(id),
  broadcast_id uuid,
  note text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists business_wallet_tx_business_idx
  on business_wallet_transactions (business_id, created_at desc);

alter table business_wallets enable row level security;
alter table business_wallet_transactions enable row level security;
revoke all on business_wallets from anon;
revoke all on business_wallet_transactions from anon;
-- Read only. Every write goes through the security-definer functions below.
grant select on business_wallets to authenticated;
grant select on business_wallet_transactions to authenticated;

drop policy if exists "business_reads_own_wallet" on business_wallets;
create policy "business_reads_own_wallet" on business_wallets
  for select using (sehat_caller_is_business(business_id) or sehat_is_admin());
drop policy if exists "business_reads_own_wallet_tx" on business_wallet_transactions;
create policy "business_reads_own_wallet_tx" on business_wallet_transactions
  for select using (sehat_caller_is_business(business_id) or sehat_is_admin());

-- ── Templates: a fixed, pre-approved library ────────────────────────────────
-- WhatsApp only delivers a business-initiated message outside the 24-hour
-- window if the template was approved by Meta. Clinics pick from these; they
-- cannot write their own. `approved` is flipped by an admin once Meta has
-- approved the template under our account.
create table if not exists wa_message_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null check (category in ('utility','marketing')),
  body text not null,                       -- {{1}}, {{2}} … placeholders
  placeholders text[] not null default '{}', -- a label per placeholder, in order
  approved boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wa_message_templates enable row level security;
revoke all on wa_message_templates from anon;
grant select, insert, update on wa_message_templates to authenticated;

drop policy if exists "signed_in_reads_wa_templates" on wa_message_templates;
create policy "signed_in_reads_wa_templates" on wa_message_templates
  for select using (auth.uid() is not null);
drop policy if exists "admins_insert_wa_templates" on wa_message_templates;
create policy "admins_insert_wa_templates" on wa_message_templates
  for insert with check (sehat_is_admin());
drop policy if exists "admins_update_wa_templates" on wa_message_templates;
create policy "admins_update_wa_templates" on wa_message_templates
  for update using (sehat_is_admin()) with check (sehat_is_admin());

-- {{1}} is always the clinic's name, filled in by us, so a clinic cannot
-- present itself as somebody else.
insert into wa_message_templates (code, name, category, body, placeholders, sort_order) values
  ('appointment_reminder', 'Appointment reminder', 'utility',
   'Namaste from {{1}}. This is a reminder to book your follow-up visit. {{2}} To book, reply here or call us.',
   array['Clinic name','Message, e.g. "Your check-up is due this month."'], 10),
  ('clinic_notice', 'Clinic closure / notice', 'utility',
   'Namaste from {{1}}. Please note: {{2}}',
   array['Clinic name','Notice, e.g. "The clinic is closed on 2 Oct for Gandhi Jayanti."'], 20),
  ('health_camp', 'Health camp announcement', 'marketing',
   'Namaste from {{1}}. We are holding a {{2}} on {{3}} at {{4}}. Everyone is welcome.',
   array['Clinic name','Camp, e.g. "free eye check-up camp"','Date and time','Place'], 30),
  ('new_service', 'New service announcement', 'marketing',
   'Namaste from {{1}}. We now offer {{2}}. Reply here to know more or to book.',
   array['Clinic name','Service, e.g. "physiotherapy on Saturdays"'], 40),
  ('health_advice', 'General health advice', 'marketing',
   'Health tip from {{1}}: {{2}}',
   array['Clinic name','Advice, e.g. "Drink boiled water during the monsoon."'], 50)
on conflict (code) do nothing;

-- ── Broadcasts ──────────────────────────────────────────────────────────────
create table if not exists wa_broadcasts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  template_id uuid not null references wa_message_templates(id),
  params text[] not null default '{}',      -- {{2}} onwards, in order
  pin_codes text[] not null default '{}',
  recipient_count integer not null check (recipient_count > 0),
  rate_paise integer not null,
  total_cost_paise integer not null,
  wallet_transaction_id uuid references business_wallet_transactions(id),
  status text not null default 'queued'
    check (status in ('queued','sending','sent','partly_sent','failed')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists wa_broadcasts_business_idx on wa_broadcasts (business_id, created_at desc);

create table if not exists wa_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references wa_broadcasts(id) on delete cascade,
  patient_member_id uuid references patient_members(id) on delete set null,
  phone text not null,
  status text not null default 'queued'
    check (status in ('queued','sent','failed','refunded')),
  error text,
  sent_at timestamptz,
  unique (broadcast_id, phone)
);

alter table wa_broadcasts enable row level security;
alter table wa_broadcast_recipients enable row level security;
revoke all on wa_broadcasts from anon;
revoke all on wa_broadcast_recipients from anon;
grant select on wa_broadcasts to authenticated;
grant select on wa_broadcast_recipients to authenticated;

drop policy if exists "business_reads_own_broadcasts" on wa_broadcasts;
create policy "business_reads_own_broadcasts" on wa_broadcasts
  for select using (sehat_caller_is_business(business_id) or sehat_is_admin());
drop policy if exists "business_reads_own_broadcast_recipients" on wa_broadcast_recipients;
create policy "business_reads_own_broadcast_recipients" on wa_broadcast_recipients
  for select using (exists (
    select 1 from wa_broadcasts b where b.id = broadcast_id
       and (sehat_caller_is_business(b.business_id) or sehat_is_admin())));

-- ── updated_at ──────────────────────────────────────────────────────────────
drop trigger if exists business_wa_accounts_touch on business_wa_accounts;
create trigger business_wa_accounts_touch before update on business_wa_accounts
  for each row execute function sehat_touch_updated_at();
drop trigger if exists wa_message_templates_touch on wa_message_templates;
create trigger wa_message_templates_touch before update on wa_message_templates
  for each row execute function sehat_touch_updated_at();
drop trigger if exists whatsapp_marketing_settings_touch on whatsapp_marketing_settings;
create trigger whatsapp_marketing_settings_touch before update on whatsapp_marketing_settings
  for each row execute function sehat_touch_updated_at();

-- ── payments can be a wallet top-up ─────────────────────────────────────────
alter table payments drop constraint if exists payments_type_check;
alter table payments add constraint payments_type_check
  check (type in ('subscription','premium_slot','listing','wallet_topup'));

-- ============================================================================
-- Functions
-- ============================================================================

-- The audience: who this clinic may message. One row per phone.
create or replace function sehat_marketing_audience(p_business uuid, p_pins text[] default null)
returns table (patient_member_id uuid, full_name text, phone text, pin_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (sehat_caller_is_business(p_business) or sehat_is_admin()
          or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only the clinic''s owner or manager can do this.' using errcode = '42501';
  end if;
  return query
  select distinct on (p.phone)
         m.id, m.full_name, p.phone, p.pin_code
    from business_patients bp
    join patient_members m on m.id = bp.patient_member_id
    join patients p on p.id = m.patient_id
   where bp.business_id = p_business
     and bp.status = 'active'
     and coalesce(m.status, 'active') = 'active'
     and p.phone ~ '^91[6-9][0-9]{9}$'
     and sehat_has_consent(m.id, 'marketing', p_business)
     and not exists (select 1 from opt_outs o where o.phone_hash = sehat_phone_hash(p.phone))
     and (p_pins is null or cardinality(p_pins) = 0 or p.pin_code = any(p_pins))
   order by p.phone, m.is_self desc nulls last, m.full_name;
end $$;

-- The PIN picker: how many reachable patients live in each PIN.
create or replace function sehat_marketing_audience_pins(p_business uuid)
returns table (pin_code text, patients bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(a.pin_code, ''), count(*)
    from sehat_marketing_audience(p_business, null) a
   group by 1 order by 2 desc, 1;
$$;

-- May this clinic broadcast right now? Returns null when yes, else the reason.
create or replace function sehat_wa_broadcast_blocker(p_business uuid)
returns text
language sql stable security definer set search_path = public as $$
  with s as (select * from whatsapp_marketing_settings where id),
       a as (select * from business_wa_accounts where business_id = p_business)
  select case
    when not (select sending_enabled from s)
      then 'Sending starts once WhatsApp is connected. Nothing has been charged.'
    when not exists (select 1 from a)
      then 'WhatsApp marketing is not set up for this clinic yet.'
    when (select status from a) <> 'live'
      then 'Your WhatsApp number is not live yet.'
    when (select subscription_status from a) = 'active' then null
    when (select subscription_status from a) = 'past_due'
         and (select past_due_since from a) + make_interval(days => (select grace_days from s)) > now()
      then null
    when (select subscription_status from a) = 'past_due'
      then 'Your monthly WhatsApp fee is unpaid, so broadcasts are paused until it is paid.'
    else 'Your WhatsApp marketing subscription is not active.'
  end;
$$;

-- Create a broadcast and take the money for it, in one transaction.
--
-- The recipients are re-derived from the audience here, never trusted from
-- the browser: a phone that is not consented, or belongs to another clinic,
-- is dropped whatever the screen sent. The price is read here too.
create or replace function sehat_create_wa_broadcast(
  p_business uuid, p_template uuid, p_params text[], p_members uuid[], p_pins text[] default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_block text;
  v_tpl wa_message_templates;
  v_rate integer;
  v_count integer;
  v_cost integer;
  v_balance integer;
  v_tx uuid;
  v_b uuid;
begin
  if not sehat_caller_is_business(p_business) then
    raise exception 'Only the clinic''s owner or manager can send broadcasts.' using errcode = '42501';
  end if;

  v_block := sehat_wa_broadcast_blocker(p_business);
  if v_block is not null then raise exception '%', v_block; end if;

  select * into v_tpl from wa_message_templates where id = p_template;
  if v_tpl.id is null or not v_tpl.is_active or not v_tpl.approved then
    raise exception 'That template is not available.';
  end if;
  -- {{1}} is the clinic name, so the clinic fills {{2}} onwards.
  if coalesce(array_length(p_params, 1), 0) <> greatest(cardinality(v_tpl.placeholders) - 1, 0)
     or exists (select 1 from unnest(p_params) x where btrim(x) = '') then
    raise exception 'Fill in every blank in the message.';
  end if;

  select per_message_paise into v_rate from whatsapp_marketing_settings where id;

  drop table if exists _aud;
  create temp table _aud on commit drop as
    select a.* from sehat_marketing_audience(p_business, p_pins) a
     where a.patient_member_id = any(p_members);
  select count(*) into v_count from _aud;
  if v_count = 0 then raise exception 'No patients selected.'; end if;
  v_cost := v_count * v_rate;

  -- Lock the wallet row so two broadcasts cannot both spend the same money.
  insert into business_wallets (business_id) values (p_business) on conflict do nothing;
  select balance_paise into v_balance from business_wallets
   where business_id = p_business for update;
  if v_balance < v_cost then
    raise exception 'Not enough balance: this needs ₹%, the wallet has ₹%. Top up to send.',
      to_char(v_cost / 100.0, 'FM999999990.00'), to_char(v_balance / 100.0, 'FM999999990.00');
  end if;

  update business_wallets set balance_paise = balance_paise - v_cost, updated_at = now()
   where business_id = p_business;

  insert into wa_broadcasts (business_id, template_id, params, pin_codes, recipient_count,
                             rate_paise, total_cost_paise, created_by)
  values (p_business, p_template, p_params, coalesce(p_pins, '{}'), v_count, v_rate, v_cost, auth.uid())
  returning id into v_b;

  insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise,
                                            broadcast_id, note, created_by)
  values (p_business, 'message_send', -v_cost, v_balance - v_cost, v_b,
          v_count || ' × ' || v_tpl.name, auth.uid()::text)
  returning id into v_tx;
  update wa_broadcasts set wallet_transaction_id = v_tx where id = v_b;

  insert into wa_broadcast_recipients (broadcast_id, patient_member_id, phone)
  select v_b, patient_member_id, phone from _aud;

  return jsonb_build_object('broadcast_id', v_b, 'recipients', v_count,
                            'cost_paise', v_cost, 'balance_paise', v_balance - v_cost);
end $$;

-- Credit a paid top-up. Idempotent: the UNIQUE payment_id means the browser
-- and the webhook can both call this and the money lands once.
create or replace function sehat_wallet_credit_topup(p_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pay payments;
  v_paise integer;
  v_balance integer;
begin
  select * into v_pay from payments where id = p_payment_id;
  if v_pay.id is null or v_pay.type <> 'wallet_topup' then
    raise exception 'not a wallet top-up: %', p_payment_id;
  end if;
  if v_pay.status <> 'paid' then raise exception 'payment % is not paid', p_payment_id; end if;

  if exists (select 1 from business_wallet_transactions where payment_id = p_payment_id) then
    select balance_paise into v_balance from business_wallets where business_id = v_pay.business_id;
    return jsonb_build_object('credited', false, 'balance_paise', v_balance);
  end if;

  v_paise := round(v_pay.amount * 100)::integer;
  insert into business_wallets (business_id) values (v_pay.business_id) on conflict do nothing;
  update business_wallets set balance_paise = balance_paise + v_paise, updated_at = now()
   where business_id = v_pay.business_id
   returning balance_paise into v_balance;

  insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise,
                                            payment_id, note, created_by)
  values (v_pay.business_id, 'recharge', v_paise, v_balance, p_payment_id,
          'Top-up via Razorpay', 'razorpay');

  return jsonb_build_object('credited', true, 'balance_paise', v_balance);
end $$;

-- Admin correction: a refund or a manual credit/debit, always with a reason.
create or replace function sehat_admin_wallet_adjust(p_business uuid, p_amount_paise integer, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_amount_paise = 0 then raise exception 'Enter an amount.'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Give a reason.'; end if;

  insert into business_wallets (business_id) values (p_business) on conflict do nothing;
  select balance_paise into v_balance from business_wallets where business_id = p_business for update;
  if v_balance + p_amount_paise < 0 then
    raise exception 'That would take the wallet below zero (balance ₹%).',
      to_char(v_balance / 100.0, 'FM999999990.00');
  end if;
  update business_wallets set balance_paise = v_balance + p_amount_paise, updated_at = now()
   where business_id = p_business;
  insert into business_wallet_transactions (business_id, type, amount_paise, balance_after_paise, note, created_by)
  values (p_business, 'adjustment', p_amount_paise, v_balance + p_amount_paise, btrim(p_note),
          (select email from auth.users where id = auth.uid()));
  return jsonb_build_object('balance_paise', v_balance + p_amount_paise);
end $$;

-- Admin reports 1–3 in one row per clinic that has touched the feature.
create or replace function sehat_admin_wa_marketing_report()
returns table (
  business_id uuid, business_name text, wa_status text, subscription_status text,
  onboarded_at timestamptz, opted_in bigint,
  sent_this_month bigint, sent_all_time bigint, last_sent_at timestamptz,
  balance_paise integer, recharged_paise bigint, spent_paise bigint, last_recharge_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not sehat_is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return query
  with biz as (
    select id from businesses b where
      exists (select 1 from business_wa_accounts a where a.business_id = b.id)
      or exists (select 1 from business_wallets w where w.business_id = b.id)
  )
  select b.id, b.name, a.status, a.subscription_status, a.onboarded_at,
         (select count(*) from sehat_marketing_audience(b.id, null)),
         (select coalesce(sum(x.recipient_count), 0) from wa_broadcasts x
           where x.business_id = b.id and x.created_at >= date_trunc('month', now())),
         (select coalesce(sum(x.recipient_count), 0) from wa_broadcasts x where x.business_id = b.id),
         (select max(x.created_at) from wa_broadcasts x where x.business_id = b.id),
         coalesce(w.balance_paise, 0),
         (select coalesce(sum(t.amount_paise), 0) from business_wallet_transactions t
           where t.business_id = b.id and t.type = 'recharge'),
         (select coalesce(-sum(t.amount_paise), 0) from business_wallet_transactions t
           where t.business_id = b.id and t.type = 'message_send'),
         (select max(t.created_at) from business_wallet_transactions t
           where t.business_id = b.id and t.type = 'recharge')
    from biz
    join businesses b on b.id = biz.id
    left join business_wa_accounts a on a.business_id = b.id
    left join business_wallets w on w.business_id = b.id
   order by b.name;
end $$;

-- ── Grants, per 0088: revoke both, grant what is called from outside ────────
revoke all on function sehat_marketing_audience(uuid, text[])            from public, anon, authenticated;
grant execute on function sehat_marketing_audience(uuid, text[])         to authenticated;
revoke all on function sehat_marketing_audience_pins(uuid)               from public, anon, authenticated;
grant execute on function sehat_marketing_audience_pins(uuid)            to authenticated;
revoke all on function sehat_wa_broadcast_blocker(uuid)                  from public, anon, authenticated;
grant execute on function sehat_wa_broadcast_blocker(uuid)               to authenticated;
revoke all on function sehat_create_wa_broadcast(uuid, uuid, text[], uuid[], text[]) from public, anon, authenticated;
grant execute on function sehat_create_wa_broadcast(uuid, uuid, text[], uuid[], text[]) to authenticated;
revoke all on function sehat_wallet_credit_topup(uuid)                   from public, anon, authenticated;
-- service role only: called by fulfilment after a verified payment.
revoke all on function sehat_admin_wallet_adjust(uuid, integer, text)    from public, anon, authenticated;
grant execute on function sehat_admin_wallet_adjust(uuid, integer, text) to authenticated;
revoke all on function sehat_admin_wa_marketing_report()                 from public, anon, authenticated;
grant execute on function sehat_admin_wa_marketing_report()              to authenticated;

notify pgrst, 'reload schema';
