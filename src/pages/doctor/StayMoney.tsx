import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { addPayment, PAYMENT_METHOD_OPTIONS, methodLabel, type PaymentMethod } from '../../lib/billingApi'
import {
  getAdmissionMoney, getMedicationOrders, listWardRequests, requestFromPharmacy, cancelWardRequest,
  type Admission, type AdmissionMoney, type MedicationOrder, type WardRequest,
} from '../../lib/admissionsApi'
import { moneyExact } from '../../lib/format'
import { BIZ } from '../business/shared'

// 0270: on each admission — the deposit and what is left of it, taking a
// deposit (and a receipt), and asking the hospital's pharmacy for medicines.
// What the pharmacy issues goes on this stay's bill; the final IPD bill counts
// the deposits as paid.

const btn = (primary = false): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 11px', borderRadius: 8,
  border: primary ? 'none' : `1px solid ${BIZ.inputBorder}`, background: primary ? BIZ.green : '#fff', color: primary ? '#fff' : BIZ.ink,
})
const input: React.CSSProperties = {
  padding: '7px 9px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, border: `1px solid ${BIZ.inputBorder}`, background: '#fff', color: BIZ.ink,
}

export default function StayMoney({ stay, memberId, businessId, practitionerId, clinical }: {
  stay: Admission
  memberId: string
  businessId: string
  practitionerId?: string | null
  clinical: boolean
}) {
  const [m, setM] = useState<AdmissionMoney | null>(null)
  const [reqs, setReqs] = useState<WardRequest[]>([])
  const [open, setOpen] = useState<'deposit' | 'pharmacy' | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const admitted = stay.status === 'admitted'

  const load = useCallback(() => {
    getAdmissionMoney(stay.id).then(setM).catch(e => setErr((e as Error).message))
    listWardRequests(businessId, { admissionId: stay.id }).then(r => setReqs(r.filter(x => x.status !== 'cancelled').slice(0, 5))).catch(() => setReqs([]))
  }, [stay.id, businessId])
  useEffect(load, [load])

  if (!m) return null
  const tone = m.low ? '#8a2b2b' : BIZ.green

  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: m.low && admitted ? '#fdf2f2' : '#f6faf8', border: `1px solid ${m.low && admitted ? '#f0c8c8' : BIZ.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
        <span>
          Deposit <b>{moneyExact(m.deposits)}</b> · Used <b>{moneyExact(m.used)}</b> ·{' '}
          <b style={{ color: tone }}>{m.left >= 0 ? `Left ${moneyExact(m.left)}` : `Short ${moneyExact(-m.left)}`}</b>
          {m.low && admitted && <span style={{ color: '#8a2b2b', fontWeight: 700 }}> · Deposit running low</span>}
        </span>
        {admitted && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button style={btn(m.low)} onClick={() => { setOpen(open === 'deposit' ? null : 'deposit'); setMsg(''); setErr('') }}>
              {m.deposits > 0 ? 'Add deposit' : 'Take deposit'}
            </button>
            <button style={btn()} onClick={() => { setOpen(open === 'pharmacy' ? null : 'pharmacy'); setMsg(''); setErr('') }}>
              Get medicines
            </button>
          </span>
        )}
        {/* 0284: every medicine given in this stay, date by date. */}
        <a href={`/business/print/ipd-medicines/${stay.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: BIZ.green, fontWeight: 700 }}>
          Medicine statement
        </a>
      </div>

      {open === 'deposit' && (
        <DepositForm stay={stay} memberId={memberId} businessId={businessId} practitionerId={practitionerId}
          onDone={(t) => { setOpen(null); setMsg(t); load() }} onError={setErr} />
      )}
      {open === 'pharmacy' && (
        <PharmacyRequestForm stay={stay} clinical={clinical} left={m.left}
          onDone={(t) => { setOpen(null); setMsg(t); load() }} onError={setErr} />
      )}

      {reqs.length > 0 && (
        <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 12, color: BIZ.muted }}>
          {reqs.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span>
                <b style={{ color: r.status === 'issued' ? BIZ.green : '#8a5a00' }}>{r.status === 'issued' ? 'Issued' : 'Waiting at pharmacy'}</b>
                {' · '}{r.items.map(i => `${i.name}${i.qty ? ` × ${i.qty}` : ''}`).join(', ')}
                {' · '}{new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              </span>
              {r.status === 'requested' && (
                <button style={{ ...btn(), padding: '2px 8px', fontSize: 11 }}
                  onClick={async () => { try { await cancelWardRequest(r.id); load() } catch (e) { setErr((e as Error).message) } }}>Withdraw</button>
              )}
            </div>
          ))}
        </div>
      )}

      {msg && <div style={{ fontSize: 12.5, color: BIZ.green, marginTop: 6 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12.5, color: '#8a2b2b', marginTop: 6 }}>{err}</div>}
    </div>
  )
}

