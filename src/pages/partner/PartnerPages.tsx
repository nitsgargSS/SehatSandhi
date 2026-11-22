import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import PartnerShell, { ClosedNote, usePartnerMe, useTx } from './PartnerShell'
import { careMe, careSettings, registerPartner, requestPartnerCode, usePartnerProgramEnabled, verifyPartnerCode } from '../../lib/careApi'

// Public and sign-up pages of the Care Partner Program (0331):
//   /partner               what the program is, the fee disclosed up front
//   /partner/how-it-works  five steps and a glossary
//   /partner/login         WhatsApp code
//   /partner/register      details and eligibility
// No income figures anywhere (brief §1): how rewards work, never what anyone earns.

const STEPS = [
  { en: 'Learn', hi: 'सीखें', den: 'Watch short videos and read the PDFs for each module. Free.', dhi: 'हर मॉड्यूल के छोटे वीडियो देखें और PDF पढ़ें। मुफ़्त।' },
  { en: 'Pass the exam', hi: 'परीक्षा पास करें', den: 'A short quiz after each module, then a final exam. Free.', dhi: 'हर मॉड्यूल के बाद छोटा क्विज़, फिर फ़ाइनल परीक्षा। मुफ़्त।' },
  { en: 'Get certified', hi: 'सर्टिफ़िकेट पाएँ', den: 'Pay the one-time certification fee and get your Partner ID and badge.', dhi: 'एक बार की सर्टिफ़िकेशन फ़ीस दें और अपना Partner ID और बैज पाएँ।' },
  { en: 'Introduce businesses', hi: 'व्यवसायों को जोड़ें', den: 'Tell doctors, clinics, hospitals, labs and pharmacies about Sehatsandhi. They pay Sehatsandhi directly.', dhi: 'डॉक्टरों, क्लिनिक, अस्पताल, लैब और फ़ार्मेसी को सेहतसंधि के बारे में बताएँ। वे सीधे सेहतसंधि को भुगतान करते हैं।' },
  { en: 'Partner Rewards', hi: 'पार्टनर रिवॉर्ड', den: 'When a business you introduced pays for a 12-month plan, you receive a Start Reward, and a Renewal Reward when it renews.', dhi: 'जब आपका जोड़ा हुआ व्यवसाय 12 महीने का प्लान लेता है, तो आपको स्टार्ट रिवॉर्ड मिलता है, और रिन्यू करने पर रिन्यूअल रिवॉर्ड।' },
]

function FeeLine() {
  const { tx } = useTx()
  const [fee, setFee] = useState('100')
  useEffect(() => { careSettings().then(s => { if (s.cert_fee) setFee(s.cert_fee) }) }, [])
  return (
    <p className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[15px] text-amber-900">
      {tx(`Training and exam are free. After passing, there is a one-time ₹${fee} certification fee for your Partner ID and badge.`,
          `ट्रेनिंग और परीक्षा मुफ़्त हैं। पास होने के बाद Partner ID और बैज के लिए एक बार ₹${fee} की सर्टिफ़िकेशन फ़ीस है।`)}
    </p>
  )
}

export function PartnerLanding() {
  const { tx } = useTx()
  const enabled = usePartnerProgramEnabled()
  return (
    <PartnerShell title="Sehatsandhi Partner Program" titleHi="सेहतसंधि पार्टनर प्रोग्राम" banner={false}>
      {enabled === false ? <ClosedNote /> : enabled === null ? null : (<>
        <p className="text-[17px] text-gray-700 leading-relaxed">
          {tx('Become a Care Partner: learn about Sehatsandhi, get certified, and introduce it to doctors, clinics, hospitals, labs and pharmacies near you.',
              'केयर पार्टनर बनें: सेहतसंधि के बारे में सीखें, सर्टिफ़िकेट पाएँ, और अपने आस-पास के डॉक्टरों, क्लिनिक, अस्पताल, लैब और फ़ार्मेसी को इसके बारे में बताएँ।')}
        </p>
        <FeeLine />
        <ol className="card space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.en} className="flex gap-3">
              <span className="w-8 h-8 shrink-0 rounded-full bg-teal-600 text-white font-bold flex items-center justify-center">{i + 1}</span>
              <span><span className="font-semibold text-navy-700 block">{tx(s.en, s.hi)}</span><span className="text-sm text-gray-600">{tx(s.den, s.dhi)}</span></span>
            </li>
          ))}
        </ol>
        <div className="card text-sm text-gray-700 space-y-1">
          <p className="font-semibold text-navy-700">{tx('Who can join', 'कौन जुड़ सकता है')}</p>
          <p>{tx('Adults (18+) who are not registered medical practitioners — for example students, job seekers, pharma representatives and other professionals. You work independently; this is not a job.',
                 '18 साल या उससे बड़े लोग जो रजिस्टर्ड डॉक्टर नहीं हैं — जैसे छात्र, नौकरी ढूँढ रहे लोग, फ़ार्मा प्रतिनिधि और अन्य पेशेवर। आप स्वतंत्र रूप से काम करते हैं; यह नौकरी नहीं है।')}</p>
          <p>{tx('Businesses always pay Sehatsandhi directly. Partners never collect money.', 'व्यवसाय हमेशा सीधे सेहतसंधि को भुगतान करते हैं। पार्टनर कभी पैसे नहीं लेते।')}</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <Link to="/partner/login" className="btn-teal py-3 px-6 text-base">{tx('Register as a partner', 'पार्टनर के रूप में रजिस्टर करें')}</Link>
          <Link to="/partner/how-it-works" className="py-3 px-5 rounded-xl border border-gray-300 text-gray-700 font-semibold">{tx('How it works', 'यह कैसे काम करता है')}</Link>
        </div>
        <p className="text-xs text-gray-500">{tx('Questions? See Help, or write to contact@sehatsandhi.com. We do not offer phone support for the Partner Program.',
          'सवाल? Help देखें, या contact@sehatsandhi.com पर लिखें। पार्टनर प्रोग्राम के लिए फ़ोन सहायता नहीं है।')}</p>
      </>)}
    </PartnerShell>
  )
}

