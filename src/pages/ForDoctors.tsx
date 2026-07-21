import { Link } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'
import FAQSection from '../components/FAQSection'
import { useLanguage } from '../i18n/LanguageContext'

export default function ForDoctors() {
  const { t } = useLanguage()

  const faqs = [1, 2, 3, 4, 5, 6].map(n => ({
    question: t(`forDoctorsPage.faqQ${n}`),
    answer: t(`forDoctorsPage.faqA${n}`),
  }))

  const compareRows = [
    { feature: t('forDoctorsPage.compareActive'), justdial: false, practo: false, sehat: true },
    { feature: t('forDoctorsPage.comparePin'), justdial: false, practo: false, sehat: true },
    { feature: t('forDoctorsPage.compareBooking'), justdial: false, practo: true, sehat: true },
    { feature: t('forDoctorsPage.compareAnalytics'), justdial: false, practo: true, sehat: true },
    { feature: t('forDoctorsPage.compareVerified'), justdial: false, practo: true, sehat: true },
    { feature: t('forDoctorsPage.compareLocal'), justdial: false, practo: false, sehat: true },
  ]

  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-white via-teal-50/30 to-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-navy-700 mb-4">{t('forDoctorsPage.heroTitle')}</h1>
          <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-8">{t('forDoctorsPage.heroDesc')}</p>
          <Link to="/doctor" className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            {t('forDoctorsPage.heroCta')}
          </Link>
        </div>
      </section>

      {/* Problem/Solution */}
      <section className="py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forDoctorsPage.problemTitle')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
            <div className="card">
              <p className="text-gray-500 text-sm mb-3">{t('forDoctorsPage.problemIntro')}</p>
              <div className="space-y-2 text-sm text-gray-600">
                <p>{t('forDoctorsPage.problem1')}</p>
                <p>{t('forDoctorsPage.problem2')}</p>
                <p>{t('forDoctorsPage.problem3')}</p>
                <p>{t('forDoctorsPage.problem4')}</p>
              </div>
            </div>
            <div className="card border-2 border-teal-200 bg-teal-50/40">
              <p className="text-gray-700 font-medium text-sm mb-3">{t('forDoctorsPage.solutionIntro')}</p>
              <div className="space-y-2 text-sm text-gray-700">
                <p>{t('forDoctorsPage.solution1')}</p>
                <p>{t('forDoctorsPage.solution2')}</p>
                <p>{t('forDoctorsPage.solution3')}</p>
                <p>{t('forDoctorsPage.solution4')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forDoctorsPage.howTitle')}</h2>
          <div className="space-y-3 mt-8">
            {[1, 2, 3, 4, 5].map(n => (
              <div key={n} className="flex items-start gap-3 card">
                <span className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shrink-0">{n}</span>
                <span className="text-sm text-gray-700 pt-0.5">{t(`forDoctorsPage.howStep${n}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-title">{t('forDoctorsPage.compareTitle')}</h2>
          <div className="card shadow-sm overflow-x-auto mt-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 text-gray-500 font-medium">{t('forDoctorsPage.compareFeature')}</th>
                  <th className="text-center py-3 px-2 text-gray-500 font-medium">JustDial</th>
                  <th className="text-center py-3 px-2 text-gray-500 font-medium">Practo</th>
                  <th className="text-center py-3 px-2 text-teal-600 font-bold">Sehatsandhi</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map(r => (
                  <tr key={r.feature} className="border-b border-gray-50">
                    <td className="py-3 px-2 text-gray-700">{r.feature}</td>
                    <td className="text-center py-3 px-2">{r.justdial ? <CheckCircle2 className="w-4 h-4 text-teal-500 inline" /> : <XCircle className="w-4 h-4 text-gray-300 inline" />}</td>
                    <td className="text-center py-3 px-2">{r.practo ? <CheckCircle2 className="w-4 h-4 text-teal-500 inline" /> : <XCircle className="w-4 h-4 text-gray-300 inline" />}</td>
                    <td className="text-center py-3 px-2 bg-teal-50/50">{r.sehat ? <CheckCircle2 className="w-4 h-4 text-teal-600 inline" /> : <XCircle className="w-4 h-4 text-gray-300 inline" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing note */}
      <section className="py-16 bg-navy-700">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center text-white">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">{t('forDoctorsPage.pricingTitle')}</h2>
          <p className="text-white/70 leading-relaxed">{t('forDoctorsPage.pricingDesc')}</p>
        </div>
      </section>

      <FAQSection items={faqs} />

      {/* CTA */}
      <section className="py-16 bg-gray-50 text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-navy-700 mb-6">{t('forDoctorsPage.ctaTitle')}</h2>
          <Link to="/doctor" className="btn-teal px-10 py-4 text-base shadow-lg shadow-teal-100 inline-flex">
            {t('forDoctorsPage.ctaButton')}
          </Link>
        </div>
      </section>
    </div>
  )
}
