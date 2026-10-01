import { useCallback, useEffect, useState } from 'react'
import { Ambulance, Check, ChevronDown, ChevronUp, MapPin, Phone, RefreshCw, X } from 'lucide-react'
import {
  listTrips, acceptTrip, declineTrip, dropTrip, onTheWay, pickedUp, completeTrip, tripDrivers,
  TRIP_STATUS, TRIP_EVENT, type Trip, type TripScope, type Driver, type FareMode,
} from '../../lib/ambulanceApi'
import { DeliveryAreaCard } from './OrdersPanel'

// 0191: an ambulance service's requests. Every service in the PIN sees a new
// one; the first to accept takes it and sees the patient's phone and pickup
// address at once. A driver sees new requests and only their own trips.

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : ''
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}
const money = (n: number | null) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN')

export default function TripsPanel({ businessId, role }: { businessId: string; role: string | null }) {
  const isDriver = role === 'driver'
  const [scope, setScope] = useState<TripScope>('new')
  const [trips, setTrips] = useState<Trip[]>([])
  const [counts, setCounts] = useState<Record<TripScope, number>>({ new: 0, active: 0, done: 0 })
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const scopes: TripScope[] = ['new', 'active', 'done']
      const all = await Promise.all(scopes.map(x => listTrips(businessId, x)))
      setCounts({ new: all[0].length, active: all[1].length, done: all[2].length })
      setTrips(all[scopes.indexOf(scope)])
      setErr('')
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [businessId, scope])
  useEffect(() => { load() }, [load])
  // Emergencies: check every 15 seconds.
  useEffect(() => { const t = setInterval(load, 15_000); return () => clearInterval(t) }, [load])
  useEffect(() => { if (!isDriver) tripDrivers(businessId).then(setDrivers).catch(() => setDrivers([])) }, [businessId, isDriver])

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setErr('')
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <h2 className="font-bold text-navy-700 text-lg">Ambulance requests</h2>
          <button onClick={load} className="text-sm text-teal-700 flex items-center gap-1"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
        <p className="text-sm text-gray-500">
          Patients in your areas ask on WhatsApp. They are given your number and 108 straight away; this is for the crew that
          can reach them first. Accept and you get their phone and pickup address at once.
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {([['new', 'New'], ['active', isDriver ? 'My trips' : 'Under way'], ['done', 'Done']] as [TripScope, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setScope(k)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${scope === k ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'} ${k === 'new' && counts.new ? 'ring-2 ring-red-300' : ''}`}>
              {l}{counts[k] ? ` · ${counts[k]}` : ''}
            </button>
          ))}
        </div>
      </div>

      {!isDriver && <DeliveryAreaCard businessId={businessId} canEdit={role === 'owner' || role === 'manager'}
        title="Where you serve" what="reach with an ambulance" none="requests" />}
      {err && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>}
      {!loading && trips.length === 0 && (
        <div className="card shadow-sm text-sm text-gray-500">
          {scope === 'new' ? 'No requests right now. New ones appear here and as an alert in the Sehatsandhi app.'
            : scope === 'active' ? 'No trips under way.' : 'No finished trips in the last 30 days.'}
        </div>
      )}
      {trips.map(t => <TripCard key={t.id} t={t} businessId={businessId} isDriver={isDriver} drivers={drivers} busy={busy === t.id} run={fn => run(t.id, fn)} />)}
    </div>
  )
}

