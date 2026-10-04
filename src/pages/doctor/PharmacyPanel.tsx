import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Package, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { moneyExact, shortDate, isoDate } from '../../lib/format'
import { searchPatients, PatientSearchResult } from '../../lib/patientsApi'
import {
  getStock, saveItem, getBatches, adjustStock, recordPurchase, getPurchases, getSuppliers,
  issueBill, getBills, recordPayment, returnItems, cancelBill, getPrescriptionsForDispensing,
  getSummary, getPharmacySettings, savePharmacySettings, itemLabel, matchItem, ITEM_FORMS,
  getDues, getBillsByIds, getStockMoves, Due, StockMove, PAYMENT_STATUS, payMethodLabel,
  StockRow, Batch, PharmacyBill, Purchase, RxForDispensing, PharmacySummary, PharmacySettings,
  PharmacyItem, PharmacyPayMethod, PurchaseLine, PAY_METHODS, GST_RATES,
} from '../../lib/pharmacyApi'
import { phoneProblem } from '../../lib/credentials'
import PhoneError from '../../components/PhoneError'

// In-house dispensing (0158): the clinic's own medicine counter.
//
// Everyone on the staff can sell, take payment and take a return. Medicines,
// purchases, stock counts, cancelling a bill and the summary are for the owner,
// a manager or a doctor — the database refuses anyone else, so the hidden
// sections are a courtesy, not the lock.

