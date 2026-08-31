-- ============================================================================
-- Sehatsandhi — monthly, half-yearly and yearly; and renewals track the list
--
-- Run AFTER 0100. Safe to re-run.
--
-- ⚠ NOT FOR PRODUCTION until compute-price and razorpay-order redeploy. This
-- changes how a total is COMPUTED — plan_terms rows and the month bounds — and
-- the deployed function knows neither. It would quote ₹15,000 for a year and
-- charge ₹24,000. Same gate as 0082 and 0085, which are still pending for the
-- same reason. 0100 carries the half that WAS safe.
--
-- ── THE THREE TERMS ─────────────────────────────────────────────────────────
--
--     1 month    ₹2,000     the headline rate, ×1
--     6 months  ₹10,000     against ₹12,000 at the monthly rate — ₹2,000 off
--    12 months  ₹15,000     against ₹24,000 — ₹9,000 off
--
-- All ex-GST, all areas. The annual price is a real discount and not a
-- multiple, which is the whole reason plan_terms exists: monthly × months
-- cannot express ₹15,000.
--
-- default_months is 1. 0082 defaulted to six on the grounds that a default
-- should never be the more expensive commitment; one month is now cheaper
-- still, so the same reasoning moves it. The wizard draws all three and marks
-- the saving.
--
-- ── RENEWALS NOW FOLLOW THE PRICE LIST ──────────────────────────────────────
-- This reverses a decision 0083 made deliberately, so it is worth being precise
-- about what changed and what did not.
--
-- 0083 stamped businesses.renewal_price at purchase and renewed from THAT, so a
-- price rise could never reach an existing customer. The instruction now is the
-- opposite: renew at today's price, and when prices change the renewal changes
-- with them.
--
-- The principle 0083 was protecting is still intact, because it was never
-- really about renewals. locked_monthly_price protects the term a business has
-- PAID FOR — nobody is re-priced mid-term, and this does not touch that. What
-- 0083 additionally froze was the price of the NEXT term, which is a stronger
-- promise than was intended and than is normal.
--
-- Nothing had to be un-stamped: measured before writing this, renewal_price and
-- renewal_term_months are written by no code path at all and are null on every
-- business. The column becomes an explicit OVERRIDE — set it to hold one
-- business at an agreed figure — and null, the normal case, means "whatever the
-- list says at the time".
--
-- ── WHAT THIS OBLIGES US TO DO ──────────────────────────────────────────────
-- Two things follow and both already exist, which is the only reason this is
-- safe to do:
--
--   • The pre-debit notice from 0083 carries the AMOUNT and goes out before any
--     mandate is charged. A business is told the new figure before it is taken,
--     which is what makes a changing renewal price legitimate rather than a
--     surprise. RBI requires that notice anyway.
--   • mandate_max_amount is the ceiling a customer authorised. A renewal above
--     it will not debit, by design — the mandate has to be re-taken. That is a
--     feature here: it is the customer's own consent acting as the brake on a
--     price rise, not an oversight.
-- ============================================================================


-- ============================================================================
-- 1. The terms
-- ============================================================================

update pricing_plans
   set min_months     = 1,
       max_months     = 12,
       default_months = 1,
       updated_at     = now()
 where code = 'launch';

insert into plan_terms (plan_code, months, price, label, savings_note, sequence) values
  ('launch',  1,  2000, 'Monthly',   null,                             10),
  ('launch',  6, 10000, '6 months',  'Save ₹2,000',                    20),
  ('launch', 12, 15000, '12 months', 'Save ₹9,000 — best value',       30)
on conflict (plan_code, months) do update
  set price        = excluded.price,
      label        = excluded.label,
      savings_note = excluded.savings_note,
      sequence     = excluded.sequence,
      updated_at   = now();

-- Anything else that was on offer stops being. Disabled rather than deleted, so
-- a term a business actually bought is still explicable later.
update plan_terms
   set is_enabled = false, updated_at = now()
 where plan_code = 'launch'
   and months not in (1, 6, 12)
   and is_enabled;

-- 0085 disabled anything that was not 6 or 12, which now includes the monthly
-- term it never expected. Put it back.
update plan_terms
   set is_enabled = true, updated_at = now()
 where plan_code = 'launch'
   and months in (1, 6, 12)
   and not is_enabled;


-- ============================================================================
-- 2. What a renewal costs
--
-- One function, so the reminder, the admin screen and any future auto-debit
-- cannot disagree about the figure a business is about to be asked for.
-- ============================================================================

