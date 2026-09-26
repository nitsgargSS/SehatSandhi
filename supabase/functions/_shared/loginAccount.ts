// The login user behind a registered email address (0128).
//
// Registration records the address a business and each doctor sign in with but
// creates no Supabase login for it, and Supabase sends codes only to existing
// logins. Two halves, deliberately separate:
//
//   ensureLoginFor  — before a code is sent. Creates the login for an address
//                     that is registered, and does NOTHING else: whoever asked
//                     has proven nothing yet.
//   linkRowsFor     — after the address is proven (a code entered). Points the
//                     practitioner and business rows with that address at the
//                     login, which is how a doctor's records find them.
//
// Linking before proof would let anyone who can make a login for an address
// (registering with somebody else's email, say) inherit that person's records.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Row = { id: string; email: string | null; auth_uid: string | null }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function registeredRows(db: SupabaseClient, email: string) {
  const [{ data: biz }, { data: docs }] = await Promise.all([
    db.from('businesses').select('id, email, auth_uid').ilike('email', email),
    db.from('practitioners').select('id, email, auth_uid').ilike('email', email),
  ])
  // ilike is the case-insensitive match, but '_' in an address is a wildcard to
  // it, so keep only the exact ones.
  const exact = (r: Row) => (r.email ?? '').trim().toLowerCase() === email
  return {
    businesses: ((biz ?? []) as Row[]).filter(exact),
    people: ((docs ?? []) as Row[]).filter(exact),
  }
}

/** The login for a registered address, created if missing. Null if not registered. */
export async function ensureLoginFor(db: SupabaseClient, rawEmail: string): Promise<string | null> {
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 254) return null
  const { businesses, people } = await registeredRows(db, email)
  if (!businesses.length && !people.length) return null

  const { data: found } = await db.rpc('sehat_auth_uid_for_email', { p_email: email })
  if (found) return found as string
  // Confirmed, so the code that follows signs them in rather than asking them to
  // confirm first; the code is the proof. No password: nobody can use this
  // login without the mailbox.
  const { data: made, error } = await db.auth.admin.createUser({ email, email_confirm: true })
  if (!error) return made.user?.id ?? null
  const { data: again } = await db.rpc('sehat_auth_uid_for_email', { p_email: email })
  return (again as string | null) ?? null
}

/** After proof of the address: link its unclaimed rows to this login. */
export async function linkRowsFor(db: SupabaseClient, rawEmail: string, uid: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL.test(email)) return
  const { businesses, people } = await registeredRows(db, email)
  const bIds = businesses.filter(b => !b.auth_uid).map(b => b.id)
  const pIds = people.filter(p => !p.auth_uid).map(p => p.id)
  if (bIds.length) await db.from('businesses').update({ auth_uid: uid }).in('id', bIds).is('auth_uid', null)
  if (pIds.length) await db.from('practitioners').update({ auth_uid: uid }).in('id', pIds).is('auth_uid', null)
}
