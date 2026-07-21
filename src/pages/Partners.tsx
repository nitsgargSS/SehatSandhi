import { Link } from 'react-router-dom'
import FAQSection from '../components/FAQSection'
import { WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'
import type { Lang } from '../i18n/translations'

interface PartnerCard {
  icon: string
  titleEn: string
  titleHi: string
  descEn: string
  descHi: string
  to: string | null
  ctaEn: string
  ctaHi: string
  wa?: boolean
}

const PARTNER_TYPES: PartnerCard[] = [
  { icon: '🏥', titleEn: 'Doctors & Clinics', titleHi: 'डॉक्टर एवं क्लिनिक', descEn: 'Grow your clinic\'s reach — patients will find you on WhatsApp', descHi: 'Apni clinic ki reach badhayein — patients WhatsApp par dhundhenge', to: '/for-doctors', ctaEn: 'Learn More', ctaHi: 'Aur Jaanein' },
  { icon: '💊', titleEn: 'Pharmacies', titleHi: 'दवाई की दुकान', descEn: 'Prescriptions come straight to you — deliver to homes', descHi: 'Prescriptions seedhi aapke paas — ghar delivery karein', to: '/for-pharmacy', ctaEn: 'Learn More', ctaHi: 'Aur Jaanein' },
  { icon: '🔬', titleEn: 'Diagnostic Labs', titleHi: 'जांच केंद्र', descEn: 'Test bookings come straight to you — offer home collection', descHi: 'Test bookings seedhe aapke paas — home collection karein', to: '/for-labs', ctaEn: 'Learn More', ctaHi: 'Aur Jaanein' },
  { icon: '🚑', titleEn: 'Ambulance Services', titleHi: 'एम्बुलेंस सेवा', descEn: 'Emergency response — become trusted in your area', descHi: 'Emergency response — apne area mein trusted banein', to: '/partner', ctaEn: 'Become an Ambulance Partner', ctaHi: 'Ambulance Partner Banein' },
  { icon: '🛡️', titleEn: 'Insurance Agents', titleHi: 'बीमा एजेंट', descEn: 'Warm leads, not cold calling — visit patients at home', descHi: 'Warm leads, cold calling nahi — patients ghar bulayein', to: '/partner', ctaEn: 'Become an Insurance Partner', ctaHi: 'Insurance Partner Banein' },
  { icon: '🏨', titleEn: 'Hospitals', titleHi: 'अस्पताल', descEn: 'Multi-doctor, multi-speciality — one unified listing', descHi: 'Multi-doctor, multi-speciality — ek unified listing', to: null, ctaEn: 'Talk on WhatsApp', ctaHi: 'WhatsApp Par Baat Karein', wa: true },
]

const FAQS_BY_LANG: Record<Lang, { question: string; answer: string }[]> = {
  hi: [
    { question: 'Partner banne ke liye kya zaroori hai?', answer: 'Aapke paas valid license/registration hona chahiye (drug license for pharmacy, NABL/lab registration for labs, ambulance permit, ya IRDA license for insurance). Doctors ke liye MCI/NMC registration zaroori hai.' },
    { question: 'Sirf woh PIN codes kyun choose karein jahan service de sakein?', answer: 'Jab aap ek PIN code choose karte hain, toh patients ko commitment milta hai ki aap us area mein service denge — chahe woh delivery ho, home collection ho, ya emergency response. Yeh commitment hi Sehatsandhi ki credibility hai.' },
    { question: 'Payment kab aur kaise hota hai?', answer: 'Monthly listing fee + per-transaction commission ka structure hai, jo partner type par depend karta hai. Poori details registration ke baad hamari team confirm karegi.' },
    { question: 'Kya main baad mein apne PIN codes badal sakta hoon?', answer: 'Haan, apni dashboard se ya humein WhatsApp/call karke PIN codes add ya remove kar sakte hain.' },
    { question: 'Verification mein kitna time lagta hai?', answer: '24-48 ghante mein hamari team aapki details verify kar leti hai aur WhatsApp par confirm kar deti hai.' },
  ],
  en: [
    { question: 'What do I need to become a partner?', answer: 'You need a valid license/registration (drug license for pharmacy, NABL/lab registration for labs, ambulance permit, or IRDA license for insurance). Doctors need MCI/NMC registration.' },
    { question: 'Why should I only choose PIN codes I can actually serve?', answer: 'When you choose a PIN code, patients get a commitment that you will serve that area — whether it\'s delivery, home collection, or emergency response. This commitment is the credibility of Sehatsandhi.' },
    { question: 'When and how does payment work?', answer: 'There\'s a monthly listing fee plus a per-transaction commission, depending on partner type. Full details will be confirmed by our team after registration.' },
    { question: 'Can I change my PIN codes later?', answer: 'Yes, you can add or remove PIN codes from your dashboard, or by contacting us on WhatsApp/call.' },
    { question: 'How long does verification take?', answer: 'Our team verifies your details within 24-48 hours and confirms on WhatsApp.' },
  ],
}

export default function Partners() {
  const { t, lang } = useLanguage()
  const faqs = FAQS_BY_LANG[lang]

  return (
    <div className="pt-16">

      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-700 mb-4">
            {t('partnersPage.heroTitle')}
          </h1>
          <p className="text-xl text-teal-600 font-medium mb-4">
            {t('partnersPage.heroSubtitle')}
          </p>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto">
            {t('partnersPage.heroDescription')}
          </p>
        </div>
      </section>

      {/* Partner type grid */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {PARTNER_TYPES.map(p => (
              <div key={p.titleEn} className="card border border-gray-100 hover:border-teal-300 hover:shadow-md transition-all flex flex-col">
                <span className="text-4xl mb-3">{p.icon}</span>
                <h3 className="font-bold text-navy-700 text-lg">{lang === 'hi' ? p.titleHi : p.titleEn}</h3>
                <p className="text-teal-600 text-sm mb-2">{lang === 'hi' ? p.titleEn : p.titleHi}</p>
                <p className="text-gray-500 text-sm leading-relaxed flex-1 mb-4">{lang === 'hi' ? p.descHi : p.descEn}</p>
                {p.wa ? (
                  <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Hamara%20hospital%20Sehatsandhi%20se%20jud'na%20chahta%20hai.`}
                     target="_blank" rel="noreferrer"
                     className="btn-navy text-sm justify-center">
                    {lang === 'hi' ? p.ctaHi : p.ctaEn}
                  </a>
                ) : (
                  <Link to={p.to!} className="btn-teal text-sm justify-center">
                    {lang === 'hi' ? p.ctaHi : p.ctaEn} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Partner Promise */}
      <section className="py-16 bg-navy-700 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            {t('partnersPage.promiseTitle')}
          </h2>
          <p className="text-white/70 leading-relaxed">
            {t('partnersPage.promiseDesc')}
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6 text-sm">
            <span className="bg-white/10 px-4 py-2 rounded-full">{t('partnersPage.badge1')}</span>
            <span className="bg-white/10 px-4 py-2 rounded-full">{t('partnersPage.badge2')}</span>
            <span className="bg-white/10 px-4 py-2 rounded-full">{t('partnersPage.badge3')}</span>
            <span className="bg-white/10 px-4 py-2 rounded-full">{t('partnersPage.badge4')}</span>
          </div>
        </div>
      </section>

      <FAQSection items={faqs} subtitle={t('partnersPage.faqSubtitle')} />

      {/* CTA */}
      <section className="py-16 bg-gray-50 text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-navy-700 mb-4">
            {t('partnersPage.ctaTitle')}
          </h2>
          <p className="text-gray-500 mb-6">{t('partnersPage.ctaSubtitle')}</p>
          <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!%20Main%20Sehatsandhi%20partner%20banna%20chahta%20hoon.`}
             target="_blank" rel="noreferrer"
             className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            {t('partnersPage.ctaButton')}
          </a>
        </div>
      </section>

    </div>
  )
}
