// wa-connect — a clinic connects its own WhatsApp number (0261).
//
// The clinic's owner presses "Connect your WhatsApp number" in the WhatsApp
// tab. Meta's Embedded Signup window opens (Facebook Login for Business,
// configuration "Clinic WhatsApp connect"); the clinic picks or creates its
// WhatsApp account, adds and verifies its number, and the window closes,
// handing the browser a one-time code plus the account and number ids. The
// browser posts those here, and this does the rest, so the clinic never has to
// touch Meta again:
//
//   1. the code becomes an access key for the clinic's account (it goes to the
//      Vault, never to the browser);
//   2. the number is checked to belong to that account;
//   3. our app is subscribed to the account's webhooks, pointed at THIS
//      project's whatsapp-inbound — so replies, receipts and template
//      decisions arrive where the clinic lives (sandbox or production);
//   4. the number is registered for sending — not for a number brought over
//      from the WhatsApp Business app ("coexistence"), which already is;
//   5. our templates (_shared/clinicTemplates.ts) are created in the account
//      and their status recorded.
//
// Request (signed-in owner):
//   { businessId, action: 'connect', code, wabaId, phoneNumberId, coexistence? }
//   { businessId, action: 'refresh' }     — read the number and templates again
//   { businessId, action: 'disconnect' }  — back to our number; Meta is unsubscribed
// Response: { ok, message?, account? }
//
// Only on the Pro plan (business_wa_accounts.plan = 'pro').
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      META_APP_ID (default: the Sehatsandhi Bot app), META_APP_SECRET,
//      WA_INBOUND_SECRET — the key whatsapp-inbound checks, used for the
//      per-account callback.

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { CLINIC_TEMPLATES, templateRequest } from '../_shared/clinicTemplates.ts'

const GRAPH = 'https://graph.facebook.com/v25.0'
const APP_ID = Deno.env.get('META_APP_ID') ?? '2239815556798206'

// deno-lint-ignore no-explicit-any
type Any = any

/** One Graph call. Never throws: { ok, body } with Meta's error in words. */
async function graph(path: string, token: string, init?: { method?: string; body?: unknown }) {
  try {
    const res = await fetch(`${GRAPH}/${path}`, {
      method: init?.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    })
    const body = await res.json().catch(() => ({})) as Any
    const err = res.ok ? undefined : `${String(body?.error?.error_user_msg ?? body?.error?.message ?? res.status).slice(0, 200)}${body?.error?.code ? ` (${body.error.code})` : ''}`
    return { ok: res.ok, body, error: err }
  } catch (e) {
    return { ok: false, body: {} as Any, error: String((e as Error).message ?? e) }
  }
}

const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')

