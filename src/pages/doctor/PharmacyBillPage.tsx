import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getBill, PharmacyBill, PAYMENT_STATUS, payMethodLabel } from '../../lib/pharmacyApi'

// The pharmacy bill (0158), printed at the counter. A "Tax invoice" with HSN,
// rates and CGST/SGST when the dispensary has a GSTIN; a plain "Bill" at MRP
// when it does not. Everything printed is the snapshot taken at issue.
//
// Signed-in clinic staff only: pharmacy_bill_detail is read with the staff
// member's own session under RLS.

const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function PharmacyBillPage() {
  const { id } = useParams()
  const [bill, setBill] = useState<PharmacyBill | null>(null)
  const [letterhead, setLetterhead] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id) return
    getBill(id).then(b => {
      if (!b) { setErr('This bill is not available. Sign in as clinic staff and try again.'); return }
      setBill(b)
      supabase.from('businesses').select('letterhead_url').eq('id', b.business_id).maybeSingle()
        .then(({ data }) => setLetterhead((data as { letterhead_url?: string | null } | null)?.letterhead_url ?? null))
    }).catch(e => setErr((e as Error).message))
  }, [id])

  if (err) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>{err}</div>
  if (!bill) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>Loading…</div>

  const gst = bill.gst_applied
  const cell: React.CSSProperties = { padding: '4px 6px', borderBottom: '1px solid #ddd', fontSize: 12 }
  const head: React.CSSProperties = { ...cell, fontWeight: 700, borderBottom: '1.5px solid #111', textAlign: 'left' }
  const num: React.CSSProperties = { ...cell, textAlign: 'right' }
  const row = (label: string, value: string, strong = false) => (
    <tr><td style={{ padding: '2px 6px', fontSize: strong ? 15 : 12.5, fontWeight: strong ? 800 : 400 }}>{label}</td>
      <td style={{ padding: '2px 6px', fontSize: strong ? 15 : 12.5, fontWeight: strong ? 800 : 400, textAlign: 'right' }}>{value}</td></tr>
  )

  return (
    <div style={{ background: '#fff', minHeight: '100vh', fontFamily: 'system-ui, Arial, sans-serif', color: '#111' }}>
      <style>{`@media print { .no-print { display: none !important } @page { size: A5; margin: 8mm } }`}</style>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px 16px 32px' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={() => window.print()} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0f6b4a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Print bill
          </button>
        </div>

        <header style={{ borderBottom: '2px solid #111', paddingBottom: 8 }}>
          {letterhead
            ? <img src={letterhead} alt={bill.clinic_name ?? ''} style={{ width: '100%', maxHeight: 130, objectFit: 'contain', display: 'block' }} />
            : <>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{bill.clinic_name}</div>
                {bill.clinic_address && <div style={{ fontSize: 12, color: '#444' }}>{bill.clinic_address}</div>}
                {bill.clinic_phone && <div style={{ fontSize: 12, color: '#444' }}>{bill.clinic_phone}</div>}
              </>}
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {[gst && bill.gstin ? `GSTIN ${bill.gstin}` : null, bill.drug_licence ? `D.L. ${bill.drug_licence}` : null].filter(Boolean).join(' · ')}
          </div>
        </header>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '10px 0 6px' }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: .5 }}>
            {gst ? 'TAX INVOICE' : 'PHARMACY BILL'}{bill.status === 'cancelled' ? ' — CANCELLED' : ''}
          </div>
          <div style={{ fontSize: 12, textAlign: 'right' }}>
            <b>{bill.bill_no}</b><br />
            {new Date(bill.issued_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 8 }}>
          <b>Patient:</b> {bill.customer_name}{bill.customer_phone ? ` · ${bill.customer_phone}` : ''}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={head}>#</th>
              <th style={head}>Medicine</th>
              {gst && <th style={head}>HSN</th>}
              <th style={head}>Batch</th>
              <th style={head}>Exp.</th>
              <th style={{ ...head, textAlign: 'right' }}>Qty</th>
              <th style={{ ...head, textAlign: 'right' }}>MRP</th>
              {gst && <th style={{ ...head, textAlign: 'right' }}>GST</th>}
              <th style={{ ...head, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((i, n) => (
              <tr key={i.id}>
                <td style={cell}>{n + 1}</td>
                <td style={cell}>{i.name}{i.returned_qty ? ` (${i.returned_qty} returned)` : ''}</td>
                {gst && <td style={cell}>{i.hsn_code ?? ''}</td>}
                <td style={cell}>{i.batch_no}</td>
                <td style={cell}>{i.expiry_date ? new Date(i.expiry_date).toLocaleDateString('en-IN', { month: '2-digit', year: '2-digit' }) : ''}</td>
                <td style={num}>{i.quantity}</td>
                <td style={num}>{Number(i.unit_mrp).toFixed(2)}</td>
                {gst && <td style={num}>{Number(i.gst_rate)}%</td>}
                <td style={num}>{Number(i.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 10 }}>
          <div style={{ fontSize: 11.5, color: '#444', flex: 1 }}>
            {gst && <div>Prices include GST. Taxable {rupees(bill.taxable_value)} · CGST {rupees(bill.cgst_amount)} · SGST {rupees(bill.sgst_amount)}</div>}
            {bill.discount_amount > 0 && <div>Discount {Number(bill.discount_pct)}% ({bill.discount_reason})</div>}
            {bill.payments.length > 0 && <div style={{ marginTop: 4 }}>Paid: {bill.payments.map(p => `${rupees(p.amount)} by ${payMethodLabel(p.method)}`).join(', ')}</div>}
            {bill.returns.filter(r => r.kind === 'return').map((r, k) => (
              <div key={k}>Returned {new Date(r.created_at).toLocaleDateString('en-IN')}: {rupees(r.credit_amount)}{r.refund_amount ? `, refunded ${rupees(r.refund_amount)}` : ''}</div>
            ))}
            {bill.cancelled_reason && <div>Cancelled: {bill.cancelled_reason}</div>}
          </div>
          <table style={{ borderCollapse: 'collapse', minWidth: 220 }}>
            <tbody>
              {row('Total at MRP', rupees(bill.subtotal))}
              {bill.discount_amount > 0 && row('Discount', `− ${rupees(bill.discount_amount)}`)}
              {bill.round_off !== 0 && row('Round off', `${bill.round_off > 0 ? '+' : '−'} ${rupees(Math.abs(bill.round_off))}`)}
              {row('Net payable', rupees(bill.net_payable), true)}
              {bill.credited > 0 && bill.status === 'issued' && row('Less returns', `− ${rupees(bill.credited)}`)}
              {bill.status === 'issued' && row('Paid', rupees(bill.paid - bill.refunded))}
              {bill.status === 'issued' && bill.balance_due > 0 && row('Balance due', rupees(bill.balance_due), true)}
              {bill.status === 'issued' && row('Status', PAYMENT_STATUS[bill.payment_status]?.label ?? '')}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 36, fontSize: 11.5 }}>
          <span>Check medicines and expiry before leaving the counter.{bill.issued_by_name ? <><br />Billed by {bill.issued_by_name}</> : null}</span>
          <span>Signature: ____________________</span>
        </div>
      </div>
    </div>
  )
}
