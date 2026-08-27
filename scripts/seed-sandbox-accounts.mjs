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
      // Both clinical systems switched on WITHOUT a payment, which only ever
      // happens here. 0060 made OPD and IPD separately bought, so a seed clinic
      // that has not paid for either shows no Queue, Beds or Patients tab — a
      // sandbox where the thing you came to test is invisible.
      //
      // Deliberately not a one-off UPDATE: these rows are `isolated` and a purge
      // takes them, so the flags have to be reasserted by the seed or the next
      // purge quietly removes the EMR from the test environment again.
      opd_module: true,
      ipd_module: true,
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
  {
    // The PAID clinic, and the contrast with the one above is the point of it.
    //
    // [SEED] Sandbox Test Clinic has its module flags set by hand and no
    // term_end, which entitlement treats as never expiring. That is a fixture,
    // not a customer. This one starts with both modules OFF and gets them by
    // going through fulfilPayment at the end of this script — real payment row,
    // real invoice, real term_end a month out, real locked_monthly_price.
    //
    // A hospital on purpose: IPD is what hospitals buy, and it exercises the
    // headcount rule that multiplies the listing fee and must NOT multiply the
    // module fee.
    email: 'sandbox-paid@sehatsandhi.test',
    role: 'doctor',
    business: {
      name: '[SEED] Paid Multi-Speciality',
      vertical: 'hospital',
      address: '44, Civil Lines, Yamunanagar, Haryana',
      pin_codes: ['135001'],
      phone: '9000000005',
      working_hours: 'Mon,Tue,Wed,Thu,Fri,Sat 09:00-20:00',
      status: 'active',
      // Deliberately NOT set here. The payment sets them, which is the whole
      // reason this account exists.
    },
    practitioner: {
      full_name: '[SEED] Dr. Paid Consultant',
      speciality: 'GEN',
      qualification: 'MBBS, MD',
      reg_number: 'DMC/R/2020/00003',
      phone: '9000000005',
      status: 'active',
    },
    consultation_fee: 800,
    hours: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '20:00', slot_minutes: 15, capacity: 4 },
    // Picked up by the payment phase below.
    buysModules: ['opd', 'ipd'],
  },
  { email: 'sandbox-admin@sehatsandhi.test', role: 'admin', business: null },
]

// ── Staff logins, for testing role gating ───────────────────────────────────
//
// READ THIS BEFORE TESTING 0057. The account above is called
// sandbox-doctor@ and it is NOT a doctor as far as access is concerned: it is
// linked through businesses.auth_uid and businesses.email, which are routes 1
// and 2 of sehat_caller_business_ids, and sehat_caller_role answers 'owner' for
// both. An owner bypasses every role check by design.
//
// So testing the role gating with that login shows nothing and looks like a
// pass. The only route that yields a non-owner role is route 3 — an affiliation
// whose practitioner carries auth_uid — and nothing set practitioners.auth_uid
// until this block existed. That is why sandbox had no login capable of
// exercising 0057 at all.
//
// These three attach to the SAME business as the owner account, so they see the
// same patients, the same beds and the same money, and the only thing that
// differs between them is role. Their addresses are deliberately never written
// to businesses.email — that would quietly promote them to owner and undo the
// whole point.
const SEED_BUSINESS_NAME = '[SEED] Sandbox Test Clinic'

