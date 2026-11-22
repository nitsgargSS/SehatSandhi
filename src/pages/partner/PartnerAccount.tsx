import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BadgeCheck, Download, FileText, ShieldAlert } from 'lucide-react'
import PartnerShell, { usePartnerMe, useTx } from './PartnerShell'
import {
  acceptContracts, careFileUrl, careSettings, createTicket, myFeeInvoice, myTickets, partnerFeeOrder, pendingContracts,
  replyTicket, requestPartnerCode, ticketMessages, verifyPartner, whenIST, STATUS_LABEL, TICKET_CATEGORY,
  addLead, myLeads, releaseLead, type CareLeads, myMoney, submitKyc, type MyMoney,
  type CareContract, type CareTicket, type TicketCategory, type TicketMessage, type VerifiedPartner,
} from '../../lib/careApi'
import { loadRazorpayCheckout, verifyRazorpayPayment } from '../../lib/businessApi'
import { qrDataUrl } from '../../lib/qr'

// Care Partner Program, Phase 3 (0333):
//   /partner/certify    pay the certification fee → Partner ID
//   /partner/agreement  read and accept every current contract (WhatsApp code)
//   /partner/dashboard  Partner ID, badge with QR, status, invoice, contracts
//   /partner/tickets    write to the team; replies arrive here
//   /verify/:code       public: is this a real Sehatsandhi partner?

const day = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// ── Certification fee ───────────────────────────────────────────────────────
export function PartnerCertify() {
  return <PartnerShell title="Get your Partner ID" titleHi="अपना Partner ID पाएँ" needs="registered"><Certify /></PartnerShell>
}

function Certify() {
  const { tx } = useTx()
  const { me, reload } = usePartnerMe()
  const navigate = useNavigate()
  const [fee, setFee] = useState('100')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { careSettings().then(s => { if (s.cert_fee) setFee(s.cert_fee) }) }, [])
  const status = me.partner?.status

  if (me.partner?.partner_code) {
    return <div className="card">{tx('Your Partner ID is already issued: ', 'आपका Partner ID पहले ही जारी हो चुका है: ')}<b>{me.partner.partner_code}</b>.
      <Link to="/partner/dashboard" className="block mt-2 text-teal-700 underline">{tx('Go to your dashboard', 'अपने डैशबोर्ड पर जाएँ')}</Link></div>
  }
  if (status !== 'quiz_passed') {
    return <div className="card text-gray-700">{tx('Pass the final exam first. Then you can pay the certification fee here.', 'पहले फ़ाइनल परीक्षा पास करें। फिर आप यहाँ सर्टिफ़िकेशन फ़ीस दे सकते हैं।')}
      <Link to="/partner/learn" className="block mt-2 text-teal-700 underline">{tx('Back to Learn', 'सीखें पर वापस')}</Link></div>
  }

  const pay = async () => {
    setBusy(true); setErr('')
    try {
      await loadRazorpayCheckout()
      const o = await partnerFeeOrder()
      const Rzp = (window as unknown as { Razorpay: new (opts: unknown) => { open(): void; on(ev: string, f: (r: unknown) => void): void } }).Razorpay
      const rzp = new Rzp({
        key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency,
        name: 'Sehatsandhi', description: tx('Care Partner certification', 'केयर पार्टनर सर्टिफ़िकेशन'),
        prefill: { name: o.name, contact: o.phone.slice(-10), email: o.email ?? undefined },
        theme: { color: '#0f766e' }, remember_customer: false,
        modal: { ondismiss: () => setBusy(false) },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const v = await verifyRazorpayPayment({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature, paymentRowId: o.paymentRowId })
            if (!v.ok) throw new Error(v.error ?? 'Payment could not be confirmed.')
            await reload(); navigate('/partner/agreement', { replace: true })
          } catch (e) { setErr((e as Error).message + ' ' + tx('If money was taken, your ID will appear shortly — or open a ticket.', 'अगर पैसे कट गए हैं, तो आपका ID जल्द दिखेगा — या टिकट खोलें।')); setBusy(false) }
        },
      })
      rzp.on('payment.failed', () => { setErr(tx('The payment did not go through. You can try again.', 'भुगतान नहीं हुआ। आप फिर से कोशिश कर सकते हैं।')); setBusy(false) })
      rzp.open()
    } catch (e) { setErr((e as Error).message); setBusy(false) }
  }

  return (
    <div className="card space-y-3">
      <p className="text-lg font-bold text-navy-700">{tx('Congratulations on passing the exam!', 'परीक्षा पास करने पर बधाई!')}</p>
      <p className="text-gray-700">{tx(`The one-time certification fee is ₹${fee}, all taxes included. You get your Partner ID, your badge and a GST invoice.`,
        `एक बार की सर्टिफ़िकेशन फ़ीस ₹${fee} है, सभी टैक्स सहित। आपको Partner ID, बैज और GST इनवॉइस मिलेगा।`)}</p>
      <p className="text-sm text-gray-600">{tx('The fee is not refundable once your Partner ID is issued. It is never a deposit, and no reward is ever paid on it.',
        'Partner ID जारी होने के बाद फ़ीस वापस नहीं होती। यह कोई जमा राशि नहीं है, और इस पर कभी कोई रिवॉर्ड नहीं मिलता।')}</p>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <button disabled={busy} onClick={pay} className="btn-teal py-3 px-6 w-full sm:w-auto">{busy ? tx('Opening payment…', 'भुगतान खुल रहा है…') : tx(`Pay ₹${fee}`, `₹${fee} दें`)}</button>
    </div>
  )
}

