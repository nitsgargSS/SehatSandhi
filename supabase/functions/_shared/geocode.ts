// A shared WhatsApp location → the PIN code (or failing that the town) it is in.
//
// The bot searches by PIN, so "tap to send where I am" needs this one lookup.
// Google when GOOGLE_GEOCODING_KEY is set — the better answer for Indian PIN
// codes; otherwise OpenStreetMap data through two public services that need no
// key and allow light use (a lookup now and then, an honest User-Agent):
// Nominatim, and Photon behind it — a shared server's address is sometimes
// turned away by one of them.
//
// Only the coordinates go out, rounded to about 100 m — never the phone number
// or anything else about who asked.

export interface Located {
  /** Six digits, when the lookup knew it. */
  pin: string | null
  /** The town or district, for when it did not: the search understands those too. */
  place: string | null
}

const asPin = (v: unknown) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return /^[1-9]\d{5}$/.test(d) ? d : null
}

async function viaGoogle(lat: number, lng: number, key: string): Promise<Located | null> {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&region=in&key=${key}`,
    { signal: AbortSignal.timeout(4000) },
  )
  if (!res.ok) { console.error(`geocode: google ${res.status}`); return null }
  // deno-lint-ignore no-explicit-any
  const j = await res.json() as any
  // deno-lint-ignore no-explicit-any
  const parts: any[] = (j?.results ?? []).flatMap((r: any) => r.address_components ?? [])
  const first = (type: string) => parts.find(p => (p.types ?? []).includes(type))?.long_name ?? null
  const pin = asPin(first('postal_code'))
  const place = first('locality') ?? first('administrative_area_level_3') ?? first('administrative_area_level_2')
  return pin || place ? { pin, place } : null
}

async function viaNominatim(lat: number, lng: number): Promise<Located | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1&accept-language=en`,
    { headers: { 'User-Agent': 'Sehatsandhi/1.0 (https://www.sehatsandhi.com)' }, signal: AbortSignal.timeout(4000) },
  )
  if (!res.ok) { console.error(`geocode: nominatim ${res.status}`); return null }
  // deno-lint-ignore no-explicit-any
  const a = ((await res.json()) as any)?.address ?? {}
  const pin = asPin(a.postcode)
  const place = a.city ?? a.town ?? a.village ?? a.city_district ?? a.county ?? a.state_district ?? null
  return pin || place ? { pin, place } : null
}

async function viaPhoton(lat: number, lng: number): Promise<Located | null> {
  const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`, {
    headers: { 'User-Agent': 'Sehatsandhi/1.0 (https://www.sehatsandhi.com)' }, signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) { console.error(`geocode: photon ${res.status}`); return null }
  // deno-lint-ignore no-explicit-any
  const a = ((await res.json()) as any)?.features?.[0]?.properties ?? {}
  const pin = asPin(a.postcode)
  const place = a.city ?? a.county ?? a.district ?? (a.type === 'city' ? a.name : null) ?? null
  return pin || place ? { pin, place } : null
}

/** One lookup that neither throws nor takes the others down with it. */
async function attempt(name: string, run: () => Promise<Located | null>): Promise<Located | null> {
  try { return await run() } catch (e) { console.error(`geocode: ${name}: ${String((e as Error).message ?? e)}`); return null }
}

/** null: nothing could be worked out (or the lookup is down). Never throws. */
export async function locate(latitude: number, longitude: number): Promise<Located | null> {
  const lat = Math.round(latitude * 1000) / 1000, lng = Math.round(longitude * 1000) / 1000
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const key = Deno.env.get('GOOGLE_GEOCODING_KEY')
  const found = [
    key ? await attempt('google', () => viaGoogle(lat, lng, key)) : null,
  ]
  // A PIN code is the answer; a town alone is kept only if nobody knows the PIN.
  for (const [name, run] of [['nominatim', () => viaNominatim(lat, lng)], ['photon', () => viaPhoton(lat, lng)]] as const) {
    if (found.some(f => f?.pin)) break
    found.push(await attempt(name, run))
  }
  return found.find(f => f?.pin) ?? found.find(f => f?.place) ?? null
}
