// Shared server-side pricing. Both compute-price (for the UI's live summary) and
// razorpay-order (for the amount actually charged) call this, so the price the
// business sees and the price they pay can never diverge, and neither is ever
// taken from the client.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface PriceLine {
  pin_code: string
  area_name: string
  population: number
  tier_number: number
  tier_name: string
  monthly_price: number
}

export type BillingModel = 'pincode_monthly' | 'commission'

export interface BillingRule {
  vertical: string
  model: BillingModel
  commissionPercent: number
  commissionBasis: string | null
}

export interface PriceResult {
  pincodes: string[]
  count: number
  monthlyTotal: number
  residents: number
  topTier: { tier_number: number; tier_name: string } | null
  breakdown: PriceLine[]
  /** How this listing pays. 'commission' verticals are never charged upfront. */
  model: BillingModel
  commissionPercent: number
  commissionBasis: string | null
}

// Fallback rules, used only if vertical_billing is missing or empty (a DB that
// hasn't had the table applied yet). Deliberately fails SAFE: a commission
// vertical must never fall back to being charged a monthly fee.
const FALLBACK_RULES: Record<string, BillingRule> = {
  doctors:   { vertical: 'doctors',   model: 'pincode_monthly', commissionPercent: 0,  commissionBasis: null },
  hospital:  { vertical: 'hospital',  model: 'pincode_monthly', commissionPercent: 0,  commissionBasis: null },
  lab:       { vertical: 'lab',       model: 'pincode_monthly', commissionPercent: 0,  commissionBasis: null },
  pharmacy:  { vertical: 'pharmacy',  model: 'commission',      commissionPercent: 10, commissionBasis: 'order value' },
  insurance: { vertical: 'insurance', model: 'commission',      commissionPercent: 10, commissionBasis: 'your IRDA commission' },
  ambulance: { vertical: 'ambulance', model: 'commission',      commissionPercent: 10, commissionBasis: 'non-emergency transport billing' },
}

const SPECIALITY_TO_VERTICAL: Record<string, string> = {
  GEN: 'doctors', HOSPITAL: 'hospital', LAB: 'lab',
  PHARMACY: 'pharmacy', INSURANCE: 'insurance', AMBULANCE: 'ambulance',
}

const DEFAULT_RULE: BillingRule = {
  vertical: 'doctors', model: 'pincode_monthly', commissionPercent: 0, commissionBasis: null,
}

/**
 * Which billing rule applies to this request.
 *
 * When a doctorId is given the vertical comes from that row's speciality — the
 * client's hint is ignored, so nobody can talk their way onto (or off of) the
 * commission model. The hint is only trusted pre-signup, for the live quote,
 * where no money moves.
 */
export async function resolveBillingRule(
  supabase: SupabaseClient,
  doctorId?: string | null,
  verticalHint?: string | null,
): Promise<BillingRule> {
  let vertical: string | null = null

  if (doctorId) {
    const { data: doc } = await supabase
      .from('doctors')
      .select('speciality')
      .eq('id', doctorId)
      .maybeSingle()
    const spec = (doc as { speciality?: string } | null)?.speciality
    if (spec) vertical = SPECIALITY_TO_VERTICAL[spec.toUpperCase()] ?? null
  }
  if (!vertical && verticalHint) vertical = String(verticalHint)
  if (!vertical) return DEFAULT_RULE

  const { data: row } = await supabase
    .from('vertical_billing')
    .select('vertical, billing_model, commission_percent, commission_basis')
    .eq('vertical', vertical)
    .eq('is_active', true)
    .maybeSingle()

  if (row) {
    const r = row as {
      vertical: string; billing_model: string
      commission_percent: number | string | null; commission_basis: string | null
    }
    return {
      vertical: r.vertical,
      model: r.billing_model === 'commission' ? 'commission' : 'pincode_monthly',
      commissionPercent: Number(r.commission_percent ?? 0),
      commissionBasis: r.commission_basis,
    }
  }
  return FALLBACK_RULES[vertical] ?? DEFAULT_RULE
}

export async function computePrice(
  supabase: SupabaseClient,
  rawPincodes: string[],
  doctorId?: string | null,
  verticalHint?: string | null,
): Promise<PriceResult> {
  const rule = await resolveBillingRule(supabase, doctorId, verticalHint)
  const ruleFields = {
    model: rule.model,
    commissionPercent: rule.model === 'commission' ? rule.commissionPercent : 0,
    commissionBasis: rule.model === 'commission' ? rule.commissionBasis : null,
  }

  const pincodes = [...new Set(rawPincodes.map(String))]
  const empty: PriceResult = {
    pincodes: [], count: 0, monthlyTotal: 0, residents: 0, topTier: null, breakdown: [], ...ruleFields,
  }
  if (!pincodes.length) return empty

  const { data: areas, error: aErr } = await supabase
    .from('service_areas')
    .select('pin_code, area_name, population, tier_number')
    .in('pin_code', pincodes)
    .eq('is_active', true)
  if (aErr) throw new Error(`service_areas: ${aErr.message}`)

  const tierNums = [...new Set((areas ?? []).map((a: { tier_number: number }) => a.tier_number))]
  const { data: tiers, error: tErr } = await supabase
    .from('pricing_tiers')
    .select('tier_number, tier_name, monthly_price')
    .in('tier_number', tierNums.length ? tierNums : [-1])
  if (tErr) throw new Error(`pricing_tiers: ${tErr.message}`)

  const tierByNum = new Map(
    (tiers ?? []).map((t: { tier_number: number; tier_name: string; monthly_price: number }) => [t.tier_number, t]),
  )

  const overrideByTier = new Map<number, number>()
  if (doctorId) {
    const { data: ov } = await supabase
      .from('doctor_pricing_overrides')
      .select('tier_number, monthly_price')
      .eq('doctor_id', doctorId)
    ov?.forEach((o: { tier_number: number; monthly_price: number }) =>
      overrideByTier.set(o.tier_number, o.monthly_price)
    )
  }

  let monthlyTotal = 0
  let residents = 0
  let topTier: { tier_number: number; tier_name: string; monthly_price: number } | null = null

  // Commission verticals pay nothing for coverage, so every line prices at ₹0 —
  // but we still walk the areas, because reach (residents) is what they're
  // choosing and what the summary shows them.
  const commission = rule.model === 'commission'

  const breakdown: PriceLine[] = (areas ?? []).map(
    (a: { pin_code: string; area_name: string; population: number | null; tier_number: number }) => {
      const tier = tierByNum.get(a.tier_number)
      const price = commission ? 0 : (overrideByTier.get(a.tier_number) ?? tier?.monthly_price ?? 0)
      monthlyTotal += price
      residents += a.population ?? 0
      if (!commission && (!topTier || price > topTier.monthly_price)) {
        topTier = { tier_number: a.tier_number, tier_name: tier?.tier_name ?? `Tier ${a.tier_number}`, monthly_price: price }
      }
      return {
        pin_code: a.pin_code,
        area_name: a.area_name,
        population: a.population ?? 0,
        tier_number: a.tier_number,
        tier_name: tier?.tier_name ?? `Tier ${a.tier_number}`,
        monthly_price: price,
      }
    },
  )

  return {
    pincodes: breakdown.map((b) => b.pin_code),
    count: breakdown.length,
    monthlyTotal,
    residents,
    topTier: topTier ? { tier_number: topTier.tier_number, tier_name: topTier.tier_name } : null,
    breakdown,
    ...ruleFields,
  }
}
