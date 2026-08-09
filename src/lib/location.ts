import { activeConfig } from './env'
import { optedOut, sessionId } from './analytics'

// Where this visit is, reported to our own backend and kept current.
//
// Two accuracies, and the visitor decides which one we get:
//
//   • Always — the edge function reads the city off the request IP. Nobody is
//     asked anything, nothing is prompted, and the answer is a city at best.
//   • Only if asked for and granted — the browser's own permission dialog gives
//     exact coordinates. See requestPreciseLocation, which nothing calls yet on
//     purpose: a prompt on page load is the fastest way to get it denied
//     permanently, and a denial is remembered by the browser. Call it from a
//     control the visitor pressed, like a "near me" search.
//
// The page never sends its own city or IP — the coarse path is derived
// server-side precisely so it cannot be forged (see 0034). All of it is
// fire-and-forget and swallows its own errors: this is analytics, and analytics
// never gets to be the reason a patient cannot see a phone number.

const ENDPOINT = 'record-visitor-location'

/** Bumps last_active_at. Long enough to be cheap, short enough that a 30-minute
 *  "live" window is never wrong by more than a heartbeat. */
const HEARTBEAT_MS = 5 * 60 * 1000

let started = false
let timer: ReturnType<typeof setInterval> | undefined

/**
 * POST to the function.
 *
 * keepalive so a ping fired as the tab closes still leaves. Errors are
 * swallowed whole — an unconfigured backend in local dev, an offline phone and
 * a provider outage are all the same non-event to a patient.
 */
async function send(coords?: { latitude: number; longitude: number }): Promise<boolean> {
  const { url, anon } = activeConfig()
  if (!url || !anon) return false

  try {
    const res = await fetch(`${url}/functions/v1/${ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ sessionId: sessionId(), ...coords }),
      keepalive: true,
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Start reporting this visit's location, once per page load.
 *
 * Records immediately, then on a heartbeat while the tab is in the foreground.
 * A backgrounded tab stops pinging — it is not an active visitor, and counting
 * it as one is how a "live visitors" number becomes a number of open tabs.
 */
export function startLocationTracking(): void {
  if (started || optedOut()) return
  started = true

  void send()

  const beat = () => { if (document.visibilityState === 'visible') void send() }
  timer = setInterval(beat, HEARTBEAT_MS)

  // Coming back to a tab left open for an hour should count immediately rather
  // than at the end of the next interval.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void send()
  })
}

export function stopLocationTracking(): void {
  if (timer) clearInterval(timer)
  timer = undefined
  started = false
}

/**
 * Ask the browser for exact coordinates and upgrade this visit's row.
 *
 * Call this from something the visitor actually pressed. Resolves false if they
 * decline, if the browser has no geolocation, or if the fix times out — all of
 * which are ordinary outcomes, not errors worth surfacing. Once upgraded, the
 * heartbeat's coarse pings will not downgrade the row back to city level; 0034
 * enforces that server-side.
 */
export function requestPreciseLocation(): Promise<boolean> {
  if (optedOut() || !('geolocation' in navigator)) return Promise.resolve(false)

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        void send({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
          .then(resolve)
      },
      () => resolve(false),
      // No high-accuracy flag: it wakes the GPS chip and costs battery for
      // precision beyond what a clinic search needs. A cached fix up to five
      // minutes old is fine for "which part of town is this".
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    )
  })
}