// ── Agreement ───────────────────────────────────────────────────────────────
export function PartnerAgreement() {
  return <PartnerShell title="Partner Agreement" titleHi="पार्टनर एग्रीमेंट" needs="registered"><Agreement /></PartnerShell>
}

function Agreement() {
  const { tx, lang } = useTx()
  const { me, reload } = usePartnerMe()
  const navigate = useNavigate()
  const [list, setList] = useState<CareContract[] | null>(null)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [agree, setAgree] = useState(false)
  const [sent, setSent] = useState(false)
  const [dev, setDev] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { pendingContracts().then(setList, e => { setErr((e as Error).message); setList([]) }) }, [])

  if (!me.partner?.partner_code) return <div className="card text-gray-700">{tx('Get your Partner ID first.', 'पहले अपना Partner ID पाएँ।')} <Link to="/partner/certify" className="text-teal-700 underline">{tx('Certification', 'सर्टिफ़िकेशन')}</Link></div>
  if (!list) return <p className="text-gray-400">{tx('Loading…', 'लोड हो रहा है…')}</p>
  if (list.length === 0) return <div className="card text-gray-700">{tx('Nothing to accept right now.', 'अभी स्वीकार करने को कुछ नहीं है।')} <Link to="/partner/dashboard" className="text-teal-700 underline">{tx('Dashboard', 'डैशबोर्ड')}</Link></div>

  const pathOf = (c: CareContract) => (lang === 'hi' ? c.pdf_path_hi ?? c.pdf_path_en : c.pdf_path_en ?? c.pdf_path_hi) ?? null
  const allOpened = list.every(c => opened[c.id] || !pathOf(c))
  const open = async (c: CareContract) => {
    const path = pathOf(c); if (!path) return
    const w = window.open('', '_blank')
    try { const u = await careFileUrl(path); if (w) w.location.href = u; setOpened(o => ({ ...o, [c.id]: true })) } catch { w?.close() }
  }
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }

  return (
    <div className="card space-y-4">
      <p className="text-gray-700">{tx('Open and read each document below. Then tick the box and confirm with the code we send to your WhatsApp.',
        'नीचे दिया हर दस्तावेज़ खोलकर पढ़ें। फिर बॉक्स पर टिक करें और WhatsApp पर भेजे गए कोड से पुष्टि करें।')}</p>
      <ul className="space-y-2">
        {list.map(c => (
          <li key={c.id} className="flex items-center justify-between gap-2 border border-gray-100 rounded-xl p-3">
            <span><span className="font-semibold text-navy-700">{tx(c.title_en, c.title_hi)}</span> <span className="text-xs text-gray-400">· {c.version}</span></span>
            <button onClick={() => open(c)} className={`text-sm py-2 px-3 rounded-lg border inline-flex items-center gap-1 ${opened[c.id] ? 'border-teal-300 text-teal-800' : 'border-gray-300'}`}>
              <FileText className="w-4 h-4" /> {opened[c.id] ? tx('Opened', 'खोला') : tx('Open', 'खोलें')}
            </button>
          </li>
        ))}
      </ul>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1 w-5 h-5" checked={agree} disabled={!allOpened} onChange={e => setAgree(e.target.checked)} />
        <span>{tx('I have read these documents and I accept them. I am not a registered medical practitioner, and I will not receive rewards for any clinic or hospital I own, work in, or am related to.',
          'मैंने ये दस्तावेज़ पढ़ लिए हैं और मैं इन्हें स्वीकार करता/करती हूँ। मैं रजिस्टर्ड डॉक्टर नहीं हूँ, और किसी ऐसे क्लिनिक या अस्पताल पर रिवॉर्ड नहीं लूँगा/लूँगी जिसका मैं मालिक हूँ, जहाँ काम करता/करती हूँ या जिससे मेरा रिश्ता है।')}</span>
      </label>
      {!allOpened && <p className="text-xs text-gray-500">{tx('Open every document to continue.', 'आगे बढ़ने के लिए हर दस्तावेज़ खोलें।')}</p>}
      {!sent ? (
        <button disabled={!agree || busy} className="btn-teal py-3 px-6 disabled:opacity-50"
          onClick={() => run(async () => { const r = await requestPartnerCode(me.phone ?? ''); setSent(true); if (r.devCode) setDev(r.devCode) })}>
          {tx('Send me the code', 'मुझे कोड भेजें')}
        </button>
      ) : (
        <div className="flex flex-col gap-2 max-w-xs">
          <label className="text-sm text-gray-700">{tx('Code from WhatsApp', 'WhatsApp पर आया कोड')}
            <input className="input-field mt-1 text-lg tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          </label>
          {dev && <p className="text-xs text-amber-700">Sandbox code: {dev}</p>}
          <button disabled={busy || code.length !== 6} className="btn-teal py-3 px-6 disabled:opacity-50"
            onClick={() => run(async () => { await acceptContracts(code); await reload(); navigate('/partner/dashboard', { replace: true }) })}>
            {tx('Accept and activate', 'स्वीकार करें और चालू करें')}
          </button>
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}

// ── Dashboard ───────────────────────────────────────────────────────────────
export function PartnerDashboard() {
  return <PartnerShell title="My partner dashboard" titleHi="मेरा पार्टनर डैशबोर्ड" needs="registered"><Dashboard /></PartnerShell>
}

function Dashboard() {
  const { tx } = useTx()
  const { me } = usePartnerMe()
  const p = me.partner!
  const [inv, setInv] = useState<{ invoice_number: string; invoice_token: string } | null>(null)
  useEffect(() => { myFeeInvoice().then(setInv) }, [])
  return (<>
    <div className="card">
      <div className="text-xs text-gray-500">{tx('Status', 'स्थिति')}</div>
      <div className="text-lg font-bold text-navy-700">{tx(STATUS_LABEL[p.status].en, STATUS_LABEL[p.status].hi)}</div>
      {p.partner_code
        ? <p className="text-gray-700 mt-1">{tx('Partner ID', 'Partner ID')}: <b className="text-xl tracking-wide">{p.partner_code}</b>{p.valid_until ? ` · ${tx('valid until', 'मान्य')} ${day(p.valid_until)}` : ''}</p>
        : <p className="text-gray-600 text-sm mt-1">{tx('Your Partner ID is issued after the final exam and the certification fee.', 'फ़ाइनल परीक्षा और सर्टिफ़िकेशन फ़ीस के बाद आपका Partner ID जारी होता है।')}</p>}
      {p.status_reason && ['paused', 'suspended', 'terminated'].includes(p.status) && <p className="text-sm text-amber-800 mt-1">{p.status_reason}</p>}
    </div>
    {p.partner_code && <Badge code={p.partner_code} name={p.full_name} city={p.city} validUntil={p.valid_until ?? null} />}
    {p.status === 'active' && <Leads />}
    {p.partner_code && <Money />}
    <div className="card text-sm space-y-2">
      <Link to="/partner/learn" className="block text-teal-700 underline">{tx('Training and contracts', 'ट्रेनिंग और अनुबंध')}</Link>
      <Link to="/partner/tickets" className="block text-teal-700 underline">{tx('My tickets', 'मेरे टिकट')}</Link>
      {inv && <a href={`/invoice/${inv.invoice_token}`} target="_blank" rel="noopener noreferrer" className="block text-teal-700 underline">{tx('Certification fee invoice', 'सर्टिफ़िकेशन फ़ीस इनवॉइस')} {inv.invoice_number}</a>}
    </div>
  </>)
}

// The badge: name, Partner ID, city, valid until, and a QR code to /verify/<ID>.
function Badge({ code, name, city, validUntil }: { code: string; name: string; city: string; validUntil: string | null }) {
  const { tx } = useTx()
  const [png, setPng] = useState('')
  const verifyUrl = `${window.location.origin}/verify/${code}`
  useEffect(() => {
    let live = true
    qrDataUrl(verifyUrl, 360).then(qr => new Promise<string>(resolve => {
      const c = document.createElement('canvas'); c.width = 800; c.height = 480
      const g = c.getContext('2d')!
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 800, 480)
      g.fillStyle = '#0f766e'; g.fillRect(0, 0, 800, 90)
      g.fillStyle = '#ffffff'; g.font = 'bold 38px sans-serif'; g.fillText('Sehatsandhi', 32, 58)
      g.font = '22px sans-serif'; g.fillText('Certified Care Partner', 520, 56)
      g.fillStyle = '#1e2a4a'; g.font = 'bold 40px sans-serif'; g.fillText(name.slice(0, 26), 32, 170)
      g.font = '26px sans-serif'; g.fillStyle = '#475569'; g.fillText(city.slice(0, 30), 32, 214)
      g.fillStyle = '#1e2a4a'; g.font = 'bold 54px monospace'; g.fillText(code, 32, 300)
      g.fillStyle = '#475569'; g.font = '22px sans-serif'
      if (validUntil) g.fillText(`Valid until ${day(validUntil)}`, 32, 344)
      g.fillText('Scan to check this partner', 32, 420); g.fillText(verifyUrl.replace(/^https?:\/\//, ''), 32, 450)
      const img = new Image()
      img.onload = () => { g.drawImage(img, 520, 130, 250, 250); resolve(c.toDataURL('image/png')) }
      img.src = qr
    })).then(u => { if (live) setPng(u) })
    return () => { live = false }
  }, [code, name, city, validUntil, verifyUrl])
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-semibold text-navy-700">{tx('Your badge', 'आपका बैज')}</span>
        {png && <a href={png} download={`sehatsandhi-partner-${code}.png`} className="text-sm text-teal-700 inline-flex items-center gap-1"><Download className="w-4 h-4" /> {tx('Download', 'डाउनलोड')}</a>}
      </div>
      {png ? <img src={png} alt={`${name} — ${code}`} className="w-full rounded-xl border border-gray-200" /> : <p className="text-gray-400 text-sm">{tx('Preparing…', 'तैयार हो रहा है…')}</p>}
      <p className="text-xs text-gray-500 mt-2">{tx('Show this to a doctor. Scanning the QR code shows your name, city and status on Sehatsandhi.', 'इसे डॉक्टर को दिखाएँ। QR कोड स्कैन करने पर सेहतसंधि पर आपका नाम, शहर और स्थिति दिखती है।')}</p>
    </div>
  )
}

// ── Tickets ─────────────────────────────────────────────────────────────────
export function PartnerTickets() {
  return <PartnerShell title="My tickets" titleHi="मेरे टिकट" needs="registered"><Tickets /></PartnerShell>
}

function Tickets() {
  const { tx } = useTx()
  const [list, setList] = useState<CareTicket[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [f, setF] = useState({ category: 'other' as TicketCategory, subject: '', body: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sla, setSla] = useState('48')
  const load = useCallback(() => { myTickets().then(setList, () => setList([])) }, [])
  useEffect(() => { load(); careSettings().then(s => { if (s.ticket_sla_hours) setSla(s.ticket_sla_hours) }) }, [load])

  const create = async () => {
    setBusy(true); setErr('')
    try { const id = await createTicket(f.category, f.subject, f.body); setWriting(false); setF({ category: 'other', subject: '', body: '' }); load(); setOpenId(id) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (<>
    <p className="text-sm text-gray-600">{tx(`We reply within ${sla} hours. Check the Help Center first — most answers are there.`, `हम ${sla} घंटे में जवाब देते हैं। पहले सहायता केंद्र देखें — ज़्यादातर जवाब वहीं हैं।`)}</p>
    {writing ? (
      <div className="card space-y-3">
        <label className="text-sm text-gray-700 block">{tx('About', 'विषय')}
          <select className="input-field mt-1" value={f.category} onChange={e => setF({ ...f, category: e.target.value as TicketCategory })}>
            {(Object.keys(TICKET_CATEGORY) as TicketCategory[]).map(k => <option key={k} value={k}>{tx(TICKET_CATEGORY[k].en, TICKET_CATEGORY[k].hi)}</option>)}
          </select></label>
        <label className="text-sm text-gray-700 block">{tx('Subject', 'शीर्षक')}<input className="input-field mt-1" maxLength={150} value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></label>
        <label className="text-sm text-gray-700 block">{tx('What happened?', 'क्या हुआ?')}<textarea className="input-field mt-1" rows={5} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></label>
        <p className="text-xs text-gray-500">{tx('Never write OTPs, PAN, bank or Aadhaar numbers here.', 'यहाँ कभी OTP, PAN, बैंक या आधार नंबर न लिखें।')}</p>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2"><button disabled={busy} onClick={create} className="btn-teal py-2.5 px-5">{tx('Send', 'भेजें')}</button><button onClick={() => setWriting(false)} className="text-gray-600 px-3">{tx('Cancel', 'रद्द')}</button></div>
      </div>
    ) : <button onClick={() => setWriting(true)} className="btn-teal py-2.5 px-5 w-fit">{tx('New ticket', 'नया टिकट')}</button>}
    {list === null ? <p className="text-gray-400">{tx('Loading…', 'लोड हो रहा है…')}</p>
      : list.length === 0 ? <p className="text-sm text-gray-500">{tx('No tickets yet.', 'अभी कोई टिकट नहीं।')}</p>
      : list.map(t => <TicketRow key={t.id} t={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} onChanged={load} />)}
  </>)
}

function TicketRow({ t, open, onToggle, onChanged }: { t: CareTicket; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const { tx } = useTx()
  const [msgs, setMsgs] = useState<TicketMessage[] | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) ticketMessages(t.id).then(setMsgs, () => setMsgs([])) }, [open, t.id])
  const statusText = t.status === 'answered' ? tx('Replied', 'जवाब आया') : t.status === 'closed' ? tx('Closed', 'बंद') : tx('Waiting for us', 'हमारी तरफ़ से बाकी')
  return (
    <div className="card">
      <button onClick={onToggle} className="w-full text-left flex items-center justify-between gap-2">
        <span><span className="font-semibold text-gray-800">{t.subject}</span><span className="block text-xs text-gray-500">{t.ticket_no} · {tx(TICKET_CATEGORY[t.category].en, TICKET_CATEGORY[t.category].hi)} · {whenIST(t.updated_at)}</span></span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === 'answered' ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-600'}`}>{statusText}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {msgs?.map(m => (
            <div key={m.id} className={`rounded-xl p-3 text-[15px] whitespace-pre-line ${m.author === 'admin' ? 'bg-teal-50' : 'bg-gray-50'}`}>
              <div className="text-xs text-gray-500 mb-1">{m.author === 'admin' ? 'Sehatsandhi' : tx('You', 'आप')} · {whenIST(m.created_at)}</div>{m.body}
            </div>
          ))}
          {t.status !== 'closed' && (<>
            <textarea className="input-field" rows={3} placeholder={tx('Write a reply', 'जवाब लिखें')} value={reply} onChange={e => setReply(e.target.value)} />
            <div className="flex gap-3">
              <button disabled={busy || !reply.trim()} className="btn-teal py-2 px-4 disabled:opacity-50"
                onClick={async () => { setBusy(true); try { await replyTicket(t.id, reply); setReply(''); setMsgs(await ticketMessages(t.id)); onChanged() } finally { setBusy(false) } }}>{tx('Send', 'भेजें')}</button>
              <button disabled={busy} className="text-sm text-gray-600" onClick={async () => { await replyTicket(t.id, '', true); onChanged() }}>{tx('My problem is solved — close', 'समस्या हल हो गई — बंद करें')}</button>
            </div>
          </>)}
        </div>
      )}
    </div>
  )
}

