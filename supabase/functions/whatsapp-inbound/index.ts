// whatsapp-inbound — the WhatsApp webhook: every message a person sends is
// saved as a contact (0186), booking or not, and — when it arrives from Meta
// on a number the bot runs on — answered (0216).
//
// Meta's Cloud API (the app's WhatsApp → Configuration page) or AiSensy
// (Manage → Webhooks) POSTs each event here. For a message FROM a
// person we take the number, their WhatsApp name, the text and the message id,
// and call sehat_wa_handle_inbound (0005): patients + wa_contacts upserted,
// opt-outs respected, consent only through a consenting entry point. Messages
// sent BY the bot or an agent, and delivery/read receipts, are ignored.
//
// The payload shape is read defensively — AiSensy's own fields or Meta's Cloud
// API shape (entry → changes → value → messages / contacts) — and every request
// is logged to wa_inbound_log for 7 days, so the first real message shows
// exactly what arrives.
//
// THE BOT (_shared/bot.ts) answers only a Meta-shaped message that arrived on
// a number listed in WA_BOT_PHONE_IDS, and replies from that same number — so
// a test number can run the new flow while the live number is still answered
// elsewhere. Where the patient is in the conversation lives in wa_bot_sessions.
//
// THE CLINIC LINE (0224): a number listed in WA_CLINIC_PHONE_IDS — by default
// META_CLINIC_PHONE_NUMBER_ID, the number clinics' messages go out from — is
// answered too, as the clinic line: the bot works out which clinic the patient
// means and stays with it. A patient has one conversation per line.
//
// Auth: ?key=<WA_INBOUND_SECRET> in the URL (AiSensy cannot add headers), and
// for Meta also its X-Hub-Signature-256 over the body, checked against
// META_APP_SECRET when that is set. Meta's one-time GET handshake is answered
// when hub.verify_token is WA_INBOUND_SECRET.
// Deploy with --no-verify-jwt.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WA_INBOUND_SECRET
//      META_APP_SECRET, META_ACCESS_TOKEN      — Meta
//      GOOGLE_GEOCODING_KEY                    — optional; a shared location → PIN (_shared/geocode.ts)
//      WA_BOT_PHONE_IDS                        — phone number ids the bot answers on, comma separated
//      WA_CLINIC_PHONE_IDS                     — phone number ids answered as the clinic line; default META_CLINIC_PHONE_NUMBER_ID

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { carry, type Session, step, toMeta } from '../_shared/bot.ts'
import { graphSend } from '../_shared/whatsapp.ts'
import { locate } from '../_shared/geocode.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const PHONE_KEYS = ['phone_number', 'phoneNumber', 'phone', 'wa_id', 'waId', 'from', 'mobile', 'sender', 'destination', 'customer_phone']
const NAME_KEYS = ['userName', 'username', 'user_name', 'profile_name', 'profileName', 'name', 'senderName', 'customer_name', 'fullName']
const TEXT_KEYS = ['text', 'body', 'message_text', 'messageText', 'content', 'message']
const ID_KEYS = ['messageId', 'message_id', 'wamid', 'id']

