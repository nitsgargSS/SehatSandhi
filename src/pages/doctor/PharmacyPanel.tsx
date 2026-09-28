import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Package, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { moneyExact, shortDate, isoDate } from '../../lib/format'
import { searchPatients, PatientSearchResult } from '../../lib/patientsApi'
import {
  getStock, saveItem, getBatches, adjustStock, recordPurchase, getPurchases, getSuppliers,
  issueBill, getBills, recordPayment, returnItems, cancelBill, getPrescriptionsForDispensing,
  getSummary, getPharmacySettings, savePharmacySettings, itemLabel, matchItem,
  StockRow, Batch, PharmacyBill, Purchase, RxForDispensing, PharmacySummary, PharmacySettings,
  PharmacyItem, PharmacyPayMethod, PurchaseLine, PAY_METHODS, GST_RATES,
} from '../../lib/pharmacyApi'

// In-house dispensing (0158): the clinic's own medicine counter.
//
// Everyone on the staff can sell, take payment and take a return. Medicines,
// purchases, stock counts, cancelling a bill and the summary are for the owner,
// a manager or a doctor — the database refuses anyone else, so the hidden
// sections are a courtesy, not the lock.

type Section = 'sell' | 'bills' | 'stock' | 'purchases' | 'summary' | 'settings'

const printBill = (id: string) => window.open(`/business/print/pharmacy/${id}`, '_blank')
const today = () => isoDate()
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d) }
const plusDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d) }
const soon = (iso: string | null, days: number) => !!iso && new Date(iso) <= new Date(Date.now() + days * 86400000)

function Err({ msg }: { msg: string }) {
  return msg ? <p className="text-sm text-red-600 mt-2">{msg}</p> : null
}

