import { useMemo, useRef, useState } from 'react'
import { useServiceAreas, ServiceArea } from '../../hooks/useServiceAreas'
import { BIZ, FALLBACK_AREAS } from './shared'
import { money, num } from '../../lib/format'
import CountUp from '../../components/CountUp'
import { Skeleton } from '../../components/Loading'

// "Your reach snapshot" — a population-density heat map of every pincode in the
// active district, driven by Supabase service_areas + pricing_tiers. Tiles carry
// no text; hovering/tapping a tile reveals its details in a fixed-height panel
// below the grid, so the layout never shifts.

// Indian short form: 6,20,000 → "6.2L", 1,20,00,000 → "1.2Cr".
function inShort(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(n % 1e7 === 0 ? 0 : 1)}Cr`
  if (n >= 1e5) return `${(n / 1e5).toFixed(n % 1e5 === 0 ? 0 : 1)}L`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(n)
}

// Shading ramp. Gamma 0.55 keeps small villages visibly distinct instead of all
// washing out; cap max alpha at 0.78 so the darkest tiles never go solid (which
// would flatten the ramp and kill any overlaid ink).
function tileAlpha(population: number, maxPopulation: number): number {
  if (maxPopulation <= 0) return 0.16
  const a = 0.16 + 0.62 * Math.pow(population / maxPopulation, 0.55)
  return Math.min(a, 0.78)
}

// Show a tidy 3×4 grid: the district's top 12 pincodes by population.
const MAX_TILES = 12

export default function ReachSnapshot() {
  const { areas, loading } = useServiceAreas()
  const [hoveredPin, setHoveredPin] = useState<string | null>(null)
  // whether the tapped tile was active at pointer-down (see onPointerDown below)
  const preActiveRef = useRef(false)

  // Real data when available, else the design fallback.
  //
  // The fallback is a DIFFERENT district-wide total from the real one — 6.2L
  // against 3.5L — so rendering it while the query was still in flight made the
  // headline figure visibly correct itself a moment after load. A number that
  // changes in front of you is worse than a number that arrives late,
  // especially this one: it is the reach a business is being asked to pay for.
  // `loading` below holds the figure until it is true.
  const pins = useMemo(() => {
    const source: ServiceArea[] = areas.length
      ? areas
      : FALLBACK_AREAS.map(a => ({
          pin_code: a.pin_code, area_name: a.area_name, district: 'Yamunanagar', state: 'Haryana',
          population: a.pop, tier_number: a.tier_number, tier_name: a.tier_name, monthly_price: a.monthly_price,
          premium_slot_1_weekly: 0, premium_slot_2_weekly: 0, premium_slot_3_weekly: 0,
        }))
    // one district (the pilot); sort by population desc, keep the top 12
    return [...source].sort((a, b) => b.population - a.population).slice(0, MAX_TILES)
  }, [areas])

  const district = pins[0]?.district || 'Yamunanagar'
  const totalPop = pins.reduce((s, p) => s + p.population, 0)
  const maxPop = pins.reduce((m, p) => Math.max(m, p.population), 0)
  const active = pins.find(p => p.pin_code === hoveredPin) || null

  return (
    <div style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 22, padding: 'clamp(18px,5vw,26px)', boxShadow: '0 30px 60px -35px rgba(20,32,28,.35)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#8a8172', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 18 }}>Your reach snapshot</div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, minHeight: 'clamp(40px,10vw,52px)' }}>
        {loading ? (
          // Reserve the line rather than collapsing it, so nothing below jumps
          // when the figure lands.
          <Skeleton width="3.2ch" height={34} radius={8} />
        ) : (
          <span style={{ fontSize: 'clamp(34px,9vw,44px)', fontWeight: 800, color: '#0E9F6E', letterSpacing: '-.02em' }}>
            <CountUp value={totalPop} format={inShort} />
          </span>
        )}
        <span style={{ fontSize: 15, fontWeight: 700, color: BIZ.muted }}>residents</span>
      </div>
      <div style={{ fontSize: 13, color: '#8a8172', marginBottom: 20 }}>
        {loading ? '\u00a0' : `across ${pins.length} pincodes in ${district} district`}
      </div>

      {/* heat grid — clearing hover on the container, not per tile, avoids flicker */}
      <div
        onMouseLeave={() => setHoveredPin(null)}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}
      >
        {pins.map(p => {
          const on = p.pin_code === hoveredPin
          const alpha = tileAlpha(p.population, maxPop)
          return (
            <button
              key={p.pin_code}
              type="button"
              aria-label={p.pin_code}
              onMouseEnter={() => setHoveredPin(p.pin_code)}
              onFocus={() => setHoveredPin(p.pin_code)}
              // Record whether this tile was already active BEFORE focus/enter
              // fires on this interaction, so onClick can toggle correctly. On a
              // touch tap there is no hover: focus sets the pin, then onClick must
              // KEEP it (pre-state inactive) — not immediately clear it. A second
              // tap (pre-state active) clears it.
              onPointerDown={() => { preActiveRef.current = hoveredPin === p.pin_code }}
              onClick={() => setHoveredPin(preActiveRef.current ? null : p.pin_code)}
              style={{
                // min 44px keeps each tile a comfortable touch target on phones
                aspectRatio: '1', minHeight: 44, borderRadius: 10, border: 'none', padding: 0, cursor: 'pointer',
                background: `rgba(14, 159, 110, ${alpha})`,
                transform: on ? 'scale(1.09)' : 'scale(1)',
                boxShadow: on ? '0 6px 16px -6px rgba(14,159,110,.65)' : 'none',
                transition: 'transform .12s ease',
                outlineOffset: 2,
              }}
            />
          )
        })}
      </div>

      {/* detail panel — fixed min-height so hover never shifts layout */}
      <div style={{ background: '#f7f3ea', borderRadius: 14, padding: '13px 15px', marginTop: 16, minHeight: 76, boxSizing: 'border-box' }}>
        {active ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#14201c' }}>{active.area_name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#0E9F6E' }}>{active.pin_code}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#5f6b64', marginTop: 4 }}>{num(active.population)} residents</div>
            <div style={{ fontSize: 12, color: '#8a8172', marginTop: 2 }}>{active.tier_name} tier · {money(active.monthly_price)}/mo</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#14201c' }}>Tap a pincode</div>
            <div style={{ fontSize: 12.5, color: '#5f6b64', marginTop: 4 }}>Darker = more residents</div>
            <div style={{ fontSize: 12, color: '#8a8172', marginTop: 2 }}>{pins.length} pincodes live in {district} district</div>
          </>
        )}
      </div>
    </div>
  )
}
