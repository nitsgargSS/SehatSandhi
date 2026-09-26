// email-login-prepare — make sure a registered address has a login to send a
// code to (0128).
//
// Called by the sign-in form just before it asks Supabase for an email code.
// Registration records the address a business and each of its doctors sign in
// with, but creates no login user; Supabase will only send a code to an
// existing user (the form says shouldCreateUser: false, so a login box cannot
// sign strangers up). So:
//
//   address registered to a business or practitioner, no login yet
//       → create the login user (confirmed: the code they are about to enter
//         is the proof that they hold the address)
//   and in every case where it is registered
//       → link it: practitioners.auth_uid (how a doctor's rows find them) and
//         businesses.auth_uid, where either is still empty
//
// The answer is the same whether or not the address is registered, so this
// cannot be used to find out who is on Sehatsandhi.
//
// Request: { email }   Response: { ok: true }
// Deploy with --no-verify-jwt: the caller is logging in and has no session.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let email = ''
  try {
    const body = await req.json()
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  } catch { return json({ error: 'invalid JSON' }, 400) }
  const same = json({ ok: true })
  if (!EMAIL.test(email) || email.length > 254) return same

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const [{ data: biz }, { data: docs }] = await Promise.all([
    db.from('businesses').select('id, email, auth_uid').ilike('email', email),
    db.from('practitioners').select('id, email, auth_uid').ilike('email', email),
  ])
  // ilike is the case-insensitive match, but '_' in an address is a wildcard to
  // it, so keep only the exact ones.
  type Row = { id: string; email: string | null; auth_uid: string | null }
  const exact = (r: Row) => (r.email ?? '').trim().toLowerCase() === email
  const businesses = ((biz ?? []) as Row[]).filter(exact)
  const people = ((docs ?? []) as Row[]).filter(exact)
  if (!businesses.length && !people.length) return same

  let uid: string | null = null
  const { data: found } = await db.rpc('sehat_auth_uid_for_email', { p_email: email })
  uid = (found as string | null) ?? null
  if (!uid) {
    const { data: made, error } = await db.auth.admin.createUser({ email, email_confirm: true })
    if (error) {
      // Raced with another request, most likely; look again.
      const { data: again } = await db.rpc('sehat_auth_uid_for_email', { p_email: email })
      uid = (again as string | null) ?? null
    } else {
      uid = made.user?.id ?? null
    }
  }
  if (!uid) return same

  const bIds = businesses.filter(b => !b.auth_uid).map(b => b.id)
  const pIds = people.filter(p => !p.auth_uid).map(p => p.id)
  if (bIds.length) await db.from('businesses').update({ auth_uid: uid }).in('id', bIds).is('auth_uid', null)
  if (pIds.length) await db.from('practitioners').update({ auth_uid: uid }).in('id', pIds).is('auth_uid', null)

  return same
})
