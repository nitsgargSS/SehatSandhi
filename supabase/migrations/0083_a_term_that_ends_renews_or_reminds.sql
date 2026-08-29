-- ============================================================================
-- Sehatsandhi — a term that ends either renews itself or asks to be renewed
--
-- Run AFTER 0082. Safe to re-run.
--
-- 0082 said what a term costs. This says what happens when it runs out. Every
-- business is in exactly one of two states and each needs different machinery:
--
--   auto_renew = true   → a mandate charges them. They still get a notice
--                         BEFORE the debit, because the RBI requires one.
--   auto_renew = false  → nobody charges them, so they must be asked, by email
--                         and on WhatsApp, starting 15 days out.
--
-- ── THE CHECKBOX IS TICKED, AND UNTICKING IT MUST WORK ──────────────────────
-- auto_renew defaults to true: the box is pre-selected at registration, as
-- asked. That default is only defensible while turning it off is genuinely
-- easy — a pre-ticked box you cannot find again is the thing consumer-protection
-- rules exist about. So the column is writable by the business itself (policy
-- below), not admin-only, and the dashboard gets a toggle. A business that
-- unticks it at registration never acquires a mandate at all.
--
-- ── WHY A PRE-DEBIT NOTICE FOR THE AUTO-RENEWERS TOO ────────────────────────
-- The request was reminders for the people who opted OUT. Both are built here
-- anyway, because under the RBI's e-mandate framework a recurring debit needs a
-- notification to the customer at least 24 hours before it is taken, carrying
-- the amount and the date. That is not an embellishment; skipping it makes the
-- debit non-compliant. It is a different message from the renewal reminder —
-- "we are about to charge you" rather than "please pay" — so it is a separate
-- kind with its own copy.
--
-- ── PRICE IS STAMPED, NOT LOOKED UP AT THE LAST MINUTE ──────────────────────
-- renewal_price is written onto the business when it pays, and the renewal
-- charges THAT. It is not re-read from plan_terms at renewal time, for the same
-- reason 0006 stamps locked_monthly_price: a price change must never silently
-- re-price somebody mid-relationship, and a mandate is authorised for an amount
-- the customer agreed to. An admin who wants to change what a business renews at
-- updates renewal_price, and the notice that goes out says the new number —
-- which is what "option to change anytime" has to mean if it is to be honest.
--
-- ── THE REMINDER TABLE IS NOT notification_outbox ───────────────────────────
-- notification_outbox is appointment-shaped: it has a NOT NULL-ish
-- appointment_id FK, carries a phone and no email, and 0075's drain claims and
-- sends every pending row through the appointment campaign. A billing reminder
-- has no appointment, needs an email address as well as a phone, and must not
-- be picked up by that drain. It gets its own table and its own sender.
-- ============================================================================


-- ============================================================================
-- 1. What a business has agreed to
-- ============================================================================

alter table businesses add column if not exists auto_renew boolean not null default true;
alter table businesses add column if not exists renewal_term_months integer;
alter table businesses add column if not exists renewal_price integer;

comment on column businesses.auto_renew is
  'Ticked by default at registration. False means no mandate is taken and the '
  'business is reminded to pay instead. Writable by the business itself.';
comment on column businesses.renewal_term_months is
  'Length the next term will be, stamped at purchase. Normally the term they '
  'bought: six renews into six, twelve into twelve.';
comment on column businesses.renewal_price is
  'Whole rupees, ex-GST, the next renewal charges. Stamped at purchase and NOT '
  're-read from plan_terms, so a later price change cannot silently re-price an '
  'existing business. Change it here to change what they renew at.';

-- The mandate itself. Nothing here is populated until Razorpay Subscriptions is
-- live on the account; a business with mandate_status 'none' and auto_renew
-- true is simply one whose mandate has not been taken yet, which is the state
-- every business is in today.
alter table businesses add column if not exists razorpay_customer_id text;
alter table businesses add column if not exists razorpay_subscription_id text;
alter table businesses add column if not exists mandate_status text not null default 'none';
alter table businesses add column if not exists mandate_max_amount integer;

do $$ begin
  alter table businesses add constraint businesses_mandate_status_check
    check (mandate_status in ('none','pending','active','cancelled','halted','paused')) not valid;
exception when duplicate_object then null; end $$;

comment on column businesses.mandate_status is
  'none → never authorised. pending → sent to Razorpay, customer has not '
  'approved. active → will charge. cancelled/halted/paused → will not; the '
  'business falls back to being reminded.';