// ── Public verification ─────────────────────────────────────────────────────
export function VerifyPartnerPage() {
  return <PartnerShell title="Check a Sehatsandhi partner" titleHi="सेहतसंधि पार्टनर की जाँच" banner={false}><Verify /></PartnerShell>
}

function Verify() {
  const { tx } = useTx()
  const { code = '' } = useParams()
  const [v, setV] = useState<VerifiedPartner | null | undefined>(undefined)
  useEffect(() => { verifyPartner(code).then(setV, () => setV(null)) }, [code])
  if (v === undefined) return <p className="text-gray-400">{tx('Checking…', 'जाँच हो रही है…')}</p>
  if (!v) return (
    <div className="card border-2 border-red-300 flex gap-3 items-start">
      <ShieldAlert className="w-8 h-8 text-red-600 shrink-0" />
      <div><p className="font-bold text-red-700">{tx('Not a Sehatsandhi partner', 'सेहतसंधि पार्टनर नहीं')}</p>
        <p className="text-sm text-gray-700">{tx(`No partner has the ID "${code}". Please do not share any details or pay anyone. Write to contact@sehatsandhi.com.`, `"${code}" ID वाला कोई पार्टनर नहीं है। कृपया कोई जानकारी साझा न करें और किसी को भुगतान न करें। contact@sehatsandhi.com पर लिखें।`)}</p></div>
    </div>
  )
  const good = v.status === 'active' || v.status === 'certified'
  const label: Record<string, [string, string]> = { active: ['Active partner', 'सक्रिय पार्टनर'], certified: ['Certified partner', 'सर्टिफ़ाइड पार्टनर'],
    paused: ['Paused', 'रोका गया'], suspended: ['Suspended', 'निलंबित'], terminated: ['No longer a partner', 'अब पार्टनर नहीं'], expired: ['ID expired', 'ID की अवधि खत्म'] }
  return (
    <div className={`card border-2 ${good ? 'border-teal-500' : 'border-amber-400'} space-y-1`}>
      <p className={`font-bold text-lg flex items-center gap-2 ${good ? 'text-teal-700' : 'text-amber-700'}`}>
        {good ? <BadgeCheck className="w-7 h-7" /> : <ShieldAlert className="w-7 h-7" />}{tx(...(label[v.status] ?? [v.status, v.status]))}</p>
      <p className="text-xl font-bold text-navy-700">{v.full_name}</p>
      <p className="text-gray-700">{v.city}, {v.state} · {v.partner_code}</p>
      {v.valid_until && <p className="text-sm text-gray-600">{tx('Valid until', 'मान्य')} {day(v.valid_until)}</p>}
      <p className="text-xs text-gray-500 pt-2">{tx('Partners introduce Sehatsandhi. They never collect money — businesses always pay Sehatsandhi directly.', 'पार्टनर सेहतसंधि का परिचय देते हैं। वे कभी पैसे नहीं लेते — व्यवसाय हमेशा सीधे सेहतसंधि को भुगतान करते हैं।')}</p>
    </div>
  )
}

