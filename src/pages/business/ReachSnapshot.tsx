import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, MessageCircle, CalendarCheck, Stethoscope, Check, Search, Info, ChevronDown, LocateFixed } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { optedOut, sessionId } from '../../lib/analytics'
import { usePricing } from '../../hooks/usePricing'
import { BIZ } from './shared'
import CountUp from '../../components/CountUp'

// The coverage card — the hero card on the business page.
//
// It used to lead with our first live district ("Yamuna Nagar district, 3.9L+
// residents"), which read as if Sehatsandhi were a Yamuna Nagar product. It now
// leads with the VISITOR's place (decided 28 Sep 2026): they type a city,
// district, state or pincode — "Gurgaon", "Delhi", "122001" — and the headline,
// the numbers and the pincode list all become that place (sehat_area_search,
// 0170). Before a search it shows the national reach, and our live districts
// only as a quiet line at the bottom.
//
// Everything is read, never asserted: districts and pincodes from India Post's
// directory, population from Census 2011 (labelled so, with the disclaimer), our
// own patient and clinic counts only once they are big enough to mean something,
// and whether one plan covers every pincode from the active pricing plan. No
// rupee amount is shown here (decided 29 Sep 2026): prices live on the pricing
// section, where the terms around them are.
//
// A link can open the card on a place: /business?area=gurgaon.
//
// "Use my location": only when the visitor presses it — a permission prompt on
// page load is mostly refused, and the browser then remembers the refusal for
// good. Once they have allowed it, later visits fill the card in by themselves
// (Permissions API says "granted", so there is no prompt). The position is
// rounded to ~1 km and sent once to BigDataCloud's free client-side reverse
// geocoder, which names the district; nothing is stored. Anyone can still type
// another place — "I am in Yamuna Nagar, show me Chandigarh".
//
// Each search is logged (sehat_log_area_search, 0170) — the place and how it
// was searched, never coordinates — for "Area interest" in the admin Leads
// panel: where the demand is coming from. Skipped under Do Not Track.