comment on column businesses.mandate_max_amount is
  'Ceiling the customer authorised, in whole rupees. A renewal above this needs '
  'a fresh mandate — set it above renewal_price deliberately so a modest '
  'increase does not force re-authorisation.';

create index if not exists businesses_renewal_due_idx
  on businesses (term_end)
  where status = 'active' and term_end is not null;


-- ============================================================================
-- 2. When to ask
--
-- A settings row rather than a constant, because "15 days" is a marketing
-- decision that will be argued about. An array, because "it will start sending
-- 15 days before" implies it may not stop there: add 7 and 1 to the array and
-- three reminders go out, with no code change and no migration.
-- ============================================================================

create table if not exists billing_settings (
  id boolean primary key default true check (id),
  reminder_days_before integer[] not null default '{15}',
  pre_debit_notice_days integer not null default 2 check (pre_debit_notice_days >= 1),
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into billing_settings (id) values (true) on conflict (id) do nothing;

comment on table billing_settings is
  'Single row. reminder_days_before lists how many days ahead of term_end each '
  'renewal reminder goes to businesses that opted out of auto-renewal. '
  'pre_debit_notice_days is the RBI notice for those that did not — 2 rather '
  'than 1 so a failed send still has a day to retry inside the 24h minimum.';

alter table billing_settings enable row level security;

drop policy if exists billing_settings_admin_all on billing_settings;
create policy billing_settings_admin_all on billing_settings
  using (sehat_is_admin()) with check (sehat_is_admin());

-- Read is admin-only too: unlike prices, nothing public renders this.
grant select, update on billing_settings to authenticated;
grant all on billing_settings to service_role;


-- ============================================================================
-- 3. The queue
-- ============================================================================

create table if not exists billing_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,

  -- renewal_reminder   → "your plan ends on X, here is the link to pay"
  -- pre_debit_notice   → "we will charge ₹X on Y" (RBI, auto-renewers only)
  -- renewal_charged    → receipt after a successful mandate debit
  -- renewal_failed     → the debit did not go through, pay manually
  kind text not null,

  -- The term this is about. Together with kind and days_before it is what makes
  -- re-running the queue job idempotent — see the unique index below.
  term_end date not null,
  days_before integer,

  -- Copied at queue time, not joined at send time: an invoice-grade record of
  -- what we told them and where we sent it.
  amount integer,
  email text,
  phone text,

  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  sent_email_at timestamptz,
  sent_whatsapp_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table billing_notifications add constraint billing_notifications_kind_check
    check (kind in ('renewal_reminder','pre_debit_notice','renewal_charged','renewal_failed')) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table billing_notifications add constraint billing_notifications_status_check
    check (status in ('pending','sending','sent','failed','skipped')) not valid;
exception when duplicate_object then null; end $$;

-- One notice per business per term per kind per offset. This is the whole
-- defence against the daily job queueing a duplicate every morning for fifteen
-- mornings — the insert simply does nothing on the second day.
create unique index if not exists billing_notifications_once_idx
  on billing_notifications (business_id, kind, term_end, coalesce(days_before, -1));

create index if not exists billing_notifications_pending_idx
  on billing_notifications (created_at) where status in ('pending','sending');

comment on table billing_notifications is
  'Renewal reminders and pre-debit notices. Separate from notification_outbox, '
  'which is appointment-shaped, phone-only, and drained by 0075 through the '
  'appointment campaign.';

alter table billing_notifications enable row level security;

-- A business may read its own — the dashboard shows "reminder sent on X" — but
-- may not write them; only the queue job and the sender do that.
drop policy if exists billing_notifications_own_read on billing_notifications;
create policy billing_notifications_own_read on billing_notifications
  for select using (business_id in (select sehat_caller_business_ids()) or sehat_is_admin());

drop policy if exists billing_notifications_admin_all on billing_notifications;
create policy billing_notifications_admin_all on billing_notifications
  using (sehat_is_admin()) with check (sehat_is_admin());

grant select on billing_notifications to authenticated;
grant all    on billing_notifications to service_role;


-- ============================================================================
-- 4. A business may turn auto-renewal off itself
--
-- 0078's lesson: sehat_caller_owns_business() means "works here", not "is in
-- charge here", so it is the wrong test for a commercial decision. Billing
-- belongs to an owner or a manager, the same people 0077 let edit a
-- registration number.
--
-- Deliberately narrow: this RPC sets ONE column. Widening the businesses UPDATE
-- policy to admit auto_renew would have handed the same caller every other
-- column on the row, including locked_monthly_price and term_end.
-- ============================================================================

create or replace function sehat_set_auto_renew(p_business uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := sehat_caller_role(p_business);
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'Only an owner or a manager can change auto-renewal'
      using errcode = '42501';
  end if;

  update businesses
     set auto_renew = p_on,
         updated_at = now()
   where id = p_business;

  -- Turning it off does not cancel the mandate at Razorpay — only the edge
  -- function can do that, and it reads this flag. Marking it here would claim
  -- something that has not happened yet.
  return p_on;
end;
$$;

comment on function sehat_set_auto_renew is
  'Owner/manager only. Sets businesses.auto_renew and nothing else. Cancelling '
  'the mandate at Razorpay is the caller''s next step, not this function''s.';

grant execute on function sehat_set_auto_renew(uuid, boolean) to authenticated;


-- ============================================================================
-- 5. Queueing the notices
--
-- Runs daily. Everything it does is idempotent: the unique index absorbs a
-- second run, so a retry, a manual invocation and the cron firing twice all
-- produce the same single row.
-- ============================================================================

create or replace function sehat_queue_billing_notices()
returns table (kind text, queued integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_days   integer[];
  v_notice integer;
  v_d      integer;
  v_n      integer;
begin
  select reminder_days_before, pre_debit_notice_days
    into v_days, v_notice
    from billing_settings where id;

  v_days   := coalesce(v_days, '{15}');
  v_notice := coalesce(v_notice, 2);

  -- ── Opted out: please pay ────────────────────────────────────────────────
  foreach v_d in array v_days loop
    insert into billing_notifications
      (business_id, kind, term_end, days_before, amount, email, phone, payload)
    select b.id, 'renewal_reminder', b.term_end, v_d,
           coalesce(b.renewal_price, b.locked_monthly_price),
           b.email, b.phone,
           jsonb_build_object(
             'business_name', b.name,
             'term_end',      b.term_end,
             'months',        b.renewal_term_months,
             'days_before',   v_d)
      from businesses b
     where b.status = 'active'
       and b.term_end is not null
       and not b.auto_renew
       and b.term_end = v_today + v_d
    on conflict do nothing;

    get diagnostics v_n = row_count;
    kind := 'renewal_reminder'; queued := v_n; return next;
  end loop;

  -- ── Opted in: we are about to charge you ─────────────────────────────────
  -- Only where a mandate can actually take money. auto_renew with no active
  -- mandate is not a debit about to happen, and telling them otherwise would be
  -- a lie followed by a silent expiry.
  insert into billing_notifications
    (business_id, kind, term_end, days_before, amount, email, phone, payload)
  select b.id, 'pre_debit_notice', b.term_end, v_notice,
         coalesce(b.renewal_price, b.locked_monthly_price),
         b.email, b.phone,
         jsonb_build_object(
           'business_name', b.name,
           'term_end',      b.term_end,
           'debit_on',      b.term_end,
           'months',        b.renewal_term_months)
    from businesses b
   where b.status = 'active'
     and b.term_end is not null
     and b.auto_renew
     and b.mandate_status = 'active'
     and b.term_end = v_today + v_notice
  on conflict do nothing;

  get diagnostics v_n = row_count;
  kind := 'pre_debit_notice'; queued := v_n; return next;
end;
$$;

comment on function sehat_queue_billing_notices is
  'Daily. Queues renewal reminders for businesses that opted out, and RBI '
  'pre-debit notices for those with a live mandate. Idempotent — the unique '
  'index makes a repeat run a no-op.';

revoke all on function sehat_queue_billing_notices() from public;
grant execute on function sehat_queue_billing_notices() to service_role;


-- ============================================================================
-- 6. Schedule it
--
-- 07:30 Asia/Kolkata. The server runs in UTC, so 02:00 UTC. Deliberately a
-- morning hour: a reminder that lands at 3am is read at 9am anyway and looks
-- like it came from a machine that does not know what time it is.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('queue-billing-notices')
      where exists (select 1 from cron.job where jobname = 'queue-billing-notices');

    perform cron.schedule(
      'queue-billing-notices',
      '0 2 * * *',
      $cron$ select sehat_queue_billing_notices(); $cron$
    );
  else
    raise notice 'pg_cron not installed — schedule queue-billing-notices by hand';
  end if;
end $$;


notify pgrst, 'reload schema';
