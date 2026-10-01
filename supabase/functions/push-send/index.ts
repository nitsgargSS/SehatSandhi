// push-send — deliver push_outbox (0185) through Expo's push service.
//
// Called by the database the moment something is queued (sehat_kick_push, via
// pg_net) and by the drain-push-outbox job every minute while anything is left.
// Claims pending rows, sends one message per registered phone of the recipient,
// and marks each row sent / failed. A phone Expo reports as DeviceNotRegistered
// (app uninstalled, or signed out) is switched off so it is not tried again.
//
// Request: {} — service-role auth required.  Response: { ok, sent, failed, skipped }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPO_ACCESS_TOKEN (optional —
//      only if "enhanced security for push" is switched on in the Expo account)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const BATCH = 50
const MAX_ATTEMPTS = 5

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if ((req.headers.get('Authorization') ?? '') !== `Bearer ${serviceKey}`) return json({ error: 'unauthorised' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  // A run that died mid-send leaves rows at 'sending'; put them back after 5 minutes.
  await db.from('push_outbox').update({ status: 'pending' })
    .eq('status', 'sending').lte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())

  const { data: rows, error } = await db.from('push_outbox')
    .select('id, user_id, title, body, data, attempts')
    .eq('status', 'pending').order('created_at').limit(BATCH)
  if (error) return json({ error: error.message }, 500)

  let sent = 0, failed = 0, skipped = 0
  for (const r of rows ?? []) {
    const { data: claimed } = await db.from('push_outbox')
      .update({ status: 'sending', attempts: r.attempts + 1 }).eq('id', r.id).eq('status', 'pending').select('id')
    if (!claimed?.length) continue
    const finish = (patch: Record<string, unknown>) => db.from('push_outbox').update(patch).eq('id', r.id)

    const { data: devices } = await db.from('push_devices').select('id, token').eq('user_id', r.user_id).eq('enabled', true)
    if (!devices?.length) { await finish({ status: 'skipped', last_error: 'no phone registered' }); skipped++; continue }

    const messages = devices.map(d => ({
      to: d.token, title: r.title, body: r.body, data: r.data ?? {},
      sound: 'default', priority: 'high', channelId: 'default',
    }))
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
      const tok = Deno.env.get('EXPO_ACCESS_TOKEN')
      if (tok) headers.Authorization = `Bearer ${tok}`
      const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: JSON.stringify(messages) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`Expo ${res.status}: ${JSON.stringify(body).slice(0, 200)}`)
      const tickets = (body?.data ?? []) as { status: string; message?: string; details?: { error?: string } }[]
      let anyOk = false
      const errs: string[] = []
      tickets.forEach((t, i) => {
        if (t.status === 'ok') { anyOk = true; return }
        errs.push(t.details?.error ?? t.message ?? 'error')
        if (t.details?.error === 'DeviceNotRegistered') {
          db.from('push_devices').update({ enabled: false }).eq('id', devices[i].id).then(() => undefined)
        }
      })
      if (anyOk) { await finish({ status: 'sent', sent_at: new Date().toISOString(), last_error: errs.join('; ') || null }); sent++ }
      else { await finish({ status: 'failed', last_error: errs.join('; ') || 'no ticket' }); failed++ }
    } catch (e) {
      const giveUp = r.attempts + 1 >= MAX_ATTEMPTS
      await finish({ status: giveUp ? 'failed' : 'pending', last_error: String((e as Error).message ?? e) })
      failed++
    }
  }
  return json({ ok: true, sent, failed, skipped })
})
