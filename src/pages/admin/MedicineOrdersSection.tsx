import { useEffect, useState } from 'react'
import { adminOrders, ORDER_STATUS, rupees, type AdminOrderRow } from '../../lib/medicineOrdersApi'

// 0189: every medicine order — how many, where, which pharmacy, and the ones
// where what the pharmacy recorded and what the patient says they paid differ.
export default function MedicineOrdersSection() {
  const [days, setDays] = useState(30)
  const [rows, setRows] = useState<AdminOrderRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setRows(null); adminOrders(days).then(setRows).catch(e => setErr((e as Error).message)) }, [days])

  const n = (s: string[]) => rows?.filter(r => s.includes(r.status)).length ?? 0
  const rated = rows?.filter(r => r.rating) ?? []
  const avg = rated.length ? (rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length).toFixed(1) : '—'

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-navy-700 text-lg">Medicine orders</h3>
        <select className="input-field w-auto" value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
          {[['Orders', rows.length], ['Delivered', n(['delivered'])], ['In progress', n(['open', 'accepted', 'quoted', 'confirmed', 'packed', 'out_for_delivery'])],
            ['No pharmacy / expired', n(['no_pharmacy', 'expired'])], ['Avg rating', avg]].map(([l, v]) => (
            <div key={l as string} className="bg-gray-50 rounded-xl p-3"><div className="text-gray-500 text-xs">{l}</div><div className="font-bold text-navy-700 text-lg">{v}</div></div>
          ))}
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-sm text-gray-500">No orders in this period.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 text-xs">
              <th className="py-1 pr-3">Order</th><th className="pr-3">When</th><th className="pr-3">PIN</th><th className="pr-3">Pharmacy</th>
              <th className="pr-3">Status</th><th className="pr-3 text-right">Price</th><th className="pr-3 text-right">Collected</th><th className="pr-3 text-right">Patient paid</th><th>Rating</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.code} className={`border-t border-gray-100 ${r.mismatch ? 'bg-amber-50' : ''}`}>
                  <td className="py-1.5 pr-3 font-semibold">{r.code}</td>
                  <td className="pr-3 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                  <td className="pr-3">{r.pin_code}</td>
                  <td className="pr-3">{r.pharmacy ?? '—'}</td>
                  <td className="pr-3 whitespace-nowrap">{ORDER_STATUS[r.status]}{r.ended_reason ? <span className="text-gray-400"> · {r.ended_reason}</span> : null}</td>
                  <td className="pr-3 text-right">{rupees(r.quote_total)}</td>
                  <td className="pr-3 text-right">{rupees(r.collected_amount)}</td>
                  <td className="pr-3 text-right">{rupees(r.patient_paid)}{r.mismatch ? ' ⚠' : ''}</td>
                  <td>{r.rating ? '★'.repeat(r.rating) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">⚠ The pharmacy and the patient recorded different amounts.</p>
        </div>
      )}
    </div>
  )
}
