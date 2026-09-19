#!/usr/bin/env node
// seed-sandbox-bot — give every WhatsApp bot branch something to answer with.
//
// seed-sandbox-accounts creates a handful of logins, which leaves the bot able
// to find four doctors and nothing else: every lab, pharmacy, ambulance,
// insurance and camps branch falls straight through to its "nobody here yet"
// sentence, so the paths that matter most can never be seen working.
//
// This writes, all in pincode 135001, under plain names the bot can read out
// (businesses are marked by a seed-bot+…@sehatsandhi.test email instead):
//   • two doctors for every speciality code bot_speciality_code accepts — one
//     at a single-speciality clinic, one at a hospital — so "2" can be tested
//     as well as "1", with hours every day so slots are always offered
//   • labs with house hours, so lab_booking has slots and lab_callback a list
//   • pharmacies, ambulances and insurance advisors for the read-out branches
//   • approved camps and offers running from today
//
// Idempotent: every row is looked up by its marker (email, reg number, camp
// title) first, so re-run it after a purge — these tables are `isolated` and a
// purge takes them.
//
//   node scripts/seed-sandbox-bot.mjs
//
// Needs SANDBOX_SUPABASE_URL and SANDBOX_SERVICE_ROLE_KEY in .env.supabase.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/tables-config.mjs'

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

// .env.supabase repeats its keys in a blank template block further down, and
// dotenv lets the later empty value win. Take the first non-empty value instead.
function readEnv(file) {
  const out = {}
  for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (value && !out[m[1]]) out[m[1]] = value
  }
  return out
}

const env = { ...readEnv('.env.supabase'), ...process.env }
const url = env.SANDBOX_SUPABASE_URL
const serviceKey = env.SANDBOX_SERVICE_ROLE_KEY
if (!url) fail('SANDBOX_SUPABASE_URL is not set (see .env.supabase).')
if (!serviceKey) fail('SANDBOX_SERVICE_ROLE_KEY is not set (see .env.supabase).')

// The service key bypasses RLS. Refuse to write if the URL is production's.
const sandboxRef = new URL(url).hostname.split('.')[0]
if ((env.SUPABASE_DB_URL_PROD ?? '').includes(sandboxRef)) {
  fail(`SANDBOX_SUPABASE_URL (${sandboxRef}) looks like the production project. Refusing to seed.`)
}

const PIN = '135001'
const ADDRESS = (street) => `${street}, Yamunanagar, Haryana ${PIN}`

// Phones are 9000000101 upwards: inside the 9000000xxx range test-suite's bot
// leak check treats as a test number, and clear of the 9000000001-0009 the
// account seed uses. Handed out in a fixed order and re-asserted on every run,
// so a row keeps its number. Bookings queue a WhatsApp to the business phone;
// in sandbox those sends fail, which is what we want for numbers nobody owns.
let phoneSeq = 100
const nextPhone = () => `9000000${String(++phoneSeq).padStart(3, '0')}`

