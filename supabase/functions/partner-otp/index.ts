// partner-otp — a Care Partner signs in with a code sent to their WhatsApp
// (Partner Program, 0331).
//
//   { action: 'request', phone }        → sends a 6-digit code on WhatsApp
//   { action: 'verify',  phone, code }  → { tokenHash } the browser exchanges for a session
//
// Like patient-otp it takes ANY Indian mobile — registration (sehat_care_register)
// is where eligibility is checked. The login is its own: codes live in
// care_partner_login_codes (never in login_codes, which the clinic and patient
// logins share), and the synthetic address 91XXXXXXXXXX@partner.sehatsandhi.in
// matches no business, practitioner, patient or admin, so it can never reach
// their data. sehat_care_my_phone() reads the number back from that address.
//
// Refused while site_settings 'partner_program_enabled' is off.
//
// Deploy with --no-verify-jwt: the caller is not signed in yet.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//      AISENSY_API_KEY + AISENSY_PARTNER_LOGIN_CAMPAIGN (or AISENSY_LOGIN_CAMPAIGN)
//        — the approved login_code template (the code is its one variable);
//      PARTNER_OTP_ECHO — sandbox only: returns the code when nothing could send it.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { sendTemplate } from '../_shared/whatsapp.ts'

const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_SECONDS = 60
const MAX_CODES_PER_HOUR = 5

function normalisePhone(raw: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9][0-9]{9}$/.test(d) ? `91${d}` : null
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

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

/** WhatsApp, as clinic-otp sends. null = not configured. */
async function sendCode(phone: string, code: string): Promise<boolean | null> {
  const r = await sendTemplate({
    campaignEnv: ['AISENSY_PARTNER_LOGIN_CAMPAIGN', 'AISENSY_LOGIN_CAMPAIGN'],
    to: phone, userName: 'Sehatsandhi', params: [code], otp: true,
  })
  if (r.ok) return true
  if (!r.provider) return null
  // Never log the code — it is a live credential.
  console.error(`partner-otp: ${r.provider} refused: ${r.error}`)
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { action?: string; phone?: string; code?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const phone = normalisePhone(String(body.phone ?? ''))
  if (!phone) return json({ error: 'Enter your 10-digit mobile number.' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: open } = await db.rpc('sehat_partner_program_enabled')
  if (open !== true) return json({ error: 'NOT_OPEN', message: 'The Partner Program is not open yet.' }, 403)

  if (body.action === 'request') {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const { data: recent } = await db.from('care_partner_login_codes').select('created_at')
      .eq('phone', phone).gte('created_at', hourAgo).order('created_at', { ascending: false })
    const rows = (recent ?? []) as { created_at: string }[]
    if (rows.length) {
      const age = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000
      if (age < RESEND_COOLDOWN_SECONDS) return json({ ok: true, retryInSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - age) })
    }
    if (rows.length >= MAX_CODES_PER_HOUR) return json({ error: 'Too many codes asked for. Try again in an hour.' }, 429)

    const code = generateCode()
    await db.from('care_partner_login_codes').insert({
      phone, code_hash: await sha256Hex(code),
      expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    })
    const sent = await sendCode(phone, code)
    if (!sent && Deno.env.get('PARTNER_OTP_ECHO') === 'true') return json({ ok: true, devCode: code, delivered: false })
    if (sent === null) return json({ error: 'DELIVERY_UNAVAILABLE', message: 'Sign-in codes cannot be sent just now. Please use WhatsApp to message us meanwhile.' }, 502)
    if (!sent) return json({ error: 'DELIVERY_FAILED', message: 'We could not send the code to this WhatsApp number. Check it is on WhatsApp and try again.' }, 502)
    return json({ ok: true })
  }

  if (body.action === 'verify') {
    const code = String(body.code ?? '').replace(/\D/g, '')
    if (code.length !== 6) return json({ error: 'Enter the 6-digit code.' }, 400)
    const { data: row } = await db.from('care_partner_login_codes').select('*')
      .eq('phone', phone).is('consumed_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const rec = row as { id: string; code_hash: string; expires_at: string; attempts: number } | null
    if (!rec || new Date(rec.expires_at) < new Date()) return json({ error: 'That code has expired. Ask for a new one.' }, 400)
    if (rec.attempts >= MAX_ATTEMPTS) {
      await db.from('care_partner_login_codes').update({ consumed_at: new Date().toISOString() }).eq('id', rec.id)
      return json({ error: 'Too many wrong tries. Ask for a new code.' }, 429)
    }
    if (!timingSafeEqual(await sha256Hex(code), rec.code_hash)) {
      await db.from('care_partner_login_codes').update({ attempts: rec.attempts + 1 }).eq('id', rec.id)
      return json({ error: 'That code is not right.' }, 400)
    }
    await db.from('care_partner_login_codes').update({ consumed_at: new Date().toISOString() }).eq('id', rec.id)

    // One auth user per partner number. createUser fails harmlessly when it
    // already exists; generateLink then names it.
    const email = `${phone}@partner.sehatsandhi.in`
    const { data: created } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { phone, via: 'partner-otp' } })
    const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email })
    const userId = created?.user?.id ?? link?.user?.id ?? null
    if (linkErr || !userId || !link?.properties?.hashed_token) return json({ error: 'Could not start your session. Please try again.' }, 500)
    return json({ ok: true, tokenHash: link.properties.hashed_token })
  }

  return json({ error: 'unknown action' }, 400)
})
