import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getPublicCase, shareWithLenders, withdrawByToken, EMI_TOKEN_RE,
  type PublicCase, type PublicLenderAvailable, type CaseStatus,
} from '../lib/financeApi'
import FollowUs from '../components/FollowUs'

// Treatment on EMI — the patient's page, at /emi/<token> (0326, step 3).
// No login: the link is the key, like /i/<token> for insurance.
//
// What the patient does here: read what will be shared, pick one or two
// lenders, give consent. Then follow the case to "paid to hospital". KYC,
// documents and e-sign happen in the lender's own journey, never here —
// Sehatsandhi stores none of it. Bilingual, Hindi first, like the other
// patient links.

const inr = (n: number | null | undefined) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

const STEPS: { label: string; reached: (s: CaseStatus) => boolean }[] = [
  { label: 'अनुरोध / Requested', reached: () => true },
  { label: 'अस्पताल ने पुष्टि की / Hospital confirmed', reached: s => s !== 'requested' },
  { label: 'लेंडर के पास / With lender', reached: s => ['shared', 'offered', 'sanctioned', 'disbursed', 'closed'].includes(s) },
  { label: 'लोन मंज़ूर / Loan sanctioned', reached: s => ['sanctioned', 'disbursed', 'closed'].includes(s) },
  { label: 'अस्पताल को भुगतान / Paid to hospital', reached: s => ['disbursed', 'closed'].includes(s) },
]

const LENDER_STATUS_BI: Record<string, string> = {
  shared: 'देख रहे हैं / Reviewing', offered: 'ऑफ़र दिया / Offer made', sanctioned: 'मंज़ूर / Sanctioned',
  disbursed: 'अस्पताल को भुगतान / Paid to hospital', declined: 'मना किया / Declined', withdrawn: 'वापस लिया / Withdrawn',
}

