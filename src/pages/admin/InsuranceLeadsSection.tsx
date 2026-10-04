import { useEffect, useState } from 'react'
import { adminLeads, resolveLead, setLeadFee, getLeadFee, LEAD_STATUS, type AdminLeadRow } from '../../lib/insuranceApi'

// 0192: every insurance lead, the flat fee taken, and the reports that need a
// decision — refund the fee to the advisor's wallet, or reject the report.
export default function InsuranceLeadsSection() {
  const [days, setDays] = useState(30)
  const [rows, setRows] = useState<AdminLeadRow[] | null>(null)
  const [fee, setFee] = useState('')
  const [feeMsg, setFeeMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const load = () => { setRows(null); adminLeads(days).then(setRows).catch(e => setErr((e as Error).message)) }
  useEffect(load, [days])
  useEffect(() => { getLeadFee().then(f => setFee(String(f))).catch(() => {}) }, [])

  const decide = async (r: AdminLeadRow, refund: boolean) => {
    setBusy(r.id); setErr('')
    try { await resolveLead(r.id, refund, notes[r.id] ?? ''); load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const saveFee = async () => {
    setFeeMsg('')
    try { const v = await setLeadFee(Number(fee)); setFeeMsg(`Saved — ₹${v} per lead from now on.`) } catch (e) { setFeeMsg((e as Error).message) }
  }

  const taken = rows?.filter(r => r.fee_paise) ?? []
  const income = taken.filter(r => !r.fee_refunded).reduce((a, r) => a + (r.fee_paise ?? 0), 0) / 100
  const open = rows?.filter(r => (r.status === 'disputed' && !r.dispute_resolution) || r.patient_not_called || r.outcome_mismatch) ?? []

  return (
    <div className="space-y-4">
      <div className="card shadow-sm space-y-2">
        <h3 className="font-bold text-navy-700 text-lg">Lead fee</h3>
        <p className="text-sm text-gray-500">What an advisor pays from their wallet for each lead they accept. Nothing is ever charged on a policy or its premium.</p>
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-sm">₹</span>
          <input className="input-field w-28" inputMode="numeric" value={fee} onChange={e => setFee(e.target.value.replace(/\D/g, ''))} />
          <button onClick={saveFee} className="btn-teal text-sm py-2 px-4">Save</button>
          {feeMsg && <span className="text-sm text-gray-600">{feeMsg}</span>}
        </div>
      </div>

      <div className="card shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-navy-700 text-lg">Insurance leads</h3>
          <select className="input-field w-auto" value={days} onChange={e => setDays(Number(e.target.value))}>
            {[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {rows && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {[['Leads', rows.length], ['Accepted', taken.length], ['Fees (net of refunds)', `₹${income.toLocaleString('en-IN')}`], ['Need a look', open.length]].map(([k, v]) => (
              <div key={k as string} className="bg-gray-50 rounded-xl p-3"><div className="text-gray-500 text-xs">{k}</div><div className="font-bold text-navy-700 text-lg">{v}</div></div>
            ))}
          </div>
        )}
        {rows && rows.length === 0 && <p className="text-sm text-gray-500">No leads in this period.</p>}
        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map(r => {
              const needsDecision = r.status === 'disputed' && !r.dispute_resolution
              return (
                <div key={r.id} className={`border rounded-xl p-3 text-sm ${needsDecision ? 'border-amber-300 bg-amber-50' : 'border-gray-100'}`}>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
                    <b>{r.code}</b>
                    <span>{LEAD_STATUS[r.status]}</span>
                    <span className="text-gray-500">{r.pin_code} · {new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                    <span className="text-gray-500">{r.advisor ?? '—'}</span>
                    {r.fee_paise ? <span>₹{r.fee_paise / 100}{r.fee_refunded ? ' (refunded)' : ''}</span> : null}
                    {r.patient_not_called && <span className="text-amber-700">Person says not called</span>}
                    {r.outcome_mismatch && <span className="text-amber-700">Person says bought; advisor didn't close</span>}
                    {r.rating ? <span>{'★'.repeat(r.rating)}</span> : null}
                  </div>
                  {r.dispute_reason && <div className="mt-1 text-gray-700">Advisor reports: “{r.dispute_reason}”{r.dispute_resolution ? ` — ${r.dispute_resolution}` : ''}</div>}
                  {needsDecision && (
                    <div className="flex gap-2 flex-wrap items-center mt-2">
                      <input className="input-field flex-1 min-w-[160px]" placeholder="Note (optional)" value={notes[r.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} />
                      <button disabled={busy === r.id} onClick={() => decide(r, true)} className="btn-teal text-sm py-2 px-3">Refund ₹{(r.fee_paise ?? 0) / 100}</button>
                      <button disabled={busy === r.id} onClick={() => decide(r, false)} className="btn-outline text-sm py-2 px-3">Reject report</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
