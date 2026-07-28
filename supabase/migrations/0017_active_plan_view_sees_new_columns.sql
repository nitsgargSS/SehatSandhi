-- ============================================================================
-- Sehatsandhi — rebuild active_pricing_plan so it exposes the headcount columns
--
-- Run AFTER 0016. Safe to re-run.
--
-- 0016 added included_doctors and extra_doctor_price to pricing_plans. The
-- function returns the table's row type, so it picked them up — but the view
-- over it did not. A view's column list is fixed when it is created, and
-- CREATE OR REPLACE VIEW cannot change it. So active_pricing_plan kept serving
-- the old column set, resolveActivePlan defaulted the two new fields to 1 and 0,
-- and headcount pricing would have been silently dead: every hospital quoted as
-- though it had one consultant, with nothing in any log to say why.
--
-- Caught by a test that read the columns back rather than trusting the ALTER.
--
-- Both views are dropped and rebuilt. pricing_plan_status is reproduced exactly
-- as 0009 defined it, plus nothing — it selects p.*, so it gains the new columns
-- by itself once it is recreated.
-- ============================================================================

-- subscription_renewals_due also reads it (0006). Dropping in dependency order
-- rather than with CASCADE, so that a view I have forgotten about causes a loud
-- failure here instead of vanishing silently.
drop view if exists subscription_renewals_due;
drop view if exists pricing_plan_status;
drop view if exists active_pricing_plan;

create view active_pricing_plan as
  select * from sehat_active_pricing_plan();

create view pricing_plan_status as
select
  p.*,

  -- Every listing ever locked onto this plan. Seat caps count this.
  (select count(*) from doctors d
    where d.pricing_plan_code = p.code)                            as signups_used,

  -- Still live and still inside the term they paid for. A plan with zero here
  -- affects nobody today, whatever its history.
  (select count(*) from doctors d
    where d.pricing_plan_code = p.code
      and d.status = 'active'
      and (d.term_end is null or d.term_end >= current_date))      as active_enrolled,

  -- Locked onto the plan but the term has run out — they renew onto whatever is
  -- live then, so they are no reason to keep this plan.
  (select count(*) from doctors d
    where d.pricing_plan_code = p.code
      and d.term_end is not null
      and d.term_end < current_date)                               as expired_enrolled,

  (select max(d.locked_at) from doctors d
    where d.pricing_plan_code = p.code)                            as last_signup_at,

  case when p.max_signups is null then null
       else greatest(p.max_signups - (select count(*) from doctors d
                                       where d.pricing_plan_code = p.code), 0)
  end                                                              as seats_left,

  -- Safe to remove: nobody has ever been on it. Anything else should be
  -- disabled instead, so its history stays readable.
  ((select count(*) from doctors d where d.pricing_plan_code = p.code) = 0)
                                                                   as can_delete,

  (select code from active_pricing_plan)                           as active_code,
  (p.code = (select code from active_pricing_plan))                as is_currently_active
from pricing_plans p
order by p.sequence, p.code;

revoke all on pricing_plan_status from anon, authenticated;

-- The public pages quote from this, so it stays readable with the anon key.
grant select on active_pricing_plan to anon, authenticated;

-- Recreated exactly as 0006 defined it. It selects named columns from the plan,
-- so it neither gains nor needs the headcount ones.
create view subscription_renewals_due as
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
