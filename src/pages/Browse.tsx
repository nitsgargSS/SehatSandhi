import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SPECIALITIES, PIN_CODES } from '../types'
import { useLanguage } from '../i18n/LanguageContext'
import { specialityUrl } from '../lib/links'
import SiteHeader, { HeaderLink, HeaderCta, shopIcon, PageShell, HEADER } from '../components/SiteHeader'
import SiteFooter from '../components/SiteFooter'

// Pick a speciality and an area, and go to the listings.
//
// This page exists because the two that do the actual work — the search results
// and a clinic's profile — had no way in. They were reachable only by typing a
// URL containing an internal speciality code (/speciality/PAED/jagadhri), so in
// practice a patient never saw a single doctor's name anywhere on this site: the
// homepage offered WhatsApp and nothing else. The listing pages, their ratings
// and their schema.org markup were finished work nobody could get to.
//
// Area first, then speciality: "who is near me" is the question a patient
// actually arrives with, and it is the one that rules out most of the grid.

export default function Browse() {
  const { t, lang } = useLanguage()
  const [area, setArea] = useState(PIN_CODES[0])

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

          {/* Area — a row of chips rather than a <select>, so the choice and the
              options are both visible without a tap. */}
          <div style={{ fontSize: 13, fontWeight: 800, color: HEADER.ink, letterSpacing: '.06em', marginBottom: 10 }}>
            {t('browsePage.areaLabel')}
          </div>
          <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 30 }}>
            {PIN_CODES.map(p => {
              const on = p.code === area.code
              return (
                <button key={p.code} onClick={() => setArea(p)}
                  style={{
                    fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    padding: '8px 14px', borderRadius: 999,
                    background: on ? HEADER.green : '#fff',
                    color: on ? '#fff' : HEADER.muted,
                    border: `1px solid ${on ? HEADER.green : HEADER.border}`,
                  }}>
                  {p.area}
                </button>
              )
            })}
          </div>

          <div style={{ fontSize: 13, fontWeight: 800, color: HEADER.ink, letterSpacing: '.06em', marginBottom: 10 }}>
            {t('browsePage.specialityLabel')}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" style={{ gap: 10 }}>
            {SPECIALITIES.map(s => (
              <Link key={s.id} to={specialityUrl(s.id, area.area)}
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
              </Link>
            ))}
          </div>
        </div>
      </PageShell>

      <SiteFooter />
    </div>
  )
}
