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
//       → create the login user, and nothing more. Linking it to the doctor's
//         records waits until the code has been entered (link-my-login):
//         asking for a code proves nothing.
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
import { ensureLoginFor } from '../_shared/loginAccount.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let email = ''
  try {
    const body = await req.json()
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  } catch { return json({ error: 'invalid JSON' }, 400) }
  const same = json({ ok: true })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  await ensureLoginFor(db, email)
  return same
})
