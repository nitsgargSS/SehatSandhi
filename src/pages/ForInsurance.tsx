import { Link } from 'react-router-dom'
import { XCircle, CheckCircle2 } from 'lucide-react'
import FAQSection from '../components/FAQSection'
import { useLanguage } from '../i18n/LanguageContext'

export default function ForInsurance() {
  const { t } = useLanguage()
  const faqs = [1, 2, 3].map(n => ({
    question: t(`forInsurancePage.faqQ${n}`),
    answer: t(`forInsurancePage.faqA${n}`),
  }))

  return (
    <div className="pt-16">
      <section className="py-20 bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <span className="text-5xl mb-4 inline-block">🛡️</span>
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-700 mb-4">{t('forInsurancePage.heroTitle')}</h1>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-8">{t('forInsurancePage.heroDesc')}</p>
          <Link to="/partner" className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            {t('forInsurancePage.heroCta')}
          </Link>
        </div>
      </section>

      {/* Why different */}
      <section className="py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forInsurancePage.whyDiffTitle')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
            <div className="card">
              <p className="text-gray-500 text-sm mb-3">{t('forInsurancePage.traditionalIntro')}</p>
              <div className="space-y-2 text-sm text-gray-600">
                <p className="flex items-start gap-2"><XCircle className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />{t('forInsurancePage.traditional1')}</p>
                <p className="flex items-start gap-2"><XCircle className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />{t('forInsurancePage.traditional2')}</p>
                <p className="flex items-start gap-2"><XCircle className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />{t('forInsurancePage.traditional3')}</p>
              </div>
            </div>
            <div className="card border-2 border-teal-200 bg-teal-50/40">
              <p className="text-gray-700 font-medium text-sm mb-3">{t('forInsurancePage.sehatIntro')}</p>
              <div className="space-y-2 text-sm text-gray-700">
                <p className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />{t('forInsurancePage.sehat1')}</p>
                <p className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />{t('forInsurancePage.sehat2')}</p>
                <p className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />{t('forInsurancePage.sehat3')}</p>
                <p className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />{t('forInsurancePage.sehat4')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forInsurancePage.howTitle')}</h2>
          <div className="space-y-3 mt-8">
            {[1, 2, 3, 4, 5].map(n => (
              <div key={n} className="flex items-start gap-3 card">
                <span className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shrink-0">{n}</span>
                <span className="text-sm text-gray-700 pt-0.5">{t(`forInsurancePage.howStep${n}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 bg-amber-50">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl font-bold text-navy-700 mb-3">⚠️ {t('forInsurancePage.commitmentTitle')}</h2>
          <p className="text-gray-600 leading-relaxed">{t('forInsurancePage.commitmentDesc')}</p>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forInsurancePage.earnTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 mb-6">
            {[t('forInsurancePage.earnLead'), t('forInsurancePage.earnCommission'), t('forInsurancePage.earnListing')].map(e => (
              <div key={e} className="card text-center text-sm text-gray-600">{e}</div>
            ))}
          </div>
          <div className="bg-navy-700 rounded-xl p-5 text-white text-sm">
            <p className="font-bold mb-2">{t('forInsurancePage.exampleTitle')}</p>
            <p className="text-white/80 leading-relaxed">{t('forInsurancePage.exampleDesc')}</p>
          </div>
        </div>
      </section>

      <section className="py-16 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forInsurancePage.requirementsTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 mb-8">
            {[1, 2, 3, 4].map(n => (
              <p key={n} className="text-sm text-gray-600">{t(`forInsurancePage.req${n}`)}</p>
            ))}
          </div>
          <div className="card text-center">
            <p className="font-bold text-navy-700 text-sm mb-2">{t('forInsurancePage.companiesTitle')}</p>
            <p className="text-gray-500 text-sm">{t('forInsurancePage.companiesDesc')}</p>
          </div>
        </div>
      </section>

      <FAQSection items={faqs} />

      <section className="py-16 bg-white text-center">
        <Link to="/partner" className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
          {t('forInsurancePage.ctaButton')}
        </Link>
      </section>
    </div>
  )
}
