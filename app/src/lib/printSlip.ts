import * as Print from 'expo-print'
import QRCode from 'qrcode'
import { supabase } from './supabase'
import { getSpecialityFields, type SpecialityField } from '@web/lib/patientsApi'
import { clinicWaLink } from '@web/lib/qr'
import { SPECIALITIES } from '@web/types'

// The OPD slip printed straight from the phone (app 1.1.0, expo-print): the
// website's slip (src/pages/doctor/OpdSlipPage.tsx) as HTML — the hospital's
// banner, the token, the doctor, what was charged, vitals and allergies so
// far, the treating doctor's examination as blanks, room to write, and the
// clinic's WhatsApp QR. sehat_opd_slip checks the caller is the business's
// staff. Android's print window: a Wi-Fi printer, or Save as PDF.

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

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const rupees = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

function exam(fields: SpecialityField[]): string {
  const sections: [string, SpecialityField[]][] = []
  for (const f of fields) {
    const k = f.section ?? 'Examination'
    const hit = sections.find(x => x[0] === k)
    if (hit) hit[1].push(f); else sections.push([k, [f]])
  }
  const head = (f: SpecialityField) => esc(`${f.label}${f.unit ? ` (${f.unit})` : ''}`)
  return sections.map(([name, fs]) => {
    const sited = fs.filter(f => f.sites && f.sites.length > 0 && f.sites.length <= 4)
    const chart = fs.filter(f => f.sites && f.sites.length > 4)
    const plain = fs.filter(f => !f.sites || f.sites.length === 0)
    const sites = sited[0]?.sites ?? []
    return `<div class="sec"><div class="h">${esc(name)}</div>`
      + (sited.length ? `<table><tr><th style="width:34%"></th>${sites.map(s => `<th>${s === 'R' ? 'Right (OD)' : s === 'L' ? 'Left (OS)' : esc(s)}</th>`).join('')}</tr>`
          + sited.map(f => `<tr><td>${head(f)}</td>${sites.map(() => '<td style="height:22px"></td>').join('')}</tr>`).join('') + '</table>' : '')
      + chart.map(f => `<div style="margin-top:4px;font-size:12px">${head(f)}${f.options?.length ? ` — ${esc(f.options.join(' / '))}` : ''}</div>`
          + `<div class="chart">${(f.sites ?? []).map(s => `<div>${esc(s)}</div>`).join('')}</div>`).join('')
      + (plain.length ? `<div class="plain">${plain.map(f => `<div>${head(f)}: ${f.kind === 'select' && f.options?.length
          ? f.options.map(o => `☐ ${esc(o)}`).join('&nbsp;&nbsp;') : f.kind === 'boolean' ? '☐ Yes ☐ No' : '______________________'}</div>`).join('')}</div>` : '')
      + '</div>'
  }).join('')
}

