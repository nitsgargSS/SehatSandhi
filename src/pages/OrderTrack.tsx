import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPublicOrder, patientStep, patientFeedback, rupees, type PublicOrder } from '../lib/medicineOrdersApi'

// The patient's medicine order (0189), at /o/<token> — the link the WhatsApp
// bot sends. No login: the 24-character token is the key, as with /bill/ and
// /lab/. Follow the order, approve or refuse the pharmacy's price, cancel,
// and after delivery say what was paid and rate the pharmacy.

const TOKEN_RE = /^[0-9a-f]{24}$/
const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
  : ''

const STEPS: { key: keyof PublicOrder; hi: string; en: string }[] = [
  { key: 'created_at',   hi: 'ऑर्डर मिला',         en: 'Order placed' },
  { key: 'accepted_at',  hi: 'फ़ार्मेसी ने लिया',    en: 'Pharmacy accepted' },
  { key: 'quoted_at',    hi: 'कीमत भेजी',          en: 'Price sent' },
  { key: 'confirmed_at', hi: 'आपने हाँ कहा',        en: 'You approved' },
  { key: 'packed_at',    hi: 'पैक हुआ',            en: 'Packed' },
  { key: 'out_at',       hi: 'रास्ते में',           en: 'Out for delivery' },
  { key: 'delivered_at', hi: 'पहुँच गया',           en: 'Delivered' },
]

