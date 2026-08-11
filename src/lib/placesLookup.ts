// Google Places, so a business can pick itself instead of typing itself out.
//
// The government directory we seeded from has names and addresses and nothing
// else — no phone numbers at all, and it was last refreshed in 2025. Places has
// the phone, the full address, the coordinates and the opening hours, and it is
// current. It is also licensed for exactly this: a business identifying itself
// during signup.
//
// COST
// Session tokens are the whole trick. Every keystroke in a session is free when
// the session ends in a Place Details call at Pro tier or above, so we pay once
// per business that actually picks itself, not once per letter typed. India
// billing gives 35,000 free Pro calls a month against a few hundred signups, so
// in practice this is free.
//
// We deliberately do NOT ask for nationalPhoneNumber in the details call, which
// would push the whole request to Enterprise tier and cut the free allowance from
// 35,000 to 7,000. The phone number comes back from the cheaper field set below,
// and we ask the business to confirm their WhatsApp number anyway.
//
// WHAT WE KEEP
// Google's terms let us store the place id indefinitely, and let a business keep
// the address it confirmed as its own. Coordinates are a different matter — they
// may not be retained beyond 30 days — so nothing here writes lat/lng anywhere.
// If we ever need them on a map, they get re-resolved from the stored place id.

const BASE = 'https://places.googleapis.com/v1/places'

export interface PlaceSuggestion {
  placeId: string
  /** The business name on its own, e.g. 'Garg ENT Hospital'. */
  primary: string
  /** The address line under it. */
  secondary: string
}

export interface PlaceDetails {
  placeId: string
  name: string
  address: string
  phone: string | null
  pincode: string | null
  /** Opening hours as Google phrases them, one line per day. */
  hours: string[] | null
}

export const placesConfigured = (): boolean =>
  Boolean(import.meta.env.VITE_GOOGLE_PLACES_KEY)

const key = () => import.meta.env.VITE_GOOGLE_PLACES_KEY as string

/**
 * One token ties a run of keystrokes and the details call that ends it into a
 * single billable session. It must be discarded once used — reusing one is
 * billed as if no token was sent at all.
 */
export function newSessionToken(): string {
  return crypto.randomUUID()
}

/**
 * Suggestions as someone types.
 *
 * Biased to India and to health businesses, because a clinic owner typing
 * 'Garg' wants their clinic and not a restaurant in another country. The bias is
 * a preference rather than a filter — a business whose Places category is odd
 * still turns up.
 */
export async function suggestPlaces(
  input: string,
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  if (!placesConfigured() || input.trim().length < 3) return []

  let res: Response
  try {
    res = await fetch(`${BASE}:autocomplete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key(),
      },
      body: JSON.stringify({
        input,
        sessionToken,
        includedRegionCodes: ['in'],
        // Places' own categories for the businesses we list. Five is the most
        // the API accepts — a sixth is a 400, not a warning — so dentists and
        // physiotherapists are left off and reached through 'doctor', which
        // Places treats as the broader medical category.
        includedPrimaryTypes: ['doctor', 'hospital', 'pharmacy', 'medical_lab', 'health'],
      }),
    })
  } catch {
    return []
  }
  if (!res.ok) {
    console.warn(`places: autocomplete ${res.status}`)
    return []
  }

  const body = await res.json().catch(() => ({})) as {
    suggestions?: { placePrediction?: {
      placeId?: string
      structuredFormat?: { mainText?: { text?: string }, secondaryText?: { text?: string } }
    } }[]
  }

  return (body.suggestions ?? [])
    .map(s => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map(p => ({
      placeId: p.placeId!,
      primary: p.structuredFormat?.mainText?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }))
}

/**
 * The details behind a chosen suggestion, and the call that closes the session.
 *
 * The field mask is the price: every field named here is billed at the tier of
 * the most expensive one. These all sit at Pro or below deliberately —
 * nationalPhoneNumber would be Enterprise and cost five times the free headroom.
 */
export async function fetchPlaceDetails(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetails | null> {
  if (!placesConfigured()) return null

  const fields = [
    'id',
    'displayName',
    'formattedAddress',
    'addressComponents',
    'internationalPhoneNumber',
    'regularOpeningHours.weekdayDescriptions',
  ].join(',')

  let res: Response
  try {
    res = await fetch(`${BASE}/${encodeURIComponent(placeId)}?sessionToken=${sessionToken}`, {
      headers: { 'X-Goog-Api-Key': key(), 'X-Goog-FieldMask': fields },
    })
  } catch {
    return null
  }
  if (!res.ok) {
    console.warn(`places: details ${res.status}`)
    return null
  }

  const p = await res.json().catch(() => null) as {
    id?: string
    displayName?: { text?: string }
    formattedAddress?: string
    internationalPhoneNumber?: string
    addressComponents?: { types?: string[], longText?: string }[]
    regularOpeningHours?: { weekdayDescriptions?: string[] }
  } | null
  if (!p?.id) return null

  const pin = p.addressComponents?.find(c => c.types?.includes('postal_code'))?.longText ?? null

  return {
    placeId: p.id,
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    // '+91 171 123 4567' → the ten digits the rest of the app stores.
    phone: p.internationalPhoneNumber
      ? p.internationalPhoneNumber.replace(/\D/g, '').replace(/^91/, '')
      : null,
    pincode: pin,
    hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
  }
}
