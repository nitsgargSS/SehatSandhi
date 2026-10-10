import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { isoDate, moneyExact, shortDate } from '../../lib/format'
import { downloadCsv } from '../../lib/billingApi'
import { StatTile, ColumnChart, BarList, Point } from '../../components/Charts'
import VisitRegister, { type RegisterRequest } from './VisitRegister'
import type { RegisterKind } from '../../lib/patientsApi'

// The patient report (0161): how many patients, how often, from where, who
// they are, who saw them, what they came with, whose follow-up is due and who
// has stopped coming — for the owner, a manager or a doctor growing the
// practice. One RPC; this screen only draws it.

type Grain = 'day' | 'week' | 'month' | 'quarter' | 'year'

interface Report {
  from: string; to: string; grain: Grain
  totals: { all_time: number; active_12m: number; seen: number; new: number; returning: number; visits: number
            admissions: number; prev_seen: number; prev_new: number; prev_visits: number; revenue: number; unknown_area: number }
  trend: { period: string; new: number; seen: number; visits: number; admissions: number }[]
  by_pincode: { pin_code: string; district: string | null; state: string | null; patients: number; new: number }[]
  by_city: { city: string; state: string | null; patients: number; new: number }[]
  by_state: { state: string; patients: number }[]
  by_gender: Record<string, number>
  by_age: { band: string; patients: number }[]
  by_source: { source: string; patients: number }[]
  by_doctor: { doctor: string; patients: number; visits: number; new: number }[]
  top_diagnoses: { diagnosis: string; icd10: string | null; visits: number; patients: number }[]
  busiest: { weekday: Record<string, number>; hour: Record<string, number> }
  follow_ups: { due_7d: number; overdue: number }
  lapsed_count: number
  lapsed: { name: string; phone: string; last_seen: string; visits: number; pin_code: string | null; city: string | null }[]
}

const PRESETS: [string, string, () => [string, string], Grain][] = [
  ['today', 'Today', () => [isoDate(), isoDate()], 'day'],
  ['7d', 'Last 7 days', () => [shift(-6), isoDate()], 'day'],
  ['30d', 'Last 30 days', () => [shift(-29), isoDate()], 'day'],
  ['month', 'This month', () => [isoDate().slice(0, 8) + '01', isoDate()], 'day'],
  ['12m', 'Last 12 months', () => [shift(-364), isoDate()], 'month'],
  ['year', 'This year', () => [isoDate().slice(0, 5) + '01-01', isoDate()], 'month'],
  ['all', 'All time', () => ['2000-01-01', isoDate()], 'month'],
]
function shift(days: number) { const d = new Date(); d.setDate(d.getDate() + days); return isoDate(d) }

