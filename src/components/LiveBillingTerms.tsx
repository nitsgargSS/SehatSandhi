import { usePricing, monthlyAppliesTo, commissionFor } from '../hooks/usePricing'
import { describeDoctorRate } from '../../supabase/functions/_shared/headcount'
import type { VerticalKey } from '../pages/business/shared'

// What this category actually pays, right now.
//
// The vertical pages used to state their terms in fixed copy ("no monthly listing
// fee, 10% of billing"). Once pricing became switchable that copy could contradict
// what the wizard quotes at checkout — a pharmacy reading "10%" and then being
// asked for ₹1,000/mo. This renders the live terms instead, so a plan toggle can
// never leave a stale promise on a public page.
//
// Rendered as one card per term, matching the "What You Earn" grid it sits in.
export default function LiveBillingTerms({ vertical }: { vertical: VerticalKey }) {
  const { plan, tiers, verticals } = usePricing()
  const vb = verticals.find(v => v.vertical === vertical)

  const monthly = monthlyAppliesTo(plan, vb)
  const commission = commissionFor(plan, vb)
  const flat = plan.mode !== 'pincode_tiers'
  const cheapestTier = tiers.reduce((min, t) => Math.min(min, t.monthly_price), Infinity)

  const terms: string[] = []

  if (monthly) {
    if (plan.mode === 'flat_all_pincodes') {
      terms.push(`₹${(plan.monthly_price ?? 0).toLocaleString('en-IN')} a month — every pincode you pick is included`)
    } else if (plan.mode === 'flat_per_pincode') {
      terms.push(`₹${(plan.monthly_price ?? 0).toLocaleString('en-IN')} a month per pincode you choose`)
    } else if (Number.isFinite(cheapestTier)) {
      terms.push(`Monthly listing from ₹${cheapestTier.toLocaleString('en-IN')} per pincode, set by its population`)
    } else {
      terms.push('Monthly listing fee, set by the population of the pincodes you choose')
    }
    // A hospital is billed per consultant, so the figure above is what ONE
    // doctor costs. Saying only "₹1,000 a month" here and then quoting ₹3,000
    // in the wizard is the drift _shared/headcount.ts exists to prevent — this
    // page was the one screen still not asking it.
    const perDoctor = vertical === 'hospital' ? describeDoctorRate(plan) : null
    if (perDoctor) terms.push(perDoctor)
    if (plan.max_months > plan.min_months) {
      terms.push(`Pay for ${plan.min_months}–${plan.max_months} months — you pick the term, and your rate is held for whatever you pay`)
    }
  } else {
    terms.push('No monthly listing fee')
  }

  if (commission.percent > 0) {
    terms.push(`${commission.percent}% of ${commission.basis ?? 'billing'}${monthly ? '' : ' — you pay only when we bring you business'}`)
  } else if (monthly) {
    terms.push('No commission on your billing — the monthly fee is all you pay')
  }

  return (
    <>
      {terms.map(term => (
        <div key={term} className="card text-center text-sm text-gray-600">{term}</div>
      ))}
    </>
  )
}