function DepositForm({ stay, memberId, businessId, practitionerId, onDone, onError }: {
  stay: Admission; memberId: string; businessId: string; practitionerId?: string | null
  onDone: (text: string) => void; onError: (text: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [ref, setRef] = useState('')
  const [from, setFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const amt = Number(amount)
    setBusy(true); onError('')
    try {
      const note = `Deposit${from.trim() ? ` from ${from.trim()}` : ''} — ${stay.admission_no}`
      await addPayment(memberId, businessId, { amount: amt, method, reference: ref, admissionId: stay.id, notes: note }, practitionerId)
      printReceipt(businessId, stay, amt, method, ref, from)
      onDone(`Deposit of ${moneyExact(amt)} taken. The receipt has opened to print.`)
    } catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
      <input style={{ ...input, width: 110 }} placeholder="Amount ₹" inputMode="decimal" value={amount}
        onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
      <select style={input} value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}>
        {PAYMENT_METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input style={{ ...input, width: 150 }} placeholder="UPI / card ref (optional)" value={ref} onChange={e => setRef(e.target.value)} />
      <input style={{ ...input, width: 150 }} placeholder="Paid by (attendant)" value={from} onChange={e => setFrom(e.target.value)} />
      <button style={btn(true)} disabled={busy || !(Number(amount) > 0)} onClick={save}>{busy ? 'Saving…' : 'Take deposit & print receipt'}</button>
    </div>
  )
}

/** 0284: the medicines on a slip the attendant takes to the pharmacy — ours or any other. */
export async function printMedicineSlip(stay: Admission, items: { name: string; qty: string; how?: string }[], by?: string | null) {
  const w = window.open('', '_blank', 'width=460,height=600')
  if (!w) return
  const { data: b } = await supabase.from('businesses').select('name, address, phone').eq('id', stay.business_id).maybeSingle()
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  w.document.write(`<!doctype html><html><head><title>Medicine slip — ${esc(stay.patient_name)}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin:0}small{color:#555}
table{width:100%;margin-top:14px;border-collapse:collapse}th,td{padding:7px 4px;border-bottom:1px solid #ddd;font-size:14px;text-align:left}
th{font-size:12px;color:#555;text-transform:uppercase}td:last-child,th:last-child{text-align:right}</style></head><body>
<h1>${esc(b?.name)}</h1><small>${esc(b?.address)}${b?.phone ? ` · ${esc(b.phone)}` : ''}</small>
<p style="margin-top:16px;font-weight:700">MEDICINES FOR THE WARD</p>
<div style="font-size:14px;line-height:1.6">Patient: <b>${esc(stay.patient_name)}</b><br>
Admission ${esc(stay.admission_no)}${stay.ward_name ? ` · ${esc(stay.ward_name)} ${esc(stay.bed_label ?? '')}` : ''}<br>
${stay.attending_name ? `Doctor: ${esc(stay.attending_name)}<br>` : ''}${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}${by ? ` · ${esc(by)}` : ''}</div>
<table><tr><th>Medicine</th><th>How</th><th>Qty</th></tr>
${items.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.how ?? '')}</td><td>${esc(i.qty)}</td></tr>`).join('')}</table>
<p style="font-size:12px;color:#555;margin-top:18px">Show this slip at the pharmacy. At our pharmacy the medicines go on the patient's hospital bill.</p>
<script>setTimeout(()=>window.print(),300)</script></body></html>`)
  w.document.close()
}

// A plain receipt, printed from the browser.
async function printReceipt(businessId: string, stay: Admission, amount: number, method: string, ref: string, from: string) {
  const { data: b } = await supabase.from('businesses').select('name, address, phone').eq('id', businessId).maybeSingle()
  const w = window.open('', '_blank', 'width=420,height=560')
  if (!w) return
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Deposit receipt</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin:0}small{color:#555}
table{width:100%;margin-top:16px;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #eee;font-size:14px}
td:last-child{text-align:right;font-weight:600}.big{font-size:22px;font-weight:800;margin-top:14px}</style></head><body>
<h1>${esc(b?.name)}</h1><small>${esc(b?.address)}${b?.phone ? ` · ${esc(b.phone)}` : ''}</small>
<p style="margin-top:18px;font-weight:700">DEPOSIT RECEIPT</p>
<table>
<tr><td>Patient</td><td>${esc(stay.patient_name)}</td></tr>
<tr><td>Admission</td><td>${esc(stay.admission_no)}${stay.ward_name ? ` · ${esc(stay.ward_name)} ${esc(stay.bed_label ?? '')}` : ''}</td></tr>
${from.trim() ? `<tr><td>Paid by</td><td>${esc(from)}</td></tr>` : ''}
<tr><td>Method</td><td>${esc(methodLabel(method))}${ref ? ` · ${esc(ref)}` : ''}</td></tr>
<tr><td>Date</td><td>${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>
</table>
<div class="big">₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
<p style="font-size:12px;color:#555;margin-top:18px">Adjusted against the final hospital bill. Any amount not used is refunded at discharge.</p>
<script>setTimeout(()=>window.print(),300)</script></body></html>`)
  w.document.close()
}

