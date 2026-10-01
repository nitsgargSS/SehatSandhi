import { useEffect, useState } from 'react'
import { adminTrips, TRIP_STATUS, type AdminTripRow } from '../../lib/ambulanceApi'

// 0191: every ambulance request — how fast someone accepted, where nobody did,
// and where the service's fare and what the patient says they paid differ.
export default function AmbulanceRequestsSection() {
  const [days, setDays] = useState(30)
  const [rows, setRows] = useState<AdminTripRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setRows(null); adminTrips(days).then(setRows).catch(e => setErr((e as Error).message)) }, [days])

  const accepted = rows?.filter(r => r.minutes_to_accept != null) ?? []
  const median = (() => {
    const m = accepted.map(r => r.minutes_to_accept as number).sort((a, b) => a - b)
    return m.length ? `${m[Math.floor(m.length / 2)]} min` : '—'
  })()
  const money = (n: number | null) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN')

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-navy-700 text-lg">Ambulance requests</h3>
        <select className="input-field w-auto" value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {[['Requests', rows.length], ['Accepted', accepted.length], ['Nobody accepted', rows.filter(r => r.status === 'expired').length], ['Typical time to accept', median]].map(([l, v]) => (
            <div key={l as string} className="bg-gray-50 rounded-xl p-3"><div className="text-gray-500 text-xs">{l}</div><div className="font-bold text-navy-700 text-lg">{v}</div></div>
          ))}
        </div>
      )}
      {rows && rows.length === 0 && <p className="text-sm text-gray-500">No requests in this period.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 text-xs">
              <th className="py-1 pr-3">Request</th><th className="pr-3">When</th><th className="pr-3">Kind</th><th className="pr-3">PIN</th><th className="pr-3">Service</th>
              <th className="pr-3">Status</th><th className="pr-3 text-right">To accept</th><th className="pr-3 text-right">Fare</th><th className="pr-3 text-right">Patient paid</th><th>Rating</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.code} className={`border-t border-gray-100 ${r.mismatch ? 'bg-amber-50' : r.status === 'expired' ? 'bg-red-50' : ''}`}>
                  <td className="py-1.5 pr-3 font-semibold">{r.code}</td>
                  <td className="pr-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="pr-3">{r.kind === 'emergency' ? 'Emergency' : 'Scheduled'}</td>
                  <td className="pr-3">{r.pin_code}</td>
                  <td className="pr-3">{r.service ?? '—'}</td>
                  <td className="pr-3 whitespace-nowrap">{TRIP_STATUS[r.status]}</td>
                  <td className="pr-3 text-right">{r.minutes_to_accept != null ? `${r.minutes_to_accept} min` : '—'}</td>
                  <td className="pr-3 text-right">{money(r.fare)}</td>
                  <td className="pr-3 text-right">{money(r.patient_paid)}{r.mismatch ? ' ⚠' : ''}</td>
                  <td>{r.rating ? '★'.repeat(r.rating) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">Red: nobody accepted. ⚠ The service and the patient recorded different amounts.</p>
        </div>
      )}
    </div>
  )
}
