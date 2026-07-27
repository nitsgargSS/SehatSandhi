// appointment-notify — drain the notification outbox.
//
// Whenever an appointment is cancelled, rescheduled or marked no-show, a trigger
// queues a row saying who needs telling. This sends those: WhatsApp first via
// AISensy, and SMS via MSG91 only if WhatsApp fails. That ordering is the point —
// WhatsApp is free and is where these conversations already live, but a patient
// who never opens it must still learn their appointment moved.
//
// Called right after a change for immediacy, and on a schedule as a safety net.
// Draining twice is harmless: rows are claimed before sending.
//
// Request:  {}  or  { appointmentId }   — service-role auth required
// Response: { processed, sent, failed }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      AISENSY_API_KEY, AISENSY_APPOINTMENT_CAMPAIGN
//      MSG91_AUTHKEY, MSG91_SENDER_ID, MSG91_APPOINTMENT_DLT_TEMPLATE

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const IST = 'Asia/Kolkata'
const fmtSlot = (iso: string | null) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

// Kept short and unambiguous: these are read on a phone, often in a hurry.
function messageFor(recipient: string, event: string, p: Record<string, unknown>): string {
  const doctor = String(p.doctor_name ?? 'the clinic')
  const patient = String(p.patient_name ?? 'A patient')
  const oldSlot = fmtSlot(p.old_slot as string)
  const newSlot = fmtSlot(p.new_slot as string)
  const reason = p.reason ? ` Reason: ${p.reason}.` : ''

  if (recipient === 'patient') {
    switch (event) {
      case 'cancelled':
        return `Your appointment with ${doctor} on ${oldSlot} has been cancelled.${reason} Reply to this message to book another time.`
      case 'rescheduled':
        return `Your appointment with ${doctor} has moved from ${oldSlot} to ${newSlot}. Please come at the new time.`
      case 'confirmed':
        return `Your appointment with ${doctor} on ${newSlot} is confirmed. See you then.`
      default:
        return `Update on your appointment with ${doctor} on ${newSlot}.`
    }
  }
  switch (event) {
    case 'cancelled':
      return `${patient} cancelled their ${oldSlot} appointment.${reason} The slot is now free.`
    case 'rescheduled':
      return `${patient} moved their appointment from ${oldSlot} to ${newSlot}.`
    default:
      return `${patient}'s appointment on ${newSlot} was updated.`
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.includes(serviceKey)) return json({ error: 'unauthorised' }, 401)

  let appointmentId: string | null = null
  try {
    const body = await req.json()
    appointmentId = typeof body.appointmentId === 'string' ? body.appointmentId : null
  } catch { /* an empty body means "drain everything pending" */ }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  let q = supabase.from('notification_outbox')
    .select('*').eq('status', 'pending').order('created_at').limit(50)
  if (appointmentId) q = q.eq('appointment_id', appointmentId)
  const { data: rows, error } = await q
  if (error) return json({ error: error.message }, 500)

  const aisensyKey = Deno.env.get('AISENSY_API_KEY')
  const aisensyCampaign = Deno.env.get('AISENSY_APPOINTMENT_CAMPAIGN')
  const msg91Key = Deno.env.get('MSG91_AUTHKEY')
  const msg91Sender = Deno.env.get('MSG91_SENDER_ID')
  const msg91Template = Deno.env.get('MSG91_APPOINTMENT_DLT_TEMPLATE')

  let sent = 0, failed = 0

  for (const r of (rows ?? []) as Record<string, unknown>[]) {
    const id = String(r.id)
    const phone = String(r.phone ?? '').replace(/[^0-9]/g, '')
    const event = String(r.event)
    const recipient = String(r.recipient)
    const payload = (r.payload ?? {}) as Record<string, unknown>
    const text = messageFor(recipient, event, payload)

    if (!phone) {
      await supabase.from('notification_outbox')
        .update({ status: 'failed', last_error: 'no phone number', attempts: Number(r.attempts ?? 0) + 1 })
        .eq('id', id)
      failed++
      continue
    }

    // Claim before sending, so an overlapping drain cannot send the same message
    // twice. A crash mid-send loses one message rather than spamming a patient.
    const { data: claimed } = await supabase.from('notification_outbox')
      .update({ attempts: Number(r.attempts ?? 0) + 1, status: 'sending' })
      .eq('id', id).eq('status', 'pending').select('id').maybeSingle()
    if (!claimed) continue

    let ok = false, channel = '', lastError = ''

    // 1. WhatsApp
    if (aisensyKey && aisensyCampaign) {
      try {
        const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: aisensyKey,
            campaignName: aisensyCampaign,
            destination: phone,
            userName: String(payload.patient_name ?? 'Patient'),
            templateParams: [text],
          }),
        })
        if (res.ok) { ok = true; channel = 'whatsapp' }
        else lastError = `whatsapp ${res.status}: ${(await res.text()).slice(0, 150)}`
      } catch (e) {
        lastError = `whatsapp: ${String((e as Error).message ?? e)}`
      }
    } else {
      lastError = 'AISENSY env not set'
    }

    // 2. SMS, only because WhatsApp did not get through
    if (!ok && msg91Key && msg91Sender && msg91Template) {
      try {
        const res = await fetch('https://control.msg91.com/api/v5/flow/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', authkey: msg91Key },
          body: JSON.stringify({
            template_id: msg91Template,
            sender: msg91Sender,
            recipients: [{ mobiles: phone, MESSAGE: text }],
          }),
        })
        if (res.ok) { ok = true; channel = 'sms' }
        else lastError += ` | sms ${res.status}: ${(await res.text()).slice(0, 150)}`
      } catch (e) {
        lastError += ` | sms: ${String((e as Error).message ?? e)}`
      }
    }

    await supabase.from('notification_outbox').update({
      status: ok ? 'sent' : 'failed',
      sent_channel: ok ? channel : null,
      sent_at: ok ? new Date().toISOString() : null,
      last_error: ok ? null : lastError.slice(0, 500),
    }).eq('id', id)

    // Same log the invoice and campaign sends use, so all outbound traffic to a
    // patient is visible in one place.
    await supabase.from('message_log').insert({
      phone,
      channel: ok ? channel : 'whatsapp',
      provider: channel === 'sms' ? 'msg91' : 'aisensy',
      campaign: `appointment_${event}`,
      body_preview: text.slice(0, 160),
      status: ok ? 'sent' : 'failed',
      error_detail: ok ? null : lastError.slice(0, 500),
      sent_at: ok ? new Date().toISOString() : null,
    })

    ok ? sent++ : failed++
  }

  return json({ processed: (rows ?? []).length, sent, failed })
})
