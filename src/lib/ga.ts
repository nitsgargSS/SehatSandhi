// Google Analytics 4 — the typed edge of the snippet in index.html.
//
// The tag itself is loaded there, in the document head, because GA wants to be
// running before the app boots. This module exists so the rest of the code can
// send events without casting window on every call site, and so a build without
// the tag (a local dev run with an ad blocker on, say) is a no-op rather than a
// crash.
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

/** The measurement id, matching the snippet in index.html. */
export const GA_MEASUREMENT_ID = 'G-TDG8G7ZXZ5'

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
