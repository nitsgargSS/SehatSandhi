// Google Analytics 4 — loaded only with the visitor's consent.
//
// Until 29 Sep 2026 the tag sat in index.html and ran for everyone. Under the
// DPDP Act 2023 analytics is not needed to provide the service, so it now waits
// for "Allow" on the consent banner (components/AnalyticsConsent.tsx); the
// choice is kept in localStorage and can be changed from the footer. Without
// consent every call here is a no-op, exactly as when the tag is blocked.
// Our own first-party events (lib/analytics.ts) are anonymous, per-tab and
// honour Do Not Track; they are described in the Privacy Policy.
//
// GA is deliberately the shallower of our two analytics systems. It answers
// "how much traffic, from where, on what" and it answers it about aggregates.
// Anything a business needs about its own listing — impressions, views, taps —
// lives in site_events, where we control the retention and the privacy posture.
// See lib/analytics.ts.

type GtagArgs =
  | ['event', string, Record<string, unknown>?]
  | ['config', string, Record<string, unknown>?]
  | ['js', Date]

interface GtagWindow extends Window {
  gtag?: (...args: GtagArgs) => void
}

export const GA_MEASUREMENT_ID = 'G-TDG8G7ZXZ5'

const CONSENT_KEY = 'ss_analytics_consent'
export type AnalyticsConsent = 'granted' | 'denied' | null

export function getAnalyticsConsent(): AnalyticsConsent {
  try {
    const v = localStorage.getItem(CONSENT_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch { return null }
}

let loaded = false
/** Adds the GA tag to the page. Only ever called after consent. */
function loadGa(): void {
  if (loaded || typeof document === 'undefined') return
  loaded = true
  const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void }
  w.dataLayer = w.dataLayer || []
  // eslint-disable-next-line prefer-rest-params
  w.gtag = function () { w.dataLayer.push(arguments) }
  w.gtag('js', new Date())
  w.gtag('config', GA_MEASUREMENT_ID)
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
  document.head.appendChild(s)
}

/** Record the visitor's choice. Withdrawing stops GA from the next page load
 *  (a tag already running cannot be unloaded) and removes its cookies now. */
export function setAnalyticsConsent(v: 'granted' | 'denied'): void {
  try { localStorage.setItem(CONSENT_KEY, v) } catch { /* private mode: ask again next time */ }
  if (v === 'granted') { loadGa(); return }
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim()
    if (name === '_ga' || name.startsWith('_ga_')) {
      const host = window.location.hostname
      for (const domain of ['', host, `.${host.replace(/^www\./, '')}`]) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`
      }
    }
  }
}

/** Start GA at boot if the visitor allowed it earlier. */
export function initAnalyticsFromConsent(): void {
  if (getAnalyticsConsent() === 'granted') loadGa()
}

function gtag(...args: GtagArgs): void {
  const w = window as GtagWindow
  // Absent when the tag was blocked, offline, or stripped in a test env.
  if (typeof w.gtag !== 'function') return
  try {
    w.gtag(...args)
  } catch {
    /* analytics must never surface to a user */
  }
}

/**
 * One GA page_view for a client-side navigation.
 *
 * The snippet's own config call covers the first load only; a SPA route change
 * does not reload the document, so without this GA would report every visit as
 * a single-page session.
 */
export function gaPageView(path: string): void {
  gtag('event', 'page_view', {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    page_title: document.title,
  })
}

/** An arbitrary GA event. Keep params non-identifying — GA is not the place for
 *  anything about a specific patient, and sending it there would put personal
 *  data outside the retention rules we set ourselves. */
export function gaEvent(name: string, params: Record<string, unknown> = {}): void {
  gtag('event', name, params)
}
