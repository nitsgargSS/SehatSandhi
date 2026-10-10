import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { BIZ } from '../business/shared'
import { moneyExact } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import {
  type Charge, type ChargeCategory, type PaymentMethod, type PriceItem,
  HEAD_LABELS, INVOICE_GST_RATES, PAYMENT_METHOD_OPTIONS, counterInvoice, listPriceItems, savePriceItem, retirePriceItem,
} from '../../lib/billingApi'

// An invoice at the counter (0225): the tests done and things sold today —
// an OCT, a perimetry, a pair of spectacles — picked from the clinic's own
// price list, with the money taken, in one step. It writes the same charges,
// bill and payment the ledger below shows, so the day's collections and the
// revenue report count it like everything else.
//
// A stay's charges are not offered here: they belong to the IPD bill.
//
// GST (0226): 0% unless the biller picks a rate for the line; it is added to
// the rate. The clinic's GSTIN prints on the bill when it has one saved.

const card: React.CSSProperties = { background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: 16 }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: BIZ.mutedWarm }
const input: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, fontFamily: 'inherit', fontSize: 14,
  border: `1px solid ${BIZ.inputBorder}`, background: '#fff', color: BIZ.ink,
}
const btn = (primary = false): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '8px 14px', borderRadius: 9,
  border: primary ? 'none' : `1px solid ${BIZ.inputBorder}`, background: primary ? BIZ.green : '#fff', color: primary ? '#fff' : BIZ.ink,
})

// What a price-list item or a typed line can be. Bed days are posted from the stay.
const KINDS: ChargeCategory[] = ['lab', 'procedure', 'product', 'consultation', 'medicine', 'consumable', 'other']

interface Line { key: number; category: ChargeCategory; description: string; quantity: string; unitPrice: string; gst: number }
const blank = (key: number): Line => ({ key, category: 'lab', description: '', quantity: '1', unitPrice: '', gst: 0 })
const num = (s: string) => Number(s) || 0
const paise = (n: number) => Math.round(n * 100) / 100
/** A line before tax, its tax, and what the patient pays for it. */
const lineOf = (l: Line) => {
  const base = paise(num(l.quantity || '1') * num(l.unitPrice))
  const total = paise(base * (1 + l.gst / 100))
  return { base, tax: paise(total - base), total }
}

