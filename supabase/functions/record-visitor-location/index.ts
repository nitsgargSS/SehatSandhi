// record-visitor-location — where the current visit is, kept current.
//
// The browser cannot write visitor_locations itself (0034 grants it no insert
// policy) and that is the point: a row here says "this session is at these
// coordinates", and those rows are what expansion decisions get made from. If
// the page could write them directly, anyone could put any session anywhere.
// So the coarse path never trusts the client for location at all — this
// function derives it from the IP of the request it is holding.
//
//   { sessionId }                       → look the IP up, store city-level
//   { sessionId, latitude, longitude }  → the visitor pressed Allow, store exact
//
// Deploy with --no-verify-jwt: patients are anonymous, there is no session.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      IPGEO_ENDPOINT — optional override of the lookup provider.
//
// WHY AN IP LOOKUP AND NOT A HEADER
// Vercel sets x-vercel-ip-city and friends, but those exist on requests to the
// site; this function is called on Supabase's own domain and never sees them.
// Deno Deploy exposes no geo data of its own, and ServeHandlerInfo.remoteAddr is
// the gateway, not the caller. x-forwarded-for is what actually arrives, so a
// lookup is the only route to a city.
//
// HOW MUCH TO BELIEVE THE RESULT
// Not much, individually. Indian mobile networks are behind carrier-grade NAT
// and providers disagree wildly on the same address — the same Jio IP resolves
// to different *states* depending who you ask. This is a distribution that is
// roughly right across thousands of visits, not a fact about any one visitor,
// which is also why the coordinates it produces are rounded to ~1 km before
// they are stored.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

// ipwho.is: https, no key, commercial use permitted, returns postal and
// coordinates for Indian addresses. Chosen over ip-api.com (no https on the
// free tier, non-commercial only) and ipinfo.io (its free tier is now
// country-only, which would give us nothing we do not already have).
const DEFAULT_ENDPOINT = 'https://ipwho.is'
const LOOKUP_TIMEOUT_MS = 2500

interface GeoResult {
  city: string | null
  region: string | null
  country: string | null
  postal: string | null
  latitude: number | null
  longitude: number | null
}

/**
 * The caller's address.
 *
 * x-forwarded-for is a client-settable header and is spoofable. That is
 * tolerable here and nowhere near an authorisation decision: the worst a forged
 * value buys is a wrong city on one anonymous row. Take the first entry — the
 * original client — and ignore the proxy chain appended after it.
 */
function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  if (first) return first
  return req.headers.get('x-real-ip')?.trim() || null
}

/** Private and loopback ranges — a lookup on these is a guaranteed miss. */
function isRoutable(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1') return false
  if (/^10\./.test(ip)) return false
  if (/^192\.168\./.test(ip)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false
  if (/^169\.254\./.test(ip)) return false
  if (/^f[cd]/i.test(ip)) return false // fc00::/7 unique-local
  return true
}

/** ~1 km. An IP cannot do better and storing more digits implies it can. */
function coarsen(n: number): number {
  return Math.round(n * 1000) / 1000
}

async function lookupIp(ip: string): Promise<GeoResult | null> {
  const base = Deno.env.get('IPGEO_ENDPOINT') || DEFAULT_ENDPOINT
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/${encodeURIComponent(ip)}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const b = await res.json()
    // ipwho.is answers 200 with { success: false } for addresses it cannot place.
    if (b?.success === false) return null
    const lat = typeof b?.latitude === 'number' ? coarsen(b.latitude) : null
    const lng = typeof b?.longitude === 'number' ? coarsen(b.longitude) : null
    return {
      city: b?.city ?? null,
      region: b?.region ?? null,
      country: b?.country_code ?? null,
      postal: b?.postal ?? null,
      latitude: lat,
      longitude: lng,
    }
  } catch {
    // Timeout, DNS, provider outage, rate limit. Analytics never gets to be the
    // reason a request fails, so this is a null and the caller carries on.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A coordinate the browser sent us. Rejects the out-of-range and the absurd. */
function validCoord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  // Matches what lib/analytics.ts generates: a uuid with the dashes stripped,
  // or the 'nostore' placeholder when storage is unavailable.
  if (!sessionId || sessionId.length > 64 || !/^[a-z0-9]+$/i.test(sessionId)) {
    return json({ error: 'bad sessionId' }, 400)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ error: 'not configured' }, 500)
  const supabase = createClient(url, key)

  const consented = validCoord(body.latitude, body.longitude)

  // The consented path still gets a city from the IP: a bare pair of
  // coordinates cannot be grouped into "visitors from Jagadhri", and reverse
  // geocoding every fix would be a second paid dependency for a label the IP
  // already gives us. The precise coordinates are the visitor's; the place name
  // around them is ours.
  const ip = clientIp(req)
  const geo = ip && isRoutable(ip) ? await lookupIp(ip) : null

  if (!consented && !geo) {
    // Nothing to record. Still a 200 — the page did nothing wrong and there is
    // nothing for it to retry.
    return json({ ok: true, recorded: false })
  }

  const { error } = await supabase.rpc('sehat_record_visitor_location', {
    p_session_id: sessionId,
    p_city: geo?.city ?? null,
    p_region: geo?.region ?? null,
    p_country: geo?.country ?? null,
    p_postal_code: geo?.postal ?? null,
    p_latitude: consented ? consented.lat : geo?.latitude ?? null,
    p_longitude: consented ? consented.lng : geo?.longitude ?? null,
    p_source: consented ? 'gps' : 'ip',
  })

  if (error) {
    console.error('record-visitor-location:', error.message)
    return json({ error: 'write failed' }, 500)
  }

  return json({ ok: true, recorded: true, source: consented ? 'gps' : 'ip' })
})
