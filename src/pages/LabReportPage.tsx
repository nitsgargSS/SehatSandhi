import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicReport, rangeText, PublicReport } from '../lib/labApi'

// The patient's lab report (0168), at /lab/<token> — the link sent on WhatsApp.
//
// Anyone with the link can open it, as with a prescription (/rx/) or a bill
// (/bill/): that is the point of sending it. It shows only results a doctor
// has approved, with who signed, on the lab's letterhead, and prints to A4.
// Out-of-range values are marked High/Low in words as well as colour, so the
// print is readable in black and white.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const d = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export default function LabReportPage() {
  const { token } = useParams()
  const [r, setR] = useState<PublicReport | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token || !UUID_RE.test(token)) { setErr('This report link is not valid.'); return }
    getPublicReport(token).then(rep => {
      if (rep.error === 'expired') setErr('This report link has expired. Please ask the lab to send it again.')
      else if (rep.error) setErr('We could not find this report. Please check the link, or ask the lab to send it again.')
      else setR(rep)
    }).catch(() => setErr('Could not load the report just now. Please try again.'))
  }, [token])

  if (err) return <div style={{ padding: 32, fontFamily: 'system-ui', maxWidth: 560, margin: '0 auto' }}>{err}</div>
  if (!r) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>Loading…</div>

  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #e5e5e5', fontSize: 13, verticalAlign: 'top' }
  const head: React.CSSProperties = { ...cell, fontWeight: 700, borderBottom: '1.5px solid #111', textAlign: 'left', fontSize: 12 }

  return (
    <div style={{ background: '#fff', minHeight: '100vh', fontFamily: 'system-ui, Arial, sans-serif', color: '#111' }}>
      <style>{`@media print { .no-print { display: none !important } @page { size: A4; margin: 12mm } }`}</style>
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '18px 16px 40px' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={() => window.print()} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0f6b4a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Print / save as PDF
          </button>
        </div>

        <header style={{ borderBottom: '2px solid #111', paddingBottom: 10 }}>
          {r.lab.letterhead_url
            ? <img src={r.lab.letterhead_url} alt={r.lab.name} style={{ width: '100%', maxHeight: 150, objectFit: 'contain', display: 'block' }} />
            : <>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{r.lab.name}</div>
                <div style={{ fontSize: 12.5, color: '#444' }}>{[r.lab.address, r.lab.phone, r.lab.reg_number ? `Reg. ${r.lab.reg_number}` : null].filter(Boolean).join(' · ')}</div>
              </>}
        </header>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 8px' }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: .5 }}>LABORATORY REPORT{r.version > 1 ? ` (update ${r.version})` : ''}</div>
          <div style={{ fontSize: 12.5 }}><b>{r.report_no}</b></div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14, fontSize: 13 }}>
          <tbody>
            <tr>
              <td style={{ padding: '3px 0' }}><b>Patient</b> {r.patient.name}</td>
              <td style={{ padding: '3px 0' }}><b>Age/Sex</b> {[r.patient.age != null ? `${r.patient.age}y` : null, r.patient.gender].filter(Boolean).join(' / ') || '—'}</td>
              <td style={{ padding: '3px 0' }}><b>Order</b> {r.order.order_no}</td>
            </tr>
            <tr>
              <td style={{ padding: '3px 0' }}><b>Referred by</b> {r.order.referred_by ?? 'Self'}</td>
              <td style={{ padding: '3px 0' }}><b>Collected</b> {d(r.order.collected_at)}</td>
              <td style={{ padding: '3px 0' }}><b>Reported</b> {d(r.approved_at)}</td>
            </tr>
          </tbody>
        </table>

        {r.items.map((it, n) => (
          <section key={n} style={{ marginBottom: 18, breakInside: 'avoid' }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, background: '#f3f4f2', padding: '6px 8px', borderRadius: 4 }}>
              {it.name}{it.department ? <span style={{ fontWeight: 500, color: '#555', fontSize: 12 }}> · {it.department}</span> : null}
            </div>
            {it.report_kind === 'narrative' ? (
              <div style={{ padding: '6px 8px' }}>
                {it.results.map((x, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#333', textTransform: 'uppercase', letterSpacing: .4 }}>{x.name}</div>
                    <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{x.value}{x.unit ? ` ${x.unit}` : ''}</div>
                  </div>
                ))}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={head}>Test</th><th style={head}>Result</th><th style={head}>Unit</th><th style={head}>Normal range</th></tr></thead>
                <tbody>
                  {it.results.map((x, i) => {
                    const abn = x.flag === 'H' || x.flag === 'L'
                    return (
                      <tr key={i}>
                        <td style={cell}>{x.name}</td>
                        <td style={{ ...cell, fontWeight: abn ? 800 : 500, color: abn ? '#b42318' : '#111' }}>
                          {x.value}{abn ? (x.flag === 'H' ? '  ↑ High' : '  ↓ Low') : ''}
                        </td>
                        <td style={cell}>{x.unit ?? ''}</td>
                        <td style={{ ...cell, color: '#555' }}>{rangeText({ ref_low: x.ref_low, ref_high: x.ref_high, ref_text: x.ref_text })}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 30, fontSize: 12.5 }}>
          <span style={{ color: '#555', maxWidth: 380 }}>Results are to be interpreted by a doctor in the light of the clinical picture. Ranges are this lab's reference ranges.</span>
          <span style={{ textAlign: 'right' }}>
            <b>{r.approved_by_name}</b>{r.approved_by_qualification ? <><br />{r.approved_by_qualification}</> : null}
            <br /><span style={{ color: '#555' }}>Approved {d(r.approved_at)}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
