import { SPECIALITIES, WA_LINK } from '../types'
import { useLanguage } from '../i18n/LanguageContext'
import { track } from '../lib/analytics'
import SiteHeader, { HeaderLink, HeaderCta, shopIcon, PageShell, HEADER } from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// Pick a speciality, and carry on in WhatsApp.
//
// This page used to ask for an area first, from a row of chips filled from
// service_areas — which in practice was twenty Yamuna Nagar towns, the wrong
// thing to show a country. Each card then opened a listing page for that one
// area, and for most specialities that page said "no doctors yet".
//
// The bot already does this better: it asks for any PIN code or town in India,
// searches the whole district, and books. So every card opens the bot with its
// trigger word, and the tap is recorded here so demand by speciality is kept.

export default function Browse() {
  const { t, lang } = useLanguage()

  return (
    <div style={{ minHeight: '100vh', background: HEADER.cream }}>
      <SiteHeader>
        <HeaderLink to="/">{t('specialityLandingPage.backToHome')}</HeaderLink>
        <HeaderCta to="/business" icon={shopIcon}>List your business</HeaderCta>
      </SiteHeader>

      <PageShell style={{ paddingTop: 32, paddingBottom: 56 }}>
        <div className="max-w-4xl mx-auto">
          <h1 style={{ fontSize: 'clamp(26px,6vw,34px)', fontWeight: 800, color: HEADER.ink, margin: '0 0 6px', letterSpacing: '-.02em' }}>
            {t('browsePage.title')}
          </h1>
          <p style={{ fontSize: 15, color: HEADER.muted, margin: '0 0 26px' }}>
            {t('browsePage.subtitle')}
          </p>

          <div style={{ fontSize: 13, fontWeight: 800, color: HEADER.ink, letterSpacing: '.06em', marginBottom: 10 }}>
            {t('browsePage.specialityLabel')}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" style={{ gap: 10 }}>
            {SPECIALITIES.map(s => (
              <a key={s.id} href={WA_LINK} target="_blank" rel="noreferrer"
                onClick={() => track('whatsapp_click', { path: '/browse', speciality: s.id })}
                style={{
                  background: '#fff', border: `1px solid ${HEADER.border}`, borderRadius: 14,
                  padding: '14px 16px', display: 'block',
                }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: HEADER.ink }}>
                  {lang === 'hi' ? s.hi : s.en}
                </div>
                <div style={{ fontSize: 12.5, color: HEADER.muted, marginTop: 2 }}>
                  {lang === 'hi' ? s.en : s.hi}
                </div>
              </a>
            ))}
          </div>
        </div>
      </PageShell>

      <SiteFooter />
    </div>
  )
}
