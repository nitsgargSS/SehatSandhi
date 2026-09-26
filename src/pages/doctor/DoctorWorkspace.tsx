import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { StatTile } from '../../components/Charts'
import { isoDate, shortDate } from '../../lib/format'
import {
  getDoctorPerformance, getDoctorPatients, DoctorPerformanceRow, DoctorPatientRow, getDiscounts, DiscountRow,
} from '../../lib/doctorsApi'
import RevenuePanel from './RevenuePanel'
import PublicProfileEditor from './PublicProfileEditor'

// One hospital, many doctors (0121). All patients live in the business; every
// visit, admission, prescription, token and charge says which doctor it is for.
//
//   MyPractice      — a doctor's own page: today, their patients, their numbers.
//   DoctorsOverview — the owner's and manager's view: every doctor side by side,
//                     click one to see their patients and earnings.
//
// The database enforces the split, not these screens: a doctor asking for
// another doctor's list or figures is refused (sehat_doctor_patients,
// sehat_doctor_performance, sehat_revenue_report).

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

type Period = 'today' | 'month' | '30d' | 'year'
const PERIODS: [Period, string][] = [['today', 'Today'], ['month', 'This month'], ['30d', 'Last 30 days'], ['year', 'This year']]

function periodRange(p: Period): { from: string; to: string } {
  const now = new Date()
  const to = isoDate(now)
  if (p === 'today') return { from: to, to }
  if (p === 'month') return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to }
  if (p === 'year') return { from: isoDate(new Date(now.getFullYear(), 0, 1)), to }
  const d = new Date(now); d.setDate(d.getDate() - 29)
  return { from: isoDate(d), to }
}

