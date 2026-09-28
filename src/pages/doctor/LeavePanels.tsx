import { useEffect, useState } from 'react'
import { addLeave, cancelLeave, listLeaveConflicts, listUpcomingLeave, myWeek, type Leave, type LeaveConflict, type WeekItem } from '../../lib/leaveApi'

// 0150: leave and unavailability, and a doctor's week across clinics.
//
//   MyLeave         My practice — a doctor's own leave, at every clinic or one
//   ClinicLeave     Schedule — owner/manager: the clinic's doctors' leave, and
//                   marking a doctor unavailable at this clinic only
//   LeaveConflicts  Appointments — bookings a new leave now covers, to move
//   MyWeek          My practice — appointments at every clinic, no patient detail

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })

/** Whole days by default; untick to give hours. Local date/time inputs → Date. */
function LeaveForm({ onAdd, busy }: { onAdd: (from: Date, to: Date, reason: string) => void; busy: boolean }) {
  const today = new Date().toISOString().slice(0, 10)
  const [allDay, setAllDay] = useState(true)
  const [f, setF] = useState({ fromDate: today, toDate: today, fromTime: '09:00', toTime: '13:00', reason: '' })
  const submit = () => {
    const from = new Date(`${f.fromDate}T${allDay ? '00:00' : f.fromTime}`)
    const to = allDay ? new Date(new Date(`${f.toDate}T00:00`).getTime() + 86_400_000) : new Date(`${f.toDate}T${f.toTime}`)
    onAdd(from, to, f.reason)
  }
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      <label className="text-xs text-gray-600">From
        <div className="flex gap-1"><input type="date" className="input-field text-sm" min={today} value={f.fromDate} onChange={e => setF(v => ({ ...v, fromDate: e.target.value, toDate: e.target.value > v.toDate ? e.target.value : v.toDate }))} />
          {!allDay && <input type="time" className="input-field text-sm" value={f.fromTime} onChange={e => setF(v => ({ ...v, fromTime: e.target.value }))} />}</div>
      </label>
      <label className="text-xs text-gray-600">{allDay ? 'To (last day of leave)' : 'To'}
        <div className="flex gap-1"><input type="date" className="input-field text-sm" min={f.fromDate} value={f.toDate} onChange={e => setF(v => ({ ...v, toDate: e.target.value }))} />
          {!allDay && <input type="time" className="input-field text-sm" value={f.toTime} onChange={e => setF(v => ({ ...v, toTime: e.target.value }))} />}</div>
      </label>
      <input className="input-field text-sm" placeholder="Reason (optional)" value={f.reason} onChange={e => setF(v => ({ ...v, reason: e.target.value }))} />
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-600 inline-flex items-center gap-1">
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> Whole days
        </label>
        <button onClick={submit} disabled={busy} className="btn-teal text-sm py-2 px-4 disabled:opacity-50">Add</button>
      </div>
    </div>
  )
}

function LeaveList({ rows, names, canCancel, onCancel, busy }: {
  rows: Leave[]; names: (l: Leave) => string; canCancel: (l: Leave) => boolean; onCancel: (l: Leave) => void; busy: boolean
}) {
  if (!rows.length) return <p className="text-sm text-gray-400 mb-3">No leave coming up.</p>
  return (
    <div className="divide-y divide-gray-100 text-sm mb-3">
      {rows.map(l => (
        <div key={l.id} className="py-2 flex flex-wrap gap-x-3 items-center">
          <span className="font-medium text-navy-700">{names(l)}</span>
          <span>{fmt(l.starts_at)} → {fmt(l.ends_at)}</span>
          {l.reason && <span className="text-gray-500">{l.reason}</span>}
          {canCancel(l) && (
            <button disabled={busy} onClick={() => onCancel(l)} className="ml-auto text-xs text-red-600 underline disabled:opacity-50">Cancel</button>
          )}
        </div>
      ))}
    </div>
  )
}

