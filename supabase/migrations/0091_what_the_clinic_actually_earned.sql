-- ============================================================================
-- Sehatsandhi — what the clinic earned, by period and by revenue stream
--
-- Run AFTER 0090. Safe to re-run.
--
-- The Reports tab has only ever answered "how is the LISTING doing" — views,
-- clicks, bookings. A clinic's own money was recorded in patient_charges and
-- patient_payments and never added up anywhere. The owner could see every
-- individual bill and no total.
--
-- ── BILLED AND COLLECTED ARE DIFFERENT NUMBERS ──────────────────────────────
-- The single most important thing about this report, and the reason it returns
-- both rather than one figure called "income":
--
--   BILLED    what was charged  — patient_charges, by charged_on
--   COLLECTED what was received — patient_payments, by received_on
--
-- They are not the same and in a clinic they are never the same: a bill raised
-- in March and paid in April belongs to March's earnings and April's cash. A
-- report that quietly picked one and called it income would be wrong for
-- whichever question the reader had in mind.
--
-- ── ONLY BILLED CAN BE SPLIT BY STREAM ──────────────────────────────────────
-- patient_charges carries a category, so billed revenue splits cleanly into
-- medicines, consultation, bed and the rest. patient_payments does NOT: a
-- payment is against a bill or an account, and nothing records which line of it
-- the money was for. ₹500 against a ₹2,000 bill covering medicines and a bed is
-- not divisible without inventing a rule.
--
-- So collections are returned as a single total and deliberately not split.
-- Apportioning them pro-rata would produce a number that looks precise, is
-- untraceable to any transaction, and would be quoted at a tax assessment.
--
-- ── WHAT COUNTS ─────────────────────────────────────────────────────────────
-- A charge on a cancelled or superseded bill is excluded: that document was
-- withdrawn and its lines are not revenue. A charge with no bill yet IS counted
-- — work done and recorded is earned whether or not the bill has been raised,
-- and excluding it would make the report disagree with the ward.
--
-- ── WHOSE MONEY IT IS ───────────────────────────────────────────────────────
-- Owner, manager and doctor. That is the union of the two existing rules rather
-- than a new one: 0065 already lets owner and doctor read the Reports tab, and
-- a manager is who 0057 put in charge of the money. Reception and nursing are
-- excluded — they raise charges, they do not need the practice's takings.
-- ============================================================================


-- ============================================================================
-- 1. Which period a date falls in
--
-- date_trunc covers day, week, month, quarter and year. It has no notion of a
-- half-year, which is why this exists rather than being inlined at the call
-- site: the half is the one case that needs arithmetic, and having six grains
-- resolved in one place is what stops the report and the CSV disagreeing.
-- ============================================================================

create or replace function sehat_period_start(p_day date, p_grain text)
returns date
language sql
immutable
as $$
  select case lower(p_grain)
    when 'day'     then p_day
    -- ISO weeks, so a week starts Monday. A clinic's week does too.
    when 'week'    then (date_trunc('week',    p_day)::date)
    when 'month'   then (date_trunc('month',   p_day)::date)
    when 'quarter' then (date_trunc('quarter', p_day)::date)
    when 'half'    then (date_trunc('year', p_day)::date
                         + case when extract(month from p_day) <= 6
                                then 0 else 6 end * interval '1 month')::date
    when 'year'    then (date_trunc('year',    p_day)::date)
    -- Anything unrecognised collapses to the month rather than raising: this is
    -- reached from a report, and a wrong grain should not be an error page.
    else                (date_trunc('month',   p_day)::date)
  end;
$$;

comment on function sehat_period_start is
  'The first day of the period p_day belongs to, for grain day|week|month|'
  'quarter|half|year. Half-years are computed here because date_trunc has no '
  'notion of one.';

create or replace function sehat_period_end(p_start date, p_grain text)
returns date
language sql
immutable
as $$
  select case lower(p_grain)
    when 'day'     then p_start
    when 'week'    then p_start + 6
    when 'month'   then (p_start + interval '1 month'  - interval '1 day')::date
    when 'quarter' then (p_start + interval '3 months' - interval '1 day')::date
    when 'half'    then (p_start + interval '6 months' - interval '1 day')::date
    when 'year'    then (p_start + interval '1 year'   - interval '1 day')::date
    else                (p_start + interval '1 month'  - interval '1 day')::date
  end;
$$;

comment on function sehat_period_end is
  'The last day of the period beginning p_start. Paired with '
  'sehat_period_start so a row can state its own range.';

grant execute on function sehat_period_start(date, text) to authenticated, service_role;
grant execute on function sehat_period_end(date, text)   to authenticated, service_role;
revoke all on function sehat_period_start(date, text) from public, anon;
revoke all on function sehat_period_end(date, text)   from public, anon;


-- ============================================================================
-- 2. The report
-- ============================================================================

