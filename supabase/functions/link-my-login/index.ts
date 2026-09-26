// link-my-login — after signing in, claim the records registered to my email.
//
// A doctor's rows find them through practitioners.auth_uid, which registration
// cannot set: it runs before the person has a login. Called by the sign-in form
// and by registration once the address is proven — a code entered, or a
// password on an address that was verified when it was set.
//
// Only the caller's own, verified address; only rows nobody has claimed yet
// (_shared/loginAccount.ts). Request: {}   Response: { ok }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { linkRowsFor } from '../_shared/loginAccount.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const who = caller(req)
  if (!who || who.isServiceRole) return json({ error: 'Please sign in.' }, 401)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user }, error } = await who.asService.auth.getUser(token)
  if (error || !user) return json({ error: 'Please sign in.' }, 401)
  if (!user.email || !user.email_confirmed_at) return json({ ok: true, linked: false })

  await linkRowsFor(who.asService, user.email, user.id)
  return json({ ok: true, linked: true })
})