/** Read the number's name, quality and limit, and every template in the account. */
async function readBack(db: Any, businessId: string, wabaId: string, phoneNumberId: string, token: string) {
  const ph = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name,name_status,quality_rating,messaging_limit_tier`, token)
  if (ph.ok) {
    await db.from('business_wa_accounts').update({
      whatsapp_number: ph.body.display_phone_number ?? null,
      verified_name: ph.body.verified_name ?? null,
      name_status: ph.body.name_status ?? null,
      quality_rating: ph.body.quality_rating ?? null,
      messaging_limit: ph.body.messaging_limit_tier ?? null,
      own_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('business_id', businessId)
  }
  const tl = await graph(`${wabaId}/message_templates?fields=id,name,language,status,category,rejected_reason&limit=200`, token)
  if (tl.ok) {
    const ours = new Set(CLINIC_TEMPLATES.map(t => `${t.name}:${t.language}`))
    const rows = ((tl.body.data ?? []) as Any[])
      .filter(t => ours.has(`${t.name}:${t.language}`))
      .map(t => ({
        business_id: businessId, name: t.name, language: t.language, category: t.category ?? null,
        status: String(t.status ?? 'PENDING').toUpperCase(), meta_id: t.id ?? null,
        reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
        updated_at: new Date().toISOString(),
      }))
    if (rows.length) await db.from('wa_clinic_templates').upsert(rows, { onConflict: 'business_id,name,language' })
  }
  return { phone: ph, templates: tl }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Any
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  // 0262: Pro's automatic messages from OUR number need their templates in our
  // own WhatsApp account too. An admin (or the service role) creates the ones
  // missing there; { dryRun: true } only looks.
  if (body.action === 'house-templates') return await houseTemplates(req, body)

  const businessId = typeof body.businessId === 'string' ? body.businessId : ''
  const action = ['connect', 'refresh', 'disconnect'].includes(body.action) ? body.action : ''
  if (!businessId || !action) return json({ error: 'businessId and action required' }, 400)

  const who = caller(req)
  if (!who) return json({ error: 'Please sign in.' }, 401)
  const db = who.asService
  let userId: string | null = null
  if (!who.isServiceRole) {
    const { data: role, error } = await who.asCaller.rpc('sehat_caller_role', { p_business: businessId })
    if (error) return json({ error: error.message }, 500)
    if (role !== 'owner') return json({ ok: false, message: 'Only the clinic’s owner can connect a WhatsApp number.' }, 403)
    // Who pressed it, for the record — the gateway has checked the token's signature.
    try {
      const jwt = (req.headers.get('Authorization') ?? '').slice(7).split('.')[1] ?? ''
      userId = JSON.parse(atob(jwt.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null
    } catch { userId = null }
  }

  const { data: acct } = await db.from('business_wa_accounts')
    .select('plan, waba_id, phone_number_id, own_status, coexistence').eq('business_id', businessId).maybeSingle()
  if (!acct || acct.plan !== 'pro') {
    return json({ ok: false, message: 'Your own WhatsApp number comes with the WhatsApp Pro plan.' }, 403)
  }

  const fail = async (message: string) => {
    await db.from('business_wa_accounts').update({ own_error: message.slice(0, 300), updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
    return json({ ok: false, message })
  }

  // ── Back to our number ──
  if (action === 'disconnect') {
    const { data: key } = await db.rpc('sehat_wa_own_sender', { p_business: businessId })
    if (key?.token && acct.waba_id) await graph(`${acct.waba_id}/subscribed_apps`, key.token, { method: 'DELETE' })
    await db.rpc('sehat_wa_own_token_drop', { p_business: businessId })
    await db.from('business_wa_accounts').update({
      own_status: 'disconnected', own_error: null, updated_at: new Date().toISOString(),
    }).eq('business_id', businessId)
    return json({ ok: true, message: 'Disconnected. Messages go from the Sehatsandhi number again.' })
  }

  // ── Look again ──
  if (action === 'refresh') {
    if (acct.own_status !== 'connected' || !acct.waba_id || !acct.phone_number_id) return json({ ok: false, message: 'No number is connected.' })
    const { data: key } = await db.rpc('sehat_wa_own_sender', { p_business: businessId })
    if (!key?.token) return json({ ok: false, message: 'The connection has lapsed. Please connect the number again.' })
    // Templates Meta has not got yet (a new one of ours, or one deleted in Meta) are created now.
    await createTemplates(db, businessId, acct.waba_id, key.token)
    const r = await readBack(db, businessId, acct.waba_id, acct.phone_number_id, key.token)
    return json({ ok: r.phone.ok, message: r.phone.ok ? 'Up to date.' : `Meta did not answer: ${r.phone.error}` })
  }

  // ── Connect ──
  const code = typeof body.code === 'string' ? body.code : ''
  const wabaId = typeof body.wabaId === 'string' ? body.wabaId.replace(/\D/g, '') : ''
  const phoneNumberId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId.replace(/\D/g, '') : ''
  const coexistence = body.coexistence === true
  if (!code || !wabaId || !phoneNumberId) return json({ ok: false, message: 'Meta did not finish the sign-up. Please try again.' }, 400)

  const secret = Deno.env.get('META_APP_SECRET')
  const inbound = Deno.env.get('WA_INBOUND_SECRET')
  if (!secret || !inbound) return fail('Connecting numbers is not switched on yet. Sehatsandhi has been told.')

  // 1. The code becomes the clinic's access key.
  let token = ''
  try {
    const res = await fetch(`${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}`)
    const tb = await res.json().catch(() => ({})) as Any
    token = typeof tb?.access_token === 'string' ? tb.access_token : ''
    if (!token) return fail(`Meta did not accept the sign-up: ${String(tb?.error?.message ?? res.status).slice(0, 150)}`)
  } catch (e) {
    return fail(`Meta could not be reached: ${String((e as Error).message ?? e)}`)
  }

  // 2. The number is in that account.
  const nums = await graph(`${wabaId}/phone_numbers?fields=id,display_phone_number`, token)
  if (!nums.ok) return fail(`Meta did not show the WhatsApp account: ${nums.error}`)
  if (!((nums.body.data ?? []) as Any[]).some(n => String(n.id) === phoneNumberId)) {
    return fail('That number is not in the WhatsApp account that was shared. Please connect again.')
  }

  // Another clinic's number cannot be taken over.
  const { data: taken } = await db.from('business_wa_accounts').select('business_id')
    .eq('phone_number_id', phoneNumberId).eq('own_status', 'connected').neq('business_id', businessId).maybeSingle()
  if (taken) return fail('This number is already connected to another clinic on Sehatsandhi.')

  // 3. Webhooks, to this project.
  const callback = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-inbound?key=${encodeURIComponent(inbound)}`
  const sub = await graph(`${wabaId}/subscribed_apps`, token, { method: 'POST', body: { override_callback_uri: callback, verify_token: inbound } })
  if (!sub.ok) return fail(`Meta would not send this number's messages to Sehatsandhi: ${sub.error}`)

  // 4. Registered for sending — a coexistence number already is.
  const notes: string[] = []
  if (!coexistence) {
    const reg = await graph(`${phoneNumberId}/register`, token, { method: 'POST', body: { messaging_product: 'whatsapp', pin: sixDigits() } })
    if (!reg.ok) notes.push(`Registering the number: ${reg.error}`)
  }

  await db.rpc('sehat_wa_own_token_set', { p_business: businessId, p_token: token })
  const { error: upErr } = await db.from('business_wa_accounts').update({
    waba_id: wabaId, phone_number_id: phoneNumberId, coexistence,
    own_status: 'connected', own_error: notes.length ? notes.join(' | ').slice(0, 300) : null,
    connected_at: new Date().toISOString(), connected_by: userId, updated_at: new Date().toISOString(),
  }).eq('business_id', businessId)
  if (upErr) return fail(`Could not save the connection: ${upErr.message}`)

  // 5. Our templates in their account.
  await createTemplates(db, businessId, wabaId, token)
  await readBack(db, businessId, wabaId, phoneNumberId, token)

  return json({
    ok: true,
    message: notes.length
      ? `Connected, with a warning: ${notes.join(' ')}`
      : 'Connected. Meta is reviewing the message templates; that usually takes minutes to a few hours.',
  })
})

