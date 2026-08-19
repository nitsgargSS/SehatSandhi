#!/usr/bin/env node
// seed-sandbox-accounts — create the fixed test logins in the sandbox project.
//
// Autofill creates a throwaway account per run, which is fine for testing
// registration but leaves nothing stable to test /doctor/login → dashboard
// with. These accounts fill that gap: known addresses, known password, created
// once and surviving every purge.
//
// Writes a business, a practitioner, the affiliation between them, and the
// hours that affiliation sits. It used to write a single `doctors` row, which
// 0037 removed — so until this was updated the script created the auth user and
// then failed on a 404, leaving a login with nothing behind it.
//
// Real production users are deliberately NOT copied. Supabase salts password
// hashes per project so they would not work anyway, and putting real people's
// identities in a disposable database behind a published anon key is a privacy
// problem, not a convenience.
//
//   node scripts/seed-sandbox-accounts.mjs
//
// Needs the sandbox project's SERVICE ROLE key (Dashboard → Settings → API).
// Add to .env.supabase:
//   SANDBOX_SUPABASE_URL=https://<sandbox-ref>.supabase.co
//   SANDBOX_SERVICE_ROLE_KEY=<service role key>

import { join } from 'node:path'
import dotenv from 'dotenv'
import { ROOT } from './lib/tables-config.mjs'

dotenv.config({ path: join(ROOT, '.env.supabase'), quiet: true })

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

const url = process.env.SANDBOX_SUPABASE_URL
const serviceKey = process.env.SANDBOX_SERVICE_ROLE_KEY
if (!url) fail('SANDBOX_SUPABASE_URL is not set (see .env.supabase).')
if (!serviceKey) fail('SANDBOX_SERVICE_ROLE_KEY is not set (see .env.supabase).')

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

