import { useState } from 'react'
import { MessageCircle, Mail, MapPin, Clock, Phone, Send, CheckCircle2 } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'
import { WA_NUMBER, CALL_NUMBER, prettyPhone } from '../types'
import { activeConfig } from '../lib/env'
import SiteHeader from '../components/SiteHeader'
import SiteFooter, { SOCIALS } from '../components/SiteFooter'

// A contact page with an address on it, because the footer alone is not what
// gets checked.
//
// The contact details were already in SiteFooter and on an About page card, and
// that satisfies most of what Meta looks for. Razorpay's merchant checklist
// names "Contact Us" as a page of its own, though, and a reviewer following
// that list looks for the URL rather than for the information. So this exists
// to be that URL — and it says more than the footer strip can: which channel is
// for what, how long a reply takes, and the registered entity in full.
//
// The address and GSTIN are the ones on the GST certificate, character for
// character, because a reviewer is comparing the two documents side by side.

const ADDRESS = '1743 Vishnu Garden, Jagadhri – 135003, Haryana, India'
const EMAIL = 'contact@sehatsandhi.com'
const GSTIN = '06AELPG4279G1ZD'

/** `refund` marks the one item whose sentence ends in a link to /refund. */
type Copy = {
  title: string; subtitle: string
  waTitle: string; waDesc: string; waCta: string; waOnly: string
  callTitle: string; callDesc: string
  mailTitle: string; mailDesc: string
  form: {
    title: string; desc: string; name: string; phone: string; email: string; topic: string
    message: string; messagePh: string; send: string; sending: string; needContact: string
    sentTitle: string; sentDesc: string; another: string; failed: string
    topics: { v: string; l: string }[]
  }
  hoursTitle: string; hoursDesc: string
  addressTitle: string; addressDesc: string
  socialTitle: string; socialDesc: string
  forTitle: string
  forItems: { h: string; p: string; refund?: boolean }[]
  legalTitle: string; legalName: string; tradeName: string
  gstin: string; registeredAddress: string; refundLink: string
}

