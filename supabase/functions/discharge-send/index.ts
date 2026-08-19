// discharge-send — give the patient their discharge summary, as a link.
//
// The sending lives in _shared/deliver.ts, shared with prescription-send. What
// is here is the part specific to a discharge: which summary, and refusing to
// send one that was cancelled or has since been superseded.
//
// Superseded matters more here than it does for a prescription. A corrected
// discharge summary exists because the first one said something wrong about a
// patient's care, and re-sending the wrong one is worse than sending nothing.
// So this follows the chain and refuses, naming the replacement.
//
// Request:  { summaryId, email? }   — signed-in clinic user, or service-role
// Response: { ok, whatsapp, email }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
//      AISENSY_API_KEY, AISENSY_DISCHARGE_CAMPAIGN
//      MSG91_AUTHKEY, MSG91_EMAIL_TEMPLATE_ID, MSG91_EMAIL_FROM, MSG91_EMAIL_DOMAIN

import { corsHeaders, json } from '../_shared/cors.ts'
import { sendDocumentLink, logDelivery } from '../_shared/deliver.ts'
import { caller } from '../_shared/caller.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const who = caller(req)
  if (!who) return json({ error: 'unauthorised' }, 401)

  let summaryId = ''
  let email: string | null = null
  try {
    const body = await req.json()
    summaryId = typeof body.summaryId === 'string' ? body.summaryId : ''
    email = typeof body.email === 'string' && body.email.includes('@') ? body.email : null
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (!summaryId) return json({ error: 'summaryId required' }, 400)

  // Read as the caller: another hospital's summary is invisible, so this 404s.
  const { data: ds, error } = await who.asCaller
    .from('discharge_summaries')
    .select('id, summary_no, public_token, patient_name, patient_phone, clinic_name, status, superseded_by')
    .eq('id', summaryId)
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!ds) return json({ error: 'not found' }, 404)

  if (ds.status === 'cancelled') {
    return json({ error: 'this discharge summary was cancelled' }, 409)
  }
  if (ds.status === 'superseded' || ds.superseded_by) {
    const { data: newer } = await who.asCaller
      .from('discharge_summaries')
      .select('summary_no')
      .eq('id', ds.superseded_by)
      .maybeSingle()
    return json({
      error: 'superseded',
      message: `This summary was replaced by ${newer?.summary_no ?? 'a corrected version'}. Send that one instead.`,
      supersededBy: ds.superseded_by,
    }, 409)
  }

  const site = (Deno.env.get('SITE_URL') ?? 'https://sehatsandhi.com').replace(/\/$/, '')

  const target = {
    phone: String(ds.patient_phone ?? '').replace(/[^0-9]/g, ''),
    patientName: String(ds.patient_name ?? 'Patient'),
    clinicName: String(ds.clinic_name ?? 'the hospital'),
    link: `${site}/ds/${ds.public_token}`,
    campaignEnv: 'AISENSY_DISCHARGE_CAMPAIGN',
    email,
    documentKind: 'discharge_summary',
    documentLabel: `Discharge summary ${ds.summary_no ?? ''}`.trim(),
  }

  const result = await sendDocumentLink(target)

  await who.asService.from('discharge_summaries').update({
    sent_at: result.sent.length ? new Date().toISOString() : null,
    sent_channels: result.sent,
    send_error: result.errors.length ? result.errors.join(' | ').slice(0, 500) : null,
  }).eq('id', ds.id)

  await logDelivery(who.asService, target, result)

  return json({
    ok: result.sent.length > 0,
    whatsapp: result.sent.includes('whatsapp'),
    email: result.sent.includes('email'),
    errors: result.errors.length ? result.errors : undefined,
  })
})