export function PartnerHowItWorks() {
  const { tx } = useTx()
  const GLOSSARY = [
    ['Partner ID', 'Partner ID', 'Your unique ID (like SP-4K7M2Q), issued after you pass the exam and pay the certification fee.', 'आपका अपना ID (जैसे SP-4K7M2Q), परीक्षा पास करने और सर्टिफ़िकेशन फ़ीस देने के बाद मिलता है।'],
    ['Start Reward', 'स्टार्ट रिवॉर्ड', 'On a business\'s 12-month plan payments in its first year with you.', 'आपके साथ पहले साल में किसी व्यवसाय के 12 महीने के प्लान के भुगतान पर।'],
    ['Renewal Reward', 'रिन्यूअल रिवॉर्ड', 'On that business\'s later 12-month renewals, while you stay active.', 'उसी व्यवसाय के बाद के 12 महीने के रिन्यूअल पर, जब तक आप सक्रिय हैं।'],
    ['Reserving a doctor', 'डॉक्टर को रिज़र्व करना', 'You add a doctor\'s number in your dashboard; it is kept for you for a fixed period. Nothing is sent to the doctor.', 'आप अपने डैशबोर्ड में डॉक्टर का नंबर जोड़ते हैं; यह तय समय के लिए आपके नाम रहता है। डॉक्टर को कुछ नहीं भेजा जाता।'],
    ['Confirmation', 'पुष्टि', 'When the doctor signs up, the app asks them whether you referred them.', 'डॉक्टर जब साइन अप करते हैं, ऐप उनसे पूछता है कि क्या आपने उन्हें बताया।'],
    ['KYC', 'KYC', 'Your PAN and bank details, checked before your first payout.', 'आपका PAN और बैंक विवरण, पहले भुगतान से पहले जाँचा जाता है।'],
    ['Clawback', 'वापसी', 'If a business\'s payment is refunded, the reward on it is taken back from later rewards.', 'अगर किसी व्यवसाय का भुगतान लौटाया जाता है, तो उस पर मिला रिवॉर्ड आगे के रिवॉर्ड से काट लिया जाता है।'],
  ]
  return (
    <PartnerShell title="How the Partner Program works" titleHi="पार्टनर प्रोग्राम कैसे काम करता है">
      <FeeLine />
      <ol className="card space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.en}><span className="font-semibold text-navy-700">{i + 1}. {tx(s.en, s.hi)}</span><span className="block text-sm text-gray-600">{tx(s.den, s.dhi)}</span></li>
        ))}
      </ol>
      <div className="card">
        <p className="font-semibold text-navy-700 mb-2">{tx('Words you will see', 'ये शब्द आपको दिखेंगे')}</p>
        <dl className="space-y-2 text-sm">
          {GLOSSARY.map(([en, hi, den, dhi]) => (
            <div key={en}><dt className="font-semibold text-gray-800">{tx(en, hi)}</dt><dd className="text-gray-600">{tx(den, dhi)}</dd></div>
          ))}
        </dl>
      </div>
      <div className="card text-sm text-gray-700">
        <p className="font-semibold text-navy-700 mb-1">{tx('The rules in short', 'नियम संक्षेप में')}</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>{tx('Never take cash or any payment from a business.', 'किसी व्यवसाय से कभी नकद या कोई भुगतान न लें।')}</li>
          <li>{tx('Use only your own phone. Never Sehatsandhi\'s official WhatsApp number. No bulk messages.', 'सिर्फ़ अपना फ़ोन इस्तेमाल करें। सेहतसंधि का आधिकारिक WhatsApp नंबर कभी नहीं। कोई बल्क मैसेज नहीं।')}</li>
          <li>{tx('Say only what the training teaches. Never say "government approved" or "ABDM approved". Never promise income or patients.', 'सिर्फ़ वही कहें जो ट्रेनिंग में सिखाया गया है। "सरकार से मंज़ूर" या "ABDM से मंज़ूर" कभी न कहें। कमाई या मरीज़ों का वादा कभी न करें।')}</li>
          <li>{tx('Never see, ask for or share patient data.', 'मरीज़ों का डेटा कभी न देखें, न माँगें, न साझा करें।')}</li>
          <li>{tx('There is no reward for bringing in other partners.', 'दूसरे पार्टनर जोड़ने पर कोई रिवॉर्ड नहीं है।')}</li>
        </ul>
      </div>
      <Link to="/partner/login" className="btn-teal py-3 px-6 text-base w-fit">{tx('Register as a partner', 'पार्टनर के रूप में रजिस्टर करें')}</Link>
    </PartnerShell>
  )
}