export default function OrderTrack() {
  const { token } = useParams()
  const [o, setO] = useState<PublicOrder | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [askCancel, setAskCancel] = useState(false)
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')
  const [paid, setPaid] = useState('')

  const load = useCallback(() => {
    if (!token || !TOKEN_RE.test(token)) { setErr('यह लिंक सही नहीं है। / This order link is not valid.'); return }
    getPublicOrder(token).then(r => {
      if (!r) setErr('यह ऑर्डर नहीं मिला। / We could not find this order.')
      else { setO(r); if (r.total != null) setPaid(p => p || String(r.total)) }
    }).catch(() => setErr('अभी लोड नहीं हो पाया, फिर कोशिश करें। / Could not load just now — please try again.'))
  }, [token])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t) }, [load])

  const step = async (fn: () => Promise<PublicOrder>) => {
    setBusy(true); setErr('')
    try { setO(await fn()); setAskCancel(false) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!o) return <div className="min-h-screen bg-gray-50 p-6 text-gray-700">{err || 'Loading…'}</div>

  const live = !['delivered', 'cancelled', 'expired', 'no_pharmacy'].includes(o.status)
  const canCancel = ['open', 'accepted', 'quoted', 'confirmed', 'packed'].includes(o.status)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <Link to="/" className="font-extrabold text-teal-700 text-lg">Sehatsandhi</Link>

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">दवाई ऑर्डर / Medicine order</div>
          <h1 className="text-2xl font-extrabold text-navy-700 mt-1">{o.code}</h1>
          <p className="text-sm text-gray-500 mt-1">PIN {o.pin_code}{o.pharmacy ? ` · ${o.pharmacy}` : ''}</p>

          {o.medicines && <div className="mt-3 bg-gray-50 rounded-xl p-3 text-sm whitespace-pre-wrap">{o.medicines}</div>}
          {o.has_prescription && <p className="text-sm text-gray-500 mt-2">पर्ची की फ़ोटो साथ में है / Prescription photo attached</p>}
        </div>

        {/* The price, and the decision */}
        {o.status === 'quoted' && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border-2 border-teal-500">
            <h2 className="font-bold text-navy-700">{o.pharmacy} की कीमत / Price from {o.pharmacy}</h2>
            <div className="grid grid-cols-[1fr_auto] gap-y-1 mt-3 text-base">
              <span className="text-gray-600">दवाइयाँ / Medicines</span><span className="text-right">{rupees(o.quote_amount)}</span>
              <span className="text-gray-600">डिलीवरी / Delivery</span><span className="text-right">{o.delivery_fee ? rupees(o.delivery_fee) : 'Free'}</span>
              <span className="font-bold border-t pt-1">कुल / Total</span><span className="text-right font-bold border-t pt-1">{rupees(o.total)}</span>
            </div>
            {o.quote_note && <p className="text-sm text-gray-600 mt-2">फ़ार्मेसी का नोट / Note: {o.quote_note}</p>}
            <p className="text-xs text-gray-500 mt-3">भुगतान डिलीवरी पर सीधे फ़ार्मेसी को करें। / Pay the pharmacy directly on delivery.</p>
            <div className="flex gap-2 mt-4 flex-wrap">
              <button disabled={busy} onClick={() => step(() => patientStep(token!, 'confirm'))}
                className="btn-teal py-3 px-5 text-base flex-1">हाँ, भेजें / Yes, deliver</button>
              <button disabled={busy} onClick={() => step(() => patientStep(token!, 'refuse'))}
                className="btn-outline py-3 px-5 text-base">नहीं / No</button>
            </div>
          </div>
        )}

        {(o.status === 'open' || o.status === 'accepted') && (
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm text-gray-700">
            {o.status === 'open'
              ? 'आपका ऑर्डर आपके एरिया की फ़ार्मेसी के पास है। जो पहले लेगी, वह कीमत भेजेगी। / Your order is with pharmacies near you. The first to accept will send you a price.'
              : `${o.pharmacy} आपकी कीमत तैयार कर रही है। / ${o.pharmacy} is preparing your price.`}
            <p className="text-gray-500 mt-2">यह पेज अपने-आप अपडेट होता है। / This page updates by itself.</p>
          </div>
        )}

        {o.confirmed_at && live && (
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm space-y-1">
            <div className="font-bold text-navy-700">{o.pharmacy}</div>
            {o.pharmacy_phone && <div>☎ <a href={`tel:${o.pharmacy_phone}`} className="text-teal-700 font-semibold">{o.pharmacy_phone}</a></div>}
            {o.pharmacy_address && <div className="text-gray-600">{o.pharmacy_address}</div>}
            <div>कुल / Total: <b>{rupees(o.total)}</b></div>
            {o.status === 'out_for_delivery' && <div className="text-indigo-700 font-semibold">🛵 रास्ते में / On the way{o.delivery_name ? ` — ${o.delivery_name}` : ''}</div>}
          </div>
        )}

        {/* Progress */}
        {o.status !== 'no_pharmacy' && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <ol className="space-y-2">
              {STEPS.map(s => {
                const at = o[s.key] as string | null
                return (
                  <li key={s.key} className={`flex items-center gap-3 text-sm ${at ? 'text-gray-800' : 'text-gray-400'}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${at ? 'bg-teal-600 text-white' : 'border border-gray-300'}`}>{at ? '✓' : ''}</span>
                    <span className="flex-1">{s.hi} / {s.en}</span>
                    <span className="text-xs text-gray-500">{when(at)}</span>
                  </li>
                )
              })}
            </ol>
          </div>
        )}

        {/* Ended without a delivery */}
        {['cancelled', 'expired', 'no_pharmacy'].includes(o.status) && (
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm">
            <div className="font-bold text-navy-700">
              {o.status === 'cancelled' ? 'ऑर्डर रद्द / Order cancelled' : 'कोई फ़ार्मेसी नहीं मिली / No pharmacy could take this order'}
            </div>
            {o.ended_reason && <p className="text-gray-500 mt-1">{o.ended_reason}</p>}
            {o.others && <p className="whitespace-pre-wrap text-gray-700 mt-3">{o.others}</p>}
          </div>
        )}

        {/* After delivery: what was paid, and a rating */}
        {o.status === 'delivered' && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            {o.rating ? (
              <div className="text-sm">
                <div className="font-bold text-navy-700">धन्यवाद! / Thank you!</div>
                <div className="mt-1">{'★'.repeat(o.rating)}{'☆'.repeat(5 - o.rating)}{o.review ? ` — “${o.review}”` : ''}</div>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="font-bold text-navy-700">{o.pharmacy} को रेटिंग दें / Rate {o.pharmacy}</h2>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} type="button" onClick={() => setStars(n)} aria-label={`${n} stars`}
                      className={`text-3xl ${n <= stars ? 'text-amber-500' : 'text-gray-300'}`}>★</button>
                  ))}
                </div>
                <label className="block text-sm text-gray-600">आपने कितना दिया? / How much did you pay? (₹)
                  <input className="input-field mt-1" inputMode="decimal" value={paid} onChange={e => setPaid(e.target.value.replace(/[^\d.]/g, ''))} /></label>
                <textarea className="input-field" rows={2} placeholder="कुछ कहना चाहें? / Anything to add? (optional)" value={review} onChange={e => setReview(e.target.value)} />
                <button disabled={busy || stars === 0} onClick={() => step(() => patientFeedback(token!, stars, review, paid === '' ? null : Number(paid)))}
                  className="btn-teal py-3 px-5 w-full">भेजें / Send</button>
              </div>
            )}
          </div>
        )}

        {err && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>}

        {canCancel && o.status !== 'quoted' && (
          askCancel ? (
            <div className="bg-white rounded-2xl shadow-sm p-4 text-sm flex gap-2 items-center flex-wrap">
              <span className="flex-1">ऑर्डर रद्द करें? / Cancel this order?</span>
              <button disabled={busy} onClick={() => step(() => patientStep(token!, 'cancel'))} className="btn-outline py-2 px-4">हाँ, रद्द करें / Yes, cancel</button>
              <button onClick={() => setAskCancel(false)} className="text-gray-500">नहीं / No</button>
            </div>
          ) : (
            <button onClick={() => setAskCancel(true)} className="text-sm text-gray-500 underline">ऑर्डर रद्द करें / Cancel order</button>
          )
        )}
      </div>
    </div>
  )
}
