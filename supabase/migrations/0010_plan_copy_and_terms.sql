-- ============================================================================
-- Sehatsandhi — take prices out of plan COPY, and stop pre-committing a term
--
-- Run AFTER 0009. Safe to re-run.
--
-- TWO BUGS THIS FIXES
--
-- 1. The price was written into the plan's label: 'Launch offer — ₹1,000/month'.
--    /business renders that label as its pricing headline and renders the real
--    number from monthly_price just below it. So editing the price in admin
--    changed the card to ₹2,500 while the headline still promised ₹1,000 —
--    two different prices on one screen, the wrong one written larger.
--
--    Labels are now names, never amounts. The check constraint below is what
--    keeps it that way: nobody can reintroduce a price into copy, from admin or
--    from the SQL editor. Every rupee figure on the site comes from
--    monthly_price / pricing_tiers, so a price change is one number in one place.
--
-- 2. default_months was 5, and the wizard preselected it. A business that just
--    wanted one month had to notice the picker and change it, and the landing
--    page advertised the 5-month total as though it were the offer. Nobody is
--    being asked for five months upfront.
--
--    default_months is now only a HIGHLIGHT — it marks one term as best value.
--    It never preselects; the wizard always opens at min_months and the total
--    follows what the business actually picks. Setting it to min_months (the
--    default now) means "no highlight at all".
-- ============================================================================

-- ── 1. Strip prices out of existing plan copy ──────────────────────────────
-- Only the seeded rows are rewritten by name. Any plan created from admin is
-- left alone here and simply has to satisfy the constraint below.

update pricing_plans set
  label       = 'Launch offer',
  description = 'Every pincode included, for your first months on Sehatsandhi.'
where code = 'launch_1000';

update pricing_plans set
  label       = 'Growth plan',
  description = 'All pincodes included while we grow patient numbers in your area.'
where code = 'growth_2000';

update pricing_plans set
  label       = 'Pay for reach',
  description = 'Each pincode is priced by its population. Your total is the sum of the pincodes you pick.'
where code = 'pincode_tiers';

-- Anything else that still carries a rupee figure: strip the trailing
-- "— ₹x,xxx/month" clause rather than refusing to migrate.
update pricing_plans
   set label = btrim(regexp_replace(label, '\s*[—–-]?\s*(₹|[Rr]s\.?)\s*[0-9][0-9,]*\s*(/|per\s+)?\s*(mo|month)?\.?', '', 'g'))
 where label ~ '₹' or label ~* 'rs\.?\s*[0-9]';

update pricing_plans
   set description = btrim(regexp_replace(description, '\s*[—–-]?\s*(₹|[Rr]s\.?)\s*[0-9][0-9,]*\s*(/|per\s+)?\s*(mo|month)?\.?', '', 'g'))
 where description ~ '₹' or description ~* 'rs\.?\s*[0-9]';

-- A label emptied by that strip would render as a blank headline.
update pricing_plans set label = code where btrim(coalesce(label, '')) = '';

-- ── 2. Keep prices out of copy, permanently ────────────────────────────────
-- Validated (not NOT VALID): the updates above have already cleaned every row,
-- so this is enforced from now on for admin edits and hand-written SQL alike.
-- admin-pricing returns a readable message before it ever reaches this.

alter table pricing_plans drop constraint if exists pricing_plans_copy_has_no_price;
alter table pricing_plans add constraint pricing_plans_copy_has_no_price
  check (
        label       !~ '₹' and label       !~* 'rs\.?\s*[0-9]'
    and coalesce(description, '') !~ '₹'
    and coalesce(description, '') !~* 'rs\.?\s*[0-9]'
  );

comment on column pricing_plans.label is
  'Plan NAME only — never an amount. Prices render from monthly_price; a price in '
  'the label would contradict the card next to it. Enforced by '
  'pricing_plans_copy_has_no_price.';

-- ── 3. default_months is a highlight, not a commitment ─────────────────────

comment on column pricing_plans.default_months is
  'Term highlighted as best value in the checkout picker. Does NOT preselect: '
  'the wizard always opens at min_months so nobody is pre-committed to a long '
  'term. Set equal to min_months for no highlight.';

-- Nobody is being quoted a 5-month term by default. The picker still offers
-- min_months..max_months, and a business that wants 5 months picks 5.
update pricing_plans set default_months = min_months where default_months > min_months;

insert into pricing_plan_events (plan_code, action, actor, detail)
values (null, 'edited', 'migration 0010', jsonb_build_object(
  'change', 'stripped prices from plan labels/descriptions; default_months reset to min_months',
  'reason', 'headline copy contradicted the live price; 5-month term was preselected'
));
