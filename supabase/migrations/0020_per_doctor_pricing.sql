-- ============================================================================
-- Sehatsandhi — charge a hospital per doctor
--
-- Run AFTER 0019. Safe to re-run.
--
-- 0016 billed hospitals as base-plus-extra: three consultants inside the base
-- price, a smaller amount for each one after. Three doctors therefore cost the
-- base ₹1,000, which is what was tested and reported as wrong. The wanted model
-- is simpler — every doctor costs a full monthly rate, so three cost ₹3,000.
--
-- WHY A MODE RATHER THAN NEW NUMBERS
-- The same result could be had by setting included_doctors = 1 and
-- extra_doctor_price = 1000, and it would be wrong the first time the monthly
-- price changed: the rate would move to ₹2,500 while each extra doctor stayed
-- ₹1,000. A mode keeps one editable price driving the whole bill, which is the
-- point that has been made repeatedly about not scattering amounts around.
--
--   none              headcount is ignored — every non-hospital listing
--   per_doctor        coverage price × number of doctors
--   base_plus_extra   the 0016 model, kept because it is a reasonable offer
--                     to make later and costs nothing to keep
--
-- NOTE FOR THE NEXT PERSON ADDING A COLUMN HERE
-- A view's column list is fixed when it is created, so a new pricing_plans
-- column does NOT appear in active_pricing_plan until the view is rebuilt —
-- and rebuilding needs its dependents dropped first, in order. This caught 0016
-- and left headcount pricing silently dead. The rebuild is repeated below.
-- ============================================================================

alter table pricing_plans
  add column if not exists doctor_billing text not null default 'none';

do $$ begin
  alter table pricing_plans add constraint pricing_plans_doctor_billing_check
    check (doctor_billing in ('none', 'per_doctor', 'base_plus_extra')) not valid;
exception when duplicate_object then null; end $$;

comment on column pricing_plans.doctor_billing is
  'How a hospital''s headcount affects its bill. none = ignored (every solo '
  'listing). per_doctor = coverage price × doctors. base_plus_extra = '
  'included_doctors covered, extra_doctor_price each after. Only ever consulted '
  'for a listing that belongs to an organisation.';

-- What was asked for: every doctor costs a full monthly rate.
update pricing_plans set doctor_billing = 'per_doctor' where doctor_billing = 'none';

-- ── Rebuild the views so the new column is visible ─────────────────────────
-- Dependency order, not CASCADE, so a view nobody remembered fails loudly.

drop view if exists subscription_renewals_due;
drop view if exists pricing_plan_status;
drop view if exists active_pricing_plan;

create view active_pricing_plan as
  select * from sehat_active_pricing_plan();

create view pricing_plan_status as
select
  p.*,
  (select count(*) from doctors d
    where d.pricing_plan_code = p.code)                            as signups_used,
  (select count(*) from doctors d
    where d.pricing_plan_code = p.code
      and d.status = 'active'
      and (d.term_end is null or d.term_end >= current_date))      as active_enrolled,
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
  ((select count(*) from doctors d where d.pricing_plan_code = p.code) = 0)
                                                                   as can_delete,
  (select code from active_pricing_plan)                           as active_code,
  (p.code = (select code from active_pricing_plan))                as is_currently_active
from pricing_plans p
order by p.sequence, p.code;

revoke all on pricing_plan_status from anon, authenticated;
grant select on active_pricing_plan to anon, authenticated;

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
