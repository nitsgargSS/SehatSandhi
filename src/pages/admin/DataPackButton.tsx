import { useState } from 'react'
import { supabase } from '../../lib/supabase'

// "डेटा पैक डाउनलोड करें" — the data pack for anyone who asks (investor, grant
// body, bank): an Excel workbook (one sheet per area + the definitions) and a
// one-to-two page PDF summary. Built in the browser from sehat_admin_metrics —
// counts and totals only: no names, phone numbers or health details can reach
// it, because the call never returns any. Each export is logged
// (metrics_export_log: who, when, which period). exceljs and jsPDF load only
// when the button is pressed.
type Row = Record<string, unknown>

const DEFINITIONS: [string, string][] = [
  ['Monthly active patients', 'Unique patients (one per mobile number) with ≥1 booking, typed message, app day, medicine order, ambulance or insurance request in the month.'],
  ['Bookings', 'Appointments created in the month, by status, service and channel.'],
  ['Completed bookings', 'Marked completed, or the booked time passed without cancel / no-show.'],
  ['Active partners', 'Live businesses with ≥1 booking or profile view in the month.'],
  ['Paying partners', 'Businesses with a payment covering any day of the month.'],
  ['Revenue', 'Money received, excluding GST, net of refunds: Razorpay payments, wallet top-ups, offline payments.'],
  ['MRR', 'Subscription payments spread evenly over the months they cover.'],
  ['Repeat rate', '% of a month\'s new patients with a second booking within 30 / 90 days.'],
  ['Cohort retention', 'Of each month\'s new patients, % active in each later month.'],
  ['CAC', 'Marketing spend for a channel ÷ new patients from that channel in the month (clinic-imported patients excluded).'],
  ['Funnel', 'Searches → results shown → profiles opened → booked → completed.'],
  ['Time to launch a district', 'First booking date − onboarding start date.'],
  ['Unmet demand', 'Searches that found nobody for that service in that area.'],
  ['Months', 'Calendar months, India time (Asia/Kolkata). Definition version 1 (docs/metrics-definitions.md).'],
]

