-- ============================================================================
-- Sehatsandhi — plan enrolment counts, so a plan can be retired safely
--
-- Applied by npm run migrate, after 0008. Safe to re-run.
--
-- pricing_plan_status already reported signups_used, which counts every listing
-- ever locked onto a plan. That is the right number for a seat cap — 50 launch
-- seats means 50 signups, whatever happened afterwards — but it is the wrong
-- number for "is anyone still on this plan?". A plan whose members have all
-- lapsed looks identical to one with fifty live businesses on it.
--
-- Deciding whether a plan is safe to delete needs the second number, so this
-- separates them:
--
--   signups_used     every listing ever locked onto the plan (drives the cap)
--   active_enrolled  live listings still inside their paid term  <- retire on this
--   expired_enrolled locked onto the plan but the term has ended
--   last_signup_at   when anyone last chose it
--
-- Deleting a plan with signups is refused in the admin function rather than
-- left to a foreign-key error, because doctors.pricing_plan_code references it
-- and the raw failure reads as a bug. Payments keep pricing_plan_code as plain
-- text with no constraint, so a deleted plan never orphans billing history.
-- ============================================================================

-- Column list changes, so replace rather than create-or-replace.
drop view if exists pricing_plan_status;

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

-- Who is on each plan, for the moment a count alone is not enough — chasing a
-- renewal, or checking who a retirement would affect.
create or replace view plan_enrolment as
select
  d.pricing_plan_code                                as plan_code,
  d.id                                               as doctor_id,
  d.name,
  d.clinic_name,
  d.speciality,
  d.phone,
  d.status,
  d.locked_monthly_price,
  d.months_paid,
  d.term_start,
  d.term_end,
  (d.term_end is not null and d.term_end < current_date) as term_expired,
  d.locked_at
from doctors d
where d.pricing_plan_code is not null
order by d.pricing_plan_code, d.term_end nulls last;

revoke all on plan_enrolment from anon, authenticated;
