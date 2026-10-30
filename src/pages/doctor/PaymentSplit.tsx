import { useState } from 'react'
import { X } from 'lucide-react'
import { moneyExact } from '../../lib/format'
import type { SplitPayment } from '../../lib/billingApi'

// How a bill is being paid (0301): one payment, or several — half by net
// banking and half in cash. Used where a bill is made and paid in one step:
// the pharmacy counter and the counter invoice. Each part is saved as its own
// payment, so collections still show every method and who took it.

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

export default function PaymentSplit<M extends string>({ due, rows, onChange, methods, credit = true }: {
  /** What the bill comes to. */
  due: number
  rows: PayRow<M>[]
  onChange: (rows: PayRow<M>[]) => void
  methods: readonly (readonly [M, string])[]
  /** Offer "Nothing now (credit)". */
  credit?: boolean
}) {
  const received = payTotal(rows)
  const left = Math.round((due - received) * 100) / 100
  const set = (key: number, patch: Partial<PayRow<M>>) => onChange(rows.map(r => r.key === key ? { ...r, ...patch } : r))
  // 30 Oct 2026: once what is entered is less than the bill, the next payment
  // line offers itself — for the rest, by a method not used yet. Left empty,
  // the rest stays on credit. It becomes a real line only when used.
  const used = new Set(rows.map(r => r.method))
  const nextMethod = methods.find(([m]) => !used.has(m))?.[0] ?? methods[0][0]
  const offerNext = left > 0 && rows.length < 6 && rows.every(r => Number(r.amount) > 0)
  // Typing in the offered line turns it into a real one; keep the cursor in it.
  const [focusKey, setFocusKey] = useState<number | null>(null)
  const addRow = (patch: Partial<PayRow<M>> = {}, focus = false) => {
    const r = { ...payRow(nextMethod), ...patch }
    if (focus) setFocusKey(r.key)
    onChange([...rows, r])
  }

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-wrap gap-2 items-center">
          <input type="number" min={0} className="input-field flex-1 min-w-[110px]" value={r.amount} autoFocus={r.key === focusKey}
            onChange={e => set(r.key, { amount: e.target.value })}
            placeholder={i === 0 ? 'Amount received' : 'Amount'} aria-label={`Payment ${i + 1} amount`} />
          <select className="input-field flex-1 min-w-[120px]" value={r.method}
            onChange={e => set(r.key, { method: e.target.value as M })} aria-label={`Payment ${i + 1} method`}>
            {methods.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
          </select>
          <input className="input-field flex-[2] min-w-[150px]" value={r.reference} onChange={e => set(r.key, { reference: e.target.value })}
            placeholder={r.method === 'cash' ? 'Note (optional)' : 'UPI / card / cheque reference (optional)'} aria-label={`Payment ${i + 1} reference`} />
          {rows.length > 1 && (
            <button type="button" onClick={() => onChange(rows.filter(x => x.key !== r.key))}
              className="text-gray-400 hover:text-red-600 p-1" title="Remove this payment"><X className="w-4 h-4" /></button>
          )}
        </div>
      ))}
      {offerNext && (
        <div className="flex flex-wrap gap-2 items-center border border-dashed border-teal-400 rounded-lg p-2 bg-teal-50/40">
          <span className="text-xs text-teal-800 font-semibold w-full">{moneyExact(left)} left — paid another way? (leave empty to keep it due)</span>
          <input type="number" min={0} className="input-field flex-1 min-w-[110px]" value=""
            onChange={e => addRow({ amount: e.target.value }, true)}
            placeholder={`Rest ${moneyExact(left)}`} aria-label={`Payment ${rows.length + 1} amount`} />
          <select className="input-field flex-1 min-w-[120px]" value={nextMethod}
            onChange={e => addRow({ method: e.target.value as M })} aria-label={`Payment ${rows.length + 1} method`}>
            {methods.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
          </select>
          <button type="button" onClick={() => addRow({ amount: String(left) })}
            className="btn-teal text-xs py-2 px-3">Rest {moneyExact(left)} by {methods.find(([m]) => m === nextMethod)?.[1]}</button>
        </div>
      )}
      <div className="flex gap-2 flex-wrap items-center text-xs">
        <button type="button" onClick={() => onChange([payRow(rows[0]?.method ?? methods[0][0], due > 0 ? String(due) : '')])}
          className={`px-3 py-1 rounded-full border ${rows.length === 1 && received >= due && due > 0 ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200'}`}>Paid in full</button>
        {credit && (
          <button type="button" onClick={() => onChange([payRow(rows[0]?.method ?? methods[0][0])])}
            className={`px-3 py-1 rounded-full border ${!received ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200'}`}>Nothing now (credit)</button>
        )}
        {rows.length > 1 && <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700">Received {moneyExact(received)} in {rows.filter(r => Number(r.amount) > 0).length} payments</span>}
        {received > 0 && left > 0 && <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-800">{moneyExact(left)} will be due</span>}
        {left < 0 && <span className="px-3 py-1 rounded-full bg-red-50 text-red-700">{moneyExact(-left)} more than the bill</span>}
      </div>
    </div>
  )
}
