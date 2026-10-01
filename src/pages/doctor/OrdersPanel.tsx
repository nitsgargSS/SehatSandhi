import { useCallback, useEffect, useState } from 'react'
import { Bike, Check, ChevronDown, ChevronUp, FileImage, IndianRupee, MapPin, Package, Phone, RefreshCw, X } from 'lucide-react'
import {
  listOrders, deliveryArea, setDeliveryArea, acceptOrder, declineOrder, quoteOrder, dropOrder, packOrder, sendOut, markDelivered, deliveryPeople,
  ORDER_STATUS, EVENT_WORD, rupees,
  type MedicineOrder, type OrderScope, type DeliveryPerson, type PayMode, type DeliveryArea,
} from '../../lib/medicineOrdersApi'

// 0189: a pharmacy's medicine orders. New → accept → price (medicines +
// delivery fee) → the patient approves on their link → pack → send out →
// delivered. A delivery person sees only what was handed to them.

const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
  : ''
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}
const TONE: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700', accepted: 'bg-amber-50 text-amber-700', quoted: 'bg-sky-50 text-sky-700',
  confirmed: 'bg-teal-50 text-teal-700', packed: 'bg-teal-50 text-teal-700', out_for_delivery: 'bg-indigo-50 text-indigo-700',
  delivered: 'bg-green-50 text-green-700', cancelled: 'bg-gray-100 text-gray-600', expired: 'bg-gray-100 text-gray-600',
  no_pharmacy: 'bg-gray-100 text-gray-600',
}

export default function OrdersPanel({ businessId, role }: { businessId: string; role: string | null }) {
  const isDelivery = role === 'delivery'
  const [scope, setScope] = useState<OrderScope>(isDelivery ? 'active' : 'new')
  const [orders, setOrders] = useState<MedicineOrder[]>([])
  const [counts, setCounts] = useState<Record<OrderScope, number>>({ new: 0, active: 0, done: 0 })
  const [people, setPeople] = useState<DeliveryPerson[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const scopes: OrderScope[] = isDelivery ? ['active', 'done'] : ['new', 'active', 'done']
      const all = await Promise.all(scopes.map(s => listOrders(businessId, s)))
      const by = Object.fromEntries(scopes.map((s, i) => [s, all[i]])) as Record<OrderScope, MedicineOrder[]>
      setCounts({ new: by.new?.length ?? 0, active: by.active?.length ?? 0, done: by.done?.length ?? 0 })
      setOrders(by[scope] ?? [])
      setErr('')
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [businessId, scope, isDelivery])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t) }, [load])
  useEffect(() => { if (!isDelivery) deliveryPeople(businessId).then(setPeople).catch(() => setPeople([])) }, [businessId, isDelivery])

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setErr('')
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const TABS: [OrderScope, string][] = isDelivery
    ? [['active', 'To deliver'], ['done', 'Delivered']]
    : [['new', 'New'], ['active', 'In progress'], ['done', 'Done']]

  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <h2 className="font-bold text-navy-700 text-lg">Medicine orders</h2>
          <button onClick={load} className="text-sm text-teal-700 flex items-center gap-1"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
        <p className="text-sm text-gray-500">
          {isDelivery
            ? 'Orders handed to you. Mark each one delivered with what you collected.'
            : 'Patients in your delivery PIN codes order on WhatsApp. The first pharmacy to accept gets the order. You see their name, phone and address once they approve your price.'}
        </p>
        <div className="flex gap-2 mt-3 flex-wrap">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setScope(k)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${scope === k ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {l}{counts[k] ? ` · ${counts[k]}` : ''}
            </button>
          ))}
        </div>
      </div>

      {!isDelivery && <DeliveryAreaCard businessId={businessId} canEdit={role === 'owner' || role === 'manager'} />}
      {err && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>}
      {!loading && orders.length === 0 && (
        <div className="card shadow-sm text-sm text-gray-500">
          {scope === 'new' ? 'No new orders in your PIN codes right now. New ones appear here and as an alert in the Sehatsandhi app.'
            : scope === 'active' ? (isDelivery ? 'Nothing to deliver right now.' : 'No orders in progress.')
            : 'No finished orders in the last 30 days.'}
        </div>
      )}
      {orders.map(o => (
        <OrderCard key={o.id} o={o} businessId={businessId} role={role} people={people}
          busy={busy === o.id} run={fn => run(o.id, fn)} />
      ))}
    </div>
  )
}