const STAFF = [
  {
    email: 'sandbox-reception@sehatsandhi.test',
    role: 'receptionist',
    // Expect: Queue, Appointments, Beds, and Patients WITHOUT the clinical
    // panes. No Clinic, Bills or Reports tab. Cannot read vitals, conditions,
    // prescriptions, documents or recordings; can take money.
    full_name: '[SEED] Priya Sharma (reception)',
    phone: '9000000002',
  },
  {
    email: 'sandbox-staffdoc@sehatsandhi.test',
    role: 'doctor',
    // Expect: everything clinical, plus Schedule. No Clinic, Bills or Reports —
    // a salaried doctor is not the business.
    full_name: '[SEED] Dr. Staff Doctor',
    phone: '9000000003',
    speciality: 'GEN',
    qualification: 'MBBS',
    reg_number: 'DMC/R/2020/00002',
  },
  {
    email: 'sandbox-manager@sehatsandhi.test',
    role: 'manager',
    // Expect: the mirror image of the doctor — Clinic, Bills, Reports and
    // Schedule, but no clinical panes.
    full_name: '[SEED] Anil Kumar (manager)',
    phone: '9000000004',
  },
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
        // Modules re-asserted alongside auth_uid so a business seeded before
        // 0060 existed picks them up on the next run rather than staying dark.
        body: JSON.stringify({ auth_uid: userId, opd_module: true, ipd_module: true }),
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

// ── Staff logins ────────────────────────────────────────────────────────────

const seedBiz = await api(
  `/rest/v1/businesses?select=id&name=eq.${encodeURIComponent(SEED_BUSINESS_NAME)}&limit=1`
).catch(() => [])

if (!seedBiz.length) {
  console.log('\n      staff logins skipped — the seed business is not there yet')
  failures++
} else {
  const businessId = seedBiz[0].id
  console.log('')

  for (const s of STAFF) {
    process.stdout.write(`      ${s.email.padEnd(36)} `)
    try {
      // 1. The login.
      const list = await api('/auth/v1/admin/users?page=1&per_page=1000')
      let userId = (list.users ?? []).find(u => u.email === s.email)?.id ?? null
      if (userId) {
        console.log('already exists')
      } else {
        const created = await api('/auth/v1/admin/users', {
          method: 'POST',
          body: JSON.stringify({ email: s.email, password: PASSWORD, email_confirm: true }),
        })
        userId = created?.id ?? null
        console.log('created')
      }

      // 2. The person. Keyed on reg_number where there is one, because that is
      //    the natural key the unique index is built on; on full_name for the
      //    non-clinical staff, who have no registration to hold.
      const lookup = s.reg_number
        ? `reg_number=eq.${encodeURIComponent(s.reg_number)}`
        : `full_name=eq.${encodeURIComponent(s.full_name)}`
      let practitionerId
      const foundDoc = await api(`/rest/v1/practitioners?select=id&${lookup}&limit=1`)
      if (foundDoc.length) {
        practitionerId = foundDoc[0].id
      } else {
        const rows = await api('/rest/v1/practitioners', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            full_name: s.full_name,
            phone: s.phone,
            speciality: s.speciality ?? null,
            qualification: s.qualification ?? null,
            reg_number: s.reg_number ?? null,
            status: 'active',
          }),
        })
        practitionerId = rows[0].id
      }

      // 3. THE LINE THIS WHOLE BLOCK EXISTS FOR. Route 3 of
      //    sehat_caller_business_ids reads practitioners.auth_uid; without it
      //    the login resolves to no business and the dashboard shows nothing.
      //    Patched separately so a person seeded before their login existed
      //    gets linked on a later run.
      if (userId) {
        await api(`/rest/v1/practitioners?id=eq.${practitionerId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ auth_uid: userId }),
        })
      }

      // 4. The affiliation, carrying the role that is the point of the exercise.
      const foundLink = await api(
        `/rest/v1/business_practitioners?select=id,role&business_id=eq.${businessId}` +
        `&practitioner_id=eq.${practitionerId}&limit=1`)
      if (foundLink.length) {
        // Re-assert the role: an earlier run may have created it as the default
        // 'doctor', and a receptionist silently holding a doctor's role is the
        // exact failure this seed is meant to make visible.
        if (foundLink[0].role !== s.role) {
          await api(`/rest/v1/business_practitioners?id=eq.${foundLink[0].id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ role: s.role, status: 'active', can_login_web: true }),
          })
          console.log(`      ↳ role corrected to ${s.role}`)
        } else {
          console.log(`      ↳ affiliation already ${s.role}`)
        }
      } else {
        await api('/rest/v1/business_practitioners', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            business_id: businessId,
            practitioner_id: practitionerId,
            role: s.role,
            // Their only posting, so it is the primary one. The partial unique
            // index allows one per practitioner and each of these is a
            // different person.
            is_primary: true,
            status: 'active',
            can_login_web: true,
          }),
        })
        console.log(`      ↳ affiliation created as ${s.role}`)
      }
    } catch (e) {
      console.log(`✗ ${e.message}`)
      failures++
    }
  }
}

