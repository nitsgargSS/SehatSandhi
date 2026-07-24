import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import { SPECIALITIES, WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'
import type { Lang } from '../i18n/translations'
import OfferBanner from '../components/OfferBanner'

const SPEC_ICONS: Record<string, string> = {
  GEN:'🏥', SKIN:'🌿', DENT:'🦷', EYE:'👁️', PAED:'👶',
  GYN:'🌸', IVF:'🍀', ORTH:'🦴', CARD:'❤️', ENT:'👂',
  GAST:'🫁', NEUR:'🧠', URO:'🫘', ONC:'🎗️', PSY:'🧘',
  DIAB:'💉', PHYS:'💪', ALT:'🌱', LAB:'🔬', PHRM:'💊'
}

const FAQS_BY_LANG: Record<Lang, { q: string; a: string }[]> = {
  hi: [
    { q: 'Kya patient ke liye free hai?', a: 'Haan, bilkul free. Patients ko koi charge nahi lagta. WhatsApp par message karein aur appointment book karein.' },
    { q: 'Doctors kaise listed hote hain?', a: 'Doctors registration karte hain, apni speciality aur area batate hain — hamari team verify karke listing activate karti hai.' },
    { q: 'Appointment kaise book hoti hai?', a: 'WhatsApp par message karein → speciality choose karein → doctor select karein → slot confirm karein. Sirf 2-3 minute lagte hain.' },
    { q: 'Kya app download karni padegi?', a: 'Nahi! Sirf WhatsApp chahiye jo aapke phone mein pehle se hai. Koi nayi app install karne ki zaroorat nahi.' },
    { q: 'Doctor ki verification hoti hai?', a: 'Haan, hamare team har doctor ka MCI/NMC registration number verify karti hai. Tab hi listing activate hoti hai.' },
  ],
  en: [
    { q: 'Is this free for patients?', a: 'Yes, completely free. Patients are never charged. Just message us on WhatsApp and book an appointment.' },
    { q: 'How are doctors listed?', a: 'Doctors register and share their speciality and area — our team verifies them before the listing goes live.' },
    { q: 'How does booking work?', a: 'Message us on WhatsApp → choose your speciality → select a doctor → confirm your slot. It takes just 2-3 minutes.' },
    { q: 'Do I need to download an app?', a: 'No! You just need WhatsApp, which is already on your phone. No new app to install.' },
    { q: 'Are doctors verified?', a: 'Yes, our team verifies every doctor\'s MCI/NMC registration number before their listing is activated.' },
  ],
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-gray-100 py-4">
      <button onClick={() => setOpen(!open)} className="w-full flex justify-between items-center text-left gap-4">
        <span className="font-medium text-gray-800 text-sm sm:text-base">{q}</span>
        {open ? <ChevronUp className="text-teal-600 shrink-0 w-5 h-5" /> : <ChevronDown className="text-gray-400 shrink-0 w-5 h-5" />}
      </button>
      {open && <p className="mt-3 text-gray-500 text-sm leading-relaxed">{a}</p>}
    </div>
  )
}

