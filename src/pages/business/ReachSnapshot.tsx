import { useMemo } from 'react'
import { MapPin, MessageCircle, CalendarCheck, Stethoscope, Check } from 'lucide-react'
import { useServiceAreas } from '../../hooks/useServiceAreas'
import { usePricing } from '../../hooks/usePricing'
import { BIZ } from './shared'
import { money } from '../../lib/format'
import CountUp from '../../components/CountUp'
import { Skeleton } from '../../components/Loading'

// "Live coverage" — the hero card on the business page.
//
// It used to be a heat map of the district's 12 largest pincodes, captioned
// "across 12 pincodes in Yamuna Nagar district". That undersold the offer twice:
// the plan includes EVERY pincode, and the bot searches the whole district
// (0110) — so a count of rows in service_areas read as a limit that is not
// there. The card now says where we are live and what a business gets, and
// states no pincode count at all.
//
// Everything is still read, never asserted:
//   • the district(s) come from service_areas, so a new district appears here
//     the day it goes live, with nothing to edit;
//   • residents is the sum of service_areas.population — worded as "in our live
//     areas", because that is exactly what it counts;
//   • the price and "every pincode" come from the active pricing plan, so a tier
//     plan would say "from ₹X/month" instead.
// No upcoming districts are named (decided 28 Sep 2026): "expanding to nearby
// districts" only.

// Indian short form: 3,88,200 → "3.9L", 1,20,00,000 → "1.2Cr".
function inShort(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

export default function ReachSnapshot() {
  const { areas, loading } = useServiceAreas()
  const { plan, tiers } = usePricing()

  const districts = useMemo(
    () => [...new Set(areas.map(a => a.district).filter(Boolean))],
    [areas],
  )
  const residents = areas.reduce((s, a) => s + (a.population || 0), 0)
  const everyPin = plan.mode === 'flat_all_pincodes'
  const flat = plan.mode !== 'pincode_tiers'
  const fromPrice = flat ? plan.monthly_price ?? 0
    : Math.min(...tiers.map(t => t.monthly_price).filter(p => p > 0), Infinity)

  const where = districts.length === 0 ? ''
    : districts.length === 1 ? `${districts[0]} district`
    : districts.length === 2 ? `${districts[0]} & ${districts[1]} districts`
    : `${districts.length} districts`

  const stat = (big: React.ReactNode, small: string) => (
    <div style={{ background: BIZ.cream, border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: '12px 12px 11px' }}>
      <div style={{ fontSize: 'clamp(19px,4.6vw,23px)', fontWeight: 800, color: BIZ.green, letterSpacing: '-.02em', lineHeight: 1.1 }}>{big}</div>
      <div style={{ fontSize: 11.5, color: BIZ.mutedWarm, marginTop: 5, lineHeight: 1.35 }}>{small}</div>
    </div>
  )

  return (
    <div style={{ background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 22, padding: 'clamp(18px,5vw,26px)', boxShadow: '0 30px 60px -35px rgba(20,32,28,.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: '#16a34a', boxShadow: '0 0 0 4px rgba(22,163,74,.15)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#8a8172', textTransform: 'uppercase', letterSpacing: '.1em' }}>Live coverage</span>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
          <Skeleton width="70%" height={30} radius={8} />
          <Skeleton width="45%" height={14} radius={6} delay={0.08} />
        </div>
      ) : (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <MapPin className="w-6 h-6" style={{ color: BIZ.green, flex: '0 0 auto' }} />
            <div style={{ fontSize: 'clamp(22px,5.4vw,28px)', fontWeight: 800, color: BIZ.ink, letterSpacing: '-.02em', lineHeight: 1.15 }}>
              {where || 'Your district'}
            </div>
          </div>
          <div style={{ fontSize: 14.5, color: BIZ.muted, marginTop: 6, marginLeft: 33 }}>
            {everyPin ? 'Every pincode included — one flat price' : 'Pick the pincodes you want to reach'}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 18 }}>
        {stat(loading ? '—' : <><CountUp value={residents} format={inShort} />+</>, 'residents in our live areas')}
        {stat(fromPrice && Number.isFinite(fromPrice) ? `${flat ? '' : 'from '}${money(fromPrice)}` : '—',
              everyPin ? 'a month, all pincodes' : 'a month')}
        {stat('24×7', 'booking on WhatsApp')}
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
        {[
          { icon: <MessageCircle className="w-4 h-4" />, t: 'Families nearby find you on WhatsApp, in Hindi or English' },
          { icon: <CalendarCheck className="w-4 h-4" />, t: 'Bookings arrive straight at your desk — no missed calls' },
          { icon: <Stethoscope className="w-4 h-4" />, t: 'OPD, IPD and in-house pharmacy software included' },
        ].map(r => (
          <li key={r.t} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: '#3f4a44', lineHeight: 1.5 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: BIZ.chipBg, color: BIZ.chipText, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{r.icon}</span>
            <span style={{ paddingTop: 3 }}>{r.t}</span>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px dashed ${BIZ.border}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: BIZ.mutedWarm }}>
        <Check className="w-4 h-4" style={{ color: BIZ.green }} />
        Expanding to nearby districts — register now to be first in your area.
      </div>
    </div>
  )
}
