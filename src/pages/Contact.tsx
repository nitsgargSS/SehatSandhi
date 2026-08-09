import { MessageCircle, Mail, MapPin, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'
import { WA_NUMBER } from '../types'
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

/** Digits to the display form: 917015399355 → +91 70153 99355. */
const prettyPhone = (digits: string) =>
  /^91\d{10}$/.test(digits)
    ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
    : `+${digits}`

const ADDRESS = '1743 Vishnu Garden, Jagadhri – 135003, Haryana, India'
const EMAIL = 'hello@sehatsandhi.com'
const GSTIN = '06AELPG4279G1ZD'

/** `refund` marks the one item whose sentence ends in a link to /refund. */
type Copy = {
  title: string; subtitle: string
  waTitle: string; waDesc: string; waCta: string
  mailTitle: string; mailDesc: string
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
    mailTitle: 'Email',
    mailDesc: 'For billing questions, refund requests, or anything that needs a paper trail.',
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
