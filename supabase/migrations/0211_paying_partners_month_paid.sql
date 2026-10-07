-- 0211: a payment with no period covers the month it was paid — as
-- docs/metrics-definitions.md says — not the month after the payment date.
-- 0209's view counted a ₹500 listing paid on 10 April as paying in May too;
-- scripts/test-metrics.mjs (hand-worked dataset) caught it. Same definition
-- version (1): this makes the view match the written definition.

-- Partners: active (live, with a booking or a profile view that month) and paying (a payment covering a day of it).
create or replace view metric_partners_monthly as
  with months as (select generate_series(date '2026-01-01', sehat_month(now()), interval '1 month')::date as month),
  biz as (select b.id, b.vertical, b.status, sehat_pin_district_key(coalesce(b.own_pin_code, b.pin_codes[1])) as district_key from businesses b)
  select m.month, biz.district_key, biz.vertical,
         count(*) filter (where biz.status = 'active' and (
            exists (select 1 from appointments a where a.business_id = biz.id and sehat_month(a.created_at) = m.month)
            or exists (select 1 from site_events e where e.business_id = biz.id and e.event_type = 'doctor_view' and sehat_month(e.created_at) = m.month))) as active,
         count(*) filter (where exists (select 1 from revenue_ledger r where r.business_id = biz.id
            and coalesce(r.period_start, r.paid_on) <= (m.month + interval '1 month' - interval '1 day')::date
            and coalesce(r.period_end, (date_trunc('month', r.paid_on) + interval '1 month' - interval '1 day')::date) >= m.month)) as paying
    from months m cross join biz
   group by 1, 2, 3;
revoke all on metric_partners_monthly from public, anon, authenticated;

notify pgrst, 'reload schema';
