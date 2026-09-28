import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { moneyExact, isoDate } from '../../lib/format'
import { methodLabel, downloadCsv } from '../../lib/billingApi'

// The day's tally (0159): every rupee taken — OPD, IPD, account and the
// pharmacy counter — by who took it and how. Counted against the cash drawer,
// the UPI app and the card machine's credit and debit slips.
//
// Owner and manager see everybody. Anyone else sees only what they took
// themselves, which is what they need to hand over their cash; the RPC decides
// that, not this screen.

interface Row {
  source: 'clinic' | 'pharmacy'
  taken_at: string
  taken_on: string
  amount: number
  method: string
  reference: string | null
  taken_by_uid: string | null
  taken_by_name: string
  customer_name: string | null
  bill_no: string | null
}

interface Change {
  id: string
  action: 'changed' | 'deleted'
  before: { amount: number; method: string; received_by_name?: string | null; received_on: string }
  after: { amount: number; method: string } | null
  changed_by_name: string | null
  changed_at: string
}

const METHOD_ORDER = ['cash', 'upi', 'credit_card', 'debit_card', 'card', 'netbanking', 'cheque', 'insurance', 'other']

export default function CollectionsPanel({ businessId, seesEveryone }: { businessId: string; seesEveryone: boolean }) {
  const [from, setFrom] = useState(isoDate())
  const [to, setTo] = useState(isoDate())
  const [rows, setRows] = useState<Row[] | null>(null)
  const [changes, setChanges] = useState<Change[]>([])
  const [person, setPerson] = useState('all')
  const [err, setErr] = useState('')

  useEffect(() => {
    setRows(null)
    supabase.rpc('sehat_collections', { p_business: businessId, p_from: from, p_to: to }).then(({ data, error }) => {
      if (error) { setErr(error.message); setRows([]); return }
      setErr(''); setRows(((data ?? []) as Row[]).map(r => ({ ...r, amount: Number(r.amount) })))
    })
    if (seesEveryone) {
      supabase.from('payment_changes').select('id, action, before, after, changed_by_name, changed_at')
        .eq('business_id', businessId)
        .gte('changed_at', `${from}T00:00:00+05:30`).lt('changed_at', `${to}T23:59:59.999+05:30`)
        .order('changed_at', { ascending: false })
        .then(({ data }) => setChanges((data ?? []) as Change[]))
    }
  }, [businessId, from, to, seesEveryone])

  const people = useMemo(() => [...new Set((rows ?? []).map(r => r.taken_by_name))].sort(), [rows])
  const shown = (rows ?? []).filter(r => person === 'all' || r.taken_by_name === person)
  const methods = METHOD_ORDER.filter(m => shown.some(r => r.method === m))
  const sum = (f: (r: Row) => boolean) => shown.filter(f).reduce((s, r) => s + r.amount, 0)
  const total = sum(() => true)

  const csv = () => {
    const head = ['Date', 'Time', 'Counter', 'Taken by', 'Method', 'Amount', 'Patient', 'Bill', 'Reference']
    const body = shown.map(r => [
      r.taken_on, new Date(r.taken_at).toLocaleTimeString('en-IN', { timeStyle: 'short' }),
      r.source === 'pharmacy' ? 'Pharmacy' : 'Clinic', r.taken_by_name, methodLabel(r.method),
      r.amount.toFixed(2), r.customer_name ?? '', r.bill_no ?? '', r.reference ?? '',
    ])
    downloadCsv(`collections-${from}-to-${to}.csv`,
      [head, ...body].map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))
  }

  const th = 'text-right px-3 py-2 font-medium'
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-700">Collections</h2>
          <p className="text-sm text-gray-500">
            {seesEveryone ? 'Every payment taken, by who took it and how — to tally against cash, UPI and card slips.'
                          : 'The payments you took — to hand over your cash and check your UPI and card slips.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input type="date" className="input-field w-auto" value={from} onChange={e => setFrom(e.target.value)} />
          <span className="text-gray-400">to</span>
          <input type="date" className="input-field w-auto" value={to} onChange={e => setTo(e.target.value)} />
          <button onClick={() => { setFrom(isoDate()); setTo(isoDate()) }} className="text-xs text-teal-700">Today</button>
          {seesEveryone && people.length > 1 && (
            <select className="input-field w-auto" value={person} onChange={e => setPerson(e.target.value)}>
              <option value="all">Everyone</option>
              {people.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <button onClick={csv} disabled={!shown.length} className="btn-outline text-xs py-2 px-3 inline-flex items-center gap-1 disabled:opacity-50">
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
      </div>

      {err && <div className="card shadow-sm text-sm text-amber-700 bg-amber-50 border-amber-200">{err}</div>}
      {rows === null ? <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
        : shown.length === 0 ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">No payments in these dates.</div>
        : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card shadow-sm py-4"><p className="text-xs text-gray-500">Total taken</p><p className="text-lg font-bold text-navy-700">{moneyExact(total)}</p></div>
              {methods.map(m => (
                <div key={m} className="card shadow-sm py-4"><p className="text-xs text-gray-500">{methodLabel(m)}</p><p className="text-lg font-bold text-navy-700">{moneyExact(sum(r => r.method === m))}</p></div>
              ))}
            </div>

            {/* Who took what, by method — the table the drawer is counted against. */}
            <div className="card shadow-sm p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-gray-500 text-xs border-b">
                  <th className="text-left px-3 py-2 font-medium">Taken by</th>
                  {methods.map(m => <th key={m} className={th}>{methodLabel(m)}</th>)}
                  <th className={th}>Clinic</th><th className={th}>Pharmacy</th><th className={th}>Total</th>
                </tr></thead>
                <tbody>
                  {people.filter(p => person === 'all' || p === person).map(p => (
                    <tr key={p} className="border-t">
                      <td className="px-3 py-2 font-medium">{p}</td>
                      {methods.map(m => <td key={m} className="text-right px-3">{moneyExact(sum(r => r.taken_by_name === p && r.method === m))}</td>)}
                      <td className="text-right px-3">{moneyExact(sum(r => r.taken_by_name === p && r.source === 'clinic'))}</td>
                      <td className="text-right px-3">{moneyExact(sum(r => r.taken_by_name === p && r.source === 'pharmacy'))}</td>
                      <td className="text-right px-3 font-bold">{moneyExact(sum(r => r.taken_by_name === p))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card shadow-sm p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 border-b">
                  <th className="px-3 py-2">When</th><th>Counter</th><th>Patient</th><th>Bill</th><th>Method</th><th>Reference</th><th>Taken by</th><th className="text-right px-3">Amount</th>
                </tr></thead>
                <tbody>{shown.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5">{new Date(r.taken_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td>{r.source === 'pharmacy' ? 'Pharmacy' : 'Clinic'}</td>
                    <td>{r.customer_name}</td>
                    <td>{r.bill_no ?? '—'}</td>
                    <td>{methodLabel(r.method)}</td>
                    <td className="text-gray-500">{r.reference}</td>
                    <td>{r.taken_by_name}</td>
                    <td className={`text-right px-3 ${r.amount < 0 ? 'text-red-600' : ''}`}>{moneyExact(r.amount)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="text-xs text-gray-400 px-3 py-2">Pharmacy refunds show as minus amounts. "Not recorded" is a clinic payment taken before names were kept.</p>
            </div>
          </>
        )}

      {seesEveryone && changes.length > 0 && (
        <div className="card shadow-sm p-0 overflow-x-auto">
          <p className="px-3 pt-3 font-bold text-navy-700 text-sm">Payments changed or removed</p>
          <table className="w-full text-xs">
            <tbody>{changes.map(c => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-1.5">{new Date(c.changed_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className={c.action === 'deleted' ? 'text-red-600' : 'text-amber-700'}>{c.action === 'deleted' ? 'Removed' : 'Changed'}</td>
                <td>
                  {moneyExact(c.before.amount)} {methodLabel(c.before.method)}
                  {c.after ? ` → ${moneyExact(c.after.amount)} ${methodLabel(c.after.method)}` : ''}
                  {c.before.received_by_name ? ` (taken by ${c.before.received_by_name})` : ''}
                </td>
                <td className="px-3">by {c.changed_by_name ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
