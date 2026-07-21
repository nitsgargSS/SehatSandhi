import { Link } from 'react-router-dom'
import FAQSection from '../components/FAQSection'
import { useLanguage } from '../i18n/LanguageContext'

export default function ForLabs() {
  const { t } = useLanguage()
  const faqs = [1, 2, 3].map(n => ({
    question: t(`forLabsPage.faqQ${n}`),
    answer: t(`forLabsPage.faqA${n}`),
  }))

  return (
    <div className="pt-16">
      <section className="py-20 bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <span className="text-5xl mb-4 inline-block">🔬</span>
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-700 mb-4">{t('forLabsPage.heroTitle')}</h1>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-8">{t('forLabsPage.heroDesc')}</p>
          <Link to="/partner" className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            {t('forLabsPage.heroCta')}
          </Link>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forLabsPage.howTitle')}</h2>
          <div className="space-y-3 mt-8">
            {[1, 2, 3, 4, 5].map(n => (
              <div key={n} className="flex items-start gap-3 card">
                <span className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shrink-0">{n}</span>
                <span className="text-sm text-gray-700 pt-0.5">{t(`forLabsPage.howStep${n}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-amber-50">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold text-navy-700 mb-3">⚠️ {t('forLabsPage.commitmentTitle')}</h2>
          <p className="text-gray-600 leading-relaxed">{t('forLabsPage.commitmentDesc')}</p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forLabsPage.earnTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            {[t('forLabsPage.earnCommission'), t('forLabsPage.earnCollection'), t('forLabsPage.earnListing'), t('forLabsPage.earnCamps')].map(e => (
              <div key={e} className="card text-sm text-gray-600">{e}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forLabsPage.requirementsTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8">
            {[1, 2, 3, 4].map(n => (
              <p key={n} className="text-sm text-gray-600">{t(`forLabsPage.req${n}`)}</p>
            ))}
          </div>
        </div>
      </section>

      <FAQSection items={faqs} />

      <section className="py-16 bg-white text-center">
        <Link to="/partner" className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
          {t('forLabsPage.ctaButton')}
        </Link>
      </section>
    </div>
  )
}
