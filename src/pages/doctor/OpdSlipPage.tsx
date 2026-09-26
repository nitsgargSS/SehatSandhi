import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { clinicWaLink, qrDataUrl } from '../../lib/qr'

// The OPD slip (0135), printed at the desk or by the nurse before the patient
// goes in: the hospital's banner, the token, the doctor, what was charged, and
// the vitals and allergies taken so far — then space for the doctor to write.
//
// Signed-in clinic staff only: sehat_opd_slip checks the caller belongs to the
// business, and this page reads it with the staff member's own session.

interface Slip {
  clinic: { name: string; address: string | null; phone: string | null; email: string | null
            reg_number: string | null; gstin: string | null; letterhead_url: string | null
            qr_code?: string | null; wa_number?: string | null }
  token: { number: number; date: string; issued_at: string; reason: string | null; priority: number; priority_reason: string | null }
  doctor: { name: string; speciality: string | null; qualification: string | null; reg_number: string | null } | null
  patient: { name: string; age: number | null; gender: string | null; blood_group: string | null
             phone: string | null; mrn: string | null; visit_count: number | null } | null
  vitals: { recorded_at: string; bp_systolic: number | null; bp_diastolic: number | null; pulse: number | null
            temperature_c: number | null; weight_kg: number | null; height_cm: number | null; spo2: number | null
            blood_sugar_mg_dl: number | null; blood_sugar_type: string | null; notes: string | null } | null
  allergies: { substance: string; reaction: string | null; severity: string | null }[]
  conditions: string[]
  charge: { amount: number; list_price: number | null; discount_kind: string | null; discount_reason: string | null } | null
}