function html(slip: Slip, fields: SpecialityField[], qrSvg: string | null): string {
  const c = slip.clinic, p = slip.patient, v = slip.vitals, d = slip.doctor
  const vit: [string, string | null][] = v ? [
    ['BP', v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic} mmHg` : null],
    ['Pulse', v.pulse ? `${v.pulse} /min` : null], ['Temp', v.temperature_c ? `${v.temperature_c} °C` : null],
    ['SpO₂', v.spo2 ? `${v.spo2}%` : null], ['Weight', v.weight_kg ? `${v.weight_kg} kg` : null],
    ['Height', v.height_cm ? `${v.height_cm} cm` : null],
    ['Sugar', v.blood_sugar_mg_dl ? `${v.blood_sugar_mg_dl} mg/dL${v.blood_sugar_type ? ` (${v.blood_sugar_type})` : ''}` : null],
  ] : [['BP', null], ['Pulse', null], ['Temp', null], ['SpO₂', null], ['Weight', null], ['Sugar', null]]
  const fee = slip.charge
    ? (slip.charge.discount_kind === 'free' ? 'Free'
      : slip.charge.discount_kind === 'discount' && slip.charge.list_price ? `<s>${rupees(slip.charge.list_price)}</s> ${rupees(slip.charge.amount)}`
      : rupees(slip.charge.amount)) : '—'
  const letter = c.letterhead_url
    ? `<img src="${esc(c.letterhead_url)}" style="width:100%;max-height:160px;object-fit:contain;display:block" />`
    : `<div style="font-size:22px;font-weight:800">${esc(c.name)}</div>${c.address ? `<div class="m">${esc(c.address)}</div>` : ''}`
      + `<div class="m">${esc([c.phone, c.email, c.reg_number ? `Reg. ${c.reg_number}` : null].filter(Boolean).join(' · '))}</div>`
  const doc = d ? [d.name, d.qualification, SPECIALITIES.find(sp => sp.id === d.speciality)?.en ?? d.speciality].filter(Boolean).join(', ') : '—'
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @page { size: A4; margin: 12mm }
    body { font-family: Arial, sans-serif; color: #111; margin: 0 }
    .m { font-size: 13px; color: #444 }
    table { width: 100%; border-collapse: collapse }
    td, th { border: 1px solid #bbb; padding: 5px 8px; font-size: 13px; text-align: left; vertical-align: top }
    .h { font-size: 13px; font-weight: 800; margin: 10px 0 4px }
    .row { display: flex; gap: 12px; margin-top: 12px }
    .box { flex: 1; border: 1px solid #bbb; padding: 6px 8px; font-size: 13px }
    .chart { display: grid; grid-template-columns: repeat(16, 1fr); gap: 2px }
    .chart div { border: 1px solid #bbb; height: 30px; font-size: 10px; text-align: center }
    .plain { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 12px }
    .sec { margin-top: 10px }
  </style></head><body>
    <header style="border-bottom:2px solid #111;padding-bottom:10px">${letter}</header>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin:12px 0 8px">
      <div style="font-size:16px;font-weight:800;letter-spacing:.5px">OPD SLIP</div>
      <div style="font-size:13px">${esc(new Date(slip.token.issued_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }))}</div>
    </div>
    <table>
      <tr><td><b>Token</b> ${slip.token.number}${slip.token.priority > 0 ? ' (priority)' : ''}</td><td><b>Patient</b> ${esc(p?.name ?? '—')}</td>
          <td><b>Age/Sex</b> ${esc([p?.age != null ? `${p.age}y` : null, p?.gender].filter(Boolean).join(' / ') || '—')}</td></tr>
      <tr><td><b>File no.</b> ${esc(p?.mrn ?? '—')}</td><td><b>Mobile</b> ${esc(p?.phone ?? '—')}</td><td><b>Blood group</b> ${esc(p?.blood_group ?? '—')}</td></tr>
      <tr><td colspan="2"><b>Doctor</b> ${esc(doc)}</td><td><b>OPD fee</b> ${fee}</td></tr>
      ${slip.token.reason || (p?.visit_count ?? 0) > 1 ? `<tr><td colspan="3">${slip.token.reason ? `<b>Complaint</b> ${esc(slip.token.reason)}` : ''}${(p?.visit_count ?? 0) > 1 ? `<span style="float:right">Visit no. ${p!.visit_count}</span>` : ''}</td></tr>` : ''}
    </table>
    <div class="h">Vitals ${v ? `(${esc(new Date(v.recorded_at).toLocaleTimeString('en-IN', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }))})` : ''}</div>
    <table><tr>${vit.map(([k, val]) => `<td><b>${k}</b><br />${esc(val ?? ' ')}</td>`).join('')}</tr></table>
    ${v?.notes ? `<div style="font-size:13px;margin-top:4px">Note: ${esc(v.notes)}</div>` : ''}
    <div class="row">
      <div class="box"><b>Allergies:</b> ${slip.allergies.length ? esc(slip.allergies.map(a => `${a.substance}${a.reaction ? ` (${a.reaction})` : ''}${a.severity ? ` — ${a.severity}` : ''}`).join('; ')) : 'None recorded'}</div>
      <div class="box"><b>Known conditions:</b> ${slip.conditions.length ? esc(slip.conditions.join(', ')) : 'None recorded'}</div>
    </div>
    ${fields.length ? exam(fields) : ''}
    <div style="margin-top:14px;border:1px solid #bbb;min-height:${fields.length ? 260 : 430}px;padding:8px 10px">
      <div style="font-size:13px;font-weight:800">${fields.length ? 'Diagnosis / notes / Rx' : 'Clinical notes / Rx'}</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:28px;font-size:12.5px;gap:12px">
      <span>Next visit: ____________</span>
      ${qrSvg ? `<span style="display:flex;align-items:center;gap:6px;font-size:11px"><span style="width:64px;height:64px;display:inline-block">${qrSvg}</span><span>Book your next visit<br />on WhatsApp</span></span>` : ''}
      <span>Doctor's signature: ____________________</span>
    </div>
  </body></html>`
}

/** Prints the slip for one queue token. Throws with a message to show. */
export async function printOpdSlip(queueId: string): Promise<void> {
  const { data, error } = await supabase.rpc('sehat_opd_slip', { p_queue: queueId })
  if (error) throw new Error(error.message.includes('No such token') ? 'This slip is not available to you.' : error.message)
  const slip = data as Slip
  const [fields, qrSvg] = await Promise.all([
    slip.doctor?.speciality ? getSpecialityFields(slip.doctor.speciality).catch(() => []) : Promise.resolve([]),
    slip.clinic.qr_code
      ? QRCode.toString(clinicWaLink(slip.clinic.wa_number ?? '917015399355', slip.clinic.qr_code, slip.clinic.name),
          { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b3d2c', light: '#ffffff' } })
          .then(s => s.replace('<svg ', '<svg width="64" height="64" ')).catch(() => null)
      : Promise.resolve(null),
  ])
  await Print.printAsync({ html: html(slip, fields, qrSvg) })
}