create or replace function sehat_revenue_report(
  p_business uuid,
  p_grain    text default 'month',
  p_from     date default null,
  p_to       date default null
)
returns table (
  period_start   date,
  period_end     date,
  -- Billed, split by stream. The three the question is usually about first:
  consultation   numeric,   -- OPD fees
  bed            numeric,   -- admission and bed charges
  medicine       numeric,   -- medicines
  -- and the rest, kept separate rather than folded into "other" so a clinic
  -- that does a lot of one of them can see it.
  procedure_     numeric,
  lab            numeric,
  consumable     numeric,
  other          numeric,
  billed_total   numeric,
  -- Cash actually received in the period. NOT split by stream — see the header.
  collected      numeric,
  bills_issued   integer,
  patients_seen  integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_grain text := lower(coalesce(p_grain, 'month'));
  v_from  date;
  v_to    date;
begin
  if not sehat_caller_is_business(p_business)
     and coalesce(sehat_caller_role(p_business), '') <> 'doctor' then
    raise exception 'Only an owner, manager or doctor can read the revenue report'
      using errcode = '42501';
  end if;

  if v_grain not in ('day','week','month','quarter','half','year') then
    v_grain := 'month';
  end if;

  -- Default window: wide enough to be useful at every grain, and bounded so a
  -- clinic with years of history does not get a thousand rows by accident.
  v_to   := coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date);
  v_from := coalesce(p_from, case v_grain
                       when 'day'     then v_to - 30
                       when 'week'    then v_to - 182
                       when 'month'   then (v_to - interval '11 months')::date
                       when 'quarter' then (v_to - interval '2 years')::date
                       when 'half'    then (v_to - interval '3 years')::date
                       else                (v_to - interval '5 years')::date
                     end);
  -- A backwards range is a caller mistake, not a reason to return nothing odd.
  if v_from > v_to then
    declare v_swap date := v_from; begin v_from := v_to; v_to := v_swap; end;
  end if;

  return query
  with charges as (
    select sehat_period_start(ch.charged_on, v_grain) as p,
           ch.category,
           ch.amount,
           ch.patient_member_id
      from patient_charges ch
      -- A withdrawn document is not revenue. An unbilled charge still is.
      left join patient_bills b on b.id = ch.bill_id
     where ch.business_id = p_business
       and ch.charged_on between v_from and v_to
       and (ch.bill_id is null
            or (b.status <> 'cancelled' and b.superseded_by is null))
  ),
  paid as (
    select sehat_period_start(pm.received_on, v_grain) as p,
           sum(pm.amount) as amount
      from patient_payments pm
     where pm.business_id = p_business
       and pm.received_on between v_from and v_to
     group by 1
  ),
  bills as (
    select sehat_period_start(bi.issued_at::date, v_grain) as p,
           count(*)::integer as n
      from patient_bills bi
     where bi.business_id = p_business
       and bi.issued_at is not null
       and bi.issued_at::date between v_from and v_to
       and bi.status <> 'cancelled'
       and bi.superseded_by is null
     group by 1
  ),
  -- Every period that has any activity at all, so a month with collections but
  -- no new charges still appears rather than silently vanishing.
  periods as (
    select p from charges union
    select p from paid    union
    select p from bills
  )
  select
    pr.p,
    sehat_period_end(pr.p, v_grain),
    coalesce(sum(c.amount) filter (where c.category = 'consultation'), 0),
    coalesce(sum(c.amount) filter (where c.category = 'bed'),          0),
    coalesce(sum(c.amount) filter (where c.category = 'medicine'),     0),
    coalesce(sum(c.amount) filter (where c.category = 'procedure'),    0),
    coalesce(sum(c.amount) filter (where c.category = 'lab'),          0),
    coalesce(sum(c.amount) filter (where c.category = 'consumable'),   0),
    coalesce(sum(c.amount) filter (where c.category = 'other'),        0),
    coalesce(sum(c.amount), 0),
    coalesce(max(pd.amount), 0),
    coalesce(max(bl.n), 0),
    count(distinct c.patient_member_id)::integer
    from periods pr
    left join charges c  on c.p  = pr.p
    left join paid    pd on pd.p = pr.p
    left join bills   bl on bl.p = pr.p
   group by pr.p
   order by pr.p desc;
end;
$$;

comment on function sehat_revenue_report is
  'Billed revenue by stream and cash collected, bucketed by day, week, month, '
  'quarter, half-year or year. Billed and collected are different numbers and '
  'both are returned; only billed is split by stream, because a payment does '
  'not record which line it settled. Owner, manager or doctor.';

grant execute on function sehat_revenue_report(uuid, text, date, date) to authenticated;
revoke all on function sehat_revenue_report(uuid, text, date, date) from public, anon;


notify pgrst, 'reload schema';