const SOURCE: Record<string, string> = {
  walk_in: 'Walk-in', appointment: 'Booked appointment', bot: 'WhatsApp bot', qr_reception: 'QR code at reception',
  referral: 'Referral', import: 'Imported register',
}
const GENDER: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other', not_recorded: 'Not recorded' }
const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const change = (now: number, before: number) => {
  if (!before) return now ? 'none in the period before' : undefined
  const pct = Math.round(((now - before) / before) * 100)
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs the period before`
}
const periodLabel = (iso: string, g: Grain) => {
  const d = new Date(iso + 'T00:00:00')
  if (g === 'year') return String(d.getFullYear())
  if (g === 'month' || g === 'quarter') return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="card shadow-sm">
      <div className="text-sm font-semibold text-navy-700 mb-3">{title}</div>
      {children}
      {note && <p className="text-xs text-gray-400 mt-2">{note}</p>}
    </div>
  )
}

export default function PatientReportPanel({ businessId, onOpenPatient }: { businessId: string; onOpenPatient?: (memberId: string, visitId?: string | null) => void }) {
  // 0193: every number opens the people behind it, below.
  const [req, setReq] = useState<RegisterRequest | null>(null)
  const show = (kind: RegisterKind, from: string | null, to: string | null) => setReq({ kind, from, to, doctorId: null, nonce: Date.now() })
  const [preset, setPreset] = useState('30d')
  const [range, setRange] = useState<[string, string]>(PRESETS[2][2]())
  const [grain, setGrain] = useState<Grain>('day')
  const [series, setSeries] = useState<'new' | 'seen' | 'visits'>('seen')
  const [r, setR] = useState<Report | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase.rpc('sehat_patient_report', { p_business: businessId, p_from: range[0], p_to: range[1], p_grain: grain })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setErr(error.message); setR(null) } else { setErr(''); setR(data as Report) }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [businessId, range, grain])

  const pick = (id: string) => {
    const p = PRESETS.find(x => x[0] === id)!
    setPreset(id); setRange(p[2]()); setGrain(p[3])
  }

  const lapsedCsv = () => {
    if (!r) return
    const rows = [['Name', 'Phone', 'Last visit', 'Visits', 'PIN', 'City'],
      ...r.lapsed.map(l => [l.name, l.phone, l.last_seen, String(l.visits), l.pin_code ?? '', l.city ?? ''])]
    downloadCsv(`patients-to-invite-back-${isoDate()}.csv`, rows.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))
  }

  const t = r?.totals
  const trend: Point[] = (r?.trend ?? []).map(p => ({ label: periodLabel(p.period, r!.grain), value: p[series], hint: `${periodLabel(p.period, r!.grain)}` }))
  const busiestDay: Point[] = [1, 2, 3, 4, 5, 6, 7].map(d => ({ label: WEEKDAY[d], value: Number(r?.busiest.weekday[String(d)] ?? 0) }))
  const hours = Object.keys(r?.busiest.hour ?? {}).map(Number).sort((a, b) => a - b)
  const busiestHour: Point[] = hours.length
    ? Array.from({ length: hours[hours.length - 1] - hours[0] + 1 }, (_, i) => hours[0] + i)
        .map(h => ({ label: `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`, value: Number(r?.busiest.hour[String(h)] ?? 0) }))
    : []
  const unknownShare = t && t.seen ? Math.round((t.unknown_area / t.seen) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-700">Patient report</h2>
          <p className="text-sm text-gray-500">How many patients, how often, from where — and who to bring back.</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {PRESETS.map(([id, label]) => (
            <button key={id} onClick={() => pick(id)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${preset === id ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <input type="date" className="input-field w-auto" value={range[0]} onChange={e => { setPreset(''); setRange([e.target.value, range[1]]) }} />
        <span className="text-gray-400">to</span>
        <input type="date" className="input-field w-auto" value={range[1]} onChange={e => { setPreset(''); setRange([range[0], e.target.value]) }} />
        <span className="text-gray-400 ml-2">Show by</span>
        <select className="input-field w-auto" value={grain} onChange={e => setGrain(e.target.value as Grain)}>
          <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
          <option value="quarter">Quarter</option><option value="year">Year</option>
        </select>
      </div>

      {err && <div className="card shadow-sm text-sm text-amber-700 bg-amber-50 border-amber-200">{err}</div>}
      {loading && !r ? <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div> : r && t && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile onClick={() => show('all', null, null)} active={req?.kind === 'all'} label="Patients, all time" value={t.all_time} sub={`${t.active_12m.toLocaleString('en-IN')} seen in the last 12 months`} />
            <StatTile onClick={() => show('patients', range[0], range[1])} active={req?.kind === 'patients'} label="Patients in this period" value={t.seen} sub={change(t.seen, t.prev_seen)} />
            <StatTile onClick={() => show('new', range[0], range[1])} active={req?.kind === 'new'} label="New patients" value={t.new} sub={change(t.new, t.prev_new)} />
            <StatTile onClick={() => show('returning', range[0], range[1])} active={req?.kind === 'returning'} label="Returning patients" value={t.returning} sub={t.seen ? `${Math.round((t.returning / t.seen) * 100)}% came again after their first visit` : undefined} />
            <StatTile onClick={() => show('visits', range[0], range[1])} active={req?.kind === 'visits'} label="Visits" value={t.visits} sub={change(t.visits, t.prev_visits)} />
            <StatTile onClick={() => show('admissions', range[0], range[1])} active={req?.kind === 'admissions'} label="Admissions" value={t.admissions} />
            <StatTile label="Billed" value={moneyExact(t.revenue)} sub={t.seen ? `${moneyExact(t.revenue / t.seen)} per patient` : undefined} />
            <StatTile onClick={() => show('follow_ups', isoDate(), shift(7))} active={req?.kind === 'follow_ups'} label="Follow-ups" value={r.follow_ups.due_7d} sub={`due in 7 days · ${r.follow_ups.overdue} missed`} tone={r.follow_ups.overdue > 0 ? 'alert' : 'normal'} />
          </div>
          {req && (
            <VisitRegister businessId={businessId} request={req} title="The list behind the number"
              onOpen={(m, v) => onOpenPatient?.(m, v)} />
          )}

          <Card title="Patients over time">
            <div className="flex gap-1 mb-3">
              {([['seen', 'Patients'], ['new', 'New'], ['visits', 'Visits']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setSeries(k)}
                  className={`text-xs px-3 py-1 rounded-full border ${series === k ? 'bg-teal-50 border-teal-500 text-teal-700' : 'border-gray-200 text-gray-500'}`}>{l}</button>
              ))}
            </div>
            <ColumnChart data={trend} />
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500"><th className="py-1">Period</th><th className="text-right">Patients</th><th className="text-right">New</th><th className="text-right">Visits</th><th className="text-right">Admissions</th></tr></thead>
                <tbody>{[...r.trend].reverse().filter(p => p.seen || p.new || p.visits).slice(0, 24).map(p => (
                  <tr key={p.period} className="border-t"><td className="py-1">{periodLabel(p.period, r.grain)}</td>
                    <td className="text-right">{p.seen}</td><td className="text-right">{p.new}</td><td className="text-right">{p.visits}</td><td className="text-right">{p.admissions}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Where they come from — by city / district"
              note={t.unknown_area ? `${t.unknown_area} of ${t.seen} patients (${unknownShare}%) have no PIN code. Ask for it at registration — it is on the OPD and Patients forms.` : undefined}>
              <BarList data={r.by_city.map(c => ({ label: `${c.city}${c.state ? `, ${c.state}` : ''}`, value: c.patients, hint: `${c.new} new` }))} />
            </Card>
            <Card title="By PIN code">
              <BarList data={r.by_pincode.slice(0, 15).map(p => ({ label: `${p.pin_code}${p.district ? ` · ${p.district}` : ''}`, value: p.patients, hint: `${p.new} new` }))} />
            </Card>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <Card title="Age">
              <BarList data={r.by_age.map(a => ({ label: a.band, value: a.patients }))} />
            </Card>
            <Card title="Gender">
              <BarList data={Object.entries(r.by_gender).map(([g, n]) => ({ label: GENDER[g] ?? g, value: n }))} />
            </Card>
            <Card title="How new patients found you">
              <BarList data={r.by_source.map(s => ({ label: SOURCE[s.source] ?? s.source, value: s.patients }))} />
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="By doctor">
              {r.by_doctor.length === 0 ? <p className="text-sm text-gray-400">Nothing recorded yet.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 text-xs"><th className="py-1">Doctor</th><th className="text-right">Patients</th><th className="text-right">New</th><th className="text-right">Visits</th></tr></thead>
                  <tbody>{r.by_doctor.map(d => (
                    <tr key={d.doctor} className="border-t"><td className="py-1.5">{d.doctor}</td><td className="text-right">{d.patients}</td><td className="text-right">{d.new}</td><td className="text-right">{d.visits}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Card>
            <Card title="What patients came with" note="From diagnoses written in visit notes.">
              <BarList data={r.top_diagnoses.map(d => ({ label: `${d.diagnosis}${d.icd10 && d.icd10 !== d.diagnosis ? ` (${d.icd10})` : ''}`, value: d.patients, hint: `${d.visits} visits` }))} />
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Busiest days">
              <ColumnChart data={busiestDay} height={100} />
            </Card>
            <Card title="Busiest hours (OPD arrivals)">
              <ColumnChart data={busiestHour} height={100} />
            </Card>
          </div>

          <Card title={`Patients to invite back — ${r.lapsed_count}`}
            note="Seen here before, but not in the last 6 to 18 months. Download the list to call them or send a WhatsApp message.">
            {r.lapsed.length === 0 ? <p className="text-sm text-gray-400">Nobody yet.</p> : (
              <>
                <div className="flex justify-end mb-2">
                  <button onClick={lapsedCsv} className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1"><Download className="w-3 h-3" /> Download list</button>
                </div>
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-gray-500"><th className="py-1">Name</th><th>Phone</th><th>Last visit</th><th className="text-right">Visits</th><th>Area</th></tr></thead>
                    <tbody>{r.lapsed.slice(0, 50).map((l, i) => (
                      <tr key={i} className="border-t"><td className="py-1">{l.name}</td><td>{l.phone}</td><td>{shortDate(l.last_seen)}</td><td className="text-right">{l.visits}</td><td>{[l.pin_code, l.city].filter(Boolean).join(' · ')}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