// Indian short form: 3,88,200 → "3.9L", 1,20,00,000 → "1.2Cr".
function inShort(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

interface PinRow { pin: string; area: string | null; live: boolean }
interface DistrictRow {
  district: string; state: string; census_population: number | null
  pincode_count: number; live: boolean; pincodes: PinRow[] | null
}
interface AreaResult {
  found: boolean
  reason?: 'invalid' | 'unknown' | 'choose'
  query?: string
  options?: { district: string; state: string }[]
  kind?: 'district' | 'city' | 'state'
  label?: string
  state?: string
  pin_code?: string | null
  area?: string | null
  districts?: DistrictRow[]
  district_count?: number
  pincode_count?: number
  census_population?: number | null
  census_partial?: boolean
  live?: boolean
  patients?: number | null
  businesses?: number | null
}
interface Totals { pincodes: number; districts: number; live_districts: string[] }

// Coordinates → {district, state}. BigDataCloud's administrative level 5 is the
// district in India ("Gurugram district"); the city is the fallback.
async function districtAt(): Promise<{ district: string; state: string | null }> {
  const pos = await new Promise<GeolocationPosition>((ok, fail) =>
    navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 12000, maximumAge: 30 * 60 * 1000 }))
  const lat = pos.coords.latitude.toFixed(2), lng = pos.coords.longitude.toFixed(2)
  const r = await fetch(`https://api-bdc.io/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
  if (!r.ok) throw new Error('lookup')
  const d = await r.json() as { countryCode?: string; city?: string; locality?: string; principalSubdivision?: string
    localityInfo?: { administrative?: { adminLevel?: number; name?: string }[] } }
  if (d.countryCode && d.countryCode !== 'IN') throw new Error('abroad')
  const lvl5 = d.localityInfo?.administrative?.find(a => a.adminLevel === 5)?.name?.replace(/\s+district$/i, '')
  const district = lvl5 || d.city || d.locality
  if (!district) throw new Error('lookup')
  return { district, state: d.principalSubdivision || null }
}

type Method = 'typed' | 'location' | 'chip' | 'link'

function logSearch(query: string, method: Method, r: AreaResult) {
  if (optedOut() || r.reason === 'choose') return  // a "which one?" is logged when they pick
  const d = r.districts?.length === 1 ? r.districts[0] : null
  supabase.rpc('sehat_log_area_search', {
    p_session: sessionId(), p_query: query, p_method: method, p_found: r.found,
    p_kind: r.kind ?? null, p_label: r.label ?? null, p_district: d?.district ?? null, p_state: r.state ?? null, p_live: r.live ?? null,
  }).then(() => undefined, () => undefined)
}

const QUICK = ['Gurugram', 'Delhi', 'Mumbai', 'Bengaluru', 'Pune', 'Jaipur']

function PinChips({ pins, highlight }: { pins: PinRow[]; highlight?: string | null }) {
  const [all, setAll] = useState(false)
  const shown = all ? pins : pins.slice(0, 18)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {shown.map(p => (
        <span key={p.pin} title={p.area ?? undefined}
          style={{ fontSize: 12, fontWeight: 700, padding: '4px 8px', borderRadius: 8, fontVariantNumeric: 'tabular-nums',
            background: p.pin === highlight ? BIZ.green : p.live ? BIZ.chipBg : '#fff',
            color: p.pin === highlight ? '#fff' : p.live ? BIZ.chipText : '#3f4a44',
            border: `1px solid ${p.pin === highlight ? BIZ.green : BIZ.border}` }}>
          {p.pin}{p.area ? <span style={{ fontWeight: 500, opacity: 0.8 }}> · {p.area}</span> : null}
        </span>
      ))}
      {pins.length > 18 && (
        <button onClick={() => setAll(!all)} style={{ fontSize: 12, fontWeight: 800, color: BIZ.green, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>
          {all ? 'Show fewer' : `+${pins.length - 18} more`}
        </button>
      )}
    </div>
  )
}

function DistrictRows({ rows, highlight }: { rows: DistrictRow[]; highlight?: string | null }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div style={{ border: `1px solid ${BIZ.border}`, borderRadius: 12, overflow: 'hidden' }}>
      {rows.map((d, i) => (
        <div key={d.district} style={{ borderTop: i ? `1px solid ${BIZ.border}` : 'none', background: '#fff' }}>
          <button onClick={() => d.pincodes && setOpen(open === d.district ? null : d.district)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', background: 'none', border: 'none', cursor: d.pincodes ? 'pointer' : 'default', textAlign: 'left', fontFamily: 'inherit' }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, flex: '0 0 auto', background: d.live ? '#16a34a' : BIZ.border }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: BIZ.ink }}>{d.district}</span>
            <span style={{ fontSize: 12, color: BIZ.muted, whiteSpace: 'nowrap' }}>
              {d.pincode_count} pincodes{d.census_population ? ` · ${inShort(d.census_population)} people` : ''}
            </span>
            {d.pincodes && <ChevronDown className="w-4 h-4" style={{ color: BIZ.mutedWarm, transform: open === d.district ? 'rotate(180deg)' : 'none', flex: '0 0 auto' }} />}
          </button>
          {open === d.district && d.pincodes && <div style={{ padding: '0 11px 11px' }}><PinChips pins={d.pincodes} highlight={highlight} /></div>}
        </div>
      ))}
    </div>
  )
}

export default function ReachSnapshot() {
  const { plan } = usePricing()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AreaResult | null>(null)
  const [err, setErr] = useState('')
  const [totals, setTotals] = useState<Totals | null>(null)
  const [locating, setLocating] = useState(false)
  const [nearYou, setNearYou] = useState(false)

  const everyPin = plan.mode === 'flat_all_pincodes'

  const search = async (text: string, state?: string, method: Method = 'typed') => {
    const mine = method === 'location'
    const v = text.trim()
    setErr(''); setNearYou(mine)
    if (v.replace(/[^a-zA-Z0-9]/g, '').length < 3) { setErr('Type a city, district or 6-digit pincode.'); return }
    setBusy(true)
    let { data, error } = await supabase.rpc('sehat_area_search', { p_q: v, p_state: state ?? null })
    // A geocoder's state spelling can differ from India Post's: retry without it.
    if (!error && state && !(data as AreaResult)?.found) ({ data, error } = await supabase.rpc('sehat_area_search', { p_q: v, p_state: null }))
    setBusy(false)
    if (error) { setErr('Could not check that just now — please try again.'); return }
    setRes(data as AreaResult)
    logSearch(v, method, data as AreaResult)
  }

  const useMyLocation = async (quiet = false) => {
    if (!('geolocation' in navigator)) { if (!quiet) setErr('This browser cannot share a location — type your city or pincode.'); return }
    setLocating(true); setErr('')
    try {
      const { district, state } = await districtAt()
      setQ(district)
      await search(district, state ?? undefined, 'location')
    } catch (e) {
      if (quiet) return
      const denied = (e as GeolocationPositionError)?.code === 1
      setErr(denied ? 'Location is off for this site — type your city or pincode instead.'
        : (e as Error)?.message === 'abroad' ? 'You seem to be outside India — type an Indian city or pincode.'
        : 'Could not find your location just now — type your city or pincode.')
    } finally { setLocating(false) }
  }

  const started = useRef(false)
  useEffect(() => {
    // Once per page: React's dev mode runs effects twice, which would log the
    // ?area= search twice.
    if (started.current) return
    started.current = true
    supabase.rpc('sehat_area_totals').then(({ data }) => { if (data) setTotals(data as Totals) })
    const area = new URLSearchParams(window.location.search).get('area')
    if (area) { setQ(area); search(area, undefined, 'link'); return }
    // Allowed before → fill in by itself, with no prompt. Never prompts here.
    navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      .then(p => { if (p.state === 'granted') useMyLocation(true) }).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const found = res?.found ? res : null
  const single = found?.districts?.length === 1 ? found.districts[0] : null

  const stat = (big: React.ReactNode, small: string) => (
    <div style={{ background: BIZ.cream, border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: '12px 12px 11px' }}>
      <div style={{ fontSize: 'clamp(19px,4.6vw,23px)', fontWeight: 800, color: BIZ.green, letterSpacing: '-.02em', lineHeight: 1.1 }}>{big}</div>
      <div style={{ fontSize: 11.5, color: BIZ.mutedWarm, marginTop: 5, lineHeight: 1.35 }}>{small}</div>
    </div>
  )

  const place = found
    ? found.kind === 'district' ? `${found.label} district` : found.label
    : 'Every district in India'
  const sub = found
    ? [found.kind !== 'district' ? `${found.district_count} districts` : null, found.state !== found.label ? found.state : null,
       everyPin ? 'every pincode covered in one plan' : 'choose the pincodes you want'].filter(Boolean).join(' · ')
    : totals ? `${totals.pincodes.toLocaleString('en-IN')} pincodes across ${totals.districts} districts — search yours` : 'Search your city or pincode'

  return (
    <div style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 22, padding: 'clamp(18px,5vw,26px)', boxShadow: '0 30px 60px -35px rgba(20,32,28,.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: '#16a34a', boxShadow: '0 0 0 4px rgba(22,163,74,.15)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#8a8172', textTransform: 'uppercase', letterSpacing: '.1em' }}>Your reach</span>
      </div>

      <form onSubmit={e => { e.preventDefault(); search(q) }} style={{ display: 'flex', gap: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value.slice(0, 60))}
          placeholder="City, district or pincode" aria-label="City, district or pincode" autoComplete="off"
          style={{ flex: 1, minWidth: 0, border: `1px solid ${BIZ.border}`, borderRadius: 11, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit', background: BIZ.cream }} />
        <button type="submit" disabled={busy}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: BIZ.green, color: '#fff', fontWeight: 800, fontSize: 14, padding: '10px 16px', borderRadius: 11, border: 'none', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <Search className="w-4 h-4" /> {busy ? 'Checking…' : 'Check'}
        </button>
      </form>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        <button onClick={() => useMyLocation()} disabled={locating}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: '#fff', background: BIZ.ink, border: 'none', borderRadius: 999, padding: '4px 11px', cursor: 'pointer', opacity: locating ? 0.6 : 1 }}>
          <LocateFixed className="w-3.5 h-3.5" /> {locating ? 'Finding you…' : 'Use my location'}
        </button>
        {QUICK.map(c => (
          <button key={c} onClick={() => { setQ(c); search(c, undefined, 'chip') }}
            style={{ fontSize: 12, fontWeight: 700, color: BIZ.chipText, background: BIZ.chipBg, border: 'none', borderRadius: 999, padding: '4px 10px', cursor: 'pointer' }}>{c}</button>
        ))}
      </div>
      {err && <div style={{ fontSize: 13, color: '#b42318', marginTop: 8 }}>{err}</div>}
      {res && !res.found && (
        <div style={{ fontSize: 13.5, color: BIZ.muted, marginTop: 10 }}>
          {res.reason === 'choose' ? (
            <>Which {res.query}?{' '}
              {res.options?.map(o => (
                <button key={o.district + o.state} onClick={() => search(o.district, o.state)}
                  style={{ margin: '4px 6px 0 0', fontSize: 12.5, fontWeight: 700, color: BIZ.green, background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 8, padding: '4px 9px', cursor: 'pointer' }}>
                  {o.district}, {o.state}</button>
              ))}</>
          ) : res.reason === 'invalid' ? 'Type a city or district name, or a 6-digit pincode.'
            : 'We could not find that in the India Post directory. Try the district name or a pincode.'}
        </div>
      )}

      <div style={{ margin: '18px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <MapPin className="w-6 h-6" style={{ color: BIZ.green, flex: '0 0 auto' }} />
          <div style={{ fontSize: 'clamp(22px,5.4vw,28px)', fontWeight: 800, color: BIZ.ink, letterSpacing: '-.02em', lineHeight: 1.15 }}>{place}</div>
        </div>
        <div style={{ fontSize: 14.5, color: BIZ.muted, marginTop: 6, marginLeft: 33 }}>
          {found && nearYou && <span style={{ fontWeight: 800, color: BIZ.green }}>Near you · </span>}{sub}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 14 }}>
        {found ? <>
          {stat(found.census_population ? <><CountUp value={found.census_population} format={inShort} />+</> : '—',
                found.census_population ? `people${found.census_partial ? ' (part)' : ''} · Census 2011` : 'population not published')}
          {stat(<CountUp value={found.pincode_count ?? 0} format={n => String(Math.round(n))} />, everyPin ? 'pincodes, all included' : 'pincodes')}
          {stat(everyPin ? '1 plan' : 'Your pick', everyPin ? 'covers every pincode here' : 'of pincodes to reach')}
        </> : <>
          {stat(totals ? totals.pincodes.toLocaleString('en-IN') : '—', 'pincodes, every district')}
          {stat(everyPin ? '1 plan' : 'Your pick', everyPin ? 'covers every pincode in your district' : 'of pincodes to reach')}
          {stat('24×7', 'booking on WhatsApp')}
        </>}
      </div>

      {found && (
        <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13.5, lineHeight: 1.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, marginTop: 6, flex: '0 0 auto', background: found.live ? '#16a34a' : '#d97706' }} />
            {found.live ? (
              <span style={{ color: BIZ.ink }}><b>Live now</b> — patients here can already find clinics on WhatsApp.{' '}
                <Link to="/business/register" style={{ color: BIZ.green, fontWeight: 800 }}>List yours →</Link></span>
            ) : (
              <span style={{ color: BIZ.ink }}><b>Opening soon</b> — be among the first clinics in {found.label}{found.census_population ? `, ahead of ${inShort(found.census_population)}+ people` : ''}.{' '}
                <Link to="/business/register" style={{ color: BIZ.green, fontWeight: 800 }}>Register free →</Link></span>
            )}
          </div>
          {(found.patients || found.businesses) ? (
            <div style={{ fontSize: 13, color: BIZ.muted }}>
              {[found.patients ? `${found.patients.toLocaleString('en-IN')} patients` : null,
                found.businesses ? `${found.businesses.toLocaleString('en-IN')} clinics & partners` : null].filter(Boolean).join(' · ')} already on Sehatsandhi here
            </div>
          ) : null}
          {single?.pincodes ? <PinChips pins={single.pincodes} highlight={found.pin_code} />
            : found.districts && <DistrictRows rows={found.districts} highlight={found.pin_code} />}
          <p style={{ display: 'flex', gap: 6, fontSize: 11.5, color: BIZ.mutedWarm, lineHeight: 1.5, margin: 0 }}>
            <Info className="w-3.5 h-3.5" style={{ flex: '0 0 auto', marginTop: 2 }} />
            <span>
              <b>About these figures.</b> Districts and pincodes are from India Post's All India Pincode Directory. Population is
              the Census of India 2011 district total, the most recent census published, so today's figure is likely higher;
              districts formed after 2011 have none, and a total marked "part" leaves them out. Numbers are indicative and close
              to accurate, not exact counts. Patient and clinic figures are Sehatsandhi's own, shown once there are enough to be meaningful.
              {nearYou && ' "Use my location" sends your approximate position (about 1 km) once to BigDataCloud to name your district; Sehatsandhi does not store it.'}
            </span>
          </p>
        </div>
      )}

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
        {[
          { icon: <MessageCircle className="w-4 h-4" />, t: 'Families nearby find you on WhatsApp, in Hindi or English' },
          { icon: <CalendarCheck className="w-4 h-4" />, t: 'Bookings arrive straight at your desk — no missed calls' },
          { icon: <Stethoscope className="w-4 h-4" />, t: 'OPD, IPD, lab and in-house pharmacy software included' },
        ].map(r => (
          <li key={r.t} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: '#3f4a44', lineHeight: 1.5 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: BIZ.chipBg, color: BIZ.chipText, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{r.icon}</span>
            <span style={{ paddingTop: 3 }}>{r.t}</span>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: BIZ.mutedWarm, lineHeight: 1.5 }}>
        <Check className="w-4 h-4" style={{ color: BIZ.green, flex: '0 0 auto', marginTop: 2 }} />
        <span>
          {totals?.live_districts?.length ? `Live today in ${totals.live_districts.join(', ')}. ` : ''}
          Opening district by district — register now to be first in yours.
        </span>
      </div>
    </div>
  )
}
