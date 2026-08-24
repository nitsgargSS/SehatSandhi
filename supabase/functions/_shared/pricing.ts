// Shared server-side pricing. Both compute-price (for the UI's live summary) and
// razorpay-order (for the amount actually charged) call this, so the price the
// business sees and the price they pay can never diverge, and neither is ever
// taken from the client.
//
// Two independent questions get answered here:
//
//   1. What do they pay per month?  → the ACTIVE PLAN decides the shape:
//        flat_all_pincodes — one price, however many pincodes they pick
//        flat_per_pincode  — that price for each pincode
//        pincode_tiers     — each pincode priced by its population tier
//      multiplied by the number of months they choose to pay upfront.
//
//   2. Do we also take a commission?  → vertical_billing decides, per vertical,
//      independently of the above. A vertical can pay monthly, a commission,
//      both, or neither. The active plan can suspend commission while it runs.
//
// The vertical is read from the business row whenever a businessId is
// known. The client's hint is only trusted before that row exists, for a quote.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { applyGst, extractGst, resolveRecipientState, resolveTaxSettings, TaxBreakdown } from './tax.ts'
import { applyHeadcount, headcountFor } from './headcount.ts'

export type PricingMode = 'flat_all_pincodes' | 'flat_per_pincode' | 'pincode_tiers'

export interface ModuleLine {
  code: string
  label: string
  monthly_price: number
}

export interface PriceLine {
  pin_code: string
  area_name: string
  population: number
  tier_number: number
  tier_name: string
  monthly_price: number
}

export interface PricingPlan {
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
  price_includes_gst: boolean
  /** Consultants covered by the base price, before extra_doctor_price applies. */
  included_doctors: number
  /** ₹/month per consultant beyond included_doctors. Used by base_plus_extra. */
  extra_doctor_price: number
  /** How headcount affects the bill: none | per_doctor | base_plus_extra. */
  doctor_billing: string
}

export interface PriceResult {
  // coverage
  pincodes: string[]
  count: number
  residents: number
  topTier: { tier_number: number; tier_name: string } | null
  breakdown: PriceLine[]

  // which plan produced this quote
  planCode: string | null
  planLabel: string | null
  mode: PricingMode

  // Clinical systems bought alongside the listing. Priced per business per
  // month and NOT multiplied by consultant headcount — see moduleTotal below.
  modules: ModuleLine[]
  moduleTotal: number

  // money — always a monthly rate times a number of months
  monthlyTotal: number
  months: number
  total: number
  defaultMonths: number
  minMonths: number
  maxMonths: number

  // headcount — a hospital is billed for its consultants, a solo practice is not
  doctorCount: number
  includedDoctors: number
  extraDoctors: number
  extraDoctorCost: number
  doctorBilling: string
  /** Headcount the coverage price is multiplied by. 1 for everything but per_doctor. */
  doctorMultiplier: number

  // commission, independent of the monthly fee above
  monthlyApplies: boolean
  commissionPercent: number
  commissionBasis: string | null
  commissionSuspended: boolean

  // GST on the term total. `total` above is the pre-tax figure; grandTotal is
  // what the customer actually pays.
  tax: TaxBreakdown
  priceIncludesGst: boolean
}

export interface VerticalBilling {
  vertical: string
  monthlyEnabled: boolean
  commissionEnabled: boolean
  commissionPercent: number
  commissionBasis: string | null
}

// Used only when the DB has not been set up yet, so a fresh project still
// prices sanely. Errs toward NOT charging a commission vertical a monthly fee.
const FALLBACK_VERTICALS: Record<string, VerticalBilling> = {
  clinic:    { vertical: 'clinic',    monthlyEnabled: true,  commissionEnabled: false, commissionPercent: 0,  commissionBasis: null },
  hospital:  { vertical: 'hospital',  monthlyEnabled: true,  commissionEnabled: false, commissionPercent: 0,  commissionBasis: null },
  lab:       { vertical: 'lab',       monthlyEnabled: true,  commissionEnabled: false, commissionPercent: 0,  commissionBasis: null },
  pharmacy:  { vertical: 'pharmacy',  monthlyEnabled: false, commissionEnabled: true,  commissionPercent: 10, commissionBasis: 'order value' },
  insurance: { vertical: 'insurance', monthlyEnabled: false, commissionEnabled: true,  commissionPercent: 10, commissionBasis: 'your IRDA commission' },
  ambulance: { vertical: 'ambulance', monthlyEnabled: false, commissionEnabled: true,  commissionPercent: 10, commissionBasis: 'non-emergency transport billing' },
}

