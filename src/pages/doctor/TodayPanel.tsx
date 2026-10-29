import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BedDouble, CalendarClock, FlaskConical, IndianRupee, ListOrdered, Pill, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { issueToken } from '../../lib/queueApi'
import { setAppointmentStatus } from '../../lib/appointmentApi'
import DeskBooking from './DeskBooking'
import ReportsReady from './ReportsReady'

// 0265: the Today tab — what needs attention right now, from sehat_today.
//
// At the top, only what is wrong (plan ending, wallet low, messages failed,
// reports waiting to be signed). Then one row of numbers per part of the
// clinic that is switched on, each opening its tab. Then today's appointments,
// doctor by doctor: who is due, who has arrived, who was seen — with Mark
// arrived and No-show on each — and each doctor's next free time with Book.
// It replaces a grid of every slot in the day that could not be clicked.

type Tab = 'queue' | 'beds' | 'lab' | 'pharmacy' | 'collections' | 'patientreport' | 'plan' | 'whatsapp' | 'appointments'

interface Appt {
  id: string; at: string; name: string; member_id: string | null; status: string; phone4: string
  token: { id: string; number: number; status: string } | null
}
interface Doc { id: string | null; name: string; me: boolean; appointments: Appt[]; free_today: number; next_free: string | null }
interface Today {
  role: string | null
  doctors: Doc[]
  next: { at: string; doctor: string | null } | null
  opd?: { waiting: number; with_doctor: number; seen: number; left: number }
  follow_ups?: { due_today: number; missed_7d: number }
  ipd?: { beds: number; occupied: number; admitted: number; admitted_today: number; discharge_due: number; discharged_today: number }
  lab?: { ordered: number; home: number; collected: number; in_progress: number; ready: number; reported_today: number }
  pharmacy?: { sales_today: number; bills_today: number; low_stock: number; expiring_30d: number }
  money?: { billed_today: number; collected_today: number; unpaid_bills: number; unpaid_amount: number }
  alerts?: { kind: string; text: string }[]
}

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
const ALERT_TAB: Record<string, Tab> = { plan: 'plan', wallet: 'whatsapp', auto: 'whatsapp', lab: 'lab', beds: 'beds', deposit: 'beds' }

