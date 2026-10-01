// whatsapp-inbound — AiSensy's project webhook: every message a person sends
// the bot is saved as a contact (0186), booking or not.
//
// AiSensy (Manage → Webhooks) POSTs each event here. For a message FROM a
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
// Auth: ?key=<WA_INBOUND_SECRET> in the URL (AiSensy cannot add headers).
// Deploy with --no-verify-jwt.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WA_INBOUND_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

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

function extract(p: Any): { phone: string | null; name: string | null; text: string | null; id: string | null; outbound: boolean; why?: string } {
  // Meta Cloud API shape.
  const v = p?.entry?.[0]?.changes?.[0]?.value
  if (v) {
    const m = v.messages?.[0]
    if (!m) return { phone: null, name: null, text: null, id: null, outbound: true, why: 'status or non-message event' }
    return {
      phone: asPhone(m.from), name: v.contacts?.[0]?.profile?.name ?? null,
      text: m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null,
      id: m.id ?? null, outbound: false,
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  // AiSensy checks the URL with a GET when it is saved.
  if (req.method === 'GET') return json({ ok: true })
  const secret = Deno.env.get('WA_INBOUND_SECRET')
  if (!secret || new URL(req.url).searchParams.get('key') !== secret) return json({ error: 'unauthorised' }, 401)

  let payload: Any
  try { payload = await req.json() } catch { return json({ ok: true, note: 'not json' }) }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
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
  await log(!error, error ? `handle_inbound: ${error.message}` : `saved${e.name ? ` (${e.name})` : ''}${optedIn ? ' · opted in to tips' : ''}`)
  return json({ ok: true, saved: !error, optedIn })
})
