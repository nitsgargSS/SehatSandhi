// prescription-send — give the patient their prescription, as a link.
//
// The sending itself lives in _shared/deliver.ts, which discharge-send uses
// too. What is left here is the part that is actually about prescriptions:
// who may ask, which one, and refusing to send a cancelled one.
//
// Request:  { prescriptionId, email? }   — signed-in clinic user, or service-role
// Response: { ok, whatsapp, email }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
//      AISENSY_API_KEY, AISENSY_PRESCRIPTION_CAMPAIGN
//      MSG91_AUTHKEY, MSG91_EMAIL_TEMPLATE_ID, MSG91_EMAIL_FROM, MSG91_EMAIL_DOMAIN

import { corsHeaders, json } from '../_shared/cors.ts'
import { sendDocumentLink, logDelivery } from '../_shared/deliver.ts'
import { caller } from '../_shared/caller.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // A signed-in clinic user, or service-role. The prescription is then read
  // through their own token, so RLS decides whether it is theirs to send.
  const who = caller(req)
  if (!who) return json({ error: 'unauthorised' }, 401)

  let prescriptionId = ''
  let email: string | null = null
  try {
    const body = await req.json()
    prescriptionId = typeof body.prescriptionId === 'string' ? body.prescriptionId : ''
    email = typeof body.email === 'string' && body.email.includes('@') ? body.email : null
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (!prescriptionId) return json({ error: 'prescriptionId required' }, 400)

  // Read as the caller. A prescription belonging to another clinic simply is
  // not visible, so this 404s — which is also the right thing to tell them.
  const { data: rx, error } = await who.asCaller
    .from('prescriptions')
    .select('id, prescription_no, public_token, patient_name, patient_phone, clinic_name, issued_at, status')
    .eq('id', prescriptionId)
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!rx) return json({ error: 'not found' }, 404)
  // A cancelled prescription must not be sent to anybody. If it went out before
  // it was cancelled that is done, but nothing re-sends it afterwards.
  if (rx.status === 'cancelled') return json({ error: 'this prescription was cancelled' }, 409)

  const site = (Deno.env.get('SITE_URL') ?? 'https://sehatsandhi.com').replace(/\/$/, '')

  const target = {
    phone: String(rx.patient_phone ?? '').replace(/[^0-9]/g, ''),
    patientName: String(rx.patient_name ?? 'Patient'),
    clinicName: String(rx.clinic_name ?? 'your clinic'),
    link: `${site}/rx/${rx.public_token}`,
    campaignEnv: 'AISENSY_PRESCRIPTION_CAMPAIGN',
    email,
    documentKind: 'prescription',
    documentLabel: `Prescription ${rx.prescription_no ?? ''}`.trim(),
  }

  const result = await sendDocumentLink(target)

  await who.asService.from('prescriptions').update({
    sent_at: result.sent.length ? new Date().toISOString() : null,
    sent_channels: result.sent,
    send_error: result.errors.length ? result.errors.join(' | ').slice(0, 500) : null,
  }).eq('id', rx.id)

  await logDelivery(who.asService, target, result)

  return json({
    ok: result.sent.length > 0,
    whatsapp: result.sent.includes('whatsapp'),
    email: result.sent.includes('email'),
    errors: result.errors.length ? result.errors : undefined,
  })
})