export function PartnerLogin() {
  const { tx } = useTx()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const enabled = usePartnerProgramEnabled()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [dev, setDev] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const digits = phone.replace(/\D/g, '').slice(-10)
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const after = async () => {
    const me = await careMe()
    const next = params.get('next')
    navigate(!me.registered ? '/partner/register' : next && next.startsWith('/partner') ? next : '/partner/learn', { replace: true })
  }
  // Already signed in as a partner → straight on.
  useEffect(() => { careMe().then(m => { if (m.signed_in) after() }) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PartnerShell title="Partner sign in" titleHi="पार्टनर साइन इन" banner={false}>
      {enabled === false ? <ClosedNote /> : (
        <div className="card max-w-md flex flex-col gap-3">
          <p className="text-sm text-gray-600">{tx('We send a 6-digit code to your WhatsApp. New partners register after signing in.', 'हम आपके WhatsApp पर 6 अंकों का कोड भेजेंगे। नए पार्टनर साइन इन के बाद रजिस्टर करते हैं।')}</p>
          <label className="text-sm text-gray-700">{tx('WhatsApp mobile number', 'WhatsApp मोबाइल नंबर')}
            <input className="input-field mt-1 text-lg" inputMode="tel" autoComplete="tel" value={phone} disabled={sent}
              onChange={e => setPhone(e.target.value)} placeholder="98XXXXXXXX" />
          </label>
          {!sent ? (
            <button disabled={busy || digits.length !== 10} className="btn-teal py-3 justify-center disabled:opacity-50"
              onClick={() => run(async () => { const r = await requestPartnerCode(digits); setSent(true); if (r.devCode) setDev(r.devCode) })}>
              {busy ? tx('Sending…', 'भेज रहे हैं…') : tx('Send code', 'कोड भेजें')}
            </button>
          ) : (<>
            <label className="text-sm text-gray-700">{tx('Code from WhatsApp', 'WhatsApp पर आया कोड')}
              <input className="input-field mt-1 text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
            </label>
            {dev && <p className="text-xs text-amber-700">Sandbox code: {dev}</p>}
            <button disabled={busy || code.length !== 6} className="btn-teal py-3 justify-center disabled:opacity-50"
              onClick={() => run(async () => { await verifyPartnerCode(digits, code); await after() })}>
              {busy ? tx('Checking…', 'जाँच रहे हैं…') : tx('Sign in', 'साइन इन')}
            </button>
            <button className="text-sm text-teal-700 underline w-fit" onClick={() => { setSent(false); setCode(''); setDev('') }}>{tx('Change number', 'नंबर बदलें')}</button>
          </>)}
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
      )}
    </PartnerShell>
  )
}

const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
  'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry']

export function PartnerRegister() {
  return (
    <PartnerShell title="Register as a Care Partner" titleHi="केयर पार्टनर के रूप में रजिस्टर करें" needs="login" banner={false}>
      <RegisterForm />
    </PartnerShell>
  )
}

