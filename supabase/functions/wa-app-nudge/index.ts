// wa-app-nudge — invite a patient who stopped part-way on WhatsApp to the app.
//
// Called every ten minutes by pg_cron (0250), with the service-role key, and
// only when someone is due: they were in the middle of something, went quiet
// 20 minutes ago, wrote to us within the last 23 hours (so WhatsApp lets us
// write back for free), do not have the app, and have not been invited this
// week. The database decides who (sehat_wa_app_left_due) and what is said
// (sehat_wa_app_pitch, which also marks it sent); this only sends.
//
// Deploy with JWT verification on (the default).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, META_ACCESS_TOKEN,
//      META_PHONE_NUMBER_ID, META_CLINIC_PHONE_NUMBER_ID.

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { graphSend } from '../_shared/whatsapp.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const who = caller(req)
  if (!who?.isServiceRole) return json({ error: 'unauthorised' }, 401)
  const db = who.asService

  const { data: due, error } = await db.rpc('sehat_wa_app_left_due')
  if (error) return json({ error: error.message }, 500)
  let sent = 0, skipped = 0, failed = 0
  for (const d of (due ?? []) as { phone: string; line: string }[]) {
    // The number they were writing to answers.
    const from = d.line === 'clinic'
      ? (Deno.env.get('META_CLINIC_PHONE_NUMBER_ID') ?? Deno.env.get('META_PHONE_NUMBER_ID'))
      : Deno.env.get('META_PHONE_NUMBER_ID')
    if (!from) { skipped++; continue }
    const { data: pitch } = await db.rpc('sehat_wa_app_pitch', { p_phone: d.phone, p_moment: 'left' })
    const text = String((pitch as { text?: string } | null)?.text ?? '')
    if (!text) { skipped++; continue }
    const r = await graphSend({ to: d.phone, type: 'text', text: { body: text, preview_url: false } }, from)
    if (!r.ok) { failed++; console.error(`wa-app-nudge: ${r.error ?? 'not sent'}`); continue }
    sent++
    if (r.id) {
      await db.rpc('sehat_wa_sent', {
        p_wamid: r.id, p_phone: d.phone, p_phone_number_id: from, p_line: d.line, p_kind: 'text',
        p_in_reply_to: null, p_bot_state: 'app_nudge',
      }).then(() => undefined, () => undefined)
    }
  }
  return json({ sent, skipped, failed })
})
