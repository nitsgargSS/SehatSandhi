import { useState } from 'react'
import { X } from 'lucide-react'
import { moneyExact } from '../../lib/format'
import { type PayRow, payRow, payTotal, payLeft, nextPayMethod } from '../../lib/splitPayments'

// How a bill is being paid (0301): one payment, or several — half by net
// banking and half in cash. Used where a bill is made and paid in one step:
// the pharmacy counter and the counter invoice. Each part is saved as its own
// payment, so collections still show every method and who took it.

export { type PayRow, payRow, payTotal, toPayments, payProblem } from '../../lib/splitPayments'

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
  const left = payLeft(rows, due)
  const set = (key: number, patch: Partial<PayRow<M>>) => onChange(rows.map(r => r.key === key ? { ...r, ...patch } : r))
  // Once what is entered is less than the bill, the next payment line offers
  // itself; left empty, the rest stays due. It becomes a real line only when used.
  const offered = nextPayMethod(rows, due, methods)
  const offerNext = offered !== null
  const nextMethod = offered ?? methods[0][0]
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
