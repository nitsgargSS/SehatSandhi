import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { PharmacyBill } from '../../lib/pharmacyApi'
import type { Admission } from '../../lib/admissionsApi'

// 0284: every medicine the pharmacy gave one admitted patient, date by date —
// the clubbed alternative to an invoice per issue. Each issue keeps its own
// bill number; returns come off at what was charged, discount included. The
// total is what goes on the hospital bill.
//
// Signed-in clinic staff only: read with the staff member's own session under RLS.

const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })

export default function IpdMedicineStatement() {
  const { id } = useParams()
  const [stay, setStay] = useState<Admission | null>(null)
  const [bills, setBills] = useState<PharmacyBill[] | null>(null)
  const [letterhead, setLetterhead] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('admission_detail').select('*').eq('id', id).maybeSingle(),
      supabase.from('pharmacy_bill_detail').select('*').eq('admission_id', id).eq('status', 'issued').order('issued_at'),
    ]).then(([a, b]) => {
      if (a.error || !a.data) { setErr('This stay is not available. Sign in as clinic staff and try again.'); return }
      setStay(a.data as Admission)
      setBills((b.data ?? []) as PharmacyBill[])
      supabase.from('businesses').select('letterhead_url').eq('id', (a.data as Admission).business_id).maybeSingle()
        .then(({ data }) => setLetterhead((data as { letterhead_url?: string | null } | null)?.letterhead_url ?? null))
    })
  }, [id])

  if (err) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>{err}</div>
  if (!stay || !bills) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>Loading…</div>

  // One row per medicine line, grouped by the day it was issued.
  const rows = bills.flatMap(b => b.items.map(i => ({
    day: day(b.issued_at), bill: b.bill_no, name: i.name, qty: Number(i.quantity), back: Number(i.returned_qty),
    each: Number(i.amount) / Number(i.quantity), amount: Number(i.amount) * (Number(i.quantity) - Number(i.returned_qty)) / Number(i.quantity),
  })))
  const days = Array.from(new Set(rows.map(r => r.day)))
  const mrp = bills.reduce((s, b) => s + Number(b.subtotal), 0)
  const discount = bills.reduce((s, b) => s + Number(b.discount_amount), 0)
  const returned = bills.reduce((s, b) => s + Number(b.credited), 0)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const first = bills[0]

  const cell: React.CSSProperties = { padding: '4px 6px', borderBottom: '1px solid #ddd', fontSize: 12 }
  const head: React.CSSProperties = { ...cell, fontWeight: 700, borderBottom: '1.5px solid #111', textAlign: 'left' }
  const num: React.CSSProperties = { ...cell, textAlign: 'right' }
  const line = (label: string, value: string, strong = false) => (
    <tr><td style={{ padding: '2px 6px', fontSize: strong ? 15 : 12.5, fontWeight: strong ? 800 : 400 }}>{label}</td>
      <td style={{ padding: '2px 6px', fontSize: strong ? 15 : 12.5, fontWeight: strong ? 800 : 400, textAlign: 'right' }}>{value}</td></tr>
  )

  return (
    <div style={{ background: '#fff', minHeight: '100vh', fontFamily: 'system-ui, Arial, sans-serif', color: '#111' }}>
      <style>{`@media print { .no-print { display: none !important } @page { size: A4; margin: 10mm } }`}</style>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px 16px 32px' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={() => window.print()} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0f6b4a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Print statement
          </button>
        </div>

        <header style={{ borderBottom: '2px solid #111', paddingBottom: 8 }}>
          {letterhead
            ? <img src={letterhead} alt={first?.clinic_name ?? ''} style={{ width: '100%', maxHeight: 130, objectFit: 'contain', display: 'block' }} />
            : <div style={{ fontSize: 20, fontWeight: 800 }}>{first?.clinic_name ?? ''}</div>}
        </header>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '10px 0 6px', gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: .5 }}>MEDICINE STATEMENT — IPD</div>
          <div style={{ fontSize: 12, textAlign: 'right' }}>
            <b>{stay.admission_no}</b><br />
            {day(stay.admitted_at)} – {stay.discharged_at ? day(stay.discharged_at) : 'admitted'}
          </div>
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 10 }}>
          Patient: <b>{stay.patient_name}</b>
          {stay.ward_name && <> · {stay.ward_name} {stay.bed_label ?? ''}</>}
          {stay.attending_name && <> · {stay.attending_name}</>}
        </div>

        {!rows.length ? <p style={{ fontSize: 13 }}>No medicines issued from the pharmacy in this stay.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={head}>Medicine</th><th style={head}>Bill</th><th style={{ ...head, textAlign: 'right' }}>Qty</th>
                <th style={{ ...head, textAlign: 'right' }}>Returned</th><th style={{ ...head, textAlign: 'right' }}>Rate</th><th style={{ ...head, textAlign: 'right' }}>Amount</th></tr>
            </thead>
            <tbody>
              {days.map(d => {
                const these = rows.filter(r => r.day === d)
                return [
                  <tr key={d}><td colSpan={6} style={{ ...cell, fontWeight: 800, background: '#f4f4f4' }}>{d}</td></tr>,
                  ...these.map((r, k) => (
                    <tr key={`${d}-${k}`}>
                      <td style={cell}>{r.name}</td><td style={cell}>{r.bill}</td>
                      <td style={num}>{r.qty}</td><td style={num}>{r.back || ''}</td>
                      <td style={num}>{rupees(r.each)}</td><td style={num}>{rupees(r.amount)}</td>
                    </tr>
                  )),
                  <tr key={`${d}-t`}><td colSpan={5} style={{ ...num, fontWeight: 700 }}>Day total</td>
                    <td style={{ ...num, fontWeight: 700 }}>{rupees(these.reduce((s, r) => s + r.amount, 0))}</td></tr>,
                ]
              })}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 260 }}>
            <tbody>
              {line('Total at MRP', rupees(mrp))}
              {discount > 0 && line('Discount', `− ${rupees(discount)}`)}
              {returned > 0 && line('Returned', `− ${rupees(returned)}`)}
              {line('Medicines on the hospital bill', rupees(total), true)}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11.5, color: '#444', marginTop: 24 }}>
          Rates are what was charged for each medicine, after any discount. Paid with the hospital bill, from the deposit.
        </p>
      </div>
    </div>
  )
}
