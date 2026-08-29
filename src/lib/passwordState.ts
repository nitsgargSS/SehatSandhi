import { supabase } from './supabase'

// How old the signed-in person's password is, and whether they are still
// allowed to carry on with it.
//
// The figures come from 0080 and live in SQL, not here, so changing the policy
// is a migration rather than a redeploy of the bundle.
//
// Worth knowing what this is: a screen in front of the app, not a lock on the
// data. An expired session still holds a valid JWT and every RLS policy keys off
// auth.uid(), so somebody who skipped the UI and called the REST API directly
// would still be served. 0080 explains why the real gate — returning null from
// sehat_caller_role() when the password is expired — was left for its own
// migration: that function backs nearly every policy in the schema.

export interface PasswordState {
  passwordChangedAt: string
  expiresAt: string
  daysLeft: number
  expired: boolean
  mustChange: boolean
  mustChangeReason: string | null
}

/**
 * Null when nobody is signed in, or when the check itself failed.
 *
 * A failure returns null rather than throwing, and the caller lets the person
 * through. Locking a clinic out of its own dashboard because a status query
 * timed out would be a worse outcome than a password living a day longer than
 * it should.
 */
export async function fetchPasswordState(): Promise<PasswordState | null> {
  const { data, error } = await supabase.rpc('sehat_password_state')
  if (error || !data || (data as unknown[]).length === 0) return null
  const r = (data as Record<string, unknown>[])[0]
  return {
    passwordChangedAt: String(r.password_changed_at),
    expiresAt: String(r.expires_at),
    daysLeft: Number(r.days_left ?? 0),
    expired: Boolean(r.expired),
    mustChange: Boolean(r.must_change),
    mustChangeReason: (r.must_change_reason as string | null) ?? null,
  }
}

/**
 * Record that the caller just changed their own password.
 *
 * Call this after every successful supabase.auth.updateUser({ password }).
 * Supabase Auth does not tell us when a password was set, so if this is
 * forgotten the clock never restarts and the person is asked again on their
 * next sign-in — which is the visible symptom to look for if that happens.
 */
export async function markPasswordChanged(): Promise<void> {
  const { error } = await supabase.rpc('sehat_password_changed')
  if (error) throw new Error(error.message)
}

export const mustChangeNow = (s: PasswordState | null): boolean =>
  !!s && (s.expired || s.mustChange)

export const shouldWarn = (s: PasswordState | null): boolean =>
  !!s && !mustChangeNow(s) && s.daysLeft <= 10
