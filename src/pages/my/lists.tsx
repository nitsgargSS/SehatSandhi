import { useState } from 'react'
import { Link } from 'react-router-dom'
import { cancelBooking, type Activity, type RateKind } from '../../lib/patientApi'
import { Err, when } from './MyShell'

// What waits for a rating, and every request on the number — My Sehatsandhi
// shows the latest three of each, My requests all of them. Same rules as the app.
const STATUS: Record<string, string> = {
  open: 'Waiting for a reply', accepted: 'Accepted', quoted: 'Price ready — approve it', confirmed: 'Approved', packed: 'Packed',
  out_for_delivery: 'On the way', delivered: 'Delivered', on_the_way: 'On the way', picked_up: 'Picked up', completed: 'Completed',
  contacted: 'Advisor spoke to you', won: 'Policy bought', lost: 'Closed', cancelled: 'Cancelled', expired: 'Expired',
  no_pharmacy: 'No pharmacy delivers here yet', disputed: 'Under review',
}
export type ToRate = { kind: RateKind; id: string; title: string }
export type Req = { key: string; icon: string; title: string; sub: string; at: number; url?: string; cancelId?: string }

export function toRate(act: Activity | null): ToRate[] {
  if (!act) return []
  return [
    ...act.bookings.filter(b => b.rateable).map(b => ({ kind: 'booking' as const, id: b.id, title: `Visit — ${b.place ?? 'clinic'}${b.doctor ? ` (${b.doctor})` : ''}` })),
    ...act.orders.filter(o => o.rateable).map(o => ({ kind: 'order' as const, id: o.id, title: `Medicines ${o.code} — ${o.pharmacy ?? ''}` })),
    ...act.trips.filter(t => t.rateable).map(t => ({ kind: 'trip' as const, id: t.id, title: `Ambulance ${t.code} — ${t.service ?? ''}` })),
    ...act.insurance.filter(l => l.rateable).map(l => ({ kind: 'insurance' as const, id: l.id, title: `Insurance advisor — ${l.advisor ?? ''}` })),
  ]
}

export function requests(act: Activity | null): Req[] {
  if (!act) return []
  const now = Date.now()
  const out: Req[] = [
    ...act.orders.map(o => ({ key: `o${o.id}`, icon: '💊', title: `Medicines ${o.code}`, at: +new Date(o.created_at), url: `/o/${o.token}`,
      sub: [STATUS[o.status] ?? o.status, o.pharmacy, o.total ? `₹${o.total}` : null].filter(Boolean).join(' · ') })),
    ...act.trips.map(t => ({ key: `t${t.id}`, icon: '🚑', title: `Ambulance ${t.code}`, at: +new Date(t.created_at), url: `/a/${t.token}`,
      sub: [STATUS[t.status] ?? t.status, t.service].filter(Boolean).join(' · ') })),
    ...act.insurance.map(l => ({ key: `i${l.id}`, icon: '🛡️', title: `Insurance ${l.code}`, at: +new Date(l.created_at), url: `/i/${l.token}`,
      sub: [STATUS[l.status] ?? l.status, l.advisor].filter(Boolean).join(' · ') })),
    ...act.bookings.map(b => {
      const at = +new Date(b.when)
      const upcoming = at > now && ['booked', 'confirmed'].includes(b.status)
      const word = upcoming ? 'Upcoming' : b.status === 'cancelled' ? 'Cancelled' : b.status === 'completed' ? 'Visited' : 'Past'
      return { key: `b${b.id}`, icon: '🩺', title: `${b.place ?? 'Clinic'}${b.doctor ? ` · ${b.doctor}` : ''}`, at,
        sub: [word, b.name].filter(Boolean).join(' · '), cancelId: upcoming ? b.id : undefined }
    }),
  ]
  return out.sort((a, b) => {
    const ua = a.cancelId ? 1 : 0, ub = b.cancelId ? 1 : 0
    if (ua !== ub) return ub - ua
    return ua ? a.at - b.at : b.at - a.at
  })
}

const SeeAll = ({ show }: { show: boolean }) => show ? <Link to="/my/requests" className="text-sm font-bold text-teal-700">See all ›</Link> : null

export function RateList({ items, limit }: { items: ToRate[]; limit?: number }) {
  if (!items.length) return null
  const shown = limit ? items.slice(0, limit) : items
  return (
    <section className="card border-2 border-teal-500 p-4">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Waiting for your rating ({items.length})</h2>
        <SeeAll show={!!limit && items.length > shown.length} />
      </div>
      {shown.map(r => (
        <Link key={r.kind + r.id} to={`/my/rate?kind=${r.kind}&id=${r.id}&title=${encodeURIComponent(r.title)}`}
          className="flex items-center gap-3 py-2 border-t border-gray-100 first:border-0 hover:bg-gray-50 -mx-2 px-2 rounded">
          <span className="flex-1 truncate text-gray-800">{r.title}</span>
          <span className="text-teal-700 font-bold whitespace-nowrap">☆☆☆☆☆ ›</span>
        </Link>
      ))}
    </section>
  )
}

export function RequestList({ items, limit, onChanged }: { items: Req[]; limit?: number; onChanged: () => void }) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const shown = limit ? items.slice(0, limit) : items
  return (
    <section className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">My requests{items.length ? ` (${items.length})` : ''}</h2>
        <SeeAll show={!!limit && items.length > shown.length} />
      </div>
      {!items.length && <p className="text-sm text-gray-500">Nothing yet. Your bookings, orders and requests will show here.</p>}
      <Err msg={err} />
      {shown.map(r => {
        const body = (
          <>
            <span className="text-xl" aria-hidden>{r.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-gray-800 truncate">{r.title}</span>
              <span className="block text-xs text-gray-500 truncate">{when(new Date(r.at).toISOString())} · {r.sub}</span>
            </span>
            {r.url && <span className="text-gray-400 text-xl">›</span>}
          </>
        )
        return (
          <div key={r.key} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
            {r.url ? <Link to={r.url} className="flex items-center gap-3">{body}</Link> : <div className="flex items-center gap-3">{body}</div>}
            {/* 0198: an upcoming booking can be cancelled here; the clinic sees it at once. */}
            {r.cancelId && (confirming === r.cancelId ? (
              <div className="flex gap-2 mt-2 ml-9">
                <button className="text-sm font-bold text-white bg-red-600 rounded-full px-3 py-1" onClick={async () => {
                  try { await cancelBooking(r.cancelId!); setConfirming(null); onChanged() } catch (e) { setErr((e as Error).message) }
                }}>Yes, cancel it</button>
                <button className="text-sm font-bold text-gray-600 rounded-full px-3 py-1 border border-gray-300" onClick={() => setConfirming(null)}>Keep it</button>
              </div>
            ) : <button className="text-sm font-bold text-red-700 mt-1 ml-9" onClick={() => setConfirming(r.cancelId!)}>Cancel booking</button>)}
          </div>
        )
      })}
    </section>
  )
}