function RegisterForm() {
  const { tx, lang } = useTx()
  const { me, reload } = usePartnerMe()
  const navigate = useNavigate()
  const [f, setF] = useState({ full_name: '', email: '', city: '', state: '', date_of_birth: '', occupation: '', language: lang as 'hi' | 'en' })
  const [isDoctor, setIsDoctor] = useState<boolean | null>(null)
  const [employerOk, setEmployerOk] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (me.registered) navigate('/partner/learn', { replace: true }) }, [me.registered, navigate])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (isDoctor === null) { setErr(tx('Please answer whether you are a registered medical practitioner.', 'कृपया बताएँ कि क्या आप रजिस्टर्ड डॉक्टर हैं।')); return }
    if (isDoctor) { setErr(tx('Registered medical practitioners cannot join the Partner Program.', 'रजिस्टर्ड डॉक्टर पार्टनर प्रोग्राम में नहीं जुड़ सकते।')); return }
    setBusy(true)
    try {
      await registerPartner({ ...f, is_doctor: false, employer_ok: employerOk, consent })
      await reload(); navigate('/partner/learn', { replace: true })
    } catch (e2) { setErr((e2 as Error).message) } finally { setBusy(false) }
  }
  const field = (k: keyof typeof f, en: string, hi: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="text-sm text-gray-700 block">{tx(en, hi)}
      <input className="input-field mt-1" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} {...extra} />
    </label>
  )
  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 max-w-xl">
      <p className="text-sm text-gray-600">{tx(`Signed in as +${me.phone}.`, `+${me.phone} से साइन इन।`)}</p>
      {field('full_name', 'Full name (as on your PAN)', 'पूरा नाम (PAN जैसा)', { required: true, autoComplete: 'name' })}
      {field('date_of_birth', 'Date of birth', 'जन्म तिथि', { type: 'date', required: true })}
      <div className="grid sm:grid-cols-2 gap-3">
        {field('city', 'City / town', 'शहर / कस्बा', { required: true })}
        <label className="text-sm text-gray-700 block">{tx('State', 'राज्य')}
          <select className="input-field mt-1" required value={f.state} onChange={e => setF({ ...f, state: e.target.value })}>
            <option value="">{tx('Choose', 'चुनें')}</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      {field('occupation', 'What do you do now? (optional)', 'अभी आप क्या करते हैं? (वैकल्पिक)')}
      {field('email', 'Email (receipts and updates are sent here)', 'ईमेल (रसीद और सूचनाएँ यहीं भेजी जाती हैं)', { type: 'email', autoComplete: 'email', required: true })}
      <label className="text-sm text-gray-700 block">{tx('Preferred language', 'पसंदीदा भाषा')}
        <select className="input-field mt-1" value={f.language} onChange={e => setF({ ...f, language: e.target.value as 'hi' | 'en' })}>
          <option value="hi">हिंदी</option><option value="en">English</option>
        </select>
      </label>
      <fieldset className="text-sm text-gray-700">
        <legend>{tx('Are you a registered medical practitioner (doctor)?', 'क्या आप रजिस्टर्ड मेडिकल प्रैक्टिशनर (डॉक्टर) हैं?')}</legend>
        <div className="flex gap-4 mt-1">
          <label className="flex items-center gap-2 min-h-[44px]"><input type="radio" name="doc" checked={isDoctor === false} onChange={() => setIsDoctor(false)} /> {tx('No', 'नहीं')}</label>
          <label className="flex items-center gap-2 min-h-[44px]"><input type="radio" name="doc" checked={isDoctor === true} onChange={() => setIsDoctor(true)} /> {tx('Yes', 'हाँ')}</label>
        </div>
        {isDoctor && <p className="text-red-600 mt-1">{tx('Doctors cannot join the Partner Program, to avoid conflicts of interest.', 'हितों के टकराव से बचने के लिए डॉक्टर पार्टनर प्रोग्राम में नहीं जुड़ सकते।')}</p>}
      </fieldset>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1 w-5 h-5" checked={employerOk} onChange={e => setEmployerOk(e.target.checked)} />
        <span>{tx('I am 18 or older, and this work does not break my employer\'s rules or any agreement I have signed.', 'मेरी उम्र 18 साल या उससे ज़्यादा है, और यह काम मेरे नियोक्ता के नियमों या मेरे किसी समझौते का उल्लंघन नहीं करता।')}</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1 w-5 h-5" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>{tx('I agree to the ', 'मैं ')}<Link to="/terms" className="underline text-teal-700">{tx('Terms', 'शर्तों')}</Link>{tx(' and the ', ' और ')}<Link to="/privacy" className="underline text-teal-700">{tx('Privacy Policy', 'प्राइवेसी पॉलिसी')}</Link>{tx(', and to Sehatsandhi keeping these details to run my partnership.', ' से सहमत हूँ, और सेहतसंधि मेरी साझेदारी चलाने के लिए ये जानकारी रख सकता है।')}</span>
      </label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button disabled={busy || !employerOk || !consent} className="btn-teal py-3 justify-center disabled:opacity-50">
        {busy ? tx('Saving…', 'सेव हो रहा है…') : tx('Register and start learning', 'रजिस्टर करें और सीखना शुरू करें')}
      </button>
    </form>
  )
}
