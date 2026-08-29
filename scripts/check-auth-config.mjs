#!/usr/bin/env node
// check-auth-config — does the project's Auth configuration match the code?
//
// Two settings behind 0079-0081 live in the Supabase dashboard, not in this
// repo, and neither can be set from here: the Management API rejects the only
// token we hold ("JWT could not be decoded", HTTP 401 — verified, not assumed),
// and SMTP needs provider credentials that belong to Nitin alone.
//
// So this measures them instead of setting them, because the failure mode is
// silent in both directions:
//
//   Password policy — lib/credentials.ts refuses a weak password in the FORM.
//   If Authentication > Policies does not agree, the same password is accepted
//   by any caller that skips the form, and the rule is decorative.
//
//   SMTP — until a provider is configured, signInWithOtp is accepted and
//   nothing arrives, or the built-in sender quietly rate-limits after a
//   handful. Either way the person sees "check your email" and waits.
//
//   node scripts/check-auth-config.mjs                     (sandbox)
//   node scripts/check-auth-config.mjs --otp you@place.com (also sends one)
//
// The password probe creates a throwaway auth user and deletes it again. It
// refuses to run against prod: making users there to test a setting is not a
// thing to do.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const f of ['.env', '.env.local', '.env.supabase']) {
  try { dotenv.config({ path: join(ROOT, f), override: false, quiet: true }) } catch { /* optional */ }
}

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1] }

const url = process.env.VITE_SANDBOX_SUPABASE_URL || process.env.SANDBOX_SUPABASE_URL
const anon = process.env.VITE_SANDBOX_SUPABASE_ANON_KEY
const service = process.env.SANDBOX_SERVICE_ROLE_KEY
if (!url || !anon) {
  console.error('Need VITE_SANDBOX_SUPABASE_URL and VITE_SANDBOX_SUPABASE_ANON_KEY in .env')
  process.exit(1)
}

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  const mark = ok === true ? '  ok  ' : ok === 'warn' ? ' warn ' : ' FAIL '
  console.log(`${mark} ${name}${detail ? `\n         ${detail}` : ''}`)
}

const authFetch = (path, body, key = anon) =>
  fetch(`${url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })

// ── 1. The password policy ──────────────────────────────────────────────────
//
// Each case is a password failing exactly one of the rules in
// lib/credentials.ts. If the project accepts it, that rule exists only in the
// browser. The address is thrown away either way.

console.log(`\nchecking ${url}\n`)
console.log('PASSWORD POLICY  (Authentication > Policies)')

const stamp = Date.now()
const created = []

const CASES = [
  ['too short (9 characters)',        'Ab1!efghi'],
  ['no special character',            'Abcdefgh12'],
  ['no digit',                        'Abcdefgh!!'],
  ['no upper-case letter',            'abcdefgh1!'],
  ['no lower-case letter',            'ABCDEFGH1!'],
]

for (const [label, pw] of CASES) {
  const email = `authcheck+${stamp}${Math.abs(hash(label))}@sehatsandhi.test`
  let res, body
  try {
    res = await authFetch('signup', { email, password: pw })
    body = await res.json().catch(() => ({}))
  } catch (e) {
    record(`a password with ${label} is refused`, 'warn', `could not reach the API: ${e.message}`)
    continue
  }
  if (res.ok) {
    if (body?.id || body?.user?.id) created.push(body.id ?? body.user.id)
    record(`a password with ${label} is refused`, false,
      'ACCEPTED — this rule is only in the browser, and any caller skipping the form gets past it')
  } else {
    record(`a password with ${label} is refused`, true, String(body?.msg ?? body?.message ?? '').slice(0, 90))
  }
}

// A password that satisfies every rule must still be accepted, or the policy is
// stricter than the form and people will be refused with no explanation.
{
  const email = `authcheck+${stamp}good@sehatsandhi.test`
  const res = await authFetch('signup', { email, password: 'Abcdefgh1!' })
  const body = await res.json().catch(() => ({}))
  if (res.ok && (body?.id || body?.user?.id)) created.push(body.id ?? body.user.id)
  record('a password meeting every rule is accepted', res.ok,
    res.ok ? '' : `REFUSED — the project is stricter than lib/credentials.ts: ${String(body?.msg ?? body?.message ?? '').slice(0, 90)}`)
}

// ── clean up ────────────────────────────────────────────────────────────────
if (created.length) {
  if (!service) {
    record('the throwaway accounts were removed', 'warn',
      `${created.length} left behind — set SANDBOX_SERVICE_ROLE_KEY to have them deleted`)
  } else {
    let gone = 0
    for (const id of created) {
      const r = await fetch(`${url}/auth/v1/admin/users/${id}`, {
        method: 'DELETE',
        headers: { apikey: service, Authorization: `Bearer ${service}` },
      })
      if (r.ok) gone++
    }
    record('the throwaway accounts were removed', gone === created.length,
      `${gone} of ${created.length}`)
  }
}

// ── 2. SMTP ─────────────────────────────────────────────────────────────────
//
// There is no endpoint that answers "is real SMTP configured", so the only
// honest test is to send one and have a person say whether it arrived. What can
// be read from the response is whether the request was refused outright, which
// is what an unconfigured or exhausted sender looks like.

console.log('\nSMTP  (Project Settings > Auth > SMTP)')
const otpTo = flag('otp')
if (!otpTo) {
  record('an emailed code can be sent', 'warn',
    'not tested — re-run with --otp you@yourdomain.com, then check that it actually arrives')
} else {
  const res = await authFetch('otp', { email: otpTo, create_user: false })
  const body = await res.json().catch(() => ({}))
  const msg = String(body?.msg ?? body?.message ?? body?.error_description ?? '')
  if (res.ok) {
    record('an emailed code was accepted for sending', true,
      `Supabase accepted it. Now check ${otpTo} — if nothing arrives, SMTP is not configured, ` +
      'because a queued send and a delivered one look identical from here.')
  } else if (/rate limit/i.test(msg)) {
    record('an emailed code was accepted for sending', false,
      `rate limited: "${msg}". That is the built-in sender — a few an hour — not a configured provider.`)
  } else if (/not found|user/i.test(msg)) {
    record('an emailed code was accepted for sending', 'warn',
      `"${msg}" — that address is not registered, which is the expected answer with ` +
      'create_user false. Try one that is, to test delivery.')
  } else {
    record('an emailed code was accepted for sending', false, `${res.status}: ${msg}`)
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => r.ok === false)
const warned = results.filter(r => r.ok === 'warn')
console.log(`\n${'─'.repeat(70)}`)
console.log(`${results.length} checks · ${results.filter(r => r.ok === true).length} passed · ` +
            `${failed.length} failed · ${warned.length} not conclusive`)
if (failed.length) {
  console.log('\nThe dashboard does not match the code. Until it does, those rules exist')
  console.log('only in the browser and any caller skipping the form gets past them.')
}
process.exit(failed.length ? 1 : 0)

function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0 }
  return h
}
