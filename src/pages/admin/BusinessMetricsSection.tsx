import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { StatTile, ColumnChart, BarList } from '../../components/Charts'
import { WA_NUMBER } from '../../types'
import DataPackButton from './DataPackButton'

// व्यापार आँकड़े — Business metrics (0209/0210). The numbers an investor, a
// grant body or a bank asks for, defined once in docs/metrics-definitions.md
// and computed by the metric_* views (sehat_admin_metrics). Months are
// calendar months in India time. Below the numbers, the facts only an admin
// can enter: marketing spend, money received outside Razorpay, district dates
// and campaign codes. No names, phone numbers or health details anywhere here.

type Row = Record<string, unknown>
interface Metrics {
  map: { month: string; patients: number }[]
  bookings: { month: string; vertical: string; channel: string; total: number; completed: number; cancelled: number; no_show: number }[]
  revenue: { month: string; purpose: string; revenue: number; gst: number }[]
  mrr: { month: string; mrr: number }[]
  partners: { month: string; vertical: string; active: number; paying: number }[]
  repeat: { cohort_month: string; new_patients: number; repeat_30: number; repeat_90: number }[]
  retention: { cohort_month: string; month_offset: number; active: number; cohort_size: number }[]
  cac: { month: string; channel: string; spend: number; new_patients: number; cac: number | null }[]
  funnel: { month: string; searches: number; results_shown: number; profile_views: number; booked: number; completed: number }[]
  impact: Row[]
  acquisition: { month: string; source: string; channel: string; n: number }[]
  districts: Row[]
  plans: { paying_now: number; listed: number }
  snapshots: number
  // 0214
  booking_sources: { month: string; source_type: string; campaign_code: string | null; total: number }[]
  specialities: { month: string; speciality: string; total: number; completed: number }[]
  partner_sources: { month: string; vertical: string; source_type: string; n: number }[]
  coupons: { month: string; coupon_code: string; payments: number; discount: number; revenue: number }[]
  renewals: { month: string; due: number; renewed: number }[]
  unmet_served: { month: string; unmet_patients: number; served_patients: number }[]
  savings: { month: string; answer: string; n: number }[]
}

const SOURCES: Record<string, string> = {
  meta_ctwa_ad: 'Meta (Click-to-WhatsApp) ad', instagram_reel: 'Instagram / Facebook', website_organic: 'Website', google: 'Google',
  sms_campaign: 'SMS / WhatsApp campaign', doctor_referral: 'Doctor / clinic', patient_referral: 'Friend / family', qr_poster: 'Poster / QR',
  camp: 'Health camp', direct: 'Direct', clinic_register: "Clinic's own register", other: 'Other', unknown: 'Not known',
  clinic_desk: 'Booked at the clinic desk', field_sales: 'Our field team (doctor lead)',
}
const SAVED: Record<string, string> = { time_and_money: 'Time and money', time: 'Time', money: 'Money', none: 'No difference' }
const PURPOSES: [string, string][] = [['pilot_registration', 'Pilot registration'], ['subscription', 'Subscription'],
  ['whatsapp_marketing_credits', 'WhatsApp marketing credits'], ['featured_listing', 'Featured listing'], ['lead_fees', 'Lead fees'], ['other', 'Other']]
const CHANNELS: [string, string][] = [['meta_ads', 'Meta ads'], ['google_ads', 'Google ads'], ['sms', 'SMS'], ['print', 'Print / posters'],
  ['camp', 'Camps'], ['salary_field_staff', 'Field staff'], ['other', 'Other']]

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
const label = (m: string) => new Date(m + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + (Number(f(x)) || 0), 0)
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—')

