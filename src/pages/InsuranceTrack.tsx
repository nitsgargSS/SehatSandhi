import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPublicLead, leadNotCalled, cancelLead, rateLead, type PublicLead } from '../lib/insuranceApi'

// The person's insurance request (0192), at /i/<token> — the link the WhatsApp
// bot sends. No login. Who took it (name, phone, IRDAI licence), "they have
// not called me", and afterwards did they buy, and a rating.
const TOKEN_RE = /^[0-9a-f]{24}$/
const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : ''

export default function InsuranceTrack() {
  const { token } = useParams()
  const [l, setL] = useState<PublicLead | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [stars, setStars] = useState(0)
  const [bought, setBought] = useState<boolean | null>(null)
  const [review, setReview] = useState('')

  const load = useCallback(() => {
    if (!token || !TOKEN_RE.test(token)) { setErr('यह लिंक सही नहीं है। / This link is not valid.'); return }
    getPublicLead(token).then(r => r ? setL(r) : setErr('यह अनुरोध नहीं मिला। / Request not found.'))
      .catch(() => setErr('अभी लोड नहीं हुआ, फिर कोशिश करें। / Could not load — please try again.'))
  }, [token])
  useEffect(() => { load() }, [load])
  useEffect(() => { const i = setInterval(load, 60_000); return () => clearInterval(i) }, [load])

  const step = async (fn: () => Promise<PublicLead>) => {
    setBusy(true); setErr('')
    try { setL(await fn()) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (!l) return <div className="min-h-screen bg-gray-50 p-6 text-gray-700">{err || 'Loading…'}</div>

  const taken = !!l.accepted_at && !['expired', 'cancelled'].includes(l.status)
  const canNotCalled = l.status === 'accepted' && !l.patient_not_called_at && Date.now() - new Date(l.accepted_at!).getTime() > 24 * 3600_000
  const canRate = taken && !l.rating && Date.now() - new Date(l.accepted_at!).getTime() > 3600_000

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <Link to="/" className="font-extrabold text-teal-700 text-lg">Sehatsandhi</Link>

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">स्वास्थ्य बीमा / Health insurance</div>
          <h1 className="text-2xl font-extrabold text-navy-700 mt-1">{l.code}</h1>
          <p className="text-sm text-gray-500">PIN {l.pin_code}{l.cover ? ` · ${l.cover}` : ''}{l.members ? ` · ${l.members}` : ''}</p>
        </div>

        {l.status === 'open' && (
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm text-gray-700 space-y-2">
            <p>आपका अनुरोध आपके एरिया के लाइसेंस वाले सलाहकारों के पास है। जो पहले स्वीकार करेगा, वही आपको कॉल करेगा — आपका नंबर सिर्फ़ उसी को मिलेगा।</p>
            <p>Your request is with licensed advisors near you. The first to accept will call you — only they get your number.</p>
            <button disabled={busy} onClick={() => step(() => cancelLead(token!))} className="text-gray-500 underline">अब ज़रूरत नहीं / No longer needed</button>
          </div>
        )}

        {taken && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border-2 border-teal-500 space-y-1">
            <div className="text-xs text-gray-500">आपके सलाहकार / Your advisor</div>
            <div className="font-bold text-navy-700 text-lg">{l.advisor}</div>
            {l.advisor_licence && <div className="text-sm">IRDAI licence / POSP: <b>{l.advisor_licence}</b></div>}
            {l.advisor_phone && <a href={`tel:${l.advisor_phone}`} className="block text-center btn-teal py-3 mt-2">📞 {l.advisor_phone}</a>}
            <p className="text-xs text-gray-500 pt-2">Sehatsandhi सिर्फ़ आपको सलाहकार से मिलवाता है; पॉलिसी पर हम कुछ नहीं लेते। / Sehatsandhi only connects you; we take nothing on any policy.</p>
          </div>
        )}

        {canNotCalled && (
          <div className="bg-white rounded-2xl shadow-sm p-4 text-sm flex gap-2 items-center flex-wrap">
            <span className="flex-1">सलाहकार ने अभी तक कॉल नहीं किया? / Advisor hasn't called yet?</span>
            <button disabled={busy} onClick={() => step(() => leadNotCalled(token!))} className="btn-outline py-2 px-4">हमें बताएँ / Tell us</button>
          </div>
        )}
        {l.patient_not_called_at && <p className="text-sm text-amber-700">हमें बता दिया गया है — हम देख रहे हैं। / Noted — we are looking into it.</p>}

        {canRate && (
          <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
            <h2 className="font-bold text-navy-700">{l.advisor} को रेटिंग दें / Rate {l.advisor}</h2>
            <div className="flex gap-2 flex-wrap text-sm">
              <span className="text-gray-600">पॉलिसी ली? / Did you buy a policy?</span>
              {([[true, 'हाँ / Yes'], [false, 'नहीं / No']] as [boolean, string][]).map(([v, t]) => (
                <button key={t} type="button" onClick={() => setBought(v)} className={`px-3 py-1 rounded-full border ${bought === v ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200'}`}>{t}</button>
              ))}
            </div>
            <div className="flex gap-1">{[1, 2, 3, 4, 5].map(n => <button key={n} type="button" onClick={() => setStars(n)} aria-label={`${n} stars`} className={`text-3xl ${n <= stars ? 'text-amber-500' : 'text-gray-300'}`}>★</button>)}</div>
            <textarea className="input-field" rows={2} placeholder="कुछ कहना चाहें? / Anything to add? (optional)" value={review} onChange={e => setReview(e.target.value)} />
            <button disabled={busy || stars === 0} onClick={() => step(() => rateLead(token!, bought, stars, review))} className="btn-teal py-3 px-5 w-full">भेजें / Send</button>
          </div>
        )}
        {l.rating && <div className="bg-white rounded-2xl shadow-sm p-5 text-sm"><b>धन्यवाद! / Thank you!</b> {'★'.repeat(l.rating)}{'☆'.repeat(5 - l.rating)}</div>}

        {l.status === 'expired' && (
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm space-y-2">
            <div className="font-bold text-navy-700">अभी कोई सलाहकार उपलब्ध नहीं हुआ / No advisor took this request</div>
            {l.others && <p className="whitespace-pre-wrap text-gray-700">{l.others}</p>}
          </div>
        )}
        {l.status === 'cancelled' && <p className="text-sm text-gray-500">अनुरोध रद्द / Request cancelled.</p>}

        <div className="bg-white rounded-2xl shadow-sm p-5 text-xs text-gray-500 space-y-1">
          <div>भेजा / Requested: {when(l.created_at)}</div>
          {l.accepted_at && <div>सलाहकार मिला / Advisor assigned: {when(l.accepted_at)}</div>}
          {l.contacted_at && <div>बात हुई / Spoke to you: {when(l.contacted_at)}</div>}
        </div>
        {err && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>}
      </div>
    </div>
  )
}