const content: Record<'en' | 'hi', Copy> = {
  en: {
    title: 'Contact Us',
    subtitle: "We're a small team, and a person reads every message.",
    waTitle: 'WhatsApp',
    waDesc: 'The fastest way to reach us — for patients booking an appointment and for businesses alike.',
    waCta: 'Message us on WhatsApp',
    waOnly: 'WhatsApp messages only — this number does not take calls.',
    callTitle: 'Call us',
    callDesc: 'To speak to someone — Monday to Saturday, 9:00 AM to 7:00 PM IST.',
    mailTitle: 'Email',
    mailDesc: 'For billing questions, refund requests, or anything that needs a paper trail.',
    form: {
      title: 'Send us a message',
      desc: 'Fill this in and it reaches our team straight away. We reply by phone or email.',
      name: 'Your name', phone: 'Mobile number', email: 'Email (optional)', topic: 'What is it about?',
      message: 'Your message', messagePh: 'Tell us how we can help…',
      send: 'Send message', sending: 'Sending…',
      needContact: 'Please give a mobile number or an email so we can reply.',
      sentTitle: 'Thank you — we have your message.',
      sentDesc: 'Someone from our team will get back to you, usually within one working day.',
      another: 'Send another message',
      failed: 'We could not send your message just now. Please try again, or message us on WhatsApp.',
      topics: [
        { v: 'booking', l: 'Booking an appointment' },
        { v: 'listing', l: 'Listing my clinic or business' },
        { v: 'partner', l: 'Pharmacy, insurance or ambulance partnership' },
        { v: 'billing', l: 'Billing, refund or cancellation' },
        { v: 'listing_change', l: 'Correcting or removing a listing' },
        { v: 'other', l: 'Something else' },
      ],
    },
    hoursTitle: 'When we reply',
    hoursDesc: 'Monday to Saturday, 9:00 AM to 7:00 PM IST. We aim to answer WhatsApp messages the same day, and email within 2 business days.',
    addressTitle: 'Registered office',
    addressDesc: 'Correspondence address and registered principal place of business.',
    socialTitle: 'Find us elsewhere',
    socialDesc: 'These are our only official accounts. We never ask for payment or personal details over social media.',
    forTitle: 'What to contact us about',
    forItems: [
      {
        h: 'Booking an appointment',
        p: 'Message us on WhatsApp. Sehatsandhi is completely free for patients — we never ask a patient for payment.',
      },
      {
        h: 'Listing your clinic or business',
        p: 'Message us on WhatsApp and we can register you over a call in Hindi, or register yourself from the business page.',
      },
      {
        h: 'Billing, refunds and cancellations',
        p: 'Email us with your registered phone number and we will pick it up from there. The terms are set out in our',
        refund: true,
      },
      {
        h: 'Correcting or removing your listing',
        p: 'Message us from the number your listing is registered to, and tell us what needs to change.',
      },
    ],
    legalTitle: 'Business details',
    legalName: 'Legal name',
    tradeName: 'Trade name',
    gstin: 'GSTIN',
    registeredAddress: 'Registered address',
    refundLink: 'Refund & Cancellation Policy',
  },
  hi: {
    title: 'संपर्क करें',
    subtitle: 'हम एक छोटी टीम हैं, और हर मैसेज एक इंसान पढ़ता है।',
    waTitle: 'WhatsApp',
    waDesc: 'हम तक पहुंचने का सबसे तेज़ तरीका — अपॉइंटमेंट बुक करने वाले मरीज़ों और बिज़नेस, दोनों के लिए।',
    waCta: 'WhatsApp पर मैसेज करें',
    waOnly: 'सिर्फ़ WhatsApp मैसेज — इस नंबर पर कॉल नहीं लगती।',
    callTitle: 'कॉल करें',
    callDesc: 'किसी से बात करने के लिए — सोमवार से शनिवार, सुबह 9:00 से शाम 7:00 बजे तक (IST)।',
    form: {
      title: 'हमें मैसेज भेजें',
      desc: 'यह फ़ॉर्म भरें, आपका मैसेज तुरंत हमारी टीम तक पहुंच जाएगा। हम फ़ोन या ईमेल पर जवाब देंगे।',
      name: 'आपका नाम', phone: 'मोबाइल नंबर', email: 'ईमेल (वैकल्पिक)', topic: 'किस बारे में?',
      message: 'आपका मैसेज', messagePh: 'बताइए हम कैसे मदद कर सकते हैं…',
      send: 'मैसेज भेजें', sending: 'भेजा जा रहा है…',
      needContact: 'कृपया मोबाइल नंबर या ईमेल दें ताकि हम जवाब दे सकें।',
      sentTitle: 'धन्यवाद — आपका मैसेज हमें मिल गया है।',
      sentDesc: 'हमारी टीम से कोई आपसे संपर्क करेगा, आमतौर पर एक कामकाजी दिन के अंदर।',
      another: 'एक और मैसेज भेजें',
      failed: 'अभी आपका मैसेज नहीं भेजा जा सका। कृपया दोबारा कोशिश करें, या WhatsApp पर मैसेज करें।',
      topics: [
        { v: 'booking', l: 'अपॉइंटमेंट बुक करना' },
        { v: 'listing', l: 'अपनी क्लिनिक या बिज़नेस लिस्ट करना' },
        { v: 'partner', l: 'फ़ार्मेसी, इंश्योरेंस या एम्बुलेंस पार्टनरशिप' },
        { v: 'billing', l: 'बिलिंग, रिफंड या कैंसिलेशन' },
        { v: 'listing_change', l: 'लिस्टिंग ठीक कराना या हटवाना' },
        { v: 'other', l: 'कुछ और' },
      ],
    },
    mailTitle: 'ईमेल',
    mailDesc: 'बिलिंग के सवाल, रिफंड रिक्वेस्ट, या कोई भी बात जिसका लिखित रिकॉर्ड चाहिए।',
    hoursTitle: 'हम कब जवाब देते हैं',
    hoursDesc: 'सोमवार से शनिवार, सुबह 9:00 से शाम 7:00 बजे तक (IST)। WhatsApp मैसेज का जवाब हम उसी दिन देने की कोशिश करते हैं, और ईमेल का 2 बिज़नेस दिनों के अंदर।',
    addressTitle: 'रजिस्टर्ड ऑफिस',
    addressDesc: 'पत्राचार का पता और रजिस्टर्ड प्रिंसिपल प्लेस ऑफ बिज़नेस।',
    socialTitle: 'हमें यहां भी पाएं',
    socialDesc: 'यही हमारे एकमात्र आधिकारिक अकाउंट हैं। हम सोशल मीडिया पर कभी पेमेंट या निजी जानकारी नहीं मांगते।',
    forTitle: 'किस बारे में संपर्क करें',
    forItems: [
      {
        h: 'अपॉइंटमेंट बुक करना',
        p: 'हमें WhatsApp पर मैसेज करें। Sehatsandhi मरीज़ों के लिए बिल्कुल फ्री है — हम कभी किसी मरीज़ से पेमेंट नहीं मांगते।',
      },
      {
        h: 'अपनी क्लिनिक या बिज़नेस लिस्ट करना',
        p: 'हमें WhatsApp पर मैसेज करें, हम आपको हिंदी में कॉल पर रजिस्टर कर सकते हैं — या बिज़नेस पेज से खुद रजिस्टर करें।',
      },
      {
        h: 'बिलिंग, रिफंड और कैंसिलेशन',
        p: 'अपने रजिस्टर्ड फ़ोन नंबर के साथ हमें ईमेल करें, आगे हम संभाल लेंगे। शर्तें यहां दी गई हैं:',
        refund: true,
      },
      {
        h: 'अपनी लिस्टिंग ठीक कराना या हटवाना',
        p: 'जिस नंबर पर आपकी लिस्टिंग रजिस्टर्ड है, उसी से मैसेज करें और बताएं कि क्या बदलना है।',
      },
    ],
    legalTitle: 'बिज़नेस डिटेल्स',
    legalName: 'लीगल नाम',
    tradeName: 'ट्रेड नाम',
    gstin: 'GSTIN',
    registeredAddress: 'रजिस्टर्ड पता',
    refundLink: 'रिफंड और कैंसिलेशन पॉलिसी',
  },
}

