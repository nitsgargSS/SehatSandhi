// Who is asking, for functions a logged-in clinic calls from the browser.
//
// The document senders were written service-role-only, copying invoice-send.
// That was wrong for these: an invoice goes out from a cron job, but a
// prescription goes out because a doctor pressed a button, and the browser has
// only the anon key. The check could never pass from the place it is called.
//
// So: the caller's own session token, and RLS is the permission. Reading the
// row through a client bound to that token proves ownership — if the clinic
// does not own it, the select returns nothing and the send never happens. No
// second ownership rule to write, and none to forget to update.
//
// Service-role still works, for server-side resends and for cron.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface Caller {
  /** RLS applies as the caller. Use this to READ the thing being acted on. */
  // deno-lint-ignore no-explicit-any
  asCaller: any
  /** Bypasses RLS. Use for writes the caller has no policy for, like the log. */
  // deno-lint-ignore no-explicit-any
  asService: any
  isServiceRole: boolean
}

/**
 * Returns null when there is no Authorization header at all — the caller
 * decides whether that is a 401.
 *
 * Note this accepts any signed-in user's token; it does NOT by itself mean they
 * may touch the record. That is what reading through `asCaller` establishes.
 */
export function caller(req: Request): Caller | null {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

  const header = req.headers.get('Authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null

  const token = header.slice(7).trim()
  if (!token) return null

  const asService = createClient(url, serviceKey)
  if (token === serviceKey) {
    return { asCaller: asService, asService, isServiceRole: true }
  }

  // The anon key is a valid Bearer token as far as PostgREST is concerned, but
  // it authenticates nobody. Letting it through would mean anyone with the
  // website bundle could send any document whose id they could guess.
  if (token === anonKey) return null

  const asCaller = createClient(url, anonKey || serviceKey, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return { asCaller, asService, isServiceRole: false }
}