const FALLBACK_PLAN: PricingPlan = {
  code: 'pincode_tiers', label: 'Pay for reach — priced by pincode', description: null,
  mode: 'pincode_tiers', monthly_price: null,
  default_months: 1, min_months: 1, max_months: 12,
  applies_to_verticals: null, suspend_commission: false, price_includes_gst: false,
  // Headcount pricing off in the fallback: a stale or unreachable plans table
  // must never invent a per-doctor charge nobody agreed to.
  included_doctors: 1, extra_doctor_price: 0, doctor_billing: 'none',
}

/** The plan in force right now: manual override, else the first open plan in the queue. */
export async function resolveActivePlan(supabase: SupabaseClient): Promise<PricingPlan> {
  const { data } = await supabase.from('active_pricing_plan').select('*').maybeSingle()
  const p = data as Record<string, unknown> | null
  if (!p || !p.code) return FALLBACK_PLAN
  return {
    code: String(p.code),
    label: String(p.label ?? p.code),
    description: (p.description as string) ?? null,
    mode: (p.mode as PricingMode) ?? 'pincode_tiers',
    monthly_price: p.monthly_price === null || p.monthly_price === undefined ? null : Number(p.monthly_price),
    default_months: Number(p.default_months ?? 1),
    min_months: Number(p.min_months ?? 1),
    max_months: Number(p.max_months ?? 12),
    applies_to_verticals: (p.applies_to_verticals as string[]) ?? null,
    suspend_commission: Boolean(p.suspend_commission),
    price_includes_gst: Boolean(p.price_includes_gst),
    included_doctors: Number(p.included_doctors ?? 1),
    extra_doctor_price: Number(p.extra_doctor_price ?? 0),
    doctor_billing: String(p.doctor_billing ?? 'none'),
  }
}

/**
 * Billable doctors at a business: its active affiliations in the doctor role.
 *
 * Each business pays for the doctors it advertises, so a visiting consultant at
 * four hospitals counts once for each of them — every one is separately listing,
 * and separately profiting from, that doctor.
 */
export async function resolveDoctorCount(
  supabase: SupabaseClient,
  businessId?: string | null,
): Promise<number> {
  if (!businessId) return 0
  const { data, error } = await supabase.rpc('sehat_business_doctor_count', { p_business_id: businessId })
  if (error || data == null) return 0
  return Number(data) || 0
}

/**
 * Which vertical this request is for, and how that vertical is billed.
 *
 * With a businessId the vertical is read off that row — the client's hint is
 * ignored, so nobody can talk their way onto a cheaper plan. The hint is only
 * used pre-signup, where no money moves.
 *
 * This used to map doctors.speciality through a hardcoded table, because the
 * vertical had nowhere of its own to live and 'PHARMACY' was stored as though it
 * were a medical speciality. It is a column now.
 */
export async function resolveVerticalBilling(
  supabase: SupabaseClient,
  businessId?: string | null,
  verticalHint?: string | null,
): Promise<VerticalBilling> {
  let vertical: string | null = null

  if (businessId) {
    const { data: biz } = await supabase
      .from('businesses').select('vertical').eq('id', businessId).maybeSingle()
    vertical = (biz as { vertical?: string } | null)?.vertical ?? null
  }
  if (!vertical && verticalHint) vertical = String(verticalHint)
  if (!vertical) vertical = 'clinic'

  const { data: row } = await supabase
    .from('vertical_billing')
    .select('vertical, monthly_enabled, commission_enabled, commission_percent, commission_basis')
    .eq('vertical', vertical)
    .eq('is_active', true)
    .maybeSingle()

  if (row) {
    const r = row as {
      vertical: string
      monthly_enabled: boolean | null
      commission_enabled: boolean | null
      commission_percent: number | string | null
      commission_basis: string | null
    }
    return {
      vertical: r.vertical,
      monthlyEnabled: r.monthly_enabled !== false,
      commissionEnabled: Boolean(r.commission_enabled),
      commissionPercent: Number(r.commission_percent ?? 0),
      commissionBasis: r.commission_basis,
    }
  }
  return FALLBACK_VERTICALS[vertical] ?? FALLBACK_VERTICALS.clinic
}

/** Clamp a requested term to what the plan allows. Never trust the client's months. */
export function clampMonths(plan: PricingPlan, requested?: number | null): number {
  // Falls back to the SHORTEST term, not default_months. default_months only
  // badges one option as best value in the picker (see migration 0010); using it
  // here would let an admin's marketing highlight decide how many months a
  // business is charged for when the client sends nothing — the amount charged
  // must never exceed what was explicitly asked for.
  const n = Number.isFinite(requested) && (requested as number) > 0
    ? Math.floor(requested as number)
    : plan.min_months
  return Math.min(plan.max_months, Math.max(plan.min_months, n))
}

