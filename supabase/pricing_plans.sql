-- ============================================================================
-- Sehatsandhi — pricing plans: a queue you toggle, instead of editing prices
--
-- Run AFTER supabase/schema.sql. Safe to re-run.
--
-- THE PROBLEM THIS SOLVES
-- Changing what businesses pay used to mean editing pricing_tiers rows AND
-- redeploying the hardcoded mirror in the frontend. Now prices live in plans;
-- switching plan is one row update and the site follows.
--
-- PLANS ARE A QUEUE, NOT A SWITCH
-- Each plan has a sequence, an optional signup cap and an optional date window.
-- The active plan is the first enabled plan whose window is open and whose cap
-- is not yet filled — so the 51st business rolls onto the next plan by itself.
-- An explicit override in pricing_settings beats the queue when you want manual
-- control.
--
--   seq 1  launch_1000    ₹1,000/mo   term 5 months   cap 50 businesses
--   seq 2  growth_2000    ₹2,000/mo   term 3 months   no cap
--   seq 3  pincode_tiers  by population tier          no cap
--
-- EVERYTHING IS A MONTHLY RATE × MONTHS
-- Plans store only a monthly price. The number of months is chosen at checkout
-- (bounded by the plan) so a business can pay 5 months upfront. Total is always
-- derived: monthly × months.
--
-- PRICE IS LOCKED FOR THE TERM PAID, NOT FOREVER
-- On payment the listing is stamped with the plan, the monthly price and the
-- term dates. A later toggle never re-prices an existing business mid-term. At
-- term_end they are quoted whatever plan is active then, with the next term
-- starting from term_end — see subscription_renewals_due.
--
-- MONTHLY AND COMMISSION ARE INDEPENDENT
-- A vertical can pay a monthly fee, a commission, both, or neither. This
-- supersedes vertical_billing.billing_model (the either/or enum added earlier),
-- which is migrated below and kept only for reference. "Charge doctors 5% on
-- surgeries while they also pay monthly" is now an admin edit, not a schema
-- change.
-- ============================================================================

-- ============================================================================
-- pricing_plans
-- ============================================================================