export default function TodayPanel({ businessId, booksAppointments, onGoTo, onOpenPatient }: {
  businessId: string
  booksAppointments: boolean
  onGoTo: (tab: Tab) => void
  onOpenPatient: (memberId: string) => void
}) {
  const [d, setD] = useState<Today | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [booking, setBooking] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(() => {
    supabase.rpc('sehat_today', { p_business: businessId })
      .then(({ data, error }) => { if (error) setErr(error.message); else { setD(data as Today); setErr('') } })
  }, [businessId])
  // Every minute: the queue moves while the screen is open.
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  const act = async (id: string, f: () => Promise<unknown>, done: string) => {
    setBusy(id); setNote('')
    try { await f(); setNote(done); load() } catch (e) { setNote((e as Error).message) } finally { setBusy(null) }
  }

  if (err) return <div className="card shadow-sm text-sm text-red-600">{err}</div>
  if (!d) return <div className="card shadow-sm text-sm text-gray-400">Loading today…</div>

  const now = Date.now()
  const docs = d.doctors.filter(x => x.appointments.length || x.free_today > 0 || x.me)
  const away = d.doctors.filter(x => !docs.includes(x) && x.id)
  const anyAppts = d.doctors.some(x => x.appointments.length)

  return (
    <div className="space-y-4">
      <ReportsReady businessId={businessId} onOpenPatient={onOpenPatient} />
      {/* Only what is wrong. */}
      {!!d.alerts?.length && (
        <div className="space-y-2">
          {d.alerts.map((a, i) => (
            <button key={i} type="button" onClick={() => ALERT_TAB[a.kind] && onGoTo(ALERT_TAB[a.kind])}
              className="w-full text-left bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 hover:border-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" /> <span className="flex-1">{a.text}</span> <span className="text-xs font-semibold">Open →</span>
            </button>
          ))}
        </div>
      )}

      {/* One row of numbers per part of the clinic. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {d.opd && (
          <Box icon={<ListOrdered className="w-4 h-4 text-teal-600" />} title="OPD queue" onClick={() => onGoTo('queue')}
            main={`${d.opd.waiting} waiting`} sub={`${d.opd.with_doctor} with the doctor · ${d.opd.seen} seen`} />
        )}
        {d.follow_ups && (d.follow_ups.due_today > 0 || d.follow_ups.missed_7d > 0) && (
          <Box icon={<CalendarClock className="w-4 h-4 text-teal-600" />} title="Follow-ups" onClick={() => onGoTo('patientreport')}
            main={`${d.follow_ups.due_today} due today`} sub={`${d.follow_ups.missed_7d} missed in the last 7 days`} alert={d.follow_ups.missed_7d > 0} />
        )}
        {d.ipd && (
          <Box icon={<BedDouble className="w-4 h-4 text-teal-600" />} title="Wards" onClick={() => onGoTo('beds')}
            main={`${d.ipd.occupied} of ${d.ipd.beds} beds`}
            sub={`${d.ipd.admitted_today} admitted today · ${d.ipd.discharge_due} discharge${d.ipd.discharge_due === 1 ? '' : 's'} due`}
            alert={d.ipd.discharge_due > 0} />
        )}
        {d.lab && (
          <Box icon={<FlaskConical className="w-4 h-4 text-teal-600" />} title="Lab" onClick={() => onGoTo('lab')}
            main={`${d.lab.ordered} waiting for a sample`}
            sub={`${d.lab.home ? `${d.lab.home} home · ` : ''}${d.lab.collected + d.lab.in_progress} in progress · ${d.lab.ready} to sign · ${d.lab.reported_today} reported today`}
            alert={d.lab.ready > 0} />
        )}
        {d.pharmacy && (
          <Box icon={<Pill className="w-4 h-4 text-teal-600" />} title="Pharmacy" onClick={() => onGoTo('pharmacy')}
            main={`${inr(d.pharmacy.sales_today)} sold today`}
            sub={`${d.pharmacy.low_stock} low on stock · ${d.pharmacy.expiring_30d} expiring in 30 days`}
            alert={d.pharmacy.low_stock > 0 || d.pharmacy.expiring_30d > 0} />
        )}
        {d.money && (
          <Box icon={<IndianRupee className="w-4 h-4 text-teal-600" />} title="Money today" onClick={() => onGoTo('collections')}
            main={`${inr(d.money.collected_today)} collected`}
            sub={`${inr(d.money.billed_today)} billed · ${d.money.unpaid_bills} unpaid bill${d.money.unpaid_bills === 1 ? '' : 's'} (${inr(d.money.unpaid_amount)})`} />
        )}
      </div>

      {/* Today's appointments, doctor by doctor. */}
      {booksAppointments && (
        <div className="card shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-navy-700">Today’s appointments</h3>
            <button onClick={load} className="text-xs text-gray-500 hover:text-navy-700 inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Refresh</button>
          </div>
          {note && <p className="text-sm bg-gray-50 rounded-lg px-3 py-2">{note}</p>}

          {!anyAppts && (
            <p className="text-sm text-gray-500">
              No appointments today.
              {d.next && <> Next: <b>{new Date(d.next.at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, {time(d.next.at)}</b>{d.next.doctor ? ` (${d.next.doctor})` : ''}.</>}
            </p>
          )}

          {docs.map(doc => {
            const nextId = doc.appointments.find(a => !a.token && ['booked', 'confirmed'].includes(a.status) && new Date(a.at).getTime() > now - 15 * 60_000)?.id
            return (
              <div key={doc.id ?? 'any'}>
                <div className="flex items-center justify-between gap-2 flex-wrap border-b border-gray-100 pb-1.5">
                  <span className="font-semibold text-navy-700 text-sm">{doc.name}{doc.me ? ' (you)' : ''}</span>
                  {doc.id && (
                    <span className="text-xs text-gray-500 flex items-center gap-2">
                      {doc.next_free ? <>next free <b>{time(doc.next_free)}</b> · {doc.free_today} free today</> : 'no free time left today'}
                      <button onClick={() => setBooking(booking === doc.id ? null : doc.id)} className="text-teal-700 font-semibold hover:underline">Book</button>
                    </span>
                  )}
                </div>
                {booking === doc.id && doc.id && (
                  <div className="mt-2">
                    <DeskBooking businessId={businessId} doctorId={doc.id} onBooked={load} onClose={() => setBooking(null)} />
                  </div>
                )}
                {!doc.appointments.length ? <p className="text-xs text-gray-400 py-1.5">Nobody booked yet.</p> : (
                  <ul className="divide-y divide-gray-50">
                    {doc.appointments.map(a => {
                      const past = new Date(a.at).getTime() < now - 15 * 60_000
                      const done = a.status === 'completed' || a.token?.status === 'completed'
                      const open = !a.token && ['booked', 'confirmed'].includes(a.status)
                      const state = a.status === 'no_show' ? ['No-show', 'text-gray-400']
                        : done ? ['Seen ✓', 'text-green-700']
                        : a.token && ['called', 'in_consultation'].includes(a.token.status) ? [`With the doctor · #${a.token.number}`, 'text-teal-700']
                        : a.token ? [`Arrived · in queue #${a.token.number}`, 'text-teal-700']
                        : past ? ['Late', 'text-amber-700'] : ['Due', 'text-gray-500']
                      return (
                        <li key={a.id} className={`py-2 flex items-center gap-3 flex-wrap text-sm ${done || a.status === 'no_show' ? 'opacity-60' : ''} ${a.id === nextId ? 'bg-teal-50/60 -mx-2 px-2 rounded-lg' : ''}`}>
                          <span className="w-16 font-semibold text-navy-700">{time(a.at)}</span>
                          <span className="flex-1 min-w-[8rem]">
                            {a.member_id
                              ? <button onClick={() => onOpenPatient(a.member_id!)} className="hover:underline text-left">{a.name}</button>
                              : a.name}
                            {a.phone4 && <span className="text-xs text-gray-400"> · ••••{a.phone4}</span>}
                            {a.id === nextId && <span className="text-[11px] font-semibold text-teal-700 ml-1">next</span>}
                          </span>
                          <span className={`text-xs font-semibold ${state[1]}`}>{state[0]}</span>
                          {open && (
                            <span className="flex gap-1.5">
                              <button disabled={busy === a.id}
                                onClick={() => a.member_id
                                  ? act(a.id, () => issueToken({ patientMemberId: a.member_id!, businessId, practitionerId: doc.id, appointmentId: a.id }), `${a.name} is in the queue.`)
                                  : onGoTo('queue')}
                                title={a.member_id ? 'Give a token and put them in the OPD queue' : 'Not registered yet — register them at the queue'}
                                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 disabled:opacity-50">
                                Mark arrived
                              </button>
                              <button disabled={busy === a.id}
                                onClick={() => act(a.id, () => setAppointmentStatus(a.id, 'no_show'), `${a.name} marked as not turned up.`)}
                                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">
                                No-show
                              </button>
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
          {!!away.length && d.doctors.length > 1 && (
            <p className="text-xs text-gray-400">Not sitting today: {away.map(x => x.name).join(', ')}.</p>
          )}
          <button onClick={() => onGoTo('appointments')} className="text-xs text-teal-700 font-semibold hover:underline">All appointments →</button>
        </div>
      )}
    </div>
  )
}

function Box({ icon, title, main, sub, onClick, alert }: {
  icon: React.ReactNode; title: string; main: string; sub: string; onClick: () => void; alert?: boolean
}) {
  return (
    <button type="button" onClick={onClick}
      className={`text-left bg-white border rounded-xl p-3.5 hover:border-teal-400 hover:shadow-sm transition ${alert ? 'border-amber-200' : 'border-gray-100'}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1">{icon}{title}</div>
      <div className="text-lg font-bold text-navy-700">{main}</div>
      <div className={`text-xs mt-0.5 ${alert ? 'text-amber-700' : 'text-gray-500'}`}>{sub}</div>
    </button>
  )
}
