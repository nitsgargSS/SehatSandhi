import { useCallback, useEffect, useMemo, useState } from 'react'
import { moneyExact } from '../../lib/format'
import type { StockRow } from '../../lib/pharmacyApi'
import {
  getCurrentAdmissions, getDepositBoard, listWardRequests, issueToAdmission, cancelWardRequest, cancelWardIssue,
  type Admission, type WardRequest,
} from '../../lib/admissionsApi'
import { supabase } from '../../lib/supabase'

// 0270: the hospital pharmacy's ward requests. The ward asks for medicines for
// an admitted patient; the pharmacy picks each from stock and issues them —
// stock goes down, and the medicines go on that patient's hospital bill, not
// paid at the counter. A patient can also be issued to without a request.
// The deposit left is shown; a short deposit warns, it never stops an issue.

interface Line { item_id: string; qty: string; asked?: string }

export default function WardPharmacy({ businessId, stock, onIssued }: {
  businessId: string; stock: StockRow[]; onIssued: () => void
}) {
  const [reqs, setReqs] = useState<WardRequest[]>([])
  const [stays, setStays] = useState<Admission[]>([])
  const [deposit, setDeposit] = useState<Record<string, { left: number; low: boolean }>>({})
  const [issues, setIssues] = useState<{ id: string; bill_no: string; net_payable: number; admission_id: string; issued_at: string; status: string }[]>([])
  const [open, setOpen] = useState<{ stay: string; req: WardRequest | null } | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    listWardRequests(businessId, { open: true }).then(setReqs).catch(e => setErr((e as Error).message))
    getCurrentAdmissions(businessId).then(setStays).catch(() => setStays([]))
    getDepositBoard(businessId).then(setDeposit).catch(() => setDeposit({}))
    supabase.from('pharmacy_bills').select('id, bill_no, net_payable, admission_id, issued_at, status')
      .eq('business_id', businessId).not('admission_id', 'is', null).order('issued_at', { ascending: false }).limit(15)
      .then(({ data }) => setIssues((data ?? []) as typeof issues))
  }, [businessId])
  useEffect(load, [load])

  const stayOf = (id: string) => stays.find(s => s.id === id)
  const inStock = useMemo(() => stock.filter(s => s.is_active && s.qty_available > 0).sort((a, b) => a.name.localeCompare(b.name)), [stock])
  const guess = (name: string) => {
    const w = name.toLowerCase().split(/\s+/).filter(x => x.length > 2)
    return inStock.find(s => w.some(x => s.name.toLowerCase().includes(x)))?.id ?? ''
  }
  const start = (stay: string, req: WardRequest | null) => {
    setOpen({ stay, req }); setMsg(''); setErr('')
    setLines(req ? req.items.map(i => ({ item_id: guess(i.name), qty: (i.qty.match(/\d+/) ?? [''])[0], asked: `${i.name}${i.qty ? ` × ${i.qty}` : ''}` })) : [{ item_id: '', qty: '' }])
  }
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (inStock.find(x => x.id === l.item_id)?.unit_mrp ?? 0), 0)

  const issue = async () => {
    if (!open) return
    const ok = lines.filter(l => l.item_id && Number(l.qty) > 0).map(l => ({ item_id: l.item_id, qty: Math.round(Number(l.qty)) }))
    setBusy(true); setErr('')
    try {
      const r = await issueToAdmission(open.stay, ok, open.req?.id)
      setMsg(`Issued ${r.bill_no} — ${moneyExact(Number(r.amount))} on ${stayOf(open.stay)?.patient_name ?? 'the patient'}'s bill. Deposit left ${moneyExact(Number(r.money.left))}.`)
      setOpen(null); load(); onIssued()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const dep = open ? deposit[open.stay] : undefined
  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <h3 className="font-bold text-navy-700">Ward requests</h3>
          <select className="input-field text-sm w-auto" value="" onChange={e => e.target.value && start(e.target.value, null)}>
            <option value="">Issue to an admitted patient…</option>
            {stays.map(s => <option key={s.id} value={s.id}>{s.patient_name} · {s.ward_name ?? ''} {s.bed_label ?? ''}</option>)}
          </select>
        </div>
        {!reqs.length ? <p className="text-sm text-gray-400">No requests waiting.</p> : (
          <ul className="divide-y divide-gray-100">
            {reqs.map(r => {
              const s = stayOf(r.admission_id)
              const d = deposit[r.admission_id]
              return (
                <li key={r.id} className="py-2.5 flex items-start justify-between gap-3 flex-wrap text-sm">
                  <span>
                    <b className="text-navy-700">{s?.patient_name ?? 'Patient'}</b>
                    <span className="text-gray-500"> · {s?.ward_name ?? ''} {s?.bed_label ?? ''} · asked by {r.requested_by_name ?? 'ward'}, {new Date(r.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="block">{r.items.map(i => `${i.name}${i.qty ? ` × ${i.qty}` : ''}`).join(', ')}</span>
                    {r.note && <span className="block text-xs text-gray-500">“{r.note}”</span>}
                    {d && <span className={`block text-xs ${d.low ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>Deposit {d.left >= 0 ? `left ${moneyExact(d.left)}` : `short ${moneyExact(-d.left)}`}</span>}
                  </span>
                  <span className="flex gap-2">
                    <button onClick={() => start(r.admission_id, r)} className="btn-teal text-sm py-1.5 px-3">Issue</button>
                    <button onClick={async () => { try { await cancelWardRequest(r.id); load() } catch (e) { setErr((e as Error).message) } }}
                      className="text-xs text-gray-500 hover:text-red-600">Decline</button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {open && (
        <div className="card shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-bold text-navy-700">Issue to {stayOf(open.stay)?.patient_name ?? 'patient'} <span className="text-sm font-normal text-gray-500">· {stayOf(open.stay)?.ward_name} {stayOf(open.stay)?.bed_label}</span></h3>
            <button onClick={() => setOpen(null)} className="text-xs text-gray-500">Close</button>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2 flex-wrap items-center">
              {l.asked && <span className="text-xs text-gray-500 w-full">Asked for: {l.asked}</span>}
              <select className="input-field text-sm flex-1 min-w-[14rem]" value={l.item_id} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, item_id: e.target.value } : x))}>
                <option value="">Choose from stock…</option>
                {inStock.map(s => <option key={s.id} value={s.id}>{s.name}{s.strength ? ` ${s.strength}` : ''} · {s.qty_available} in stock{s.unit_mrp != null ? ` · ₹${s.unit_mrp}` : ''}</option>)}
              </select>
              <input className="input-field text-sm w-24" inputMode="numeric" placeholder="Qty" value={l.qty}
                onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x))} />
              <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="text-xs text-gray-400 hover:text-red-600">Remove</button>
            </div>
          ))}
          <button onClick={() => setLines(ls => [...ls, { item_id: '', qty: '' }])} className="text-sm text-teal-700 font-semibold">+ Another medicine</button>
          <div className="text-sm text-gray-600">
            About <b>{moneyExact(total)}</b> to the patient's hospital bill.
            {dep && total > dep.left && <span className="text-red-600"> Deposit left is {moneyExact(Math.max(0, dep.left))} — issue anyway, and tell the desk to take more.</span>}
          </div>
          <button disabled={busy || !lines.some(l => l.item_id && Number(l.qty) > 0)} onClick={issue} className="btn-teal text-sm disabled:opacity-50">
            {busy ? 'Issuing…' : 'Issue to the hospital bill'}
          </button>
        </div>
      )}

      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {issues.length > 0 && (
        <details className="card shadow-sm">
          <summary className="cursor-pointer font-bold text-navy-700 text-sm">Issued to admitted patients ({issues.length})</summary>
          <ul className="divide-y divide-gray-100 mt-2 text-sm">
            {issues.map(b => (
              <li key={b.id} className="py-2 flex items-center justify-between gap-2 flex-wrap">
                <span>{b.bill_no} · {stayOf(b.admission_id)?.patient_name ?? 'discharged patient'} · {moneyExact(Number(b.net_payable))}
                  <span className="text-xs text-gray-500"> · {new Date(b.issued_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                  {b.status === 'cancelled' && <span className="text-xs text-gray-400"> · returned</span>}</span>
                {b.status !== 'cancelled' && (
                  <button className="text-xs text-gray-500 hover:text-red-600"
                    onClick={async () => {
                      const why = window.prompt('Return these medicines to stock and take them off the bill? Reason:')
                      if (why === null) return
                      try { await cancelWardIssue(b.id, why); load(); onIssued() } catch (e) { setErr((e as Error).message) }
                    }}>Return to stock</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
