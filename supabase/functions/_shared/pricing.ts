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

export interface PriceResult {
  pincodes: string[]
  count: number
  monthlyTotal: number
  residents: number
  topTier: { tier_number: number; tier_name: string } | null
  breakdown: PriceLine[]
}

export async function computePrice(
  supabase: SupabaseClient,
  rawPincodes: string[],
  doctorId?: string | null,
): Promise<PriceResult> {
  const pincodes = [...new Set(rawPincodes.map(String))]
  const empty: PriceResult = { pincodes: [], count: 0, monthlyTotal: 0, residents: 0, topTier: null, breakdown: [] }
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

  const breakdown: PriceLine[] = (areas ?? []).map(
    (a: { pin_code: string; area_name: string; population: number | null; tier_number: number }) => {
      const tier = tierByNum.get(a.tier_number)
      const price = overrideByTier.get(a.tier_number) ?? tier?.monthly_price ?? 0
      monthlyTotal += price
      residents += a.population ?? 0
      if (!topTier || price > topTier.monthly_price) {
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
  }
}
