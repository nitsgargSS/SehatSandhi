// How a hospital's doctor count affects its price — the single implementation.
//
// This lived in three places: the pricing engine, the signup wizard's live quote,
// and the clinic dashboard's roster panel. Switching the live plan to per_doctor
// updated two of them, and the third went on telling hospitals that another
// doctor cost ₹300 when it cost ₹1,000 — a business quoted the wrong price by
// its own dashboard.
//
// Deliberately dependency-free and in _shared/ so both runtimes import the same
// file: the Deno edge functions relatively, and the Vite client across the
// project root. Nothing here touches Deno, the network or the DOM.
//
// The server remains the authority for what is actually CHARGED — it resolves
// the plan and the headcount from the database, and the client cannot influence
// either. What is shared is the arithmetic and the wording, so the number a
// business is shown and the number it is billed cannot disagree.

export type DoctorBilling = 'none' | 'per_doctor' | 'base_plus_extra'

/** Only the plan fields headcount pricing cares about. */
export interface HeadcountPlan {
  monthly_price: number | null
  doctor_billing?: string | null
  included_doctors?: number | null
  extra_doctor_price?: number | null
}

export interface Headcount {
  /** Doctors being billed for. Zero for anything that is not a hospital. */
  doctorCount: number
  billsHeadcount: boolean
  /** Coverage price is multiplied by this. Always 1 outside per_doctor. */
  multiplier: number
  /** Doctors past included_doctors. Only ever non-zero under base_plus_extra. */
  extraDoctors: number
  /** ₹/month those extra doctors add. */
  extraCost: number
}

const billingOf = (plan: HeadcountPlan): DoctorBilling => {
  const b = plan.doctor_billing ?? 'none'
  return b === 'per_doctor' || b === 'base_plus_extra' ? b : 'none'
}

/**
 * Resolve headcount terms for a plan and a doctor count.
 *
 * A count of zero means "not a hospital" and always yields a multiplier of 1
 * with no extras — a solo practice must never be charged for being one doctor,
 * whatever the plan says.
 */
export function headcountFor(plan: HeadcountPlan, doctorCount: number): Headcount {
  const billing = billingOf(plan)
  const count = Math.max(0, Math.floor(doctorCount || 0))
  const included = Math.max(1, plan.included_doctors ?? 1)
  const extraPrice = Math.max(0, plan.extra_doctor_price ?? 0)

  if (billing === 'none' || count === 0) {
    return { doctorCount: count, billsHeadcount: false, multiplier: 1, extraDoctors: 0, extraCost: 0 }
  }
  if (billing === 'per_doctor') {
    return { doctorCount: count, billsHeadcount: true, multiplier: count, extraDoctors: 0, extraCost: 0 }
  }
  const extraDoctors = Math.max(0, count - included)
  return {
    doctorCount: count, billsHeadcount: true, multiplier: 1,
    extraDoctors, extraCost: extraDoctors * extraPrice,
  }
}

/**
 * Apply headcount to a coverage price.
 *
 * `coverageMonthly` is whatever the plan's mode produced from the pincodes — a
 * flat rate or a sum of tiers. Headcount is applied on top, so both live here
 * rather than being combined differently in each caller.
 */
export function applyHeadcount(coverageMonthly: number, hc: Headcount): number {
  return coverageMonthly * hc.multiplier + hc.extraCost
}

/**
 * What adding one more doctor costs per month, under whichever model is live.
 *
 * This is the number a hospital sees before confirming, and the one that was
 * wrong: under per_doctor it is the full monthly rate, not the extra-doctor
 * price, and under base_plus_extra it is zero while there are still included
 * seats free.
 */
export function marginalDoctorCost(plan: HeadcountPlan, currentCount: number): number {
  const billing = billingOf(plan)
  if (billing === 'none') return 0
  if (billing === 'per_doctor') return Math.max(0, Number(plan.monthly_price ?? 0))
  const included = Math.max(1, plan.included_doctors ?? 1)
  return currentCount >= included ? Math.max(0, plan.extra_doctor_price ?? 0) : 0
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/**
 * One sentence describing what a hospital of this size pays.
 *
 * Returned as text rather than assembled per screen, because the drift that
 * caused this refactor was in the wording as much as in the arithmetic — one
 * panel said "you are within your included doctors, no extra charge" while the
 * bill was ₹3,000.
 */
export function describeHeadcount(plan: HeadcountPlan, doctorCount: number): string | null {
  const hc = headcountFor(plan, doctorCount)
  if (!hc.billsHeadcount) return null

  const rate = Number(plan.monthly_price ?? 0)
  if (billingOf(plan) === 'per_doctor') {
    return `Each doctor is ${inr(rate)}/month, so ${hc.doctorCount} `
      + `${hc.doctorCount === 1 ? 'doctor is' : 'doctors are'} ${inr(rate * hc.doctorCount)}/month.`
  }
  const included = Math.max(1, plan.included_doctors ?? 1)
  if (hc.extraDoctors === 0) {
    return `Your plan includes ${included} doctors — you are within that, so there is no extra charge.`
  }
  return `Your plan includes ${included} doctors; the other ${hc.extraDoctors} `
    + `${hc.extraDoctors === 1 ? 'adds' : 'add'} ${inr(hc.extraCost)}/month.`
}

/** The one-line rate for signup copy, before any doctors have been entered. */
export function describeDoctorRate(plan: HeadcountPlan): string | null {
  const billing = billingOf(plan)
  if (billing === 'per_doctor') {
    return `Each doctor is ${inr(Number(plan.monthly_price ?? 0))}/month, so your total follows the number you add.`
  }
  if (billing === 'base_plus_extra' && (plan.extra_doctor_price ?? 0) > 0) {
    return `Your plan includes ${Math.max(1, plan.included_doctors ?? 1)}; `
      + `each additional doctor is ${inr(plan.extra_doctor_price ?? 0)}/month.`
  }
  return null
}