/**
 * Turn the codes a buyer ticked into priced lines.
 *
 * The PRICE comes from the database every time, never from the request — the
 * client sends codes and nothing else, so a tampered payload can select a
 * different module but never a different amount. Unknown codes and disabled
 * ones fall out silently, which is what should happen when a module is retired
 * while somebody has the wizard open.
 */
export async function resolveModules(
  supabase: SupabaseClient,
  requested?: string[] | null,
): Promise<ModuleLine[]> {
  const codes = Array.from(new Set(
    (requested ?? []).filter((c): c is string => typeof c === 'string' && c.length < 40),
  ))
  if (!codes.length) return []

  const { data } = await supabase
    .from('care_modules')
    .select('code, label, monthly_price')
    .in('code', codes)
    .eq('is_enabled', true)
    .order('sequence')

  return (data ?? []).map((m: { code: string; label: string; monthly_price: number }) => ({
    code: m.code,
    label: m.label,
    monthly_price: Number(m.monthly_price ?? 0),
  }))
}

export async function computePrice(
  supabase: SupabaseClient,
  rawPincodes: string[],
  businessId?: string | null,
  verticalHint?: string | null,
  requestedMonths?: number | null,
  doctorCountHint?: number | null,
  /** care_modules codes the buyer ticked. Unknown or disabled codes are ignored. */
  requestedModules?: string[] | null,
): Promise<PriceResult> {
  const [plan, vb, taxSettings, recipientState, resolvedCount, moduleLines] = await Promise.all([
    resolveActivePlan(supabase),
    resolveVerticalBilling(supabase, businessId, verticalHint),
    resolveTaxSettings(supabase),
    resolveRecipientState(supabase, businessId),
    resolveDoctorCount(supabase, businessId),
    resolveModules(supabase, requestedModules),
  ])

  // With a listing, the headcount comes from the database and the client cannot
  // influence it — that is the number charged. Without one, a hospital is still
  // filling in the wizard and has no row to count, so the quote uses what they
  // have typed. Same shape as verticalHint: display-only, ignored the moment a
  // businessId resolves, and never able to decide an amount charged.
  // Restricted to the hospital vertical. A solo practice has no consultants to
  // count, and without this guard a crafted request could inflate its own quote
  // — harmless to the amount charged, which always comes from the database, but
  // it would show a doctor a price that is not theirs.
  const doctorCount = businessId
    ? resolvedCount
    : (vb.vertical === 'hospital'
        ? Math.max(0, Math.floor(Number(doctorCountHint) || 0))
        : 0)

  const months = clampMonths(plan, requestedMonths)

  // Does the monthly fee apply to this vertical at all? Two gates: the plan must
  // cover the vertical, and the vertical must be on monthly billing — unless the
  // plan is a flat offer that explicitly suspends commission, which is what
  // "₹1,000 for everyone" means.
  const planCoversVertical = !plan.applies_to_verticals
    || plan.applies_to_verticals.includes(vb.vertical)
  const flatPlan = plan.mode !== 'pincode_tiers'
  const monthlyApplies = planCoversVertical
    && (vb.monthlyEnabled || (flatPlan && plan.suspend_commission))

  const commissionSuspended = plan.suspend_commission && planCoversVertical
  const commissionPercent = vb.commissionEnabled && !commissionSuspended ? vb.commissionPercent : 0
  const commissionBasis = commissionPercent > 0 ? vb.commissionBasis : null

  // Headcount terms come from _shared/headcount.ts, which the wizard and the
  // clinic dashboard also use — the three used to compute this separately, and
  // one of them went on quoting the superseded model.
  const hc = headcountFor(plan, doctorCount)
  const doctorMultiplier = hc.multiplier
  const extraDoctors = hc.extraDoctors
  const extraDoctorCost = hc.extraCost

  const planFields = {
    planCode: plan.code,
    planLabel: plan.label,
    mode: plan.mode,
    months,
    defaultMonths: plan.default_months,
    minMonths: plan.min_months,
    maxMonths: plan.max_months,
    monthlyApplies,
    commissionPercent,
    commissionBasis,
    commissionSuspended,
    doctorCount,
    includedDoctors: plan.included_doctors,
    extraDoctors,
    extraDoctorCost,
    doctorBilling: plan.doctor_billing,
    doctorMultiplier,
  }

  const pincodes = [...new Set(rawPincodes.map(String))]
  if (!pincodes.length) {
    return {
      pincodes: [], count: 0, residents: 0, topTier: null, breakdown: [],
      monthlyTotal: 0, total: 0,
      tax: applyGst(0, taxSettings, recipientState),
      priceIncludesGst: plan.price_includes_gst,
      ...planFields,
    }
  }

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

  // Per-business negotiated price. business_pricing_overrides is a flat
  // custom_monthly_price per business (not the per-tier shape schema.sql
  // describes — that version was never applied), so this overrides the whole
  // monthly total rather than individual tier prices. Applies under any mode: a
  // negotiated price is negotiated regardless of how the list price is derived.
  let customMonthly: number | null = null
  if (businessId) {
    const { data: ov } = await supabase
      .from('business_pricing_overrides')
      .select('custom_monthly_price, valid_from, valid_until')
      .eq('business_id', businessId)
      .eq('is_active', true)
    const today = new Date().toISOString().slice(0, 10)
    const live = (ov ?? []).find((o: { custom_monthly_price: number | null; valid_from: string | null; valid_until: string | null }) =>
      o.custom_monthly_price != null
      && (!o.valid_from || o.valid_from <= today)
      && (!o.valid_until || o.valid_until >= today))
    if (live) customMonthly = Number((live as { custom_monthly_price: number }).custom_monthly_price)
  }

  const flatPerPincode = plan.mode === 'flat_per_pincode' ? (plan.monthly_price ?? 0) : null

  let residents = 0
  let tierSum = 0
  let topTier: { tier_number: number; tier_name: string; monthly_price: number } | null = null

  const breakdown: PriceLine[] = (areas ?? []).map(
    (a: { pin_code: string; area_name: string; population: number | null; tier_number: number }) => {
      const tier = tierByNum.get(a.tier_number)
      const tierPrice = tier?.monthly_price ?? 0

      // What this single line costs under the active mode. Under
      // flat_all_pincodes coverage is free per line — the listing is one price —
      // so the line shows ₹0 rather than a number nobody is charged.
      let linePrice = 0
      if (monthlyApplies) {
        if (plan.mode === 'pincode_tiers') linePrice = tierPrice
        else if (flatPerPincode !== null) linePrice = flatPerPincode
      }

      if (monthlyApplies && plan.mode === 'pincode_tiers') tierSum += tierPrice
      residents += a.population ?? 0

      if (plan.mode === 'pincode_tiers' && monthlyApplies
          && (!topTier || tierPrice > topTier.monthly_price)) {
        topTier = {
          tier_number: a.tier_number,
          tier_name: tier?.tier_name ?? `Tier ${a.tier_number}`,
          monthly_price: tierPrice,
        }
      }

      return {
        pin_code: a.pin_code,
        area_name: a.area_name,
        population: a.population ?? 0,
        tier_number: a.tier_number,
        tier_name: tier?.tier_name ?? `Tier ${a.tier_number}`,
        monthly_price: linePrice,
      }
    },
  )

  let monthlyTotal = 0
  if (monthlyApplies) {
    if (customMonthly !== null) monthlyTotal = customMonthly
    else if (plan.mode === 'flat_all_pincodes') monthlyTotal = plan.monthly_price ?? 0
    else if (plan.mode === 'flat_per_pincode') monthlyTotal = (plan.monthly_price ?? 0) * breakdown.length
    else monthlyTotal = tierSum

    // Consultants past the included headcount. Added after the coverage price,
    // not folded into it, so the invoice can show "reach" and "consultants" as
    // separate lines — a hospital querying its bill is almost always querying
    // the headcount rather than the pincodes.
    //
    // A negotiated customMonthly is deliberately left alone by both models: it
    // is a whole-price agreement, and silently scaling or adding to it would
    // break the deal that was struck.
    if (customMonthly === null) monthlyTotal = applyHeadcount(monthlyTotal, hc)
  }

  // AFTER applyHeadcount, and that ordering is the whole point. A ward system
  // is one system whether three consultants use it or nine, so multiplying it
  // by headcount would quote a nine-doctor hospital ninety thousand a month for
  // IPD. Added to a negotiated customMonthly too: that agreement was about
  // coverage, and a module bought later is a separate thing being bought.
  const moduleTotal = moduleLines.reduce((sum, m) => sum + m.monthly_price, 0)
  monthlyTotal += moduleTotal

  // Tax applies to the whole term, not one month, since the term is what gets
  // charged and invoiced in a single transaction.
  const termTotal = monthlyTotal * months
  const tax = plan.price_includes_gst
    ? extractGst(termTotal, taxSettings, recipientState)
    : applyGst(termTotal, taxSettings, recipientState)

  return {
    pincodes: breakdown.map((b) => b.pin_code),
    count: breakdown.length,
    residents,
    topTier: topTier ? { tier_number: topTier.tier_number, tier_name: topTier.tier_name } : null,
    breakdown,
    modules: moduleLines,
    moduleTotal,
    monthlyTotal,
    total: termTotal,
    tax,
    priceIncludesGst: plan.price_includes_gst,
    ...planFields,
  }
}