const digits = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : ''
const asPhone = (v: unknown): string | null => {
  const d = digits(v)
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`
  if (d.length === 12 && d.startsWith('91')) return d
  return null
}

/** First value under any of `keys`, searching the object breadth-first. */
function find(obj: Any, keys: string[], ok: (v: unknown) => boolean, depth = 6): unknown {
  const queue: [Any, number][] = [[obj, 0]]
  while (queue.length) {
    const [o, d] = queue.shift()!
    if (!o || typeof o !== 'object') continue
    for (const k of keys) if (k in o && ok(o[k])) return o[k]
    if (d < depth) for (const v of Object.values(o)) if (v && typeof v === 'object') queue.push([v, d + 1])
  }
  return undefined
}

interface Extracted {
  phone: string | null; name: string | null; text: string | null; id: string | null; outbound: boolean; why?: string
  /** Meta only: the id of a tapped list row or button, and the number written to. */
  replyId?: string | null; toPhoneId?: string | null
  /** Meta only: the id of the message this one answers. */
  replyTo?: string | null
  /** Meta only: a location they shared. */
  location?: { latitude: number; longitude: number } | null
}

function extract(p: Any): Extracted {
  // Meta Cloud API shape.
  const v = p?.entry?.[0]?.changes?.[0]?.value
  if (v) {
    const m = v.messages?.[0]
    if (!m) return { phone: null, name: null, text: null, id: null, outbound: true, why: 'status or non-message event' }
    return {
      phone: asPhone(m.from), name: v.contacts?.[0]?.profile?.name ?? null,
      text: m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null,
      id: m.id ?? null, outbound: false,
      replyId: m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null,
      toPhoneId: v.metadata?.phone_number_id ?? null,
      replyTo: m.context?.id ?? null,
      location: m.type === 'location' && m.location ? { latitude: Number(m.location.latitude), longitude: Number(m.location.longitude) } : null,
    }
  }
  // AiSensy / generic: skip what the business sent, and receipts.
  const topic = String(p?.topic ?? p?.event ?? p?.type ?? '').toLowerCase()
  const sender = String(find(p, ['sender', 'senderType', 'direction', 'from_type', 'source'], x => typeof x === 'string') ?? '').toLowerCase()
  const outbound = /(status|delivered|read|sent|agent|bot|business|outbound)/.test(topic) && !/user|customer|incoming|inbound/.test(topic)
    || /^(agent|bot|business|outbound|system)$/.test(sender)
  const phone = asPhone(find(p, PHONE_KEYS, x => !!asPhone(x)))
  const name = find(p, NAME_KEYS, x => typeof x === 'string' && x.trim().length > 0 && !asPhone(x)) as string | undefined
  const rawText = find(p, TEXT_KEYS, x => typeof x === 'string' || (typeof x === 'object' && x !== null && typeof (x as Any).text === 'string'))
  const text = typeof rawText === 'string' ? rawText : (rawText as Any)?.text ?? null
  const id = find(p, ID_KEYS, x => typeof x === 'string' && x.length > 6) as string | undefined
  return { phone, name: name ?? null, text, id: id ?? null, outbound }
}

/** The opt-in button: "✅ Yes, send me health tips" / "✅ हाँ, हेल्थ टिप्स भेजें" (and close variants). */
export function isOptIn(text: unknown): boolean {
  const t = String(text ?? '').toLowerCase().replace(/[✅✔️☑️]/g, '').trim()
  // \b does not see Devanagari letters, so Hindi is matched on its own.
  const yes = /^(yes|haan|haa|ha)\b/.test(t) || /^(हाँ|हां|जी हाँ|जी हां)/.test(t)
  const tips = /(tips|टिप्स|offers|ऑफ़र|ऑफर)/.test(t)
  return yes && tips && t.length <= 60
}

/** The payload as logged: whole if small, else its first 8,000 characters as text. */
function small(p: Any): Any {
  const s = JSON.stringify(p) ?? 'null'
  return s.length <= 8000 ? p : { truncated: s.slice(0, 8000) }
}

export { extract }

async function hmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const SESSION_IDLE_MS = 3_600_000

/**
 * Answer one message. Returns a note for the inbound log. Never throws: the
 * webhook must still answer 200, or Meta retries and then switches it off.
 */
async function runBot(db: Any, e: Extracted, line: 'main' | 'clinic'): Promise<string> {
  try {
    const phone = e.phone!, from = e.toPhoneId!
    const { data: row } = await db.from('wa_bot_sessions')
      .select('state, vars, last_message_id, updated_at').eq('phone', phone).eq('line', line).maybeSingle()
    if (row && e.id && row.last_message_id === e.id) return 'bot: redelivery, already answered'

    // Blue ticks and "typing…" while the database is asked.
    if (e.id) await graphSend({ status: 'read', message_id: e.id, typing_indicator: { type: 'text' } }, from)

    const fresh = !row || Date.now() - Date.parse(row.updated_at) > SESSION_IDLE_MS
    // A conversation left for an hour starts again, but the area and patient are remembered.
    const session: Session = fresh ? { state: 'idle', vars: carry(row?.vars ?? {}) } : { state: row.state, vars: row.vars ?? {} }
    // A shared location becomes the PIN code (or town) it is in.
    const where = e.location ? await locate(e.location.latitude, e.location.longitude) : undefined
    const located = where === undefined ? undefined : (where?.pin ?? where?.place ?? null)
    const next = await step(session, { text: e.text, replyId: e.replyId ?? null, fresh, line, replyTo: e.replyTo ?? null, ...(located !== undefined ? { located } : {}) }, phone, async (fn, args) => {
      const { data, error } = await db.rpc(fn, args)
      if (error) { console.error(`whatsapp-inbound: ${fn}: ${error.message}`); return null }
      return data
    })

    // Saved before sending, so a redelivery that arrives mid-send is recognised.
    await db.from('wa_bot_sessions').upsert({
      phone, line, state: next.session.state, vars: next.session.vars, last_message_id: e.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'phone,line' })

    const errors: string[] = []
    for (const reply of next.replies) {
      for (const message of toMeta(reply)) {
        const r = await graphSend({ to: phone, ...message }, from)
        if (!r.ok) errors.push(r.error ?? 'not sent')
      }
    }
    // The area a shared location came to — a PIN or town, nothing finer — so a lookup that fails shows.
    const at = located === undefined ? '' : `, location → ${located ?? 'not found'}`
    const who = line === 'clinic' ? `clinic line${next.session.vars.clinic ? ` (${next.session.vars.clinic.code})` : ''}, ` : ''
    return errors.length ? `bot: ${who}${next.session.state}${at}, send failed: ${errors.join(' | ').slice(0, 300)}` : `bot: ${who}${next.session.state}${at}`
  } catch (err) {
    console.error(`whatsapp-inbound: bot: ${String((err as Error).message ?? err)}`)
    return `bot: error: ${String((err as Error).message ?? err).slice(0, 200)}`
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const secret = Deno.env.get('WA_INBOUND_SECRET')
  const url = new URL(req.url)
  if (req.method === 'GET') {
    // Meta's handshake when the webhook is saved: echo the challenge, as text.
    if (url.searchParams.get('hub.mode') === 'subscribe') {
      if (!secret || url.searchParams.get('hub.verify_token') !== secret) return new Response('forbidden', { status: 403 })
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    // AiSensy checks the URL with a GET when it is saved.
    return json({ ok: true })
  }
  if (!secret || url.searchParams.get('key') !== secret) return json({ error: 'unauthorised' }, 401)

  const raw = await req.text()
  let payload: Any
  try { payload = JSON.parse(raw) } catch { return json({ ok: true, note: 'not json' }) }

  // Meta signs the body with the app secret. Only a signed message is answered.
  const signature = req.headers.get('x-hub-signature-256')
  const appSecret = Deno.env.get('META_APP_SECRET')
  let signed = false
  if (signature && appSecret) {
    signed = timingSafeEqual(signature, `sha256=${await hmacHex(appSecret, raw)}`)
    if (!signed) return json({ error: 'bad signature' }, 401)
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // 0219: WhatsApp took a clinic's broadcast message and now says it could not
  // deliver it — the clinic gets that message's price back.
  if (signed) {
    for (const entry of payload?.entry ?? []) for (const change of entry?.changes ?? []) for (const st of change?.value?.statuses ?? []) {
      if (st?.status !== 'failed' || !st?.id) continue
      const why = st.errors?.[0]
      await db.rpc('sehat_wa_delivery_failed', {
        p_wa_message_id: st.id, p_error: why ? `${why.title ?? why.message ?? 'not delivered'}${why.code ? ` (${why.code})` : ''}` : 'not delivered',
      }).then(() => undefined, () => undefined)
    }
  }

  const e = extract(payload)
  const log = (ok: boolean, note: string) =>
    db.from('wa_inbound_log').insert({ phone: e.phone, ok, note, payload: small(payload) })
      .then(() => undefined, () => undefined)

  // Always answer 200 quickly: a webhook that errors gets retried or switched off.
  if (e.outbound) { await log(true, `ignored: ${e.why ?? 'sent by the business / receipt'}`); return json({ ok: true, ignored: true }) }
  if (!e.phone) { await log(false, 'no Indian mobile number found'); return json({ ok: true, ignored: true }) }

  const { error } = await db.rpc('sehat_wa_handle_inbound', {
    p_raw_phone: e.phone, p_profile_name: e.name, p_message_id: e.id,
    p_message_text: e.text ? String(e.text).slice(0, 500) : null, p_entry_code: null, p_referral_source_url: null,
  })
  // 0187: the opt-in button's own text — never a bare "yes" to another question.
  let optedIn = false
  if (!error && isOptIn(e.text)) {
    const { error: oErr } = await db.rpc('sehat_wa_platform_optin', { p_phone: e.phone, p_text: e.text, p_message_id: e.id })
    optedIn = !oErr
  }
  const ids = (v: string | undefined) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const botIds = ids(Deno.env.get('WA_BOT_PHONE_IDS'))
  const clinicIds = ids(Deno.env.get('WA_CLINIC_PHONE_IDS') ?? Deno.env.get('META_CLINIC_PHONE_NUMBER_ID'))
  const line = e.toPhoneId && clinicIds.includes(e.toPhoneId) ? 'clinic' : e.toPhoneId && botIds.includes(e.toPhoneId) ? 'main' : null
  const bot = signed && line ? await runBot(db, e, line) : null
  await log(!error, (error ? `handle_inbound: ${error.message}` : `saved${e.name ? ` (${e.name})` : ''}${optedIn ? ' · opted in to tips' : ''}`)
    + (bot ? ` · ${bot}` : ''))
  return json({ ok: true, saved: !error, optedIn })
})
