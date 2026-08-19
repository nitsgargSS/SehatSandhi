import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPublicDischargeSummary, PublicDischargeSummary } from '../lib/dischargeApi'

// The patient's copy of their discharge summary, opened from a WhatsApp or
// email link. No login: the token in the URL is the authorisation, as with
// /rx/ and /invoice/.
//
// This one is read by two people with different needs. The patient wants to
// know what to do now — medicines, diet, when to come back, and what would mean
// coming back sooner. The next doctor wants the clinical story: diagnosis,
// course in hospital, what was found, what was done. So both are here, with the
// patient's part first, because they are the one holding the phone.
//
// Built to be printed. Indian patients are routinely asked for the physical
// summary at the next hospital, so the print layout is the real deliverable and
// everything that is navigation rather than document is print:hidden.

const IST = 'Asia/Kolkata'
const fmtDate = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })
  : ''

const CONDITION: Record<string, string> = {
  recovered: 'Recovered',
  improved: 'Improved',
  unchanged: 'Unchanged',
  worse: 'Worse',
  referred: 'Referred elsewhere',
  deceased: 'Deceased',
}

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: .4,
  textTransform: 'uppercase', color: '#8a8172',
}

function Block({ title, body }: { title: string; body: string | null }) {
  if (!body) return null
  return (
    <section style={{ padding: '13px 0', borderTop: '1px solid #f0ece2' }}>
      <div style={LABEL}>{title}</div>
      <div style={{ fontSize: 15, color: '#14201c', marginTop: 3, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
        {body}
      </div>
    </section>
  )
}

export default function DischargeSummaryPage() {
  const { token } = useParams()
  const [ds, setDs] = useState<PublicDischargeSummary | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Discharge summary | Sehatsandhi'
    let cancelled = false
    fetchPublicDischargeSummary(token ?? '')
      .then(s => { if (!cancelled) setDs(s) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#5f6b64' }}>Loading…</div>
  }

  if (error || !ds) {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#14201c' }}>Discharge summary not available</h1>
        <p style={{ marginTop: 10, color: '#5f6b64', fontSize: 15 }}>{error}</p>
        <p style={{ marginTop: 16, color: '#8a8172', fontSize: 13.5 }}>
          If you need it again, message the hospital and ask them to resend it.
        </p>
      </div>
    )
  }

  const cancelled = ds.status === 'cancelled'
  const superseded = ds.status === 'superseded'

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } }`}</style>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px 60px' }}>

        {(cancelled || superseded) && (
          <div style={{
            marginBottom: 18, padding: '12px 14px', borderRadius: 10,
            background: cancelled ? '#fdf1f1' : '#fff5e5',
            border: `1px solid ${cancelled ? '#f0c9c9' : '#f0dcb0'}`,
            color: cancelled ? '#8a2b2b' : '#8a5a00', fontSize: 14, fontWeight: 700,
          }}>
            {cancelled
              ? 'This discharge summary has been cancelled. Please contact the hospital.'
              : 'This summary has been replaced by a corrected one. Ask the hospital for the current version before showing this to another doctor.'}
          </div>
        )}

        <header style={{ borderBottom: '2px solid #14201c', paddingBottom: 14 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#14201c' }}>
            {ds.clinic_name ?? 'Discharge summary'}
          </div>
          {ds.clinic_address && (
            <div style={{ fontSize: 13, color: '#5f6b64', marginTop: 3 }}>{ds.clinic_address}</div>
          )}
          {ds.clinic_phone && <div style={{ fontSize: 13, color: '#5f6b64' }}>{ds.clinic_phone}</div>}
          <div style={{
            marginTop: 10, fontSize: 15, fontWeight: 800, letterSpacing: .3,
            textTransform: 'uppercase', color: '#14201c',
          }}>
            Discharge Summary
          </div>
        </header>

        {/* Who, where and for how long. */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          flexWrap: 'wrap', padding: '14px 0', borderBottom: '1px solid #ece5d7',
        }}>
          <div>
            <div style={LABEL}>Patient</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#14201c' }}>{ds.patient_name}</div>
            <div style={{ fontSize: 13, color: '#5f6b64' }}>
              {[ds.patient_age != null ? `${ds.patient_age} years` : null, ds.patient_gender]
                .filter(Boolean).join(' · ')}
            </div>
            {ds.ward_bed && (
              <div style={{ fontSize: 13, color: '#5f6b64', marginTop: 2 }}>{ds.ward_bed}</div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={LABEL}>{ds.summary_no}</div>
            <div style={{ fontSize: 13.5, color: '#14201c', marginTop: 3 }}>
              Admitted {fmtDate(ds.admitted_at)}
            </div>
            <div style={{ fontSize: 13.5, color: '#14201c' }}>
              Discharged {fmtDate(ds.discharged_at)}
            </div>
            {ds.days_stayed != null && (
              <div style={{ fontSize: 13, color: '#5f6b64' }}>
                {ds.days_stayed} {ds.days_stayed === 1 ? 'day' : 'days'}
              </div>
            )}
          </div>
        </div>

        {/* The diagnosis, given the most weight on the page — it is the first
            thing the next doctor looks for. */}
        {ds.discharge_diagnosis && (
          <section style={{ padding: '16px 0 4px' }}>
            <div style={LABEL}>Diagnosis</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#14201c', marginTop: 4, lineHeight: 1.4 }}>
              {ds.discharge_diagnosis}
            </div>
            {ds.admitting_diagnosis && ds.admitting_diagnosis !== ds.discharge_diagnosis && (
              <div style={{ fontSize: 13.5, color: '#5f6b64', marginTop: 4 }}>
                Admitted with: {ds.admitting_diagnosis}
              </div>
            )}
            {ds.condition_on_discharge && (
              <div style={{ fontSize: 14, color: '#14201c', marginTop: 6 }}>
                Condition on discharge:{' '}
                <strong>{CONDITION[ds.condition_on_discharge] ?? ds.condition_on_discharge}</strong>
              </div>
            )}
          </section>
        )}

        {/* ── What the patient does now ──
            Before the clinical narrative, deliberately. The person holding the
            phone needs the medicines and the follow-up, and should not have to
            scroll past a paragraph about their own hospital course to find them. */}
        {ds.medicines.length > 0 && (
          <section style={{ padding: '14px 0 4px', borderTop: '1px solid #ece5d7' }}>
            <div style={LABEL}>Medicines to continue at home</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <tbody>
                {ds.medicines.map((m, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f0ece2' }}>
                    <td style={{ padding: '11px 8px 11px 0', verticalAlign: 'top', width: 28, color: '#8a8172', fontSize: 15 }}>
                      {i + 1}.
                    </td>
                    <td style={{ padding: '11px 0', verticalAlign: 'top' }}>
                      <div style={{ fontSize: 16.5, fontWeight: 700, color: '#14201c' }}>
                        {m.drug_name}
                        {m.strength && <span style={{ fontWeight: 600 }}> {m.strength}</span>}
                        {m.form && <span style={{ fontWeight: 400, color: '#5f6b64' }}> ({m.form})</span>}
                      </div>
                      <div style={{ fontSize: 15, color: '#14201c', marginTop: 3 }}>
                        {[m.dosage, m.duration, m.quantity].filter(Boolean).join('  ·  ')}
                      </div>
                      {m.instructions && (
                        <div style={{ fontSize: 14, color: '#5f6b64', marginTop: 2 }}>{m.instructions}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <Block title="Advice" body={ds.advice} />
        <Block title="Diet" body={ds.diet_advice} />
        <Block title="Activity and rest" body={ds.activity_advice} />

        {/* The part that keeps people out of A&E: what "worse" looks like and
            what to do about it. Boxed in red so it survives a skim. */}
        {ds.warning_signs && (
          <section style={{
            marginTop: 16, padding: '13px 15px', borderRadius: 10,
            background: '#fdf1f1', border: '1px solid #f0c9c9',
          }}>
            <div style={{ ...LABEL, color: '#8a2b2b' }}>Come back immediately if</div>
            <div style={{
              fontSize: 15.5, color: '#7a2626', marginTop: 4,
              whiteSpace: 'pre-wrap', lineHeight: 1.55, fontWeight: 600,
            }}>
              {ds.warning_signs}
            </div>
          </section>
        )}

        {(ds.follow_up_date || ds.follow_up_with) && (
          <div style={{
            marginTop: 14, padding: '13px 15px', borderRadius: 10,
            background: '#eef7f2', border: '1px solid #cfe6da',
          }}>
            <div style={{ ...LABEL, color: '#1c6b4a' }}>Follow-up</div>
            <div style={{ fontSize: 16, color: '#14201c', marginTop: 3, fontWeight: 700 }}>
              {ds.follow_up_date ? `Come back on ${fmtDate(ds.follow_up_date)}` : 'Come back for review'}
              {ds.follow_up_with && ` — ${ds.follow_up_with}`}
            </div>
          </div>
        )}

        {/* ── The clinical record, for the next doctor ── */}
        <Block title="Course in hospital" body={ds.course_in_hospital} />
        <Block title="Investigations" body={ds.investigations} />
        <Block title="Procedures" body={ds.procedures} />

        {/* Signed. A discharge summary is only worth anything to the next
            hospital because a registered doctor put their number on it. */}
        <footer style={{ marginTop: 30, paddingTop: 14, borderTop: '1px solid #ece5d7' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#14201c' }}>
            {ds.doctor_name}
            {ds.doctor_qualification && (
              <span style={{ fontWeight: 500 }}>, {ds.doctor_qualification}</span>
            )}
          </div>
          {ds.doctor_reg_number && (
            <div style={{ fontSize: 13, color: '#5f6b64' }}>Reg. No. {ds.doctor_reg_number}</div>
          )}
          <div style={{ fontSize: 13, color: '#8a8172', marginTop: 3 }}>
            Issued {fmtDate(ds.issued_at)}
          </div>

          <div style={{ fontSize: 12.5, color: '#8a8172', lineHeight: 1.5, marginTop: 14 }}>
            Issued through Sehatsandhi. Keep this and show it to any doctor you
            see next — it tells them what was treated here and what you are
            taking. Take medicines only as written above.
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
