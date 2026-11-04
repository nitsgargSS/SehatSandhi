// intl-alerts — sends Sehatsandhi International's WhatsApp alerts (0323).
//
// The intl_alerts queue is filled by a trigger on intl_enquiries: a new
// request queues a message to each team number; a status change queues one to
// the patient. Every 2 minutes (cron 'intl-alerts') this sends what is due,
// from Sehatsandhi's main number (+91 70153 99355) with the house templates
// (_shared/intlTemplates.ts). A failure is retried up to 6 times over about a
// day — so messages wait while Meta reviews a new template — then marked failed.
// Emails for the same events go through email_outbox / email-send.
//
// Service role only (the cron). POST {} → { sent, failed, retrying }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { isServiceAuth } from '../_shared/serviceKey.ts'
import { sendTemplate } from '../_shared/whatsapp.ts'

const BACKOFF_MIN = [5, 15, 60, 180, 480, 720]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!isServiceAuth(req.headers.get('Authorization'))) return json({ error: 'unauthorised' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const site = (Deno.env.get('SITE_URL') ?? 'https://www.sehatsandhi.com').replace(/\/$/, '')
  const admin = `${site}/${Deno.env.get('ADMIN_PATH') ?? 'ng-ctrl-2026'}`

  const { data: due, error } = await db.from('intl_alerts').select('*')
    .eq('state', 'pending').lte('next_try_at', new Date().toISOString()).order('created_at').limit(40)
  if (error) return json({ error: error.message }, 500)

  let sent = 0, failed = 0, retrying = 0
  for (const a of due ?? []) {
    const { data: e } = await db.from('intl_enquiries').select('name, country, token, procedure_code, status').eq('id', a.enquiry_id).maybeSingle()
    if (!e) { await db.from('intl_alerts').update({ state: 'skipped', error: 'request removed' }).eq('id', a.id); continue }
    let params: string[], campaign: string
    if (a.kind === 'team_new') {
      const { data: p } = e.procedure_code ? await db.from('intl_procedures').select('name').eq('code', e.procedure_code).maybeSingle() : { data: null }
      campaign = 'AISENSY_INTL_TEAM_CAMPAIGN'
      params = [e.name, e.country || 'country not given', p?.name || 'help, treatment not chosen', admin]
    } else {
      // A later change makes an older pending update out of date.
      if (a.status_at && a.status_at !== e.status) { await db.from('intl_alerts').update({ state: 'skipped', error: 'status changed again' }).eq('id', a.id); continue }
      const { data: text } = await db.rpc('sehat_intl_status_text', { p_status: a.status_at })
      campaign = 'AISENSY_INTL_UPDATE_CAMPAIGN'
      params = [String(e.name).split(' ')[0], String(text ?? ''), `${site}/international/track/${e.token}`]
    }
    // From the main number (+91 70153 99355): the templates are in its
    // messaging account (WABA 1461510652560252), and it is the number patients
    // already know. Not fromClinic — that number is in another account.
    const r = await sendTemplate({ campaignEnv: campaign, to: a.to_phone, userName: e.name, params, source: 'intl-alerts' })
    if (r.ok) { await db.from('intl_alerts').update({ state: 'sent', sent_at: new Date().toISOString(), error: null, attempts: a.attempts + 1 }).eq('id', a.id); sent++; continue }
    const attempts = a.attempts + 1
    if (r.unreachable || attempts >= BACKOFF_MIN.length) {
      await db.from('intl_alerts').update({ state: 'failed', attempts, error: (r.error ?? 'failed').slice(0, 300) }).eq('id', a.id); failed++
    } else {
      await db.from('intl_alerts').update({ attempts, error: (r.error ?? 'failed').slice(0, 300),
        next_try_at: new Date(Date.now() + BACKOFF_MIN[attempts - 1] * 60_000).toISOString() }).eq('id', a.id); retrying++
    }
  }
  return json({ sent, failed, retrying })
})
