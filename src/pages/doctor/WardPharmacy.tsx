import { useCallback, useEffect, useMemo, useState } from 'react'
import { moneyExact } from '../../lib/format'
import { getBill, type StockRow, type PharmacyBill } from '../../lib/pharmacyApi'
import {
  getCurrentAdmissions, getDepositBoard, listWardRequests, issueToAdmission, cancelWardRequest, cancelWardIssue, returnFromWard,
  type Admission, type WardRequest,
} from '../../lib/admissionsApi'
import { addPayment, PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '../../lib/billingApi'
import { supabase } from '../../lib/supabase'

// 0270: the hospital pharmacy's ward requests. The ward asks for medicines for
// an admitted patient; the pharmacy picks each from stock and issues them —
// stock goes down, and the medicines go on that patient's hospital bill, not
// paid at the counter. A patient can also be issued to without a request.
// The deposit left is shown; a short deposit warns, it never stops an issue.
// 0284: the attendant can top the deposit up right here; an issue can carry a
// discount; each issue prints as its own invoice, or the whole stay as one
// date-wise statement; and any part of an issue can come back — stock back,
// credited at what was charged, the discount included, off the stay.

interface Line { item_id: string; qty: string; asked?: string }

const depositText = (left: number) => left >= 0 ? `Deposit left ${moneyExact(left)}.` : `Deposit short ${moneyExact(-left)} — take more.`

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
  const [lastBill, setLastBill] = useState<string | null>(null)
  const [disc, setDisc] = useState({ pct: '', reason: '' })
  const [topup, setTopup] = useState<{ amount: string; method: PaymentMethod }>({ amount: '', method: 'cash' })
  const [returning, setReturning] = useState<PharmacyBill | null>(null)
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
    setOpen({ stay, req }); setMsg(''); setErr(''); setLastBill(null)
    setDisc({ pct: '', reason: '' }); setTopup({ amount: '', method: 'cash' })
    setLines(req ? req.items.map(i => ({ item_id: guess(i.name), qty: (i.qty.match(/\d+/) ?? [''])[0], asked: `${i.name}${i.qty ? ` × ${i.qty}` : ''}` })) : [{ item_id: '', qty: '' }])
  }
  const gross = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (inStock.find(x => x.id === l.item_id)?.unit_mrp ?? 0), 0)
  const pct = Math.min(100, Math.max(0, Number(disc.pct) || 0))
  const total = Math.round(gross * (100 - pct)) / 100

  const issue = async () => {
    if (!open) return
    const ok = lines.filter(l => l.item_id && Number(l.qty) > 0).map(l => ({ item_id: l.item_id, qty: Math.round(Number(l.qty)) }))
    if (pct > 0 && !disc.reason.trim()) { setErr('Say why there is a discount.'); return }
    const stay = stayOf(open.stay)
    setBusy(true); setErr('')
    try {
      // The attendant's top-up first, so the deposit shown after the issue counts it.
      const add = Number(topup.amount) || 0
      if (add > 0 && stay) await addPayment(stay.patient_member_id, businessId, { amount: add, method: topup.method, admissionId: stay.id, notes: 'Deposit at the pharmacy' })
      const r = await issueToAdmission(open.stay, ok, open.req?.id, pct > 0 ? { pct, reason: disc.reason.trim() } : null)
      setMsg(`${add > 0 ? `Deposit ${moneyExact(add)} taken. ` : ''}Issued ${r.bill_no} — ${moneyExact(Number(r.amount))} on ${stay?.patient_name ?? 'the patient'}'s bill. ${depositText(Number(r.money.left))}`)
      setLastBill(r.bill_id)
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
          <div className="flex gap-2 flex-wrap items-center text-sm">
            <span className="text-gray-600">Discount</span>
            <input className="input-field text-sm w-20" inputMode="decimal" placeholder="%" value={disc.pct}
              onChange={e => setDisc({ ...disc, pct: e.target.value.replace(/[^\d.]/g, '') })} />
            {pct > 0 && <input className="input-field text-sm flex-1 min-w-[12rem]" placeholder="Why — staff, senior citizen, scheme…" value={disc.reason}
              onChange={e => setDisc({ ...disc, reason: e.target.value })} />}
          </div>
          <div className="text-sm text-gray-600">
            About <b>{moneyExact(total)}</b>{pct > 0 && <> (after {pct}% off {moneyExact(gross)})</>} to the patient's hospital bill.
            {dep && <> Deposit {dep.left >= 0 ? `left ${moneyExact(dep.left)}` : <span className="text-red-600">short {moneyExact(-dep.left)}</span>}.</>}
          </div>
          {/* The attendant tops the deposit up at the counter, before the medicines go. */}
          <div className="flex gap-2 flex-wrap items-center text-sm rounded-lg bg-gray-50 p-2">
            <span className={dep && total > dep.left ? 'text-red-600 font-semibold' : 'text-gray-600'}>
              {dep && total > dep.left ? 'Deposit too low — take a top-up' : 'Deposit top-up (optional)'}
            </span>
            <input className="input-field text-sm w-28" inputMode="numeric" placeholder="₹ amount" value={topup.amount}
              onChange={e => setTopup({ ...topup, amount: e.target.value.replace(/\D/g, '') })} />
            <select className="input-field text-sm w-auto" value={topup.method} onChange={e => setTopup({ ...topup, method: e.target.value as PaymentMethod })}>
              {PAYMENT_METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <button disabled={busy || !lines.some(l => l.item_id && Number(l.qty) > 0)} onClick={issue} className="btn-teal text-sm disabled:opacity-50">
            {busy ? 'Issuing…' : 'Issue to the hospital bill'}
          </button>
        </div>
      )}

      {msg && <p className="text-sm text-teal-700">{msg}
        {lastBill && <> <a href={`/business/print/pharmacy/${lastBill}`} target="_blank" rel="noreferrer" className="font-semibold underline">Print invoice</a></>}</p>}
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
                <span className="flex gap-3 text-xs">
                  <a href={`/business/print/pharmacy/${b.id}`} target="_blank" rel="noreferrer" className="text-teal-700 font-semibold">Invoice</a>
                  <a href={`/business/print/ipd-medicines/${b.admission_id}`} target="_blank" rel="noreferrer" className="text-teal-700 font-semibold">Stay statement</a>
                  {b.status !== 'cancelled' && (<>
                    <button className="text-gray-600 hover:text-teal-700 font-semibold"
                      onClick={async () => { setErr(''); try { setReturning(await getBill(b.id)) } catch (e) { setErr((e as Error).message) } }}>Return some</button>
                    <button className="text-gray-500 hover:text-red-600"
                      onClick={async () => {
                        const why = window.prompt('Return ALL of these medicines to stock and take them off the bill? Reason:')
                        if (why === null) return
                        try { await cancelWardIssue(b.id, why); load(); onIssued() } catch (e) { setErr((e as Error).message) }
                      }}>Return all</button>
                  </>)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {returning && (
        <ReturnForm bill={returning} patient={stayOf(returning.admission_id ?? '')?.patient_name ?? 'the patient'}
          onClose={() => setReturning(null)}
          onDone={t => { setReturning(null); setMsg(t); setLastBill(null); load(); onIssued() }} />
      )}
    </div>
  )
}