create table if not exists pricing_plans (
  code text primary key,                   -- 'launch_1000', 'growth_2000', 'pincode_tiers'
  label text not null,                     -- shown on /business and in admin
  description text,                        -- one line of sales copy for the pricing card
  sequence integer not null default 100,   -- queue order; lowest open plan wins

  -- how the monthly amount is computed
  mode text not null default 'pincode_tiers',
  monthly_price integer,                   -- required for the flat modes; null for tiers

  -- term: how many months a business may buy upfront
  default_months integer not null default 1,
  min_months integer not null default 1,
  max_months integer not null default 12,

  -- capacity: null = unlimited. Counted from listings locked onto this plan.
  max_signups integer,

  -- which verticals this plan's monthly price applies to. null = all of them.
  applies_to_verticals text[],

  -- while this plan is active, do NOT charge the per-vertical commission
  suspend_commission boolean not null default false,

  is_enabled boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$ begin
  alter table pricing_plans add constraint pricing_plans_mode_check
    check (mode in ('flat_all_pincodes', 'flat_per_pincode', 'pincode_tiers')) not valid;
exception when duplicate_object then null; end $$;

-- A flat plan without a price would silently charge ₹0.
do $$ begin
  alter table pricing_plans add constraint pricing_plans_flat_needs_price
    check (mode = 'pincode_tiers' or monthly_price is not null) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table pricing_plans add constraint pricing_plans_months_sane
    check (min_months >= 1 and max_months >= min_months
           and default_months between min_months and max_months) not valid;
exception when duplicate_object then null; end $$;

create index if not exists pricing_plans_sequence_idx on pricing_plans (sequence) where is_enabled;

-- Also defined in patients.sql; repeated so this file stands alone.
create or replace function sehat_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists pricing_plans_touch_updated_at on pricing_plans;
create trigger pricing_plans_touch_updated_at before update on pricing_plans
  for each row execute function sehat_touch_updated_at();

-- ============================================================================
-- pricing_settings — single row. The manual override that beats the queue.
-- ============================================================================

create table if not exists pricing_settings (
  id boolean primary key default true,
  override_plan_code text references pricing_plans(code),
  updated_by text,
  updated_at timestamptz default now(),
  constraint pricing_settings_single_row check (id)
);

insert into pricing_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================================
-- pricing_plan_events — audit. Every activation and edit, with who did it.
-- The admin password is compiled into the frontend bundle, so this log is how
-- an unwanted price change gets noticed and traced.
-- ============================================================================

create table if not exists pricing_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_code text,
  action text not null,                    -- created | edited | enabled | disabled | override_set | override_cleared | tier_price_changed
  actor text,
  detail jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists pricing_plan_events_created_idx on pricing_plan_events (created_at desc);

-- ============================================================================
-- Seed the queue described above. Re-running updates prices but never wipes
-- which plan is enabled, so a live toggle survives a re-run of this file.
-- ============================================================================

insert into pricing_plans
  (code, label, description, sequence, mode, monthly_price,
   default_months, min_months, max_months, max_signups, suspend_commission, notes)
values
  ('launch_1000', 'Launch offer — ₹1,000/month',
   'Every pincode included, for your first months on Sehatsandhi.',
   1, 'flat_all_pincodes', 1000, 5, 1, 12, 50, true,
   'Founding offer while we build patient density. Applies to all six verticals; commission suspended.'),

  ('growth_2000', 'Growth — ₹2,000/month',
   'All pincodes included while we grow patient numbers in your area.',
   2, 'flat_all_pincodes', 2000, 3, 1, 12, null, true,
   'Takes over automatically once launch_1000 fills its 50 seats.'),

  ('pincode_tiers', 'Pay for reach — priced by pincode',
   'Each pincode is priced by its population. Your total is the sum of the pincodes you pick.',
   3, 'pincode_tiers', null, 1, 1, 12, null, false,
   'The long-run model: tier prices live in pricing_tiers and are editable from admin.')
on conflict (code) do update
  set label            = excluded.label,
      description      = excluded.description,
      sequence         = excluded.sequence,
      mode             = excluded.mode,
      monthly_price    = excluded.monthly_price,
      default_months   = excluded.default_months,
      min_months       = excluded.min_months,
      max_months       = excluded.max_months,
      max_signups      = excluded.max_signups,
      suspend_commission = excluded.suspend_commission;
      -- is_enabled deliberately NOT overwritten

-- ============================================================================
-- vertical_billing — split the either/or enum into two independent dimensions.
--
-- monthly_enabled     : does this vertical pay the plan's monthly price?
-- commission_percent  : what we take of their billing; 0 means none.
--
-- Both can be on at once. That is the point — later you may want doctors on a
-- monthly fee AND a percentage of surgeries.
-- ============================================================================

alter table vertical_billing add column if not exists monthly_enabled boolean default true;
alter table vertical_billing add column if not exists commission_enabled boolean default false;

-- Backfill from the old enum, once.
update vertical_billing
   set monthly_enabled    = (billing_model = 'pincode_monthly'),
       commission_enabled = (billing_model = 'commission')
 where monthly_enabled is null or commission_enabled is null
    or (billing_model = 'commission' and commission_enabled = false)
    or (billing_model = 'pincode_monthly' and monthly_enabled = false);

comment on column vertical_billing.billing_model is
  'LEGACY. Superseded by monthly_enabled + commission_enabled, which can both be true. '
  'Kept for reference only; the edge functions no longer read it.';

-- Basis text for the verticals that may get a commission later, so switching
-- one on from admin does not also require writing copy.
update vertical_billing set commission_basis = 'surgery and procedure billing'
 where vertical in ('doctors', 'hospital') and commission_basis is null;
update vertical_billing set commission_basis = 'test billing'
 where vertical = 'lab' and commission_basis is null;

-- ============================================================================
-- doctors — the price lock. Written on successful payment, never by the client.
-- ============================================================================

alter table doctors add column if not exists pricing_plan_code text references pricing_plans(code);
alter table doctors add column if not exists locked_monthly_price integer;
alter table doctors add column if not exists locked_mode text;
alter table doctors add column if not exists months_paid integer;
alter table doctors add column if not exists term_start date;
alter table doctors add column if not exists term_end date;
alter table doctors add column if not exists locked_at timestamptz;

create index if not exists doctors_plan_idx     on doctors (pricing_plan_code);
create index if not exists doctors_term_end_idx on doctors (term_end);

-- ============================================================================
-- payments — what was actually sold, so a charge can be reconciled later even
-- if the plan has since changed.
-- ============================================================================

alter table payments add column if not exists pricing_plan_code text;
alter table payments add column if not exists monthly_price integer;
alter table payments add column if not exists pricing_mode text;
alter table payments add column if not exists term_start date;
alter table payments add column if not exists term_end date;

-- ============================================================================
-- Resolution — which plan applies right now.
--
-- SECURITY DEFINER because the seat count reads `doctors`, where RLS only shows
-- anon callers the active listings. Counting under the caller's RLS would miss
-- pending signups and hand out more launch seats than exist.
-- ============================================================================

create or replace function sehat_active_pricing_plan()
returns pricing_plans
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_override text;
  v_plan pricing_plans;
begin
  select override_plan_code into v_override from pricing_settings where id;

  if v_override is not null then
    select * into v_plan from pricing_plans where code = v_override;
    if found then return v_plan; end if;
  end if;

  select p.* into v_plan
    from pricing_plans p
   where p.is_enabled
     and (p.starts_at is null or p.starts_at <= now())
     and (p.ends_at   is null or p.ends_at   >  now())
     and (p.max_signups is null
          or (select count(*) from doctors d where d.pricing_plan_code = p.code) < p.max_signups)
   order by p.sequence, p.code
   limit 1;

  return v_plan;   -- null when nothing is configured; callers fall back to tiers
end $$;

-- Readable by the site so the landing page and wizard quote the live plan.
create or replace view active_pricing_plan as
  select * from sehat_active_pricing_plan();

-- Seat usage, for the admin plan list.
create or replace view pricing_plan_status as
select
  p.*,
  (select count(*) from doctors d where d.pricing_plan_code = p.code)            as signups_used,
  case when p.max_signups is null then null
       else greatest(p.max_signups - (select count(*) from doctors d
                                       where d.pricing_plan_code = p.code), 0)
  end                                                                             as seats_left,
  (select code from active_pricing_plan)                                          as active_code,
  (p.code = (select code from active_pricing_plan))                               as is_currently_active
from pricing_plans p
order by p.sequence, p.code;

-- ============================================================================
-- Renewals — who is due, and what they would pay next.
--
-- The next term starts at term_end, not at the date they happen to pay, so a
-- business that renews late does not get free days and one that renews early
-- does not lose any.
-- ============================================================================

create or replace view subscription_renewals_due as
select
  d.id                                    as doctor_id,
  d.name,
  d.speciality,
  d.phone,
  d.pricing_plan_code                     as current_plan,
  d.locked_monthly_price                  as current_monthly_price,
  d.months_paid,
  d.term_start,
  d.term_end,
  (d.term_end - current_date)             as days_remaining,
  d.term_end                              as next_term_start,
  ap.code                                 as renewal_plan,
  ap.label                                as renewal_plan_label,
  ap.mode                                 as renewal_mode,
  ap.monthly_price                        as renewal_monthly_price,
  ap.default_months                       as renewal_default_months
from doctors d
cross join lateral (select * from active_pricing_plan) ap
where d.term_end is not null
order by d.term_end;

-- ============================================================================
-- RLS
--
-- Plans and tier prices are public-readable — the site has to quote them. All
-- writes are service-role only: the admin password is compiled into the
-- frontend bundle (VITE_ADMIN_PASS), so an anon write policy here would let
-- anyone on the internet re-price the platform. Admin changes go through the
-- admin-pricing edge function instead.
-- ============================================================================

alter table pricing_plans       enable row level security;
alter table pricing_settings    enable row level security;
alter table pricing_plan_events enable row level security;

drop policy if exists "read_pricing_plans" on pricing_plans;
create policy "read_pricing_plans" on pricing_plans for select using (is_enabled);

-- no policies on pricing_settings / pricing_plan_events → service-role only
revoke all on pricing_settings, pricing_plan_events from anon, authenticated;

grant select on active_pricing_plan to anon, authenticated;
revoke all  on pricing_plan_status, subscription_renewals_due from anon, authenticated;

-- ============================================================================
-- OPERATING IT
--
-- Which plan is live right now, and how many seats are left:
--   select code, label, mode, monthly_price, signups_used, seats_left,
--          is_currently_active
--     from pricing_plan_status;
--
-- Force a specific plan (beats the queue):
--   update pricing_settings set override_plan_code = 'growth_2000',
--          updated_by = 'nitin', updated_at = now() where id;
--
-- Hand control back to the queue:
--   update pricing_settings set override_plan_code = null where id;
--
-- Change a price — takes effect for NEW registrations only:
--   update pricing_plans set monthly_price = 1500 where code = 'launch_1000';
--
-- Change how many launch seats exist:
--   update pricing_plans set max_signups = 75 where code = 'launch_1000';
--
-- Switch to pincode pricing whenever traction justifies it:
--   update pricing_settings set override_plan_code = 'pincode_tiers' where id;
--   -- then tune the tiers themselves:
--   update pricing_tiers set monthly_price = 1200 where tier_number = 3;
--
-- Turn on a commission for doctors, on top of whatever they pay monthly:
--   update vertical_billing
--      set commission_enabled = true, commission_percent = 5,
--          commission_basis = 'surgery and procedure billing'
--    where vertical = 'doctors';
--
-- Who renews in the next 30 days, and at what:
--   select name, phone, term_end, current_monthly_price,
--          renewal_plan, renewal_monthly_price
--     from subscription_renewals_due
--    where days_remaining between 0 and 30;
-- ============================================================================
