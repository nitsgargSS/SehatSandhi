import { Link } from 'react-router-dom'
import { MessageSquare, CheckCircle2, Star } from 'lucide-react'
import FAQSection from '../components/FAQSection'
import { WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'
import type { Lang } from '../i18n/translations'

interface Service {
  icon: string
  nameEn: string
  nameHi: string
  descEn: string
  descHi: string
  msg: string
}

const SERVICES: Service[] = [
  { icon: '🏥', nameEn: 'Doctor', nameHi: 'डॉक्टर', descEn: 'Book an appointment — verified doctors, on WhatsApp', descHi: 'Appointment book karein — verified doctors, WhatsApp par', msg: 'Mujhe doctor se appointment chahiye' },
  { icon: '💊', nameEn: 'Pharmacy', nameHi: 'दवाई', descEn: 'Get medicines delivered home — from a verified pharmacy nearby', descHi: 'Ghar par medicines mangayein — nearest verified pharmacy se', msg: 'Mujhe medicines mangwani hain' },
  { icon: '🔬', nameEn: 'Lab / Blood Test', nameHi: 'जांच', descEn: 'Get a blood test done at home — verified diagnostic labs', descHi: 'Ghar par blood test karwayein — verified diagnostic labs', msg: 'Mujhe blood test karwana hai' },
  { icon: '🚑', nameEn: 'Ambulance', nameHi: 'एम्बुलेंस', descEn: 'Instant help in an emergency — verified ambulance service', descHi: 'Emergency mein turant help — verified ambulance service', msg: 'Mujhe ambulance chahiye' },
  { icon: '🛡️', nameEn: 'Health Insurance', nameHi: 'बीमा', descEn: 'Meet an agent at home — verified insurance agents', descHi: 'Ghar par agent se milein — verified insurance agents', msg: 'Mujhe health insurance ki jaankari chahiye' },
  { icon: '🏨', nameEn: 'Hospital', nameHi: 'अस्पताल', descEn: 'Direct OPD booking — multi-speciality hospitals', descHi: 'Direct OPD booking — multi-speciality hospitals', msg: 'Mujhe hospital mein appointment chahiye' },
]

const FAQS_BY_LANG: Record<Lang, { question: string; answer: string }[]> = {
  hi: [
    { question: 'Kya Sehatsandhi patients ke liye free hai?', answer: 'Haan, bilkul free hai. Patients ko doctor, pharmacy, lab, ambulance ya insurance dhundhne ke liye koi charge nahi lagta. Sirf WhatsApp par message karein.' },
    { question: 'Kya mujhe koi app download karni hogi?', answer: 'Nahi. Sehatsandhi WhatsApp par kaam karta hai — jo already aapke phone mein hai. Koi nayi app install karne ki zaroorat nahi.' },
    { question: 'Sehatsandhi ka WhatsApp number kya hai?', answer: 'Humein WhatsApp par message karein aur hum aapko turant guide karenge. Number website ke har page par WhatsApp button mein milega.' },
    { question: 'Kya sab doctors aur partners verified hote hain?', answer: 'Haan. Har doctor ka MCI/NMC registration verify kiya jaata hai. Har partner (pharmacy, lab, ambulance, insurance) ka license bhi check hota hai, tabhi unki listing activate hoti hai.' },
    { question: 'Mera data safe hai kya?', answer: 'Haan. Aapka phone number kisi ke saath share nahi kiya jaata. Hum DPDP Act 2023 ke rules follow karte hain — aapki permission ke bina koi message nahi bheja jaata.' },
    { question: 'Agar mujhe messages band karne hon toh?', answer: 'Kabhi bhi "STOP" likh kar bhejein — turant sabhi messages band ho jayenge. Dobara shuru karne ke liye "HI" likhein.' },
  ],
  en: [
    { question: 'Is Sehatsandhi free for patients?', answer: 'Yes, completely free. Patients are never charged to find a doctor, pharmacy, lab, ambulance, or insurance agent. Just message us on WhatsApp.' },
    { question: 'Do I need to download an app?', answer: 'No. Sehatsandhi works on WhatsApp — which is already on your phone. No new app to install.' },
    { question: "What's Sehatsandhi's WhatsApp number?", answer: 'Message us on WhatsApp and we\'ll guide you instantly. You\'ll find the number in the WhatsApp button on every page of this website.' },
    { question: 'Are all doctors and partners verified?', answer: "Yes. Every doctor's MCI/NMC registration is verified. Every partner (pharmacy, lab, ambulance, insurance) has their license checked before their listing is activated." },
    { question: 'Is my data safe?', answer: 'Yes. Your phone number is never shared with anyone. We follow the DPDP Act 2023 — no message is ever sent without your permission.' },
    { question: 'What if I want to stop receiving messages?', answer: 'Send "STOP" anytime — all messages stop immediately. Send "HI" to start again whenever you like.' },
  ],
}

export default function HowItWorks() {
  const { t, lang } = useLanguage()
  const faqs = FAQS_BY_LANG[lang]

  return (
    <div className="pt-16">

      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-700 mb-4">
            {t('howItWorksPage.heroTitle')}
          </h1>
          <p className="text-xl text-teal-600 font-medium mb-6">
            {t('howItWorksPage.heroSubtitle')}
          </p>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            {t('howItWorksPage.heroDescription')}
          </p>
          <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Mujhe%20Sehatsandhi%20ke%20baare%20mein%20jaanna%20hai.`}
             target="_blank" rel="noreferrer"
             className="btn-teal mt-8 px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            {t('howItWorksPage.heroCta')}
          </a>
        </div>
      </section>

      {/* How it works — 3 steps */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('howItWorksPage.howTitle')}</h2>
          <p className="section-sub">{t('howItWorksPage.howSubtitle')}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: <MessageSquare className="w-8 h-8 text-teal-600" />, step: '01', title: t('howItWorksPage.step1Title'), desc: t('howItWorksPage.step1Desc') },
              { icon: <CheckCircle2 className="w-8 h-8 text-teal-600" />, step: '02', title: t('howItWorksPage.step2Title'), desc: t('howItWorksPage.step2Desc') },
              { icon: <Star className="w-8 h-8 text-teal-600" />, step: '03', title: t('howItWorksPage.step3Title'), desc: t('howItWorksPage.step3Desc') },
            ].map(s => (
              <div key={s.step} className="card text-center hover:shadow-md transition-shadow">
                <div className="w-14 h-14 rounded-2xl bg-teal-50 flex items-center justify-center mx-auto mb-4">{s.icon}</div>
                <span className="text-xs font-bold text-teal-400 tracking-widest">STEP {s.step}</span>
                <h3 className="text-lg font-bold text-navy-700 mt-1 mb-2">{s.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's available */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('howItWorksPage.servicesTitle')}</h2>
          <p className="section-sub">{t('howItWorksPage.servicesSubtitle')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SERVICES.map(s => (
              <a key={s.nameEn}
                 href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(s.msg)}`}
                 target="_blank" rel="noreferrer"
                 className="card hover:border-teal-300 hover:shadow-md transition-all border border-transparent group">
                <span className="text-4xl">{s.icon}</span>
                <h3 className="font-bold text-navy-700 mt-3 group-hover:text-teal-600 transition">
                  {lang === 'hi' ? s.nameHi : s.nameEn}
                </h3>
                <p className="text-gray-400 text-xs mt-0.5">{lang === 'hi' ? s.nameEn : s.nameHi}</p>
                <p className="text-gray-500 text-sm mt-2 leading-relaxed">{lang === 'hi' ? s.descHi : s.descEn}</p>
                <p className="text-teal-600 text-xs font-medium mt-3">{t('howItWorksPage.servicesAskLink')}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Why Sehatsandhi */}
      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('howItWorksPage.whyTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            {[
              t('howItWorksPage.whyBenefit1'),
              t('howItWorksPage.whyBenefit2'),
              t('howItWorksPage.whyBenefit3'),
              t('howItWorksPage.whyBenefit4'),
              t('howItWorksPage.whyBenefit5'),
              t('howItWorksPage.whyBenefit6'),
            ].map(b => (
              <div key={b} className="flex items-start gap-2 text-gray-600 text-sm">
                <span>✅ {b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sehat Points teaser */}
      <section className="py-16 bg-gradient-to-r from-teal-600 to-navy-700">
        <div className="max-w-3xl mx-auto px-4 text-center text-white">
          <h2 className="text-3xl font-bold mb-3">{t('howItWorksPage.pointsTitle')}</h2>
          <p className="text-white/80 mb-6">{t('howItWorksPage.pointsDesc')}</p>
          <Link to="/points" className="bg-white text-teal-700 font-bold px-8 py-3 rounded-full hover:bg-gray-50 transition inline-block">
            {t('howItWorksPage.pointsCta')}
          </Link>
        </div>
      </section>

      <FAQSection items={faqs} subtitle={t('howItWorksPage.faqSubtitle')} />

      {/* Final CTA */}
      <section className="py-16 bg-white text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-navy-700 mb-4">{t('howItWorksPage.finalCtaTitle')}</h2>
          <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!`} target="_blank" rel="noreferrer"
             className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            {t('howItWorksPage.finalCtaButton')}
          </a>
        </div>
      </section>

    </div>
  )
}