export default function PharmacyPanel({ businessId, canManage, canSettings }: {
  businessId: string
  /** Owner, manager or doctor: medicines, purchases, stock counts, cancel, summary. */
  canManage: boolean
  /** Owner or manager: GSTIN and drug licence. */
  canSettings: boolean
}) {
  const [section, setSection] = useState<Section>('sell')
  const [stock, setStock] = useState<StockRow[]>([])
  const [settings, setSettings] = useState<PharmacySettings | null>(null)

  const reloadStock = useCallback(() => { getStock(businessId).then(setStock).catch(() => setStock([])) }, [businessId])
  useEffect(() => { reloadStock(); getPharmacySettings(businessId).then(setSettings) }, [businessId, reloadStock])

  const low = stock.filter(s => s.is_active && s.qty_available <= s.reorder_level).length
  const expiring = stock.filter(s => s.qty_expired > 0 || (s.qty_available > 0 && soon(s.next_expiry, 60))).length

  const sections: [Section, string][] = [
    ['sell', 'New bill'], ['bills', 'Bills'], ['stock', 'Stock'],
    ...(canManage ? [['purchases', 'Purchases'], ['summary', 'Summary']] as [Section, string][] : []),
    ...(canSettings ? [['settings', 'Settings']] as [Section, string][] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-700">Pharmacy</h2>
          <p className="text-sm text-gray-500">
            In-house dispensing · {settings?.pharmacy_gstin ? `GST bills (GSTIN ${settings.pharmacy_gstin})` : 'bills without GST'}
          </p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {sections.map(([s, label]) => (
            <button key={s} onClick={() => setSection(s)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${section === s
                ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {(low > 0 || expiring > 0) && section !== 'stock' && (
        <button onClick={() => setSection('stock')}
          className="w-full text-left card shadow-sm py-3 text-sm text-amber-800 bg-amber-50 border-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {[low ? `${low} medicine${low > 1 ? 's' : ''} at or below reorder level` : '',
            expiring ? `${expiring} expired or expiring within 60 days` : ''].filter(Boolean).join(' · ')}
        </button>
      )}

      {section === 'sell' && <SellSection businessId={businessId} stock={stock} onSold={reloadStock}
        gst={!!settings?.pharmacy_gstin} goStock={() => setSection('stock')} canManage={canManage} />}
      {section === 'bills' && <BillsSection businessId={businessId} canManage={canManage} onStockChanged={reloadStock} />}
      {section === 'stock' && <StockSection businessId={businessId} stock={stock} canManage={canManage} reload={reloadStock} />}
      {section === 'purchases' && canManage && <PurchasesSection businessId={businessId} stock={stock} reload={reloadStock} />}
      {section === 'summary' && canManage && <SummarySection businessId={businessId} />}
      {section === 'settings' && canSettings && settings && (
        <SettingsSection businessId={businessId} settings={settings}
          onSaved={() => getPharmacySettings(businessId).then(setSettings)} />
      )}
    </div>
  )
}

// ── New bill ────────────────────────────────────────────────────────────────

interface Line { key: string; item: StockRow; qty: number }

function MedicinePicker({ stock, onPick, placeholder = 'Add a medicine — type its name' }: {
  stock: StockRow[]; onPick: (s: StockRow) => void; placeholder?: string
}) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return stock.filter(s => s.is_active && (s.name.toLowerCase().includes(t) || (s.generic_name ?? '').toLowerCase().includes(t))).slice(0, 8)
  }, [q, stock])
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
      <input className="input-field pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} />
      {hits.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto">
          {hits.map(s => (
            <button key={s.id} type="button" onClick={() => { onPick(s); setQ('') }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50 flex justify-between gap-2">
              <span>{itemLabel(s)}{s.generic_name ? <span className="text-gray-400"> · {s.generic_name}</span> : null}</span>
              <span className={s.qty_available > 0 ? 'text-gray-500' : 'text-red-500'}>
                {s.qty_available} {s.unit}{s.unit_mrp ? ` · ${moneyExact(s.unit_mrp)}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SellSection({ businessId, stock, onSold, gst, goStock, canManage }: {
  businessId: string; stock: StockRow[]; onSold: () => void; gst: boolean; goStock: () => void; canManage: boolean
}) {
  const [mode, setMode] = useState<'patient' | 'walkin'>('patient')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PatientSearchResult[]>([])
  const [patient, setPatient] = useState<PatientSearchResult | null>(null)
  const [rxs, setRxs] = useState<RxForDispensing[]>([])
  const [rxId, setRxId] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [walkName, setWalkName] = useState('')
  const [walkPhone, setWalkPhone] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [pct, setPct] = useState('')
  const [reason, setReason] = useState('')
  const [pay, setPay] = useState('')
  const [method, setMethod] = useState<PharmacyPayMethod>('cash')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (mode !== 'patient' || patient) return
    const t = setTimeout(() => { searchPatients(q, businessId).then(setFound).catch(() => setFound([])) }, 250)
    return () => clearTimeout(t)
  }, [q, mode, patient, businessId])

  useEffect(() => {
    setRxs([]); setRxId(null); setUnmatched([])
    if (patient) getPrescriptionsForDispensing(businessId, patient.patient_member_id).then(setRxs).catch(() => setRxs([]))
  }, [patient, businessId])

  const add = (s: StockRow, qty = 1) => setLines(ls => {
    const at = ls.findIndex(l => l.item.id === s.id)
    if (at >= 0) return ls.map((l, i) => i === at ? { ...l, qty: l.qty + qty } : l)
    return [...ls, { key: `${s.id}-${Date.now()}`, item: s, qty }]
  })

  const fromRx = (rx: RxForDispensing) => {
    setRxId(rx.prescription_id)
    const missing: string[] = []
    const next: Line[] = []
    for (const it of rx.items) {
      const m = matchItem(stock, it.drug_name, it.strength)
      // "10 tablets" → 10; anything unreadable starts at 1 for the counter to fix.
      const n = parseInt(String(it.quantity ?? '').match(/\d+/)?.[0] ?? '', 10)
      if (m) next.push({ key: `${m.id}-${next.length}`, item: m, qty: n > 0 ? n : 1 })
      else missing.push([it.drug_name, it.strength].filter(Boolean).join(' '))
    }
    setLines(next); setUnmatched(missing)
  }

  const discount = Math.min(Math.max(Number(pct) || 0, 0), 100)
  const gross = lines.reduce((s, l) => s + l.qty * (l.item.unit_mrp ?? 0), 0)
  const estimate = Math.round(gross * (100 - discount) / 100)
  useEffect(() => { setPay(estimate ? String(estimate) : '') }, [estimate])

  const reset = () => {
    setLines([]); setPct(''); setReason(''); setRef(''); setRxId(null); setUnmatched([])
    setPatient(null); setQ(''); setWalkName(''); setWalkPhone('')
  }

  const submit = async () => {
    setErr('')
    if (!lines.length) { setErr('Add at least one medicine.'); return }
    if (mode === 'patient' && !patient) { setErr('Choose the patient, or switch to walk-in.'); return }
    if (mode === 'walkin' && !walkName.trim()) { setErr('Give the customer\'s name.'); return }
    if (discount > 0 && !reason.trim()) { setErr('Say why there is a discount.'); return }
    setBusy(true)
    try {
      const id = await issueBill(businessId, {
        lines: lines.map(l => ({ item_id: l.item.id, qty: l.qty })),
        patientMemberId: mode === 'patient' ? patient!.patient_member_id : null,
        customerName: mode === 'walkin' ? walkName : undefined,
        customerPhone: mode === 'walkin' ? walkPhone : undefined,
        prescriptionId: rxId,
        discountPct: discount, discountReason: reason,
        payment: { amount: Number(pay) || 0, method, reference: ref },
      })
      printBill(id)
      reset(); onSold()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!stock.length) {
    return (
      <div className="card shadow-sm text-sm text-gray-500 py-10 text-center space-y-3">
        <Package className="w-8 h-8 mx-auto text-gray-300" />
        <p>No medicines yet. {canManage ? 'Add your medicines and record a purchase to bring stock in.' : 'Ask the owner, a manager or a doctor to add medicines.'}</p>
        {canManage && <button onClick={goStock} className="btn-teal text-sm">Add medicines</button>}
      </div>
    )
  }

  return (
    <div className="card shadow-sm space-y-4">
      <div className="flex gap-2">
        {(['patient', 'walkin'] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); setRxId(null) }}
            className={`text-sm px-3 py-1.5 rounded-lg border ${mode === m ? 'border-teal-500 bg-teal-50 text-teal-700 font-semibold' : 'border-gray-200 text-gray-600'}`}>
            {m === 'patient' ? 'Clinic patient' : 'Walk-in customer'}
          </button>
        ))}
      </div>

      {mode === 'patient' ? (
        patient ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
              <span><b>{patient.full_name}</b> {patient.mrn ? `· ${patient.mrn}` : ''} {patient.phone ? `· ${patient.phone}` : ''}</span>
              <button className="text-teal-700 text-xs" onClick={() => setPatient(null)}>Change</button>
            </div>
            {rxs.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Dispense from a prescription:</p>
                {rxs.map(rx => (
                  <button key={rx.prescription_id} onClick={() => fromRx(rx)}
                    className={`w-full text-left text-sm border rounded-lg px-3 py-2 ${rxId === rx.prescription_id ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-teal-400'}`}>
                    <b>{rx.prescription_no}</b> · {shortDate(rx.issued_at)} · {rx.prescriber_name} ·{' '}
                    {rx.items.map(i => i.drug_name).join(', ')}
                    {rx.dispensed_bill_no && <span className="text-amber-700"> · already dispensed ({rx.dispensed_bill_no})</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <input className="input-field" value={q} onChange={e => setQ(e.target.value)} placeholder="Find the patient — name, phone or file number" />
            {found.length > 0 && (
              <div className="border border-gray-200 rounded-lg mt-1 divide-y">
                {found.slice(0, 8).map(p => (
                  <button key={p.patient_member_id} onClick={() => { setPatient(p); setFound([]) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50">
                    <b>{p.full_name}</b> {p.age_years != null ? `· ${p.age_years}y` : ''} {p.mrn ? `· ${p.mrn}` : ''} · {p.phone}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          <input className="input-field" value={walkName} onChange={e => setWalkName(e.target.value)} placeholder="Customer name" />
          <input className="input-field" value={walkPhone} onChange={e => setWalkPhone(e.target.value)} placeholder="Mobile (optional)" inputMode="tel" />
        </div>
      )}

      {unmatched.length > 0 && (
        <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          Not on your medicine list, so not added: {unmatched.join(', ')}. Add a substitute below if you have one.
        </p>
      )}

      <MedicinePicker stock={stock} onPick={s => add(s)} />

      {lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 text-xs">
              <th className="py-1">Medicine</th><th>In stock</th><th>Qty</th><th className="text-right">MRP each</th><th className="text-right">Amount</th><th />
            </tr></thead>
            <tbody>
              {lines.map(l => (
                <tr key={l.key} className="border-t">
                  <td className="py-2">{itemLabel(l.item)}</td>
                  <td className={l.qty > l.item.qty_available ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                    {l.item.qty_available} {l.item.unit}
                  </td>
                  <td>
                    <input type="number" min={1} className="w-20 border border-gray-300 rounded px-2 py-1" value={l.qty}
                      onChange={e => setLines(ls => ls.map(x => x.key === l.key ? { ...x, qty: Math.max(1, parseInt(e.target.value, 10) || 1) } : x))} />
                  </td>
                  <td className="text-right">{l.item.unit_mrp ? moneyExact(l.item.unit_mrp) : '—'}</td>
                  <td className="text-right">{moneyExact(l.qty * (l.item.unit_mrp ?? 0))}</td>
                  <td className="text-right">
                    <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="text-gray-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-2 items-start">
        <label className="text-xs text-gray-500">Discount %
          <input type="number" min={0} max={100} className="input-field mt-1" value={pct} onChange={e => setPct(e.target.value)} placeholder="0" />
        </label>
        {discount > 0 && (
          <label className="text-xs text-gray-500 sm:col-span-2">Why
            <input className="input-field mt-1" value={reason} onChange={e => setReason(e.target.value)} placeholder="Staff, senior citizen, regular patient…" />
          </label>
        )}
      </div>

      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span>About {moneyExact(estimate)} to pay{gst ? ' (GST included)' : ''}</span>
          <span className="text-xs text-gray-400">Exact total on the bill — each batch has its own MRP.</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-2">
          <input type="number" min={0} className="input-field" value={pay} onChange={e => setPay(e.target.value)} placeholder="Amount received" />
          <select className="input-field" value={method} onChange={e => setMethod(e.target.value as PharmacyPayMethod)}>
            {PAY_METHODS.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
          </select>
          <input className="input-field" value={ref} onChange={e => setRef(e.target.value)} placeholder="UPI / card reference (optional)" />
        </div>
        <p className="text-xs text-gray-500">Received less than the total? The rest stays on the bill as due. Received nothing? Leave it at 0 for credit.</p>
      </div>

      <Err msg={err} />
      <div className="flex justify-end">
        <button disabled={busy} onClick={submit} className="btn-teal text-sm disabled:opacity-50">
          <Printer className="w-4 h-4" /> {busy ? 'Saving…' : 'Issue bill & print'}
        </button>
      </div>
    </div>
  )
}

// ── Bills ───────────────────────────────────────────────────────────────────

function BillsSection({ businessId, canManage, onStockChanged }: { businessId: string; canManage: boolean; onStockChanged: () => void }) {
  const [range, setRange] = useState<'today' | '7' | '30' | 'due'>('today')
  const [bills, setBills] = useState<PharmacyBill[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    const from = range === 'today' ? today() : range === '7' ? daysAgo(6) : range === '30' ? daysAgo(29) : undefined
    getBills(businessId, range === 'due' ? { dueOnly: true } : { from: from + 'T00:00:00+05:30' })
      .then(b => { setBills(b); setErr('') }).catch(e => setErr((e as Error).message)).finally(() => setLoading(false))
  }, [businessId, range])
  useEffect(load, [load])

  const afterChange = () => { load(); onStockChanged() }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {([['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['due', 'Money due']] as const).map(([r, label]) => (
          <button key={r} onClick={() => setRange(r)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${range === r ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>
      <Err msg={err} />
      {loading ? <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
        : bills.length === 0 ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">No bills here.</div>
        : (
          <div className="card shadow-sm p-0 divide-y">
            {bills.map(b => (
              <div key={b.id}>
                <button onClick={() => setOpen(open === b.id ? null : b.id)} className="w-full text-left px-4 py-3 flex flex-wrap justify-between gap-2 text-sm hover:bg-gray-50">
                  <span><b>{b.bill_no}</b> · {b.customer_name} · <span className="text-gray-500">{new Date(b.issued_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></span>
                  <span className="flex gap-3">
                    {b.status === 'cancelled'
                      ? <span className="text-gray-400 line-through">{moneyExact(b.net_payable)}</span>
                      : <span className="font-semibold">{moneyExact(b.net_payable)}</span>}
                    {b.status === 'cancelled' ? <span className="text-gray-500">Cancelled</span>
                      : b.balance_due > 0 ? <span className="text-red-600">Due {moneyExact(b.balance_due)}</span>
                      : <span className="text-green-700">Paid</span>}
                  </span>
                </button>
                {open === b.id && <BillActions bill={b} canManage={canManage} onChanged={afterChange} />}
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

function BillActions({ bill, canManage, onChanged }: { bill: PharmacyBill; canManage: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'none' | 'pay' | 'return' | 'cancel'>('none')
  const [amount, setAmount] = useState(String(bill.balance_due || ''))
  const [method, setMethod] = useState<PharmacyPayMethod>('cash')
  const [ref, setRef] = useState('')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr('')
    try { setMsg(await fn()); setMode('none'); onChanged() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const live = bill.status === 'issued'

  return (
    <div className="px-4 pb-4 space-y-3 text-sm bg-gray-50">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-gray-500"><th className="py-1">Medicine</th><th>Batch</th><th>Qty</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          {bill.items.map(i => (
            <tr key={i.id} className="border-t">
              <td className="py-1">{i.name}</td>
              <td>{i.batch_no} {i.expiry_date ? `· exp ${shortDate(i.expiry_date)}` : ''}</td>
              <td>{i.quantity}{i.returned_qty ? <span className="text-amber-700"> ({i.returned_qty} returned)</span> : null}</td>
              <td className="text-right">{moneyExact(i.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-600">
        Paid {moneyExact(bill.paid)}
        {bill.payments.length ? ` (${bill.payments.map(p => `${moneyExact(p.amount)} ${p.method}`).join(', ')})` : ''}
        {bill.credited ? ` · returned ${moneyExact(bill.credited)}` : ''}
        {bill.refunded ? ` · refunded ${moneyExact(bill.refunded)}` : ''}
        {bill.discount_amount ? ` · discount ${moneyExact(bill.discount_amount)} (${bill.discount_reason})` : ''}
        {bill.cancelled_reason ? ` · cancelled: ${bill.cancelled_reason}` : ''}
      </p>
      {msg && <p className="text-green-700 text-xs">{msg}</p>}

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => printBill(bill.id)} className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1"><Printer className="w-3 h-3" /> Print</button>
        {live && bill.balance_due > 0 && <button onClick={() => setMode('pay')} className="btn-outline text-xs py-1.5 px-3">Take payment</button>}
        {live && bill.items.some(i => i.quantity > i.returned_qty) && <button onClick={() => setMode('return')} className="btn-outline text-xs py-1.5 px-3">Return medicines</button>}
        {live && canManage && <button onClick={() => setMode('cancel')} className="btn-outline text-xs py-1.5 px-3 text-red-600">Cancel bill</button>}
      </div>

      {mode === 'pay' && (
        <div className="grid sm:grid-cols-4 gap-2">
          <input type="number" className="input-field" value={amount} onChange={e => setAmount(e.target.value)} />
          <select className="input-field" value={method} onChange={e => setMethod(e.target.value as PharmacyPayMethod)}>
            {PAY_METHODS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </select>
          <input className="input-field" value={ref} onChange={e => setRef(e.target.value)} placeholder="Reference (optional)" />
          <button disabled={busy} className="btn-teal text-xs justify-center"
            onClick={() => run(async () => { await recordPayment(bill.id, Number(amount), method, ref); return `Received ${moneyExact(Number(amount))}.` })}>
            Save payment
          </button>
        </div>
      )}

      {mode === 'return' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">How many of each are coming back? They go back into the same batch.</p>
          {bill.items.filter(i => i.quantity > i.returned_qty).map(i => (
            <div key={i.id} className="flex items-center gap-2">
              <span className="flex-1">{i.name} <span className="text-gray-400">(up to {i.quantity - i.returned_qty})</span></span>
              <input type="number" min={0} max={i.quantity - i.returned_qty} className="w-20 border border-gray-300 rounded px-2 py-1"
                value={qty[i.id] ?? ''} onChange={e => setQty(q => ({ ...q, [i.id]: e.target.value }))} />
            </div>
          ))}
          <div className="grid sm:grid-cols-3 gap-2">
            <input className="input-field sm:col-span-2" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" />
            <select className="input-field" value={method} onChange={e => setMethod(e.target.value as PharmacyPayMethod)}>
              {PAY_METHODS.map(([m, l]) => <option key={m} value={m}>Refund by {l}</option>)}
            </select>
          </div>
          <button disabled={busy} className="btn-teal text-xs"
            onClick={() => run(async () => {
              const r = await returnItems(bill.id, Object.entries(qty).map(([id, n]) => ({ bill_item_id: id, qty: parseInt(n, 10) || 0 })).filter(l => l.qty > 0), method, reason)
              return r.refund > 0 ? `Returned ${moneyExact(r.credit)}. Hand back ${moneyExact(r.refund)}.` : `Returned ${moneyExact(r.credit)} — taken off what is due.`
            })}>
            Save return
          </button>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="grid sm:grid-cols-4 gap-2">
          <input className="input-field sm:col-span-2" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is it being cancelled?" />
          <select className="input-field" value={method} onChange={e => setMethod(e.target.value as PharmacyPayMethod)}>
            {PAY_METHODS.map(([m, l]) => <option key={m} value={m}>Refund by {l}</option>)}
          </select>
          <button disabled={busy} className="btn-teal text-xs justify-center bg-red-600 hover:bg-red-700"
            onClick={() => run(async () => {
              const r = await cancelBill(bill.id, reason, method)
              return r.refund > 0 ? `Cancelled. Hand back ${moneyExact(r.refund)}. Stock is back on the shelf.` : 'Cancelled. Stock is back on the shelf.'
            })}>
            Cancel bill
          </button>
        </div>
      )}
      <Err msg={err} />
    </div>
  )
}

// ── Stock and medicines ─────────────────────────────────────────────────────

const blankItem: Partial<PharmacyItem> = { name: '', generic_name: '', strength: '', form: 'tablet', unit: 'tablet', pack_size: 10, hsn_code: '3004', gst_rate: 12, reorder_level: 0 }

function ItemForm({ businessId, item, onSaved, onCancel }: {
  businessId: string; item: Partial<PharmacyItem>; onSaved: () => void; onCancel: () => void
}) {
  const [f, setF] = useState<Partial<PharmacyItem>>(item)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof PharmacyItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF(x => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    setBusy(true); setErr('')
    try { await saveItem(businessId, f); onSaved() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const field = (k: keyof PharmacyItem, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="text-xs text-gray-500">{label}
      <input className="input-field mt-1" value={String(f[k] ?? '')} onChange={set(k)} {...props} />
    </label>
  )
  return (
    <div className="card shadow-sm space-y-3">
      <h3 className="font-bold text-navy-700">{f.id ? 'Edit medicine' : 'Add a medicine'}</h3>
      <div className="grid sm:grid-cols-3 gap-2">
        {field('name', 'Brand name *', { placeholder: 'Dolo' })}
        {field('strength', 'Strength', { placeholder: '650mg' })}
        {field('form', 'Form', { placeholder: 'tablet, syrup, injection' })}
        {field('generic_name', 'Generic name', { placeholder: 'Paracetamol' })}
        {field('unit', 'Sold per', { placeholder: 'tablet, bottle, tube' })}
        {field('pack_size', 'Units in a pack', { type: 'number', min: 1 })}
        {field('hsn_code', 'HSN code', { placeholder: '3004' })}
        <label className="text-xs text-gray-500">GST rate
          <select className="input-field mt-1" value={String(f.gst_rate ?? 12)} onChange={set('gst_rate')}>
            {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </label>
        {field('reorder_level', 'Warn when stock is at or below', { type: 'number', min: 0 })}
      </div>
      <p className="text-xs text-gray-500">GST rate and HSN are used only if your clinic has a GSTIN for the pharmacy (Settings).</p>
      {f.id && (
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={f.is_active ?? true} onChange={e => setF(x => ({ ...x, is_active: e.target.checked }))} /> Still stocked
        </label>
      )}
      <Err msg={err} />
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-outline text-sm">Cancel</button>
        <button disabled={busy} onClick={save} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

function StockSection({ businessId, stock, canManage, reload }: { businessId: string; stock: StockRow[]; canManage: boolean; reload: () => void }) {
  const [editing, setEditing] = useState<Partial<PharmacyItem> | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [filter, setFilter] = useState<'all' | 'low' | 'expiry'>('all')
  const [q, setQ] = useState('')

  useEffect(() => { if (open) getBatches(open).then(setBatches).catch(() => setBatches([])) }, [open])

  const rows = stock.filter(s => (filter === 'all' ? true
    : filter === 'low' ? s.is_active && s.qty_available <= s.reorder_level
    : s.qty_expired > 0 || (s.qty_available > 0 && soon(s.next_expiry, 60))))
    .filter(s => !q.trim() || itemLabel(s).toLowerCase().includes(q.trim().toLowerCase()) || (s.generic_name ?? '').toLowerCase().includes(q.trim().toLowerCase()))
  const value = stock.reduce((s, r) => s + r.stock_value, 0)

  if (editing) return <ItemForm businessId={businessId} item={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-1 flex-wrap">
          {([['all', 'All'], ['low', 'Reorder'], ['expiry', 'Expired / expiring']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${filter === k ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500'}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          {canManage && <span className="text-xs text-gray-500">Stock at cost {moneyExact(value)}</span>}
          {canManage && <button onClick={() => setEditing({ ...blankItem })} className="btn-teal text-xs py-2 px-4"><Plus className="w-4 h-4" /> Medicine</button>}
        </div>
      </div>
      <input className="input-field" value={q} onChange={e => setQ(e.target.value)} placeholder="Search medicines" />
      {rows.length === 0 ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">Nothing here.</div> : (
        <div className="card shadow-sm p-0 divide-y">
          {rows.map(s => (
            <div key={s.id}>
              <button onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full text-left px-4 py-3 text-sm flex flex-wrap justify-between gap-2 hover:bg-gray-50">
                <span className={s.is_active ? '' : 'text-gray-400'}>
                  <b>{itemLabel(s)}</b>{s.generic_name ? <span className="text-gray-400"> · {s.generic_name}</span> : null}
                  {!s.is_active && ' · not stocked'}
                </span>
                <span className="flex gap-3 text-xs items-center">
                  <span className={s.qty_available <= s.reorder_level ? 'text-red-600 font-semibold' : ''}>{s.qty_available} {s.unit}</span>
                  {s.next_expiry && <span className={soon(s.next_expiry, 60) ? 'text-amber-700' : 'text-gray-500'}>exp {shortDate(s.next_expiry)}</span>}
                  {s.qty_expired > 0 && <span className="text-red-600">{s.qty_expired} expired</span>}
                  {s.unit_mrp != null && <span className="text-gray-500">{moneyExact(s.unit_mrp)}/{s.unit}</span>}
                </span>
              </button>
              {open === s.id && (
                <div className="px-4 pb-4 bg-gray-50 space-y-2">
                  {batches.length === 0 ? <p className="text-xs text-gray-500">No batches yet — record a purchase to bring stock in.</p> : (
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-gray-500"><th className="py-1">Batch</th><th>Expiry</th><th>In hand</th><th>MRP</th>{canManage && <th>Cost</th>}{canManage && <th />}</tr></thead>
                      <tbody>{batches.map(b => <BatchRow key={b.id} b={b} unit={s.unit} canManage={canManage} onDone={() => { reload(); getBatches(s.id).then(setBatches) }} />)}</tbody>
                    </table>
                  )}
                  {canManage && <button onClick={() => setEditing(s)} className="btn-outline text-xs py-1.5 px-3">Edit medicine</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BatchRow({ b, unit, canManage, onDone }: { b: Batch; unit: string; canManage: boolean; onDone: () => void }) {
  const [counting, setCounting] = useState(false)
  const [n, setN] = useState(String(b.qty_in_hand))
  const [why, setWhy] = useState('')
  const [err, setErr] = useState('')
  const expired = b.expiry_date < today()
  const save = async () => {
    setErr('')
    try { await adjustStock(b.id, parseInt(n, 10), why); setCounting(false); onDone() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <>
      <tr className="border-t">
        <td className="py-1">{b.batch_no}</td>
        <td className={expired ? 'text-red-600' : soon(b.expiry_date, 60) ? 'text-amber-700' : ''}>{shortDate(b.expiry_date)}{expired ? ' (expired)' : ''}</td>
        <td>{b.qty_in_hand} / {b.qty_received} {unit}</td>
        <td>{moneyExact(b.unit_mrp)}</td>
        {canManage && <td>{moneyExact(b.unit_cost)}</td>}
        {canManage && <td className="text-right"><button onClick={() => setCounting(c => !c)} className="text-teal-700">Correct count</button></td>}
      </tr>
      {counting && (
        <tr><td colSpan={6} className="py-2">
          <div className="flex flex-wrap gap-2 items-center">
            <input type="number" min={0} className="w-24 border border-gray-300 rounded px-2 py-1" value={n} onChange={e => setN(e.target.value)} />
            <input className="flex-1 border border-gray-300 rounded px-2 py-1" value={why} onChange={e => setWhy(e.target.value)}
              placeholder={expired ? 'Expired — thrown out' : 'Physical count, damaged, expired…'} />
            <button onClick={save} className="btn-teal text-xs py-1 px-3">Save</button>
          </div>
          <Err msg={err} />
        </td></tr>
      )}
    </>
  )
}

// ── Purchases ───────────────────────────────────────────────────────────────

interface PLine extends Omit<PurchaseLine, 'packs' | 'free_packs' | 'pack_cost' | 'pack_mrp'> {
  key: string; label: string; pack: number; packs: string; free_packs: string; pack_cost: string; pack_mrp: string
}

function PurchasesSection({ businessId, stock, reload }: { businessId: string; stock: StockRow[]; reload: () => void }) {
  const [list, setList] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [supplier, setSupplier] = useState('')
  const [invoice, setInvoice] = useState('')
  const [date, setDate] = useState(today())
  const [lines, setLines] = useState<PLine[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    getPurchases(businessId).then(setList).catch(() => setList([]))
    getSuppliers(businessId).then(setSuppliers).catch(() => setSuppliers([]))
  }, [businessId])
  useEffect(load, [load])

  const add = (s: StockRow) => setLines(ls => [...ls, {
    key: `${s.id}-${Date.now()}`, item_id: s.id, label: `${itemLabel(s)} (pack of ${s.pack_size} ${s.unit})`, pack: s.pack_size,
    batch_no: '', expiry_date: '', packs: '', free_packs: '', pack_cost: '', pack_mrp: '',
  }])
  const upd = (key: string, k: keyof PLine, v: string) => setLines(ls => ls.map(l => l.key === key ? { ...l, [k]: v } : l))
  const total = lines.reduce((s, l) => s + (Number(l.packs) || 0) * (Number(l.pack_cost) || 0), 0)

  const save = async () => {
    setBusy(true); setErr('')
    try {
      await recordPurchase(businessId, supplier, invoice, date, lines.map(l => ({
        item_id: l.item_id, batch_no: l.batch_no, expiry_date: l.expiry_date,
        packs: Number(l.packs) || 0, free_packs: Number(l.free_packs) || 0,
        pack_cost: Number(l.pack_cost) || 0, pack_mrp: Number(l.pack_mrp) || 0,
      })))
      setAdding(false); setLines([]); setSupplier(''); setInvoice(''); setDate(today())
      load(); reload()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!adding) return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={() => setAdding(true)} className="btn-teal text-sm" disabled={!stock.length}><Plus className="w-4 h-4" /> Record a purchase</button></div>
      {!stock.length && <p className="text-sm text-gray-500">Add your medicines under Stock first.</p>}
      {list.length === 0 ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">No purchases yet.</div> : (
        <div className="card shadow-sm p-0 divide-y">
          {list.map(p => (
            <div key={p.id} className="px-4 py-3 text-sm flex justify-between gap-2">
              <span><b>{p.supplier_name ?? 'Supplier not given'}</b>{p.invoice_no ? ` · inv. ${p.invoice_no}` : ''} · {shortDate(p.invoice_date)}</span>
              <span>{moneyExact(p.total_cost)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="card shadow-sm space-y-3">
      <h3 className="font-bold text-navy-700">Record a purchase</h3>
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="text-xs text-gray-500">Supplier
          <input className="input-field mt-1" list="pharmacy-suppliers" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Distributor's name" />
          <datalist id="pharmacy-suppliers">{suppliers.map(s => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="text-xs text-gray-500">Their invoice no.
          <input className="input-field mt-1" value={invoice} onChange={e => setInvoice(e.target.value)} />
        </label>
        <label className="text-xs text-gray-500">Invoice date
          <input type="date" className="input-field mt-1" value={date} onChange={e => setDate(e.target.value)} />
        </label>
      </div>
      <MedicinePicker stock={stock} onPick={add} placeholder="Add a medicine that came in" />
      {lines.map(l => (
        <div key={l.key} className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-sm"><b>{l.label}</b>
            <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <input className="input-field" placeholder="Batch no." value={l.batch_no} onChange={e => upd(l.key, 'batch_no', e.target.value)} />
            <input className="input-field" type="date" min={plusDays(today(), 1)} value={l.expiry_date} onChange={e => upd(l.key, 'expiry_date', e.target.value)} title="Expiry" />
            <input className="input-field" type="number" min={0} placeholder="Packs" value={l.packs} onChange={e => upd(l.key, 'packs', e.target.value)} />
            <input className="input-field" type="number" min={0} placeholder="Free packs" value={l.free_packs} onChange={e => upd(l.key, 'free_packs', e.target.value)} />
            <input className="input-field" type="number" min={0} step="0.01" placeholder="Cost / pack" value={l.pack_cost} onChange={e => upd(l.key, 'pack_cost', e.target.value)} />
            <input className="input-field" type="number" min={0} step="0.01" placeholder="MRP / pack" value={l.pack_mrp} onChange={e => upd(l.key, 'pack_mrp', e.target.value)} />
          </div>
          {Number(l.pack_mrp) > 0 && <p className="text-xs text-gray-500">Sells at {moneyExact(Number(l.pack_mrp) / l.pack)} each · {((Number(l.packs) || 0) + (Number(l.free_packs) || 0)) * l.pack} into stock</p>}
        </div>
      ))}
      <p className="text-sm text-right">Total cost {moneyExact(total)}</p>
      <Err msg={err} />
      <div className="flex gap-2 justify-end">
        <button onClick={() => { setAdding(false); setLines([]) }} className="btn-outline text-sm">Cancel</button>
        <button disabled={busy || !lines.length} onClick={save} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save purchase'}</button>
      </div>
    </div>
  )
}

// ── Summary ─────────────────────────────────────────────────────────────────

function SummarySection({ businessId }: { businessId: string }) {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [s, setS] = useState<PharmacySummary | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    getSummary(businessId, from, to).then(r => { setS(r); setErr('') }).catch(e => setErr((e as Error).message))
  }, [businessId, from, to])

  const collected = s ? Object.values(s.collected).reduce((a, b) => a + Number(b ?? 0), 0) : 0
  const tile = (label: string, value: string, note?: string) => (
    <div className="card shadow-sm py-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-navy-700">{value}</p>
      {note && <p className="text-xs text-gray-400 mt-1">{note}</p>}
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input type="date" className="input-field w-auto" value={from} onChange={e => setFrom(e.target.value)} />
        <span className="text-gray-400">to</span>
        <input type="date" className="input-field w-auto" value={to} onChange={e => setTo(e.target.value)} />
        <button onClick={() => { setFrom(today()); setTo(today()) }} className="text-xs text-teal-700">Today</button>
        <button onClick={() => { setFrom(today().slice(0, 8) + '01'); setTo(today()) }} className="text-xs text-teal-700">This month</button>
      </div>
      <Err msg={err} />
      {s && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {tile('Sold', moneyExact(Number(s.sales) - Number(s.returns)), `${s.bills} bills${s.cancelled ? `, ${s.cancelled} cancelled` : ''}; returns ${moneyExact(s.returns)}`)}
            {tile('Money in', moneyExact(collected - Number(s.refunded)), `${Object.entries(s.collected).map(([m, v]) => `${m} ${moneyExact(Number(v))}`).join(' · ') || 'nothing'}${Number(s.refunded) ? `; refunded ${moneyExact(s.refunded)}` : ''}`)}
            {tile('Due from customers', moneyExact(s.outstanding), 'All bills, not just these dates')}
            {tile('Purchases', moneyExact(s.purchases), `Discounts given ${moneyExact(s.discounts)}`)}
          </div>
          {s.gst.length > 0 && (
            <div className="card shadow-sm p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 text-xs"><th className="px-4 py-2">GST rate</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right px-4">Total tax</th></tr></thead>
                <tbody>{s.gst.map(g => (
                  <tr key={g.rate} className="border-t">
                    <td className="px-4 py-2">{g.rate}%</td>
                    <td className="text-right">{moneyExact(g.taxable)}</td>
                    <td className="text-right">{moneyExact(Number(g.tax) / 2)}</td>
                    <td className="text-right">{moneyExact(Number(g.tax) / 2)}</td>
                    <td className="text-right px-4">{moneyExact(g.tax)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="text-xs text-gray-400 px-4 py-2">After returns. For your GST return, check against the bills.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Settings ────────────────────────────────────────────────────────────────

function SettingsSection({ businessId, settings, onSaved }: { businessId: string; settings: PharmacySettings; onSaved: () => void }) {
  const [useGst, setUseGst] = useState(!!settings.pharmacy_gstin)
  const [gstin, setGstin] = useState(settings.pharmacy_gstin ?? settings.gstin ?? '')
  const [dl, setDl] = useState(settings.pharmacy_drug_licence ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const save = async () => {
    setBusy(true); setErr(''); setMsg('')
    try { await savePharmacySettings(businessId, useGst ? gstin : '', dl); setMsg('Saved. New bills use this.'); onSaved() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="card shadow-sm space-y-3 max-w-xl">
      <h3 className="font-bold text-navy-700">Pharmacy settings</h3>
      <label className="text-sm flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={useGst} onChange={e => setUseGst(e.target.checked)} />
        <span>The pharmacy is GST-registered — print GST on its bills<br />
          <span className="text-xs text-gray-500">Leave unticked if you don't have a GST registration: bills are at MRP with no tax lines.</span></span>
      </label>
      {useGst && (
        <label className="text-xs text-gray-500 block">Pharmacy GSTIN
          <input className="input-field mt-1 uppercase" value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} maxLength={15} placeholder="15 characters" />
        </label>
      )}
      <label className="text-xs text-gray-500 block">Drug licence number (printed on bills)
        <input className="input-field mt-1" value={dl} onChange={e => setDl(e.target.value)} placeholder="e.g. 20B/21B …" />
      </label>
      <p className="text-xs text-gray-500">Bills already issued keep what was on them.</p>
      <Err msg={err} />
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <button disabled={busy} onClick={save} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
    </div>
  )
}