export default function CounterInvoice({ memberId, businessId, practitionerId, charges, canManage, onChange }: {
  memberId: string
  businessId: string
  /** Who is signed in — recorded as who made the invoice. */
  practitionerId?: string | null
  charges: Charge[]
  /** Owner or manager: may keep the price list. */
  canManage: boolean
  onChange: () => void
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PriceItem[]>([])
  const [lines, setLines] = useState<Line[]>([blank(1)])
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [discount, setDiscount] = useState('')
  const [reason, setReason] = useState('')
  const [paid, setPaid] = useState<string | null>(null)      // null: follows the total
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ billNo: string; token: string; net: number; paid: number } | null>(null)
  const [managing, setManaging] = useState(false)
  // Whether the clinic has a GSTIN saved: undefined until known.
  const [gstin, setGstin] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!open) return
    supabase.from('businesses').select('gstin').eq('id', businessId).maybeSingle()
      .then(({ data, error }) => { if (!error) setGstin((data?.gstin as string | null) || null) })
  }, [open, businessId])

  const loadItems = useCallback(() => { listPriceItems(businessId).then(setItems).catch(() => setItems([])) }, [businessId])
  useEffect(() => { if (open) loadItems() }, [open, loadItems])

  // Already on the account and not yet on a bill — today's OPD fee, usually.
  const unbilled = charges.filter(c => !c.bill_id && !c.admission_id)
  const carried = unbilled.filter(c => !skip.has(c.id))
  const filled = lines.filter(l => l.description.trim() && l.unitPrice.trim() !== '')
  const subtotal = paise(filled.reduce((s, l) => s + lineOf(l).total, 0)
    + carried.reduce((s, c) => s + Number(c.amount), 0))
  const gstTotal = paise(filled.reduce((s, l) => s + lineOf(l).tax, 0))
  const net = paise(subtotal - num(discount))
  const paying = paid === null ? net : num(paid)
  const valid = (filled.length > 0 || carried.length > 0) && net >= 0 && paying >= 0 && paying <= net
    && (num(discount) === 0 || reason.trim().length > 2)

  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l))
  const pick = (key: number, id: string) => {
    const it = items.find(i => i.id === id)
    if (it) set(key, { category: it.category, description: it.name, unitPrice: String(it.price), gst: it.gst_rate })
  }
  const reset = () => { setLines([blank(Date.now())]); setSkip(new Set()); setDiscount(''); setReason(''); setPaid(null); setMethod('cash'); setReference('') }

  const create = async () => {
    setBusy(true); setErr('')
    try {
      const r = await counterInvoice({
        businessId, memberId,
        lines: filled.map(l => ({ category: l.category, description: l.description.trim(), quantity: num(l.quantity || '1') || 1, unitPrice: num(l.unitPrice), gstRate: l.gst })),
        chargeIds: carried.map(c => c.id),
        discount: num(discount), discountReason: reason.trim(),
        paid: paying, method, reference: reference.trim(), recordedBy: practitionerId ?? null,
      })
      setDone({ billNo: r.bill_no, token: r.token, net: Number(r.net), paid: Number(r.paid) })
      reset(); onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: '#f3faf6', borderColor: '#bfe3d0' }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: BIZ.ink }}>New invoice</div>
          <div style={{ fontSize: 12.5, color: BIZ.muted }}>Tests, procedures and things sold — with the payment, in one step.</div>
        </div>
        <button style={btn(true)} onClick={() => { setOpen(true); setDone(null) }}>
          <Plus className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />New invoice
        </button>
      </div>
    )
  }

  return (
    <div style={{ ...card, borderColor: '#bfe3d0', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <div style={label}>New invoice</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {canManage && <button style={{ ...btn(), padding: '5px 10px', fontSize: 12 }} onClick={() => setManaging(m => !m)}>{managing ? 'Done with price list' : 'Price list'}</button>}
          <button style={{ background: 'none', border: 'none', color: BIZ.muted, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => { setOpen(false); setManaging(false) }}>Close</button>
        </div>
      </div>

      {managing && <PriceList businessId={businessId} items={items} onChange={loadItems} />}

      {done && (
        <div style={{ background: '#f3faf6', border: '1px solid #bfe3d0', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: BIZ.ink }}>
          Invoice <b>{done.billNo}</b> made for {moneyExact(done.net)}
          {done.paid > 0 ? `, ${moneyExact(done.paid)} received` : ', nothing received yet'}
          {done.net - done.paid > 0.004 ? ` — ${moneyExact(done.net - done.paid)} still due` : ''}.{' '}
          <a href={`/bill/${done.token}`} target="_blank" rel="noreferrer" style={{ color: BIZ.green, fontWeight: 700 }}>Open to print</a>
          <span style={{ color: BIZ.muted }}> · It is also under Bills below, to send on WhatsApp or email.</span>
        </div>
      )}
      {err && <div style={{ color: '#8a2b2b', fontSize: 13 }}>{err}</div>}

      <div style={{ display: 'grid', gap: 7 }}>
        {lines.map(l => (
          <div key={l.key} style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            {items.length > 0 && (
              <select style={{ ...input, flex: '1 1 170px' }} value="" onChange={e => pick(l.key, e.target.value)} aria-label="Pick from the price list">
                <option value="">Pick from price list…</option>
                {KINDS.filter(k => items.some(i => i.category === k)).map(k => (
                  <optgroup key={k} label={HEAD_LABELS[k]}>
                    {items.filter(i => i.category === k).map(i => <option key={i.id} value={i.id}>{i.name} — {moneyExact(i.price)}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            <input style={{ ...input, flex: '2 1 180px' }} placeholder="What for — e.g. OCT, Perimetry, Spectacles" maxLength={200}
              value={l.description} onChange={e => set(l.key, { description: e.target.value })} />
            <select style={{ ...input, flex: '0 1 150px' }} value={l.category} onChange={e => set(l.key, { category: e.target.value as ChargeCategory })} aria-label="Kind">
              {KINDS.map(k => <option key={k} value={k}>{HEAD_LABELS[k]}</option>)}
            </select>
            <input style={{ ...input, flex: '0 1 70px' }} inputMode="decimal" placeholder="Qty" aria-label="Quantity"
              value={l.quantity} onChange={e => set(l.key, { quantity: e.target.value.replace(/[^0-9.]/g, '') })} />
            <input style={{ ...input, flex: '0 1 105px' }} inputMode="decimal" placeholder="Rate ₹" aria-label="Rate"
              value={l.unitPrice} onChange={e => set(l.key, { unitPrice: e.target.value.replace(/[^0-9.]/g, '') })} />
            <select style={{ ...input, flex: '0 1 100px' }} value={l.gst} onChange={e => set(l.key, { gst: Number(e.target.value) })} aria-label="GST">
              {[...new Set([...INVOICE_GST_RATES, l.gst])].sort((a, b) => a - b).map(r => <option key={r} value={r}>{r === 0 ? 'No GST' : `GST ${r}%`}</option>)}
            </select>
            <span style={{ flex: '0 0 84px', textAlign: 'right', fontSize: 13.5, fontWeight: 700, color: BIZ.ink }}>
              {moneyExact(lineOf(l).total)}
            </span>
            <button aria-label="Remove line" style={{ ...btn(), padding: 6 }} disabled={lines.length === 1}
              onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <div>
          <button style={{ ...btn(), fontSize: 12 }} onClick={() => setLines(ls => [...ls, blank(Date.now())])}>
            <Plus className="w-3 h-3" style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />Add a line
          </button>
          {items.length === 0 && canManage && !managing && (
            <span style={{ fontSize: 12, color: BIZ.muted, marginLeft: 10 }}>Tip: save your tests and prices once in the price list, then just pick them.</span>
          )}
        </div>
      </div>

      {unbilled.length > 0 && (
        <div style={{ display: 'grid', gap: 5 }}>
          <div style={{ fontSize: 12.5, color: BIZ.muted }}>Already on this patient's account, not yet on a bill — tick to put on this invoice:</div>
          {unbilled.map(c => (
            <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: BIZ.ink, cursor: 'pointer' }}>
              <input type="checkbox" checked={!skip.has(c.id)}
                onChange={() => setSkip(s => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })} />
              <span style={{ flex: 1 }}>{c.description} <span style={{ color: BIZ.mutedWarm, fontSize: 12 }}>· {c.charged_on}</span></span>
              <b>{moneyExact(Number(c.amount))}</b>
            </label>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', borderTop: `1px solid ${BIZ.border}`, paddingTop: 12 }}>
        <input style={{ ...input, flex: '0 1 130px' }} inputMode="decimal" placeholder="Discount ₹"
          value={discount} onChange={e => setDiscount(e.target.value.replace(/[^0-9.]/g, ''))} />
        {num(discount) > 0 && (
          <input style={{ ...input, flex: '2 1 200px' }} placeholder="Why the discount" maxLength={200} value={reason} onChange={e => setReason(e.target.value)} />
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: BIZ.muted }}>
          {gstTotal > 0 && <>GST {moneyExact(gstTotal)} included · </>}
          {num(discount) > 0 && <>Subtotal {moneyExact(subtotal)} · </>}
          Total <b style={{ fontSize: 17, color: BIZ.ink }}>{moneyExact(net)}</b>
        </span>
      </div>

      {gstTotal > 0 && gstin !== undefined && (
        <div style={{ fontSize: 12, color: gstin ? BIZ.muted : '#8a5a00' }}>
          {gstin
            ? `GST is added to the rate of each line that carries it. GSTIN ${gstin} prints on the invoice.`
            : 'This clinic has no GSTIN saved, so none will print on the invoice. GST may only be collected by a registered business — save the GSTIN under Clinic details, or choose "No GST".'}
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: BIZ.ink, fontWeight: 700 }}>Received now</span>
        <input style={{ ...input, flex: '0 1 130px' }} inputMode="decimal" placeholder="Amount ₹" aria-label="Amount received"
          value={paid === null ? (net > 0 ? String(net) : '') : paid} onChange={e => setPaid(e.target.value.replace(/[^0-9.]/g, ''))} />
        <select style={{ ...input, flex: '0 1 150px' }} value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} aria-label="How it was paid">
          {PAYMENT_METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input style={{ ...input, flex: '1 1 150px' }} placeholder="Reference (UPI ref, cheque no.)" value={reference} onChange={e => setReference(e.target.value)} />
        <button style={{ ...btn(true), opacity: busy || !valid ? .5 : 1 }} disabled={busy || !valid} onClick={create}>
          {busy ? 'Making…' : 'Make invoice'}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: BIZ.mutedWarm }}>
        {paying > net ? 'The amount received is more than the invoice.'
          : paying < net && net > 0 ? `${moneyExact(net - paying)} will stay due on the patient's account. Enter 0 if nothing is paid now.`
          : 'The payment shows in today\'s Collections under your name.'}
      </div>
    </div>
  )
}

// The clinic's price list: what it charges for each test, procedure or thing
// sold. Kept by the owner and manager. A removed item stays on old invoices.
function PriceList({ businessId, items, onChange }: { businessId: string; items: PriceItem[]; onChange: () => void }) {
  const [n, setN] = useState({ name: '', category: 'lab' as ChargeCategory, price: '', gst: 0 })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn(); onChange() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div style={{ background: '#fbfaf7', border: `1px solid ${BIZ.border}`, borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12.5, color: BIZ.muted }}>Your price list — tests, procedures and things you sell. Everyone at the counter picks from it. Prices are before GST.</div>
      {err && <div style={{ color: '#8a2b2b', fontSize: 13 }}>{err}</div>}
      {items.map(i => (
        <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: BIZ.ink }}>
          <span style={{ flex: 1 }}>{i.name} <span style={{ color: BIZ.mutedWarm, fontSize: 12 }}>· {HEAD_LABELS[i.category]}{i.gst_rate > 0 ? ` · + GST ${i.gst_rate}%` : ''}</span></span>
          <input style={{ ...input, width: 110 }} inputMode="decimal" defaultValue={String(i.price)} aria-label={`Price of ${i.name}`}
            onBlur={e => { const v = Number(e.target.value); if (e.target.value !== '' && v >= 0 && v !== Number(i.price)) run(() => savePriceItem(businessId, { id: i.id, name: i.name, category: i.category, price: v, gstRate: i.gst_rate })) }} />
          <button aria-label={`Remove ${i.name}`} style={{ ...btn(), padding: 6 }} disabled={busy} onClick={() => run(() => retirePriceItem(i.id))}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <input style={{ ...input, flex: '2 1 180px' }} placeholder="Name — e.g. OCT" maxLength={120} value={n.name} onChange={e => setN({ ...n, name: e.target.value })} />
        <select style={{ ...input, flex: '0 1 160px' }} value={n.category} onChange={e => setN({ ...n, category: e.target.value as ChargeCategory })} aria-label="Kind">
          {KINDS.map(k => <option key={k} value={k}>{HEAD_LABELS[k]}</option>)}
        </select>
        <input style={{ ...input, flex: '0 1 110px' }} inputMode="decimal" placeholder="Price ₹" value={n.price} onChange={e => setN({ ...n, price: e.target.value.replace(/[^0-9.]/g, '') })} />
        <select style={{ ...input, flex: '0 1 105px' }} value={n.gst} onChange={e => setN({ ...n, gst: Number(e.target.value) })} aria-label="GST">
          {INVOICE_GST_RATES.map(r => <option key={r} value={r}>{r === 0 ? 'No GST' : `+ GST ${r}%`}</option>)}
        </select>
        <button style={btn(true)} disabled={busy || !n.name.trim() || n.price === ''}
          onClick={() => run(async () => { await savePriceItem(businessId, { name: n.name.trim(), category: n.category, price: Number(n.price), gstRate: n.gst }); setN({ name: '', category: n.category, price: '', gst: n.gst }) })}>Add</button>
      </div>
    </div>
  )
}
