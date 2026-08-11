// Where the person filling in the form is, so business search can prefer what is
// near them.
//
// Separate from lib/location.ts, which asks the same browser API for a different
// reason: that one reports where visitors are coming from and sends the answer to
// us. This one keeps the coordinates in the tab and hands them to Places so a
// clinic in Yamunanagar stops competing with one in Chennai. Nothing here is
// stored or transmitted anywhere except as a search bias to Google.
//
// Asked for on the registration form specifically. A business typing its own
// name is the one moment where knowing where they are standing genuinely
// improves the answer — "sn eye" matched clinics in Delhi, Chennai, Patna and
// Panvel before this existed.

import { useEffect, useState } from 'react'

export interface Bias {
  latitude: number
  longitude: number
  /** Metres. Places treats this as a preference, not a filter. */
  radius: number
}

/** 50km — a plausible catchment for a clinic, and wide enough to cover a district. */
const RADIUS_M = 50_000

type Status = 'asking' | 'granted' | 'denied' | 'unavailable'

export function useNearbyBias(): { bias: Bias | null; status: Status } {
  const [bias, setBias] = useState<Bias | null>(null)
  const [status, setStatus] = useState<Status>('asking')

  useEffect(() => {
    if (!('geolocation' in navigator)) { setStatus('unavailable'); return }

    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (cancelled) return
        setBias({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          radius: RADIUS_M,
        })
        setStatus('granted')
      },
      // Declining is an ordinary answer, not an error. Search still works; it
      // just goes back to searching the whole country.
      () => { if (!cancelled) setStatus('denied') },
      // No high-accuracy flag: this only has to be right to within a town, and
      // waking the GPS costs battery for precision nobody here needs. A fix up
      // to five minutes old is fine.
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    )
    return () => { cancelled = true }
  }, [])

  return { bias, status }
}
