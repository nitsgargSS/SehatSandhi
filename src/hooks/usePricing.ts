import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PRICING_TIERS, PricingTier, VerticalKey, VERTICALS } from '../pages/business/shared'
import type { PricingMode } from '../lib/businessApi'

// Live pricing for the public pages.
//
// Before this hook, /business rendered a hardcoded PRICING_TIERS array, so
// changing a price meant a code deploy — which defeats the point of having
// switchable plans. Now the landing page and the wizard read the plan that is
// actually in force, and toggling in admin changes the site with no deploy.
//
// Falls back to the constants in shared.ts when Supabase is unconfigured or the
// pricing tables have not been created yet, so local dev still renders.

export interface ActivePlan {
  code: string
  label: string
  description: string | null
  mode: PricingMode
  monthly_price: number | null
  default_months: number
  min_months: number
  max_months: number
  applies_to_verticals: string[] | null
  suspend_commission: boolean
  /** Quoted all-in (tax carved out) rather than tax added on top. */
  price_includes_gst: boolean
}

export interface VerticalBillingRow {
  vertical: VerticalKey
  monthly_enabled: boolean
  commission_enabled: boolean
  commission_percent: number
  commission_basis: string | null
}

// Matches the pincode_tiers seed in supabase/migrations/0006_pricing_plans.sql, used only when
// the DB is unreachable.
const FALLBACK_PLAN: ActivePlan = {
  code: 'pincode_tiers',
  label: 'Pay for reach — priced by pincode',
  description: 'Each pincode is priced by its population. Your total is the sum of the pincodes you pick.',
  mode: 'pincode_tiers',
  monthly_price: null,
  default_months: 1,
  min_months: 1,
  max_months: 12,
  applies_to_verticals: null,
  suspend_commission: false,
  price_includes_gst: false,
}

// Derived from the VERTICALS constants, which still describe today's default:
// doctors/hospital/lab monthly, the other three on commission.
const FALLBACK_VERTICALS: VerticalBillingRow[] = VERTICALS.map(v => ({
  vertical: v.key,
  monthly_enabled: v.billing === 'pincode_monthly',
  commission_enabled: v.billing === 'commission',
  commission_percent: v.commissionPercent ?? 0,
  commission_basis: v.commissionBasis ?? null,
}))

/** "Population 15,000–50,000" from the tier's own bounds; either end may be open. */
function populationLabel(min: number | null, max: number | null): string {
  const n = (v: number) => v.toLocaleString('en-IN')
  if (min != null && max != null) return `Population ${n(min)}–${n(max)}`
  if (min != null) return `Population ${n(min)}+`
  if (max != null) return `Population under ${n(max)}`
  return ''
}

export interface PricingState {
  plan: ActivePlan
  tiers: PricingTier[]
  verticals: VerticalBillingRow[]
  loading: boolean
  /** True when we are showing the built-in fallback rather than live DB values. */
  isFallback: boolean
}