export default function Landing() {
  const { t, lang } = useLanguage()
  const faqs = FAQS_BY_LANG[lang]

  return (
    <div className="pt-16">
      <OfferBanner />

      {/* ── HERO ── */}
      <section className="min-h-[90vh] flex items-center bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
          <div>
            <span className="inline-flex items-center gap-2 bg-teal-50 text-teal-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 border border-teal-100">
              {t('landing.heroBadge')}
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-navy-700 leading-tight mb-4">
              {t('landing.heroTitleLine1')}<br />{t('landing.heroTitleLine2')}
            </h1>
            <p className="text-xl text-teal-600 font-medium mb-4">{t('landing.heroSubtitle')}</p>
            <p className="text-gray-500 text-base sm:text-lg mb-8 leading-relaxed max-w-lg">
              {t('landing.heroDescription')}
            </p>
            <div className="flex flex-wrap gap-4">
              <a href={`https://wa.me/${WA_NUMBER}?text=Namaste%20Sehatsandhi!`}
                 target="_blank" rel="noreferrer" className="btn-teal text-base px-8 py-4 shadow-lg shadow-teal-100">
                {t('landing.heroCtaWhatsapp')}
              </a>
              <Link to="/doctor" className="btn-navy text-base px-8 py-4">
                {t('landing.heroCtaDoctor')}
              </Link>
            </div>
            <p className="text-gray-400 text-xs mt-5">{t('landing.heroFootnote')}</p>
          </div>
          <div className="hidden lg:flex justify-center">
            <div className="w-72 bg-white rounded-3xl shadow-2xl border border-gray-100 p-5 space-y-3">
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                <img src="/logo.png" alt="Sehatsandhi" className="w-10 h-10 rounded-full object-cover" />
                <div>
                  <p className="font-semibold text-sm text-gray-800">Sehatsandhi</p>
                  <p className="text-xs text-teal-500">● Online</p>
                </div>
              </div>
              <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-700 max-w-[85%]">
                {t('landing.chatWelcome')}
              </div>
              <div className="flex justify-end">
                <div className="bg-teal-500 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white max-w-[85%]">
                  {t('landing.chatUserMsg')}
                </div>
              </div>
              <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-700">
                <p className="font-medium mb-1">{t('landing.chatDoctorList')}</p>
                <p>1. Dr. Priya Sharma</p>
                <p>2. Dr. Rahul Verma</p>
                <p className="text-teal-600 mt-1 text-xs">{t('landing.chatReply')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <section className="bg-teal-600 py-4">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap justify-center gap-6 sm:gap-12">
          {[
            ['20', t('landing.trustPins')],
            ['20', t('landing.trustSpecialities')],
            [t('landing.trustLocation'), ''],
            [t('landing.trustNoApp'), ''],
          ].map(([n, l], i) => (
            <div key={i} className="text-center text-white">
              <div className="font-bold text-xl">{n}</div>
              {l && <div className="text-white/80 text-xs">{l}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="section-title">{t('landing.howTitle')}</h2>
          <p className="section-sub">{t('landing.howSubtitle')}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', title: t('landing.howStep1Title'), desc: t('landing.howStep1Desc') },
              { step: '02', title: t('landing.howStep2Title'), desc: t('landing.howStep2Desc') },
              { step: '03', title: t('landing.howStep3Title'), desc: t('landing.howStep3Desc') },
            ].map(s => (
              <div key={s.step} className="card text-center hover:shadow-md transition-shadow group">
                <span className="text-xs font-bold text-teal-400 tracking-widest">STEP {s.step}</span>
                <h3 className="text-lg font-bold text-navy-700 mt-1 mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!`} target="_blank" rel="noreferrer" className="btn-teal px-10 py-4 text-lg shadow-lg shadow-teal-100">
              {t('landing.howCta')}
            </a>
          </div>
        </div>
      </section>

      {/* ── SPECIALITIES ── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="section-title">{t('landing.specTitle')}</h2>
          <p className="section-sub">{t('landing.specSubtitle')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {SPECIALITIES.map(s => (
              <a key={s.id}
                 href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Mujhe%20${encodeURIComponent(s.en)}%20chahiye.`}
                 target="_blank" rel="noreferrer"
                 className="card text-center py-5 hover:border-teal-300 hover:shadow-md transition-all group cursor-pointer border border-transparent">
                <span className="text-3xl">{SPEC_ICONS[s.id]}</span>
                <p className="font-semibold text-navy-700 text-xs mt-2 group-hover:text-teal-600 transition">
                  {lang === 'hi' ? s.hi : s.en}
                </p>
                <p className="text-gray-400 text-xs mt-0.5">{lang === 'hi' ? s.en : s.hi}</p>
                <p className="text-teal-600 text-[10px] font-medium mt-2">{t('landing.specAskLink')}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOR DOCTORS ── */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            <div>
              <span className="text-teal-600 font-semibold text-sm tracking-wide uppercase">{t('landing.forDocLabel')}</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-navy-700 mt-2 mb-6">{t('landing.forDocTitle')}</h2>
              <ul className="space-y-4">
                {[
                  t('landing.forDocBenefit1'),
                  t('landing.forDocBenefit2'),
                  t('landing.forDocBenefit3'),
                  t('landing.forDocBenefit4'),
                  t('landing.forDocBenefit5'),
                  t('landing.forDocBenefit6'),
                ].map(b => (
                  <li key={b} className="flex items-start gap-3">
                    <CheckCircle2 className="text-teal-500 w-5 h-5 shrink-0 mt-0.5" />
                    <span className="text-gray-600 text-sm">{b}</span>
                  </li>
                ))}
              </ul>
              <Link to="/doctor" className="btn-teal mt-8 px-10 py-4 text-base shadow-lg shadow-teal-100">
                {t('landing.forDocCta')}
              </Link>
              <p className="text-gray-400 text-sm mt-4">
                {t('landing.forDocAlreadyRegistered')}{' '}
                <Link to="/doctor/login" className="text-teal-600 hover:underline font-medium">
                  {t('landing.forDocLoginLink')}
                </Link>
              </p>
            </div>
            <div className="card border border-gray-200 overflow-hidden shadow-lg">
              <div className="bg-navy-700 text-white px-6 py-6">
                <h3 className="font-bold text-lg mb-2">{t('landing.forDocCardTitle')}</h3>
                <p className="text-white/70 text-sm leading-relaxed">
                  {t('landing.forDocCardDesc')}
                </p>
              </div>
              <div className="p-6 space-y-3">
                {[
                  t('landing.forDocStep1'),
                  t('landing.forDocStep2'),
                  t('landing.forDocStep3'),
                  t('landing.forDocStep4'),
                ].map((s, i) => (
                  <div key={s} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="text-gray-600 text-sm">{s}</span>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 bg-amber-50 border-t border-amber-100">
                <p className="text-xs text-amber-700">{t('landing.forDocNote')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('landing.faqTitle')}</h2>
          <p className="section-sub">{t('landing.faqSubtitle')}</p>
          <div className="card shadow-sm">
            {faqs.map(f => <FAQItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-20 bg-gradient-to-r from-teal-600 to-navy-700 text-white text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">{t('landing.ctaTitle')}</h2>
          <p className="text-white/80 mb-8 text-lg">{t('landing.ctaSubtitle')}</p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!`} target="_blank" rel="noreferrer"
               className="bg-white text-teal-700 font-bold px-10 py-4 rounded-full hover:bg-gray-50 transition shadow-lg">
              {t('landing.ctaBook')}
            </a>
            <Link to="/doctor" className="border-2 border-white text-white px-10 py-4 rounded-full font-semibold hover:bg-white/10 transition">
              {t('landing.ctaRegister')}
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}
