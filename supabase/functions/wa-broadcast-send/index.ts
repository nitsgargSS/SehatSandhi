// wa-broadcast-send — a clinic's approved WhatsApp broadcast, sent (0219).
//
// Two callers, told apart by who they are:
//
//   pg_cron, every minute, with the service role key   → THE DRAIN
//     Takes broadcasts a reviewer approved ('queued', then 'sending'), sends
//     each waiting patient the template through Meta's Cloud API from the
//     number kept for clinics, and records what WhatsApp said. A message
//     WhatsApp refuses is marked failed; when nobody is left waiting the
//     broadcast is closed and every failed message's price goes back to the
//     clinic's wallet (sehat_finish_wa_broadcast). A message WhatsApp accepts
//     and later cannot deliver is reported to whatsapp-inbound, which gives
//     that one back too.
//
//   a signed-in person, { action: 'test', businessId, templateId, params }
//                    or { action: 'test', broadcastId, phone }                        → A TEST
//     The clinic's owner sends the message to the clinic's own number before
//     sending it to patients (one message's price, back if it does not go); a
//     reviewer at Sehatsandhi sends one to a number they name, free.
//     sehat_wa_test_prepare decides who may, where it goes and what it costs.
//
// One run sends a bounded number of messages and stops; the next minute's run
// carries on. When Meta says we are sending too fast or have reached the
// day's limit, the patient is put back in the queue and the run ends — the
// limit is the account's, so pressing on would only fail everyone after.
//
// Deploy with JWT verification on (the default): both callers carry one.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//      META_ACCESS_TOKEN
//      META_CLINIC_PHONE_NUMBER_ID   the number clinics' messages go from
//                                    (else META_PHONE_NUMBER_ID)

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { graphSend } from '../_shared/whatsapp.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const PER_RUN = 150
const RUN_MS = 45_000

/** Meta refuses a variable with a line break, a tab or a run of spaces. */
const oneLine = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** Too fast, or the day's limit: stop and try again later — not this patient's fault. */
const throttled = (error?: string) => /\((4|80007|130429|131048|131056)\)/.test(error ?? '')

const fromNumber = () => Deno.env.get('META_CLINIC_PHONE_NUMBER_ID') ?? Deno.env.get('META_PHONE_NUMBER_ID')

function templateMessage(to: string, name: string, lang: string, params: unknown[]) {
  return {
    to, type: 'template',
    template: {
      name, language: { code: lang || 'en' },
      components: [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: oneLine(p) })) }],
    },
  }
}

async function drain(db: Any) {
  const from = fromNumber()
  if (!from || !Deno.env.get('META_ACCESS_TOKEN')) return { ok: false, note: 'Meta is not set up: nothing was touched' }

  const started = Date.now()
  let budget = PER_RUN
  const done: Record<string, unknown>[] = []

  const { data: broadcasts, error } = await db.from('wa_broadcasts')
    .select('id, business_id, template_id, params, status')
    .in('status', ['queued', 'sending']).order('created_at').limit(10)
  if (error) return { ok: false, note: error.message }

  for (const b of (broadcasts ?? []) as Any[]) {
    if (budget <= 0 || Date.now() - started > RUN_MS) break
    if (b.status === 'queued') await db.from('wa_broadcasts').update({ status: 'sending' }).eq('id', b.id).eq('status', 'queued')

    const [{ data: tpl }, { data: biz }] = await Promise.all([
      db.from('wa_message_templates').select('code, meta_name, meta_language').eq('id', b.template_id).maybeSingle(),
      db.from('businesses').select('name').eq('id', b.business_id).maybeSingle(),
    ])
    // {{1}} is the clinic's name (0116); the clinic filled {{2}} onwards.
    const params = [biz?.name ?? 'your clinic', ...((b.params ?? []) as string[])]

    const { data: waiting } = await db.from('wa_broadcast_recipients')
      .select('id, phone').eq('broadcast_id', b.id).eq('status', 'queued').limit(budget)
    let sent = 0, failed = 0, stop = false

    for (const r of (waiting ?? []) as Any[]) {
      if (Date.now() - started > RUN_MS) break
      // Claimed first, so an overlapping run cannot send the same patient twice.
      const { data: mine } = await db.from('wa_broadcast_recipients')
        .update({ status: 'sending', claimed_at: new Date().toISOString() })
        .eq('id', r.id).eq('status', 'queued').select('id').maybeSingle()
      if (!mine) continue
      budget--

      const res = tpl
        ? await graphSend(templateMessage(r.phone, tpl.meta_name ?? tpl.code, tpl.meta_language, params), from)
        : { ok: false, error: 'the template no longer exists' }

      if (res.ok) {
        sent++
        await db.from('wa_broadcast_recipients')
          .update({ status: 'sent', sent_at: new Date().toISOString(), wa_message_id: (res as Any).id ?? null, error: null }).eq('id', r.id)
      } else if (throttled(res.error)) {
        await db.from('wa_broadcast_recipients').update({ status: 'queued', claimed_at: null }).eq('id', r.id)
        stop = true
        break
      } else {
        failed++
        await db.from('wa_broadcast_recipients').update({ status: 'failed', error: (res.error ?? 'not sent').slice(0, 300) }).eq('id', r.id)
      }
    }

    const { data: status } = await db.rpc('sehat_finish_wa_broadcast', { p_broadcast: b.id })
    done.push({ broadcast: b.id, sent, failed, status })
    if (stop) { done.push({ note: 'Meta asked us to slow down; the rest waits for the next run' }); break }
  }
  return { ok: true, done }
}

async function test(who: NonNullable<ReturnType<typeof caller>>, body: Any) {
  const from = fromNumber()
  if (!from || !Deno.env.get('META_ACCESS_TOKEN')) return json({ ok: false, message: 'Sending on WhatsApp is not set up yet.' })

  const phone = typeof body.phone === 'string' ? body.phone : null
  // A reviewer tests a broadcast that is waiting; a clinic tests what it is writing.
  const { data: plan, error } = typeof body.broadcastId === 'string'
    ? await who.asCaller.rpc('sehat_wa_test_for_review', { p_broadcast: body.broadcastId, p_phone: phone ?? '' })
    : await who.asCaller.rpc('sehat_wa_test_prepare', {
      p_business: String(body.businessId ?? ''), p_template: String(body.templateId ?? ''),
      p_params: Array.isArray(body.params) ? body.params.map(String) : [], p_phone: phone,
    })
  if (error) return json({ ok: false, message: error.message })

  const res = await graphSend(templateMessage(plan.to, plan.meta_name, plan.meta_language, plan.params ?? []), from)
  if (!res.ok) {
    if (plan.tx) {
      const { error: rErr } = await who.asService.rpc('sehat_wallet_refund_direct', { p_tx: plan.tx })
      if (rErr) console.error(`wa-broadcast-send: refund of test charge ${plan.tx} failed: ${rErr.message}`)
    }
    console.error(`wa-broadcast-send: test not sent: ${res.error}`)
    return json({ ok: false, message: `WhatsApp did not accept the test${plan.tx ? ', so nothing was charged' : ''}. Is the number on WhatsApp?` })
  }
  return json({ ok: true, to: `…${String(plan.to).slice(-4)}`, chargedPaise: Number(plan.charged_paise ?? 0) })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const who = caller(req)
  if (!who) return json({ error: 'unauthorised' }, 401)
  const body = await req.json().catch(() => ({}))

  if (who.isServiceRole) return json(await drain(who.asService))
  if (body?.action === 'test') return test(who, body)
  return json({ error: 'unauthorised' }, 401)
})
