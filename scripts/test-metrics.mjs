#!/usr/bin/env node
// test:metrics — every metric view (0209) checked against a small dataset
// whose answers were worked out by hand (below, next to each expectation).
//
// Runs on staging inside ONE transaction that is rolled back: nothing stays.
// The views read everything, so the test measures each metric before and
// after adding the dataset and compares the DIFFERENCE with the hand-worked
// answer — real staging data cannot disturb it. The dataset lives in March–May
// 2026, before Sehatsandhi had real activity.
//
//   npm run test:metrics            (staging)
//   node scripts/test-metrics.mjs --ref <project ref>   (writes, then rolls back)
//
// The made-up world:
//   Businesses  T1 clinic, Jagadhri 135003 (urban);  T2 lab, Damla 135051 (rural)
//   Patients    P1 Instagram, first seen Mar   — booked Mar 5 (completed), Mar 20 (booked, time passed), May 1 (completed)
//               P2 Google, first seen Mar      — booked Mar 10, cancelled
//               P3 poster QR, first seen Apr   — at T2: Apr 3 no-show, Apr 25 completed
//               P4 Instagram, first seen Apr   — only opened the app on Apr 15
//               P5 from a clinic's register, Mar — nothing else
//   Money       T1 subscription ₹1200 ex-GST (GST 216), paid Mar 2, covers Mar 1 – May 31
//               T2 featured listing ₹500, paid Apr 10, no period
//   Spend       Mar Meta ₹1000; Apr Meta ₹500; Apr print ₹300
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const ref = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : 'xmsycnlztqmyvtcyxkmg'
if (ref === 'ctxkkqqtasegoowuqbmi') { console.error('Not on production: this test writes (and rolls back).'); process.exit(2) }
const token = readFileSync(join(ROOT, '.env.supabase'), 'utf8').match(/^SUPABASE_ACCESS_TOKEN=["']?([^"'\n]+)/m)?.[1]

const A = '2026-03-01', B = '2026-04-01', C = '2026-05-01'
// key → hand-worked expected change.
const EXPECT = {
  // Active patients: Mar P1, P2 (bookings); Apr P3 (booking), P4 (app); May P1. P5 did nothing.
  [`map|${A}`]: 2, [`map|${B}`]: 2, [`map|${C}`]: 1,
  // Bookings created: Mar 3 (P1×2, P2), Apr 2 (P3×2), May 1 (P1).
  [`bookings|${A}`]: 3, [`bookings|${B}`]: 2, [`bookings|${C}`]: 1,
  // Completed = marked completed or time passed un-cancelled: Mar P1×2; Apr P3 Apr 25; May P1.
  [`completed|${A}`]: 2, [`completed|${B}`]: 1, [`completed|${C}`]: 1,
  [`cancelled|${A}`]: 1, [`cancelled|${B}`]: 0, [`no_show|${B}`]: 1,
  // Revenue ex-GST by month paid: Mar 1200, Apr 500, May 0.
  [`revenue|${A}`]: 1200, [`revenue|${B}`]: 500, [`revenue|${C}`]: 0,
  // MRR: the 1200 subscription spread over its 3 months; the listing is not a subscription.
  [`mrr|${A}`]: 400, [`mrr|${B}`]: 400, [`mrr|${C}`]: 400,
  // Active partners (a booking that month): Mar T1, Apr T2, May T1.
  [`active_partners|${A}`]: 1, [`active_partners|${B}`]: 1, [`active_partners|${C}`]: 1,
  // Paying (a payment covering a day of the month): Mar T1; Apr T1 + T2 (paid that month); May T1 only.
  [`paying_partners|${A}`]: 1, [`paying_partners|${B}`]: 2, [`paying_partners|${C}`]: 1,
  // Repeat: P1 first Mar 5, again Mar 20 (≤30 d); P3 first Apr 3, again Apr 25. P2's only booking was cancelled.
  [`repeat_new|${A}`]: 1, [`repeat_30|${A}`]: 1, [`repeat_90|${A}`]: 1,
  [`repeat_new|${B}`]: 1, [`repeat_30|${B}`]: 1, [`repeat_90|${B}`]: 1,
  // Retention by first-activity month: Mar cohort {P1, P2} — both active Mar, P1 again May (2 months on);
  // Apr cohort {P3, P4} — both active Apr.
  [`retention_active|${A}|0`]: 2, [`retention_active|${A}|2`]: 1, [`retention_size|${A}`]: 2,
  [`retention_active|${B}|0`]: 2, [`retention_size|${B}`]: 2,
  // CAC: new patients by first source (clinic register excluded) against spend.
  [`cac_new|${A}|meta_ads`]: 1, [`cac_spend|${A}|meta_ads`]: 1000, [`cac|${A}|meta_ads`]: 1000,
  [`cac_new|${A}|google_ads`]: 1, [`cac_spend|${A}|google_ads`]: 0,
  [`cac_new|${B}|meta_ads`]: 1, [`cac_spend|${B}|meta_ads`]: 500, [`cac|${B}|meta_ads`]: 500,
  [`cac_new|${B}|print`]: 1, [`cac_spend|${B}|print`]: 300, [`cac|${B}|print`]: 300,
  // Impact: P3's bookings were at the rural lab; the rest at the urban clinic.
  [`rural|${B}`]: 2, [`urban|${A}`]: 3, [`urban|${C}`]: 1,
  // Funnel: booked / completed follow the bookings.
  [`funnel_booked|${A}`]: 3, [`funnel_completed|${A}`]: 2, [`funnel_booked|${B}`]: 2,
}

const measure = (tbl) => `
create temp table ${tbl} (k text primary key, v numeric) on commit drop;
insert into ${tbl}
  select 'map|' || month, patients from metric_map_monthly where district_key = 'all' and month in ('${A}','${B}','${C}')
  union all select 'bookings|' || month, sum(total) from metric_bookings_monthly where month in ('${A}','${B}','${C}') group by month
  union all select 'completed|' || month, sum(completed) from metric_bookings_monthly where month in ('${A}','${B}','${C}') group by month
  union all select 'cancelled|' || month, sum(cancelled) from metric_bookings_monthly where month in ('${A}','${B}','${C}') group by month
  union all select 'no_show|' || month, sum(no_show) from metric_bookings_monthly where month in ('${A}','${B}','${C}') group by month
  union all select 'revenue|' || month, sum(revenue) from metric_revenue_monthly where month in ('${A}','${B}','${C}') group by month
  union all select 'mrr|' || month, sum(mrr) from metric_mrr_monthly where month in ('${A}','${B}','${C}') group by month
  union all select 'active_partners|' || month, sum(active) from metric_partners_monthly where month in ('${A}','${B}','${C}') group by month
  union all select 'paying_partners|' || month, sum(paying) from metric_partners_monthly where month in ('${A}','${B}','${C}') group by month
  union all select 'repeat_new|' || cohort_month, new_patients from metric_repeat_cohorts where cohort_month in ('${A}','${B}','${C}')
  union all select 'repeat_30|' || cohort_month, repeat_30 from metric_repeat_cohorts where cohort_month in ('${A}','${B}','${C}')
  union all select 'repeat_90|' || cohort_month, repeat_90 from metric_repeat_cohorts where cohort_month in ('${A}','${B}','${C}')
  union all select 'retention_active|' || cohort_month || '|' || month_offset, active from metric_retention_cohorts where cohort_month in ('${A}','${B}','${C}')
  union all select distinct 'retention_size|' || cohort_month, cohort_size from metric_retention_cohorts where cohort_month in ('${A}','${B}','${C}')
  union all select 'cac_new|' || month || '|' || channel, new_patients from metric_cac_monthly where month in ('${A}','${B}','${C}')
  union all select 'cac_spend|' || month || '|' || channel, spend from metric_cac_monthly where month in ('${A}','${B}','${C}')
  union all select 'cac|' || month || '|' || channel, cac from metric_cac_monthly where month in ('${A}','${B}','${C}') and cac is not null
  union all select 'rural|' || month, rural_bookings from metric_impact_monthly where month in ('${A}','${B}','${C}')
  union all select 'urban|' || month, urban_bookings from metric_impact_monthly where month in ('${A}','${B}','${C}')
  union all select 'funnel_booked|' || month, booked from metric_funnel_monthly where month in ('${A}','${B}','${C}')
  union all select 'funnel_completed|' || month, completed from metric_funnel_monthly where month in ('${A}','${B}','${C}');`

const ts = (d) => `timestamptz '${d} 11:00:00+05:30'`
const sql = `begin;
${measure('before_m')}
insert into businesses (id, name, vertical, status, own_pin_code, pin_codes) values
  ('00000000-0000-4000-8000-00000000a001', 'TEST metrics clinic', 'clinic', 'active', '135003', array['135003']),
  ('00000000-0000-4000-8000-00000000a002', 'TEST metrics lab', 'lab', 'active', '135051', array['135051']);
insert into patients (id, phone, name, source, first_source_type, first_channel, first_seen_at, created_at) values
  ('00000000-0000-4000-8000-00000000b001', '919990000001', 'TEST P1', 'appointment', 'instagram_reel', 'whatsapp', ${ts('2026-03-05')}, ${ts('2026-03-05')}),
  ('00000000-0000-4000-8000-00000000b002', '919990000002', 'TEST P2', 'appointment', 'google', 'website', ${ts('2026-03-10')}, ${ts('2026-03-10')}),
  ('00000000-0000-4000-8000-00000000b003', '919990000003', 'TEST P3', 'appointment', 'qr_poster', 'whatsapp', ${ts('2026-04-03')}, ${ts('2026-04-03')}),
  ('00000000-0000-4000-8000-00000000b004', '919990000004', 'TEST P4', 'appointment', 'instagram_reel', 'app', ${ts('2026-04-15')}, ${ts('2026-04-15')}),
  ('00000000-0000-4000-8000-00000000b005', '919990000005', 'TEST P5', 'hospital_register', 'clinic_register', 'clinic', ${ts('2026-03-02')}, ${ts('2026-03-02')});
insert into appointments (patient_phone, patient_name, patient_age, business_id, slot_datetime, status, booked_via, created_at) values
  ('919990000001', 'TEST P1', 30, '00000000-0000-4000-8000-00000000a001', ${ts('2026-03-06')}, 'completed', 'whatsapp_bot', ${ts('2026-03-05')}),
  ('919990000001', 'TEST P1', 30, '00000000-0000-4000-8000-00000000a001', ${ts('2026-03-21')}, 'booked',    'app',          ${ts('2026-03-20')}),
  ('919990000002', 'TEST P2', 40, '00000000-0000-4000-8000-00000000a001', ${ts('2026-03-11')}, 'cancelled', 'app',          ${ts('2026-03-10')}),
  ('919990000003', 'TEST P3', 50, '00000000-0000-4000-8000-00000000a002', ${ts('2026-04-04')}, 'no_show',   'whatsapp_bot', ${ts('2026-04-03')}),
  ('919990000003', 'TEST P3', 50, '00000000-0000-4000-8000-00000000a002', ${ts('2026-04-26')}, 'completed', 'whatsapp_bot', ${ts('2026-04-25')}),
  ('919990000001', 'TEST P1', 30, '00000000-0000-4000-8000-00000000a001', ${ts('2026-05-02')}, 'completed', 'app',          ${ts('2026-05-01')});
insert into patient_app_days (patient_id, day) values ('00000000-0000-4000-8000-00000000b004', '2026-04-15');
insert into offline_payments (payer_type, business_id, purpose, amount_inr, gst_amount, method, paid_at, period_start, period_end, recorded_by) values
  ('business', '00000000-0000-4000-8000-00000000a001', 'subscription', 1200, 216, 'upi', '2026-03-02', '2026-03-01', '2026-05-31', null),
  ('business', '00000000-0000-4000-8000-00000000a002', 'featured_listing', 500, 90, 'cash', '2026-04-10', null, null, null);
insert into marketing_spend (month, channel, amount_inr, entered_by) values
  ('2026-03-01', 'meta_ads', 1000, null), ('2026-04-01', 'meta_ads', 500, null), ('2026-04-01', 'print', 300, null);
${measure('after_m')}
select a.k, coalesce(a.v, 0) - coalesce(b.v, 0) as d from after_m a left join before_m b using (k);
rollback;`

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
})
const out = await res.json()
if (!res.ok || !Array.isArray(out)) { console.error('Query failed:', JSON.stringify(out).slice(0, 600)); process.exit(2) }
const got = Object.fromEntries(out.map(r => [r.k, Number(r.d)]))
let fail = 0
for (const [k, want] of Object.entries(EXPECT)) {
  const have = got[k] ?? 0
  const ok = Math.abs(have - want) < 0.01
  if (!ok) fail++
  console.log(`${ok ? '✓' : '✗'} ${k.padEnd(34)} expected ${String(want).padStart(5)}   got ${have}`)
}
console.log(`\n${Object.keys(EXPECT).length - fail}/${Object.keys(EXPECT).length} metric checks match the hand-worked answers${fail ? ` — ${fail} do not` : ''}.`)
process.exit(fail ? 1 : 0)