export default function EmiTrack() {
  const { token } = useParams()
  const [c, setC] = useState<PublicCase | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [agree, setAgree] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(() => {
    if (!token || !EMI_TOKEN_RE.test(token)) { setErr('यह लिंक सही नहीं है। / This link is not valid.'); return }
    getPublicCase(token).then(r => r ? setC(r) : setErr('यह अनुरोध नहीं मिला। / Request not found.'))
      .catch(() => setErr('अभी लोड नहीं हुआ, फिर कोशिश करें। / Could not load — please try again.'))
  }, [token])
  useEffect(() => { load() }, [load])
  useEffect(() => { const i = setInterval(load, 60_000); return () => clearInterval(i) }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!c) return <div className="min-h-screen bg-gray-50 p-6 text-gray-700">{err || 'Loading…'}</div>

  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.length >= 2 ? p : [...p, id])
  const toHospital = c.lenders_available.filter(l => l.pays_to === 'hospital')
  const toPatient = c.lenders_available.filter(l => l.pays_to === 'patient')
  const canWithdraw = ['requested', 'hospital_confirmed', 'shared', 'offered'].includes(c.status)
  const ended = ['declined', 'withdrawn', 'expired'].includes(c.status)
  const pickedNames = c.lenders_available.filter(l => picked.includes(l.lender_id)).map(l => l.name).join(' / ')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <Link to="/" className="font-extrabold text-teal-700 text-lg">Sehatsandhi</Link>

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">इलाज EMI पर / Treatment on EMI</div>
          <h1 className="text-xl font-extrabold text-navy-700 mt-1">{c.treatment}</h1>
          <p className="text-sm text-gray-600">{c.hospital}{c.hospital_address ? `, ${c.hospital_address}` : ''}</p>
          <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
            <div><div className="text-xs text-gray-500">लोन / Loan</div><div className="font-bold text-navy-700">{inr(c.requested)}</div></div>
            <div><div className="text-xs text-gray-500">अनुमानित खर्च / Estimate</div><div className="font-bold text-navy-700">{inr(c.estimate)}</div></div>
            {c.planned_on && <div><div className="text-xs text-gray-500">तारीख / Date</div><div>{day(c.planned_on)}</div></div>}
            <div><div className="text-xs text-gray-500">नंबर / Ref.</div><div>{c.case_no}</div></div>
          </div>
        </div>

        {!ended && (
          <ol className="bg-white rounded-2xl shadow-sm p-5 space-y-2">
            {STEPS.map(s => {
              const on = s.reached(c.status)
              return (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${on ? 'bg-teal-600 text-white' : 'border-2 border-gray-300'}`}>{on ? '✓' : ''}</span>
                  <span className={on ? 'text-navy-700 font-medium' : 'text-gray-400'}>{s.label}</span>
                </li>
              )
            })}
          </ol>
        )}

        {c.status === 'requested' && (
          <div className="bg-white rounded-2xl shadow-sm p-5 text-sm text-gray-700 space-y-1">
            <p>अस्पताल आपके इलाज और खर्च की पुष्टि करेगा। उसके बाद आप यहाँ लेंडर चुन पाएँगे।</p>
            <p>The hospital will confirm your treatment and estimate. Then you can choose a lender here.</p>
          </div>
        )}

        {/* Consent and choice of lender */}
        {c.status === 'hospital_confirmed' && (
          c.lenders_available.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-5 text-sm text-gray-700 space-y-1">
              <p>अभी इस राशि के लिए कोई लेंडर उपलब्ध नहीं है। जैसे ही कोई जुड़ेगा, आप यहीं चुन पाएँगे।</p>
              <p>No lender is available for this amount yet. You can choose here as soon as one joins.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
              <h2 className="font-bold text-navy-700">एक या दो लेंडर चुनें / Choose one or two lenders</h2>
              {toHospital.map(l => <LenderChoice key={l.lender_id} l={l} on={picked.includes(l.lender_id)} onToggle={() => toggle(l.lender_id)} />)}
              {toPatient.length > 0 && (<>
                <p className="text-xs text-gray-500 pt-1">
                  ये लेंडर पैसा आपके खाते में देते हैं, अस्पताल को नहीं। / These lenders pay the money to you, not to the hospital.
                </p>
                {toPatient.map(l => <LenderChoice key={l.lender_id} l={l} on={picked.includes(l.lender_id)} onToggle={() => toggle(l.lender_id)} />)}
              </>)}

              <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 space-y-2">
                <div className="font-semibold text-navy-700">क्या शेयर होगा / What will be shared</div>
                <p>आपका नाम, मोबाइल नंबर, इलाज, अनुमानित खर्च, लोन राशि और अस्पताल का नाम — सिर्फ़ उन लेंडर के साथ जिन्हें आप चुनें, ताकि वे लोन के लिए आपसे संपर्क कर सकें।</p>
                <p>Your name, mobile number, treatment, estimate, loan amount and the hospital — only with the lender(s) you choose, so they can contact you about the loan.</p>
                <p className="text-xs text-gray-500">
                  KYC (आधार, PAN, बैंक स्टेटमेंट) आप सीधे लेंडर को देंगे; Sehatsandhi उन्हें न लेता है, न रखता है। लोन का फ़ैसला और ब्याज लेंडर तय करता है।
                  / Your KYC (Aadhaar, PAN, bank statement) goes directly to the lender; Sehatsandhi never collects or keeps it. The lender decides the loan and its interest.
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" className="mt-1 w-5 h-5" checked={agree} onChange={e => setAgree(e.target.checked)} />
                <span>मैं सहमत हूँ कि ऊपर की जानकारी मेरे चुने हुए लेंडर के साथ शेयर की जाए। / I agree to share the details above with the lender(s) I chose.</span>
              </label>
              <button disabled={busy || picked.length === 0 || !agree}
                onClick={() => act(() => shareWithLenders(token!, picked))}
                className="btn-teal py-3 px-5 w-full disabled:opacity-50">
                {picked.length === 0 ? 'लेंडर चुनें / Choose a lender' : `भेजें / Send to ${pickedNames}`}
              </button>
            </div>
          )
        )}

        {/* Lenders who have the case */}
        {c.lenders_shared.length > 0 && (
          <div className="space-y-3">
            {c.lenders_shared.map(l => (
              <div key={l.lender_id} className={`bg-white rounded-2xl shadow-sm p-5 space-y-2 ${['shared', 'offered', 'sanctioned'].includes(l.status) ? 'border-2 border-teal-500' : ''}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-bold text-navy-700">{l.name}</div>
                  <div className="text-xs text-gray-600">{LENDER_STATUS_BI[l.status] ?? l.status}</div>
                </div>
                {l.offer_amount != null && (
                  <p className="text-sm text-gray-700">
                    {inr(l.offer_amount)}{l.offer_tenure_months ? ` · ${l.offer_tenure_months} महीने / months` : ''}{l.offer_emi ? ` · EMI ${inr(l.offer_emi)}` : ''}
                    <span className="block text-xs text-gray-500">लेंडर के आँकड़े; पूरी शर्तें लेंडर की Key Fact Statement में। / Lender’s figures; full terms in the lender’s Key Fact Statement.</span>
                  </p>
                )}
                {['shared', 'offered'].includes(l.status) && (
                  l.journey_url
                    ? <a href={l.journey_url.replace('{ref}', encodeURIComponent(c.case_no))} target="_blank" rel="noopener noreferrer"
                        className="block text-center btn-teal py-3">{l.name} के साथ आगे बढ़ें / Continue with {l.name}</a>
                    : <p className="text-sm text-gray-600">{l.name} आपको कॉल करेगा। / {l.name} will call you.</p>
                )}
                <p className="text-xs text-gray-500">
                  लोन {l.name} देता है, जो RBI द्वारा नियंत्रित है। Sehatsandhi लेंडर नहीं है और आपसे कुछ नहीं लेता।
                  / The loan is from {l.name}, an RBI-regulated lender. Sehatsandhi is not a lender and charges you nothing.
                </p>
                {(l.grievance_email || l.grievance_phone) && (
                  <p className="text-xs text-gray-500">शिकायत / Grievance: {[l.grievance_email, l.grievance_phone].filter(Boolean).join(' · ')}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {c.status === 'sanctioned' && (
          <p className="bg-white rounded-2xl shadow-sm p-4 text-sm text-gray-700">
            लोन मंज़ूर है। भर्ती की तारीख पक्की होने पर लेंडर सीधे अस्पताल को भुगतान करेगा। / Your loan is sanctioned. The lender pays the hospital directly once your admission date is confirmed.
          </p>
        )}
        {(c.status === 'disbursed' || c.status === 'closed') && (
          <p className="bg-white rounded-2xl shadow-sm p-4 text-sm text-green-800 font-medium">
            लेंडर ने अस्पताल को भुगतान कर दिया है। EMI लेंडर को चुकानी है, Sehatsandhi को नहीं। / The lender has paid the hospital. Your EMIs are paid to the lender, not to Sehatsandhi.
          </p>
        )}
        {c.status === 'declined' && (
          <p className="bg-white rounded-2xl shadow-sm p-4 text-sm text-gray-700">लेंडर ने यह लोन मंज़ूर नहीं किया। अस्पताल से दूसरे विकल्प पूछें। / The lender did not approve this loan. Ask the hospital about other options.</p>
        )}
        {c.status === 'withdrawn' && <p className="text-sm text-gray-500">अनुरोध वापस लिया गया। / This request was withdrawn.</p>}
        {c.status === 'expired' && <p className="text-sm text-gray-500">अनुरोध की समय-सीमा खत्म हो गई। / This request has expired.</p>}

        {canWithdraw && (
          withdrawing ? (
            <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2 text-sm">
              <input className="input-field" placeholder="कारण (वैकल्पिक) / Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} />
              <div className="flex gap-3">
                <button disabled={busy} onClick={() => act(() => withdrawByToken(token!, reason.trim()))} className="py-2 px-4 rounded-lg bg-red-600 text-white">वापस लें / Withdraw</button>
                <button onClick={() => setWithdrawing(false)} className="text-gray-600">रद्द / Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setWithdrawing(true)} className="text-sm text-gray-500 underline">अब EMI नहीं चाहिए / I don’t want EMI any more</button>
          )
        )}

        {err && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>}

        <p className="text-xs text-gray-400">
          Sehatsandhi सिर्फ़ आपको, अस्पताल और लेंडर को जोड़ता है। हम लोन नहीं देते, पैसा नहीं रखते और आपसे कोई शुल्क नहीं लेते।
          / Sehatsandhi only connects you, the hospital and the lender. We don’t lend, don’t hold the money and charge you nothing.
        </p>
        <FollowUs />
      </div>
    </div>
  )
}

function LenderChoice({ l, on, onToggle }: { l: PublicLenderAvailable; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className={`w-full text-left rounded-xl p-3 border-2 ${on ? 'border-teal-600 bg-teal-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-navy-700">{l.name}</span>
        <span className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${on ? 'bg-teal-600 border-teal-600 text-white' : 'border-gray-300'}`}>{on ? '✓' : ''}</span>
      </div>
      <div className="text-xs text-gray-500">{l.entity_type === 'bank' ? 'Bank' : 'NBFC'} · RBI regulated{l.no_cost_emi ? ' · No-cost EMI' : ''}</div>
      {l.terms && <div className="text-sm text-gray-700 mt-1">{l.terms}</div>}
      {l.tenures && <div className="text-xs text-gray-500">{l.tenures}</div>}
    </button>
  )
}
