import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPublicPrescription, PublicPrescription } from '../lib/prescriptionsApi'

// The patient's copy, opened from a WhatsApp or email link. No login: the token
// in the URL is the authorisation, exactly as /invoice/:token works.
//
// Built to be printed or saved as a PDF from the browser, which is why there is
// no PDF library anywhere in this feature. Everything that is navigation rather
// than document is print:hidden, so what comes out of the printer is the slip
// and nothing else.
//
// Deliberately plain. A prescription is read by a chemist in a hurry and by a
// patient who may not read English easily — so: large type, one column, the
// medicines in a table with generous rows, and no decoration competing with
// them.

const IST = 'Asia/Kolkata'
const fmt = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })
  : ''

export default function PrescriptionPage() {
  const { token } = useParams()
  const [rx, setRx] = useState<PublicPrescription | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Prescription | Sehatsandhi'
    let cancelled = false
    fetchPublicPrescription(token ?? '')
      .then(p => { if (!cancelled) setRx(p) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#5f6b64' }}>Loading…</div>
  }

  if (error || !rx) {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#14201c' }}>Prescription not available</h1>
        <p style={{ marginTop: 10, color: '#5f6b64', fontSize: 15 }}>{error}</p>
        <p style={{ marginTop: 16, color: '#8a8172', fontSize: 13.5 }}>
          If you need it again, message the clinic and ask them to resend it.
        </p>
      </div>
    )
  }

  const cancelled = rx.status === 'cancelled'
  const superseded = rx.status === 'superseded'

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
              ? 'This prescription has been cancelled. Do not use it — please contact the clinic.'
              : 'This prescription has been replaced by a newer one. Ask the clinic for the current version.'}
          </div>
        )}

        {/* Prescriber. A prescription is issued by a person with a registration
            number, and that is what makes it one — so it leads. */}
        <header style={{ borderBottom: '2px solid #14201c', paddingBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#14201c' }}>
            {rx.clinic_name ?? rx.prescriber_name}
          </div>
          <div style={{ fontSize: 14, color: '#14201c', marginTop: 4 }}>
            {rx.prescriber_name}
            {rx.prescriber_qualification && `, ${rx.prescriber_qualification}`}
          </div>
          {rx.prescriber_reg_number && (
            <div style={{ fontSize: 13, color: '#5f6b64' }}>
              Reg. No. {rx.prescriber_reg_number}
            </div>
          )}
          {rx.clinic_address && (
            <div style={{ fontSize: 13, color: '#5f6b64', marginTop: 3 }}>{rx.clinic_address}</div>
          )}
          {rx.clinic_phone && (
            <div style={{ fontSize: 13, color: '#5f6b64' }}>{rx.clinic_phone}</div>
          )}
        </header>

        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          flexWrap: 'wrap', padding: '14px 0', borderBottom: '1px solid #ece5d7',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: '#8a8172' }}>
              Patient
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#14201c' }}>{rx.patient_name}</div>
            <div style={{ fontSize: 13, color: '#5f6b64' }}>
              {[rx.patient_age != null ? `${rx.patient_age} years` : null, rx.patient_gender]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: '#8a8172' }}>
              {rx.prescription_no}
            </div>
            <div style={{ fontSize: 13, color: '#5f6b64' }}>{fmt(rx.issued_at)}</div>
          </div>
        </div>

        {rx.diagnosis && (
          <section style={{ padding: '14px 0' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: '#8a8172' }}>
              Diagnosis
            </div>
            <div style={{ fontSize: 15, color: '#14201c', marginTop: 3 }}>{rx.diagnosis}</div>
          </section>
        )}

        {/* The medicines. The reason the page exists, so they get the space. */}
        <section style={{ padding: '10px 0 4px' }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: '#14201c', lineHeight: 1 }}>℞</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
            <tbody>
              {rx.items.map((it, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0ece2' }}>
                  <td style={{ padding: '12px 8px 12px 0', verticalAlign: 'top', width: 28, color: '#8a8172', fontSize: 15 }}>
                    {i + 1}.
                  </td>
                  <td style={{ padding: '12px 0', verticalAlign: 'top' }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#14201c' }}>
                      {it.drug_name}
                      {it.strength && <span style={{ fontWeight: 600 }}> {it.strength}</span>}
                      {it.form && <span style={{ fontWeight: 400, color: '#5f6b64' }}> ({it.form})</span>}
                    </div>
                    <div style={{ fontSize: 15, color: '#14201c', marginTop: 3 }}>
                      {[it.dosage, it.duration, it.quantity].filter(Boolean).join('  ·  ')}
                    </div>
                    {it.instructions && (
                      <div style={{ fontSize: 14, color: '#5f6b64', marginTop: 2 }}>{it.instructions}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {rx.advice && (
          <section style={{ padding: '14px 0', borderTop: '1px solid #ece5d7' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: '#8a8172' }}>
              Advice
            </div>
            <div style={{ fontSize: 15, color: '#14201c', marginTop: 3, whiteSpace: 'pre-wrap' }}>{rx.advice}</div>
          </section>
        )}

        {rx.follow_up_date && (
          <div style={{ fontSize: 15, color: '#14201c', paddingTop: 6 }}>
            <strong>Come back on {fmt(rx.follow_up_date)}</strong>
          </div>
        )}

        <footer style={{ marginTop: 34, paddingTop: 14, borderTop: '1px solid #ece5d7' }}>
          <div style={{ fontSize: 12.5, color: '#8a8172', lineHeight: 1.5 }}>
            Issued through Sehatsandhi. Take medicines only as written above. If
            you feel worse, or you have a reaction, contact the clinic straight
            away.
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