function OrderCard({ o, businessId, role, people, busy, run }: {
  o: MedicineOrder; businessId: string; role: string | null; people: DeliveryPerson[]
  busy: boolean; run: (fn: () => Promise<unknown>) => void
}) {
  const isDelivery = role === 'delivery'
  const [open, setOpen] = useState(o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'expired')
  const [med, setMed] = useState(o.quote_amount ? String(o.quote_amount) : '')
  const [fee, setFee] = useState(o.delivery_fee ? String(o.delivery_fee) : '0')
  const [note, setNote] = useState(o.quote_note ?? '')
  const [rx, setRx] = useState(o.rx_checked)
  const [who, setWho] = useState(o.delivery_practitioner_id ?? people.find(p => p.role === 'delivery')?.practitioner_id ?? '')
  const [paid, setPaid] = useState(o.total ? String(o.total) : '')
  const [mode, setMode] = useState<PayMode>('cash')
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState<'decline' | 'drop' | null>(null)
  const total = (Number(med) || 0) + (Number(fee) || 0)

  return (
    <div className="card shadow-sm">
      <button className="w-full text-left flex items-start justify-between gap-3" onClick={() => setOpen(v => !v)}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-navy-700">{o.code}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TONE[o.status]}`}>{ORDER_STATUS[o.status]}</span>
            {o.total != null && <span className="text-sm font-semibold text-gray-700">{rupees(o.total)}</span>}
          </div>
          <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap">
            <MapPin className="w-3.5 h-3.5" /> {o.pin_code} · {ago(o.created_at)}
            {o.patient_first_name ? ` · ${o.patient_name ?? o.patient_first_name}` : ''}
          </div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Medicines</div>
            <div className="whitespace-pre-wrap text-gray-800">{o.medicines || 'See the prescription photo.'}</div>
            {o.has_prescription && (o.prescription_url
              ? <a href={o.prescription_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700 font-semibold mt-2"><FileImage className="w-4 h-4" /> Open prescription photo</a>
              : <div className="text-gray-500 mt-2 flex items-center gap-1"><FileImage className="w-4 h-4" /> Prescription photo attached — shown once you accept</div>)}
          </div>

          {(o.patient_phone || o.address) && (
            <div className="bg-teal-50 rounded-xl p-3 space-y-1">
              <div className="font-semibold text-navy-700">{o.patient_name}</div>
              {o.patient_phone && <a href={`tel:+${o.patient_phone}`} className="flex items-center gap-1 text-teal-700"><Phone className="w-4 h-4" /> +{o.patient_phone}</a>}
              {o.address && <div className="flex items-start gap-1 text-gray-700"><MapPin className="w-4 h-4 mt-0.5 shrink-0" /> {o.address}, {o.pin_code}</div>}
            </div>
          )}

          {o.quote_amount != null && (
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 max-w-xs">
              <span className="text-gray-500">Medicines</span><span className="text-right">{rupees(o.quote_amount)}</span>
              <span className="text-gray-500">Delivery</span><span className="text-right">{o.delivery_fee ? rupees(o.delivery_fee) : 'Free'}</span>
              <span className="font-semibold">Total</span><span className="text-right font-semibold">{rupees(o.total)}</span>
              {o.quote_note && <span className="col-span-2 text-gray-500 mt-1">Note to patient: {o.quote_note}</span>}
            </div>
          )}

          {/* ── Steps ─────────────────────────────────────────────────── */}
          {o.status === 'open' && !isDelivery && (
            asking === 'decline' ? (
              <div className="flex gap-2 flex-wrap items-center">
                <input className="input-field flex-1 min-w-[180px]" placeholder="Why? (optional, e.g. not in stock)" value={reason} onChange={e => setReason(e.target.value)} />
                <button disabled={busy} onClick={() => run(() => declineOrder(businessId, o.id, reason))} className="btn-outline text-sm py-2 px-4">Decline</button>
                <button onClick={() => setAsking(null)} className="text-sm text-gray-500">Back</button>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button disabled={busy} onClick={() => run(() => acceptOrder(businessId, o.id))} className="btn-teal text-sm py-2 px-4 flex items-center gap-1"><Check className="w-4 h-4" /> Accept order</button>
                <button onClick={() => setAsking('decline')} className="btn-outline text-sm py-2 px-4">Not for us</button>
              </div>
            )
          )}

          {(o.status === 'accepted' || o.status === 'quoted') && !isDelivery && (
            <div className="border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="font-semibold text-navy-700">{o.status === 'quoted' ? 'Change the price' : 'Price this order'}</div>
              <div className="grid grid-cols-2 gap-2 max-w-sm">
                <label className="text-xs text-gray-600">Medicines (₹)
                  <input className="input-field mt-1" inputMode="decimal" value={med} onChange={e => setMed(e.target.value.replace(/[^\d.]/g, ''))} /></label>
                <label className="text-xs text-gray-600">Delivery fee (₹)
                  <input className="input-field mt-1" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value.replace(/[^\d.]/g, ''))} /></label>
              </div>
              <div className="text-sm">Patient sees: medicines {rupees(Number(med) || 0)} + delivery {Number(fee) ? rupees(Number(fee)) : 'free'} = <b>{rupees(total)}</b></div>
              <input className="input-field" placeholder="Note to the patient (optional) — e.g. substitute brand, 1 item short" value={note} onChange={e => setNote(e.target.value)} />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 accent-teal-600" checked={rx} onChange={e => setRx(e.target.checked)} />
                <span>Every prescription-only (Schedule H/H1) medicine in this order is backed by a valid prescription I have seen. No Schedule X.</span>
              </label>
              <div className="flex gap-2 flex-wrap">
                <button disabled={busy || !(Number(med) > 0) || !rx} onClick={() => run(() => quoteOrder(businessId, o.id, Number(med), Number(fee) || 0, note, rx))}
                  className="btn-teal text-sm py-2 px-4 flex items-center gap-1"><IndianRupee className="w-4 h-4" /> Send price to patient</button>
                <button onClick={() => setAsking('drop')} className="btn-outline text-sm py-2 px-4">Give up order</button>
              </div>
            </div>
          )}

          {o.status === 'quoted' && <p className="text-sky-700">Waiting for the patient to approve {rupees(o.total)} on their order link.</p>}

          {o.status === 'confirmed' && !isDelivery && (
            <div className="flex gap-2 flex-wrap">
              <button disabled={busy} onClick={() => run(() => packOrder(businessId, o.id))} className="btn-teal text-sm py-2 px-4 flex items-center gap-1"><Package className="w-4 h-4" /> Mark packed</button>
              <button onClick={() => setAsking('drop')} className="btn-outline text-sm py-2 px-4">Give up order</button>
            </div>
          )}

          {(o.status === 'confirmed' || o.status === 'packed') && !isDelivery && (
            <div className="flex gap-2 flex-wrap items-center">
              <select className="input-field w-auto" value={who} onChange={e => setWho(e.target.value)}>
                <option value="">I'll deliver it myself</option>
                {people.map(p => <option key={p.practitioner_id} value={p.practitioner_id}>{p.name} · {p.role === 'delivery' ? 'Delivery' : p.role === 'pharmacist' ? 'Helper' : p.role === 'manager' ? 'Manager' : 'Owner'}</option>)}
              </select>
              <button disabled={busy} onClick={() => run(() => sendOut(businessId, o.id, who || null))} className="btn-teal text-sm py-2 px-4 flex items-center gap-1"><Bike className="w-4 h-4" /> Send out</button>
            </div>
          )}

          {asking === 'drop' && (
            <div className="flex gap-2 flex-wrap items-center bg-amber-50 rounded-xl p-3">
              <input className="input-field flex-1 min-w-[180px]" placeholder="Why are you giving it up? e.g. medicine not available" value={reason} onChange={e => setReason(e.target.value)} />
              <button disabled={busy || !reason.trim()} onClick={() => run(() => dropOrder(businessId, o.id, reason.trim()))} className="btn-outline text-sm py-2 px-4">Give up — pass to another pharmacy</button>
              <button onClick={() => setAsking(null)} className="text-sm text-gray-500">Back</button>
            </div>
          )}

          {(o.status === 'out_for_delivery' || (o.status === 'packed' && !isDelivery)) && (
            <div className="border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="font-semibold text-navy-700">Delivered? {o.delivery_name ? <span className="font-normal text-gray-500">· with {o.delivery_name}</span> : null}</div>
              <div className="flex gap-2 flex-wrap items-center">
                <label className="text-xs text-gray-600">Collected (₹)
                  <input className="input-field mt-1 w-32" inputMode="decimal" value={paid} onChange={e => setPaid(e.target.value.replace(/[^\d.]/g, ''))} /></label>
                <div className="flex gap-1 mt-4">
                  {(['cash', 'upi', 'card', 'other'] as PayMode[]).map(m => (
                    <button key={m} type="button" onClick={() => setMode(m)}
                      className={`px-3 py-1.5 rounded-full text-sm border ${mode === m ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200 text-gray-600'}`}>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</button>
                  ))}
                </div>
              </div>
              <button disabled={busy || paid === ''} onClick={() => run(() => markDelivered(businessId, o.id, Number(paid), mode))}
                className="btn-teal text-sm py-2 px-4 flex items-center gap-1"><Check className="w-4 h-4" /> Mark delivered</button>
            </div>
          )}

          {o.status === 'delivered' && (
            <div className="text-gray-600">
              Delivered {when(o.delivered_at)} by {o.delivered_by_name} · collected {rupees(o.collected_amount)} ({o.collected_mode?.toUpperCase()})
              {o.rating && <div className="mt-1">Patient rating: {'★'.repeat(o.rating)}{'☆'.repeat(5 - o.rating)}{o.review ? ` — “${o.review}”` : ''}</div>}
            </div>
          )}
          {(o.status === 'cancelled' || o.status === 'expired') && o.ended_reason && <p className="text-gray-500 flex items-center gap-1"><X className="w-4 h-4" /> {o.ended_reason}</p>}

          {o.events && o.events.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Who did what</summary>
              <ul className="mt-1 space-y-0.5">
                {o.events.map((e, i) => <li key={i}>{when(e.at)} — {EVENT_WORD[e.event] ?? e.event}{e.by ? ` · ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// Where this store delivers. Starts empty on purpose: a pharmacy is only sent
// orders for PIN codes it has said it can reach.
export function DeliveryAreaCard({ businessId, canEdit, title = 'Where you deliver', what = 'deliver medicines to', none = 'orders' }: {
  businessId: string; canEdit: boolean; title?: string; what?: string; none?: string
}) {
  const [areas, setAreas] = useState<DeliveryArea[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    deliveryArea(businessId).then(a => {
      setAreas(a); const on = a.filter(x => x.chosen).map(x => x.pin_code); setPicked(on); setEditing(on.length === 0)
    }).catch(e => setErr((e as Error).message))
  }, [businessId])
  if (!areas) return err ? <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div> : null
  const chosen = areas.filter(a => a.chosen)
  const save = async () => {
    setBusy(true); setErr('')
    try {
      const v = await setDeliveryArea(businessId, picked)
      setAreas(areas.map(a => ({ ...a, chosen: v.includes(a.pin_code) }))); setEditing(false)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className={`card shadow-sm ${chosen.length === 0 ? 'border-2 border-amber-300' : ''}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-navy-700 flex items-center gap-1"><MapPin className="w-4 h-4" /> {title}</h3>
        {!editing && canEdit && <button onClick={() => setEditing(true)} className="text-sm text-teal-700 font-semibold">Change</button>}
      </div>
      {chosen.length === 0 && !editing && <p className="text-sm text-amber-700 mt-1">No areas chosen yet, so no {none} reach you. {canEdit ? '' : 'Ask the owner to choose them.'}</p>}
      {!editing && chosen.length > 0 && (
        <p className="text-sm text-gray-600 mt-1">{chosen.map(a => `${a.pin_code}${a.area_name ? ` ${a.area_name}` : ''}`).join(' · ')}</p>
      )}
      {editing && canEdit && (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-gray-500">Tick the PIN codes you can {what}. Requests from these areas reach you; the first to accept gets them.</p>
          <div className="flex gap-2 flex-wrap max-h-60 overflow-auto">
            {areas.map(a => {
              const on = picked.includes(a.pin_code)
              return (
                <button key={a.pin_code} type="button" onClick={() => setPicked(p => on ? p.filter(x => x !== a.pin_code) : [...p, a.pin_code])}
                  className={`px-3 py-1.5 rounded-full text-sm border ${on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {a.pin_code}{a.area_name ? ` · ${a.area_name}` : ''}
                </button>
              )
            })}
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button disabled={busy} onClick={save} className="btn-teal text-sm py-2 px-4">{busy ? 'Saving…' : `Save ${picked.length} area${picked.length === 1 ? '' : 's'}`}</button>
            {chosen.length > 0 && <button onClick={() => { setEditing(false); setPicked(chosen.map(a => a.pin_code)) }} className="text-sm text-gray-500">Cancel</button>}
          </div>
        </div>
      )}
    </div>
  )
}
