import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPublicTrip, cancelTripAsPatient, rateTrip, type PublicTrip } from '../lib/ambulanceApi'

// The patient's ambulance request (0191), at /a/<token> — the link the
// WhatsApp bot sends. No login. Until a service accepts, it keeps 108 and the
// nearest numbers in front of them; after, the driver, phone, vehicle and ETA.

const TOKEN_RE = /^[0-9a-f]{24}$/
const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : ''

const STEPS: { key: keyof PublicTrip; hi: string; en: string }[] = [
  { key: 'created_at',   hi: 'अनुरोध भेजा',     en: 'Requested' },
  { key: 'accepted_at',  hi: 'एम्बुलेंस मिली',    en: 'Ambulance accepted' },
  { key: 'on_way_at',    hi: 'रास्ते में',        en: 'On the way' },
  { key: 'picked_at',    hi: 'मरीज़ को लिया',     en: 'Patient picked up' },
  { key: 'completed_at', hi: 'पूरा हुआ',         en: 'Completed' },
]

export default function AmbulanceTrack() {
  const { token } = useParams()
  const [t, setT] = useState<PublicTrip | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [askCancel, setAskCancel] = useState(false)
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')
  const [paid, setPaid] = useState('')

  const load = useCallback(() => {
    if (!token || !TOKEN_RE.test(token)) { setErr('यह लिंक सही नहीं है। तुरंत 108 पर कॉल करें। / This link is not valid. Call 108 now.'); return }
    getPublicTrip(token).then(r => {
      if (!r) setErr('यह अनुरोध नहीं मिला। तुरंत 108 पर कॉल करें। / Request not found. Call 108 now.')
      else { setT(r); if (r.fare != null) setPaid(p => p || String(r.fare)) }
    }).catch(() => setErr('अभी लोड नहीं हुआ। ज़रूरी हो तो 108 पर कॉल करें। / Could not load. Call 108 if urgent.'))
  }, [token])
  useEffect(() => { load() }, [load])
  useEffect(() => { const i = setInterval(load, 15_000); return () => clearInterval(i) }, [load])

  const step = async (fn: () => Promise<PublicTrip>) => {
    setBusy(true); setErr('')
    try { setT(await fn()); setAskCancel(false) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const call108 = (
    <a href="tel:108" className="block text-center bg-red-600 text-white font-extrabold text-lg rounded-2xl py-4">📞 108 पर कॉल करें / Call 108 (free)</a>
  )

  if (!t) return <div className="min-h-screen bg-gray-50 p-6 space-y-4 max-w-lg mx-auto"><p className="text-gray-700">{err || 'Loading…'}</p>{err && call108}</div>

  const waiting = t.status === 'open'
  const live = ['accepted', 'on_the_way', 'picked_up'].includes(t.status)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <Link to="/" className="font-extrabold text-teal-700 text-lg">Sehatsandhi</Link>

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t.kind === 'emergency' ? 'एम्बुलेंस / Ambulance — emergency' : 'एम्बुलेंस बुकिंग / Ambulance booking'}</div>
          <h1 className="text-2xl font-extrabold text-navy-700 mt-1">{t.code}</h1>
          <p className="text-sm text-gray-500">PIN {t.pin_code}{t.need ? ` · ${t.need}` : ''}</p>
        </div>

        {waiting && (
          <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
            <p className="text-sm text-gray-700">पास की एम्बुलेंस सेवाओं को आपका अनुरोध भेज दिया गया है। इंतज़ार न करें — इन्हें या 108 पर सीधे कॉल करें। / Nearby ambulances have your request. Do not wait — call one of these or 108 now.</p>
            {call108}
            {t.numbers && <p className="whitespace-pre-wrap text-sm text-gray-700">{t.numbers}</p>}
            <p className="text-xs text-gray-500">यह पेज अपने-आप अपडेट होता है। / This page updates by itself.</p>
          </div>
        )}

        {live && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border-2 border-teal-500 space-y-2">
            <div className="font-bold text-navy-700 text-lg">🚑 {t.service}</div>
            {t.driver_name && <div>ड्राइवर / Driver: <b>{t.driver_name}</b></div>}
            {t.vehicle_no && <div>गाड़ी / Vehicle: <b>{t.vehicle_no}</b></div>}
            {t.eta_minutes != null && t.status !== 'picked_up' && <div>पहुँचेगी / Arriving in: <b>~{t.eta_minutes} min</b></div>}
            {(t.driver_phone || t.service_phone) && (
              <a href={`tel:${t.driver_phone || t.service_phone}`} className="block text-center btn-teal py-3 text-base">📞 {t.driver_phone || t.service_phone}</a>
            )}
          </div>
        )}

        {t.status !== 'expired' && t.status !== 'cancelled' && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <ol className="space-y-2">
              {STEPS.map(s => {
                const at = t[s.key] as string | null
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

        {(t.status === 'expired' || t.status === 'cancelled') && (
          <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3 text-sm">
            <div className="font-bold text-navy-700">{t.status === 'cancelled' ? 'अनुरोध रद्द / Request cancelled' : 'कोई एम्बुलेंस नहीं मिली / No ambulance accepted'}</div>
            {t.status === 'expired' && call108}
            {t.numbers && <p className="whitespace-pre-wrap text-gray-700">{t.numbers}</p>}
          </div>
        )}

        {t.status === 'completed' && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            {t.rating ? (
              <div className="text-sm"><div className="font-bold text-navy-700">धन्यवाद! / Thank you!</div><div className="mt-1">{'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}{t.review ? ` — “${t.review}”` : ''}</div></div>
            ) : (
              <div className="space-y-3">
                <h2 className="font-bold text-navy-700">{t.service} को रेटिंग दें / Rate {t.service}</h2>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" onClick={() => setStars(n)} aria-label={`${n} stars`} className={`text-3xl ${n <= stars ? 'text-amber-500' : 'text-gray-300'}`}>★</button>)}
                </div>
                <label className="block text-sm text-gray-600">आपने कितना दिया? / How much did you pay? (₹)
                  <input className="input-field mt-1" inputMode="decimal" value={paid} onChange={e => setPaid(e.target.value.replace(/[^\d.]/g, ''))} /></label>
                <textarea className="input-field" rows={2} placeholder="कुछ कहना चाहें? / Anything to add? (optional)" value={review} onChange={e => setReview(e.target.value)} />
                <button disabled={busy || stars === 0} onClick={() => step(() => rateTrip(token!, stars, review, paid === '' ? null : Number(paid)))} className="btn-teal py-3 px-5 w-full">भेजें / Send</button>
              </div>
            )}
          </div>
        )}

        {err && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>}

        {['open', 'accepted', 'on_the_way'].includes(t.status) && (askCancel ? (
          <div className="bg-white rounded-2xl shadow-sm p-4 text-sm flex gap-2 items-center flex-wrap">
            <span className="flex-1">एम्बुलेंस की ज़रूरत नहीं? / No longer need the ambulance?</span>
            <button disabled={busy} onClick={() => step(() => cancelTripAsPatient(token!))} className="btn-outline py-2 px-4">हाँ, रद्द करें / Yes, cancel</button>
            <button onClick={() => setAskCancel(false)} className="text-gray-500">नहीं / No</button>
          </div>
        ) : (
          <button onClick={() => setAskCancel(true)} className="text-sm text-gray-500 underline">एम्बुलेंस रद्द करें / Cancel ambulance</button>
        ))}
      </div>
    </div>
  )
}