export default function Contact() {
  const { lang } = useLanguage()
  const c = content[lang]
  const wa = `https://wa.me/${WA_NUMBER}`

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <SiteHeader />

      <div className="w-full max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold text-navy-700 mb-1">{c.title}</h1>
        <p className="text-gray-500 mb-8">{c.subtitle}</p>

        {/* The two channels first, each one actionable where it is described —
            a contact page whose phone number is not a link is a screenshot. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div className="card">
            <MessageCircle className="w-6 h-6 text-teal-500 mb-2" />
            <p className="font-bold text-navy-700 text-sm mb-1">{c.waTitle}</p>
            <p className="text-gray-500 text-xs leading-relaxed mb-3">{c.waDesc}</p>
            <a href={wa} target="_blank" rel="noreferrer"
               className="text-teal-600 font-semibold text-sm hover:underline">
              {prettyPhone(WA_NUMBER)}
            </a>
            <p className="text-gray-400 text-xs mt-1">{c.waOnly}</p>
          </div>

          <div className="card">
            <Phone className="w-6 h-6 text-teal-500 mb-2" />
            <p className="font-bold text-navy-700 text-sm mb-1">{c.callTitle}</p>
            <p className="text-gray-500 text-xs leading-relaxed mb-3">{c.callDesc}</p>
            <a href={`tel:+${CALL_NUMBER}`} className="text-teal-600 font-semibold text-sm hover:underline">
              {prettyPhone(CALL_NUMBER)}
            </a>
          </div>

          <div className="card">
            <Mail className="w-6 h-6 text-teal-500 mb-2" />
            <p className="font-bold text-navy-700 text-sm mb-1">{c.mailTitle}</p>
            <p className="text-gray-500 text-xs leading-relaxed mb-3">{c.mailDesc}</p>
            <a href={`mailto:${EMAIL}`} className="text-teal-600 font-semibold text-sm hover:underline break-all">
              {EMAIL}
            </a>
          </div>

          <div className="card">
            <MapPin className="w-6 h-6 text-teal-500 mb-2" />
            <p className="font-bold text-navy-700 text-sm mb-1">{c.addressTitle}</p>
            <p className="text-gray-500 text-xs leading-relaxed mb-3">{c.addressDesc}</p>
            {/* English in both languages: this is how it reads on the GST
                certificate, and the two are meant to match exactly. */}
            <p className="text-navy-700 text-sm font-medium leading-relaxed">{ADDRESS}</p>
          </div>

          <div className="card">
            <Clock className="w-6 h-6 text-teal-500 mb-2" />
            <p className="font-bold text-navy-700 text-sm mb-1">{c.hoursTitle}</p>
            <p className="text-gray-500 text-xs leading-relaxed">{c.hoursDesc}</p>
          </div>
        </div>

        <ContactForm c={c.form} lang={lang} />

        <div className="bg-navy-700 rounded-2xl p-6 text-white text-center mb-10">
          <a href={wa} target="_blank" rel="noreferrer"
             className="bg-white text-navy-700 font-semibold px-6 py-2.5 rounded-full text-sm hover:bg-gray-50 transition inline-block">
            {c.waCta}
          </a>
        </div>

        {/* Named, not just iconned — the footer's glyph row says "we have a
            Facebook"; a reviewer opening the contact page wants to see which
            account, and a patient wants to know an impostor from us. The rows
            take p-4 over .card's p-6: two short lines do not need the padding
            the taller cards above do. */}
        <h2 className="text-xl font-bold text-navy-700 mb-2">{c.socialTitle}</h2>
        <p className="text-gray-500 text-sm mb-4">{c.socialDesc}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
          {SOCIALS.map(({ href, label, handle, Icon }) => (
            <a key={label} href={href} target="_blank" rel="noreferrer"
               className="card p-4 flex items-center gap-3 hover:border-teal-200 transition">
              <Icon className="w-5 h-5 text-teal-500 flex-none" aria-hidden />
              <span className="min-w-0">
                <span className="block font-bold text-navy-700 text-sm">{label}</span>
                <span className="block text-gray-500 text-xs truncate">{handle}</span>
              </span>
            </a>
          ))}
        </div>

        <h2 className="text-xl font-bold text-navy-700 mb-4">{c.forTitle}</h2>
        <div className="space-y-5 mb-10">
          {c.forItems.map(item => (
            <div key={item.h}>
              <h3 className="font-bold text-navy-700 text-sm mb-1">{item.h}</h3>
              <p className="text-gray-600 text-sm leading-relaxed">
                {item.p}
                {item.refund && (
                  <>
                    {' '}
                    <Link to="/refund" className="text-teal-600 hover:underline font-medium">
                      {c.refundLink}
                    </Link>
                    {/* The link ends the sentence, so the stop lives out here —
                        and Hindi ends a sentence with a danda, not a full stop. */}
                    {lang === 'hi' ? '।' : '.'}
                  </>
                )}
              </p>
            </div>
          ))}
        </div>

        {/* The entity itself, laid out as rows rather than prose so a reviewer
            comparing this against the GST certificate can read down one column. */}
        <h2 className="text-xl font-bold text-navy-700 mb-4">{c.legalTitle}</h2>
        <div className="bg-gray-100 rounded-lg divide-y divide-gray-200 text-sm">
          <Row label={c.legalName} value="NG Technologies" />
          <Row label={c.tradeName} value="Sehatsandhi (सेहतसंधि)" />
          <Row label={c.gstin} value={GSTIN} mono />
          <Row label={c.registeredAddress} value={ADDRESS} />
        </div>
      </div>

      <SiteFooter />
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1 sm:gap-6 px-4 py-3">
      <span className="text-gray-500 flex-none">{label}</span>
      <span className={`text-navy-700 font-medium sm:text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// The form (0165). Posts to the contact-submit edge function, which keeps the
// inquiry and emails it to contact@sehatsandhi.com. The mailto: link above does
// nothing without a mail app, so this is the way in that always works.
function ContactForm({ c, lang }: { c: Copy['form']; lang: string }) {
  const { pathname } = useLocation()
  const [f, setF] = useState({ name: '', phone: '', email: '', topic: 'booking', message: '', website: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(x => ({ ...x, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!f.phone.trim() && !f.email.trim()) { setErr(c.needContact); return }
    setBusy(true)
    try {
      const { url, anon } = activeConfig()
      const res = await fetch(`${url}/functions/v1/contact-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
        body: JSON.stringify({ ...f, page: pathname, lang }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error || c.failed)
      setSent(true)
      setF(x => ({ ...x, message: '' }))
    } catch (e2) {
      setErr((e2 as Error).message || c.failed)
    } finally { setBusy(false) }
  }

  if (sent) {
    return (
      <div className="card mb-4 text-center">
        <CheckCircle2 className="w-8 h-8 text-teal-500 mx-auto mb-2" />
        <p className="font-bold text-navy-700">{c.sentTitle}</p>
        <p className="text-gray-500 text-sm mt-1">{c.sentDesc}</p>
        <button onClick={() => setSent(false)} className="text-teal-600 font-semibold text-sm mt-4 hover:underline">{c.another}</button>
      </div>
    )
  }

  const label = 'block text-xs font-semibold text-gray-600 mb-1'
  return (
    <form onSubmit={submit} className="card mb-4 space-y-3" noValidate>
      <div>
        <h2 className="font-bold text-navy-700">{c.title}</h2>
        <p className="text-gray-500 text-xs mt-1">{c.desc}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block"><span className={label}>{c.name} *</span>
          <input className="input-field" value={f.name} onChange={set('name')} required maxLength={100} autoComplete="name" /></label>
        <label className="block"><span className={label}>{c.phone}</span>
          <input className="input-field" value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={15} autoComplete="tel" placeholder="98765 43210" /></label>
        <label className="block"><span className={label}>{c.email}</span>
          <input className="input-field" type="email" value={f.email} onChange={set('email')} maxLength={200} autoComplete="email" /></label>
        <label className="block"><span className={label}>{c.topic}</span>
          <select className="input-field" value={f.topic} onChange={set('topic')}>
            {c.topics.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select></label>
      </div>
      <label className="block"><span className={label}>{c.message} *</span>
        <textarea className="input-field" rows={4} value={f.message} onChange={set('message')} required maxLength={3000} placeholder={c.messagePh} /></label>
      {/* Honeypot: hidden from people, filled in by bots. */}
      <input type="text" name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off"
        aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button type="submit" disabled={busy || f.name.trim().length < 2 || f.message.trim().length < 5}
        className="btn-teal text-sm disabled:opacity-50">
        <Send className="w-4 h-4" /> {busy ? c.sending : c.send}
      </button>
    </form>
  )
}