const SPECIALITIES = [
  // code, clinic name, doctor at the clinic, doctor at the hospital, qualification
  ['GEN',  'Family Health Clinic',   'Dr. Ramesh Sharma',   'Dr. Anita Verma',     'MBBS'],
  ['SKIN', 'Skin & Hair Clinic',     'Dr. Neha Kapoor',     'Dr. Vikram Sethi',    'MBBS, MD (Dermatology)'],
  ['DENT', 'Smile Dental Care',      'Dr. Pooja Bansal',    'Dr. Arjun Malhotra',  'BDS, MDS'],
  ['EYE',  'Vision Eye Centre',      'Dr. Sanjay Gupta',    'Dr. Kavita Rana',     'MBBS, MS (Ophthalmology)'],
  ['PAED', 'Little Stars Child Clinic', 'Dr. Meenu Arora',  'Dr. Rohit Chawla',    'MBBS, MD (Paediatrics)'],
  ['GYN',  'Mother Care Clinic',     'Dr. Sunita Goel',     'Dr. Rekha Saini',     'MBBS, MS (Obs & Gynae)'],
  ['IVF',  'New Hope Fertility Centre', 'Dr. Priya Khanna', 'Dr. Manisha Jindal',  'MBBS, MS, Fellowship (Reproductive Medicine)'],
  ['ORTH', 'Bone & Joint Clinic',    'Dr. Rajiv Mehta',     'Dr. Harpreet Singh',  'MBBS, MS (Orthopaedics)'],
  ['CARD', 'Heart Care Clinic',      'Dr. Ashok Aggarwal',  'Dr. Nitin Bhatia',    'MBBS, MD, DM (Cardiology)'],
  ['ENT',  'ENT Care Clinic',        'Dr. Deepak Jain',     'Dr. Shalini Mittal',  'MBBS, MS (ENT)'],
  ['GAST', 'Digestive Health Clinic','Dr. Manoj Tyagi',     'Dr. Seema Ahuja',     'MBBS, MD, DM (Gastroenterology)'],
  ['NEUR', 'Neuro Care Clinic',      'Dr. Alok Srivastava', 'Dr. Ritu Grover',     'MBBS, MD, DM (Neurology)'],
  ['URO',  'Kidney & Urology Clinic','Dr. Sunil Dhawan',    'Dr. Gaurav Kohli',    'MBBS, MS, MCh (Urology)'],
  ['ONC',  'Cancer Care Clinic',     'Dr. Rakesh Nanda',    'Dr. Swati Bhardwaj',  'MBBS, MD, DM (Medical Oncology)'],
  ['PSY',  'Mind Wellness Clinic',   'Dr. Aarti Sood',      'Dr. Kunal Walia',     'MBBS, MD (Psychiatry)'],
  ['DIAB', 'Diabetes & Thyroid Clinic', 'Dr. Vinod Garg',   'Dr. Nidhi Mahajan',   'MBBS, MD (Medicine), Diabetology'],
  ['PHYS', 'Active Physio Centre',   'Dr. Karan Sachdeva',  'Dr. Simran Kaur',     'BPT, MPT'],
  ['ALT',  'Ayush Wellness Centre',  'Dr. Om Prakash Shastri', 'Dr. Lata Dixit',  'BAMS'],
]

const HOSPITALS = ['Yamuna City Hospital', 'Jagadhri Road Multispeciality Hospital']

// Every day, so a slot is on offer whichever day the bot is tested.
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const DOCTOR_HOURS = { start: '09:00', end: '20:00', slot_minutes: 30, capacity: 2 }
const LAB_HOURS    = { start: '07:00', end: '19:00', slot_minutes: 30, capacity: 4 }

const PARTNERS = [
  // vertical, name, street, hours (for bookable verticals only)
  ['lab', 'Yamuna Diagnostics & Blood Test Centre', 'Near Bus Stand',       LAB_HOURS],
  ['lab', 'City Pathology Lab',                      'Model Town Market',    LAB_HOURS],
  ['lab', 'Scan & Imaging Centre (MRI, CT, X-Ray)',  'Workshop Road',        LAB_HOURS],
  ['pharmacy', 'Sehat Medical Store',                'Railway Road',         null],
  ['pharmacy', 'Jan Aushadhi Kendra',                'Civil Hospital Gate',  null],
  ['pharmacy', '24x7 Chemist',                       'Jagadhri Road',        null],
  ['ambulance', 'Rapid Ambulance Service',           'Sector 17',            null],
  ['ambulance', 'Life Line Ambulance',               'Kalanaur Road',        null],
  ['ambulance', 'Yamuna Cardiac Ambulance',          'Sector 15',            null],
  ['insurance', 'Suraksha Health Insurance Advisors','Mall Road',            null],
  ['insurance', 'Star Cover Insurance Point',        'Sector 18',            null],
  ['insurance', 'Bima Mitra Consultants',            'Paonta Chowk',         null],
]

