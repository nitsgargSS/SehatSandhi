// wa-auto-send — WhatsApp Pro's automatic messages, sent (0262).
//
// pg_cron calls this every two minutes while something is due. The database
// decides everything — what is due, whether it is still wanted, the words —
// in sehat_wa_auto_claim, which has already sent an app notification to
// patients who have the app. What comes back here is for WhatsApp: this turns
// "rx:<token>" / "bill:<token>" / "app" into links, sends the template, and
// reports back.
//
// From the clinic's own number when it has connected one (0261) — the clinic
// pays Meta; otherwise from our number for clinics, not charged to the wallet
// (automatic messages are part of Pro).
//
// Service role only. Request: {}   Response: { claimed, sent, failed }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL,
//      META_ACCESS_TOKEN, META_CLINIC_PHONE_NUMBER_ID, and on our number the
//      template secrets META_WELCOME_TEMPLATE, META_VISIT_SUMMARY_TEMPLATE,
//      META_FOLLOW_UP_TEMPLATE, META_PRESCRIPTION_TEMPLATE, META_BILL_TEMPLATE,
//      META_RATING_TEMPLATE; and for 0289's surgery messages META_SURGERY_REMINDER_TEMPLATE,
//      META_SURGERY_AFTERCARE_TEMPLATE (default names surgery_reminder / surgery_aftercare).

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { canSendTemplate, sendTemplate } from '../_shared/whatsapp.ts'
import { ownSender } from '../_shared/deliver.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const BUDGET_MS = 45_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const who = caller(req)
  if (!who?.isServiceRole) return json({ error: 'unauthorised' }, 401)
  const db = who.asService
  const started = Date.now()

  const site = (Deno.env.get('SITE_URL') ?? 'https://www.sehatsandhi.com').replace(/\/$/, '')
  const { data: appRow } = await db.from('site_settings').select('value').eq('key', 'app_link').maybeSingle()
  const appLink = (appRow?.value ?? '').trim() || site
  const link = (p: string) => p === 'app' ? appLink
    : p.startsWith('rx:') ? `${site}/rx/${p.slice(3)}`
    : p.startsWith('bill:') ? `${site}/bill/${p.slice(5)}` : p

  const { data: autoRows, error } = await db.rpc('sehat_wa_auto_claim', { p_limit: 60 })
  if (error) return json({ error: error.message }, 500)
  // 0289: and the messages before and after a planned surgery — same sending,
  // their own queue (kind 'surgery', reported back to sehat_surgery_msg_done).
  const { data: surgeryRows, error: surgeryError } = await db.rpc('sehat_surgery_msg_claim', { p_limit: 40 })
  if (surgeryError) console.error('surgery claim', surgeryError.message)
  const rows = [...((autoRows ?? []) as Any[]), ...((surgeryRows ?? []) as Any[])]

  const senders = new Map<string, { phoneNumberId: string; token: string } | null>()
  let sent = 0, failed = 0
  for (const m of rows) {
    if (Date.now() - started > BUDGET_MS) {
      // Out of time: back in the queue for the next run.
      await db.rpc(m.kind === 'surgery' ? 'sehat_surgery_msg_done' : 'sehat_wa_auto_done', { p_id: m.id, p_ok: false, p_error: 'not reached this run', p_retry: true })
      continue
    }
    if (!senders.has(m.business_id)) senders.set(m.business_id, await ownSender(db, m.business_id))
    const own = senders.get(m.business_id) ?? undefined
    const params = ((m.params ?? []) as string[]).map(p => link(String(p)))
    const done = (ok: boolean, id?: string, err?: string, retry = false) =>
      db.rpc(m.kind === 'surgery' ? 'sehat_surgery_msg_done' : 'sehat_wa_auto_done',
        { p_id: m.id, p_ok: ok, p_message_id: id ?? null, p_error: err ?? null, p_retry: retry })

    if (!canSendTemplate({ campaignEnv: m.campaign, sender: own })) {
      failed++
      await done(false, undefined, `the ${String(m.campaign).replace(/^AISENSY_|_CAMPAIGN$/g, '').toLowerCase()} template is not set up yet`)
      if (m.ask_id) await db.rpc('sehat_rating_ask_close', { p_ask: m.ask_id, p_sent: false, p_error: 'template not set up' })
      continue
    }

    const r = await sendTemplate({
      campaignEnv: m.campaign, to: m.phone, userName: m.name, params,
      ...(own ? { sender: own } : { fromClinic: true }),
    })
    if (r.ok) {
      sent++
      await done(true, r.id)
      await db.rpc('sehat_wa_clinic_sent', { p_phone: m.phone, p_business: m.business_id, p_message_id: r.id ?? null }).then(() => undefined, () => undefined)
      if (m.rx_id || m.bill_id) await db.rpc('sehat_wa_auto_mark_documents', { p_rx: m.rx_id ?? null, p_bill: m.bill_id ?? null })
      if (m.ask_id) await db.rpc('sehat_rating_ask_close', { p_ask: m.ask_id, p_sent: true, p_message_id: r.id ?? null })
    } else {
      failed++
      // A number not on WhatsApp will not be one on a second try; anything else might.
      await done(false, undefined, r.error ?? 'not sent', !r.unreachable)
      if (m.ask_id) await db.rpc('sehat_rating_ask_close', { p_ask: m.ask_id, p_sent: false, p_error: r.error ?? 'not sent' })
    }
    await db.from('message_log').insert({
      phone: m.phone, channel: 'whatsapp', provider: r.provider ?? 'meta', campaign: `auto_${m.kind}`,
      body_preview: `${m.kind.replace(/_/g, ' ')} from ${m.clinic}`, status: r.ok ? 'sent' : 'failed',
      error_detail: r.ok ? null : (r.error ?? '').slice(0, 500), sent_at: r.ok ? new Date().toISOString() : null,
    }).then(() => undefined, () => undefined)
  }
  return json({ claimed: rows.length, sent, failed })
})