export function MyLeave({ practitionerId, clinics }: { practitionerId: string; clinics: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<Leave[]>([])
  const [where, setWhere] = useState('')           // '' = every clinic
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = () => { listUpcomingLeave([practitionerId]).then(setRows).catch(e => setErr(e.message)) }
  useEffect(load, [practitionerId])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn(); load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const clinicName = (id: string | null) => id ? clinics.find(c => c.id === id)?.name ?? 'one clinic' : 'All clinics'
  return (
    <div className="card shadow-sm mt-6">
      <h3 className="font-bold text-navy-700 mb-1">My leave</h3>
      <p className="text-sm text-gray-500 mb-3">
        No patient can book you on leave — on WhatsApp, the website or at the desk. Bookings already made are
        listed for the clinic to move; they are not cancelled.
      </p>
      {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
      <LeaveList rows={rows} names={l => clinicName(l.business_id)} busy={busy}
        canCancel={() => true} onCancel={l => run(() => cancelLeave(l.id))} />
      {clinics.length > 1 && (
        <select className="input-field text-sm w-auto mb-2" value={where} onChange={e => setWhere(e.target.value)}>
          <option value="">At every clinic</option>
          {clinics.map(c => <option key={c.id} value={c.id}>Only at {c.name}</option>)}
        </select>
      )}
      <LeaveForm busy={busy} onAdd={(from, to, reason) => run(() => addLeave(practitionerId, where || null, from, to, reason))} />
    </div>
  )
}

export function ClinicLeave({ businessId, doctors }: { businessId: string; doctors: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<Leave[]>([])
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ids = doctors.map(d => d.id).join(',')
  const load = () => {
    if (!doctors.length) return
    listUpcomingLeave(doctors.map(d => d.id))
      .then(r => setRows(r.filter(l => l.business_id === null || l.business_id === businessId)))
      .catch(e => setErr(e.message))
  }
  useEffect(load, [businessId, ids])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn(); load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (!doctors.length) return null
  const nameOf = (l: Leave) => `${doctors.find(d => d.id === l.practitioner_id)?.name ?? 'Doctor'}${l.business_id ? ' · here' : ' · own leave'}`
  return (
    <div className="card shadow-sm">
      <h3 className="font-bold text-navy-700 mb-1">Doctors' leave &amp; unavailability</h3>
      <p className="text-sm text-gray-500 mb-3">
        A doctor's own leave applies at every clinic and only they can change it. You can mark a doctor unavailable
        at this clinic — patients then cannot book them here at those times.
      </p>
      {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
      <LeaveList rows={rows} names={nameOf} busy={busy}
        canCancel={l => l.business_id === businessId} onCancel={l => run(() => cancelLeave(l.id))} />
      <select className="input-field text-sm w-auto mb-2" value={who} onChange={e => setWho(e.target.value)}>
        <option value="">Choose a doctor…</option>
        {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {who && <LeaveForm busy={busy} onAdd={(from, to, reason) => run(() => addLeave(who, businessId, from, to, reason))} />}
    </div>
  )
}

export function LeaveConflicts({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<LeaveConflict[]>([])
  useEffect(() => { listLeaveConflicts(businessId).then(setRows).catch(() => setRows([])) }, [businessId])
  if (!rows.length) return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
      <p className="font-semibold text-amber-800 mb-2">
        {rows.length} booking{rows.length === 1 ? '' : 's'} fall{rows.length === 1 ? 's' : ''} on a doctor's leave — call the patient and move {rows.length === 1 ? 'it' : 'them'}
      </p>
      <div className="divide-y divide-amber-100">
        {rows.map(r => (
          <div key={r.appointment_id} className="py-1.5 flex flex-wrap gap-x-3 text-amber-900">
            <span>{fmt(r.slot_datetime)}</span>
            <span className="font-medium">{r.doctor_name}</span>
            <span>{r.patient_name ?? 'Patient'}</span>
            {r.patient_phone && <a href={`tel:+${r.patient_phone}`} className="underline">{r.patient_phone}</a>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function MyWeek() {
  const [items, setItems] = useState<WeekItem[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    const from = new Date(); const to = new Date(Date.now() + 6 * 86_400_000)
    const d = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    myWeek(d(from), d(to)).then(setItems).catch(e => setErr(e.message))
  }, [])
  const byDay = items.reduce<Record<string, WeekItem[]>>((acc, i) => {
    (acc[fmtDay(i.slot_datetime)] ??= []).push(i); return acc
  }, {})
  return (
    <div className="card shadow-sm mt-6">
      <h3 className="font-bold text-navy-700 mb-1">My week, all clinics</h3>
      <p className="text-sm text-gray-500 mb-3">
        Your bookings at every clinic for the next 7 days. Patient details stay with each clinic — switch to it to open them.
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!err && items.length === 0 && <p className="text-sm text-gray-400">No bookings in the next 7 days.</p>}
      {Object.entries(byDay).map(([day, list]) => (
        <div key={day} className="mb-3">
          <p className="text-sm font-semibold text-gray-700 mb-1">{day}</p>
          <div className="text-sm divide-y divide-gray-50">
            {list.map((i, k) => (
              <div key={k} className={`py-1 flex gap-3 ${i.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>
                <span className="w-20 text-gray-600">{new Date(i.slot_datetime).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
                <span>{i.business_name}{i.location_name ? ` · ${i.location_name}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
