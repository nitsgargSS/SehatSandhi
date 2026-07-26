#!/usr/bin/env node
// seed-sandbox-accounts — create the fixed test logins in the sandbox project.
//
// Autofill creates a throwaway account per run, which is fine for testing
// registration but leaves nothing stable to test /doctor/login → dashboard
// with. These accounts fill that gap: known addresses, known password, created
// once and surviving every purge.
//
// Real production users are deliberately NOT copied. Supabase salts password
// hashes per project so they would not work anyway, and putting real people's
// identities in a disposable database behind a published anon key is a privacy
// problem, not a convenience.
//
//   node scripts/seed-sandbox-accounts.mjs
//
// Needs the sandbox project's SERVICE ROLE key (Dashboard → Settings → API).
// Add to .env.migrate:
//   SANDBOX_SUPABASE_URL=https://<sandbox-ref>.supabase.co
//   SANDBOX_SERVICE_ROLE_KEY=<service role key>

import { join } from 'node:path'
import dotenv from 'dotenv'
import { ROOT } from './lib/tables-config.mjs'

dotenv.config({ path: join(ROOT, '.env.migrate'), quiet: true })

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

const url = process.env.SANDBOX_SUPABASE_URL
const serviceKey = process.env.SANDBOX_SERVICE_ROLE_KEY
if (!url) fail('SANDBOX_SUPABASE_URL is not set (see .env.migrate).')
if (!serviceKey) fail('SANDBOX_SERVICE_ROLE_KEY is not set (see .env.migrate).')

// Guard: the service-role key bypasses RLS entirely, so refuse to point this at
// the production project even if the values get crossed.
const prodUrl = process.env.SUPABASE_DB_URL_PROD ?? ''
const sandboxRef = new URL(url).hostname.split('.')[0]
if (prodUrl.includes(sandboxRef)) {
  fail(`SANDBOX_SUPABASE_URL (${sandboxRef}) looks like the production project. Refusing to seed.`)
}

// The hyphen matters: sandbox-purge deletes `sandbox+NNNN@` (autofill-generated)
// and leaves `sandbox-*@` alone, so these logins survive a purge.
const PASSWORD = 'Sandbox@123'
const ACCOUNTS = [
  {
    email: 'sandbox-doctor@sehatsandhi.test',
    role: 'doctor',
    doctor: {
      name: '[SEED] Dr. Sandbox Tester',
      qualification: 'MBBS',
      speciality: 'GEN',
      reg_number: 'DMC/R/2020/00001',
      clinic_name: '[SEED] Sandbox Test Clinic',
      address: '1, Model Town, Yamunanagar, Haryana',
      phone: '9000000001',
      consultation_fee: 300,
      // Active, so it appears in public listings and the dashboard has data.
      status: 'active',
    },
  },
  { email: 'sandbox-admin@sehatsandhi.test', role: 'admin', doctor: null },
]

// Talk to the REST and Admin endpoints directly rather than through
// @supabase/supabase-js: its constructor initialises a realtime client, which
// throws on Node < 22 for want of a native WebSocket. This script needs neither
// realtime nor a session, so a dependency (and a failure mode) is avoided.
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

async function api(path, init = {}) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = body?.msg || body?.message || body?.error_description || body?.error || text || `HTTP ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return body
}

console.log(`\n  Seeding sandbox accounts into ${sandboxRef}\n`)

let failures = 0

for (const acct of ACCOUNTS) {
  process.stdout.write(`      ${acct.email.padEnd(36)} `)

  try {
    // Idempotent: look for an existing account before creating one, so
    // re-running after a purge (which leaves these alone) is a no-op.
    const list = await api('/auth/v1/admin/users?page=1&per_page=1000')
    const existingUser = (list.users ?? []).find(u => u.email === acct.email)

    if (existingUser) {
      console.log('already exists')
    } else {
      await api('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: acct.email,
          password: PASSWORD,
          // Skip the confirmation email: .test is undeliverable and Supabase's
          // default SMTP is rate-limited.
          email_confirm: true,
        }),
      })
      console.log('created')
    }
  } catch (e) {
    console.log(`✗ ${e.message}`)
    failures++
    continue
  }

  // A matching doctors row, so /doctor/dashboard has something to show. The
  // email must match: doctors_read_own resolves on auth.jwt() ->> 'email'.
  if (acct.doctor) {
    try {
      const found = await api(`/rest/v1/doctors?select=id&email=eq.${encodeURIComponent(acct.email)}&limit=1`)
      if (found.length) {
        console.log('      ↳ doctors row already exists')
      } else {
        await api('/rest/v1/doctors', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            ...acct.doctor,
            email: acct.email,
            pin_codes: [],
            working_hours: 'Mon,Tue,Wed,Thu,Fri,Sat 10:00-18:00',
          }),
        })
        console.log('      ↳ doctors row created')
      }
    } catch (e) {
      console.log(`      ↳ doctors row: ✗ ${e.message}`)
      failures++
    }
  }
}

if (failures) {
  console.error(`\n  ${failures} problem(s) while seeding.\n`)
  process.exit(1)
}

console.log(`\n  ✓ Sandbox logins ready — password: ${PASSWORD}`)
console.log('    These survive `Purge sandbox data`; autofill accounts do not.\n')
