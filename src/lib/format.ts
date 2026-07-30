// How numbers and dates are written, in one place.
//
// There were three money() helpers that disagreed — one showing up to two
// decimals, one always showing two, one showing none — plus about forty-five
// inline `₹{n.toLocaleString('en-IN')}` with no helper at all. So the same
// amount could render as ₹1,200, ₹1,200.5 and ₹1,200.50 on three screens of
// the same product.
//
// Dates were worse: the identical short-date helper was defined twice under two
// names (dLabel in admin, dayLabel in the clinic dashboard) and then inlined
// eight more times besides.
//
// Everything below is en-IN on purpose: the lakh/crore grouping is what these
// numbers are read in.

const INR = '₹'

/**
 * A price, as a person reads it. Whole rupees unless there are paise.
 *
 * ₹1,000 · ₹1,180.50
 */
export const money = (v: string | number | null | undefined): string =>
  `${INR}${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/**
 * A price on a document that has to add up. Always two decimals.
 *
 * ₹1,000.00 · ₹1,180.50
 *
 * Deliberately separate from money(): an invoice line that reads ₹1,000 beside
 * a total of ₹1,180.50 looks like a mistake, and a tax invoice is a legal
 * record before it is a UI.
 */
export const moneyExact = (v: string | number | null | undefined): string =>
  `${INR}${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A count, grouped but unprefixed. 1,55,000 */
export const num = (v: string | number | null | undefined): string =>
  Number(v ?? 0).toLocaleString('en-IN')

/** 28 Jul — for dense rows where the year is obvious from context. */
export const shortDate = (iso: string | Date): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** 28 Jul 2026 — anywhere the year matters, which is most places money does. */
export const longDate = (iso: string | Date): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** 28 Jul 2026, 4:30 pm */
export const dateTime = (iso: string | Date): string =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

/** 4:30 pm */
export const timeOfDay = (iso: string | Date): string =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

/**
 * Today as YYYY-MM-DD, for date inputs and range filters.
 *
 * Uses the LOCAL date, not toISOString(). That converts to UTC first, and IST
 * is UTC+5:30 — so between midnight and 5:30am it returns YESTERDAY to everyone
 * in India. Verified: 2am IST on 29 Jul gives 2026-07-28.
 *
 * A clinic opening its dashboard early therefore saw the previous day selected,
 * and the reschedule picker's `min` let them book a slot already in the past.
 */
export const isoDate = (d: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
