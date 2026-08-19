// bill-send — give the patient their bill, as a link.
//
// Sending lives in _shared/deliver.ts, shared with prescription-send and
// discharge-send. What is here is specific to a bill: which one, and refusing
// to send one that was cancelled or superseded.
//
// Superseded matters as much here as on a discharge summary, for a different
// reason. A corrected bill exists because the first one had the wrong money on
// it, and the wrong money is exactly what a patient will pay or an insurer will
// reimburse. So this follows the chain and refuses, naming the replacement.
//
// Request:  { billId, email? }   — signed-in clinic user, or service-role
// Response: { ok, whatsapp, email }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
//      AISENSY_API_KEY, AISENSY_BILL_CAMPAIGN
//      MSG91_AUTHKEY, MSG91_EMAIL_TEMPLATE_ID, MSG91_EMAIL_FROM, MSG91_EMAIL_DOMAIN

import { corsHeaders, json } from '../_shared/cors.ts'
import { sendDocumentLink, logDelivery } from '../_shared/deliver.ts'
import { caller } from '../_shared/caller.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const who = caller(req)
  if (!who) return json({ error: 'unauthorised' }, 401)

  let billId = ''
  let email: string | null = null
  try {
    const body = await req.json()
    billId = typeof body.billId === 'string' ? body.billId : ''
    email = typeof body.email === 'string' && body.email.includes('@') ? body.email : null
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (!billId) return json({ error: 'billId required' }, 400)

  // Read as the caller: another clinic's bill is invisible, so this 404s.
  const { data: bill, error } = await who.asCaller
    .from('patient_bills')
    .select('id, bill_no, public_token, patient_name, patient_phone, clinic_name, status, superseded_by')
    .eq('id', billId)
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!bill) return json({ error: 'not found' }, 404)

  if (bill.status === 'cancelled') {
    return json({ error: 'this bill was cancelled' }, 409)
  }
  if (bill.status === 'superseded' || bill.superseded_by) {
    const { data: newer } = await who.asCaller
      .from('patient_bills')
      .select('bill_no')
      .eq('id', bill.superseded_by)
      .maybeSingle()
    return json({
      error: 'superseded',
      message: `This bill was replaced by ${newer?.bill_no ?? 'a corrected version'}. Send that one instead.`,
      supersededBy: bill.superseded_by,
    }, 409)
  }

  const site = (Deno.env.get('SITE_URL') ?? 'https://sehatsandhi.com').replace(/\/$/, '')

  const target = {
    phone: String(bill.patient_phone ?? '').replace(/[^0-9]/g, ''),
    patientName: String(bill.patient_name ?? 'Patient'),
    clinicName: String(bill.clinic_name ?? 'the clinic'),
    link: `${site}/bill/${bill.public_token}`,
    campaignEnv: 'AISENSY_BILL_CAMPAIGN',
    email,
    documentKind: 'patient_bill',
    documentLabel: `Bill ${bill.bill_no ?? ''}`.trim(),
  }

  const result = await sendDocumentLink(target)

  await who.asService.from('patient_bills').update({
    sent_at: result.sent.length ? new Date().toISOString() : null,
    sent_channels: result.sent,
    send_error: result.errors.length ? result.errors.join(' | ').slice(0, 500) : null,
  }).eq('id', bill.id)

  await logDelivery(who.asService, target, result)

  return json({
    ok: result.sent.length > 0,
    whatsapp: result.sent.includes('whatsapp'),
    email: result.sent.includes('email'),
    errors: result.errors.length ? result.errors : undefined,
  })
})
