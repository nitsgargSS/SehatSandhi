import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPublicBill, PublicBill } from '../lib/billingApi'
import { moneyExact } from '../lib/format'

// The patient's bill, opened from a WhatsApp or email link. No login: the token
// in the URL is the authorisation, as with /rx/, /ds/ and /invoice/.
//
// This is the document that gets submitted for reimbursement, so it is built to
// print cleanly and to survive being photocopied at a TPA desk: one column,
// every line itemised, the arithmetic shown rather than just the answer, and
// the clinic's details and GSTIN at the top where an insurer looks for them.
//
// The totals are frozen; what has been PAID is live. A patient who settles the
// balance next week reopens this link and sees it, which saves a phone call.

const IST = 'Asia/Kolkata'
const fmtDate = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })
  : ''

const CATEGORY: Record<string, string> = {
  consultation: 'Consultation',
  bed: 'Bed / room',
  procedure: 'Procedure',
  medicine: 'Medicine',
  lab: 'Test',
  consumable: 'Consumable',
  other: 'Other',
}

const METHOD: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', netbanking: 'Net banking',
  cheque: 'Cheque', insurance: 'Insurance / TPA', other: 'Other',
}

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: .4,
  textTransform: 'uppercase', color: '#8a8172',
}

const numCell: React.CSSProperties = {
  padding: '9px 0 9px 10px', textAlign: 'right', verticalAlign: 'top',
  fontSize: 14.5, color: '#14201c', whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
}

function TotalRow({ k, v, strong, muted }: {
  k: string; v: string; strong?: boolean; muted?: boolean
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 20,
      padding: strong ? '10px 0 0' : '3px 0',
      fontSize: strong ? 18 : 14.5,
      fontWeight: strong ? 800 : 500,
      color: muted ? '#5f6b64' : '#14201c',
      borderTop: strong ? '1.5px solid #14201c' : undefined,
      marginTop: strong ? 8 : undefined,
    }}>
      <span>{k}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  )
}

