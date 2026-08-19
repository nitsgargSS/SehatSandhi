// prescription-send — give the patient their prescription, as a link.
//
// A LINK, not an attachment. Same reasoning as invoice-send: no PDF library, it
// renders on whatever phone opens it, and — the part that matters more here —
// no second copy of somebody's health data sitting in an inbox or a WhatsApp
// media folder forever. The link expires; a downloaded file never does.
//
// WhatsApp first, email only if an address exists. WhatsApp is where the
// patient already is and where the booking happened; email is the "soft copy"
// a patient asks for when they want it on a computer.
//
// Best-effort per channel, and each is skipped silently when its credentials
// are absent — so this works on day one with neither configured and starts
// sending as they are added. What actually went out is recorded on the
// prescription, so the clinic can see whether the patient was reached.
//
// Request:  { prescriptionId, email? }   — service-role auth required
// Response: { ok, whatsapp, email }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
//      AISENSY_API_KEY, AISENSY_PRESCRIPTION_CAMPAIGN
//      MSG91_AUTHKEY, MSG91_EMAIL_TEMPLATE_ID, MSG91_EMAIL_FROM, MSG91_EMAIL_DOMAIN

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Service-role only. This reads a prescription and messages a patient; the
  // anon key ships in the website bundle and must never be able to trigger it.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.includes(serviceKey)) return json({ error: 'unauthorised' }, 401)

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

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  const { data: rx, error } = await supabase
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
  const link = `${site}/rx/${rx.public_token}`
  const clinic = String(rx.clinic_name ?? 'your clinic')

  const sent: string[] = []
  const errors: string[] = []

  // ── WhatsApp ──
  const aisensyKey = Deno.env.get('AISENSY_API_KEY')
  const campaign = Deno.env.get('AISENSY_PRESCRIPTION_CAMPAIGN')
  const phone = String(rx.patient_phone ?? '').replace(/[^0-9]/g, '')

  if (aisensyKey && campaign && phone) {
    try {
      const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: aisensyKey,
          campaignName: campaign,
          destination: phone,
          userName: String(rx.patient_name ?? 'Patient'),
          templateParams: [String(rx.patient_name ?? 'Patient'), clinic, link],
        }),
      })
      if (res.ok) sent.push('whatsapp')
      else errors.push(`whatsapp ${res.status}: ${(await res.text()).slice(0, 150)}`)
    } catch (e) {
      errors.push(`whatsapp: ${String((e as Error).message ?? e)}`)
    }
  } else if (!phone) {
    errors.push('no phone number on the prescription')
  }

  // ── Email, only when an address was given ──
  const msg91Key = Deno.env.get('MSG91_AUTHKEY')
  const emailTemplate = Deno.env.get('MSG91_EMAIL_TEMPLATE_ID')
  const emailFrom = Deno.env.get('MSG91_EMAIL_FROM')
  const emailDomain = Deno.env.get('MSG91_EMAIL_DOMAIN')

  if (email && msg91Key && emailTemplate && emailFrom && emailDomain) {
    try {
      const res = await fetch('https://control.msg91.com/api/v5/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: msg91Key },
        body: JSON.stringify({
          to: [{ email, name: String(rx.patient_name ?? 'Patient') }],
          from: { email: emailFrom, name: clinic },
          domain: emailDomain,
          template_id: emailTemplate,
          variables: {
            patient_name: String(rx.patient_name ?? 'Patient'),
            clinic_name: clinic,
            prescription_no: String(rx.prescription_no ?? ''),
            link,
          },
        }),
      })
      if (res.ok) sent.push('email')
      else errors.push(`email ${res.status}: ${(await res.text()).slice(0, 150)}`)
    } catch (e) {
      errors.push(`email: ${String((e as Error).message ?? e)}`)
    }
  }

  await supabase.from('prescriptions').update({
    sent_at: sent.length ? new Date().toISOString() : null,
    sent_channels: sent,
    send_error: errors.length ? errors.join(' | ').slice(0, 500) : null,
  }).eq('id', rx.id)

  // The same log the invoice and appointment sends use, so everything that goes
  // out to a patient is visible in one place. The link is deliberately NOT in
  // the preview: message_log is read by staff and an unexpired prescription
  // link in it is a way around the access rules on the record itself.
  await supabase.from('message_log').insert({
    phone: phone || null,
    channel: sent.includes('whatsapp') ? 'whatsapp' : (sent.includes('email') ? 'email' : 'whatsapp'),
    provider: sent.includes('email') && !sent.includes('whatsapp') ? 'msg91' : 'aisensy',
    campaign: 'prescription',
    body_preview: `Prescription ${rx.prescription_no} from ${clinic}`,
    status: sent.length ? 'sent' : 'failed',
    error_detail: errors.length ? errors.join(' | ').slice(0, 500) : null,
    sent_at: sent.length ? new Date().toISOString() : null,
  })

  return json({
    ok: sent.length > 0,
    whatsapp: sent.includes('whatsapp'),
    email: sent.includes('email'),
    errors: errors.length ? errors : undefined,
  })
})
