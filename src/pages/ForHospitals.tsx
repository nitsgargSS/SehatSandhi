import { CheckCircle2 } from 'lucide-react'
import FAQSection from '../components/FAQSection'
import { WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'

export default function ForHospitals() {
  const { t } = useLanguage()
  const faqs = [1, 2, 3, 4].map(n => ({
    question: t(`forHospitalsPage.faqQ${n}`),
    answer: t(`forHospitalsPage.faqA${n}`),
  }))

  const waLink = `https://wa.me/${WA_NUMBER}?text=Namaste!%20Hamara%20hospital%20Sehatsandhi%20se%20jud'na%20chahta%20hai.`

  return (
    <div className="pt-16">
      <section className="py-20 bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <span className="text-5xl mb-4 inline-block">🏨</span>
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-700 mb-4">{t('forHospitalsPage.heroTitle')}</h1>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-8">{t('forHospitalsPage.heroDesc')}</p>
          <a href={waLink} target="_blank" rel="noreferrer" className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            {t('forHospitalsPage.heroCta')}
          </a>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forHospitalsPage.problemTitle')}</h2>
          <p className="text-gray-600 text-center leading-relaxed mt-4">{t('forHospitalsPage.problemDesc')}</p>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forHospitalsPage.howTitle')}</h2>
          <div className="space-y-3 mt-8">
            {[1, 2, 3, 4].map(n => (
              <div key={n} className="flex items-start gap-3 card">
                <span className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shrink-0">{n}</span>
                <span className="text-sm text-gray-700 pt-0.5">{t(`forHospitalsPage.howStep${n}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forHospitalsPage.benefitsTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <p key={n} className="text-sm text-gray-600 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                {t(`forHospitalsPage.benefit${n}`).replace('✅ ', '')}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-navy-700">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center text-white">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">{t('forHospitalsPage.pricingTitle')}</h2>
          <p className="text-white/70 leading-relaxed">{t('forHospitalsPage.pricingDesc')}</p>
        </div>
      </section>

      <FAQSection items={faqs} />

      <section className="py-16 bg-gray-50 text-center">
        <a href={waLink} target="_blank" rel="noreferrer" className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
          {t('forHospitalsPage.ctaButton')}
        </a>
      </section>
    </div>
  )
}