// ── REST helpers ──
async function api(path, init = {}) {
  const r = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${r.status}: ${text}`)
  return text ? JSON.parse(text) : null
}
const q = encodeURIComponent
const insert = async (table, body) =>
  (await api(`/rest/v1/${table}`, {
    method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body),
  }))[0]

// Names are what the bot reads out, so they carry no [SEED] tag; this address
// is what marks a row as ours. Looking up by name alone could adopt a real
// sandbox listing that happens to share one.
const seedEmail = (name) =>
  `seed-bot+${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}@sehatsandhi.test`

async function ensureBusiness(name, vertical, street) {
  const email = seedEmail(name)
  const phone = nextPhone()
  let found = await api(`/rest/v1/businesses?select=id&email=eq.${q(email)}&limit=1`)
  // Rows from before the tag was dropped: '[SEED] <name>', no marker.
  if (!found.length) {
    found = await api(`/rest/v1/businesses?select=id&name=eq.${q(`[SEED] ${name}`)}&limit=1`)
  }
  if (found.length) {
    // Re-assert the fields search depends on, in case a purge or an admin
    // edit knocked the row out of the results.
    await api(`/rest/v1/businesses?id=eq.${found[0].id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ name, email, phone, status: 'active', pin_codes: [PIN], vertical }),
    })
    return { id: found[0].id, created: false }
  }
  const row = await insert('businesses', {
    name, email, vertical, status: 'active',
    address: ADDRESS(street), pin_codes: [PIN], own_pin_code: PIN,
    own_city: 'Yamunanagar', own_district: 'Yamunanagar', own_state: 'Haryana',
    phone,
    working_hours: vertical === 'ambulance' ? '24x7' : 'All days 09:00-20:00',
  })
  return { id: row.id, created: true }
}

async function ensureHours(businessId, affiliationId, hours) {
  const filter = affiliationId
    ? `business_practitioner_id=eq.${affiliationId}`
    : `business_id=eq.${businessId}&business_practitioner_id=is.null`
  const found = await api(`/rest/v1/availability?select=id&${filter}&limit=1`)
  if (found.length) return false
  await api('/rest/v1/availability', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(EVERY_DAY.map(day => ({
      business_id: businessId,
      business_practitioner_id: affiliationId,
      day_of_week: day,
      start_time: hours.start,
      end_time: hours.end,
      slot_duration_minutes: hours.slot_minutes,
      slot_capacity: hours.capacity,
      is_active: true,
      location_id: null,
    }))),
  })
  return true
}

async function ensureDoctor({ businessId, name, code, qualification, regNumber, fee }) {
  const phone = nextPhone()
  let practitionerId
  const found = await api(`/rest/v1/practitioners?select=id&reg_number=eq.${q(regNumber)}&limit=1`)
  if (found.length) {
    practitionerId = found[0].id
    await api(`/rest/v1/practitioners?id=eq.${practitionerId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ full_name: name, phone, status: 'active', speciality: code }),
    })
  } else {
    practitionerId = (await insert('practitioners', {
      full_name: name, speciality: code, qualification,
      reg_number: regNumber, phone, status: 'active',
    })).id
  }

  let affiliationId
  const link = await api(`/rest/v1/business_practitioners?select=id&business_id=eq.${businessId}` +
    `&practitioner_id=eq.${practitionerId}&limit=1`)
  if (link.length) {
    affiliationId = link[0].id
    await api(`/rest/v1/business_practitioners?id=eq.${affiliationId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'active', consultation_fee: fee }),
    })
  } else {
    affiliationId = (await insert('business_practitioners', {
      business_id: businessId, practitioner_id: practitionerId,
      role: 'doctor', is_primary: false, consultation_fee: fee,
      status: 'active', can_login_web: false,
      // No doctor phone here is real; do not queue messages to them.
      notify_new_appointments: false, notify_daily_schedule: false,
      notify_cancellations: false, notify_monthly_report: false,
    })).id
  }
  await ensureHours(businessId, affiliationId, DOCTOR_HOURS)
}

