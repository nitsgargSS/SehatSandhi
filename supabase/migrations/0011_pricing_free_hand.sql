-- ============================================================================
-- Sehatsandhi — the price is one number, and only a person changes it
--
-- Run AFTER 0010. Safe to re-run.
--
-- 0010 took prices out of plan LABELS but left them in the plan CODES:
-- 'launch_1000' and 'growth_2000'. The admin screen prints the code beside the
-- price, so every screen still read "launch_1000 · ₹1,000" and looked hardcoded
-- even though the number was editable. A code is permanent — it is stamped onto
-- doctors.pricing_plan_code at payment — so a price inside one is a price you
-- can never correct. They are renamed here while nobody is enrolled; after the
-- first paid listing this would mean rewriting history.
--
-- The seat cap was the bigger problem. launch_1000 capped at 50 signups, and the
-- queue advances by itself when a cap fills — so the 51st business would have
-- been quoted ₹2,000 with nobody deciding that. A cap is a fine tool when you
-- ask for one, but it must never be the reason a price moves on its own. The
-- cap is cleared; set one from admin whenever you actually want it.
--
-- After this, exactly one thing changes what a business is quoted: someone
-- typing a number in Admin → Billing.
-- ============================================================================

-- ── 1. Codes carry no price ────────────────────────────────────────────────
-- Verify nobody is enrolled before touching a primary key that gets stamped
-- onto listings and payments. If any plan has ever been paid for, stop.

do $$
declare v_used bigint;
begin
  select coalesce(sum(signups_used), 0) into v_used from pricing_plan_status;
  if v_used > 0 then
    raise exception
      'plans already have % signup(s) — renaming a plan code would orphan paid listings. '
      'Leave the codes alone and rename only the labels.', v_used;
  end if;
end $$;

update pricing_settings set override_plan_code = null
 where override_plan_code in ('launch_1000', 'growth_2000');

update pricing_plans set code = 'launch'   where code = 'launch_1000';
update pricing_plans set code = 'standard' where code = 'growth_2000';

-- Same rule as labels: no amount inside an identifier that can never be edited.
alter table pricing_plans drop constraint if exists pricing_plans_code_has_no_price;
alter table pricing_plans add constraint pricing_plans_code_has_no_price
  check (code !~ '[0-9]{3,}');

comment on column pricing_plans.code is
  'Permanent identifier, stamped onto doctors.pricing_plan_code at payment. Never '
  'contains an amount — the price it refers to is editable, the code is not. '
  'Enforced by pricing_plans_code_has_no_price.';

-- ── 2. Nothing re-prices without a person ──────────────────────────────────
-- A cap makes the queue advance to the next plan by itself, which changes what
-- new businesses are quoted with no one deciding it. Cleared, not removed: the
-- column stays so a cap can be set deliberately from admin.

update pricing_plans set max_signups = null where max_signups is not null;

comment on column pricing_plans.max_signups is
  'Optional. When set, the plan stops being offered after this many signups and '
  'the queue moves to the next one — which CHANGES THE PRICE with no human '
  'action. Leave null unless that is exactly what you want.';

insert into pricing_plan_events (plan_code, action, actor, detail)
values (null, 'edited', 'migration 0011', jsonb_build_object(
  'change', 'renamed launch_1000 to launch and growth_2000 to standard; cleared all seat caps',
  'reason', 'prices embedded in permanent codes, and a seat cap that re-priced without anyone deciding'
));
