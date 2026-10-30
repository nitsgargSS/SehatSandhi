import { moneyExact } from './format'
import type { SplitPayment } from './billingApi'

// A bill paid in parts (0301/0302) — half by net banking, half in cash — as
// the counter enters it. Shared by the website's PaymentSplit and the app's
// PaySplit, so both add up and check the same way.

export interface PayRow<M extends string = string> { key: number; amount: string; method: M; reference: string }

let seq = 0
export const payRow = <M extends string>(method: M, amount = ''): PayRow<M> => ({ key: ++seq, amount, method, reference: '' })

export const payTotal = (rows: PayRow[]) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

export const toPayments = <M extends string>(rows: PayRow<M>[]): SplitPayment<M>[] =>
  rows.filter(r => Number(r.amount) > 0)
    .map(r => ({ amount: Math.round(Number(r.amount) * 100) / 100, method: r.method, reference: r.reference.trim() }))

/** A problem with the payments as entered, or null. */
export const payProblem = (rows: PayRow[], due: number): string | null => {
  if (rows.some(r => Number(r.amount) < 0)) return 'A payment cannot be below zero.'
  if (payTotal(rows) > due + 0.001) return `The payments come to more than the bill (${moneyExact(due)}).`
  return null
}

/** What is still to pay, to the paisa. */
export const payLeft = (rows: PayRow[], due: number) => Math.round((due - payTotal(rows)) * 100) / 100

/**
 * Once what is entered is less than the bill, the next payment line offers
 * itself (30 Oct 2026) — by a method not used yet. Null when there is none to offer.
 */
export const nextPayMethod = <M extends string>(rows: PayRow<M>[], due: number, methods: readonly (readonly [M, string])[]): M | null => {
  if (!(payLeft(rows, due) > 0) || rows.length >= 6 || !rows.every(r => Number(r.amount) > 0)) return null
  const used = new Set(rows.map(r => r.method))
  return methods.find(([m]) => !used.has(m))?.[0] ?? methods[0][0]
}