export function usePricing(): PricingState {
  const [plan, setPlan] = useState<ActivePlan>(FALLBACK_PLAN)
  const [tiers, setTiers] = useState<PricingTier[]>(PRICING_TIERS)
  const [verticals, setVerticals] = useState<VerticalBillingRow[]>(FALLBACK_VERTICALS)
  const [loading, setLoading] = useState(true)
  const [isFallback, setIsFallback] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [planRes, tierRes, vbRes] = await Promise.all([
          supabase.from('active_pricing_plan').select('*').maybeSingle(),
          supabase.from('pricing_tiers')
            .select('tier_number, tier_name, monthly_price, min_population, max_population')
            .eq('is_active', true).order('monthly_price'),
          supabase.from('vertical_billing').select('*').eq('is_active', true),
        ])
        if (cancelled) return

        const p = planRes.data as Record<string, unknown> | null
        let gotLive = false

        if (p && p.code) {
          setPlan({
            code: String(p.code),
            label: String(p.label ?? p.code),
            description: (p.description as string) ?? null,
            mode: (p.mode as PricingMode) ?? 'pincode_tiers',
            monthly_price: p.monthly_price == null ? null : Number(p.monthly_price),
            default_months: Number(p.default_months ?? 1),
            min_months: Number(p.min_months ?? 1),
            max_months: Number(p.max_months ?? 12),
            applies_to_verticals: (p.applies_to_verticals as string[]) ?? null,
            suspend_commission: Boolean(p.suspend_commission),
            price_includes_gst: Boolean(p.price_includes_gst),
          })
          gotLive = true
        }

        // Render the tiers the DB actually has, not a local list with DB prices
        // merged in. Production runs 13 tiers (₹500–₹30,000); the constants in
        // shared.ts describe 4 (₹400–₹3,000). Merging by tier_number paired a
        // live tier's name with unrelated hardcoded copy — "Village" labelled
        // "Population 100,000+". The population band is derived from the DB's own
        // min/max columns so the label can never contradict the tier.
        if (tierRes.data?.length) {
          const rows = tierRes.data as {
            tier_number: number; tier_name: string; monthly_price: number
            min_population: number | null; max_population: number | null
          }[]
          setTiers(rows.map(t => ({
            tier_number: t.tier_number,
            tier_name: t.tier_name,
            monthly_price: t.monthly_price,
            popLabel: populationLabel(t.min_population, t.max_population),
            blurb: '',
          })))
          gotLive = true
        }

        if (vbRes.data?.length) {
          setVerticals((vbRes.data as Record<string, unknown>[]).map(r => ({
            vertical: r.vertical as VerticalKey,
            monthly_enabled: r.monthly_enabled !== false,
            commission_enabled: Boolean(r.commission_enabled),
            commission_percent: Number(r.commission_percent ?? 0),
            commission_basis: (r.commission_basis as string) ?? null,
          })))
          gotLive = true
        }

        setIsFallback(!gotLive)
      } catch {
        // keep the fallbacks
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  return { plan, tiers, verticals, loading, isFallback }
}

// ── helpers shared by the landing page and the wizard ──

/** Does this vertical owe a monthly fee under the given plan? */
export function monthlyAppliesTo(
  plan: ActivePlan,
  vb: VerticalBillingRow | undefined,
): boolean {
  if (!vb) return true
  const covered = !plan.applies_to_verticals || plan.applies_to_verticals.includes(vb.vertical)
  if (!covered) return false
  const flat = plan.mode !== 'pincode_tiers'
  return vb.monthly_enabled || (flat && plan.suspend_commission)
}

/** The commission actually charged right now — 0 when the plan suspends it. */
export function commissionFor(
  plan: ActivePlan,
  vb: VerticalBillingRow | undefined,
): { percent: number; basis: string | null; suspended: boolean } {
  if (!vb || !vb.commission_enabled) return { percent: 0, basis: null, suspended: false }
  const covered = !plan.applies_to_verticals || plan.applies_to_verticals.includes(vb.vertical)
  const suspended = plan.suspend_commission && covered
  return {
    percent: suspended ? 0 : vb.commission_percent,
    basis: suspended ? null : vb.commission_basis,
    suspended,
  }
}

/** Monthly amount for a given plan + pincode selection, for local/offline quoting. */
export function localMonthlyTotal(
  plan: ActivePlan,
  tiers: PricingTier[],
  selected: { tier_number: number }[],
): number {
  if (plan.mode === 'flat_all_pincodes') return plan.monthly_price ?? 0
  if (plan.mode === 'flat_per_pincode') return (plan.monthly_price ?? 0) * selected.length
  const priceByTier = new Map(tiers.map(t => [t.tier_number, t.monthly_price]))
  return selected.reduce((sum, s) => sum + (priceByTier.get(s.tier_number) ?? 0), 0)
}
