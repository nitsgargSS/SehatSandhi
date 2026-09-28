import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'
import { getAnalyticsConsent, setAnalyticsConsent, initAnalyticsFromConsent } from '../lib/ga'
import { optedOut } from '../lib/analytics'

// Asks once whether Google Analytics may run (DPDP Act 2023: analytics is not
// needed to provide the service, so it needs consent). "No thanks" is as easy
// as "Allow", nothing is pre-ticked, and the site works the same either way.
// A browser sending Do Not Track is taken as "no" and never asked. The footer's
// "Analytics settings" reopens this (window event 'ss:analytics-settings').

export const OPEN_ANALYTICS_SETTINGS = 'ss:analytics-settings'

export default function AnalyticsConsent() {
  const { lang } = useLanguage()
  const hi = lang === 'hi'
  const [open, setOpen] = useState(false)

  useEffect(() => {
    initAnalyticsFromConsent()
    if (!optedOut() && getAnalyticsConsent() === null) setOpen(true)
    const reopen = () => setOpen(true)
    window.addEventListener(OPEN_ANALYTICS_SETTINGS, reopen)
    return () => window.removeEventListener(OPEN_ANALYTICS_SETTINGS, reopen)
  }, [])

  if (!open) return null
  const choose = (v: 'granted' | 'denied') => { setAnalyticsConsent(v); setOpen(false) }
  const current = getAnalyticsConsent()

  return (
    <div role="dialog" aria-label={hi ? 'एनालिटिक्स की अनुमति' : 'Analytics consent'}
      style={{ position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 60, maxWidth: 560, margin: '0 auto',
        background: '#fff', border: '1px solid #e2ddd0', borderRadius: 14, boxShadow: '0 18px 40px -20px rgba(20,32,28,.45)',
        padding: '14px 16px', fontSize: 13.5, color: '#14201c', lineHeight: 1.5 }}>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>{hi ? 'क्या हम Google Analytics इस्तेमाल करें?' : 'May we use Google Analytics?'}</div>
      <div style={{ color: '#5f6b64' }}>
        {hi
          ? 'इससे हमें पता चलता है कि कितने लोग साइट पर आते हैं और कौन से पेज काम के हैं। Google कुकीज़ लगाता है और डेटा भारत के बाहर प्रोसेस हो सकता है। मना करने पर भी साइट पूरी तरह काम करेगी।'
          : 'It tells us how many people visit and which pages help. Google sets cookies and may process the data outside India. The site works exactly the same if you say no.'}
        {' '}<Link to="/privacy" style={{ color: '#0f6b4a', fontWeight: 700 }}>{hi ? 'गोपनीयता नीति' : 'Privacy Policy'}</Link>
        {current && <div style={{ marginTop: 4, fontSize: 12.5 }}>{hi ? 'अभी:' : 'Currently:'} <b>{current === 'granted' ? (hi ? 'अनुमति है' : 'allowed') : (hi ? 'मना है' : 'not allowed')}</b></div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => choose('denied')}
          style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid #e2ddd0', background: '#fff', fontWeight: 800, cursor: 'pointer', color: '#14201c' }}>
          {hi ? 'नहीं, धन्यवाद' : 'No thanks'}</button>
        <button onClick={() => choose('granted')}
          style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: '#0f6b4a', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
          {hi ? 'अनुमति दें' : 'Allow'}</button>
      </div>
    </div>
  )
}
