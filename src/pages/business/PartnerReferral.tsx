import { useEffect, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { answerReferral, businessReferral, lookupPartner, reportPartner, usePartnerProgramEnabled, type Referral } from '../../lib/careApi'

// Care Partner referral on the business side (0334, brief §3 and §9).
// Nothing is ever sent to a doctor: the business itself confirms who
// introduced Sehatsandhi, in the app. Every call here fails quietly into
// "nothing to show" so a signup or a dashboard never breaks because of it —
// including on a database that does not have the Partner Program yet.

const useTx = () => { const { lang } = useLanguage(); return (en: string, hi: string) => (lang === 'hi' ? hi : en) }

/** Optional "Partner ID" box for the sign-up wizard, with the live "Referred by" line. */
export function PartnerIdField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tx = useTx()
  const on = usePartnerProgramEnabled()
  const [who, setWho] = useState<{ first_name: string; city: string } | null | undefined>(undefined)
  useEffect(() => {
    const v = value.trim()
    if (v.length < 9) { setWho(undefined); return }
    let live = true
    const t = setTimeout(() => { lookupPartner(v).then(r => { if (live) setWho(r) }, () => { if (live) setWho(null) }) }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [value])
  if (!on) return null
  return (
    <div style={{ marginTop: 20, background: '#fff', border: '1px solid #e5e2da', borderRadius: 18, padding: '20px 22px' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#1e2a4a', marginBottom: 4 }}>{tx('Introduced by a Sehatsandhi partner?', 'क्या किसी सेहतसंधि पार्टनर ने बताया?')}</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{tx('Optional. Enter their Partner ID (it starts with SP-).', 'वैकल्पिक। उनका Partner ID लिखें (SP- से शुरू होता है)।')}</div>
      <input value={value} onChange={e => onChange(e.target.value.toUpperCase())} placeholder="SP-XXXXXX" maxLength={9}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #d6d3cc', fontFamily: 'inherit', fontSize: 14, textTransform: 'uppercase' }} />
      {who && <p style={{ fontSize: 13, color: '#0f766e', fontWeight: 700, margin: '8px 0 0' }}>{tx(`Referred by ${who.first_name}, ${who.city}`, `${who.first_name}, ${who.city} ने बताया`)}</p>}
      {who === null && <p style={{ fontSize: 13, color: '#b42318', margin: '8px 0 0' }}>{tx('That Partner ID is not valid. Check it, or leave the box empty.', 'यह Partner ID सही नहीं है। जाँचें, या बॉक्स खाली छोड़ दें।')}</p>}
    </div>
  )
}

/** "Did <name> from <city> introduce Sehatsandhi to you?" — Yes / No. */
export function ReferralQuestion({ businessId, who, onDone }: {
  businessId: string; who: { first_name: string; city: string }; onDone: (r: Referral) => void
}) {
  const tx = useTx()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const answer = async (yes: boolean) => {
    setBusy(true); setErr('')
    try { onDone(await answerReferral(businessId, yes)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: 16, background: '#f0fdfa', border: '2px solid #0f766e', borderRadius: 18, padding: '18px 20px' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#1e2a4a' }}>
        {tx(`Did ${who.first_name} from ${who.city} introduce Sehatsandhi to you?`, `क्या ${who.city} के ${who.first_name} ने आपको सेहतसंधि के बारे में बताया?`)}
      </div>
      <div style={{ fontSize: 13, color: '#4b5563', margin: '6px 0 12px' }}>
        {tx('They are a Sehatsandhi Care Partner. Your answer does not change your price. Partners never collect money — you always pay Sehatsandhi directly.',
            'वे सेहतसंधि केयर पार्टनर हैं। आपके जवाब से आपकी कीमत नहीं बदलती। पार्टनर कभी पैसे नहीं लेते — आप हमेशा सीधे सेहतसंधि को भुगतान करते हैं।')}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => answer(true)} style={{ padding: '10px 22px', borderRadius: 10, background: '#0f766e', color: '#fff', fontWeight: 800, border: 0, minHeight: 44 }}>{tx('Yes', 'हाँ')}</button>
        <button disabled={busy} onClick={() => answer(false)} style={{ padding: '10px 22px', borderRadius: 10, background: '#fff', color: '#1e2a4a', fontWeight: 800, border: '1px solid #d6d3cc', minHeight: 44 }}>{tx('No', 'नहीं')}</button>
      </div>
      {err && <p style={{ fontSize: 13, color: '#b42318', margin: '8px 0 0' }}>{err}</p>}
    </div>
  )
}

/** Dashboard card for the owner: the question if unanswered; who introduced them and "Report" once confirmed. */
export function BusinessPartnerCard({ businessId }: { businessId: string }) {
  const tx = useTx()
  const on = usePartnerProgramEnabled()
  const [ref, setRef] = useState<Referral | null>(null)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (on) businessReferral(businessId).then(setRef) }, [on, businessId])
  if (!on || !ref || ref.state === 'none') return null
  if (ref.state === 'pending') return <ReferralQuestion businessId={businessId} who={ref} onDone={setRef} />
  return (
    <div className="card shadow-sm text-sm text-gray-700">
      <div>{tx(`Introduced to Sehatsandhi by ${ref.first_name}, ${ref.city} (${ref.partner_code}).`, `${ref.city} के ${ref.first_name} (${ref.partner_code}) ने आपको सेहतसंधि से जोड़ा।`)}</div>
      {msg ? <p className="text-green-700 mt-1">{msg}</p> : reporting ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea className="input-field" rows={3} placeholder={tx('What happened? (for example: asked for cash, made false promises)', 'क्या हुआ? (जैसे: नकद माँगा, झूठे वादे किए)')} value={reason} onChange={e => setReason(e.target.value)} />
          {err && <p className="text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button className="btn-teal text-sm py-2 px-4" onClick={async () => { setErr(''); try { await reportPartner(businessId, reason); setMsg(tx('Thank you. Our team will look into it.', 'धन्यवाद। हमारी टीम इसे देखेगी।')) } catch (e) { setErr((e as Error).message) } }}>{tx('Send report', 'रिपोर्ट भेजें')}</button>
            <button className="text-sm text-gray-600" onClick={() => setReporting(false)}>{tx('Cancel', 'रद्द')}</button>
          </div>
        </div>
      ) : <button className="text-red-700 underline mt-1" onClick={() => setReporting(true)}>{tx('Report this partner', 'इस पार्टनर की शिकायत करें')}</button>}
    </div>
  )
}
