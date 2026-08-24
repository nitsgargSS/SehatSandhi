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

  // ── Is this an actual signed-in person? ──
  //
  // This used to compare the token against SUPABASE_ANON_KEY and reject a
  // match. A smoke test showed the anon key sailing straight through: the
  // comparison only holds when the two values are byte-identical, and they are
  // not reliably the same thing — a project issuing the newer publishable key
  // format sends one shape from the browser while the function's env holds the
  // legacy JWT. Comparing secrets to decide identity was the wrong idea; what
  // matters is what the token CLAIMS.
  //
  // The gateway has already verified the signature before this function ran, so
  // reading the payload is safe. `role` is the claim that separates a real
  // session from the public key: a signed-in user carries 'authenticated' and a
  // subject, the anon key carries 'anon' and no subject at all.
  const claims = readClaims(token)
  if (!claims) return null
  if (claims.role !== 'authenticated' || !claims.sub) return null

  // No `|| serviceKey` fallback. That was the more dangerous half of the old
  // code: with SUPABASE_ANON_KEY unset it would have built the caller's client
  // on the SERVICE ROLE key, and the one thing asCaller must never be is a
  // client that bypasses RLS — every ownership check in every send function is
  // "can this caller see the row". Absent anon key is a misconfiguration, and
  // the right answer to a misconfiguration is to refuse.
  if (!anonKey) return null

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return { asCaller, asService, isServiceRole: false }
}

/**
 * The middle segment of a JWT, decoded. Null for anything that is not a
 * three-part token with a readable JSON payload.
 *
 * Deliberately does NOT verify the signature — the Supabase gateway does that
 * before the function is invoked, and re-implementing verification here would
 * be a second, worse copy of it. This reads claims from a token already
 * established as genuine; it is not a trust boundary of its own.
 */
function readClaims(token: string): { role?: string; sub?: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url → base64, then pad. atob rejects the url-safe alphabet.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}