type Section = 'sell' | 'bills' | 'dues' | 'stock' | 'purchases' | 'summary' | 'settings'

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
    ['sell', 'New bill'], ['bills', 'Bills'], ['dues', 'Dues'], ['stock', 'Stock'],
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
      {section === 'dues' && <DuesSection businessId={businessId} canManage={canManage} onStockChanged={reloadStock} />}
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
              <span>{itemLabel(s)}</span>
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
    if (mode === 'walkin' && phoneProblem(walkPhone, false, true)) { setErr(phoneProblem(walkPhone, false, true)!); return }
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
          <div>
            <input className="input-field w-full" value={walkPhone} onChange={e => setWalkPhone(e.target.value.replace(/[^\d+ ]/g, ''))} placeholder="Mobile (optional)" inputMode="tel" />
            <PhoneError value={walkPhone} foreign />
          </div>
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
        <div className="flex gap-2 flex-wrap text-xs">
          <button type="button" onClick={() => setPay(String(estimate))} className={`px-3 py-1 rounded-full border ${Number(pay) >= estimate && estimate > 0 ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200'}`}>Paid in full</button>
          <button type="button" onClick={() => setPay('')} className={`px-3 py-1 rounded-full border ${!Number(pay) ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200'}`}>Nothing now (credit)</button>
          {Number(pay) > 0 && Number(pay) < estimate && <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-800">Part payment · {moneyExact(estimate - Number(pay))} will be due</span>}
        </div>
        <p className="text-xs text-gray-500">For a part payment, type what was received — the rest stays on the patient's dues.</p>
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
                  <BillMoney b={b} />
                </button>
                {open === b.id && <BillActions bill={b} canManage={canManage} onChanged={afterChange} />}
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

/** Total, the payment state, and for a part-paid bill how much is in and how much is due. */
function BillMoney({ b }: { b: PharmacyBill }) {
  const st = PAYMENT_STATUS[b.payment_status] ?? PAYMENT_STATUS.unpaid
  return (
    <span className="flex gap-2 items-center text-xs">
      <span className={`text-sm ${b.status === 'cancelled' ? 'text-gray-400 line-through' : 'font-semibold'}`}>{moneyExact(b.net_payable)}</span>
      <span className={`px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
      {b.payment_status === 'partly_paid' && <span className="text-gray-600">paid {moneyExact(b.paid - b.refunded)} · due {moneyExact(b.balance_due)}</span>}
      {b.payment_status === 'unpaid' && <span className="text-red-600">due {moneyExact(b.balance_due)}</span>}
    </span>
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
      <div className="text-xs text-gray-600 space-y-0.5">
        <p>Billed by {bill.issued_by_name ?? '—'}{bill.customer_phone ? ` · ${bill.customer_phone}` : ''}</p>
        {bill.discount_amount > 0 && <p>Discount {Number(bill.discount_pct)}% = {moneyExact(bill.discount_amount)} · “{bill.discount_reason}” · given by {bill.issued_by_name ?? '—'}</p>}
        {bill.payments.length === 0 ? <p>No payment yet.</p> : bill.payments.map((p, k) => (
          <p key={k}>Received {moneyExact(p.amount)} by {payMethodLabel(p.method)}{p.reference ? ` (${p.reference})` : ''} · {new Date(p.received_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}{p.received_by_name ? ` · ${p.received_by_name}` : ''}</p>
        ))}
        {bill.credited > 0 && <p>Returned {moneyExact(bill.credited)}{bill.refunded ? ` · refunded ${moneyExact(bill.refunded)}` : ''}</p>}
        {bill.cancelled_reason && <p>Cancelled: {bill.cancelled_reason}</p>}
      </div>
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

// ── Dues: who owes the counter ──────────────────────────────────────────────

function DuesSection({ businessId, canManage, onStockChanged }: { businessId: string; canManage: boolean; onStockChanged: () => void }) {
  const [dues, setDues] = useState<Due[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [bills, setBills] = useState<PharmacyBill[]>([])
  const [openBill, setOpenBill] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const keyOf = (d: Due) => d.patient_member_id ?? `${d.customer_name}|${d.customer_phone ?? ''}`

  const load = useCallback(() => {
    getDues(businessId).then(d => { setDues(d); setErr('') }).catch(e => setErr((e as Error).message))
  }, [businessId])
  useEffect(load, [load])
  useEffect(() => {
    const d = dues?.find(x => keyOf(x) === open)
    if (d) getBillsByIds(d.bill_ids).then(setBills).catch(() => setBills([])); else setBills([])
  }, [open, dues])

  if (err) return <Err msg={err} />
  if (!dues) return <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
  const total = dues.reduce((s, d) => s + d.total_due, 0)
  const days = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  const rows = dues.filter(d => !q.trim() || `${d.customer_name} ${d.customer_phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="space-y-3">
      <div className="card shadow-sm py-4 flex flex-wrap justify-between gap-2 items-center">
        <div>
          <p className="text-xs text-gray-500">Due from {dues.length} patient{dues.length === 1 ? '' : 's'}</p>
          <p className="text-2xl font-bold text-navy-700">{moneyExact(total)}</p>
        </div>
        <p className="text-xs text-gray-500 max-w-xs">Unpaid and part-paid pharmacy bills, biggest first. Open a patient to take a payment against their bills.</p>
      </div>
      {dues.length > 0 && <input className="input-field" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or phone" />}
      {rows.length === 0 ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">Nobody owes the pharmacy anything.</div> : (
        <div className="card shadow-sm p-0 divide-y">
          {rows.map(d => (
            <div key={keyOf(d)}>
              <button onClick={() => setOpen(open === keyOf(d) ? null : keyOf(d))} className="w-full text-left px-4 py-3 text-sm flex flex-wrap justify-between gap-2 hover:bg-gray-50">
                <span>
                  <b>{d.customer_name}</b>{d.customer_phone ? ` · ${d.customer_phone}` : ''}{!d.patient_member_id && <span className="text-gray-400"> · walk-in</span>}
                  <span className="block text-xs text-gray-500">
                    {d.bills} bill{d.bills === 1 ? '' : 's'} · oldest {days(d.oldest_bill_at)} days ago · {d.last_paid_at ? `last paid ${shortDate(d.last_paid_at)}` : 'nothing paid yet'}
                  </span>
                </span>
                <span className={`font-bold ${days(d.oldest_bill_at) > 30 ? 'text-red-600' : 'text-navy-700'}`}>{moneyExact(d.total_due)}</span>
              </button>
              {open === keyOf(d) && (
                <div className="bg-gray-50 divide-y">
                  {bills.map(b => (
                    <div key={b.id}>
                      <button onClick={() => setOpenBill(openBill === b.id ? null : b.id)} className="w-full text-left px-6 py-2 text-sm flex flex-wrap justify-between gap-2">
                        <span>{b.bill_no} · {shortDate(b.issued_at)} · by {b.issued_by_name ?? '—'}</span>
                        <BillMoney b={b} />
                      </button>
                      {openBill === b.id && <BillActions bill={b} canManage={canManage} onChanged={() => { load(); onStockChanged() }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stock and medicines ─────────────────────────────────────────────────────

const blankItem: Partial<PharmacyItem> = { name: '', generic_name: '', strength: '', form: 'tablet', unit: 'tablet', pack_size: 1, hsn_code: '3004', gst_rate: 12, reorder_level: 0 }

// 0184: stock in plain units — "10 bottles, MRP ₹250 each". Used when a
// medicine is added (opening stock) and from Add stock on any item.
interface StockIn { units: string; mrp: string; cost: string; batch: string; expiry: string }
const blankStockIn: StockIn = { units: '', mrp: '', cost: '', batch: '', expiry: '' }
const addStock = (businessId: string, itemId: string, st: StockIn, supplier = 'Opening stock') =>
  recordPurchase(businessId, supplier, '', today(), [{
    item_id: itemId, batch_no: st.batch, expiry_date: st.expiry,
    units: Number(st.units) || 0, free_units: 0, unit_cost: Number(st.cost) || 0, unit_mrp: Number(st.mrp) || 0,
  }])

function StockInFields({ unit, st, set }: { unit: string; st: StockIn; set: (s: StockIn) => void }) {
  const u = unit || 'unit'
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <label className="text-xs text-gray-500">Quantity ({u}s)
        <input className="input-field mt-1" type="number" min={0} value={st.units} onChange={e => set({ ...st, units: e.target.value })} placeholder="e.g. 10" /></label>
      <label className="text-xs text-gray-500">MRP per {u} (₹)
        <input className="input-field mt-1" type="number" min={0} step="0.01" value={st.mrp} onChange={e => set({ ...st, mrp: e.target.value })} /></label>
      <label className="text-xs text-gray-500">Cost per {u} (₹, optional)
        <input className="input-field mt-1" type="number" min={0} step="0.01" value={st.cost} onChange={e => set({ ...st, cost: e.target.value })} /></label>
      <label className="text-xs text-gray-500">Batch no.
        <input className="input-field mt-1" value={st.batch} onChange={e => set({ ...st, batch: e.target.value })} placeholder="on the strip / box" /></label>
      <label className="text-xs text-gray-500">Expiry
        <input className="input-field mt-1" type="date" min={plusDays(today(), 1)} value={st.expiry} onChange={e => set({ ...st, expiry: e.target.value })} /></label>
    </div>
  )
}

function AddStockForm({ businessId, item, onDone, onCancel }: { businessId: string; item: StockRow; onDone: () => void; onCancel: () => void }) {
  const [st, setSt] = useState<StockIn>(blankStockIn)
  const [supplier, setSupplier] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <div className="border border-teal-200 bg-teal-50/40 rounded-lg p-3 space-y-2">
      <div className="text-sm font-semibold text-navy-700">Add stock — {itemLabel(item)}</div>
      <StockInFields unit={item.unit} st={st} set={setSt} />
      <label className="text-xs text-gray-500 block">Supplier (optional)
        <input className="input-field mt-1" value={supplier} onChange={e => setSupplier(e.target.value)} /></label>
      <Err msg={err} />
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-outline text-xs">Cancel</button>
        <button disabled={busy} className="btn-teal text-xs disabled:opacity-50" onClick={async () => {
          setBusy(true); setErr('')
          try { await addStock(businessId, item.id, st, supplier.trim() || 'Stock added'); onDone() }
          catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
        }}>{busy ? 'Saving…' : 'Add to stock'}</button>
      </div>
    </div>
  )
}

function ItemForm({ businessId, item, onSaved, onCancel }: {
  businessId: string; item: Partial<PharmacyItem>; onSaved: () => void; onCancel: () => void
}) {
  const [f, setF] = useState<Partial<PharmacyItem>>(item)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof PharmacyItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF(x => ({ ...x, [k]: e.target.value }))
  const [opening, setOpening] = useState<StockIn>(blankStockIn)
  const save = async () => {
    const generic = (f.generic_name ?? '').trim()
    const brand = (f.name ?? '').trim()
    if (!generic && !brand) { setErr('Enter the medicine name.'); return }
    const withStock = !f.id && Number(opening.units) > 0
    if (withStock && (!(Number(opening.mrp) > 0) || !opening.batch.trim() || !opening.expiry)) {
      setErr('For the stock you have, give the MRP, batch number and expiry — or leave the quantity empty and add stock later.'); return
    }
    setBusy(true); setErr('')
    try {
      // The stored name is the brand, or the medicine itself when sold without one.
      const id = await saveItem(businessId, { ...f, name: brand || generic, generic_name: generic || null })
      if (withStock) await addStock(businessId, id, opening)
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
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
        {field('generic_name', 'Medicine / item name *', { placeholder: 'Paracetamol, Moxifloxacin, Syringe 5ml' })}
        {field('name', 'Brand (company name)', { placeholder: 'Dolo, Vigamox — leave blank if none' })}
        <label className="text-xs text-gray-500">Type
          <select className="input-field mt-1" value={f.form ?? ''} onChange={e => {
            const t = ITEM_FORMS.find(x => x.value === e.target.value)
            setF(x => ({ ...x, form: e.target.value, unit: t?.unit ?? x.unit }))
          }}>
            {!ITEM_FORMS.some(t => t.value === f.form) && f.form && <option value={f.form}>{f.form}</option>}
            {ITEM_FORMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        {field('strength', 'Strength', { placeholder: '650mg, 0.5%, 5ml' })}
        {field('unit', 'Sold per', { placeholder: 'tablet, bottle, tube' })}
        {field('hsn_code', 'HSN code', { placeholder: '3004' })}
        <label className="text-xs text-gray-500">GST rate
          <select className="input-field mt-1" value={String(f.gst_rate ?? 12)} onChange={set('gst_rate')}>
            {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
          </select>
        </label>
        {field('reorder_level', 'Warn when stock is at or below', { type: 'number', min: 0 })}
      </div>
      <p className="text-xs text-gray-500">GST rate and HSN are used only if your clinic has a GSTIN for the pharmacy (Settings).</p>
      {!f.id && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="text-sm font-semibold text-navy-700">Stock you have now <span className="font-normal text-gray-500">— counted in {f.unit || 'unit'}s, not boxes</span></div>
          <StockInFields unit={String(f.unit ?? '')} st={opening} set={setOpening} />
        </div>
      )}
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
  const [adding, setAdding] = useState<StockRow | null>(null)
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
                  <b>{itemLabel(s)}</b>
                  {!s.is_active && ' · not stocked'}
                </span>
                <span className="flex gap-3 text-xs items-center">
                  <span className={s.qty_available <= s.reorder_level ? 'text-red-600 font-semibold' : ''}>{s.qty_available} {s.unit}{s.qty_available === 0 && canManage ? ' · tap to add stock' : ''}</span>
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
                  <StockHistory itemId={s.id} unit={s.unit} qtyNow={s.qty_available + s.qty_expired} />
                  {canManage && <button onClick={() => setAdding(s)} className="btn-teal text-xs py-1.5 px-3 mr-2">Add stock</button>}
                  {canManage && <button onClick={() => setEditing(s)} className="btn-outline text-xs py-1.5 px-3">Edit medicine</button>}
                  {adding?.id === s.id && <div className="mt-2"><AddStockForm businessId={businessId} item={s} onCancel={() => setAdding(null)} onDone={() => { setAdding(null); reload() }} /></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const MOVE_LABEL: Record<StockMove['kind'], string> = {
  purchase: 'Purchased', sale: 'Sold', return: 'Returned', cancel: 'Bill cancelled', adjust: 'Count corrected',
}

// Every movement of the medicine, so a shelf count can be matched to the
// system: in, out, back, corrected — each with its bill, supplier or reason.
function StockHistory({ itemId, unit, qtyNow }: { itemId: string; unit: string; qtyNow: number }) {
  const [open, setOpen] = useState(false)
  const [moves, setMoves] = useState<StockMove[] | null>(null)
  useEffect(() => { if (open) getStockMoves(itemId).then(setMoves).catch(() => setMoves([])) }, [open, itemId])
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-teal-700 mr-3">Stock history</button>
  const totals = (moves ?? []).reduce<Record<string, number>>((t, m) => ({ ...t, [m.kind]: (t[m.kind] ?? 0) + m.qty }), {})
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-2 text-xs space-y-1">
      <div className="flex justify-between">
        <b>Stock history</b>
        <button onClick={() => setOpen(false)} className="text-gray-400">Hide</button>
      </div>
      {moves === null ? <p className="text-gray-400">Loading…</p> : (
        <>
          <p className="text-gray-600">
            {Object.entries(totals).map(([k, v]) => `${MOVE_LABEL[k as StockMove['kind']]} ${v > 0 ? '+' : ''}${v}`).join(' · ')}
            {' '}= <b>{qtyNow} {unit}</b> on the shelf (including expired)
          </p>
          <table className="w-full">
            <tbody>{moves.map(m => (
              <tr key={m.id} className="border-t">
                <td className="py-1 text-gray-500">{new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{MOVE_LABEL[m.kind]}</td>
                <td className={m.qty < 0 ? 'text-red-600' : 'text-green-700'}>{m.qty > 0 ? '+' : ''}{m.qty}</td>
                <td className="text-gray-500">{m.batch?.batch_no}</td>
                <td className="text-gray-600">
                  {m.bill ? `${m.bill.bill_no} · ${m.bill.customer_name}` : m.purchase ? [m.purchase.supplier_name, m.purchase.invoice_no && `inv. ${m.purchase.invoice_no}`].filter(Boolean).join(' · ') : ''}
                  {m.reason ? ` · ${m.reason}` : ''}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {moves.length === 100 && <p className="text-gray-400">Showing the latest 100.</p>}
        </>
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

// 0184: purchases in plain units — "10 bottles at ₹250 each" — not packs.
interface PLine {
  key: string; item_id: string; label: string; unit: string
  batch_no: string; expiry_date: string; units: string; free_units: string; unit_cost: string; unit_mrp: string
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
    key: `${s.id}-${Date.now()}`, item_id: s.id, label: itemLabel(s), unit: s.unit || 'unit',
    batch_no: '', expiry_date: '', units: '', free_units: '', unit_cost: '', unit_mrp: '',
  }])
  const upd = (key: string, k: keyof PLine, v: string) => setLines(ls => ls.map(l => l.key === key ? { ...l, [k]: v } : l))
  const total = lines.reduce((s, l) => s + (Number(l.units) || 0) * (Number(l.unit_cost) || 0), 0)

  const save = async () => {
    setBusy(true); setErr('')
    try {
      await recordPurchase(businessId, supplier, invoice, date, lines.map(l => ({
        item_id: l.item_id, batch_no: l.batch_no, expiry_date: l.expiry_date,
        units: Number(l.units) || 0, free_units: Number(l.free_units) || 0,
        unit_cost: Number(l.unit_cost) || 0, unit_mrp: Number(l.unit_mrp) || 0,
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
            <input className="input-field" type="number" min={0} placeholder={`Quantity (${l.unit}s)`} value={l.units} onChange={e => upd(l.key, 'units', e.target.value)} />
            <input className="input-field" type="number" min={0} placeholder="Free" value={l.free_units} onChange={e => upd(l.key, 'free_units', e.target.value)} />
            <input className="input-field" type="number" min={0} step="0.01" placeholder={`Cost per ${l.unit}`} value={l.unit_cost} onChange={e => upd(l.key, 'unit_cost', e.target.value)} />
            <input className="input-field" type="number" min={0} step="0.01" placeholder={`MRP per ${l.unit}`} value={l.unit_mrp} onChange={e => upd(l.key, 'unit_mrp', e.target.value)} />
          </div>
          {Number(l.units) > 0 && <p className="text-xs text-gray-500">{(Number(l.units) || 0) + (Number(l.free_units) || 0)} {l.unit}{(Number(l.units) || 0) + (Number(l.free_units) || 0) === 1 ? '' : 's'} into stock{Number(l.unit_mrp) > 0 ? `, sold at ${moneyExact(Number(l.unit_mrp))} each` : ''}</p>}
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
  const [discounted, setDiscounted] = useState<PharmacyBill[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    getSummary(businessId, from, to).then(r => { setS(r); setErr('') }).catch(e => setErr((e as Error).message))
    getBills(businessId, { from: from + 'T00:00:00+05:30', to: plusDays(to, 1) + 'T00:00:00+05:30' })
      .then(b => setDiscounted(b.filter(x => x.discount_amount > 0 && x.status === 'issued'))).catch(() => setDiscounted([]))
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
            {tile('Money in', moneyExact(collected - Number(s.refunded)), `${Object.entries(s.collected).map(([m, v]) => `${payMethodLabel(m)} ${moneyExact(Number(v))}`).join(' · ') || 'nothing'}${Number(s.refunded) ? `; refunded ${moneyExact(s.refunded)}` : ''}`)}
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
          {discounted.length > 0 && (
            <div className="card shadow-sm p-0 overflow-x-auto">
              <p className="px-4 pt-3 font-bold text-navy-700 text-sm">Discounts given</p>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 text-xs"><th className="px-4 py-2">Bill</th><th>Patient</th><th>Given by</th><th>Why</th><th className="text-right px-4">Discount</th></tr></thead>
                <tbody>{discounted.map(b => (
                  <tr key={b.id} className="border-t">
                    <td className="px-4 py-2">{b.bill_no}</td>
                    <td>{b.customer_name}</td>
                    <td>{b.issued_by_name ?? '—'}</td>
                    <td>{b.discount_reason}</td>
                    <td className="text-right px-4">{Number(b.discount_pct)}% · {moneyExact(b.discount_amount)}</td>
                  </tr>
                ))}</tbody>
              </table>
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
