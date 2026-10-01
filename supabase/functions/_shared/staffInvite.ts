// The link a new staff member uses to set up their login — no codes.
//
// When a clinic adds someone, they are sent (email, and WhatsApp once the
// AiSensy campaign is set) a link to /join/<token>. Opening it and choosing a
// password creates their login and signs them in (staff-join). Nobody waits on
// a code: not the owner adding them, not the person being added.
//
// THE TOKEN is signed, not stored: base64url(practitioner id . expiry . email
// digest) + HMAC-SHA256. So there is no table and no migration, and:
//   • it dies after LINK_DAYS;
//   • it dies if their email is changed (the digest no longer matches);
//   • it sets a password only for a login that has never signed in — after the
//     first sign-in it is spent, and a forwarded or leaked link is useless
//     (staff-join checks last_sign_in_at). That is what makes single use hold
//     without storing anything.
//
// Env: STAFF_INVITE_SECRET (optional; falls back to the service-role key),
//      SITE_URL, AISENSY_API_KEY + AISENSY_STAFF_INVITE_CAMPAIGN for WhatsApp.
//      The campaign's template takes three params: {{1}} name, {{2}} clinic,
//      {{3}} link.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { esc, layout, sendEmail } from './email.ts'

export const LINK_DAYS = 7