// ── Reserved doctors and credited businesses (0334) ─────────────────────────
function Leads() {
  const { tx } = useTx()
  const [d, setD] = useState<CareLeads | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [days, setDays] = useState('90')
  const load = useCallback(() => { myLeads().then(setD, e => setErr((e as Error).message)) }, [])
  useEffect(() => { load(); careSettings().then(s => { if (s.lead_lock_days) setDays(s.lead_lock_days) }) }, [load])
  const add = async () => {
    setBusy(true); setErr('')
    try { await addLead(name, phone); setName(''); setPhone(''); load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const LABEL: Record<string, [string, string]> = {
    locked: ['Reserved', 'रिज़र्व'], matched: ['Signed up — waiting for their answer', 'साइन अप हुआ — उनके जवाब का इंतज़ार'],
    confirmed: ['Confirmed your referral', 'आपके रेफ़रल की पुष्टि की'], declined: ['Said you did not refer them', 'कहा आपने नहीं बताया'],
    expired: ['Reservation ended', 'रिज़र्वेशन खत्म'], released: ['Released', 'छोड़ दिया'],
  }
  const left = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
  return (<>
    <div className="card space-y-3" id="leads">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-bold text-navy-700">{tx('Reserved doctors', 'रिज़र्व डॉक्टर')}</h2>
        {d && <span className="text-xs text-gray-500">{tx(`${d.open} of ${d.cap >= 100000 ? 'no limit' : d.cap}`, `${d.cap >= 100000 ? 'कोई सीमा नहीं' : d.cap} में से ${d.open}`)}</span>}
      </div>
      <p className="text-sm text-gray-600">{tx(`Add a doctor you are talking to. Their number is kept for you for ${days} days. Nothing is sent to them — when they sign up, the app asks them whether you introduced Sehatsandhi.`,
        `जिस डॉक्टर से आप बात कर रहे हैं, उन्हें जोड़ें। उनका नंबर ${days} दिन आपके नाम रहेगा। उन्हें कुछ नहीं भेजा जाता — साइन अप करते समय ऐप उनसे पूछता है कि क्या आपने बताया।`)}</p>
      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
        <input className="input-field" placeholder={tx("Doctor's name", 'डॉक्टर का नाम')} value={name} onChange={e => setName(e.target.value)} />
        <input className="input-field" inputMode="tel" placeholder={tx('Mobile number', 'मोबाइल नंबर')} value={phone} onChange={e => setPhone(e.target.value)} />
        <button disabled={busy || name.trim().length < 3 || phone.replace(/\D/g, '').length < 10} onClick={add} className="btn-teal py-2.5 px-5 disabled:opacity-50">{tx('Reserve', 'रिज़र्व करें')}</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {d && d.leads.length > 0 && (
        <ul className="divide-y divide-gray-100 text-sm">
          {d.leads.map(l => (
            <li key={l.id} className="py-2 flex items-center justify-between gap-2 flex-wrap">
              <span>
                <span className="font-semibold text-gray-800">{l.doctor_name ?? tx('(ended)', '(समाप्त)')}</span>
                {l.phone_last2 && <span className="text-gray-400"> · ••••••••{l.phone_last2}</span>}
                {l.business_name && <span className="text-gray-500"> · {l.business_name}</span>}
                <span className="block text-xs text-gray-500">{tx(...(LABEL[l.status] ?? [l.status, l.status]))}{l.status === 'locked' ? ` · ${tx(`${left(l.locked_until)} days left`, `${left(l.locked_until)} दिन बाकी`)}` : ''}</span>
              </span>
              {l.status === 'locked' && <button className="text-xs text-gray-500 underline" onClick={async () => { await releaseLead(l.id).catch(() => undefined); load() }}>{tx('Release', 'छोड़ें')}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
    {d && d.businesses.length > 0 && (
      <div className="card text-sm">
        <h2 className="font-bold text-navy-700 mb-2">{tx('Businesses you introduced', 'आपके जोड़े व्यवसाय')}</h2>
        <ul className="divide-y divide-gray-100">
          {d.businesses.map((b, i) => (
            <li key={i} className="py-2 flex justify-between gap-2"><span>{b.name}{b.city ? `, ${b.city}` : ''}</span>
              <span className={`text-xs ${b.paying ? 'text-teal-700' : 'text-gray-500'}`}>{b.paying ? tx('Paying', 'भुगतान कर रहे') : tx('Not paying yet', 'अभी भुगतान नहीं')}</span></li>
          ))}
        </ul>
      </div>
    )}
  </>)
}

// ── Partner Rewards, PAN and bank, statements (0335) ────────────────────────
const inr = (n: number | null | undefined) => `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function Money() {
  const { tx } = useTx()
  const [m, setM] = useState<MyMoney | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { myMoney().then(setM, e => setErr((e as Error).message)) }, [])
  useEffect(() => { load() }, [load])
  if (err) return <p className="text-sm text-red-600">{err}</p>
  if (!m) return null
  const LEVEL: Record<string, [string, string]> = { associate: ['Associate', 'एसोसिएट'], senior: ['Senior', 'सीनियर'], elite: ['Elite', 'एलीट'] }
  const STATUS: Record<string, [string, string]> = { pending: ['Waiting (refund window)', 'इंतज़ार (रिफ़ंड अवधि)'], approved: ['Approved', 'मंज़ूर'], paid: ['Paid', 'भुगतान हुआ'], reversed: ['Reversed (refund)', 'वापस (रिफ़ंड)'] }
  const TYPE: Record<string, [string, string]> = { start: ['Start Reward', 'स्टार्ट रिवॉर्ड'], renewal: ['Renewal Reward', 'रिन्यूअल रिवॉर्ड'], clawback: ['Taken back (refund)', 'वापस लिया (रिफ़ंड)'] }
  return (<>
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-bold text-navy-700">{tx('Partner Rewards', 'पार्टनर रिवॉर्ड')}</h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-800">{tx('Level', 'लेवल')}: {tx(...LEVEL[m.level])}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {([['pending', 'Waiting', 'इंतज़ार'], ['approved', 'Approved', 'मंज़ूर'], ['paid', 'Paid', 'भुगतान']] as const).map(([k, en, hi]) => (
          <div key={k} className="bg-gray-50 rounded-xl p-2"><div className="text-xs text-gray-500">{tx(en, hi)}</div><div className="font-bold text-navy-700">{inr(m.totals[k])}</div></div>
        ))}
      </div>
      <p className="text-xs text-gray-500">{tx(`Paid monthly. A business that pays on or before the 15th is in that month's payout; after the 15th, in the next month's. Each reward is approved 15 days after the payment, and paid once your PAN and bank are verified and the total is at least ${inr(m.min_payout)}. Tax (TDS) is deducted where the law requires.`,
        `हर महीने भुगतान। जो व्यवसाय 15 तारीख तक भुगतान करता है, वह उसी महीने के भुगतान में; 15 के बाद, अगले महीने में। हर रिवॉर्ड भुगतान के 15 दिन बाद मंज़ूर होता है, और PAN व बैंक जाँचे जाने तथा कुल कम से कम ${inr(m.min_payout)} होने पर दिया जाता है। जहाँ कानून कहता है, टैक्स (TDS) काटा जाता है।`)}</p>
      {m.rewards.length > 0 && (
        <ul className="divide-y divide-gray-100 text-sm">
          {m.rewards.map(r => (
            <li key={r.id} className="py-2 flex justify-between gap-2">
              <span><span className="font-semibold text-gray-800">{r.business ?? '—'}</span><span className="block text-xs text-gray-500">{tx(...TYPE[r.type])} · {r.rate}% {tx('of', 'का')} {inr(r.base)} · {tx(...(STATUS[r.status] ?? [r.status, r.status]))}{r.payout_month && r.status !== 'paid' && r.status !== 'reversed' ? ` · ${tx('in the', '')} ${new Date(r.payout_month + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} ${tx('payout', 'के भुगतान में')}` : ''}{r.note ? ` · ${r.note}` : ''}</span></span>
              <span className={`font-semibold ${r.amount < 0 ? 'text-red-700' : 'text-navy-700'}`}>{inr(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
    <Kyc m={m} onSaved={load} />
    {m.statements.length > 0 && (
      <div className="card text-sm">
        <h2 className="font-bold text-navy-700 mb-2">{tx('Payout statements', 'भुगतान स्टेटमेंट')}</h2>
        <ul className="divide-y divide-gray-100">
          {m.statements.map(st => (
            <li key={st.month} className="py-2 flex justify-between gap-2 flex-wrap">
              <span>{new Date(st.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}<span className="block text-xs text-gray-500">{tx('Total', 'कुल')} {inr(st.gross)} · TDS {inr(st.tds)} · {tx('you get', 'आपको')} {inr(st.net)}</span></span>
              <span className={`text-xs ${st.status === 'paid' ? 'text-teal-700' : 'text-amber-700'}`}>{st.status === 'paid' ? `${tx('Paid', 'भुगतान')} ${st.paid_on ? day(st.paid_on) : ''}${st.reference ? ` · ${st.reference}` : ''}` : tx('Being paid', 'भुगतान हो रहा है')}</span>
            </li>
          ))}
        </ul>
      </div>
    )}
  </>)
}

function Kyc({ m, onSaved }: { m: MyMoney; onSaved: () => void }) {
  const { tx } = useTx()
  const [f, setF] = useState({ pan: '', account: '', account2: '', ifsc: '', holder: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (m.kyc_status === 'verified' || m.kyc_status === 'submitted') {
    return (
      <div className="card text-sm text-gray-700">
        <span className="font-semibold text-navy-700">{tx('PAN and bank', 'PAN और बैंक')}: </span>
        PAN ••••••{m.pan_last4} · {tx('account', 'खाता')} ••••{m.bank_last4} · {m.kyc_status === 'verified' ? <span className="text-teal-700">{tx('verified', 'जाँचा गया')}</span> : <span className="text-amber-700">{tx('being checked', 'जाँच हो रही है')}</span>}
        <p className="text-xs text-gray-500 mt-1">{tx('To change them, open a ticket.', 'बदलने के लिए टिकट खोलें।')}</p>
      </div>
    )
  }
  const save = async () => {
    setErr('')
    if (f.account.replace(/\s/g, '') !== f.account2.replace(/\s/g, '')) { setErr(tx('The two account numbers do not match.', 'दोनों खाता नंबर मेल नहीं खाते।')); return }
    setBusy(true)
    try { await submitKyc(f.pan, f.account, f.ifsc, f.holder); onSaved() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const field = (k: keyof typeof f, en: string, hi: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="text-sm text-gray-700 block">{tx(en, hi)}<input className="input-field mt-1" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} {...extra} /></label>
  )
  return (
    <div className="card space-y-3">
      <h2 className="font-bold text-navy-700">{tx('PAN and bank account (for payouts)', 'PAN और बैंक खाता (भुगतान के लिए)')}</h2>
      {m.kyc_status === 'rejected' && m.status_reason && <p className="text-sm text-red-700">{m.status_reason}</p>}
      <p className="text-xs text-gray-500">{tx('Your own PAN and your own bank account; the names must match. We keep them encrypted and show only the last 4 digits. We never ask for Aadhaar.',
        'आपका अपना PAN और अपना बैंक खाता; नाम मेल खाने चाहिए। हम इन्हें एन्क्रिप्ट करके रखते हैं और सिर्फ़ आख़िरी 4 अंक दिखाते हैं। हम कभी आधार नहीं माँगते।')}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {field('pan', 'PAN', 'PAN', { maxLength: 10, style: { textTransform: 'uppercase' }, autoComplete: 'off' })}
        {field('holder', 'Name on the bank account', 'बैंक खाते पर नाम', { autoComplete: 'off' })}
        {field('account', 'Account number', 'खाता नंबर', { inputMode: 'numeric', autoComplete: 'off' })}
        {field('account2', 'Account number again', 'खाता नंबर फिर से', { inputMode: 'numeric', autoComplete: 'off' })}
        {field('ifsc', 'IFSC code', 'IFSC कोड', { maxLength: 11, style: { textTransform: 'uppercase' }, autoComplete: 'off' })}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button disabled={busy} onClick={save} className="btn-teal py-2.5 px-5 w-fit">{busy ? tx('Saving…', 'सेव हो रहा है…') : tx('Submit for checking', 'जाँच के लिए भेजें')}</button>
    </div>
  )
}
