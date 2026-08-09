// Business lookup through Google Places.
//
// Unlike the registry search next to it, this one suggests as you type. Session
// tokens make every keystroke in a session free — only the details call at the
// end is billed — so there is no reason to make someone press a button, and
// suggestions that narrow as you type are how everyone expects an address field
// to behave.
//
// Debounced at 300ms all the same. Not for cost, but because firing a request
// per character is rude to a service we depend on and produces results that
// flicker faster than anyone can read them.

import { useEffect, useRef, useState } from 'react'
import { Check, X, MapPin } from 'lucide-react'
import { BIZ } from './shared'
import { Spinner } from '../../components/Loading'
import {
  suggestPlaces, fetchPlaceDetails, newSessionToken,
  type PlaceSuggestion, type PlaceDetails,
} from '../../lib/placesLookup'

const DEBOUNCE_MS = 300

export function PlacesSearch({
  label, hint, placeholder, value, onChange, onPick,
}: {
  label: string
  hint?: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onPick: (d: PlaceDetails) => void
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<PlaceDetails | null>(null)
  const [open, setOpen] = useState(false)

  // One token spans the keystrokes and the details call that ends them. A fresh
  // one is minted after each pick, because a used token bills as if absent.
  const session = useRef<string>(newSessionToken())
  // Suggestions can arrive out of order; only the newest query may render.
  const latest = useRef(0)

  useEffect(() => {
    if (picked || value.trim().length < 3) { setSuggestions([]); return }
    const seq = ++latest.current
    const t = setTimeout(async () => {
      setBusy(true)
      const found = await suggestPlaces(value, session.current)
      if (seq === latest.current) { setSuggestions(found); setOpen(true) }
      setBusy(false)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value, picked])

  const choose = async (s: PlaceSuggestion) => {
    setOpen(false)
    setBusy(true)
    const details = await fetchPlaceDetails(s.placeId, session.current)
    // The session ended with that call, used or not; the next search needs its own.
    session.current = newSessionToken()
    setBusy(false)
    if (!details) return
    setPicked(details)
    setSuggestions([])
    onPick(details)
  }

  const clear = () => {
    setPicked(null)
    setSuggestions([])
    session.current = newSessionToken()
  }

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: BIZ.ink, marginBottom: 7 }}>
        {label}
      </label>

      <div style={{ position: 'relative' }}>
        <input
          value={value}
          onChange={e => { onChange(e.target.value); if (picked) clear() }}
          onFocus={() => suggestions.length && setOpen(true)}
          // A click on a suggestion has to land before the list closes.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          autoComplete="off"
          style={{
            width: '100%', padding: '12px 14px', paddingRight: 38,
            border: `1px solid ${BIZ.inputBorder}`, borderRadius: 12,
            fontSize: 16, fontFamily: 'inherit', outline: 'none', background: '#fdfbf6',
          }} />
        {busy && (
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
            <Spinner size={18} label="Searching" />
          </span>
        )}
      </div>

      {hint && !picked && <p style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 6 }}>{hint}</p>}

      {picked && (
        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 10,
          background: BIZ.chipBg, border: `1px solid ${BIZ.green}33`,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <Check size={16} style={{ color: BIZ.chipText, flex: '0 0 auto', marginTop: 2 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.chipText }}>{picked.name}</div>
            <div style={{ fontSize: 12, color: BIZ.muted, overflowWrap: 'anywhere' }}>{picked.address}</div>
            {picked.phone && (
              <div style={{ fontSize: 12, color: BIZ.muted }}>Phone {picked.phone}</div>
            )}
          </div>
          <button type="button" onClick={clear} title="Not this one"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: BIZ.muted, padding: 2 }}>
            <X size={15} />
          </button>
        </div>
      )}

      {open && suggestions.length > 0 && !picked && (
        <div style={{
          position: 'absolute', zIndex: 30, left: 0, right: 0, marginTop: 6,
          border: `1px solid ${BIZ.inputBorder}`, borderRadius: 12, overflow: 'hidden',
          background: '#fff', boxShadow: '0 10px 30px rgba(20,32,28,.10)',
        }}>
          {suggestions.map(s => (
            <button key={s.placeId} type="button"
              // onMouseDown, not onClick: blur fires first and would close the
              // list out from under the click.
              onMouseDown={e => { e.preventDefault(); choose(s) }}
              style={{
                display: 'flex', gap: 9, alignItems: 'flex-start', width: '100%',
                textAlign: 'left', padding: '10px 13px', border: 'none',
                borderTop: `1px solid ${BIZ.border}`, background: '#fff',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              <MapPin size={15} style={{ color: BIZ.mutedWarm, flex: '0 0 auto', marginTop: 3 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: BIZ.ink }}>{s.primary}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: BIZ.muted, overflowWrap: 'anywhere' }}>{s.secondary}</span>
              </span>
            </button>
          ))}
          {/* Required wherever Places results are shown outside a Google map. */}
          <div style={{ padding: '6px 13px', fontSize: 11, color: BIZ.mutedWarm, borderTop: `1px solid ${BIZ.border}` }}>
            Results from Google
          </div>
        </div>
      )}
    </div>
  )
}