export default function BusinessMetricsSection() {
  const now = new Date()
  const [from, setFrom] = useState(ym(new Date(now.getFullYear(), now.getMonth() - 11, 1)))
  const [to, setTo] = useState(ym(now))
  const [district, setDistrict] = useState('')
  const [m, setM] = useState<Metrics | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    const { data, error } = await supabase.rpc('sehat_admin_metrics', { p_from: from, p_to: to, p_district: district || null })
    if (error) setErr(error.message); else setM(data as Metrics)
  }, [from, to, district])
  useEffect(() => { load() }, [load])

  const months = useMemo(() => {
    const out: string[] = []
    const d = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00')
    while (d <= end) { out.push(ym(d)); d.setMonth(d.getMonth() + 1) }
    return out
  }, [from, to])

  if (!m) return <div className="card shadow-sm text-sm text-gray-500">{err || 'Loading…'}</div>

  const per = (f: (month: string) => number) => months.map(mo => ({ label: label(mo), value: f(mo) }))
  const map = (mo: string) => Number(m.map.find(x => x.month === mo)?.patients ?? 0)
  const bookings = (mo: string) => sum(m.bookings.filter(x => x.month === mo), x => x.total)
  const completed = (mo: string) => sum(m.bookings.filter(x => x.month === mo), x => x.completed)
  const revenue = (mo: string) => sum(m.revenue.filter(x => x.month === mo), x => x.revenue)
  const paying = (mo: string) => sum(m.partners.filter(x => x.month === mo), x => x.paying)
  const active = (mo: string) => sum(m.partners.filter(x => x.month === mo), x => x.active)
  const rep = (mo: string) => m.repeat.find(x => x.cohort_month === mo)
  const cacOf = (mo: string) => { const r = m.cac.filter(x => x.month === mo); const n = sum(r, x => x.new_patients); return n ? sum(r, x => x.spend) / n : null }
  const cur = months[months.length - 1], prev = months[months.length - 2]
  const delta = (f: (mo: string) => number) => {
    if (!prev) return undefined
    const a = f(cur), b = f(prev)
    return b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / b) * 100))}% vs ${label(prev)}` : `${label(prev)}: ${b}`
  }
  const totalBy = <T extends Row>(rows: T[], key: keyof T, val: keyof T) => {
    const acc: Record<string, number> = {}
    for (const r of rows) acc[String(r[key])] = (acc[String(r[key])] ?? 0) + Number(r[val] ?? 0)
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }))
  }
  const f = m.funnel.reduce((a, x) => ({ searches: a.searches + x.searches, results_shown: a.results_shown + x.results_shown,
    profile_views: a.profile_views + x.profile_views, booked: a.booked + x.booked, completed: a.completed + x.completed }),
    { searches: 0, results_shown: 0, profile_views: 0, booked: 0, completed: 0 })
  const cohorts = [...new Set(m.retention.map(r => r.cohort_month))].sort()
  const maxOffset = Math.max(0, ...m.retention.map(r => r.month_offset))
  const imp = (k: string) => m.impact.reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const r30 = rep(cur)
  const due = sum(m.renewals ?? [], x => x.due), renewed = sum(m.renewals ?? [], x => x.renewed)
  const unmetP = sum(m.unmet_served ?? [], x => x.unmet_patients), servedP = sum(m.unmet_served ?? [], x => x.served_patients)
  const savedTotal = sum(m.savings ?? [], x => x.n)

  return (
    <div className="space-y-4">
      <div className="card shadow-sm flex flex-wrap gap-3 items-end">
        <div>
          <h3 className="font-bold text-navy-700 text-lg">व्यापार आँकड़े · Business metrics</h3>
          <p className="text-xs text-gray-500">Definitions: docs/metrics-definitions.md (version 1). Calendar months, India time. Frozen monthly snapshots: {m.snapshots}.</p>
        </div>
        <div className="flex gap-2 flex-wrap items-end ml-auto">
          <label className="text-xs text-gray-500">From<input type="month" className="input-field block" value={from.slice(0, 7)} onChange={e => setFrom(e.target.value + '-01')} /></label>
          <label className="text-xs text-gray-500">To<input type="month" className="input-field block" value={to.slice(0, 7)} onChange={e => setTo(e.target.value + '-01')} /></label>
          <label className="text-xs text-gray-500">District
            <select className="input-field block" value={district} onChange={e => setDistrict(e.target.value)}>
              <option value="">All</option>
              {m.districts.map(d => <option key={String(d.id)} value={String(d.name)}>{String(d.name)}</option>)}
            </select>
          </label>
          <DataPackButton from={from} to={to} district={district} />
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label={`Active patients · ${label(cur)}`} value={map(cur)} sub={delta(map)} />
        <StatTile label="Bookings" value={bookings(cur)} sub={`${completed(cur)} completed · ${delta(bookings) ?? ''}`} />
        <StatTile label="Revenue (ex-GST)" value={inr(revenue(cur))} sub={delta(revenue)} />
        <StatTile label="Paying partners" value={paying(cur)} sub={`${m.plans.paying_now} paying today · ${active(cur)} active`} />
        <StatTile label="Repeat within 30 days" value={r30 ? pct(r30.repeat_30, r30.new_patients) : '—'} sub={r30 ? `of ${r30.new_patients} new patients · 90 days: ${pct(r30.repeat_90, r30.new_patients)}` : 'no new patients this month'} />
        <StatTile label="Cost to acquire (CAC)" value={cacOf(cur) != null ? inr(cacOf(cur)!) : '—'} sub="marketing spend ÷ new patients" />
        <StatTile label="MRR" value={inr(Number(m.mrr.find(x => x.month === cur)?.mrr ?? 0))} sub="subscriptions spread over their months" />
        <StatTile label="Partners listed" value={m.plans.listed} sub="live (active) businesses" />
        <StatTile label="Partner renewals (period)" value={pct(renewed, due)} sub={due ? `${renewed} of ${due} plans that ended were renewed` : 'no plan has ended yet'} />
        <StatTile label="Unmet demand served (period)" value={pct(servedP, unmetP)} sub={unmetP ? `${servedP} of ${unmetP} patients who found nobody later booked there` : 'no known patient found nobody'} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card shadow-sm"><ColumnChart title="Monthly active patients" data={per(map)} /></div>
        <div className="card shadow-sm"><ColumnChart title="Bookings" data={per(bookings)} /></div>
        <div className="card shadow-sm"><ColumnChart title="Revenue (₹, ex-GST)" data={per(revenue)} /></div>
        <div className="card shadow-sm"><ColumnChart title="Paying partners" data={per(paying)} /></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card shadow-sm">
          <BarList title="Funnel (whole period)" data={[
            { label: 'Searches', value: f.searches }, { label: 'Results shown', value: f.results_shown },
            { label: 'Profiles opened', value: f.profile_views }, { label: 'Booked', value: f.booked }, { label: 'Completed', value: f.completed }]} />
          <p className="text-xs text-gray-500 mt-2">Searched → booked: {pct(f.booked, f.searches)} · booked → completed: {pct(f.completed, f.booked)}</p>
        </div>
        <div className="card shadow-sm"><BarList title="Where new patients came from" data={totalBy(m.acquisition, 'source', 'n').map(d => ({ ...d, label: SOURCES[d.label] ?? d.label }))} /></div>
        <div className="card shadow-sm"><BarList title="Bookings by service" data={totalBy(m.bookings, 'vertical', 'total')} /></div>
        <div className="card shadow-sm"><BarList title="Bookings by channel" data={totalBy(m.bookings, 'channel', 'total')} /></div>
        <div className="card shadow-sm"><BarList title="Revenue by purpose (₹)" data={totalBy(m.revenue, 'purpose', 'revenue')} /></div>
        <div className="card shadow-sm"><BarList title="Paying partners by type (latest month)" data={totalBy(m.partners.filter(x => x.month === cur), 'vertical', 'paying')} /></div>
        <div className="card shadow-sm"><BarList title="Bookings by where that booking came from" data={totalBy(m.booking_sources ?? [], 'source_type', 'total').map(d => ({ ...d, label: SOURCES[d.label] ?? d.label }))} /></div>
        <div className="card shadow-sm"><BarList title="Bookings by campaign code" data={totalBy((m.booking_sources ?? []).filter(x => x.campaign_code), 'campaign_code', 'total')} /></div>
        <div className="card shadow-sm"><BarList title="Bookings by speciality" data={totalBy(m.specialities ?? [], 'speciality', 'total')} /></div>
        <div className="card shadow-sm"><BarList title="Where new partners came from" data={totalBy(m.partner_sources ?? [], 'source_type', 'n').map(d => ({ ...d, label: SOURCES[d.label] ?? d.label }))} /></div>
      </div>

      {!!(m.coupons ?? []).length && (
        <div className="card shadow-sm overflow-x-auto">
          <h4 className="font-semibold text-navy-700 text-sm mb-2">Coupons used with payments</h4>
          <table className="text-xs w-full">
            <thead><tr className="text-left text-gray-500"><th>Code</th><th className="text-right">Payments</th><th className="text-right">Discount given</th><th className="text-right">Revenue (ex-GST)</th></tr></thead>
            <tbody>{totalBy(m.coupons, 'coupon_code', 'payments').map(c => {
              const rows = m.coupons.filter(x => x.coupon_code === c.label)
              return <tr key={c.label} className="border-t border-gray-100"><td className="py-1 font-mono">{c.label}</td><td className="text-right">{c.value}</td>
                <td className="text-right">{inr(sum(rows, x => x.discount))}</td><td className="text-right">{inr(sum(rows, x => x.revenue))}</td></tr>
            })}</tbody>
          </table>
        </div>
      )}

      <div className="card shadow-sm overflow-x-auto">
        <h4 className="font-semibold text-navy-700 text-sm mb-2">Cohort retention — of each month's new patients, % active later</h4>
        {!cohorts.length ? <p className="text-sm text-gray-500">Not enough history yet.</p> : (
          <table className="text-xs">
            <thead><tr><th className="text-left pr-3">Started</th><th className="pr-3">New</th>{Array.from({ length: maxOffset + 1 }, (_, i) => <th key={i} className="px-2">M{i}</th>)}</tr></thead>
            <tbody>{cohorts.map(c => {
              const rows = m.retention.filter(r => r.cohort_month === c)
              const size = rows[0]?.cohort_size ?? 0
              return (
                <tr key={c} className="border-t border-gray-100">
                  <td className="pr-3 py-1">{label(c)}</td><td className="pr-3 text-center">{size}</td>
                  {Array.from({ length: maxOffset + 1 }, (_, i) => { const r = rows.find(x => x.month_offset === i); return <td key={i} className="px-2 text-center">{r ? pct(r.active, size) : ''}</td> })}
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </div>

      <div className="card shadow-sm space-y-3">
        <h4 className="font-semibold text-navy-700 text-sm">Impact — access to care (whole period)</h4>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Rural share of bookings" value={pct(imp('rural_bookings'), imp('rural_bookings') + imp('urban_bookings'))} sub={`${imp('rural_bookings')} rural · ${imp('urban_bookings')} urban`} />
          <StatTile label="Ambulance requests" value={imp('ambulance_requests')} sub={`median accept ${m.impact.map(r => r.ambulance_median_accept_minutes).filter(v => v != null).slice(-1)[0] ?? '—'} min (latest month)`} />
          <StatTile label="Medicine orders" value={imp('medicine_orders')} />
          <StatTile label="Searches nobody could serve" value={imp('unmet_searches')} sub="unmet demand — where to recruit next" />
          <StatTile label="Insurance requests" value={imp('insurance_requests')} />
          <StatTile label="Typed messages" value={imp('typed_messages')} sub={`${pct(imp('hindi_messages'), imp('typed_messages'))} in Hindi · ${pct(imp('voice_messages'), imp('typed_messages'))} voice notes`} />
        </div>
        <BarList title={`"Sehatsandhi से आपका कितना समय/खर्च बचा?" — ${savedTotal} answer${savedTotal === 1 ? '' : 's'}`}
          data={totalBy(m.savings ?? [], 'answer', 'n').map(d => ({ ...d, label: SAVED[d.label] ?? d.label }))} />
        <p className="text-xs text-gray-500">Voice notes count once they are connected to the bot; until then every typed message is text.</p>
        <WaSavingsSwitch />
      </div>

      <SpendForm reload={load} />
      <OfflinePaymentForm reload={load} />
      <DistrictForm rows={m.districts} reload={load} />
      <CampaignCodes />
    </div>
  )
}

function SpendForm({ reload }: { reload: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [f, setF] = useState({ month: ym(new Date()).slice(0, 7), channel: 'meta_ads', campaign: '', amount: '', notes: '' })
  const [err, setErr] = useState('')
  const load = () => supabase.from('marketing_spend').select('*').order('month', { ascending: false }).limit(24).then(({ data }) => setRows(data ?? []))
  useEffect(() => { load() }, [])
  const add = async () => {
    setErr('')
    if (!(Number(f.amount) >= 0) || f.amount === '') { setErr('Enter the amount.'); return }
    const { error } = await supabase.from('marketing_spend').insert({ month: f.month + '-01', channel: f.channel, campaign: f.campaign || null, amount_inr: Number(f.amount), notes: f.notes || null })
    if (error) { setErr(error.message); return }
    setF({ ...f, campaign: '', amount: '', notes: '' }); load(); reload()
  }
  return (
    <div className="card shadow-sm space-y-2">
      <h4 className="font-semibold text-navy-700 text-sm">Marketing spend (for CAC)</h4>
      <div className="flex flex-wrap gap-2">
        <input type="month" className="input-field w-auto" value={f.month} onChange={e => setF({ ...f, month: e.target.value })} />
        <select className="input-field w-auto" value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })}>{CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input-field w-40" placeholder="Campaign (optional)" value={f.campaign} onChange={e => setF({ ...f, campaign: e.target.value })} />
        <input className="input-field w-28" placeholder="₹ amount" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') })} />
        <input className="input-field flex-1 min-w-[140px]" placeholder="Notes" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
        <button className="btn-teal text-sm" onClick={add}>Add</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!!rows.length && <table className="text-xs w-full"><tbody>{rows.map(r => (
        <tr key={String(r.id)} className="border-t border-gray-100"><td className="py-1">{label(String(r.month))}</td><td>{CHANNELS.find(c => c[0] === r.channel)?.[1]}</td><td>{String(r.campaign ?? '')}</td><td className="text-right">{inr(Number(r.amount_inr))}</td></tr>
      ))}</tbody></table>}
    </div>
  )
}

function OfflinePaymentForm({ reload }: { reload: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [biz, setBiz] = useState<{ id: string; name: string }[]>([])
  const blank = { business_id: '', payer_name: '', purpose: 'subscription', amount: '', gst: '0', method: 'upi', reference_no: '', invoice_no: '', paid_at: new Date().toISOString().slice(0, 10), period_start: '', period_end: '', notes: '', coupon_code: '', coupon_discount: '' }
  const [f, setF] = useState(blank)
  const [err, setErr] = useState('')
  const load = () => supabase.from('offline_payments').select('*').order('paid_at', { ascending: false }).limit(20).then(({ data }) => setRows(data ?? []))
  useEffect(() => {
    load()
    supabase.from('businesses').select('id, name').order('name').limit(1000).then(({ data }) => setBiz((data ?? []) as { id: string; name: string }[]))
  }, [])
  const add = async () => {
    setErr('')
    if (!(Number(f.amount) > 0)) { setErr('Enter the amount received (excluding GST).'); return }
    if (!f.business_id && !f.payer_name.trim()) { setErr('Choose the business, or write who paid.'); return }
    const { error } = await supabase.from('offline_payments').insert({
      payer_type: f.business_id ? 'business' : 'other', business_id: f.business_id || null, payer_name: f.payer_name || null,
      purpose: f.purpose, amount_inr: Number(f.amount), gst_amount: Number(f.gst) || 0, method: f.method,
      reference_no: f.reference_no || null, invoice_no: f.invoice_no || null, paid_at: f.paid_at,
      period_start: f.period_start || null, period_end: f.period_end || null, notes: f.notes || null,
      coupon_code: f.coupon_code.trim().toUpperCase() || null, coupon_discount: Number(f.coupon_discount) || 0,
    })
    if (error) { setErr(error.message); return }
    setF(blank); load(); reload()
  }
  return (
    <div className="card shadow-sm space-y-2">
      <h4 className="font-semibold text-navy-700 text-sm">Money received outside Razorpay (UPI, bank, cash)</h4>
      <p className="text-xs text-gray-500">Razorpay payments are counted automatically. Never write card or bank account numbers here — only the UPI / bank reference.</p>
      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <select className="input-field" value={f.business_id} onChange={e => setF({ ...f, business_id: e.target.value })}><option value="">Business…</option>{biz.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input className="input-field" placeholder="…or who paid" value={f.payer_name} onChange={e => setF({ ...f, payer_name: e.target.value })} />
        <select className="input-field" value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })}>{PURPOSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input className="input-field" placeholder="₹ ex-GST" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') })} />
        <input className="input-field" placeholder="GST ₹" inputMode="decimal" value={f.gst} onChange={e => setF({ ...f, gst: e.target.value.replace(/[^0-9.]/g, '') })} />
        <select className="input-field" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{['upi', 'bank', 'cash', 'cheque', 'other'].map(x => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select>
        <input className="input-field" placeholder="UPI / bank reference" value={f.reference_no} onChange={e => setF({ ...f, reference_no: e.target.value })} />
        <input className="input-field" placeholder="Invoice no." value={f.invoice_no} onChange={e => setF({ ...f, invoice_no: e.target.value })} />
        <input className="input-field" placeholder="Coupon code (if any)" value={f.coupon_code} onChange={e => setF({ ...f, coupon_code: e.target.value })} />
        <input className="input-field" placeholder="Coupon ₹ off" inputMode="decimal" value={f.coupon_discount} onChange={e => setF({ ...f, coupon_discount: e.target.value.replace(/[^0-9.]/g, '') })} />
        <label className="text-xs text-gray-500">Paid on<input type="date" className="input-field" value={f.paid_at} onChange={e => setF({ ...f, paid_at: e.target.value })} /></label>
        <label className="text-xs text-gray-500">Covers from<input type="date" className="input-field" value={f.period_start} onChange={e => setF({ ...f, period_start: e.target.value })} /></label>
        <label className="text-xs text-gray-500">to<input type="date" className="input-field" value={f.period_end} onChange={e => setF({ ...f, period_end: e.target.value })} /></label>
        <button className="btn-teal text-sm self-end" onClick={add}>Record</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!!rows.length && <table className="text-xs w-full"><tbody>{rows.map(r => (
        <tr key={String(r.id)} className="border-t border-gray-100"><td className="py-1">{String(r.paid_at)}</td><td>{biz.find(b => b.id === r.business_id)?.name ?? String(r.payer_name ?? '')}</td>
          <td>{PURPOSES.find(p => p[0] === r.purpose)?.[1]}</td><td>{String(r.method).toUpperCase()}</td><td className="text-right">{inr(Number(r.amount_inr))}</td></tr>
      ))}</tbody></table>}
    </div>
  )
}

function DistrictForm({ rows, reload }: { rows: Row[]; reload: () => void }) {
  const [edit, setEdit] = useState<Record<string, Row>>({})
  const [add, setAdd] = useState({ name: '', state: 'Haryana' })
  const [err, setErr] = useState('')
  const val = (r: Row, k: string) => String((edit[String(r.id)] ?? r)[k] ?? '')
  const set = (r: Row, k: string, v: string) => setEdit(e => ({ ...e, [String(r.id)]: { ...(e[String(r.id)] ?? r), [k]: v } }))
  const save = async (r: Row) => {
    const x = edit[String(r.id)]; if (!x) return
    const { error } = await supabase.from('districts').update({
      status: x.status, onboarding_started_at: x.onboarding_started_at || null, first_partner_live_at: x.first_partner_live_at || null,
      first_booking_at: x.first_booking_at || null, notes: x.notes || null,
    }).eq('id', r.id as number)
    if (error) setErr(error.message); else { setEdit(e => { const n = { ...e }; delete n[String(r.id)]; return n }); reload() }
  }
  const create = async () => {
    if (!add.name.trim()) return
    const { error } = await supabase.from('districts').insert({ name: add.name.trim(), state: add.state.trim(), status: 'planned' })
    if (error) setErr(error.message); else { setAdd({ name: '', state: 'Haryana' }); reload() }
  }
  return (
    <div className="card shadow-sm space-y-2 overflow-x-auto">
      <h4 className="font-semibold text-navy-700 text-sm">Districts and launch dates</h4>
      <table className="text-xs w-full">
        <thead><tr className="text-left text-gray-500"><th>District</th><th>Status</th><th>Onboarding started</th><th>First partner live</th><th>First booking</th><th>Days to launch</th><th></th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={String(r.id)} className="border-t border-gray-100">
            <td className="py-1 pr-2">{String(r.name)}, {String(r.state)}</td>
            <td><select className="input-field py-1" value={val(r, 'status')} onChange={e => set(r, 'status', e.target.value)}>{['planned', 'onboarding', 'live', 'paused'].map(s => <option key={s}>{s}</option>)}</select></td>
            {['onboarding_started_at', 'first_partner_live_at', 'first_booking_at'].map(k => <td key={k}><input type="date" className="input-field py-1" value={val(r, k)} onChange={e => set(r, k, e.target.value)} /></td>)}
            <td className="text-center">{r.days_to_launch != null ? String(r.days_to_launch) : '—'}</td>
            <td>{edit[String(r.id)] && <button className="btn-teal text-xs py-1 px-2" onClick={() => save(r)}>Save</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="flex gap-2 flex-wrap">
        <input className="input-field w-48" placeholder="New district" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} />
        <input className="input-field w-36" placeholder="State" value={add.state} onChange={e => setAdd({ ...add, state: e.target.value })} />
        <button className="btn-outline text-sm" onClick={create}>Add district</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}

function CampaignCodes() {
  const [rows, setRows] = useState<Row[]>([])
  const [f, setF] = useState({ code: '', label: '', source: 'instagram_reel', location: '' })
  const [err, setErr] = useState('')
  const load = () => supabase.from('wa_entry_points').select('code, label, location, prefilled_text, source_type, is_active').order('created_at', { ascending: false })
    .then(({ data, error }) => { if (error) setErr(error.message); else setRows(data ?? []) })
  useEffect(() => { load() }, [])
  const save = async () => {
    setErr('')
    const { error } = await supabase.rpc('sehat_admin_save_entry_point', { p_code: f.code, p_label: f.label, p_source_type: f.source, p_prefilled: null, p_location: f.location })
    if (error) { setErr(error.message); return }
    setF({ code: '', label: '', source: 'instagram_reel', location: '' }); load()
  }
  const link = (r: Row) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(String(r.prefilled_text ?? `नमस्ते #${r.code}`))}`
  return (
    <div className="card shadow-sm space-y-2">
      <h4 className="font-semibold text-navy-700 text-sm">Campaign codes</h4>
      <p className="text-xs text-gray-500">Each campaign (a reel, a poster batch, a camp, an SMS) gets a code. Its WhatsApp link opens our chat with "नमस्ते #CODE" typed, and the bot records the patient as coming from it. On the website, use <code>sehatsandhi.com/?utm_campaign=CODE</code>.</p>
      <div className="flex flex-wrap gap-2">
        <input className="input-field w-32" placeholder="CODE e.g. REEL07" value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} />
        <input className="input-field w-56" placeholder="What it is (e.g. Fever reel, Oct)" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} />
        <select className="input-field w-auto" value={f.source} onChange={e => setF({ ...f, source: e.target.value })}>
          {Object.entries(SOURCES).filter(([k]) => !['clinic_register', 'unknown'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="input-field w-40" placeholder="Where (optional)" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
        <button className="btn-teal text-sm" onClick={save}>Save code</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <table className="text-xs w-full"><tbody>{rows.map(r => (
        <tr key={String(r.code)} className="border-t border-gray-100">
          <td className="py-1 font-mono">{String(r.code)}</td><td>{String(r.label ?? '')}</td><td>{SOURCES[String(r.source_type)] ?? String(r.source_type)}</td>
          <td><button className="text-teal-700 underline" onClick={() => navigator.clipboard?.writeText(link(r))}>Copy WhatsApp link</button></td>
        </tr>
      ))}</tbody></table>
    </div>
  )
}

// 0215: the same question after a WhatsApp rating. Off until the AiSensy step
// that catches the answer (type 'saved') is in place.
function WaSavingsSwitch() {
  const [on, setOn] = useState<boolean | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { supabase.rpc('sehat_admin_wa_savings', { p_on: null }).then(({ data, error }) => { if (error) setErr(error.message); else setOn(!!data) }) }, [])
  const flip = async () => {
    setErr('')
    const { data, error } = await supabase.rpc('sehat_admin_wa_savings', { p_on: !on })
    if (error) setErr(error.message); else setOn(!!data)
  }
  if (on === null) return err ? <p className="text-xs text-red-600">{err}</p> : null
  return (
    <div className="flex items-center gap-3 flex-wrap text-sm border-t border-gray-100 pt-3">
      <span>Ask it on WhatsApp after a rating: <b className={on ? 'text-teal-700' : 'text-gray-500'}>{on ? 'On' : 'Off'}</b></span>
      <button className={on ? 'btn-outline text-xs' : 'btn-teal text-xs'} onClick={flip}>{on ? 'Turn off' : 'Turn on'}</button>
      <span className="text-xs text-gray-500">Turn on only after the AiSensy "saved" step is set up — otherwise the answer is not caught.</span>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  )
}
