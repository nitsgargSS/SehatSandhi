// lab-report-send — give the patient their lab report, as a link (0168).
//
// Called by the lab screen the moment a report is approved, and again from
// "Resend". The sending itself is _shared/deliver.ts, as for prescriptions and
// discharge summaries: WhatsApp first (AiSensy campaign
// AISENSY_LAB_REPORT_CAMPAIGN, template params [patient, lab, link]), email
// when an address is given. The link opens /lab/<token>, which renders the
// report on any phone.
//
// Also sends an UPLOADED report file (0169) exactly as uploaded: pass uploadId
// instead of reportId; the link then opens /lab/file/<token> (lab-file-view).
//
// Request:  { reportId, email? } | { uploadId, email? }   — signed-in lab/clinic user
// Response: { ok, whatsapp, email, errors? }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL,
//      AISENSY_API_KEY, AISENSY_LAB_REPORT_CAMPAIGN, MSG91_* (email)

import { corsHeaders, json } from '../_shared/cors.ts'
import { sendDocumentLink, logDelivery } from '../_shared/deliver.ts'
import { caller } from '../_shared/caller.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const who = caller(req)
  if (!who) return json({ error: 'unauthorised' }, 401)

  let reportId = ''
  let uploadId = ''
  let email: string | null = null
  try {
    const body = await req.json()
    reportId = typeof body.reportId === 'string' ? body.reportId : ''
    uploadId = typeof body.uploadId === 'string' ? body.uploadId : ''
    email = typeof body.email === 'string' && body.email.includes('@') ? body.email : null
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (!reportId && !uploadId) return json({ error: 'reportId or uploadId required' }, 400)
  const site = (Deno.env.get('SITE_URL') ?? 'https://sehatsandhi.com').replace(/\/$/, '')

  // ── An uploaded file, sent as it is ──
  if (uploadId) {
    const { data: up, error: upErr } = await who.asCaller
      .from('lab_uploaded_report_detail')
      .select('id, title, public_token, business_id, patient_name, patient_phone, expires_on, purged_at')
      .eq('id', uploadId).maybeSingle()
    if (upErr) return json({ error: upErr.message }, 500)
    if (!up) return json({ error: 'not found' }, 404)
    if (up.purged_at || new Date(`${up.expires_on}T23:59:59+05:30`) < new Date()) {
      return json({ error: 'this report is past its retention and no longer kept' }, 410)
    }
    const { data: lab } = await who.asService.from('businesses').select('name').eq('id', up.business_id).maybeSingle()
    const target = {
      phone: String(up.patient_phone ?? '').replace(/[^0-9]/g, ''),
      patientName: String(up.patient_name ?? 'Patient'),
      clinicName: String(lab?.name ?? 'your lab'),
      link: `${site}/lab/file/${up.public_token}`,
      campaignEnv: 'AISENSY_LAB_REPORT_CAMPAIGN',
      email,
      documentKind: 'lab_report_file',
      documentLabel: String(up.title ?? 'Lab report'),
    }
    const result = await sendDocumentLink(target)
    await who.asService.from('lab_uploaded_reports').update({
      sent_at: result.sent.length ? new Date().toISOString() : null,
      sent_channels: result.sent,
      send_error: result.errors.length ? result.errors.join(' | ').slice(0, 500) : null,
    }).eq('id', up.id)
    await logDelivery(who.asService, target, result)
    return json({ ok: result.sent.length > 0, whatsapp: result.sent.includes('whatsapp'), email: result.sent.includes('email'),
                  errors: result.errors.length ? result.errors : undefined })
  }

  // Read as the caller: a report of another business is simply not visible.
  const { data: rep, error } = await who.asCaller
    .from('lab_reports')
    .select('id, report_no, public_token, order_id, business_id')
    .eq('id', reportId)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!rep) return json({ error: 'not found' }, 404)

  // As the caller: lab_order_detail filters to the caller's own lab (0169), and
  // the service role has no caller, so it would see nothing.
  const { data: ord } = await who.asCaller
    .from('lab_order_detail')
    .select('patient_name, patient_phone')
    .eq('id', rep.order_id)
    .maybeSingle()
  const { data: biz } = await who.asService
    .from('businesses').select('name').eq('id', rep.business_id).maybeSingle()

  const target = {
    phone: String(ord?.patient_phone ?? '').replace(/[^0-9]/g, ''),
    patientName: String(ord?.patient_name ?? 'Patient'),
    clinicName: String(biz?.name ?? 'your lab'),
    link: `${site}/lab/${rep.public_token}`,
    campaignEnv: 'AISENSY_LAB_REPORT_CAMPAIGN',
    email,
    documentKind: 'lab_report',
    documentLabel: `Lab report ${rep.report_no ?? ''}`.trim(),
  }

  const result = await sendDocumentLink(target)

  await who.asService.from('lab_reports').update({
    sent_at: result.sent.length ? new Date().toISOString() : null,
    sent_channels: result.sent,
    send_error: result.errors.length ? result.errors.join(' | ').slice(0, 500) : null,
  }).eq('id', rep.id)

  await logDelivery(who.asService, target, result)

  return json({
    ok: result.sent.length > 0,
    whatsapp: result.sent.includes('whatsapp'),
    email: result.sent.includes('email'),
    errors: result.errors.length ? result.errors : undefined,
  })
})