// ── Something to actually look at ───────────────────────────────────────────
//
// A dashboard with no patients and no beds is a dashboard where every tab looks
// broken. The fixture patient was attached to the seed CLINIC only, so logging
// in to the paid hospital showed empty everything — which reads as "the OPD and
// IPD systems are missing" rather than "nobody has been seen here yet".
//
// Two wards at DIFFERENT daily rates on purpose. 0053 bills a stay per bed
// occupied rather than one line at one rate, so moving a patient from general
// to ICU should produce two charge lines at two prices — and that is the one
// piece of billing arithmetic never exercised against real data.
for (const acct of ACCOUNTS.filter(a => a.business)) {
  const found = await api(
    `/rest/v1/businesses?select=id&name=eq.${encodeURIComponent(acct.business.name)}&limit=1`).catch(() => [])
  if (!found.length) continue
  const businessId = found[0].id
  process.stdout.write(`      ${acct.business.name.padEnd(36)} `)
  const bits = []
  try {
    // Wards and beds.
    const wards = await api(`/rest/v1/wards?select=id,name&business_id=eq.${businessId}`)
    if (!wards.length) {
      for (const w of [
        { name: 'General Ward', kind: 'general', beds: [['G1', 1500], ['G2', 1500]] },
        { name: 'ICU',          kind: 'icu',     beds: [['ICU-1', 6000]] },
      ]) {
        const [ward] = await api('/rest/v1/wards', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ business_id: businessId, name: w.name, kind: w.kind }),
        })
        await api('/rest/v1/beds', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(w.beds.map(([label, rate]) => ({
            business_id: businessId, ward_id: ward.id, label, daily_charge: rate,
          }))),
        })
      }
      bits.push('3 beds in 2 wards')
    } else bits.push('beds already there')

    // The fixture patient, linked to THIS business too. One person can be seen
    // at several clinics — business_patients is the join that says so, and the
    // record stays theirs rather than being copied per clinic.
    const mem = await api(
      `/rest/v1/patient_members?select=id&full_name=eq.${encodeURIComponent('[SEED] Test Patient')}&limit=1`)
    if (mem.length) {
      const link = await api(
        `/rest/v1/business_patients?select=patient_member_id&business_id=eq.${businessId}&patient_member_id=eq.${mem[0].id}`)
      if (!link.length) {
        await api('/rest/v1/business_patients', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ business_id: businessId, patient_member_id: mem[0].id }),
        })
        bits.push('patient linked')
      } else bits.push('patient already linked')
    }
    console.log(bits.join(' · '))
  } catch (e) {
    console.log(`⚠ ${e.message}`)
  }
}

// ── The paid state ──────────────────────────────────────────────────────────
//
// Driven through sandbox-simulate-payment rather than written directly, so the
// fixture cannot drift from what fulfilment actually produces — and so the Bills
// tab has a real invoice in it. Needs that function deployed and the purge
// token; without either this warns and leaves the clinic unpaid, which is a
// worse fixture but not a broken script.
for (const acct of ACCOUNTS.filter(a => a.buysModules?.length)) {
  process.stdout.write(`      ${acct.email.padEnd(36)} `)
  try {
    const found = await api(
      `/rest/v1/businesses?select=id,term_end&name=eq.${encodeURIComponent(acct.business.name)}&limit=1`)
    if (!found.length) { console.log('✗ business missing'); failures++; continue }

    // Already paid and still in term — do not stack another payment on every
    // run. A seed that charges again each time it is run is a seed nobody dares
    // re-run.
    const liveUntil = found[0].term_end ? new Date(found[0].term_end) : null
    if (liveUntil && liveUntil > new Date()) {
      console.log(`already paid to ${found[0].term_end}`)
      continue
    }

    const token = process.env.VITE_SANDBOX_PURGE_TOKEN
    if (!token) { console.log('⚠ VITE_SANDBOX_PURGE_TOKEN not set — left unpaid'); continue }

    const res = await fetch(`${url}/functions/v1/sandbox-simulate-payment`, {
      method: 'POST',
      headers: { ...headers },
      body: JSON.stringify({
        token,
        confirm: 'SIMULATE PAYMENT',
        businessId: found[0].id,
        modules: acct.buysModules,
      }),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok || !out.ok) {
      console.log(`⚠ not paid: ${out.error ?? res.status} — deploy sandbox-simulate-payment first`)
      continue
    }
    console.log(`paid ${out.modules.join('+')} · ${out.monthlyTotal}/mo · invoice ${out.invoiceNumber ?? '—'}`)
  } catch (e) {
    console.log(`⚠ not paid: ${e.message}`)
  }
}

if (failures) {
  console.error(`\n  ${failures} problem(s) while seeding.\n`)
  process.exit(1)
}

console.log(`\n  ✓ Sandbox logins ready — password: ${PASSWORD}`)
console.log('')
console.log('    sandbox-doctor@      OWNER of the seed clinic (not a "doctor" for access)')
console.log('    sandbox-staffdoc@    doctor    — clinical yes, business no')
console.log('    sandbox-reception@   receptionist — queue/beds/money, NO clinical record')
console.log('    sandbox-manager@     manager   — business yes, clinical no')
console.log('    sandbox-paid@        owner of a PAID hospital — modules bought, real invoice')
console.log('    sandbox-admin@       admin panel')
console.log('')
console.log('    Test 0057 with sandbox-reception@. Testing it as sandbox-doctor@')
console.log('    proves nothing: the owner route bypasses every role check.')
console.log('    The logins survive `Purge sandbox data`; autofill accounts do not.')
// The rows do NOT. businesses, practitioners, business_practitioners and
// availability are all classified `isolated`, so a purge takes them and leaves
// the login pointing at nothing — a dashboard that looks broken rather than
// empty. Re-running is a no-op when they are still there, so the safe habit is
// to run this after every purge.
console.log('    Re-run this after a purge — the rows are purged, the logins are not.\n')
