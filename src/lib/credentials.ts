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

/**
 * What is wrong with a typed mobile number, in words — or null when it is a
 * good ten-digit Indian mobile (+91 or a leading 0 allowed). Every phone box
 * uses this, so nine digits or eleven are caught before Save (4 Oct 2026).
 * Empty is fine when the field is optional. `foreign` (patients' numbers only)
 * also accepts + and a country code, 8–15 digits.
 */
export function phoneProblem(raw: string | null | undefined, required = true, foreign = false): string | null {
  const typed = (raw ?? '').trim()
  if (!typed) return required ? 'Enter the 10-digit mobile number.' : null
  let d = typed.replace(/[^0-9]/g, '')
  // A patient's number may be foreign: + and the country code (sehat_patient_phone).
  if (foreign && (typed.startsWith('+') || typed.startsWith('00'))) {
    const cc = typed.startsWith('00') ? d.slice(2) : d
    if (!cc.startsWith('91')) return /^[1-9][0-9]{7,14}$/.test(cc) ? null
      : 'Incorrect number — a foreign number is + and the country code, then 8 to 15 digits in all.'
  }
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length !== 10) return `Incorrect number — a mobile number has 10 digits, this has ${d.length}.`
  if (!/^[6-9]/.test(d)) return 'Incorrect number — an Indian mobile number starts with 6, 7, 8 or 9.'
  return null
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
//
// Every rule must match Supabase's exactly (checked 6 Oct 2026 on staging and
// production: minimum 10, lower + upper + digit + one of PASSWORD_SYMBOLS).
// A tick here that Supabase then refuses is the worst outcome — the form said
// yes and the save said no — so where the two could count differently, this
// side is the stricter one:
//  - length counts characters, not UTF-16 units: JavaScript counts an emoji (and
//    some symbols) as 2, so 8 letters + 😀 — 9 characters — ticked "at least 10".
//  - "special" means Supabase's list only. A space, ₹, é or an emoji is not one
//    of them, though /[^A-Za-z0-9]/ said it was.
//  - the 72-byte ceiling is bcrypt's; Supabase refuses anything longer.

export const PASSWORD_MIN = 10
export const PASSWORD_MAX_BYTES = 72
/** Supabase Auth's "symbols" set (Authentication > Policies). Keep in step with it. */
export const PASSWORD_SYMBOLS = '!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~'

export interface PasswordCheck {
  ok: boolean
  /** Every rule, in display order, so the form can tick them off as they type. */
  rules: { label: string; met: boolean }[]
  /** The first unmet rule, ready to show as an error. */
  firstProblem: string | null
}

export function checkPassword(pw: string): PasswordCheck {
  const chars = Array.from(pw)
  const rules = [
    { label: `At least ${PASSWORD_MIN} characters`, met: chars.length >= PASSWORD_MIN },
    { label: 'A lower-case letter (a–z)', met: /[a-z]/.test(pw) },
    { label: 'An upper-case letter (A–Z)', met: /[A-Z]/.test(pw) },
    { label: 'A number (0–9)', met: /[0-9]/.test(pw) },
    { label: 'A special character, like ! @ # or ?', met: chars.some(c => PASSWORD_SYMBOLS.includes(c)) },
  ]
  // Only shown once broken; nobody needs telling about it while typing.
  if (new TextEncoder().encode(pw).length > PASSWORD_MAX_BYTES) {
    rules.push({ label: `No more than ${PASSWORD_MAX_BYTES} characters`, met: false })
  }
  const firstUnmet = rules.find(r => !r.met)
  return {
    ok: rules.every(r => r.met),
    rules,
    firstProblem: firstUnmet ? firstUnmet.label : null,
  }
}

/**
 * Supabase's refusal of a password, in the form's words. Should not happen now
 * the rules above match its policy, but if the policy is changed in the
 * dashboard first, this is what people see instead of 'weak_password'.
 */
export function passwordSaveError(err: { message?: string; code?: string }): string {
  const m = err.message ?? ''
  if (err.code === 'weak_password' || /at least \d+ characters|should contain|weak/i.test(m)) {
    return `That password was not accepted: ${m.replace(/\.$/, '')}. Use at least ${PASSWORD_MIN} characters with a lower-case letter, an upper-case letter, a number and one of ${PASSWORD_SYMBOLS.split('').join(' ')}`
  }
  if (err.code === 'same_password') return 'That is the password you already have.'
  return m || 'Your password could not be saved. Please try again.'
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
