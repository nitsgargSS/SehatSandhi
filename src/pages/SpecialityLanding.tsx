import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { MapPin, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Doctor, SPECIALITIES, PIN_CODES, WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'

const slugify = (s: string) => s.toLowerCase().trim().replace(/\s+/g, '-')

export default function SpecialityLanding() {
  const { specId, areaSlug } = useParams()
  const { t, lang } = useLanguage()
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)

  const speciality = SPECIALITIES.find(s => s.id.toLowerCase() === (specId || '').toLowerCase())
  const area = PIN_CODES.find(p => slugify(p.area) === (areaSlug || '').toLowerCase())

  useEffect(() => {
    document.title = speciality && area
      ? `${lang === 'hi' ? speciality.hi : speciality.en} — ${area.area} | Sehatsandhi`
      : 'Sehatsandhi'
  }, [speciality, area, lang])

  useEffect(() => {
    const load = async () => {
      if (!speciality || !area) { setLoading(false); return }
      const { data } = await supabase
        .from('doctors')
        .select('*')
        .eq('speciality', speciality.id)
        .eq('status', 'active')
        .contains('pin_codes', [area.code])
      setDoctors(data || [])
      setLoading(false)
    }
    load()
  }, [specId, areaSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!speciality || !area) {
    return (
      <div className="min-h-screen flex items-center justify-center pt-16 px-4">
        <div className="text-center">
          <h2 className="text-xl font-bold text-navy-700 mb-2">{t('specialityLandingPage.notFoundSpeciality')}</h2>
          <Link to="/" className="text-teal-600 hover:underline">{t('specialityLandingPage.backToHome')}</Link>
        </div>
      </div>
    )
  }

  const specName = lang === 'hi' ? speciality.hi : speciality.en
  const specNameOther = lang === 'hi' ? speciality.en : speciality.hi

  // Schema.org structured data — helps this page show rich results in Google
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    name: `Sehatsandhi — ${specName} in ${area.area}`,
    areaServed: area.area,
    medicalSpecialty: speciality.en,
  }

  return (
    <div className="min-h-screen bg-gray-50 pt-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-gray-500 hover:text-teal-600 text-sm transition">
            <ArrowLeft className="w-4 h-4" /> {t('specialityLandingPage.backToHome')}
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Hero */}
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-2 bg-teal-50 text-teal-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-4 border border-teal-100">
            <MapPin className="w-3.5 h-3.5" /> {area.area}
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-navy-700 mb-2">{specName}</h1>
          <p className="text-gray-400 text-sm">{specNameOther} · {area.area}</p>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 text-sm py-12">...</p>
        ) : doctors.length > 0 ? (
          <div>
            <p className="text-gray-500 text-sm mb-4">{t('specialityLandingPage.foundDoctorsIntro')}</p>
            <div className="space-y-3">
              {doctors.map(d => (
                <div key={d.id} className="card flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="font-bold text-navy-700">{d.name}</p>
                    <p className="text-gray-500 text-sm">{d.qualification} · {d.clinic_name}</p>
                    <p className="text-gray-400 text-xs">{d.address}</p>
                  </div>
                  <a href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Namaste! Main ${d.name} se appointment book karna chahta hoon.`)}`}
                     target="_blank" rel="noreferrer" className="btn-teal text-sm">
                    {t('specialityLandingPage.bookOnWhatsapp')}
                  </a>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card text-center py-10">
            <div className="text-5xl mb-4">🏥</div>
            <h2 className="font-bold text-navy-700 mb-2">{t('specialityLandingPage.noDoctorsYetTitle')}</h2>
            <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">{t('specialityLandingPage.noDoctorsYetDesc')}</p>
            <a href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Namaste! Mujhe ${area.area} mein ${speciality.en} chahiye — koi available hone par batayein.`)}`}
               target="_blank" rel="noreferrer" className="btn-teal inline-flex mb-8">
              {t('specialityLandingPage.notifyMeButton')}
            </a>

            <div className="border-t border-gray-100 pt-6 mt-2">
              <p className="text-sm font-medium text-navy-700 mb-1">{t('specialityLandingPage.areYouADoctor')}</p>
              <p className="text-gray-400 text-xs mb-3">{t('specialityLandingPage.beFirstToJoin')}</p>
              <Link to="/doctor" className="text-teal-600 hover:underline text-sm font-medium">
                {t('specialityLandingPage.registerLink')}
              </Link>
            </div>
          </div>
        )}

        <div className="text-center mt-10">
          <p className="text-gray-400 text-sm mb-2">{t('specialityLandingPage.otherSpecialities')}</p>
          <Link to="/" className="text-teal-600 hover:underline text-sm font-medium">
            {t('specialityLandingPage.viewAllLink')}
          </Link>
        </div>
      </div>
    </div>
  )
}
