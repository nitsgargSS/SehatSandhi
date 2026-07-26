// sandbox-purge — wipe user-generated data from the SANDBOX database.
//
// Deploy this to the sandbox project only. It runs with the service role and
// deletes every row from every table classified `isolated`, so it is treated
// throughout as a loaded gun: three independent guards must all pass, and the
// table list is generated from supabase/tables.config.yaml rather than written
// here, so reference data (pricing, service areas, coupons) is excluded by
// construction rather than by anyone remembering to exclude it.
//
// The guards, weakest to strongest:
//   1. SANDBOX_PURGE_ENABLED must be 'true'. Production never sets it, so even
//      an accidental `functions deploy` against prod leaves this inert.
//   2. A shared token must match SANDBOX_PURGE_TOKEN, compared in constant time.
//   3. The body must carry the literal phrase "PURGE SANDBOX", so no stray
//      fetch or replayed URL can trigger it.
//
// Request:  { token: string, confirm: "PURGE SANDBOX" }
// Response: { ok: true, results: Record<table, string>, authUsersDeleted: number }
//
// Env: SANDBOX_PURGE_ENABLED, SANDBOX_PURGE_TOKEN, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { PURGE_TABLES } from './tables.gen.ts'

/** Constant-time compare, so the token cannot be recovered byte-by-byte via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Generated accounts only. The seeded logins use `sandbox-` (hyphen), so they
// survive a purge and stay usable for testing /doctor/login afterwards. The
// plus-versus-hyphen distinction is load-bearing — see src/lib/sandboxData.ts.
const GENERATED_EMAIL = /^sandbox\+\d+@sehatsandhi\.test$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // ── Guard 1: is purging switched on for this project at all? ──
  if (Deno.env.get('SANDBOX_PURGE_ENABLED') !== 'true') {
    return json({ error: 'purge is disabled on this project' }, 403)
  }

  const expectedToken = Deno.env.get('SANDBOX_PURGE_TOKEN')
  if (!expectedToken) {
    return json({ error: 'SANDBOX_PURGE_TOKEN is not configured' }, 500)
  }

  let body: { token?: string; confirm?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  // ── Guard 2: shared secret ──
  if (typeof body.token !== 'string' || !timingSafeEqual(body.token, expectedToken)) {
    return json({ error: 'forbidden' }, 403)
  }

  // ── Guard 3: explicit confirmation phrase ──
  if (body.confirm !== 'PURGE SANDBOX') {
    return json({ error: 'confirmation required' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const results: Record<string, string> = {}
  let failures = 0

  // Children before parents. A failure is recorded and the walk continues:
  // stopping at the first error would leave the sandbox in a worse state than
  // either finishing or not starting, and the per-table report tells you
  // exactly what still holds rows.
  for (const t of PURGE_TABLES) {
    // PostgREST refuses an unfiltered delete, so match every row via a filter
    // that is always true. `not.is.null` on the primary key does that without
    // needing to know the column's type.
    const { error, count } = await supabase
      .from(t.name)
      .delete({ count: 'exact' })
      .not(t.pk, 'is', null)

    if (error) {
      // A table absent from this project is not a failure: the sandbox may
      // legitimately predate a migration, and the manifest deliberately lists
      // tables that exist only in production until the baseline is captured.
      const missing = /does not exist|schema cache|not find the table/i.test(error.message)
      results[t.name] = missing ? 'skipped (no such table)' : `ERROR: ${error.message}`
      if (!missing) failures++
    } else {
      results[t.name] = `${count ?? 0} rows deleted`
    }
  }

  // ── Auth users created by the /doctor autofill ──
  // Left behind, these accumulate and any row whose email matches a doctors.email
  // would keep satisfying the doctors_read_own RLS policy.
  let authUsersDeleted = 0
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) {
      results['auth.users'] = `ERROR: ${error.message}`
      failures++
    } else {
      for (const u of data.users) {
        if (u.email && GENERATED_EMAIL.test(u.email)) {
          const { error: delErr } = await supabase.auth.admin.deleteUser(u.id)
          if (delErr) failures++
          else authUsersDeleted++
        }
      }
      results['auth.users'] = `${authUsersDeleted} generated account(s) deleted`
    }
  } catch (e) {
    results['auth.users'] = `ERROR: ${(e as Error).message}`
    failures++
  }

  return json({ ok: failures === 0, failures, results, authUsersDeleted })
})