const enc = new TextEncoder()
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function key(): Promise<CryptoKey> {
  const secret = Deno.env.get('STAFF_INVITE_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!secret) throw new Error('no signing secret')
  return crypto.subtle.importKey('raw', enc.encode(`staff-invite:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function emailDigest(email: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(email.trim().toLowerCase()))
  return b64url(new Uint8Array(h).slice(0, 12))
}

export async function joinToken(practitionerId: string, email: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + LINK_DAYS * 86400
  const body = `${practitionerId}.${exp}.${await emailDigest(email)}`
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)))
  return `${b64url(enc.encode(body))}.${b64url(sig)}`
}

/** The practitioner a valid, unexpired token names — checked against their email now. */
export async function readJoinToken(
  token: string,
): Promise<{ practitionerId: string; digest: string } | { error: 'invalid' | 'expired' }> {
  try {
    const [b, s] = String(token ?? '').split('.')
    if (!b || !s) return { error: 'invalid' }
    const body = new TextDecoder().decode(fromB64url(b))
    const ok = await crypto.subtle.verify('HMAC', await key(), fromB64url(s), enc.encode(body))
    if (!ok) return { error: 'invalid' }
    const [practitionerId, exp, digest] = body.split('.')
    if (!practitionerId || !digest) return { error: 'invalid' }
    if (Number(exp) * 1000 < Date.now()) return { error: 'expired' }
    return { practitionerId, digest }
  } catch {
    return { error: 'invalid' }
  }
}

export const emailMatches = async (digest: string, email: string | null | undefined) =>
  !!email && digest === await emailDigest(email)

/** Has this address a login that has been used? Then there is nothing to set up. */
export async function hasUsedLogin(db: SupabaseClient, email: string): Promise<boolean> {
  const { data: uid } = await db.rpc('sehat_auth_uid_for_email', { p_email: email.trim().toLowerCase() })
  if (!uid) return false
  const { data } = await db.auth.admin.getUserById(uid as string)
  return !!data?.user?.last_sign_in_at
}

const ROLE_WORD: Record<string, string> = {
  doctor: 'a doctor', owner: 'an owner', nurse: 'a nurse', receptionist: 'reception', manager: 'a manager',
  pharmacist: 'a pharmacist', delivery: 'delivery staff', driver: 'a driver',
}

export interface InviteSent {
  /** Where the login is set up — or the plain login page for someone already set up. */
  link: string
  /** False when they have signed in before: the link is just the login page. */
  setUp: boolean
  name: string
  clinic: string
  email: 'sent' | 'no address' | string
  whatsapp: 'sent' | 'not configured' | 'no number' | string
  /** Digits with country code, for a wa.me share from the dashboard. */
  phone: string | null
}

/**
 * Tell someone they are on a clinic's staff and how to get in. Never throws.
 * Someone who has already signed in somewhere gets the login page instead of a
 * set-up link: they have a password.
 */
export async function sendStaffInvite(
  db: SupabaseClient, businessId: string, practitionerId: string,
  opts: { send?: boolean } = {},
): Promise<InviteSent> {
  const send = opts.send !== false
  const site = (Deno.env.get('SITE_URL') ?? 'https://sehatsandhi.com').replace(/\/$/, '')
  const [{ data: p }, { data: b }, { data: aff }] = await Promise.all([
    db.from('practitioners').select('full_name, email, phone').eq('id', practitionerId).maybeSingle(),
    db.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    db.from('business_practitioners').select('role').eq('business_id', businessId).eq('practitioner_id', practitionerId).maybeSingle(),
  ])
  const email = String(p?.email ?? '').trim().toLowerCase()
  const digits = String(p?.phone ?? '').replace(/\D/g, '')
  const phone = digits.length === 10 ? `91${digits}` : digits.length === 12 && digits.startsWith('91') ? digits : null
  const name = p?.full_name ?? 'there'
  const clinic = b?.name ?? 'Your clinic'
  const role = String(aff?.role ?? 'doctor')
  const isDoctor = role === 'doctor' || role === 'owner'

  const setUp = email.includes('@') && !(await hasUsedLogin(db, email))
  const link = setUp ? `${site}/join/${await joinToken(practitionerId, email)}` : `${site}/business/login`

  let emailRes: InviteSent['email'] = email.includes('@') ? 'not sent' : 'no address'
  if (send && email.includes('@')) {
    const action = setUp ? 'Set up your login' : 'Sign in'
    const steps = [
      setUp
        ? `Open the link below and choose a password. That is all — you are signed in straight away. The link works for ${LINK_DAYS} days.`
        : `Sign in with <b>${esc(email)}</b> and your password, as usual. ${esc(clinic)} appears in your dashboard.`,
      `Next time, sign in at <a href="${site}/business/login" style="color:#0f6b4a">${site.replace(/^https?:\/\//, '')}/business/login</a> with <b>${esc(email)}</b> and your password.`,
      ...(isDoctor ? ['Open <b>My practice → Public profile</b> and add your photo, qualification and a few lines about you — patients see this page.'] : []),
    ]
    const title = `${clinic} has added you on Sehatsandhi`
    const r = await sendEmail({
      to: email, toName: name,
      subject: `${title} — ${setUp ? 'set up your login' : 'sign in'}`,
      html: layout(title, `
<p style="margin:0 0 14px">Hello ${esc(name)}, <b>${esc(clinic)}</b> has added you as ${ROLE_WORD[role] ?? 'staff'} on Sehatsandhi.</p>
<p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#0f6b4a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">${action}</a></p>
<ol style="margin:0 0 16px;padding-left:20px">${steps.map(x => `<li style="margin-bottom:8px">${x}</li>`).join('')}</ol>
<p style="margin:0;color:#5b6b63;font-size:13px">If you do not work at ${esc(clinic)}, ignore this email — nothing happens unless you open the link.</p>`),
      text: [title, '', `${action}: ${link}`, '', ...steps.map((x, i) => `${i + 1}. ${x.replace(/<[^>]+>/g, '')}`)].join('\n'),
    })
    emailRes = r.ok ? 'sent' : r.error
  }

  let wa: InviteSent['whatsapp'] = 'not configured'
  const apiKey = Deno.env.get('AISENSY_API_KEY')
  const campaign = Deno.env.get('AISENSY_STAFF_INVITE_CAMPAIGN')
  if (!phone) wa = 'no number'
  else if (!send) wa = 'not sent'
  else if (apiKey && campaign) {
    try {
      const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, campaignName: campaign, destination: phone, userName: name, templateParams: [name, clinic, link] }),
      })
      wa = res.ok ? 'sent' : `whatsapp ${res.status}: ${(await res.text()).slice(0, 150)}`
    } catch (e) {
      wa = `whatsapp: ${String((e as Error).message ?? e)}`
    }
  }

  return { link, setUp, name, clinic, email: emailRes, whatsapp: wa, phone }
}
