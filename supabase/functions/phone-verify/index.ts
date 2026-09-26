// phone-verify — confirm a business's WhatsApp number with a code, at signup.
//
// Step 2 of registration verifies the email first (which signs the browser in),
// then, when this is switched on, the WhatsApp number. The code goes out on
// the approved login_code template through AiSensy's login campaign — the
// same one clinic-otp uses.
//
// SWITCHED OFF until WhatsApp sending works (0130). `status` answers
// { enabled: false } unless PHONE_VERIFY_ENABLED=true AND the AiSensy login
// campaign is configured; the wizard then skips the step and admin confirms the
// number by calling it.
//
// Actions (signed-in, email-verified caller):
//   { action: 'status' }                 → { enabled }
//   { action: 'send', phone }            → { ok } — one code a minute, five an hour
//   { action: 'verify', phone, code }    → { ok, verified }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      PHONE_VERIFY_ENABLED, AISENSY_API_KEY, AISENSY_LOGIN_CAMPAIGN

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'

const CODE_TTL_MIN = 10
const MAX_GUESSES = 5
const COOLDOWN_S = 60
const PER_HOUR = 5

const enabled = () =>
  Deno.env.get('PHONE_VERIFY_ENABLED') === 'true'
  && !!Deno.env.get('AISENSY_API_KEY') && !!Deno.env.get('AISENSY_LOGIN_CAMPAIGN')

/** Ten digits, 6–9 first — sehat_norm_phone's shape. */
function tenDigits(raw: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : null
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function code6(): string {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(a[0] % 1_000_000).padStart(6, '0')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { action?: string; phone?: string; code?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  if (body.action === 'status') return json({ enabled: enabled() })
  if (!enabled()) return json({ error: 'Phone verification is not switched on yet.' }, 409)

  const who = caller(req)
  if (!who || who.isServiceRole) return json({ error: 'Verify your email first.' }, 401)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await who.asService.auth.getUser(token)
  if (!user?.email_confirmed_at) return json({ error: 'Verify your email first.' }, 401)
  const db = who.asService

  const phone = tenDigits(String(body.phone ?? ''))
  if (!phone) return json({ error: 'Enter a 10-digit mobile number.' }, 400)

  if (body.action === 'send') {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { data: recent } = await db.from('phone_verifications')
      .select('created_at').eq('auth_uid', user.id).gte('created_at', hourAgo)
      .order('created_at', { ascending: false })
    const rows = (recent ?? []) as { created_at: string }[]
    if (rows.length >= PER_HOUR) return json({ error: 'Too many codes. Please try again in an hour.' }, 429)
    if (rows[0] && Date.now() - Date.parse(rows[0].created_at) < COOLDOWN_S * 1000) {
      return json({ error: 'Please wait a minute before asking for another code.' }, 429)
    }

    const code = code6()
    const { error: iErr } = await db.from('phone_verifications').insert({
      auth_uid: user.id, phone, code_hash: await sha256Hex(`${phone}:${code}`),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    })
    if (iErr) return json({ error: iErr.message }, 500)

    // templateParams is positional: the login_code template takes the code as
    // its only variable. Never log the code.
    const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: Deno.env.get('AISENSY_API_KEY'), campaignName: Deno.env.get('AISENSY_LOGIN_CAMPAIGN'),
        destination: `91${phone}`, userName: 'Sehatsandhi', source: 'signup-phone-verify',
        templateParams: [code],
      }),
    }).catch(() => null)
    if (!res?.ok) {
      console.error(`phone-verify: aisensy ${res?.status ?? 'unreachable'}: ${(await res?.text().catch(() => '') ?? '').slice(0, 200)}`)
      return json({ error: 'We could not send a WhatsApp code to that number. Is it on WhatsApp?' }, 502)
    }
    return json({ ok: true })
  }

  if (body.action === 'verify') {
    const code = String(body.code ?? '').replace(/\D/g, '')
    const { data: row } = await db.from('phone_verifications')
      .select('id, code_hash, expires_at, attempts, verified_at')
      .eq('auth_uid', user.id).eq('phone', phone)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!row) return json({ error: 'Ask for a code first.' }, 400)
    if (row.verified_at) return json({ ok: true, verified: true })
    if (Date.parse(row.expires_at) < Date.now() || row.attempts >= MAX_GUESSES) {
      return json({ error: 'That code has expired. Ask for another.' }, 400)
    }
    await db.from('phone_verifications').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    if (code.length !== 6 || (await sha256Hex(`${phone}:${code}`)) !== row.code_hash) {
      return json({ error: 'That code is not right.' }, 400)
    }
    await db.from('phone_verifications').update({ verified_at: new Date().toISOString() }).eq('id', row.id)
    return json({ ok: true, verified: true })
  }

  return json({ error: 'unknown action' }, 400)
})
