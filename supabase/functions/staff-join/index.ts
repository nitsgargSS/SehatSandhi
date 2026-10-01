// staff-join — a new staff member sets up their login from the invite link.
//
// The clinic adds them; they are sent /join/<token> (_shared/staffInvite.ts).
// This function backs that page:
//
//   { op: 'check',  token }            → who they are, where they work, whether
//                                        there is still a login to set up
//   { op: 'accept', token, password }  → creates the login (if missing), sets
//                                        the password, links their records;
//                                        the page then signs in with it
//
// The token is the proof, as a password-reset link is. It only ever sets the
// password of a login that has never signed in, so once they are in it is spent.
//
// Deploy with --no-verify-jwt: the caller has no session yet.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAFF_INVITE_SECRET (optional)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { ensureLoginFor, linkRowsFor } from '../_shared/loginAccount.ts'
import { emailMatches, hasUsedLogin, readJoinToken } from '../_shared/staffInvite.ts'

const ROLE_LABEL: Record<string, string> = {
  doctor: 'Doctor', owner: 'Owner', nurse: 'Nurse', receptionist: 'Reception', manager: 'Manager', pharmacist: 'Pharmacist', delivery: 'Delivery', driver: 'Driver',
}

// Mirrors src/lib/credentials.ts checkPassword, so an API call cannot skip the form's rules.
function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.'
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
    return 'Use a lower-case letter, an upper-case letter, a number and a special character.'
  }
  if (pw.length > 72) return 'Keep it under 72 characters.'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const t = await readJoinToken(String(body.token ?? ''))
  if ('error' in t) {
    return json({ error: t.error === 'expired'
      ? 'This link has expired. Ask your clinic to send the invitation again.'
      : 'This link is not valid. Open it exactly as it was sent, or ask your clinic to send it again.' }, 400)
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: p } = await db.from('practitioners').select('id, full_name, email').eq('id', t.practitionerId).maybeSingle()
  const email = String(p?.email ?? '').trim().toLowerCase()
  if (!p || !(await emailMatches(t.digest, email))) {
    return json({ error: 'This link is no longer valid — your details at the clinic have changed. Ask them to send the invitation again.' }, 400)
  }

  // Where they work now. Removed from everywhere → nothing to join.
  const { data: affs } = await db.from('business_practitioners')
    .select('role, status, businesses(name)').eq('practitioner_id', p.id).neq('status', 'suspended')
  const clinics = ((affs ?? []) as unknown as { role: string; businesses: { name: string } | null }[])
    .map(a => ({ clinic: a.businesses?.name ?? 'Clinic', role: ROLE_LABEL[a.role] ?? a.role }))
  if (!clinics.length) return json({ error: 'You are no longer on the staff of any clinic, so there is nothing to set up.' }, 400)

  const alreadySetUp = await hasUsedLogin(db, email)

  if (body.op === 'check') {
    return json({ name: p.full_name, email, clinics, alreadySetUp })
  }

  if (body.op !== 'accept') return json({ error: 'Unknown op.' }, 400)
  if (alreadySetUp) {
    return json({ error: 'Your login is already set up. Sign in with your email and password — or use "Forgot your password?" on the login page.', alreadySetUp: true }, 409)
  }
  const password = String(body.password ?? '')
  const problem = passwordProblem(password)
  if (problem) return json({ error: problem }, 400)

  const uid = await ensureLoginFor(db, email)
  if (!uid) return json({ error: 'Could not create your login. Try again in a minute.' }, 500)
  const { error: uErr } = await db.auth.admin.updateUserById(uid, { password, email_confirm: true })
  if (uErr) return json({ error: `Could not set the password: ${uErr.message}` }, 400)
  await linkRowsFor(db, email, uid)

  return json({ ok: true, email })
})
