// The rules for an email, a phone number and a password, in one place.
//
// Every one of these has a twin in SQL — sehat_valid_email, sehat_norm_phone and
// friends, added in 0079 — and the twin is the one that enforces. These exist so
// a person is told what is wrong before they submit, and so the message they get
// is the same one the server would have given them. If the two ever disagree,
// the server wins and the form is the thing that is broken.
//
// Nothing here is a security boundary. The registration RPCs are callable by
// anybody holding the anon key, which ships in this bundle.

/** lower-cased, trimmed, or null. Mirrors sehat_norm_email. */
export function normEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  return v === '' ? null : v
}

/**
 * Deliberately loose, and the same pattern as sehat_valid_email.
 *
 * Addresses that are legal and look wrong are far commoner than the reverse —
 * plus-addressing, new top-level domains, apostrophes — and the only real proof
 * an address works is the code arriving at it. So this rejects what cannot
 * possibly be an address and leaves the rest to verification.
 */
export function isValidEmail(raw: string | null | undefined): boolean {
  const v = normEmail(raw)
  return v !== null && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v)
}

/**
 * Ten digits, 6-9 leading, or null. Mirrors sehat_norm_phone.
 *
 * Accepts what people actually type — +91, a leading zero, spaces, dashes — and
 * returns the ten digits that get stored, so the number a patient is messaged on
 * is the number the clinic typed however they typed it.
 */
export function normPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/[^0-9]/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9][0-9]{9}$/.test(d) ? d : null
}

export function isValidPhone(raw: string | null | undefined): boolean {
  return normPhone(raw) !== null
}

/** A council registration number. Free-form across states, so only presence. */
export function isValidRegNumber(raw: string | null | undefined): boolean {
  return (raw ?? '').trim().length > 0
}

// ── Passwords ───────────────────────────────────────────────────────────────
//
// The rules below are checked here so somebody is told before they submit. What
// makes them true is the project's own password policy — Authentication >
// Policies in the Supabase dashboard — because Supabase Auth is what stores and
// checks the password, and nothing in this repo can reach past it. Until that
// setting matches, a password refused by this form would still be accepted by an
// API call that skipped it.
//
// A note on the special-character rule, since it was asked for specifically and
// current guidance (NIST 800-63B) argues against composition rules: they push
// people towards Passw0rd! and away from length, which is what actually helps.
// It is required here because it was asked for, and paired with a 10-character
// minimum so it is not carrying the weight on its own.

export const PASSWORD_MIN = 10

export interface PasswordCheck {
  ok: boolean
  /** Every rule, in display order, so the form can tick them off as they type. */
  rules: { label: string; met: boolean }[]
  /** The first unmet rule, ready to show as an error. */
  firstProblem: string | null
}

export function checkPassword(pw: string): PasswordCheck {
  const rules = [
    { label: `At least ${PASSWORD_MIN} characters`, met: pw.length >= PASSWORD_MIN },
    { label: 'A lower-case letter', met: /[a-z]/.test(pw) },
    { label: 'An upper-case letter', met: /[A-Z]/.test(pw) },
    { label: 'A number', met: /[0-9]/.test(pw) },
    { label: 'A special character, like ! @ # or ?', met: /[^A-Za-z0-9]/.test(pw) },
  ]
  const firstUnmet = rules.find(r => !r.met)
  return {
    ok: rules.every(r => r.met),
    rules,
    firstProblem: firstUnmet ? firstUnmet.label : null,
  }
}

/**
 * The one message to show when a password is refused.
 *
 * Says everything that is wrong rather than the first thing, because being told
 * one rule at a time across four attempts is how people end up with Passw0rd!.
 */
export function passwordProblem(pw: string, confirm?: string): string | null {
  if (confirm !== undefined && pw !== confirm) return 'The two passwords do not match.'
  const c = checkPassword(pw)
  if (c.ok) return null
  const missing = c.rules.filter(r => !r.met).map(r => r.label.toLowerCase())
  return `Your password still needs: ${missing.join(', ')}.`
}