// One account used to mean one `doctors` row. 0037 split that into three: the
// listing, the person, and the affiliation carrying what is true of them there.
// A seed that writes only one produces a business nobody staffs or a doctor who
// works nowhere, and the dashboard shows neither.
const ACCOUNTS = [
  {
    email: 'sandbox-doctor@sehatsandhi.test',
    role: 'doctor',
    business: {
      name: '[SEED] Sandbox Test Clinic',
      vertical: 'clinic',
      address: '1, Model Town, Yamunanagar, Haryana',
      // A real pincode, not the empty array this used to write. With no
      // coverage the listing is invisible to every search — patient page, area
      // page and bot alike — so the seed could be used to test a login and
      // nothing beyond it.
      pin_codes: ['135001'],
      phone: '9000000001',
      working_hours: 'Mon,Tue,Wed,Thu,Fri,Sat 10:00-18:00',
      // Active, so it appears in public listings and the dashboard has data.
      status: 'active',
    },
    practitioner: {
      full_name: '[SEED] Dr. Sandbox Tester',
      speciality: 'GEN',
      qualification: 'MBBS',
      reg_number: 'DMC/R/2020/00001',
      phone: '9000000001',
      status: 'active',
    },
    // On the affiliation, not on either side of it: the same doctor charges
    // differently at each place they sit.
    consultation_fee: 300,
    // When this doctor actually sits here. Monday to Saturday, matching the
    // working_hours line above — that field is free text for humans to read and
    // nothing books against it, so without these rows the clinic publishes
    // hours on its profile and offers no slots to anyone.
    hours: {
      days: [1, 2, 3, 4, 5, 6],   // 0 = Sunday, as day_of_week stores it
      start: '10:00',
      end: '18:00',
      slot_minutes: 15,
      capacity: 4,
    },
  },
  { email: 'sandbox-admin@sehatsandhi.test', role: 'admin', business: null },
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

  let userId = null
  try {
    // Idempotent: look for an existing account before creating one, so
    // re-running after a purge (which leaves these alone) is a no-op.
    const list = await api('/auth/v1/admin/users?page=1&per_page=1000')
    const existingUser = (list.users ?? []).find(u => u.email === acct.email)

    if (existingUser) {
      userId = existingUser.id
      console.log('already exists')
    } else {
      const created = await api('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: acct.email,
          password: PASSWORD,
          // Skip the confirmation email: .test is undeliverable and Supabase's
          // default SMTP is rate-limited.
          email_confirm: true,
        }),
      })
      userId = created?.id ?? null
      console.log('created')
    }
  } catch (e) {
    console.log(`✗ ${e.message}`)
    failures++
    continue
  }

  if (!acct.business) continue

  // The listing, the person, and the affiliation — so /doctor/dashboard has
  // something to show and the listing is reachable from a search.
  try {
    // sehat_caller_business_ids() resolves a login three ways; the two that
    // apply here are businesses.auth_uid and a matching businesses.email. Both
    // are set, so the seed survives whichever route the dashboard takes.
    let businessId
    const foundBiz = await api(
      `/rest/v1/businesses?select=id&email=eq.${encodeURIComponent(acct.email)}&limit=1`)
    if (foundBiz.length) {
      businessId = foundBiz[0].id
      console.log('      ↳ business already exists')
    } else {
      const rows = await api('/rest/v1/businesses', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...acct.business, email: acct.email }),
      })
      businessId = rows[0].id
      console.log('      ↳ business created')
    }

    // Set separately rather than on the insert, so a row seeded before the
    // auth user existed still gets linked on a later run.
    if (userId) {
      await api(`/rest/v1/businesses?id=eq.${businessId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ auth_uid: userId }),
      })
    }

    // Keyed on the registration number: practitioners_registration_key treats
    // (council, registration) as the identity of a person, and re-inserting
    // would either duplicate them or trip that index.
    let practitionerId
    const foundDoc = await api(
      `/rest/v1/practitioners?select=id&reg_number=eq.${encodeURIComponent(acct.practitioner.reg_number)}&limit=1`)
    if (foundDoc.length) {
      practitionerId = foundDoc[0].id
      console.log('      ↳ practitioner already exists')
    } else {
      const rows = await api('/rest/v1/practitioners', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(acct.practitioner),
      })
      practitionerId = rows[0].id
      console.log('      ↳ practitioner created')
    }

    let affiliationId
    const foundLink = await api(
      `/rest/v1/business_practitioners?select=id&business_id=eq.${businessId}` +
      `&practitioner_id=eq.${practitionerId}&limit=1`)
    if (foundLink.length) {
      affiliationId = foundLink[0].id
      console.log('      ↳ affiliation already exists')
    } else {
      const rows = await api('/rest/v1/business_practitioners', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          business_id: businessId,
          practitioner_id: practitionerId,
          role: 'doctor',
          is_primary: true,
          consultation_fee: acct.consultation_fee,
          // Active on all three, or public_practitioner_businesses filters the
          // doctor out and every search comes back empty.
          status: 'active',
          can_login_web: true,
        }),
      })
      affiliationId = rows[0].id
      console.log('      ↳ affiliation created')
    }

    // Bookable hours, hung off the affiliation rather than the business: 0037
    // moved availability onto the posting so a doctor can sit here on Tuesdays
    // and somewhere else on Wednesdays. This is what sehat_open_windows reads,
    // so it is what decides whether the dashboard and the bot have any slot to
    // offer at all.
    if (acct.hours) {
      const foundHours = await api(
        `/rest/v1/availability?select=id&business_practitioner_id=eq.${affiliationId}&limit=1`)
      if (foundHours.length) {
        console.log('      ↳ hours already published')
      } else {
        await api('/rest/v1/availability', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(acct.hours.days.map(day => ({
            business_id: businessId,
            business_practitioner_id: affiliationId,
            day_of_week: day,
            start_time: acct.hours.start,
            end_time: acct.hours.end,
            slot_duration_minutes: acct.hours.slot_minutes,
            slot_capacity: acct.hours.capacity,
            is_active: true,
            // Left null deliberately: the seed clinic has the one branch its
            // insert trigger created, and a null location means "wherever this
            // business sees patients" — the fallback both sehat_open_windows
            // and the capacity check already honour.
            location_id: null,
          }))),
        })
        console.log(`      ↳ hours published (${acct.hours.days.length} days, `
          + `${acct.hours.start}-${acct.hours.end}, ${acct.hours.capacity} per slot)`)
      }
    }
  } catch (e) {
    console.log(`      ↳ listing: ✗ ${e.message}`)
    failures++
  }
}

if (failures) {
  console.error(`\n  ${failures} problem(s) while seeding.\n`)
  process.exit(1)
}

console.log(`\n  ✓ Sandbox logins ready — password: ${PASSWORD}`)
console.log('    The logins survive `Purge sandbox data`; autofill accounts do not.')
// The rows do NOT. businesses, practitioners, business_practitioners and
// availability are all classified `isolated`, so a purge takes them and leaves
// the login pointing at nothing — a dashboard that looks broken rather than
// empty. Re-running is a no-op when they are still there, so the safe habit is
// to run this after every purge.
console.log('    Re-run this after a purge — the rows are purged, the logins are not.\n')
