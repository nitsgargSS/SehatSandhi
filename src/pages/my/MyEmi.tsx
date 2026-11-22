import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  emiHospitals, myEmiCases, requestEmi, useFinanceEnabled, MIN_EMI_AMOUNT, bilingual,
  type EmiHospital, type MyEmiCase, type CaseStatus,
} from '../../lib/financeApi'
import { Err, MyShell, useMe, day } from './MyShell'

// My Sehatsandhi → Treatment on EMI (0327). The patient asks a hospital that
// offers EMI; the hospital confirms the estimate; then the patient gives
// consent and picks a lender on /emi/<token>. Only three questions here —
// hospital, treatment, amount — per the "ask only what is needed" rule; the
// name comes from the login and can be corrected, the phone is the login's.

const STATUS_BI: Record<CaseStatus, string> = {
  requested: 'अस्पताल की पुष्टि बाकी / Waiting for hospital',
  hospital_confirmed: 'लेंडर चुनें / Choose a lender',
  shared: 'लेंडर के पास / With lender', offered: 'ऑफ़र मिला / Offer made', sanctioned: 'लोन मंज़ूर / Sanctioned',
  disbursed: 'अस्पताल को भुगतान / Paid to hospital', closed: 'पूरा / Done',
  declined: 'मंज़ूर नहीं / Declined', withdrawn: 'वापस लिया / Withdrawn', expired: 'समय खत्म / Expired',
}
const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`

function Emi() {
  const { who } = useMe()
  const [cases, setCases] = useState<MyEmiCase[] | null>(null)
  const [err, setErr] = useState('')
  const [asking, setAsking] = useState(false)
  const [sent, setSent] = useState<{ hospital: string } | null>(null)

  const load = useCallback(() => { myEmiCases().then(setCases).catch(e => { setCases([]); setErr(bilingual((e as Error).message)) }) }, [])
  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="card text-sm text-gray-700 space-y-1">
        <p className="font-bold text-navy-700 text-base">इलाज EMI पर / Treatment on EMI</p>
        <p>₹{MIN_EMI_AMOUNT.toLocaleString('en-IN')} या उससे ज़्यादा के इलाज के लिए बैंक/NBFC से लोन, जो सीधे अस्पताल को भुगतान करता है।</p>
        <p>A loan from an RBI-regulated bank or NBFC for treatment of ₹{MIN_EMI_AMOUNT.toLocaleString('en-IN')} or more, paid straight to the hospital.</p>
        <p className="text-xs text-gray-500">Sehatsandhi लेंडर नहीं है और आपसे कुछ नहीं लेता। / Sehatsandhi is not a lender and charges you nothing.</p>
      </div>

      {sent && (
        <div className="card border-2 border-teal-500 text-sm text-gray-700 space-y-1">
          <p className="font-bold text-navy-700">भेज दिया / Sent to {sent.hospital}</p>
          <p>अस्पताल आपका इलाज और खर्च पक्का करेगा। फिर आप नीचे अपने अनुरोध से लेंडर चुन पाएँगे।</p>
          <p>The hospital will confirm your treatment and estimate. Then open your request below to choose a lender.</p>
        </div>
      )}

      {asking
        ? <AskForm defaultName={who.name ?? ''} onCancel={() => setAsking(false)}
            onSent={h => { setAsking(false); setSent({ hospital: h }); load() }} />
        : <button onClick={() => { setAsking(true); setSent(null) }} className="btn-teal justify-center py-3">EMI के लिए पूछें / Ask for EMI</button>}

      <Err msg={err} />

      {cases && cases.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-600">मेरे अनुरोध / My requests</p>
          {cases.map(c => (
            <Link key={c.case_no} to={`/emi/${c.public_token}`} className="card block hover:shadow-md">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold text-navy-700">{c.treatment}</span>
                <span className="text-xs text-teal-700">{STATUS_BI[c.status]}</span>
              </div>
              <div className="text-sm text-gray-600">{c.hospital} · {inr(c.requested_amount)}</div>
              <div className="text-xs text-gray-400">{c.case_no} · {day(c.created_at)}</div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

function AskForm({ defaultName, onCancel, onSent }: { defaultName: string; onCancel: () => void; onSent: (hospital: string) => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<EmiHospital[] | null>(null)
  const [hospital, setHospital] = useState<EmiHospital | null>(null)
  const [name, setName] = useState(defaultName)
  const [treatment, setTreatment] = useState('')
  const [amount, setAmount] = useState('')
  const [planned, setPlanned] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (hospital) return
    const t = setTimeout(() => { emiHospitals(q.trim()).then(setList).catch(e => setErr(bilingual((e as Error).message))) }, 250)
    return () => clearTimeout(t)
  }, [q, hospital])

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const amt = Number(amount)
    if (!hospital) { setErr('अस्पताल चुनें / Choose the hospital.'); return }
    if (!treatment.trim()) { setErr('इलाज लिखें / Say what the treatment is.'); return }
    if (!(amt >= MIN_EMI_AMOUNT)) { setErr(`कम से कम ₹${MIN_EMI_AMOUNT.toLocaleString('en-IN')} / At least ₹${MIN_EMI_AMOUNT.toLocaleString('en-IN')}.`); return }
    if (!name.trim()) { setErr('मरीज़ का नाम / Patient’s name is needed.'); return }
    setBusy(true); setErr('')
    try { await requestEmi({ hospitalId: hospital.id, name: name.trim(), treatment: treatment.trim(), amount: amt, plannedOn: planned || null }); onSent(hospital.name) }
    catch (e2) { setErr(bilingual((e2 as Error).message)) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={send} className="card flex flex-col gap-3">
      <div>
        <label className="text-sm text-gray-700 block mb-1">अस्पताल / Hospital</label>
        {hospital ? (
          <div className="flex items-center justify-between gap-2 bg-teal-50 rounded-xl p-3">
            <div><div className="font-semibold text-navy-700">{hospital.name}</div>{hospital.town && <div className="text-xs text-gray-500">{hospital.town}</div>}</div>
            <button type="button" onClick={() => setHospital(null)} className="text-sm text-teal-700 underline">बदलें / Change</button>
          </div>
        ) : (<>
          <input className="input-field" placeholder="नाम या शहर / Name or town" value={q} onChange={e => setQ(e.target.value)} />
          <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
            {list === null ? <p className="text-sm text-gray-400">Loading…</p>
              : list.length === 0 ? <p className="text-sm text-gray-500">अभी कोई अस्पताल नहीं मिला। / No hospital offering EMI found.</p>
              : list.map(h => (
                <button type="button" key={h.id} onClick={() => setHospital(h)} className="w-full text-left rounded-xl border border-gray-200 p-3 hover:border-teal-500">
                  <div className="font-semibold text-navy-700">{h.name}</div>
                  <div className="text-xs text-gray-500">{[h.town, h.address].filter(Boolean).join(' · ')}</div>
                </button>
              ))}
          </div>
        </>)}
      </div>
      <div>
        <label className="text-sm text-gray-700 block mb-1">इलाज / Treatment</label>
        <input className="input-field" placeholder="जैसे: घुटने का ऑपरेशन / e.g. knee operation" value={treatment} onChange={e => setTreatment(e.target.value)} />
      </div>
      <div>
        <label className="text-sm text-gray-700 block mb-1">कितना लोन चाहिए? (₹) / Loan needed (₹)</label>
        <input className="input-field" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} />
        <p className="text-xs text-gray-500 mt-1">अंदाज़ा ठीक है; अस्पताल सही राशि पक्की करेगा। / An estimate is fine; the hospital confirms the exact amount.</p>
      </div>
      <details className="text-sm text-gray-600">
        <summary className="cursor-pointer">मरीज़ का नाम, तारीख / Patient name, date</summary>
        <div className="flex flex-col gap-2 mt-2">
          <input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="मरीज़ का नाम / Patient’s name" />
          <input className="input-field" type="date" value={planned} onChange={e => setPlanned(e.target.value)} />
        </div>
      </details>
      <Err msg={err} />
      <div className="flex gap-3 items-center">
        <button className="btn-teal justify-center disabled:opacity-50 flex-1" disabled={busy}>{busy ? 'भेज रहे हैं… / Sending…' : 'भेजें / Send'}</button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-600">रद्द / Cancel</button>
      </div>
    </form>
  )
}

function EmiOff() {
  return <div className="card text-sm text-gray-600">इलाज EMI पर जल्द आ रहा है। / Treatment on EMI is coming soon.</div>
}

export default function MyEmi() {
  const on = useFinanceEnabled()
  return <MyShell title="Treatment on EMI">{on === null ? <p className="text-sm text-gray-400">Loading…</p> : on ? <Emi /> : <EmiOff />}</MyShell>
}