function TripCard({ t, businessId, isDriver, drivers, busy, run }: {
  t: Trip; businessId: string; isDriver: boolean; drivers: Driver[]; busy: boolean; run: (fn: () => Promise<unknown>) => void
}) {
  const [open, setOpen] = useState(!['completed', 'cancelled', 'expired'].includes(t.status))
  const [driver, setDriver] = useState(drivers.find(d => d.role === 'driver')?.practitioner_id ?? '')
  const [vehicle, setVehicle] = useState('')
  const [eta, setEta] = useState('15')
  const [fare, setFare] = useState('')
  const [mode, setMode] = useState<FareMode>('cash')
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState<'decline' | 'drop' | null>(null)
  const urgent = t.kind === 'emergency' && t.status === 'open'
  useEffect(() => { if (!driver && drivers.length) setDriver(drivers.find(d => d.role === 'driver')?.practitioner_id ?? '') }, [drivers, driver])

  return (
    <div className={`card shadow-sm ${urgent ? 'border-2 border-red-400' : ''}`}>
      <button className="w-full text-left flex items-start justify-between gap-3" onClick={() => setOpen(v => !v)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-navy-700">{t.code}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${t.kind === 'emergency' ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-700'}`}>{t.kind === 'emergency' ? 'EMERGENCY' : 'Scheduled'}</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{TRIP_STATUS[t.status]}</span>
          </div>
          <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap"><MapPin className="w-3.5 h-3.5" /> {t.pin_code} · {ago(t.created_at)}{t.patient_name ? ` · ${t.patient_name}` : ''}</div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm">
          {t.need && <div className="bg-gray-50 rounded-xl p-3"><span className="text-xs font-semibold text-gray-500 uppercase">Needed</span><div className="text-gray-800">{t.need}</div></div>}

          {(t.patient_phone || t.pickup_address) && (
            <div className="bg-teal-50 rounded-xl p-3 space-y-1">
              <div className="font-semibold text-navy-700">{t.patient_name}</div>
              {t.patient_phone && <a href={`tel:+${t.patient_phone}`} className="flex items-center gap-1 text-teal-700 font-semibold"><Phone className="w-4 h-4" /> +{t.patient_phone}</a>}
              {t.pickup_address && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.pickup_address}, ${t.pin_code}`)}`} target="_blank" rel="noreferrer"
                  className="flex items-start gap-1 text-gray-700"><MapPin className="w-4 h-4 mt-0.5 shrink-0" /> {t.pickup_address}, {t.pin_code}</a>
              )}
            </div>
          )}
          {t.mine && t.driver_name && (
            <p className="text-gray-600"><Ambulance className="w-4 h-4 inline" /> {t.driver_name}{t.driver_phone ? ` · ${t.driver_phone}` : ''}{t.vehicle_no ? ` · ${t.vehicle_no}` : ''}{t.eta_minutes ? ` · ETA ${t.eta_minutes} min` : ''}</p>
          )}

          {t.status === 'open' && (asking === 'decline' ? (
            <div className="flex gap-2 flex-wrap items-center">
              <input className="input-field flex-1 min-w-[180px]" placeholder="Why? (optional, e.g. all vehicles out)" value={reason} onChange={e => setReason(e.target.value)} />
              <button disabled={busy} onClick={() => run(() => declineTrip(businessId, t.id, reason))} className="btn-outline text-sm py-2 px-4">Decline</button>
              <button onClick={() => setAsking(null)} className="text-sm text-gray-500">Back</button>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="grid sm:grid-cols-3 gap-2">
                {!isDriver && (
                  <label className="text-xs text-gray-600">Driver
                    <select className="input-field mt-1" value={driver} onChange={e => setDriver(e.target.value)}>
                      <option value="">I'll go myself</option>
                      {drivers.map(d => <option key={d.practitioner_id} value={d.practitioner_id}>{d.name}{d.role === 'driver' ? '' : ` (${d.role})`}</option>)}
                    </select></label>
                )}
                <label className="text-xs text-gray-600">Vehicle number
                  <input className="input-field mt-1" placeholder="HR 02 AB 1234" value={vehicle} onChange={e => setVehicle(e.target.value)} /></label>
                <label className="text-xs text-gray-600">Reach in (minutes)
                  <input className="input-field mt-1" inputMode="numeric" value={eta} onChange={e => setEta(e.target.value.replace(/\D/g, ''))} /></label>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button disabled={busy} onClick={() => run(() => acceptTrip(businessId, t.id, isDriver ? null : (driver || null), vehicle, eta ? Number(eta) : null))}
                  className="btn-teal text-sm py-2 px-4 flex items-center gap-1"><Check className="w-4 h-4" /> Accept — we're going</button>
                <button onClick={() => setAsking('decline')} className="btn-outline text-sm py-2 px-4">Can't go</button>
              </div>
            </div>
          ))}

          {t.mine && t.status === 'accepted' && (
            <div className="flex gap-2 flex-wrap">
              <button disabled={busy} onClick={() => run(() => onTheWay(businessId, t.id, null))} className="btn-teal text-sm py-2 px-4">On the way</button>
              <button disabled={busy} onClick={() => run(() => pickedUp(businessId, t.id))} className="btn-outline text-sm py-2 px-4">Picked up</button>
              {!isDriver && <button onClick={() => setAsking('drop')} className="btn-outline text-sm py-2 px-4">Give up</button>}
            </div>
          )}
          {t.mine && t.status === 'on_the_way' && (
            <div className="flex gap-2 flex-wrap">
              <button disabled={busy} onClick={() => run(() => pickedUp(businessId, t.id))} className="btn-teal text-sm py-2 px-4">Patient picked up</button>
              {!isDriver && <button onClick={() => setAsking('drop')} className="btn-outline text-sm py-2 px-4">Give up</button>}
            </div>
          )}
          {asking === 'drop' && (
            <div className="flex gap-2 flex-wrap items-center bg-amber-50 rounded-xl p-3">
              <input className="input-field flex-1 min-w-[180px]" placeholder="Why? e.g. vehicle broke down" value={reason} onChange={e => setReason(e.target.value)} />
              <button disabled={busy || !reason.trim()} onClick={() => run(() => dropTrip(businessId, t.id, reason.trim()))} className="btn-outline text-sm py-2 px-4">Give up — pass to another ambulance</button>
              <button onClick={() => setAsking(null)} className="text-sm text-gray-500">Back</button>
            </div>
          )}
          {t.mine && ['accepted', 'on_the_way', 'picked_up'].includes(t.status) && (
            <div className="border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="font-semibold text-navy-700">Trip done?</div>
              <div className="flex gap-2 flex-wrap items-end">
                <label className="text-xs text-gray-600">Fare (₹, 0 if free)
                  <input className="input-field mt-1 w-32" inputMode="decimal" value={fare} onChange={e => setFare(e.target.value.replace(/[^\d.]/g, ''))} /></label>
                {(['cash', 'upi', 'card', 'other', 'free'] as FareMode[]).map(m => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-full text-sm border ${mode === m ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200 text-gray-600'}`}>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</button>
                ))}
              </div>
              <button disabled={busy || fare === ''} onClick={() => run(() => completeTrip(businessId, t.id, Number(fare), mode))} className="btn-teal text-sm py-2 px-4">Complete trip</button>
            </div>
          )}

          {t.status === 'completed' && (
            <div className="text-gray-600">Completed {when(t.completed_at)} by {t.completed_by_name} · {money(t.fare)} ({t.paid_mode?.toUpperCase()})
              {t.rating ? <div className="mt-1">Patient rating: {'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}{t.review ? ` — “${t.review}”` : ''}</div> : null}</div>
          )}
          {(t.status === 'cancelled' || t.status === 'expired') && t.ended_reason && <p className="text-gray-500 flex items-center gap-1"><X className="w-4 h-4" /> {t.ended_reason}</p>}

          {t.events && t.events.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Who did what</summary>
              <ul className="mt-1 space-y-0.5">
                {t.events.map((e, i) => <li key={i}>{when(e.at)} — {TRIP_EVENT[e.event] ?? e.event}{e.by ? ` · ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
