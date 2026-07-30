// clinic-otp — log a business in with a code sent to its WhatsApp number.
//
// The business wizard collects a phone number and no password, so this is the
// only way an owner reaches the dashboard where their reports, roster, GSTIN and
// appointments live.
//
// Two actions on one function so they cannot drift apart:
//   { action: 'request', phone }         → sends a code, always answers the same
//   { action: 'verify',  phone, code }   → returns a Supabase session
//
// Deploy with --no-verify-jwt: the caller is by definition not logged in yet.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      META_PHONE_NUMBER_ID, META_ACCESS_TOKEN                   (optional)
//      META_TEMPLATE_NAME, META_TEMPLATE_LANG                    (optional)
//      AISENSY_API_KEY, AISENSY_LOGIN_CAMPAIGN                   (optional)
//      CLINIC_OTP_ECHO — sandbox only; returns the code in the response so the
//                        flow can be tested before any provider is wired up.
//
// WhatsApp only, by design: the number is collected at signup as a WhatsApp
// number and that is the one channel we know reaches this audience. There is no
// SMS fallback — a business whose number is not on WhatsApp cannot log in, so
// that case gets its own message rather than a silent failure.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_SECONDS = 60

/** Digits only, with country code. Matches what the wizard stores. */
function normalisePhone(raw: string): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`
  return null
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Six digits, from the CSPRNG. Math.random is not acceptable for a credential. */
function generateCode(): string {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 1_000_000).padStart(6, '0')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/**
 * `sent` is whether a provider accepted the message. `unreachable` means the
 * number is not on WhatsApp — a permanent failure, distinct from "nothing is
 * configured", because retrying will never help and the caller must say so.
 */
type SendResult = { sent: boolean; unreachable?: boolean }

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Meta WhatsApp Cloud API, called directly — no BSP in the path for login codes.
 *
 * Authentication-category templates carry Meta's own fixed copy; we supply only
 * the code. It goes in the BODY *and* in the button: the copy-code button reads
 * its own parameter, and a template sent without it arrives with a button that
 * does nothing.
 */
async function sendViaMeta(phone: string, code: string): Promise<SendResult | null> {
  const phoneId = Deno.env.get('META_PHONE_NUMBER_ID')
  const token = Deno.env.get('META_ACCESS_TOKEN')
  if (!phoneId || !token) return null   // not configured — let the caller fall through

  let res: Response
  try {
    res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,                       // digits only, no '+' — normalisePhone's shape
        type: 'template',
        template: {
          name: Deno.env.get('META_TEMPLATE_NAME') ?? 'login_code',
          language: { code: Deno.env.get('META_TEMPLATE_LANG') ?? 'en' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            {
              type: 'button',
              // 'url' even though the button is COPY_CODE. Meta rejects the
              // send outright if this says 'copy_code'.
              sub_type: 'url',
              index: 0,
              parameters: [{ type: 'text', text: code }],
            },
          ],
        },
      }),
    })
  } catch {
    return { sent: false }
  }

  if (res.ok) return { sent: true }

  const body = await res.json().catch(() => ({})) as { error?: { code?: number } }
  const metaCode = body?.error?.code
  // 131026: cannot deliver — most often the number has no WhatsApp account.
  // 131047: outside the allowed window for a non-template send.
  if (metaCode === 131026 || metaCode === 131047) return { sent: false, unreachable: true }
  return { sent: false }
}

/**
 * WhatsApp delivery: Meta directly, with AISensy behind it.
 *
 * AISensy is kept only because the rest of the platform already sends through it
 * (appointment-notify, invoice-send) and it needs no business verification, so it
 * can carry login while the Meta sender number and template clear approval. Both
 * are WhatsApp — there is no SMS path here.
 */
async function sendCode(phone: string, code: string): Promise<SendResult> {
  const viaMeta = await sendViaMeta(phone, code)
  // A number that is not on WhatsApp will not become reachable via another
  // provider, so stop rather than retrying the same failure through AISensy.
  if (viaMeta?.sent || viaMeta?.unreachable) return viaMeta

  const waKey = Deno.env.get('AISENSY_API_KEY')
  const waCampaign = Deno.env.get('AISENSY_LOGIN_CAMPAIGN')
  if (waKey && waCampaign) {
    try {
      const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: waKey, campaignName: waCampaign, destination: phone,
          userName: 'Sehatsandhi', templateParams: [code],
        }),
      })
      if (res.ok) return { sent: true }
    } catch { /* nothing left to try */ }
  }

  return { sent: false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { action?: string; phone?: string; code?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const phone = normalisePhone(String(body.phone ?? ''))
  if (!phone) return json({ error: 'Enter the 10-digit number you registered with.' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── request ──────────────────────────────────────────────────────────────
  if (body.action === 'request') {
    // Match on the digits, however the number was typed at signup.
    const { data: listings } = await supabase
      .from('doctors').select('id, name, phone').not('phone', 'is', null)
    const match = (listings ?? []).find(d => normalisePhone(String(d.phone)) === phone)

    // Answer identically whether or not the number is registered. Otherwise this
    // endpoint tells anyone which numbers belong to businesses on the platform.
    const sameAnswer = { ok: true, message: 'If that number is registered, a code is on its way.' }

    if (!match) return json(sameAnswer)

    const { data: recent } = await supabase
      .from('login_codes').select('created_at')
      .eq('phone', phone).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (recent) {
      const age = (Date.now() - new Date((recent as { created_at: string }).created_at).getTime()) / 1000
      // Cheap throttle. Without it this is a free SMS cannon pointed at any
      // number we hold, billed to us.
      if (age < RESEND_COOLDOWN_SECONDS) {
        return json({ ...sameAnswer, retryInSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - age) })
      }
    }

    const code = generateCode()
    await supabase.from('login_codes').insert({
      phone,
      code_hash: await sha256Hex(code),
      doctor_id: (match as { id: string }).id,
      expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    })

    const result = await sendCode(phone, code)

    // The one place this endpoint stops answering identically. With no SMS
    // fallback, a number that is not on WhatsApp can never log in, and "a code
    // is on its way" would leave them waiting for something that will never
    // arrive. Saying so does tell a prober that this number is registered —
    // accepted deliberately, and narrowed to numbers that already matched a
    // listing AND that WhatsApp positively rejected.
    if (result.unreachable) {
      return json({ error: 'WHATSAPP_UNREACHABLE' }, 422)
    }

    // Sandbox convenience only, and gated on an env var that production must
    // never carry: returns the code so the flow is testable before Meta or
    // AISensy exist. Guarded again by refusing when a provider IS live.
    const echo = Deno.env.get('CLINIC_OTP_ECHO') === 'true' && !result.sent
    return json(echo ? { ...sameAnswer, devCode: code, delivered: false } : sameAnswer)
  }

  // ── verify ───────────────────────────────────────────────────────────────
  if (body.action === 'verify') {
    const code = String(body.code ?? '').replace(/\D/g, '')
    if (code.length !== 6) return json({ error: 'Enter the 6-digit code.' }, 400)

    const { data: row } = await supabase
      .from('login_codes').select('*')
      .eq('phone', phone).is('consumed_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    const rec = row as {
      id: string; code_hash: string; doctor_id: string | null
      expires_at: string; attempts: number
    } | null

    if (!rec) return json({ error: 'That code has expired. Ask for a new one.' }, 400)
    if (new Date(rec.expires_at) < new Date()) {
      return json({ error: 'That code has expired. Ask for a new one.' }, 400)
    }
    if (rec.attempts >= MAX_ATTEMPTS) {
      // Burn it rather than let guessing continue against a live code.
      await supabase.from('login_codes').update({ consumed_at: new Date().toISOString() }).eq('id', rec.id)
      return json({ error: 'Too many wrong tries. Ask for a new code.' }, 429)
    }

    if (!timingSafeEqual(await sha256Hex(code), rec.code_hash)) {
      await supabase.from('login_codes').update({ attempts: rec.attempts + 1 }).eq('id', rec.id)
      return json({ error: 'That code is not right.' }, 400)
    }

    // Single use, consumed before the session is minted so a replay of the same
    // request cannot produce a second login.
    await supabase.from('login_codes').update({ consumed_at: new Date().toISOString() }).eq('id', rec.id)

    // The auth user's email is internal plumbing — RLS matches on auth_uid now,
    // not on this. It exists because Supabase needs an identifier to hang a
    // session off, and phone auth would require an SMS provider configured at
    // the project level, which is a separate dependency.
    const syntheticEmail = `${phone}@wa.sehatsandhi.in`

    let userId: string | null = null
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: syntheticEmail, email_confirm: true, user_metadata: { phone, via: 'clinic-otp' },
    })
    if (created?.user) userId = created.user.id
    else if (createErr) {
      // Already exists — find them rather than failing a valid login.
      const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
      userId = list?.users?.find(u => u.email === syntheticEmail)?.id ?? null
    }
    if (!userId) return json({ error: 'Could not start your session. Please try again.' }, 500)

    // Link every listing on this number, so one login reaches all of them.
    const { data: all } = await supabase.from('doctors').select('id, phone').not('phone', 'is', null)
    const mine = (all ?? []).filter(d => normalisePhone(String(d.phone)) === phone).map(d => d.id)
    if (mine.length) await supabase.from('doctors').update({ auth_uid: userId }).in('id', mine)

    // A magic-link token the browser exchanges for a real session. Supabase has
    // no "mint a session" admin call; this is the supported way.
    const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink', email: syntheticEmail,
    })
    if (linkErr || !link?.properties?.hashed_token) {
      return json({ error: 'Could not start your session. Please try again.' }, 500)
    }

    return json({
      ok: true,
      tokenHash: link.properties.hashed_token,
      listings: mine.length,
    })
  }

  return json({ error: 'unknown action' }, 400)
})