export default function DataPackButton({ from, to, district }: { from: string; to: string; district: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const build = async () => {
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('sehat_admin_metrics', { p_from: from, p_to: to, p_district: district || null })
      if (error) throw new Error(error.message)
      const m = data as Record<string, Row[] & Row>
      const months: string[] = []
      for (const d = new Date(from + 'T00:00:00'); d <= new Date(to + 'T00:00:00'); d.setMonth(d.getMonth() + 1))
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
      const rows = (k: string) => (m[k] as unknown as Row[]) ?? []
      const sumOf = (k: string, mo: string, f: string, key = 'month') => rows(k).filter(r => r[key] === mo).reduce((a, r) => a + Number(r[f] ?? 0), 0)
      const lbl = (mo: string) => mo.slice(0, 7)

      const monthly = months.map(mo => {
        const rep = rows('repeat').find(r => r.cohort_month === mo)
        const spend = sumOf('cac', mo, 'spend'), newp = sumOf('cac', mo, 'new_patients')
        return {
          Month: lbl(mo), 'Active patients': sumOf('map', mo, 'patients'), Bookings: sumOf('bookings', mo, 'total'),
          Completed: sumOf('bookings', mo, 'completed'), Cancelled: sumOf('bookings', mo, 'cancelled'), 'No-show': sumOf('bookings', mo, 'no_show'),
          'Revenue ex-GST (₹)': Math.round(sumOf('revenue', mo, 'revenue')), 'MRR (₹)': Math.round(sumOf('mrr', mo, 'mrr')),
          'Active partners': sumOf('partners', mo, 'active'), 'Paying partners': sumOf('partners', mo, 'paying'),
          'New patients (first booking)': Number(rep?.new_patients ?? 0),
          'Repeat ≤30 days %': rep && Number(rep.new_patients) ? Math.round(100 * Number(rep.repeat_30) / Number(rep.new_patients)) : '',
          'Marketing spend (₹)': Math.round(spend), 'CAC (₹)': newp ? Math.round(spend / newp) : '',
        }
      })
      const sheets: [string, Row[]][] = [
        ['Monthly metrics', monthly],
        ['Funnel', rows('funnel').map(r => ({ Month: lbl(String(r.month)), Searches: r.searches, 'Results shown': r.results_shown, 'Profiles opened': r.profile_views, Booked: r.booked, Completed: r.completed }))],
        ['Cohorts', rows('retention').map(r => ({ 'Started': lbl(String(r.cohort_month)), 'Months later': r.month_offset, 'New patients': r.cohort_size, 'Still active': r.active,
          '%': Number(r.cohort_size) ? Math.round(100 * Number(r.active) / Number(r.cohort_size)) : '' }))],
        ['Revenue', rows('revenue').map(r => ({ Month: lbl(String(r.month)), Purpose: r.purpose, 'Revenue ex-GST (₹)': Math.round(Number(r.revenue)), 'GST (₹)': Math.round(Number(r.gst)) }))],
        ['Partners by type', rows('partners').map(r => ({ Month: lbl(String(r.month)), Type: r.vertical, Active: r.active, Paying: r.paying }))],
        ['Bookings by service', rows('bookings').map(r => ({ Month: lbl(String(r.month)), Service: r.vertical, Channel: r.channel, Total: r.total, Completed: r.completed, Cancelled: r.cancelled, 'No-show': r.no_show }))],
        ['Acquisition', rows('acquisition').map(r => ({ Month: lbl(String(r.month)), Source: r.source, 'First channel': r.channel, 'New patients': r.n }))],
        ['CAC by channel', rows('cac').map(r => ({ Month: lbl(String(r.month)), Channel: r.channel, 'Spend (₹)': r.spend, 'New patients': r.new_patients, 'CAC (₹)': r.cac ?? '' }))],
        ['Impact', rows('impact').map(r => ({ Month: lbl(String(r.month)), 'Rural bookings': r.rural_bookings, 'Urban bookings': r.urban_bookings, 'Medicine orders': r.medicine_orders,
          'Ambulance requests': r.ambulance_requests, 'Median minutes to accept': r.ambulance_median_accept_minutes ?? '', 'Median minutes to pick-up': r.ambulance_median_pickup_minutes ?? '',
          'Insurance requests': r.insurance_requests, 'Unmet searches': r.unmet_searches, 'Typed messages': r.typed_messages, 'In Hindi': r.hindi_messages }))],
        ['Districts', rows('districts').map(r => ({ District: r.name, State: r.state, Status: r.status, 'Onboarding started': r.onboarding_started_at ?? '',
          'First partner live': r.first_partner_live_at ?? '', 'First booking': r.first_booking_at ?? '', 'Days to launch': r.days_to_launch ?? '' }))],
      ]
      const stamp = new Date().toISOString().slice(0, 10)
      const scope = `${lbl(from)} to ${lbl(to)}${district ? ` · ${district}` : ' · all districts'}`

      // ── Excel ──
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      wb.creator = 'Sehatsandhi'
      const summary = wb.addWorksheet('Summary')
      summary.addRows([['Sehatsandhi — data pack'], [scope], [`Exported ${stamp}. Aggregated numbers only — no patient names, phone numbers or health details.`], []])
      const last = monthly[monthly.length - 1] ?? {}
      for (const [k, v] of Object.entries(last)) summary.addRow([k, v])
      summary.getColumn(1).width = 34; summary.getRow(1).font = { bold: true, size: 14 }
      for (const [name, data] of sheets) {
        const ws = wb.addWorksheet(name)
        if (!data.length) { ws.addRow(['Nothing in this period.']); continue }
        ws.columns = Object.keys(data[0]).map(k => ({ header: k, key: k, width: Math.max(12, k.length + 2) }))
        ws.addRows(data); ws.getRow(1).font = { bold: true }
      }
      const defs = wb.addWorksheet('Definitions')
      defs.columns = [{ header: 'Metric', key: 'm', width: 28 }, { header: 'Definition', key: 'd', width: 110 }]
      DEFINITIONS.forEach(([a, b]) => defs.addRow({ m: a, d: b })); defs.getRow(1).font = { bold: true }
      const xbuf = await wb.xlsx.writeBuffer()
      save(new Blob([xbuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `sehatsandhi-data-pack-${stamp}.xlsx`)

      // ── PDF summary ──
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
      const W = pdf.internal.pageSize.getWidth()
      let y = 50
      pdf.setFontSize(18); pdf.text('Sehatsandhi — data pack', 40, y); y += 20
      pdf.setFontSize(10); pdf.setTextColor(90); pdf.text(`${scope} · exported ${stamp} · aggregated numbers only`, 40, y); pdf.setTextColor(0); y += 26
      const head = ['Active patients', 'Bookings', 'Completed', 'Revenue ex-GST (₹)', 'Paying partners', 'Repeat ≤30 days %', 'CAC (₹)'] as const
      pdf.setFontSize(11)
      for (const k of head) { pdf.text(k, 40, y); pdf.text(String((last as Row)[k] ?? '—'), W - 40, y, { align: 'right' }); y += 16 }
      y += 10
      const charts: [string, string][] = [['Active patients', 'Monthly active patients'], ['Bookings', 'Bookings'], ['Revenue ex-GST (₹)', 'Revenue (₹, ex-GST)'], ['Paying partners', 'Paying partners']]
      for (const [k, title] of charts) {
        if (y > 700) { pdf.addPage(); y = 50 }
        pdf.setFontSize(11); pdf.text(title, 40, y); y += 8
        const vals = monthly.map(r => Number((r as Row)[k] ?? 0)), max = Math.max(1, ...vals)
        const bw = Math.min(28, (W - 80) / Math.max(1, vals.length) - 4), h = 70
        vals.forEach((v, i) => {
          const bh = (v / max) * h, x = 40 + i * (bw + 4)
          pdf.setFillColor(13, 148, 136); pdf.rect(x, y + h - bh, bw, bh, 'F')
          pdf.setFontSize(6); pdf.setTextColor(90); pdf.text(monthly[i].Month.slice(2), x, y + h + 9); pdf.text(String(v), x, y + h - bh - 2); pdf.setTextColor(0)
        })
        y += h + 26
      }
      pdf.setFontSize(8); pdf.setTextColor(110)
      pdf.text('Definitions are in the Excel workbook (sheet "Definitions"). Months are calendar months in India time.', 40, 810)
      save(pdf.output('blob'), `sehatsandhi-summary-${stamp}.pdf`)

      await supabase.from('metrics_export_log').insert({ kind: 'data_pack', params: { from, to, district: district || null } })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div>
      <button disabled={busy} onClick={build} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Preparing…' : '⬇ डेटा पैक डाउनलोड करें'}</button>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