/** Create every template of ours the account does not have yet. Existing ones are left alone. */
async function createTemplates(db: Any, businessId: string, wabaId: string, token: string) {
  const have = await graph(`${wabaId}/message_templates?fields=name,language&limit=200`, token)
  const exists = new Set(((have.body?.data ?? []) as Any[]).map(t => `${t.name}:${t.language}`))
  for (const t of CLINIC_TEMPLATES) {
    if (exists.has(`${t.name}:${t.language}`)) continue
    const r = await graph(`${wabaId}/message_templates`, token, { method: 'POST', body: templateRequest(t) })
    await db.from('wa_clinic_templates').upsert({
      business_id: businessId, name: t.name, language: t.language, category: t.category,
      status: r.ok ? String(r.body?.status ?? 'PENDING').toUpperCase() : 'NOT_CREATED',
      meta_id: r.body?.id ?? null, reason: r.ok ? null : r.error ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: 'business_id,name,language' })
  }
}

/**
 * What our own account needs for clinics' messages from our number: Pro's
 * automatic messages (0262), and the document links, which our account was
 * found without on 26 Oct 2026. appointment_update and rating_request are
 * left out: ours have their own approved wording.
 */
const HOUSE_NAMES = new Set(['welcome_patient', 'visit_summary', 'follow_up_reminder',
  'prescription_link', 'bill_link', 'lab_report_link', 'discharge_link'])