async function ensureCamp(camp, businessId) {
  let found = await api(`/rest/v1/camps_offers?select=id&title=eq.${q(camp.title)}&limit=1`)
  if (!found.length) {
    found = await api(`/rest/v1/camps_offers?select=id&title=eq.${q(`[SEED] ${camp.title}`)}&limit=1`)
  }
  const today = new Date()
  const iso = (d) => d.toISOString().slice(0, 10)
  const body = {
    ...camp, business_id: businessId, pin_codes: [PIN], status: 'approved',
    date_from: iso(today),
    date_to: iso(new Date(today.getTime() + camp.days * 86400000)),
  }
  delete body.days
  if (found.length) {
    // Dates rolled forward on every run so the camp never quietly expires.
    await api(`/rest/v1/camps_offers?id=eq.${found[0].id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body),
    })
  } else {
    await insert('camps_offers', body)
  }
}

// ── run ──
console.log(`\n  Seeding bot test data into ${sandboxRef}, pincode ${PIN}\n`)

const hospitalIds = []
for (const [i, name] of HOSPITALS.entries()) {
  const b = await ensureBusiness(name, 'hospital', i ? 'Jagadhri Road' : 'Sector 17')
  hospitalIds.push(b.id)
}

const fees = [300, 400, 500, 600, 800]
for (const [i, [code, clinic, clinicDoc, hospitalDoc, qualification]] of SPECIALITIES.entries()) {
  const c = await ensureBusiness(clinic, 'clinic', `Shop ${i + 1}, Model Town`)
  await ensureDoctor({
    businessId: c.id, name: clinicDoc, code, qualification,
    regNumber: `SEED/BOT/${code}/1`, fee: fees[i % fees.length],
  })
  await ensureDoctor({
    businessId: hospitalIds[i % 2], name: hospitalDoc, code, qualification,
    regNumber: `SEED/BOT/${code}/2`, fee: fees[(i + 2) % fees.length],
  })
  console.log(`    ✓ ${code.padEnd(4)} ${clinicDoc} · ${hospitalDoc}`)
}

const partnerIds = {}
for (const [vertical, name, street, hours] of PARTNERS) {
  const b = await ensureBusiness(name, vertical, street)
  partnerIds[vertical] ??= b.id
  if (hours) await ensureHours(b.id, null, hours)
  console.log(`    ✓ ${vertical.padEnd(9)} ${name}`)
}

const CAMPS = [
  { camp_type: 'free_camp', title: 'Free Eye Check-up Camp', days: 30,
    description: 'Free eye check-up and spectacle prescription.',
    services_offered: 'Vision test, cataract screening, free spectacles for children',
    time_slot: '10:00 AM - 2:00 PM', host: hospitalIds[0] },
  { camp_type: 'free_camp', title: 'Free Diabetes & BP Screening', days: 14,
    description: 'Free sugar and blood pressure check.',
    services_offered: 'Blood sugar (fasting/random), BP, diet advice',
    time_slot: '8:00 AM - 12:00 PM', host: hospitalIds[1] },
  { camp_type: 'special_offer', title: 'Full Body Blood Test at ₹999', days: 30,
    description: 'Full body check-up package with home sample collection.',
    services_offered: 'CBC, LFT, KFT, lipid profile, thyroid, HbA1c',
    time_slot: '7:00 AM - 7:00 PM', host: partnerIds.lab },
]
for (const { host, ...camp } of CAMPS) {
  await ensureCamp(camp, host)
  console.log(`    ✓ camp      ${camp.title}`)
}

console.log(`\n  Done. Everything is in ${PIN}, marked seed-bot+…@sehatsandhi.test.`)
console.log('  Re-run after a sandbox purge — the rows are purged with it.\n')
