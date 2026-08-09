import { supabase } from './supabase'

// Anonymous product analytics.
//
// Records what a business needs to know — was I listed, was I opened, did anyone
// tap WhatsApp — and nothing that identifies a person. No IP, no coordinates, no
// device fingerprint. See supabase/migrations/0013_site_events.sql.
//
// Every call is fire-and-forget and swallows its own errors. Analytics must
// never be the reason a patient cannot see a doctor's phone number.

export type SiteEventType =
  | 'page_view'
  | 'search'
  | 'doctor_view'
  | 'doctor_impression'
  | 'whatsapp_click'
  | 'call_click'
  | 'book_start'
  | 'business_lead'

interface EventFields {
  path?: string
  doctorId?: string | null
  speciality?: string | null
  pinCode?: string | null
}

/**
 * A random id for this browser tab, kept in sessionStorage.
 *
 * sessionStorage, not localStorage, on purpose: it dies with the tab, so two
 * visits on different days are not linkable to each other. It exists only to
 * separate "one person opened six listings" from "six people opened one".
 */
export function sessionId(): string {
  const KEY = 'ss_sid'
  try {
    let id = sessionStorage.getItem(KEY)
    if (!id) {
      id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, '')
      sessionStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // Private mode with storage disabled — still count the event, just without
    // being able to group it with the rest of the visit.
    return 'nostore'
  }
}

function deviceType(): 'mobile' | 'tablet' | 'desktop' {
  const w = window.innerWidth
  if (w < 640) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

/** Host only. A full referrer can carry search terms and sometimes identifiers. */
function referrerHost(): string | null {
  try {
    if (!document.referrer) return null
    const h = new URL(document.referrer).hostname
    return h === window.location.hostname ? null : h
  } catch {
    return null
  }
}

/** Honour Do Not Track. These numbers are not worth overriding someone's choice. */
export function optedOut(): boolean {
  const dnt = (navigator as unknown as { doNotTrack?: string }).doNotTrack
    ?? (window as unknown as { doNotTrack?: string }).doNotTrack
  return dnt === '1' || dnt === 'yes'
}

export function track(type: SiteEventType, fields: EventFields = {}): void {
  if (optedOut()) return
  try {
    void supabase.from('site_events').insert({
      event_type: type,
      session_id: sessionId(),
      // Path without the query string: a search page's query can contain what
      // someone typed, and the structured columns already carry what we need.
      path: (fields.path ?? window.location.pathname).slice(0, 200),
      doctor_id: fields.doctorId ?? null,
      speciality: fields.speciality ?? null,
      pin_code: fields.pinCode ?? null,
      referrer_host: referrerHost(),
      device_type: deviceType(),
    }).then(undefined, () => { /* analytics must never surface to a user */ })
  } catch {
    /* Supabase unconfigured in local dev — nothing to record against */
  }
}

/**
 * Record that a set of listings was shown, one row each.
 *
 * Impressions are what make "you appeared in 240 searches but were opened 12
 * times" possible, which is the number that tells a business its photo or its
 * hours are the problem. Deduplicated per session per doctor per page so that
 * scrolling a list does not inflate the count.
 */
const seenThisSession = new Set<string>()

export function trackImpressions(
  doctorIds: string[],
  fields: Omit<EventFields, 'doctorId'> = {},
): void {
  if (optedOut() || !doctorIds.length) return
  const path = fields.path ?? window.location.pathname
  const fresh = doctorIds.filter(id => {
    const key = `${path}:${id}`
    if (seenThisSession.has(key)) return false
    seenThisSession.add(key)
    return true
  })
  if (!fresh.length) return

  try {
    void supabase.from('site_events').insert(
      fresh.map(id => ({
        event_type: 'doctor_impression',
        session_id: sessionId(),
        path: path.slice(0, 200),
        doctor_id: id,
        speciality: fields.speciality ?? null,
        pin_code: fields.pinCode ?? null,
        referrer_host: referrerHost(),
        device_type: deviceType(),
      })),
    ).then(undefined, () => {})
  } catch { /* as above */ }
}