function PeriodChips({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {PERIODS.map(([p, l]) => (
        <button key={p} onClick={() => onChange(p)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${value === p ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

// ── A doctor's patients ─────────────────────────────────────────────────────
function PatientList({ businessId, practitionerId, onOpenPatient }: {
  businessId: string; practitionerId: string | null; onOpenPatient: (memberId: string) => void
}) {
  const [rows, setRows] = useState<DoctorPatientRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    setLoading(true)
    getDoctorPatients(businessId, practitionerId)
      .then(r => { setRows(r); setError('') })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [businessId, practitionerId])

  const shown = rows.filter(r => !q.trim()
    || r.full_name.toLowerCase().includes(q.trim().toLowerCase())
    || (r.phone ?? '').includes(q.trim()) || (r.mrn ?? '').toLowerCase().includes(q.trim().toLowerCase()))
  const inpatients = rows.filter(r => r.admitted_now).length

  return (
    <div className="card shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-bold text-navy-700">Patients</h3>
          <p className="text-xs text-gray-500">Registered under this doctor, seen by them, or admitted under them · {rows.length} in all{inpatients ? ` · ${inpatients} admitted now` : ''}</p>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, phone, file no." className="input-field text-sm w-56" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? <p className="text-sm text-gray-400">Loading…</p> : !shown.length ? (
        <p className="text-sm text-gray-400">{rows.length ? 'No match.' : 'No patients yet.'}</p>
      ) : (
        <div className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
          {shown.map(r => (
            <button key={r.patient_member_id} onClick={() => onOpenPatient(r.patient_member_id)}
              className="w-full text-left py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 px-1">
              <div className="min-w-0">
                <div className="font-medium text-navy-700 truncate">
                  {r.full_name}
                  {r.admitted_now && <span className="ml-2 text-[10px] font-bold uppercase bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded">IPD{r.bed_label ? ` · bed ${r.bed_label}` : ''}</span>}
                  {r.registered_under_me && <span className="ml-2 text-[10px] text-gray-400">registered</span>}
                </div>
                <div className="text-xs text-gray-500">{r.phone}{r.mrn ? ` · file ${r.mrn}` : ''}</div>
              </div>
              <div className="text-xs text-gray-500 text-right shrink-0">
                {r.visits} visit{r.visits === 1 ? '' : 's'}
                {r.last_visit && <div>last {shortDate(r.last_visit)}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Today's appointments for one doctor ─────────────────────────────────────
function TodayAppointments({ businessId, practitionerId }: { businessId: string; practitionerId: string }) {
  const [rows, setRows] = useState<{ id: string; patient_name: string; slot_datetime: string; status: string }[]>([])
  useEffect(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    const e = new Date(d); e.setDate(e.getDate() + 1)
    supabase.from('appointments').select('id, patient_name, slot_datetime, status')
      .eq('business_id', businessId).eq('practitioner_id', practitionerId)
      .gte('slot_datetime', d.toISOString()).lt('slot_datetime', e.toISOString())
      .order('slot_datetime')
      .then(({ data }) => setRows((data ?? []) as typeof rows))
  }, [businessId, practitionerId])
  return (
    <div className="card shadow-sm">
      <h3 className="font-bold text-navy-700 mb-2">Today's appointments</h3>
      {!rows.length ? <p className="text-sm text-gray-400">None booked for today.</p> : (
        <div className="divide-y divide-gray-100 text-sm">
          {rows.map(r => (
            <div key={r.id} className="py-2 flex justify-between gap-3">
              <span><b>{new Date(r.slot_datetime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</b> · {r.patient_name}</span>
              <span className="text-xs text-gray-500 capitalize">{r.status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Tiles({ r }: { r: DoctorPerformanceRow | undefined }) {
  if (!r) return null
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatTile label="Appointments" value={r.appointments} sub={`${r.completed} seen · ${r.no_shows} no-show`} />
      <StatTile label="OPD visits" value={r.opd_visits} sub={`${r.prescriptions} prescriptions`} />
      <StatTile label="Admissions" value={r.admissions} sub={`${r.discharges} discharged`} />
      <StatTile label="Billed / collected" value={inr(r.billed)} sub={`${inr(r.collected)} collected`} />
    </div>
  )
}

// ── A doctor's own page ─────────────────────────────────────────────────────
// OPD fee at this clinic, and an optional discounted price (0132). The WhatsApp
// bot shows a discount as ~₹600~ ₹450. The server decides who may change it:
// the doctor themselves, the owner or a manager.
export function OpdFee({ businessId, practitionerId }: { businessId: string; practitionerId: string }) {
  const [fee, setFee] = useState('')
  const [disc, setDisc] = useState('')
  const [offer, setOffer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('business_practitioners').select('consultation_fee, discounted_fee')
      .eq('business_id', businessId).eq('practitioner_id', practitionerId).maybeSingle()
      .then(({ data }) => {
        const d = data as { consultation_fee: number | null; discounted_fee: number | null } | null
        setFee(d?.consultation_fee ? String(d.consultation_fee) : '')
        setDisc(d?.discounted_fee != null ? String(d.discounted_fee) : '')
        setOffer(d?.discounted_fee != null)
      })
  }, [businessId, practitionerId])

  const save = async () => {
    setErr(''); setMsg('')
    const f = Number(fee)
    const dv = offer && disc !== '' ? Number(disc) : null
    if (!Number.isFinite(f) || f < 0) { setErr('Enter the regular fee in rupees.'); return }
    if (dv !== null && (!Number.isFinite(dv) || dv < 0 || dv >= f)) { setErr(`The discounted price must be less than ₹${f}.`); return }
    setBusy(true)
    const { error } = await supabase.rpc('sehat_set_opd_fee', {
      p_business: businessId, p_practitioner: practitionerId, p_fee: Math.round(f), p_discounted_fee: dv === null ? null : Math.round(dv),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg(dv !== null ? `Saved. The WhatsApp bot now shows ₹${Math.round(f)} crossed out and ₹${Math.round(dv)}.` : `Saved. The WhatsApp bot now shows ₹${Math.round(f)}.`)
  }

  return (
    <div className="card shadow-sm space-y-3">
      <div>
        <h3 className="font-bold text-navy-700">OPD fee</h3>
        <p className="text-sm text-gray-500">What patients see in the WhatsApp bot and on your profile for a consultation here.</p>
      </div>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-600 mb-1">Regular fee (₹)</span>
          <input className="input-field w-36" inputMode="numeric" value={fee}
            onChange={e => setFee(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 600" />
        </label>
        <label className="flex items-center gap-2 text-sm pb-2.5 cursor-pointer">
          <input type="checkbox" checked={offer} onChange={e => setOffer(e.target.checked)} />
          Offer a discount
        </label>
        {offer && (
          <label className="text-sm">
            <span className="block text-xs font-medium text-gray-600 mb-1">Discounted price (₹)</span>
            <input className="input-field w-36" inputMode="numeric" value={disc}
              onChange={e => setDisc(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 450" />
          </label>
        )}
        <button onClick={save} disabled={busy || fee === ''} className="btn-teal text-sm px-5 py-2.5 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {offer && fee && disc && Number(disc) < Number(fee) && (
        <p className="text-sm text-gray-600">Patients will see: <s>₹{fee}</s> <b>₹{disc}</b> ({Math.round((1 - Number(disc) / Number(fee)) * 100)}% off)</p>
      )}
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}

// Every consultation charged below the doctor's fee (0133), with who gave it and
// why — how the practice checks what the desk gave away.
function DiscountsGiven({ businessId, practitionerId, period }: { businessId: string; practitionerId: string; period: Period }) {
  const [rows, setRows] = useState<DiscountRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const { from, to } = periodRange(period)
    getDiscounts(businessId, practitionerId, from, to)
      .then(r => { setRows(r); setErr('') })
      .catch(e => { setRows([]); setErr((e as Error).message) })
  }, [businessId, practitionerId, period])

  const total = (rows ?? []).reduce((t, r) => t + r.discount_amount, 0)
  const free = (rows ?? []).filter(r => r.discount_kind === 'free').length
  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-navy-700">Free &amp; discounted consultations</h3>
        {rows && rows.length > 0 && (
          <span className="text-sm text-gray-600">
            {rows.length} visit{rows.length === 1 ? '' : 's'} · {free} free · ₹{Math.round(total).toLocaleString('en-IN')} given
          </span>
        )}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p>
        : rows.length === 0 ? <p className="text-sm text-gray-400">None in this period.</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500">
                <th className="py-1 pr-3">Date</th><th className="pr-3">Patient</th><th className="pr-3">Fee</th>
                <th className="pr-3">Charged</th><th className="pr-3">Reason</th><th>Given by</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{shortDate(r.charged_on)}</td>
                    <td className="pr-3">{r.patient_name ?? '—'}</td>
                    <td className="pr-3 whitespace-nowrap">₹{Math.round(r.list_price)}</td>
                    <td className="pr-3 whitespace-nowrap font-medium">{r.discount_kind === 'free' ? 'Free' : `₹${Math.round(r.amount)}`}</td>
                    <td className="pr-3">{r.discount_reason}</td>
                    <td className="whitespace-nowrap">{r.given_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

export function MyPractice({ businessId, practitionerId, doctorName, onOpenPatient }: {
  businessId: string; practitionerId: string; doctorName?: string; onOpenPatient: (memberId: string) => void
}) {
  const [period, setPeriod] = useState<Period>('month')
  const [row, setRow] = useState<DoctorPerformanceRow | undefined>()
  const [error, setError] = useState('')
  useEffect(() => {
    const { from, to } = periodRange(period)
    getDoctorPerformance(businessId, from, to)
      .then(rows => { setRow(rows.find(r => r.practitioner_id === practitionerId)); setError('') })
      .catch(e => setError((e as Error).message))
  }, [businessId, practitionerId, period])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-navy-700">{doctorName ? doctorName : 'My practice'}</h2>
          <p className="text-sm text-gray-500">Your patients and your numbers. Every patient is part of the hospital's one record.</p>
        </div>
        <PeriodChips value={period} onChange={setPeriod} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Tiles r={row} />
      <OpdFee businessId={businessId} practitionerId={practitionerId} />
      <PublicProfileEditor practitionerId={practitionerId} />
      <TodayAppointments businessId={businessId} practitionerId={practitionerId} />
      <PatientList businessId={businessId} practitionerId={practitionerId} onOpenPatient={onOpenPatient} />
      <RevenuePanel businessId={businessId} practitionerId={practitionerId}
        title="What you earned" subtitle="Charges credited to you: your consultations, and bed, medicine and procedure charges on patients admitted under you." />
      <DiscountsGiven businessId={businessId} practitionerId={practitionerId} period={period} />
    </div>
  )
}

// ── Every doctor, for the owner and manager ─────────────────────────────────
export function DoctorsOverview({ businessId, onOpenPatient }: {
  businessId: string; onOpenPatient: (memberId: string) => void
}) {
  const [period, setPeriod] = useState<Period>('month')
  const [rows, setRows] = useState<DoctorPerformanceRow[]>([])
  const [open, setOpen] = useState<DoctorPerformanceRow | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const { from, to } = periodRange(period)
    getDoctorPerformance(businessId, from, to)
      .then(r => { setRows(r); setError('') })
      .catch(e => setError((e as Error).message))
  }, [businessId, period])

  const total = useMemo(() => rows.reduce((t, r) => ({
    appointments: t.appointments + r.appointments, opd_visits: t.opd_visits + r.opd_visits,
    admissions: t.admissions + r.admissions, billed: t.billed + r.billed, collected: t.collected + r.collected,
  }), { appointments: 0, opd_visits: 0, admissions: 0, billed: 0, collected: 0 }), [rows])

  const csv = () => {
    const head = ['Doctor', 'Speciality', 'Appointments', 'Seen', 'No-show', 'Cancelled', 'OPD visits', 'Prescriptions', 'Admissions', 'Discharges', 'Patients', 'Registered', 'Billed', 'Collected']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head.map(esc).join(',')].concat(rows.map(r => [r.doctor_name, r.speciality, r.appointments, r.completed, r.no_shows, r.cancelled,
      r.opd_visits, r.prescriptions, r.admissions, r.discharges, r.patients, r.registered_patients, r.billed, r.collected].map(esc).join(',')))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `doctors-${period}-${isoDate()}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  if (open && open.practitioner_id) {
    return (
      <div className="space-y-4">
        <button onClick={() => setOpen(null)} className="text-sm text-teal-700 font-semibold">← All doctors</button>
        <MyPractice businessId={businessId} practitionerId={open.practitioner_id} doctorName={open.doctor_name} onOpenPatient={onOpenPatient} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-navy-700">Doctors</h2>
          <p className="text-sm text-gray-500">Who is doing what, and how much. Click a doctor for their patients and earnings.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <PeriodChips value={period} onChange={setPeriod} />
          <button onClick={csv} disabled={!rows.length} className="btn-outline text-sm disabled:opacity-50">Download CSV</button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Appointments" value={total.appointments} />
        <StatTile label="OPD visits" value={total.opd_visits} />
        <StatTile label="Admissions" value={total.admissions} />
        <StatTile label="Billed / collected" value={inr(total.billed)} sub={`${inr(total.collected)} collected`} />
      </div>
      <div className="card shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
            <th className="py-2 pr-3">Doctor</th><th className="pr-3">Appointments</th><th className="pr-3">OPD</th>
            <th className="pr-3">Prescriptions</th><th className="pr-3">IPD</th><th className="pr-3">Patients</th>
            <th className="pr-3 text-right">Billed</th><th className="text-right">Collected</th>
          </tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.practitioner_id ?? 'none'} onClick={() => r.practitioner_id && setOpen(r)}
              className={`border-b border-gray-50 ${r.practitioner_id ? 'cursor-pointer hover:bg-gray-50' : 'text-gray-500'}`}>
              <td className="py-2.5 pr-3">
                <div className="font-medium text-navy-700">{r.doctor_name}</div>
                {r.speciality && <div className="text-xs text-gray-400">{r.speciality}</div>}
                {!r.practitioner_id && <div className="text-xs text-gray-400">Records with no doctor chosen</div>}
              </td>
              <td className="pr-3">{r.appointments}<span className="text-xs text-gray-400"> · {r.completed} seen · {r.no_shows} no-show</span></td>
              <td className="pr-3">{r.opd_visits}</td>
              <td className="pr-3">{r.prescriptions}</td>
              <td className="pr-3">{r.admissions}<span className="text-xs text-gray-400"> · {r.discharges} out</span></td>
              <td className="pr-3">{r.patients}<span className="text-xs text-gray-400"> · {r.registered_patients} reg.</span></td>
              <td className="pr-3 text-right font-semibold">{inr(r.billed)}</td>
              <td className="text-right">{inr(r.collected)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