function PharmacyRequestForm({ stay, clinical, left, onDone, onError }: {
  stay: Admission; clinical: boolean; left: number; onDone: (text: string) => void; onError: (text: string) => void
}) {
  const [orders, setOrders] = useState<MedicationOrder[]>([])
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState([{ name: '', qty: '' }])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // The drug chart is clinical-only (0057); reception types the medicines.
  useEffect(() => { if (clinical) getMedicationOrders(stay.id).then(o => setOrders(o.filter(x => x.status === 'active'))).catch(() => setOrders([])) }, [clinical, stay.id])

  const items = [
    ...orders.filter(o => picked[o.id] !== undefined).map(o => ({ name: [o.drug_name, o.strength, o.form].filter(Boolean).join(' '), qty: picked[o.id], order_id: o.id })),
    ...extra.filter(x => x.name.trim()).map(x => ({ name: x.name.trim(), qty: x.qty.trim() })),
  ]
  const send = async () => {
    setBusy(true); onError('')
    try { await requestFromPharmacy(stay.id, items, note); onDone(`Sent to the pharmacy: ${items.length} medicine${items.length === 1 ? '' : 's'}.`) }
    catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 6, fontSize: 13 }}>
      {left < 0 && <div style={{ fontSize: 12, color: '#8a2b2b' }}>The deposit is already short by {moneyExact(-left)} — the pharmacy will still issue; take more deposit when you can.</div>}
      {orders.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: BIZ.muted }}>From the drug chart</div>
          {orders.map(o => (
            <label key={o.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={picked[o.id] !== undefined}
                onChange={e => setPicked(p => { const n = { ...p }; if (e.target.checked) n[o.id] = ''; else delete n[o.id]; return n })} />
              <span style={{ flex: 1 }}>{[o.drug_name, o.strength, o.form].filter(Boolean).join(' ')} <span style={{ color: BIZ.muted }}>· {o.dose_text} {o.frequency_code}</span></span>
              {picked[o.id] !== undefined && (
                <input style={{ ...input, width: 80 }} placeholder="Qty" value={picked[o.id]} onChange={e => setPicked(p => ({ ...p, [o.id]: e.target.value }))} />
              )}
            </label>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: BIZ.muted }}>{orders.length ? 'Anything else' : 'Medicines'}</div>
      {extra.map((x, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Medicine, e.g. Inj. Ceftriaxone 1 g" value={x.name}
            onChange={e => setExtra(xs => xs.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} />
          <input style={{ ...input, width: 80 }} placeholder="Qty" value={x.qty}
            onChange={e => setExtra(xs => xs.map((y, j) => j === i ? { ...y, qty: e.target.value } : y))} />
        </div>
      ))}
      <button style={{ ...btn(), justifySelf: 'start' }} onClick={() => setExtra(xs => [...xs, { name: '', qty: '' }])}>+ Another</button>
      <input style={input} placeholder="Note for the pharmacy (optional)" value={note} onChange={e => setNote(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={btn(true)} disabled={busy || items.length === 0} onClick={send}>
          {busy ? 'Sending…' : 'Send to pharmacy'}
        </button>
        {/* 0284: or the attendant fetches them, with a slip. */}
        <button style={btn()} disabled={busy || items.length === 0}
          onClick={() => { printMedicineSlip(stay, items.map(i => ({ name: i.name, qty: i.qty }))); onDone('Slip printed for the attendant.') }}>
          Print slip for attendant
        </button>
      </div>
    </div>
  )
}