async function houseTemplates(req: Request, body: Any) {
  const who = caller(req)
  if (!who) return json({ error: 'Please sign in.' }, 401)
  if (!who.isServiceRole) {
    const { data: admin } = await who.asCaller.rpc('sehat_is_admin')
    if (admin !== true) return json({ error: 'Admins only.' }, 403)
  }
  const token = Deno.env.get('META_ACCESS_TOKEN')
  if (!token) return json({ ok: false, message: 'META_ACCESS_TOKEN is not set.' })
  const phoneId = Deno.env.get('META_CLINIC_PHONE_NUMBER_ID') || Deno.env.get('META_PHONE_NUMBER_ID') || ''

  // Which account is the number clinics' messages go from in? Given, or found
  // among the accounts the Sehatsandhi business owns.
  let wabaId = typeof body.wabaId === 'string' ? body.wabaId.replace(/\D/g, '') : ''
  const seen: { id: string; name?: string; numbers: string[] }[] = []
  if (!wabaId) {
    const biz = Deno.env.get('META_BUSINESS_ID') ?? '866620354123683'
    const owned = await graph(`${biz}/owned_whatsapp_business_accounts?fields=id,name&limit=50`, token)
    if (!owned.ok) return json({ ok: false, message: `Could not list our WhatsApp accounts: ${owned.error}` })
    for (const w of (owned.body.data ?? []) as Any[]) {
      const nums = await graph(`${w.id}/phone_numbers?fields=id,display_phone_number`, token)
      const list = ((nums.body?.data ?? []) as Any[])
      seen.push({ id: String(w.id), name: w.name, numbers: list.map(n => `${n.display_phone_number} (${n.id})`) })
      if (list.some(n => String(n.id) === phoneId)) wabaId = String(w.id)
    }
    if (!wabaId) return json({ ok: false, message: `No account of ours holds the sending number ${phoneId || '(not set)'}.`, accounts: seen })
  }

  const nums = await graph(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, token)
  const numbers = ((nums.body?.data ?? []) as Any[]).map(n => `${n.display_phone_number} ${n.verified_name ?? ''} (${n.id})${String(n.id) === phoneId ? ' ← sends clinics\' messages' : ''}`)
  const have = await graph(`${wabaId}/message_templates?fields=name,language,status,category,rejected_reason&limit=200`, token)
  if (!have.ok) return json({ ok: false, numbers, message: `Could not read templates in ${wabaId}: ${have.error}` })
  const existing = (have.body.data ?? []) as Any[]
  const created: { name: string; ok: boolean; error?: string }[] = []
  if (!body.dryRun) {
    for (const t of CLINIC_TEMPLATES.filter(x => HOUSE_NAMES.has(x.name))) {
      if (existing.some(e => e.name === t.name && e.language === t.language)) continue
      const r = await graph(`${wabaId}/message_templates`, token, { method: 'POST', body: templateRequest(t) })
      created.push({ name: t.name, ok: r.ok, error: r.error })
    }
  }
  const after = body.dryRun ? have : await graph(`${wabaId}/message_templates?fields=name,language,status,category,rejected_reason&limit=200`, token)
  return json({
    ok: true, wabaId, phoneId, numbers, accounts: seen, dryRun: !!body.dryRun, created,
    templates: ((after.body?.data ?? []) as Any[]).map(t => ({ name: t.name, language: t.language, status: t.status, category: t.category,
      reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : undefined })),
  })
}