// Part of a ward issue back to stock: each line at what was charged for it,
// the discount included, off the patient's stay.
function ReturnForm({ bill, patient, onClose, onDone }: { bill: PharmacyBill; patient: string; onClose: () => void; onDone: (t: string) => void }) {
  const [qty, setQty] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const left = bill.items.filter(i => i.quantity > i.returned_qty)
  const credit = left.reduce((s, i) => s + Math.min(Number(qty[i.id]) || 0, i.quantity - i.returned_qty) * i.amount / i.quantity, 0)
  const save = async () => {
    const lines = left.map(i => ({ bill_item_id: i.id, qty: Math.min(Number(qty[i.id]) || 0, i.quantity - i.returned_qty) })).filter(l => l.qty > 0)
    if (!lines.length) { setErr('Enter how many of each come back.'); return }
    setBusy(true); setErr('')
    try {
      const r = await returnFromWard(bill.id, lines, reason)
      onDone(`Returned to stock — ${moneyExact(Number(r.credit))} off ${patient}'s bill. ${depositText(Number(r.money.left))}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-navy-700">Return from {bill.bill_no} <span className="text-sm font-normal text-gray-500">· {patient}</span></h3>
        <button onClick={onClose} className="text-xs text-gray-500">Close</button>
      </div>
      {bill.discount_pct > 0 && <p className="text-xs text-gray-500">This issue had {bill.discount_pct}% off — each medicine comes back at what was charged for it.</p>}
      {left.map(i => (
        <div key={i.id} className="flex items-center gap-2 text-sm flex-wrap">
          <span className="flex-1 min-w-[12rem]">{i.name} <span className="text-gray-500">· {i.quantity - i.returned_qty} of {i.quantity} kept · {moneyExact(i.amount / i.quantity)} each</span></span>
          <input className="input-field text-sm w-20" inputMode="numeric" placeholder="0" value={qty[i.id] ?? ''}
            onChange={e => setQty(q => ({ ...q, [i.id]: e.target.value.replace(/\D/g, '') }))} />
        </div>
      ))}
      <input className="input-field text-sm" placeholder="Why (optional) — stopped, not used, discharged…" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="flex items-center gap-3">
        <button disabled={busy || credit <= 0} onClick={save} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Returning…' : `Return — ${moneyExact(credit)} off the bill`}</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}