create or replace function sehat_business_renewal_price(p_business uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- 1. An explicit override, where somebody has agreed a figure with this
    --    business. Null on every row today; this is the escape hatch, not the
    --    normal path.
    b.renewal_price,
    -- 2. Today's list price for the term they would renew into — the term they
    --    bought, unless a different one has been recorded against them.
    (select t.price
       from plan_terms t
      where t.plan_code = b.pricing_plan_code
        and t.months    = coalesce(b.renewal_term_months, b.months_paid, 1)
        and t.is_enabled),
    -- 3. No such term priced: fall back to the rate times the length, which is
    --    what every plan without plan_terms rows has always done.
    b.locked_monthly_price * coalesce(b.renewal_term_months, b.months_paid, 1)
  )
    from businesses b
   where b.id = p_business;
$$;

comment on function sehat_business_renewal_price is
  'What this business would pay to renew, at TODAY''s prices. An explicit '
  'businesses.renewal_price overrides it; otherwise the current plan_terms row '
  'for their term wins, and a plan without terms falls back to rate × months. '
  'Changed by 0101: 0083 froze the next term''s price at purchase, which was a '
  'stronger promise than intended. locked_monthly_price still protects the term '
  'already paid for.';

grant execute on function sehat_business_renewal_price(uuid) to authenticated, service_role;
revoke all on function sehat_business_renewal_price(uuid) from public, anon;


-- ============================================================================
-- 3. The reminder quotes the live figure
--
-- Only the two amount expressions change; everything else is 0083's function
-- unaltered, including the idempotency the unique index depends on.
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

  foreach v_d in array v_days loop
    insert into billing_notifications
      (business_id, kind, term_end, days_before, amount, email, phone, payload)
    select b.id, 'renewal_reminder', b.term_end, v_d,
           sehat_business_renewal_price(b.id),
           b.email, b.phone,
           jsonb_build_object(
             'business_name', b.name,
             'term_end',      b.term_end,
             'months',        coalesce(b.renewal_term_months, b.months_paid),
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

  insert into billing_notifications
    (business_id, kind, term_end, days_before, amount, email, phone, payload)
  select b.id, 'pre_debit_notice', b.term_end, v_notice,
         sehat_business_renewal_price(b.id),
         b.email, b.phone,
         jsonb_build_object(
           'business_name', b.name,
           'term_end',      b.term_end,
           'debit_on',      b.term_end,
           'months',        coalesce(b.renewal_term_months, b.months_paid))
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

revoke all on function sehat_queue_billing_notices() from public, anon;
grant execute on function sehat_queue_billing_notices() to service_role;


-- ============================================================================
-- 4. And so does the admin screen
--
-- renewal_price on this report now means "what they will actually be asked
-- for", not "what is stamped on the row" — otherwise the column reads blank for
-- every business, which is what it did.
-- ============================================================================

create or replace function sehat_admin_renewals(
  p_days_ahead integer default null,
  p_state      text default null,
  p_district   text default null
)
returns table (
  business_id      uuid,
  name             text,
  vertical         text,
  status           text,
  phone            text,
  email            text,
  state            text,
  district         text,
  pin_code         text,
  plan_code        text,
  monthly_price    integer,
  months_paid      integer,
  term_start       date,
  term_end         date,
  days_to_expiry   integer,
  auto_renew       boolean,
  mandate_status   text,
  renewal_price    integer,
  renewal_term_months integer,
  last_reminder_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not sehat_is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  return query
  with based as (
    select distinct on (b.id) b.id as x_biz, l.pin_code as x_pin,
           coalesce(l.state,    sa.state)    as x_state,
           coalesce(l.district, sa.district) as x_district
      from businesses b
      join practice_locations l on l.business_id = b.id and l.is_primary
      left join service_areas sa on sa.pin_code = l.pin_code
     order by b.id, l.created_at
  )
  select b.id, b.name, b.vertical, b.status, b.phone, b.email,
         bs.x_state, bs.x_district, bs.x_pin,
         b.pricing_plan_code, b.locked_monthly_price, b.months_paid,
         b.term_start, b.term_end,
         case when b.term_end is null then null
              else (b.term_end - (now() at time zone 'Asia/Kolkata')::date)::integer end,
         b.auto_renew, b.mandate_status,
         sehat_business_renewal_price(b.id),
         coalesce(b.renewal_term_months, b.months_paid),
         (select max(n.created_at) from billing_notifications n
           where n.business_id = b.id and n.kind = 'renewal_reminder')
    from businesses b
    left join based bs on bs.x_biz = b.id
   where (p_state    is null or bs.x_state    = p_state)
     and (p_district is null or bs.x_district = p_district)
     and (p_days_ahead is null
          or (b.term_end is not null
              and b.term_end <= ((now() at time zone 'Asia/Kolkata')::date + p_days_ahead)))
   order by b.term_end nulls last, b.name;
end;
$$;


notify pgrst, 'reload schema';
