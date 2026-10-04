import { useEffect, useRef, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { visitRegister, type RegisterKind, type RegisterRow } from '../../lib/patientsApi'
import { listBusinessDoctors, type BusinessDoctor } from '../../lib/doctorsApi'
import { downloadCsv } from '../../lib/billingApi'
import { isoDate, shortDate } from '../../lib/format'

// Who came when (0193). Pick dates on the calendar — or Today, This week,
// This month — a doctor, and what to list; search within it; open anyone to add
// to a visit or write the diagnosis later; download the list.
//
// The numbers on the Patient report and My practice open this with their own
// dates and kind, and the list has exactly that many rows: the server counts
// the way the report does.

export interface RegisterRequest { kind: RegisterKind; from: string | null; to: string | null; doctorId?: string | null; nonce: number }

export const KIND_LABEL: Record<RegisterKind, string> = {
  visits: 'Visits', patients: 'Patients seen', new: 'New patients', returning: 'Returning patients',
  admissions: 'Admissions', follow_ups: 'Follow-ups due', missed: 'Missed follow-ups', all: 'All patients',
}
const KINDS = Object.keys(KIND_LABEL) as RegisterKind[]

type Quick = 'today' | 'week' | 'month' | 'custom'
const rangeFor = (q: Quick): [string, string] => {
  const now = new Date(); const today = isoDate(now)
  if (q === 'today') return [today, today]
  if (q === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [isoDate(d), today] }
  return [today.slice(0, 8) + '01', today]
}

export default function VisitRegister({ businessId, defaultDoctorId = null, request, onOpen, title = 'Patients by date' }: {
  businessId: string
  /** My practice opens on the doctor's own patients; "All doctors" is one tap away. */
  defaultDoctorId?: string | null
  request?: RegisterRequest | null
  onOpen: (memberId: string, visitId: string | null) => void
  title?: string
}) {
  const [quick, setQuick] = useState<Quick>('today')
  const [from, setFrom] = useState(rangeFor('today')[0])
  const [to, setTo] = useState(rangeFor('today')[1])
  const [kind, setKind] = useState<RegisterKind>('visits')
  const [doctorId, setDoctorId] = useState<string>(defaultDoctorId ?? '')
  const [doctors, setDoctors] = useState<BusinessDoctor[]>([])
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState('')
  const [rows, setRows] = useState<RegisterRow[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { listBusinessDoctors(businessId).then(setDoctors).catch(() => setDoctors([])) }, [businessId])

  // A number was clicked: take its dates and kind, and come into view.
  useEffect(() => {
    if (!request) return
    setKind(request.kind)
    setFrom(request.from ?? ''); setTo(request.to ?? ''); setQuick('custom')
    if (request.doctorId !== undefined) setDoctorId(request.doctorId ?? '')
    setQ(''); setApplied('')
    setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [request])

  useEffect(() => {
    let live = true
    setBusy(true)
    visitRegister(businessId, { from: kind === 'all' ? null : from || null, to: kind === 'all' ? null : to || null, doctorId: doctorId || null, query: applied, kind })
      .then(r => { if (live) { setRows(r); setErr('') } })
      .catch(e => { if (live) { setRows([]); setErr((e as Error).message) } })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [businessId, from, to, doctorId, kind, applied])

  const pick = (k: Quick) => { setQuick(k); if (k !== 'custom') { const [a, b] = rangeFor(k); setFrom(a); setTo(b) } }
  const csv = () => {
    if (!rows?.length) return
    const head = ['Date', 'Patient', 'Age', 'Gender', 'Phone', 'File no.', 'PIN', 'City', 'Doctor', 'Complaint', 'Diagnosis', 'Follow-up', 'First seen', 'Visits in all']
    const body = rows.map(r => [r.on_date ?? '', r.full_name, r.age_years ?? '', r.gender ?? '', r.phone ?? '', r.mrn ?? '', r.pin_code ?? '', r.city ?? '',
      r.doctor ?? '', r.chief_complaint ?? '', r.diagnosis ?? '', r.follow_up_due ?? '', r.first_seen ?? '', r.visits_total])
    downloadCsv(`${KIND_LABEL[kind].toLowerCase().replace(/\s+/g, '-')}-${kind === 'all' ? 'all' : `${from}-to-${to}`}.csv`,
      [head, ...body].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))
  }
  const people = rows ? new Set(rows.map(r => r.patient_member_id)).size : 0

  return (
    <div ref={box} className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-navy-700">{title}</h3>
        {rows && rows.length > 0 && (
          <button onClick={csv} className="btn-outline text-sm py-1.5 px-3 flex items-center gap-1"><Download className="w-4 h-4" /> Download</button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        {([['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Pick dates']] as [Quick, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => pick(k)} disabled={kind === 'all'}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${quick === k && kind !== 'all' ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500'}`}>{l}</button>
        ))}
        {kind !== 'all' && (
          <span className="flex items-center gap-1 text-sm">
            <input type="date" className="input-field py-1.5 w-auto" value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setQuick('custom') }} aria-label="From" />
            <span className="text-gray-400">to</span>
            <input type="date" className="input-field py-1.5 w-auto" value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setQuick('custom') }} aria-label="To" />
          </span>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select className="input-field py-1.5 w-auto" value={kind} onChange={e => setKind(e.target.value as RegisterKind)} aria-label="What to list">
          {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        {doctors.length > 0 && (
          <select className="input-field py-1.5 w-auto" value={doctorId} onChange={e => setDoctorId(e.target.value)} aria-label="Doctor">
            <option value="">All doctors</option>
            {doctors.map(d => <option key={d.practitioner_id} value={d.practitioner_id}>{d.full_name}</option>)}
          </select>
        )}
        <form className="flex gap-2 flex-1 min-w-[220px]" onSubmit={e => { e.preventDefault(); setApplied(q) }}>
          <input className="input-field py-1.5 flex-1" value={q} onChange={e => { setQ(e.target.value); if (!e.target.value) setApplied('') }}
            placeholder="Name, phone, file no., PIN or diagnosis" aria-label="Search in this list" />
          <button type="submit" className="btn-teal text-sm py-1.5 px-3 flex items-center gap-1"><Search className="w-4 h-4" /> Search</button>
        </form>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows && (
        <p className="text-sm text-gray-600">
          {busy ? 'Loading…' : <>
            <b>{rows.length}</b> {KIND_LABEL[kind].toLowerCase()}{['visits', 'admissions', 'follow_ups', 'missed'].includes(kind) && rows.length ? ` · ${people} patient${people === 1 ? '' : 's'}` : ''}
            {kind !== 'all' && from && to ? ` · ${from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`}` : ''}
            {applied ? ` · matching “${applied}”` : ''}
            {rows.length >= 2000 ? ' (first 2000 — narrow the dates)' : ''}
          </>}
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="py-1.5 pr-3">Date</th><th className="pr-3">Patient</th><th className="pr-3">Phone</th><th className="pr-3">Doctor</th>
              <th className="pr-3">Complaint / diagnosis</th><th className="pr-3">Follow-up</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.patient_member_id}-${r.on_date}-${i}`} className="border-b border-gray-50 align-top hover:bg-gray-50">
                  <td className="py-2 pr-3 whitespace-nowrap">{r.on_date ? shortDate(r.on_date) : '—'}</td>
                  <td className="pr-3">
                    <div className="font-medium text-navy-700">{r.full_name}</div>
                    <div className="text-xs text-gray-500">{[r.age_years != null ? `${r.age_years}y` : '', r.gender ?? '', r.mrn ? `file ${r.mrn}` : '', r.pin_code ?? ''].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="pr-3 whitespace-nowrap">{r.phone ? `+${r.phone}` : '—'}</td>
                  <td className="pr-3">{r.doctor ?? '—'}</td>
                  <td className="pr-3 max-w-[260px]">
                    {r.diagnosis ? <div>{r.diagnosis}</div> : <div className="text-amber-700 text-xs">{r.visit_id ? 'No diagnosis yet' : ''}</div>}
                    {r.chief_complaint && <div className="text-xs text-gray-500">{r.chief_complaint}</div>}
                  </td>
                  <td className="pr-3 whitespace-nowrap">{r.follow_up_due ? shortDate(r.follow_up_due) : ''}</td>
                  <td className="whitespace-nowrap">
                    <button onClick={() => onOpen(r.patient_member_id, r.visit_id)} className="text-teal-700 font-semibold text-sm underline">
                      {r.visit_id ? 'Open visit' : 'Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length === 0 && !busy && <p className="text-sm text-gray-400">Nobody in this list{applied ? ' matches that search' : ''}.</p>}
    </div>
  )
}
