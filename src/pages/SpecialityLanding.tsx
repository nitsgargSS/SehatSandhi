import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { MapPin, ArrowLeft, Star } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { SPECIALITIES, PIN_CODES, WA_NUMBER } from '../types'
import { useLanguage } from '../i18n/LanguageContext'
import { track, trackImpressions } from '../lib/analytics'
import { doctorUrl, slugify } from '../lib/links'
import SiteHeader, { HeaderLink, HeaderCta, shopIcon, PageShell } from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'
import { DoctorListSkeleton } from '../components/Loading'

/**
 * A doctor in a search result, and where they sit.
 *
 * A row per (doctor, business): a cardiologist who consults at two hospitals in
 * the same pincode is genuinely two places a patient could go to see her, and
 * collapsing them would hide one. Ratings are the business's — patients rate
 * where they were seen.
 */
interface DoctorResult {
  practitioner_id: string
  full_name: string
  speciality: string | null
  qualification: string | null
  business_id: string
  business_name: string
  address: string | null
  consultation_fee: number
  is_primary: boolean
  avg_rating?: number
  total_reviews?: number
  is_top_rated?: boolean
}

export default function SpecialityLanding() {
  const { specId, areaSlug } = useParams()
  const { t, lang } = useLanguage()
  const [doctors, setDoctors] = useState<DoctorResult[]>([])
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
      // Doctors, not listings. The old query filtered `doctors` — which was
      // really a table of businesses — by speciality, so a clinic matched only
      // if the one person who signed it up happened to practise what the patient
      // searched for. Now the speciality is the doctor's own and the business is
      // where they sit.
      const { data } = await supabase
        .from('public_practitioner_businesses')
        .select('*')
        .eq('speciality', speciality.id)
        .contains('pin_codes', [area.code])

      const docs = (data ?? []) as DoctorResult[]
      // Every search, whether or not it found anyone. The zero-result ones are
      // the most valuable: they are demand_by_area's unserved markets.
      track('search', { speciality: speciality.id, pinCode: area.code })
      // One impression per listing shown — the denominator that turns "12 profile
      // views" into "12 out of 240", which is what tells a business the problem
      // is their photo rather than their pricing.
      if (docs.length) {
        // The business is what an impression is FOR: it is what was listed, and
        // what the "12 views out of 240" number on their dashboard counts.
        trackImpressions(docs.map(d => d.business_id), { speciality: speciality.id, pinCode: area.code })
      }
      if (docs.length > 0) {
        const { data: ratings } = await supabase
          .from('rating_aggregate')
          .select('*')
          .in('business_id', docs.map(d => d.business_id))

        const merged: DoctorResult[] = docs.map(d => {
          const r = ratings?.find(rr => rr.business_id === d.business_id)
          return { ...d, avg_rating: r?.avg_rating, total_reviews: r?.total_reviews, is_top_rated: r?.is_top_rated }
        })
        // Top Rated doctors first, then by rating, then newest
        merged.sort((a, b) => {
          if (a.is_top_rated && !b.is_top_rated) return -1
          if (!a.is_top_rated && b.is_top_rated) return 1
          return (b.avg_rating || 0) - (a.avg_rating || 0)
        })
        setDoctors(merged)
      } else {
        setDoctors([])
        // Auto-log: a patient landed here and found nothing —
        // this alone is a useful expansion signal even if they
        // never click "Notify Me"
        supabase.from('unmet_demand_log').insert({
          source: 'website',
          pin_code: area.code,
          speciality: speciality.id,
          patient_wants_notification: false,
        })
      }
      setLoading(false)
    }
    load()
  }, [specId, areaSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  const logNotifyMeClick = () => {
    if (!area || !speciality) return
    // Explicit "yes, tell me" signal — separate row from the
    // passive page-view log above, since this one carries
    // real patient intent
    supabase.from('unmet_demand_log').insert({
      source: 'website',
      pin_code: area.code,
      speciality: speciality.id,
      patient_wants_notification: true,
    })
  }

  if (!speciality || !area) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
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
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      {/* Most arrivals here are from a WhatsApp or search link rather than from
          our own homepage, so this is the first Sehatsandhi page they see. The
          bare back-link that used to sit here showed them no brand at all. */}
      <SiteHeader>
        <HeaderLink to="/">{t('specialityLandingPage.backToHome')}</HeaderLink>
        <HeaderCta to="/business" icon={shopIcon}>List your business</HeaderCta>
      </SiteHeader>

      <PageShell style={{ paddingTop: 40, paddingBottom: 40 }}>
        <div className="max-w-4xl mx-auto">
        {/* Hero */}
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-2 bg-teal-50 text-teal-700 text-xs font-semibold px-4 py-1.5 rounded-full mb-4 border border-teal-100">
            <MapPin className="w-3.5 h-3.5" /> {area.area}
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold text-navy-700 mb-2">{specName}</h1>
          <p className="text-gray-400 text-sm">{specNameOther} · {area.area}</p>
        </div>

        {loading ? (
          // Doctor-shaped rows rather than a spinner: the patient already
          // knows a list is coming, so show its shape and let it fill in.
          <DoctorListSkeleton rows={3} />
        ) : doctors.length > 0 ? (
          <div>
            <p className="text-gray-500 text-sm mb-4">{t('specialityLandingPage.foundDoctorsIntro')}</p>
            <div className="space-y-3">
              {doctors.map(d => (
                <div key={`${d.practitioner_id}-${d.business_id}`} className="card flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* The profile page carries hours, every clinic location,
                          reviews and a share link. Nothing linked to it before,
                          so a patient could only ever see this one-line summary. */}
                      <Link to={doctorUrl({ id: d.practitioner_id, name: d.full_name })}
                        className="font-bold text-navy-700 hover:text-teal-600 hover:underline">
                        {d.full_name}
                      </Link>
                      {d.is_top_rated && (
                        <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                          ⭐ Top Rated
                        </span>
                      )}
                    </div>
                    {d.total_reviews ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map(i => (
                            <Star key={i} className={`w-3 h-3 ${i <= Math.round(d.avg_rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-gray-200'}`} />
                          ))}
                        </div>
                        <span className="text-xs text-gray-400">{d.avg_rating} ({d.total_reviews})</span>
                      </div>
                    ) : null}
                    {/* Where they sit. The whole point of the split: a patient
                        looking for a cardiologist is told which clinic to go to,
                        and a visiting consultant shows up under each place they
                        actually work rather than only where they signed up. */}
                    <p className="text-gray-500 text-sm mt-1">
                      {[d.qualification, d.business_name].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-gray-400 text-xs">{d.address}</p>
                    {d.consultation_fee > 0 && (
                      <p className="text-gray-400 text-xs">₹{d.consultation_fee} consultation</p>
                    )}
                    <Link to={doctorUrl({ id: d.practitioner_id, name: d.full_name })}
                      className="text-teal-600 text-xs font-medium hover:underline inline-block mt-1.5">
                      {t('specialityLandingPage.viewProfile')}
                    </Link>
                  </div>
                  <a href={`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Namaste! Main ${d.full_name} (${d.business_name}) se appointment book karna chahta hoon.`)}`}
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
               target="_blank" rel="noreferrer" onClick={logNotifyMeClick} className="btn-teal inline-flex mb-8">
              {t('specialityLandingPage.notifyMeButton')}
            </a>

            <div className="border-t border-gray-100 pt-6 mt-2">
              <p className="text-sm font-medium text-navy-700 mb-1">{t('specialityLandingPage.areYouADoctor')}</p>
              <p className="text-gray-400 text-xs mb-3">{t('specialityLandingPage.beFirstToJoin')}</p>
              <Link to="/business/register" className="text-teal-600 hover:underline text-sm font-medium">
                {t('specialityLandingPage.registerLink')}
              </Link>
            </div>
          </div>
        )}

        <div className="text-center mt-10">
          <p className="text-gray-400 text-sm mb-2">{t('specialityLandingPage.otherSpecialities')}</p>
          <Link to="/browse" className="text-teal-600 hover:underline text-sm font-medium">
            {t('specialityLandingPage.viewAllLink')}
          </Link>
        </div>
      </div>
      </PageShell>

      <SiteFooter />
    </div>
  )
}