export default function BillPage() {
  const { token } = useParams()
  const [bill, setBill] = useState<PublicBill | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Bill | Sehatsandhi'
    let cancelled = false
    fetchPublicBill(token ?? '')
      .then(b => { if (!cancelled) setBill(b) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#5f6b64' }}>Loading…</div>
  }

  if (error || !bill) {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#14201c' }}>Bill not available</h1>
        <p style={{ marginTop: 10, color: '#5f6b64', fontSize: 15 }}>{error}</p>
        <p style={{ marginTop: 16, color: '#8a8172', fontSize: 13.5 }}>
          If you need it again, message the clinic and ask them to resend it.
        </p>
      </div>
    )
  }

  const cancelled = bill.status === 'cancelled'
  const superseded = bill.status === 'superseded'
  const settled = bill.balance_due <= 0

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } }`}</style>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 60px' }}>

        {(cancelled || superseded) && (
          <div style={{
            marginBottom: 18, padding: '12px 14px', borderRadius: 10,
            background: cancelled ? '#fdf1f1' : '#fff5e5',
            border: `1px solid ${cancelled ? '#f0c9c9' : '#f0dcb0'}`,
            color: cancelled ? '#8a2b2b' : '#8a5a00', fontSize: 14, fontWeight: 700,
          }}>
            {cancelled
              ? 'This bill has been cancelled. Do not pay against it — please contact the clinic.'
              : 'This bill has been replaced by a corrected one. Ask the clinic for the current version before paying or claiming against it.'}
          </div>
        )}

        <header style={{ borderBottom: '2px solid #14201c', paddingBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#14201c' }}>
            {bill.clinic_name ?? 'Bill'}
          </div>
          {bill.clinic_address && (
            <div style={{ fontSize: 13, color: '#5f6b64', marginTop: 3 }}>{bill.clinic_address}</div>
          )}
          {bill.clinic_phone && <div style={{ fontSize: 13, color: '#5f6b64' }}>{bill.clinic_phone}</div>}
          {/* An insurer looks for this before anything else on the page. */}
          {bill.clinic_gstin && (
            <div style={{ fontSize: 13, color: '#5f6b64' }}>GSTIN {bill.clinic_gstin}</div>
          )}
          <div style={{
            marginTop: 10, fontSize: 15, fontWeight: 800, letterSpacing: .3,
            textTransform: 'uppercase', color: '#14201c',
          }}>
            {bill.bill_type === 'ipd' ? 'Inpatient Bill' : bill.bill_type === 'opd' ? 'Bill' : 'Account Statement'}
          </div>
        </header>

        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          flexWrap: 'wrap', padding: '14px 0', borderBottom: '1px solid #ece5d7',
        }}>
          <div>
            <div style={LABEL}>Patient</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#14201c' }}>{bill.patient_name}</div>
            <div style={{ fontSize: 13, color: '#5f6b64' }}>
              {[bill.patient_age != null ? `${bill.patient_age} years` : null, bill.patient_gender]
                .filter(Boolean).join(' · ')}
            </div>
            {bill.mrn && (
              <div style={{ fontSize: 13, color: '#5f6b64' }}>MRN {bill.mrn}</div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={LABEL}>{bill.bill_no}</div>
            <div style={{ fontSize: 13, color: '#5f6b64', marginTop: 2 }}>{fmtDate(bill.issued_at)}</div>
            {bill.admission_no && (
              <div style={{ fontSize: 13, color: '#5f6b64', marginTop: 3 }}>
                Admission {bill.admission_no}
              </div>
            )}
            {bill.admitted_at && (
              <div style={{ fontSize: 12.5, color: '#8a8172' }}>
                {fmtDate(bill.admitted_at)}
                {bill.discharged_at && ` — ${fmtDate(bill.discharged_at)}`}
              </div>
            )}
          </div>
        </div>

        {/* The lines. The reason the page exists — a patient who cannot see what
            each rupee was for has no way to check it, and no way to claim it. */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
          <thead>
            <tr>
              <th style={{ ...LABEL, textAlign: 'left', padding: '9px 0', borderBottom: '1px solid #ece5d7' }}>
                Particulars
              </th>
              <th style={{ ...LABEL, textAlign: 'right', padding: '9px 0 9px 10px', borderBottom: '1px solid #ece5d7' }}>
                Qty
              </th>
              <th style={{ ...LABEL, textAlign: 'right', padding: '9px 0 9px 10px', borderBottom: '1px solid #ece5d7' }}>
                Rate
              </th>
              <th style={{ ...LABEL, textAlign: 'right', padding: '9px 0 9px 10px', borderBottom: '1px solid #ece5d7' }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((it, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f0ece2' }}>
                <td style={{ padding: '9px 0', verticalAlign: 'top' }}>
                  <div style={{ fontSize: 15, color: '#14201c' }}>{it.description}</div>
                  <div style={{ fontSize: 12, color: '#8a8172', marginTop: 1 }}>
                    {CATEGORY[it.category] ?? it.category}
                    {it.charged_on && ` · ${fmtDate(it.charged_on)}`}
                  </div>
                </td>
                <td style={numCell}>{Number(it.quantity)}</td>
                <td style={numCell}>{moneyExact(it.unit_price)}</td>
                <td style={{ ...numCell, fontWeight: 700 }}>{moneyExact(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Shown as arithmetic rather than a single number, so a patient can
            follow it and a TPA clerk can check it. */}
        <div style={{ marginTop: 16, marginLeft: 'auto', maxWidth: 340 }}>
          <TotalRow k="Subtotal" v={moneyExact(bill.subtotal)} />
          {bill.discount_amount > 0 && (
            <TotalRow
              k={`Discount${bill.discount_reason ? ` (${bill.discount_reason})` : ''}`}
              v={`− ${moneyExact(bill.discount_amount)}`}
              muted
            />
          )}
          {bill.round_off !== 0 && (
            <TotalRow
              k="Round off"
              v={`${bill.round_off > 0 ? '+ ' : '− '}${moneyExact(Math.abs(bill.round_off))}`}
              muted
            />
          )}
          <TotalRow k="Net payable" v={moneyExact(bill.net_payable)} strong />
          {bill.paid > 0 && <TotalRow k="Paid" v={`− ${moneyExact(bill.paid)}`} muted />}
        </div>

        {/* Balance, and it does not hide. This is the number the patient came
            for and the one they will be asked about at the desk. */}
        <div style={{
          marginTop: 16, marginLeft: 'auto', maxWidth: 340,
          padding: '12px 15px', borderRadius: 10,
          background: settled ? '#eef7f2' : '#fdf1f1',
          border: `1px solid ${settled ? '#cfe6da' : '#f0c9c9'}`,
          display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'baseline',
        }}>
          <span style={{ ...LABEL, color: settled ? '#1c6b4a' : '#8a2b2b' }}>
            {settled ? 'Fully paid' : 'Balance due'}
          </span>
          <span style={{
            fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            color: settled ? '#1c6b4a' : '#8a2b2b',
          }}>
            {moneyExact(settled ? 0 : bill.balance_due)}
          </span>
        </div>

        {bill.payments.length > 0 && (
          <section style={{ marginTop: 22 }}>
            <div style={LABEL}>Payments received</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <tbody>
                {bill.payments.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f0ece2' }}>
                    <td style={{ padding: '7px 0', fontSize: 14, color: '#14201c' }}>
                      {fmtDate(p.received_on)}
                    </td>
                    <td style={{ padding: '7px 0', fontSize: 14, color: '#5f6b64' }}>
                      {METHOD[p.method] ?? p.method}
                    </td>
                    <td style={{ ...numCell, padding: '7px 0' }}>{moneyExact(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer style={{ marginTop: 30, paddingTop: 14, borderTop: '1px solid #ece5d7' }}>
          <div style={{ fontSize: 12.5, color: '#8a8172', lineHeight: 1.5 }}>
            Issued through Sehatsandhi. Keep this for your insurance claim or
            reimbursement. If anything on it looks wrong, take it up with the
            clinic before paying — a corrected bill replaces this one rather than
            changing it.
          </div>
        </footer>

        <div className="no-print" style={{ marginTop: 22, display: 'flex', gap: 10 }}>
          <button onClick={() => window.print()} style={{
            fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            padding: '10px 18px', borderRadius: 10, border: 'none',
            background: '#0E9F6E', color: '#fff',
          }}>
            Print or save as PDF
          </button>
        </div>
      </div>
    </div>
  )
}