const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export function Letterhead({ clinic }: { clinic: Slip['clinic'] }) {
  if (clinic.letterhead_url) {
    return <img src={clinic.letterhead_url} alt={clinic.name} style={{ width: '100%', maxHeight: 160, objectFit: 'contain', display: 'block' }} />
  }
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{clinic.name}</div>
      {clinic.address && <div style={{ fontSize: 13, color: '#444' }}>{clinic.address}</div>}
      <div style={{ fontSize: 13, color: '#444' }}>
        {[clinic.phone, clinic.email, clinic.reg_number ? `Reg. ${clinic.reg_number}` : null].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

export default function OpdSlipPage() {
  const { id } = useParams()
  const [slip, setSlip] = useState<Slip | null>(null)
  const [err, setErr] = useState('')
  // 0142: the clinic's QR code at the foot — follow-ups and reports on WhatsApp.
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    const c = slip?.clinic
    if (c?.qr_code) qrDataUrl(clinicWaLink(c.wa_number ?? '917015399355', c.qr_code, c.name), 240).then(setQr)
  }, [slip])

  useEffect(() => {
    if (!id) return
    supabase.rpc('sehat_opd_slip', { p_queue: id }).then(({ data, error }) => {
      if (error) setErr(error.message.includes('No such token') ? 'This slip is not available. Sign in as clinic staff and try again.' : error.message)
      else setSlip(data as Slip)
    })
  }, [id])

  if (err) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>{err}</div>
  if (!slip) return <div style={{ padding: 32, fontFamily: 'system-ui' }}>Loading…</div>

  const v = slip.vitals
  const p = slip.patient
  const vit: [string, string | null][] = v ? [
    ['BP', v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic} mmHg` : null],
    ['Pulse', v.pulse ? `${v.pulse} /min` : null],
    ['Temp', v.temperature_c ? `${v.temperature_c} °C` : null],
    ['SpO₂', v.spo2 ? `${v.spo2}%` : null],
    ['Weight', v.weight_kg ? `${v.weight_kg} kg` : null],
    ['Height', v.height_cm ? `${v.height_cm} cm` : null],
    ['Sugar', v.blood_sugar_mg_dl ? `${v.blood_sugar_mg_dl} mg/dL${v.blood_sugar_type ? ` (${v.blood_sugar_type})` : ''}` : null],
  ] : []
  const cell: React.CSSProperties = { padding: '5px 8px', border: '1px solid #bbb', fontSize: 13 }

  return (
    <div style={{ background: '#fff', minHeight: '100vh', fontFamily: 'system-ui, Arial, sans-serif', color: '#111' }}>
      <style>{`@media print { .no-print { display: none !important } @page { size: A4; margin: 12mm } }`}</style>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 18px 40px' }}>
        <div className="no-print" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginBottom: 12 }}>
          <button onClick={() => window.print()} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0f6b4a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Print OPD slip
          </button>
        </div>

        <header style={{ borderBottom: '2px solid #111', paddingBottom: 10 }}>
          <Letterhead clinic={slip.clinic} />
        </header>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 8px' }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: .5 }}>OPD SLIP</div>
          <div style={{ fontSize: 13 }}>
            {new Date(slip.token.issued_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <tbody>
            <tr>
              <td style={cell}><b>Token</b> {slip.token.number}{slip.token.priority > 0 ? ' (priority)' : ''}</td>
              <td style={cell}><b>Patient</b> {p?.name ?? '—'}</td>
              <td style={cell}><b>Age/Sex</b> {[p?.age != null ? `${p.age}y` : null, p?.gender].filter(Boolean).join(' / ') || '—'}</td>
            </tr>
            <tr>
              <td style={cell}><b>File no.</b> {p?.mrn ?? '—'}</td>
              <td style={cell}><b>Mobile</b> {p?.phone ?? '—'}</td>
              <td style={cell}><b>Blood group</b> {p?.blood_group ?? '—'}</td>
            </tr>
            <tr>
              <td style={cell} colSpan={2}>
                <b>Doctor</b> {slip.doctor ? [slip.doctor.name, slip.doctor.qualification, slip.doctor.speciality].filter(Boolean).join(', ') : '—'}
              </td>
              <td style={cell}>
                <b>OPD fee</b>{' '}
                {slip.charge
                  ? (slip.charge.discount_kind === 'free' ? 'Free'
                    : slip.charge.discount_kind === 'discount' && slip.charge.list_price
                      ? <><s>{rupees(slip.charge.list_price)}</s> {rupees(slip.charge.amount)}</>
                      : rupees(slip.charge.amount))
                  : '—'}
              </td>
            </tr>
            {(slip.token.reason || (p?.visit_count ?? 0) > 1) && (
              <tr>
                <td style={cell} colSpan={3}>
                  {slip.token.reason && <><b>Complaint</b> {slip.token.reason}</>}
                  {(p?.visit_count ?? 0) > 1 && <span style={{ float: 'right' }}>Visit no. {p!.visit_count}</span>}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ fontSize: 13, fontWeight: 800, margin: '10px 0 4px' }}>Vitals {v ? `(${new Date(v.recorded_at).toLocaleTimeString('en-IN', { timeStyle: 'short' })})` : ''}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              {(vit.length ? vit : [['BP', null], ['Pulse', null], ['Temp', null], ['SpO₂', null], ['Weight', null], ['Sugar', null]] as [string, string | null][])
                .map(([k, val]) => <td key={k} style={cell}><b>{k}</b><br />{val ?? ' '}</td>)}
            </tr>
          </tbody>
        </table>
        {v?.notes && <div style={{ fontSize: 13, marginTop: 4 }}>Note: {v.notes}</div>}

        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1, border: '1px solid #bbb', padding: '6px 8px', fontSize: 13 }}>
            <b>Allergies:</b>{' '}
            {slip.allergies.length
              ? slip.allergies.map(a => `${a.substance}${a.reaction ? ` (${a.reaction})` : ''}${a.severity ? ` — ${a.severity}` : ''}`).join('; ')
              : 'None recorded'}
          </div>
          <div style={{ flex: 1, border: '1px solid #bbb', padding: '6px 8px', fontSize: 13 }}>
            <b>Known conditions:</b> {slip.conditions.length ? slip.conditions.join(', ') : 'None recorded'}
          </div>
        </div>

        <div style={{ marginTop: 14, border: '1px solid #bbb', minHeight: 430, padding: '8px 10px' }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Clinical notes / Rx</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 28, fontSize: 12.5, gap: 12 }}>
          <span>Next visit: ____________</span>
          {qr && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <img src={qr} alt="" style={{ width: 64, height: 64 }} />
              <span>Book your next visit<br />on WhatsApp</span>
            </span>
          )}
          <span>Doctor's signature: ____________________</span>
        </div>
      </div>
    </div>
  )
}
