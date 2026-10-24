#!/usr/bin/env node
// seed-demo-hospital — fill a SANDBOX business with a complete hospital demo.
//
// Doctors and staff, wards and beds, the in-house lab (pathology, imaging,
// cardiology) and pharmacy, ~30 patients with three months of history, today's
// OPD queue, upcoming appointments, admitted and discharged patients with
// surgeries, lab reports, pharmacy sales, bills and payments — everything a
// hospital wants to see in a demo.
//
//   node scripts/seed-demo-hospital.mjs --business <uuid> [--range 1]
//   node scripts/seed-demo-hospital.mjs --create "Moksh Solutions" --phone 7027690991 [--range 2]
//
// --create makes the business and its owner login: the auth user is the one
// clinic-otp would make for that phone (<91phone>@wa.sehatsandhi.in), so the
// first login by WhatsApp code lands on this account.
//
// --range picks the block of fake patient numbers (9000<range>0NNNN) so two demo
// hospitals never share a family. They follow the 90000000xx convention of the
// seed accounts: not anyone's real number to message. The WhatsApp add-on is
// left off, and anything a trigger queued for a patient is cleared at the end.
//
// The set-up (modules, term, doctors, wards, lab, pharmacy) can run again
// safely. The patient activity runs once per business: a second run sees the
// demo file numbers and stops there.
//
// Refuses to run against production.

import { readFileSync } from 'node:fs'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.supabase', quiet: true })
const PROD_REF = 'ctxkkqqtasegoowuqbmi'
const url = process.env.SUPABASE_DB_URL_SANDBOX
if (!url || url.includes(PROD_REF)) { console.error('SUPABASE_DB_URL_SANDBOX missing or points at production.'); process.exit(1) }

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const RANGE = Number(arg('range') ?? 1)
// The sandbox's pooler drops a connection now and then on a long run: a step
// that loses its connection reconnects and is tried once more.
let db
async function connect() {
  db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, keepAlive: true, query_timeout: 120000 })
  db.on('error', () => {})
  await db.connect()
}
await connect()
const START = (await db.query('select now() t')).rows[0].t
const dropped = (e) => /Connection terminated|ECONNRESET|connection.*closed|Client has encountered a connection error|Query read timeout/i.test(e.message)
async function retrying(fn) {
  try { return await fn() } catch (e) {
    if (!dropped(e)) throw e
    console.log('   (connection dropped — reconnecting)')
    try { await db.end() } catch { /* already gone */ }
    await connect()
    return await fn()
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
const raw = (sql, p = []) => retrying(async () => (await db.query(sql, p)).rows)
const rawOne = async (sql, p = []) => (await raw(sql, p))[0]
let OWNER = null
const as = (sql, p = []) => retrying(async () => {
  await db.query('begin')
  try {
    await db.query('set local role authenticated')
    await db.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: OWNER.uid, role: 'authenticated', email: OWNER.email ?? '' })])
    const r = await db.query(sql, p)
    await db.query('commit')
    return r.rows
  } catch (e) {
    if (dropped(e)) throw e
    await db.query('rollback')
    throw new Error(`${e.message}\n    while: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
})
const asOne = async (sql, p = []) => (await as(sql, p))[0]
const val = (row) => row ? Object.values(row)[0] : null

let seed = 20261024 + RANGE
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const log = (...m) => console.log('  ', ...m)

// ── the business ────────────────────────────────────────────────────────────
let BIZ
if (arg('create')) {
  const name = arg('create'); const phone = String(arg('phone') ?? '').replace(/\D/g, '').slice(-10)
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Error('--phone must be a 10-digit Indian mobile')
  const email = `91${phone}@wa.sehatsandhi.in`
  let user = await rawOne(`select id from auth.users where lower(email) = lower($1)`, [email])
  if (!user) {
    const r = await fetch(`${process.env.SANDBOX_SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: process.env.SANDBOX_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SANDBOX_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, email_confirm: true, user_metadata: { phone: `91${phone}`, via: 'clinic-otp' } }),
    })
    if (!r.ok) throw new Error(`could not create the login: ${r.status} ${await r.text()}`)
    user = { id: (await r.json()).id }
  }
  BIZ = await rawOne(`select id from businesses where phone = $1 and name = $2`, [phone, name])
  if (!BIZ) {
    BIZ = await rawOne(`insert into businesses (name, phone, vertical, status, auth_uid, address, own_city, own_district, own_state,
        own_pin_code, pin_codes, reg_number, working_hours, months_paid, renewal_term_months, pricing_plan_code)
      values ($1, $2, 'hospital', 'active', $3, 'Jagadhri Road, near Bus Stand, Yamuna Nagar', 'Yamuna Nagar', 'Ambala Division', 'Haryana',
        '135001', '{135001,135002,135003,135004,135021}', 'HR-HOSP-2026-118',
        'Monday–Saturday: 9:00 am – 8:00 pm; Sunday: 10:00 am – 1:00 pm; Emergency 24x7', 1, 1, 'launch')
      returning id`, [name, phone, user.id])
  } else {
    await raw(`update businesses set auth_uid = $2 where id = $1`, [BIZ.id, user.id])
  }
  OWNER = { uid: user.id, email }
} else {
  BIZ = await rawOne(`select id from businesses where id = $1`, [arg('business')])
  if (!BIZ) throw new Error('--business <uuid> or --create <name> --phone <mobile>')
  const b = await rawOne(`select auth_uid, email from businesses where id = $1`, [BIZ.id])
  if (!b.auth_uid) throw new Error('this business has no owner login (auth_uid)')
  OWNER = { uid: b.auth_uid, email: b.email }
}
const B = BIZ.id
const bizName = (await rawOne(`select name from businesses where id = $1`, [B])).name
const PREFIX = bizName.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('').slice(0, 3) || 'DM'
console.log(`\n${bizName} (${B}) — file numbers ${PREFIX}-1001…, phones 9000${RANGE}0xxxx`)

// ── 1. Modules, type, term ──────────────────────────────────────────────────
console.log('1. hospital set-up')
await raw(`update businesses set vertical = 'hospital', status = 'active',
    opd_module = true, ipd_module = true,
    lab_module = true, lab_module_set_by = 'demo seed', lab_categories = '{pathology,radiology,cardiology}',
    lab_home_fee = 150, lab_offer = '15% off health packages',
    pharmacy_module = true, pharmacy_module_since = coalesce(pharmacy_module_since, now()), pharmacy_module_set_by = 'demo seed',
    pharmacy_gstin = coalesce(pharmacy_gstin, '06AABCD1234E1Z5'), pharmacy_drug_licence = coalesce(pharmacy_drug_licence, 'HR-YNR-20B-2026-0418'),
    term_start = coalesce(term_start, current_date), term_end = '2026-12-31', locked_at = null
  where id = $1`, [B])
const role = val(await asOne(`select sehat_caller_role($1)`, [B]))
if (role !== 'owner') throw new Error(`the owner login is not recognised as owner (got ${role}) — password expired?`)
log('OPD, IPD, lab, pharmacy on; term to 31 Dec 2026; owner login ok')

// ── 2. Doctors and staff (as the database: staff changes skip the emailed code) ─
const TEAMS = {
  1: [
    ['Dr. Rajesh Malhotra', 'GEN', 'MD (General Medicine)', 500, 'doctor'],
    ['Dr. Sandeep Goyal', 'SURG', 'MS (General Surgery)', 600, 'doctor'],
    ['Dr. Amit Chawla', 'ORTH', 'MS (Orthopaedics)', 600, 'doctor'],
    ['Dr. Neha Bansal', 'GYN', 'MS (Obstetrics & Gynaecology)', 500, 'doctor'],
    ['Dr. Pooja Arora', 'PAED', 'MD (Paediatrics)', 400, 'doctor'],
    ['Dr. Kavita Sehgal', 'PATH', 'MD (Pathology)', 0, 'doctor'],
    ['Dr. Vivek Kapoor', 'RAD', 'MD (Radiodiagnosis)', 0, 'doctor'],
    ['Sister Manpreet Kaur', null, 'GNM', 0, 'nurse'],
    ['Rohit Sharma', null, 'B.Pharm', 0, 'pharmacist'],
    ['Anjali Verma', null, null, 0, 'receptionist'],
  ],
  2: [
    ['Dr. Vikas Mittal', 'GEN', 'MD (General Medicine)', 500, 'doctor'],
    ['Dr. Harpreet Sandhu', 'SURG', 'MS (General Surgery)', 700, 'doctor'],
    ['Dr. Manish Jindal', 'ORTH', 'MS (Orthopaedics)', 600, 'doctor'],
    ['Dr. Shalini Gupta', 'GYN', 'MS (Obstetrics & Gynaecology)', 500, 'doctor'],
    ['Dr. Ankur Batra', 'PAED', 'MD (Paediatrics)', 400, 'doctor'],
    ['Dr. Ritu Khanna', 'PATH', 'MD (Pathology)', 0, 'doctor'],
    ['Dr. Sanjay Dhingra', 'RAD', 'MD (Radiodiagnosis)', 0, 'doctor'],
    ['Sister Gurpreet Kaur', null, 'GNM', 0, 'nurse'],
    ['Deepak Saini', null, 'D.Pharm', 0, 'pharmacist'],
    ['Komal Rani', null, null, 0, 'receptionist'],
  ],
}
const team = TEAMS[RANGE] ?? TEAMS[1]
const STAFF = {}
for (const [i, [full_name, speciality, qualification, fee, staffRole]] of team.entries()) {
  let p = await rawOne(`select p.id from practitioners p join business_practitioners bp on bp.practitioner_id = p.id
                         where bp.business_id = $1 and p.full_name = $2`, [B, full_name])
  if (!p) {
    p = await rawOne(`insert into practitioners (full_name, speciality, qualification, reg_number, status)
                      values ($1, $2, $3, $4, 'active') returning id`,
      [full_name, speciality, qualification, staffRole === 'doctor' ? `HMC-${2008 + i}-${String(40000 + RANGE * 1000 + i * 37)}` : null])
    const bp = await rawOne(`insert into business_practitioners (business_id, practitioner_id, role, consultation_fee, status, can_login_web)
                             values ($1, $2, $3, $4, 'active', false) returning id`, [B, p.id, staffRole, fee])
    await raw(`update business_practitioners set status = 'active', awaiting_payment = false where id = $1`, [bp.id])
    if (staffRole === 'doctor' && fee > 0) {
      // Mon–Sat; mornings for everyone, evenings for medicine and gynae.
      for (let d = 1; d <= 6; d++) {
        await raw(`insert into availability (business_id, business_practitioner_id, day_of_week, start_time, end_time, slot_duration_minutes, slot_capacity, is_active)
                   values ($1, $2, $3, '10:00', '14:00', 15, 2, true)`, [B, bp.id, d])
        if (['GEN', 'GYN'].includes(speciality)) await raw(`insert into availability (business_id, business_practitioner_id, day_of_week, start_time, end_time, slot_duration_minutes, slot_capacity, is_active)
                   values ($1, $2, $3, '17:00', '19:30', 15, 2, true)`, [B, bp.id, d])
      }
    }
  }
  STAFF[speciality ?? staffRole] = { id: p.id, name: full_name, qualification }
}
// A doctor already at the business (e.g. an eye surgeon) joins the rota as is.
const existing = await raw(`select p.id, p.full_name, p.speciality, p.qualification from business_practitioners bp join practitioners p on p.id = bp.practitioner_id
                            where bp.business_id = $1 and bp.role = 'doctor' and p.speciality = 'EYE' limit 1`, [B])
if (existing[0]) STAFF.EYE = { id: existing[0].id, name: existing[0].full_name, qualification: existing[0].qualification }
log(`${Object.keys(STAFF).length} doctors and staff`)

// ── 3. Wards and beds ───────────────────────────────────────────────────────
const WARDS = [
  ['General Ward', 'general', 'Ground floor', 8, 'G-', 1200],
  ['Private Rooms', 'private', 'First floor', 4, 'P-10', 3500],
  ['ICU', 'icu', 'First floor', 3, 'ICU-', 6000],
  ['Maternity Ward', 'maternity', 'Second floor', 3, 'M-', 2000],
]
for (const [i, [name, kind, floor, n, pre, charge]] of WARDS.entries()) {
  let w = await asOne(`select id from wards where business_id = $1 and name = $2`, [B, name])
  if (!w) {
    w = await asOne(`insert into wards (business_id, name, kind, floor, sort_order) values ($1, $2, $3, $4, $5) returning id`, [B, name, kind, floor, i])
    for (let k = 1; k <= n; k++) await as(`insert into beds (ward_id, business_id, label, daily_charge, is_active) values ($1, $2, $3, $4, true)`, [w.id, B, `${pre}${k}`, charge])
  }
}
const bed = async (label) => (await asOne(`select id from beds where business_id = $1 and label = $2`, [B, label])).id
log('4 wards, 18 beds')

// ── 4. Lab: catalogue, packages ─────────────────────────────────────────────
const imported = val(await asOne(`select sehat_lab_import_catalogue($1, null)`, [B]))
const testId = {}
for (const t of await as(`select id, catalogue_code from lab_tests where business_id = $1 and catalogue_code is not null`, [B])) testId[t.catalogue_code] = t.id
let packages = 0
for (const t of await raw(`select name, description, codes from lab_package_templates where is_active order by sort_order limit 5`)) {
  if (await asOne(`select 1 from lab_packages where business_id = $1 and lower(name) = lower($2)`, [B, t.name])) continue
  const ids = t.codes.map(c => testId[c]).filter(Boolean)
  if (!ids.length) continue
  const sum = Number(val(await asOne(`select sum(price) from lab_tests where id = any($1::uuid[])`, [ids])))
  await as(`select sehat_lab_save_package($1, $2::jsonb, $3::uuid[])`,
    [B, JSON.stringify({ name: t.name, description: t.description, price: Math.round(sum * 0.85 / 10) * 10, is_active: true }), ids])
  packages++
}
log(`lab: ${imported} tests imported (${Object.keys(testId).length} in the catalogue), ${packages} packages`)

// ── 5. Pharmacy: medicines and stock ────────────────────────────────────────
// [name, generic, strength, form, unit, pack_size, gst, reorder, packs, pack_mrp, expiry]
const MEDS = [
  ['Dolo 650', 'Paracetamol', '650 mg', 'tablet', 'tablet', 15, 12, 60, 40, 33.6, '2028-03-31'],
  ['Crocin Advance', 'Paracetamol', '500 mg', 'tablet', 'tablet', 15, 12, 45, 20, 24.5, '2027-11-30'],
  ['Azithral 500', 'Azithromycin', '500 mg', 'tablet', 'tablet', 5, 12, 15, 20, 119.5, '2027-08-31'],
  ['Augmentin 625 Duo', 'Amoxicillin + Clavulanic acid', '625 mg', 'tablet', 'tablet', 10, 12, 20, 15, 223.4, '2027-06-30'],
  ['Zifi 200', 'Cefixime', '200 mg', 'tablet', 'tablet', 10, 12, 20, 15, 109.0, '2027-09-30'],
  ['Pan 40', 'Pantoprazole', '40 mg', 'tablet', 'tablet', 15, 12, 45, 30, 155.0, '2028-01-31'],
  ['Pan-D', 'Pantoprazole + Domperidone', '40/30 mg', 'capsule', 'capsule', 15, 12, 30, 25, 199.0, '2027-12-31'],
  ['Ondem 4', 'Ondansetron', '4 mg', 'tablet', 'tablet', 10, 12, 20, 15, 58.0, '2027-10-31'],
  ['Glycomet GP 1', 'Glimepiride + Metformin', '1/500 mg', 'tablet', 'tablet', 15, 12, 60, 30, 112.0, '2028-02-29'],
  ['Telma 40', 'Telmisartan', '40 mg', 'tablet', 'tablet', 15, 12, 45, 25, 128.5, '2028-04-30'],
  ['Amlokind 5', 'Amlodipine', '5 mg', 'tablet', 'tablet', 15, 12, 45, 25, 38.2, '2027-12-31'],
  ['Atorva 10', 'Atorvastatin', '10 mg', 'tablet', 'tablet', 15, 12, 45, 20, 118.0, '2028-01-31'],
  ['Ecosprin 75', 'Aspirin', '75 mg', 'tablet', 'tablet', 14, 12, 42, 20, 5.4, '2027-07-31'],
  ['Thyronorm 50', 'Levothyroxine', '50 mcg', 'tablet', 'tablet', 100, 12, 100, 6, 182.0, '2027-05-31'],
  ['Montair LC', 'Montelukast + Levocetirizine', '10/5 mg', 'tablet', 'tablet', 15, 12, 30, 15, 214.0, '2027-10-31'],
  ['Okacet 10', 'Cetirizine', '10 mg', 'tablet', 'tablet', 10, 12, 30, 20, 19.9, '2028-06-30'],
  ['Zerodol SP', 'Aceclofenac + Paracetamol + Serratiopeptidase', '100/325/15 mg', 'tablet', 'tablet', 10, 12, 30, 20, 118.0, '2027-09-30'],
  ['Combiflam', 'Ibuprofen + Paracetamol', '400/325 mg', 'tablet', 'tablet', 20, 12, 40, 15, 42.0, '2027-11-30'],
  ['Meftal Spas', 'Mefenamic acid + Dicyclomine', '250/10 mg', 'tablet', 'tablet', 10, 12, 20, 15, 46.5, '2027-08-31'],
  ['O2', 'Ofloxacin + Ornidazole', '200/500 mg', 'tablet', 'tablet', 10, 12, 20, 15, 121.0, '2027-07-31'],
  ['Shelcal 500', 'Calcium carbonate + Vitamin D3', '500 mg', 'tablet', 'tablet', 15, 12, 45, 25, 124.0, '2028-03-31'],
  ['Neurobion Forte', 'Vitamin B complex + B12', '', 'tablet', 'tablet', 30, 12, 60, 15, 39.6, '2027-12-31'],
  ['Becosules', 'Vitamin B complex + C', '', 'capsule', 'capsule', 20, 12, 40, 15, 54.0, '2027-06-30'],
  ['Ascoril LS Syrup', 'Ambroxol + Levosalbutamol + Guaifenesin', '100 ml', 'syrup', 'bottle', 1, 12, 5, 20, 128.0, '2027-04-30'],
  ['Calpol 250 Syrup', 'Paracetamol', '60 ml', 'syrup', 'bottle', 1, 12, 5, 20, 46.0, '2027-03-31'],
  ['Benadryl Cough Syrup', 'Diphenhydramine', '150 ml', 'syrup', 'bottle', 1, 12, 5, 12, 149.0, '2027-05-31'],
  ['Electral ORS', 'Oral rehydration salts', '21.8 g', 'sachet', 'sachet', 1, 12, 20, 60, 21.0, '2027-12-31'],
  ['Inj. Pantop 40', 'Pantoprazole', '40 mg', 'injection', 'vial', 1, 12, 10, 40, 52.0, '2027-09-30'],
  ['Inj. Monocef 1 g', 'Ceftriaxone', '1 g', 'injection', 'vial', 1, 12, 10, 40, 67.5, '2027-08-31'],
  ['Inj. Emeset', 'Ondansetron', '2 ml', 'injection', 'ampoule', 1, 12, 10, 40, 16.0, '2027-10-31'],
  ['Inj. Voveran', 'Diclofenac', '3 ml', 'injection', 'ampoule', 1, 12, 10, 40, 12.8, '2027-06-30'],
  ['NS 0.9% 500 ml', 'Sodium chloride', '500 ml', 'IV fluid', 'bottle', 1, 12, 20, 60, 34.0, '2028-01-31'],
  ['Ringer Lactate 500 ml', 'Compound sodium lactate', '500 ml', 'IV fluid', 'bottle', 1, 12, 20, 40, 39.0, '2028-01-31'],
  ['DNS 500 ml', 'Dextrose + Sodium chloride', '500 ml', 'IV fluid', 'bottle', 1, 12, 20, 30, 36.0, '2027-12-31'],
  ['Timolet 0.5% Eye Drops', 'Timolol', '5 ml', 'eye drops', 'bottle', 1, 12, 5, 15, 62.0, '2027-06-30'],
  ['Vigamox Eye Drops', 'Moxifloxacin', '5 ml', 'eye drops', 'bottle', 1, 12, 5, 15, 183.0, '2027-04-30'],
  ['Refresh Tears', 'Carboxymethylcellulose', '10 ml', 'eye drops', 'bottle', 1, 12, 5, 15, 151.0, '2027-09-30'],
  ['Betadine Ointment', 'Povidone iodine', '15 g', 'ointment', 'tube', 1, 12, 5, 15, 76.0, '2027-11-30'],
  ['Soframycin Cream', 'Framycetin', '30 g', 'cream', 'tube', 1, 12, 5, 10, 71.0, '2027-07-31'],
  // Expiring soon and low on stock — so the alerts have something to show.
  ['Cyclopam', 'Dicyclomine + Paracetamol', '20/500 mg', 'tablet', 'tablet', 10, 12, 20, 6, 41.0, '2026-12-15'],
  ['Levocet M', 'Levocetirizine + Montelukast', '5/10 mg', 'tablet', 'tablet', 10, 12, 60, 2, 135.0, '2027-10-31'],
]
const MED = {}
for (const [name, generic, strength, form, unit, pack, gst, reorder] of MEDS) {
  let it = await asOne(`select id from pharmacy_items where business_id = $1 and lower(name) = lower($2)`, [B, name])
  if (!it) it = { id: val(await asOne(`select sehat_pharmacy_save_item($1, $2::jsonb)`, [B, JSON.stringify({
    name, generic_name: generic, strength: strength || null, form, unit, pack_size: pack, hsn_code: '3004', gst_rate: gst, reorder_level: reorder, is_active: true })])) }
  MED[name] = it.id
}
const stocked = Number(val(await asOne(`select count(*) from pharmacy_batches b join pharmacy_items i on i.id = b.item_id where i.business_id = $1`, [B])))
if (!stocked) {
  const half = Math.ceil(MEDS.length / 2)
  for (const [s, rows] of [['Shree Balaji Pharma Distributors', MEDS.slice(0, half)], ['Gupta Medical Agencies', MEDS.slice(half)]]) {
    const lines = rows.map(([name, , , , , , , , packs, mrp, expiry], k) => ({
      item_id: MED[name], batch_no: `${name.replace(/[^A-Z0-9]/gi, '').slice(0, 4)}${between(1000, 9999)}`, expiry_date: expiry,
      packs, free_packs: k % 5 === 0 ? 2 : 0, pack_cost: Math.round(mrp * 0.72 * 100) / 100, pack_mrp: mrp,
    }))
    await as(`select sehat_pharmacy_record_purchase($1, $2, $3, (current_date - 20), $4::jsonb, 'Opening stock')`,
      [B, s, `INV/${between(2400, 2999)}`, JSON.stringify(lines)])
  }
}
log(`pharmacy: ${MEDS.length} medicines${stocked ? ' (stock already there)' : ', stocked from 2 suppliers'}`)

// ── Patient activity runs once per business ─────────────────────────────────
const already = await rawOne(`select 1 from business_patients where business_id = $1 and mrn = $2`, [B, `${PREFIX}-1001`])
if (already) {
  console.log(`Patient activity is already there (${PREFIX}-1001 exists) — set-up refreshed only.`)
  await db.end(); process.exit(0)
}

// ── 6. Patients ─────────────────────────────────────────────────────────────
// [name, gender, age, blood, family (same number as the one before), relation, pin]
const PEOPLE = [
  ['Ramesh Kumar Sharma', 'male', 58, 'B+', 0, 'self', '135001'],
  ['Sunita Sharma', 'female', 54, 'O+', 1, 'spouse', '135001'],
  ['Harpreet Singh', 'male', 46, 'A+', 0, 'self', '135002'],
  ['Kuldeep Kaur', 'female', 41, 'B+', 1, 'spouse', '135002'],
  ['Jaskaran Singh', 'male', 9, 'A+', 1, 'child', '135002'],
  ['Meena Devi', 'female', 67, 'AB+', 0, 'self', '135003'],
  ['Anil Gupta', 'male', 49, 'O+', 0, 'self', '135001'],
  ['Priya Gupta', 'female', 27, 'B-', 0, 'self', '135004'],
  ['Mohd. Irfan', 'male', 36, 'O+', 0, 'self', '135021'],
  ['Rekha Rani', 'female', 31, 'A+', 0, 'self', '135001'],
  ['Aarav Rani', 'male', 2, 'A+', 1, 'child', '135001'],
  ['Satish Chand', 'male', 72, 'B+', 0, 'self', '135003'],
  ['Kamlesh Devi', 'female', 63, 'O-', 0, 'self', '135002'],
  ['Vikram Saini', 'male', 34, 'A-', 0, 'self', '135101'],
  ['Neelam Saini', 'female', 29, 'B+', 1, 'spouse', '135101'],
  ['Rajinder Pal', 'male', 61, 'AB-', 0, 'self', '135001'],
  ['Pooja Mehta', 'female', 24, 'O+', 0, 'self', '135004'],
  ['Gurdeep Singh', 'male', 52, 'B+', 0, 'self', '135002'],
  ['Shanti Devi', 'female', 78, 'A+', 0, 'self', '135003'],
  ['Rohit Kamboj', 'male', 19, 'O+', 0, 'self', '135021'],
  ['Anita Bhatia', 'female', 45, 'B+', 0, 'self', '135001'],
  ['Sukhwinder Kaur', 'female', 38, 'A+', 0, 'self', '135002'],
  ['Ravi Verma', 'male', 43, 'O+', 0, 'self', '135001'],
  ['Kavya Verma', 'female', 6, 'O+', 1, 'child', '135001'],
  ['Om Prakash', 'male', 66, 'B-', 0, 'self', '135003'],
  ['Simran Arora', 'female', 33, 'AB+', 0, 'self', '135004'],
  ['Deepak Jain', 'male', 55, 'A+', 0, 'self', '135001'],
  ['Nisha Rani', 'female', 26, 'B+', 0, 'self', '135101'],
  ['Balwinder Singh', 'male', 48, 'O+', 0, 'self', '135002'],
  ['Lakshmi Devi', 'female', 59, 'A-', 0, 'self', '135003'],
]
const P = []
let phoneNo = 0, lastPhone = null
for (const [i, [name, gender, age, blood, family, relation, pin]] of PEOPLE.entries()) {
  const phone = family ? lastPhone : `9000${RANGE}${String(10001 + phoneNo++).slice(-5)}`
  lastPhone = phone
  const id = val(await asOne(`select sehat_register_patient($1, $2, $3, $4, $5, $6, null, $7, $8, $9, $10)`,
    [B, phone, name, relation, gender, age, blood, `${PREFIX}-${1001 + i}`, i % 4 === 0 ? 'appointment' : 'walk_in', pin]))
  P.push({ id, name, gender, age, phone })
}
await raw(`update business_patients set first_seen_at = now() - make_interval(days => (95 - row_number * 2)::int)
           from (select id, row_number() over (order by mrn) from business_patients where business_id = $1 and mrn like $2) x
           where business_patients.id = x.id`, [B, `${PREFIX}-%`])
const byName = (n) => P.find(p => p.name === n)
log(`${P.length} patients (${new Set(P.map(p => p.phone)).size} families)`)

// Allergies and long-term conditions.
const ALLERGIES = [['Ramesh Kumar Sharma', 'Penicillin', 'drug', 'Skin rash', 'moderate'], ['Meena Devi', 'Sulfa drugs', 'drug', 'Itching, hives', 'mild'],
  ['Priya Gupta', 'Peanuts', 'food', 'Swelling of lips', 'severe'], ['Satish Chand', 'Aspirin', 'drug', 'Gastric bleeding', 'severe'], ['Anita Bhatia', 'Dust', 'environment', 'Sneezing, wheeze', 'mild']]
for (const [n, s, c, r, sev] of ALLERGIES) await as(`insert into patient_allergies (patient_member_id, business_id, substance, category, reaction, severity) values ($1, $2, $3, $4, $5, $6)`, [byName(n).id, B, s, c, r, sev])
const CONDS = [['Ramesh Kumar Sharma', 'Type 2 diabetes mellitus', 'E11.9', 2016], ['Ramesh Kumar Sharma', 'Essential hypertension', 'I10', 2018], ['Sunita Sharma', 'Hypothyroidism', 'E03.9', 2019],
  ['Meena Devi', 'Osteoarthritis of knee', 'M17.9', 2020], ['Anil Gupta', 'Dyslipidaemia', 'E78.5', 2022], ['Satish Chand', 'Chronic obstructive pulmonary disease', 'J44.9', 2015],
  ['Kamlesh Devi', 'Type 2 diabetes mellitus', 'E11.9', 2012], ['Rajinder Pal', 'Coronary artery disease', 'I25.1', 2021], ['Gurdeep Singh', 'Essential hypertension', 'I10', 2019],
  ['Shanti Devi', 'Glaucoma', 'H40.1', 2023], ['Simran Arora', 'Polycystic ovarian syndrome', 'E28.2', 2024], ['Deepak Jain', 'Fatty liver', 'K76.0', 2024]]
for (const [n, c, icd, y] of CONDS) await as(`insert into patient_conditions (patient_member_id, business_id, condition, icd10_code, status, onset_date) values ($1, $2, $3, $4, 'active', $5)`, [byName(n).id, B, c, icd, `${y}-06-01`])
log(`${ALLERGIES.length} allergies, ${CONDS.length} long-term conditions`)

// ── 7. Past OPD visits, vitals, prescriptions, bills ────────────────────────
// [complaint, diagnosis, icd, doctor speciality, advice, rx [drug, strength, dosage, duration, qty, instructions]]
const CASES = {
  fever: ['Fever with body ache for 3 days', 'Viral fever', 'B34.9', 'GEN', 'Plenty of fluids, rest. Review if fever persists beyond 3 days.',
    [['Dolo 650', '650 mg', '1-1-1', '5 days', '15', 'After food'], ['Pan 40', '40 mg', '1-0-0', '5 days', '5', 'Before breakfast']]],
  diabetes: ['Routine diabetes review, tingling in feet', 'Type 2 diabetes mellitus', 'E11.9', 'GEN', 'Diabetic diet, 30 min walk daily. HbA1c after 3 months.',
    [['Glycomet GP 1', '1/500 mg', '1-0-1', '30 days', '60', 'After food'], ['Neurobion Forte', '', '0-1-0', '30 days', '30', 'After lunch']]],
  bp: ['Headache, BP high at home', 'Essential hypertension', 'I10', 'GEN', 'Low salt diet, BP log twice a day.',
    [['Telma 40', '40 mg', '1-0-0', '30 days', '30', 'Morning'], ['Amlokind 5', '5 mg', '0-0-1', '30 days', '30', 'Night']]],
  urti: ['Sore throat, cough and cold', 'Acute upper respiratory infection', 'J06.9', 'GEN', 'Steam inhalation, warm saline gargles.',
    [['Azithral 500', '500 mg', '1-0-0', '3 days', '3', 'One hour before food'], ['Montair LC', '10/5 mg', '0-0-1', '5 days', '5', 'Night'], ['Ascoril LS Syrup', '100 ml', '10 ml TDS', '5 days', '1', '']]],
  gastritis: ['Burning in upper abdomen after meals', 'Gastritis', 'K29.7', 'GEN', 'Avoid spicy and oily food, no tea on empty stomach.',
    [['Pan-D', '40/30 mg', '1-0-0', '14 days', '14', 'Before breakfast'], ['Meftal Spas', '250/10 mg', 'SOS', '3 days', '6', 'For pain']]],
  knee: ['Pain in both knees, worse on stairs', 'Primary osteoarthritis of knee', 'M17.0', 'ORTH', 'Quadriceps exercises, weight reduction, knee cap.',
    [['Zerodol SP', '100/325/15 mg', '1-0-1', '7 days', '14', 'After food'], ['Shelcal 500', '500 mg', '0-1-0', '30 days', '30', 'After lunch']]],
  back: ['Low back pain for 2 weeks', 'Lumbago', 'M54.5', 'ORTH', 'Hot fomentation, avoid lifting weights, physiotherapy.',
    [['Combiflam', '400/325 mg', '1-0-1', '5 days', '10', 'After food'], ['Pan 40', '40 mg', '1-0-0', '5 days', '5', 'Before breakfast']]],
  pcos: ['Irregular periods for 6 months', 'Polycystic ovarian syndrome', 'E28.2', 'GYN', 'Weight reduction, regular exercise. USG pelvis advised.',
    [['Glycomet GP 1', '1/500 mg', '0-1-0', '30 days', '30', 'After lunch']]],
  anc: ['Routine antenatal check-up, 24 weeks', 'Supervision of normal pregnancy', 'Z34.9', 'GYN', 'Iron and calcium daily, next visit in 4 weeks.',
    [['Shelcal 500', '500 mg', '0-1-0', '30 days', '30', 'After lunch']]],
  child: ['Loose stools and vomiting since yesterday', 'Acute gastroenteritis', 'A09', 'PAED', 'ORS after every loose stool, continue feeding.',
    [['Electral ORS', '21.8 g', 'After each loose stool', '3 days', '6', 'Dissolve in 1 litre water'], ['Calpol 250 Syrup', '60 ml', '5 ml SOS', '3 days', '1', 'For fever']]],
  hernia: ['Swelling in right groin on standing', 'Right inguinal hernia', 'K40.9', 'SURG', 'Advised elective hernia repair. Avoid heavy lifting.', []],
}
const VISIT_PLAN = [
  ['Ramesh Kumar Sharma', 'diabetes', 80], ['Ramesh Kumar Sharma', 'bp', 35], ['Sunita Sharma', 'urti', 62], ['Harpreet Singh', 'back', 50],
  ['Kuldeep Kaur', 'gastritis', 44], ['Jaskaran Singh', 'child', 28], ['Meena Devi', 'knee', 70], ['Meena Devi', 'knee', 20],
  ['Anil Gupta', 'gastritis', 58], ['Priya Gupta', 'pcos', 40], ['Mohd. Irfan', 'fever', 12], ['Rekha Rani', 'anc', 30],
  ['Aarav Rani', 'child', 9], ['Satish Chand', 'urti', 66], ['Kamlesh Devi', 'diabetes', 48], ['Vikram Saini', 'back', 25],
  ['Neelam Saini', 'anc', 18], ['Rajinder Pal', 'bp', 54], ['Pooja Mehta', 'fever', 7], ['Gurdeep Singh', 'bp', 33],
  ['Rohit Kamboj', 'fever', 15], ['Anita Bhatia', 'urti', 22], ['Sukhwinder Kaur', 'gastritis', 11], ['Ravi Verma', 'hernia', 26],
  ['Kavya Verma', 'child', 5], ['Om Prakash', 'knee', 38], ['Simran Arora', 'pcos', 17], ['Deepak Jain', 'gastritis', 4],
  ['Nisha Rani', 'urti', 3], ['Balwinder Singh', 'bp', 2], ['Lakshmi Devi', 'diabetes', 6],
]
const RX = []
let bills = 0, dues = 0
for (const [k, [who, c, daysAgo]] of VISIT_PLAN.entries()) {
  const p = byName(who), [complaint, dx, icd, spec, advice, items] = CASES[c], doc = STAFF[spec]
  const fee = Number((await rawOne(`select consultation_fee from business_practitioners where business_id = $1 and practitioner_id = $2`, [B, doc.id])).consultation_fee)
  const visit = await asOne(`insert into patient_visits (patient_member_id, business_id, visit_date, visit_type, chief_complaint, diagnosis, icd10_code, advice, follow_up_due, practitioner_id)
      values ($1, $2, current_date - $3::int, $4, $5, $6, $7, $8, current_date - $3::int + 14, $9) returning id`,
    [p.id, B, daysAgo, k % 6 === 5 ? 'followup' : 'opd', complaint, dx, icd, advice, doc.id])
  const adult = p.age >= 14
  await as(`insert into patient_vitals (patient_member_id, business_id, visit_id, recorded_at, bp_systolic, bp_diastolic, pulse, temperature_c, weight_kg, height_cm, spo2, blood_sugar_mg_dl, blood_sugar_type)
      values ($1, $2, $3, now() - make_interval(days => $4), $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [p.id, B, visit.id, daysAgo, adult ? (c === 'bp' ? between(148, 168) : between(112, 136)) : null, adult ? (c === 'bp' ? between(92, 102) : between(72, 86)) : null,
     between(72, 98), c === 'fever' || c === 'child' ? 38.4 : 36.8, adult ? between(52, 88) : between(11, 26), adult ? between(150, 178) : between(85, 125), between(95, 99),
     c === 'diabetes' ? between(160, 230) : null, c === 'diabetes' ? 'random' : null])
  if (items.length) {
    const rx = val(await asOne(`select sehat_issue_prescription($1, $2, $3, $4::jsonb, $5, $6, $7, current_date - $8::int + 14)`,
      [p.id, B, doc.id, JSON.stringify(items.map(([drug_name, strength, dosage, duration, quantity, instructions]) => ({ drug_name, strength, form: null, dosage, duration, quantity, instructions }))),
       visit.id, dx, advice, daysAgo]))
    RX.push({ rx, p, items })
  }
  // The consultation, billed and mostly paid; a few left as dues.
  await as(`insert into patient_charges (business_id, patient_member_id, visit_id, category, description, quantity, unit_price, amount, list_price, charged_on, practitioner_id)
      values ($1, $2, $3, 'consultation', $4, 1, $5, $5, $5, current_date - $6::int, $7)`, [B, p.id, visit.id, `Consultation — ${doc.name}`, fee, daysAgo, doc.id])
  const bill = val(await asOne(`select sehat_issue_patient_bill($1, $2, null, $3)`, [p.id, B, visit.id]))
  bills++
  if (k % 7 === 3) { dues++; continue }
  await as(`insert into patient_payments (business_id, patient_member_id, amount, method, received_on, bill_id, kind) values ($1, $2, $3, $4, current_date - $5::int, $6, 'payment')`,
    [B, p.id, fee, pick(['cash', 'upi', 'upi', 'card']), daysAgo, bill])
}
log(`${VISIT_PLAN.length} past visits with vitals, ${RX.length} prescriptions, ${bills} OPD bills (${dues} unpaid)`)

// ── 8. Today's OPD queue ────────────────────────────────────────────────────
const TODAY = [['Anil Gupta', 'GEN', 'Follow-up: acidity better'], ['Kamlesh Devi', 'GEN', 'Sugar review'], ['Harpreet Singh', 'ORTH', 'Back pain review'],
  ['Simran Arora', 'GYN', 'USG report review'], ['Kavya Verma', 'PAED', 'Fever since morning'], ['Om Prakash', 'ORTH', 'Knee pain'],
  ['Pooja Mehta', 'GEN', 'Weakness'], ['Lakshmi Devi', 'GEN', 'Diabetes follow-up'], ['Jaskaran Singh', 'PAED', 'Cough'], ['Gurdeep Singh', 'GEN', 'BP check']]
for (const [k, [who, spec, reason]] of TODAY.entries()) {
  const p = byName(who)
  const t = (await asOne(`select sehat_opd_visit($1, $2, $3, null, null, $4, 0, null, $5) r`, [B, p.id, STAFF[spec].id, reason, k < 7 ? pick(['cash', 'upi']) : null])).r
  if (k < 4) {
    const v = (await asOne(`select sehat_token_visit($1) r`, [t.queue_id])).r
    await as(`insert into patient_vitals (patient_member_id, business_id, visit_id, recorded_at, bp_systolic, bp_diastolic, pulse, temperature_c, weight_kg, spo2)
              values ($1, $2, $3, now(), $4, $5, $6, 36.9, $7, 98)`, [p.id, B, v.visit_id, between(116, 142), between(74, 90), between(70, 92), between(55, 84)])
    await as(`update patient_visits set chief_complaint = $2, diagnosis = $3 where id = $1`, [v.visit_id, reason, k === 1 ? 'Type 2 diabetes mellitus' : k === 3 ? 'Polycystic ovarian syndrome' : 'Under review'])
    await as(`select sehat_set_token_status($1, 'completed', $2)`, [t.queue_id, v.visit_id])
  } else if (k === 4) {
    await as(`select sehat_set_token_status($1, 'in_consultation')`, [t.queue_id])
  }
}
log(`${TODAY.length} OPD tokens today (4 seen, 1 with the doctor, 5 waiting)`)

// ── 9. Appointments (online bookings) ───────────────────────────────────────
const APPTS = [['Rajinder Pal', 'GEN', 1, '10:30', 'confirmed'], ['Neelam Saini', 'GYN', 1, '11:00', 'booked'], ['Vikram Saini', 'ORTH', 2, '10:15', 'booked'],
  ['Sukhwinder Kaur', 'GEN', 2, '17:30', 'confirmed'], ['Aarav Rani', 'PAED', 3, '11:30', 'booked'], ['Ravi Verma', 'SURG', 3, '12:00', 'confirmed'],
  ['Deepak Jain', 'GEN', -3, '10:45', 'completed'], ['Nisha Rani', 'GYN', -2, '11:15', 'no_show'], ['Shanti Devi', 'GEN', -5, '12:30', 'completed']]
for (const [who, spec, day, time, status] of APPTS) {
  const p = byName(who)
  await raw(`insert into appointments (business_id, practitioner_id, patient_phone, patient_name, patient_age, patient_member_id, slot_datetime, status, booked_via,
              last_actor, confirmation_sent, reminder_sent, confirmed_at, completed_at, no_show_at)
    values ($1, $2, $3, $4, $5, $6, ((current_date + $7::int) + $8::time) at time zone 'Asia/Kolkata', $9, $10, 'patient', true, true,
            case when $9 in ('confirmed', 'completed') then now() end, case when $9 = 'completed' then now() end, case when $9 = 'no_show' then now() end)`,
    [B, STAFF[spec].id, p.phone, p.name, p.age, p.id, day, time, status, pick(['app', 'whatsapp_bot'])])
}
log(`${APPTS.length} appointments (6 upcoming, 3 past)`)

// ── 10. IPD, OT ─────────────────────────────────────────────────────────────
const nurse = STAFF.nurse
async function admit(who, label, spec, reason, dx, daysAgo) {
  const p = byName(who)
  const a = val(await asOne(`select sehat_admit_patient($1, $2, $3, $4, $5, $6, current_date + 2)`, [p.id, B, await bed(label), STAFF[spec].id, reason, dx]))
  await raw(`update admissions set admitted_at = now() - make_interval(days => $2, hours => 3) where id = $1`, [a, daysAgo])
  await raw(`update admission_bed_stays set from_at = now() - make_interval(days => $2, hours => 3) where admission_id = $1`, [a, daysAgo])
  return { a, p, spec }
}
async function note(a, type, body, hoursAgo) {
  await as(`insert into admission_notes (admission_id, business_id, note_type, body, recorded_at) values ($1, $2, $3, $4, now() - make_interval(hours => $5))`, [a, B, type, body, hoursAgo])
}
async function drugs(adm, list) {
  for (const [drug, dose, freq, route, given] of list) {
    const o = val(await asOne(`select sehat_order_medication($1, $2, $3, $4, null, $5, null, null, false, null, null, null, $6)`, [adm.a, drug, dose, freq, route, STAFF[adm.spec].id]))
    for (let g = 0; g < given; g++) await as(`select sehat_record_administration($1, 'given', now() - make_interval(hours => $2), $3, null, $4)`, [o, 4 + g * 12, dose, nurse.id])
  }
}
async function surgery(adm, procedure, indication, spec, ot, anaesthesia, findings, daysAgo) {
  await as(`insert into surgeries (business_id, patient_member_id, admission_id, performed_on, procedure_name, ot_type, urgency, start_time, end_time, indication,
              surgeon_id, surgeon_name, anaesthetist, anaesthesia, findings, procedure_notes, post_op_instructions, status)
            values ($1, $2, $3, current_date - $4::int, $5, $6, $7, '10:30', '12:00', $8, $9, $10, 'Dr. Arvind Bhalla (Anaesthesia)', $11, $12,
                    'Procedure completed uneventfully. Haemostasis secured. Wound closed in layers.', 'NPO for 6 hours, then liquids. Ambulate next morning.', 'done')`,
    [B, adm.p.id, adm.a, daysAgo, procedure, ot, ot === 'major' ? 'elective' : 'emergency', indication, STAFF[spec].id, STAFF[spec].name, anaesthesia, findings])
  await as(`insert into patient_charges (business_id, patient_member_id, admission_id, category, description, quantity, unit_price, amount, list_price, charged_on, practitioner_id)
            values ($1, $2, $3, 'procedure', $4, 1, $5, $5, $5, current_date - $6::int, $7)`, [B, adm.p.id, adm.a, `${procedure} — surgeon, OT and anaesthesia`, 35000, daysAgo, STAFF[spec].id])
}

const typhoid = await admit('Mohd. Irfan', 'G-2', 'GEN', 'High-grade fever with vomiting', 'Enteric fever', 3)
await note(typhoid.a, 'progress', 'Fever spikes reduced, tolerating oral diet. Widal positive. Continue IV antibiotics.', 6)
await note(typhoid.a, 'nursing', 'Temp 38.2 °C at 2 am, cold sponging done. IV line patent.', 14)
await drugs(typhoid, [['Inj. Monocef 1 g', '1 g', 'BD', 'iv', 5], ['Inj. Pantop 40', '40 mg', 'OD', 'iv', 3], ['NS 0.9% 500 ml', '500 ml', 'Q8H', 'iv', 6]])

const dengue = await admit('Rohit Kamboj', 'G-5', 'GEN', 'Fever, body ache, low platelets', 'Dengue fever with thrombocytopenia', 2)
await note(dengue.a, 'progress', 'Platelets 62,000 today (from 48,000). No bleeding. Continue fluids, repeat CBC in morning.', 4)
await drugs(dengue, [['Ringer Lactate 500 ml', '500 ml', 'Q8H', 'iv', 4], ['Dolo 650', '650 mg', 'TDS', 'oral', 4]])

const append = await admit('Vikram Saini', 'P-101', 'SURG', 'Pain right lower abdomen, vomiting', 'Acute appendicitis', 1)
await surgery(append, 'Laparoscopic appendectomy', 'Acute appendicitis', 'SURG', 'major', 'general', 'Inflamed, non-perforated appendix.', 1)
await note(append.a, 'progress', 'Post-op day 1. Afebrile, passing flatus, drain minimal. Start liquids.', 3)
await drugs(append, [['Inj. Monocef 1 g', '1 g', 'BD', 'iv', 2], ['Inj. Voveran', '75 mg', 'BD', 'im', 2]])

const fracture = await admit('Gurdeep Singh', 'P-102', 'ORTH', 'Fall from scooter, pain and swelling left wrist', 'Fracture distal radius, left', 2)
await surgery(fracture, 'Open reduction and internal fixation (ORIF), left distal radius', 'Displaced distal radius fracture', 'ORTH', 'major', 'regional', 'Comminuted fracture; fixed with volar locking plate.', 1)
await note(fracture.a, 'progress', 'Post-op X-ray satisfactory. Finger movements encouraged. Limb elevation.', 5)
await drugs(fracture, [['Inj. Monocef 1 g', '1 g', 'BD', 'iv', 3], ['Zerodol SP', '1 tab', 'BD', 'oral', 2]])

const icu = await admit('Rajinder Pal', 'ICU-1', 'GEN', 'Chest pain and breathlessness', 'Unstable angina', 1)
await note(icu.a, 'progress', 'Chest pain settled. ECG: ST depression V4–V6. Troponin awaited. Cardiology opinion requested.', 2)
await note(icu.a, 'nursing', 'On cardiac monitor, SpO2 96% on 2 L oxygen.', 8)
await drugs(icu, [['Ecosprin 75', '75 mg', 'OD', 'oral', 1], ['Atorva 10', '40 mg', 'HS', 'oral', 1]])
for (const adm of [typhoid, dengue, append, fracture, icu]) await as(`select sehat_post_bed_charges($1)`, [adm.a])

// Two already home: operated, discharged, summary issued, billed and paid.
async function dischargeDone(who, label, spec, reason, dx, days, procedure, findings, ot, anaesthesia, method) {
  const adm = await admit(who, label, spec, reason, dx, days)
  await surgery(adm, procedure, dx, spec, ot, anaesthesia, findings, days - 1)
  await note(adm.a, 'progress', 'Recovering well. Wound healthy. Fit for discharge.', 5)
  await as(`select sehat_discharge_patient($1, 'discharged', $2, $3, 'improved', current_date + 7, $4)`,
    [adm.a, dx, `Admitted with ${reason.toLowerCase()}. ${procedure} done on day 2. Post-operative course uneventful.`, STAFF[spec].id])
  await as(`select sehat_issue_discharge_summary($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null, null)`,
    [adm.a, STAFF[spec].id, `Uneventful post-operative recovery. Afebrile, ambulant, tolerating normal diet.`, 'CBC, KFT, LFT within normal limits. USG as on record.',
     procedure, 'Tab. Augmentin 625 Duo 1-0-1 × 5 days; Tab. Zerodol SP 1-0-1 × 5 days; Tab. Pan 40 1-0-0 × 5 days.', 'Soft, light diet for a week.',
     'Walk daily; no lifting weights for 4 weeks.', 'Fever, wound discharge, severe pain or vomiting — come to emergency.', `${STAFF[spec].name}, OPD, after 7 days`])
  await as(`select sehat_post_bed_charges($1)`, [adm.a])
  await as(`insert into patient_charges (business_id, patient_member_id, admission_id, category, description, quantity, unit_price, amount, list_price, charged_on)
            values ($1, $2, $3, 'medicine', 'IPD medicines and consumables', 1, 6850, 6850, 6850, current_date - 1)`, [B, adm.p.id, adm.a])
  const bill = val(await asOne(`select sehat_issue_patient_bill($1, $2, $3, null, 500, 'Senior citizen discount')`, [adm.p.id, B, adm.a]))
  const net = Number(val(await asOne(`select net_payable from patient_bills where id = $1`, [bill])))
  await as(`insert into patient_payments (business_id, patient_member_id, admission_id, amount, method, reference, received_on, bill_id, kind)
            values ($1, $2, $3, $4, $5, $6, current_date, $7, 'payment')`, [B, adm.p.id, adm.a, net, method, method === 'insurance' ? 'Ayushman Bharat / PMJAY' : null, bill])
}
await dischargeDone('Anita Bhatia', 'P-103', 'SURG', 'Recurrent pain in right upper abdomen', 'Symptomatic cholelithiasis', 4,
  'Laparoscopic cholecystectomy', 'Multiple gall stones, thick-walled gall bladder.', 'major', 'general', 'upi')
await dischargeDone('Rekha Rani', 'M-1', 'GYN', 'Labour pains at term', 'Term pregnancy, previous LSCS', 3,
  'Lower segment caesarean section (LSCS)', 'Live male baby, 3.1 kg, cried at birth.', 'major', 'spinal', 'insurance')
log('IPD: 5 admitted (2 operated), 2 discharged with surgery, summary and paid bill')

// ── 11. Lab orders ──────────────────────────────────────────────────────────
const NARRATIVE = {
  XRCHEST: ['Both lung fields are clear. Cardiac silhouette is normal in size. Both costophrenic angles are clear. Bony thorax appears normal.', 'No significant abnormality detected.'],
  USGABD: ['Liver is normal in size (14.1 cm) with mildly increased echotexture. Gall bladder well distended, no calculus. CBD not dilated. Pancreas and spleen normal. Both kidneys normal in size and echotexture, no calculus or hydronephrosis. Urinary bladder normal.', 'Grade I fatty liver. Rest of the study is normal.'],
  USGPEL: ['Uterus anteverted, normal size. Endometrium 8 mm. Both ovaries enlarged with multiple (>12) peripheral follicles, string-of-pearls appearance. No adnexal mass. No free fluid.', 'Bilateral polycystic ovarian morphology.'],
  ECG: ['Normal axis. PR and QRS intervals normal. No ST-T changes.', 'Normal ECG.'],
}
const VALUES = { Colour: 'Pale yellow', 'Pus cells': '2-3 /hpf', RBC: 'Nil', 'Epithelial cells': '1-2 /hpf', Casts: 'Nil', Crystals: 'Nil', Bacteria: 'Nil',
  'Heart rate': '76', pH: '6.0', 'Specific gravity': '1.020', Rhythm: 'Sinus rhythm',
  Microalbumin: '18', 'Albumin/creatinine ratio': '14', 'Estimated average glucose': '137' }
async function results(order, overrides = {}, onlyCodes = null) {
  const items = await as(`select i.id, t.catalogue_code from lab_order_items i join lab_tests t on t.id = i.test_id where i.order_id = $1`, [order])
  for (const it of items) {
    if (onlyCodes && !onlyCodes.includes(it.catalogue_code)) continue
    const params = await as(`select id, name, kind, options, ref_low, ref_high from lab_test_parameters where test_id = (select test_id from lab_order_items where id = $1) order by sort_order`, [it.id])
    const vals = []
    for (const q of params) {
      let v = overrides[q.name]
      if (v === undefined && q.kind === 'long_text') v = (NARRATIVE[it.catalogue_code] ?? ['Study within normal limits.', 'Normal study.'])[q.name === 'Impression' ? 1 : 0]
      if (v === undefined && VALUES[q.name]) v = VALUES[q.name]
      if (v === undefined && q.kind === 'select') v = q.options?.[0]
      if (v === undefined && q.kind === 'number') {
        // A full range: inside it. Only a floor (HDL) or only a ceiling: on the right side of it. Neither: a plausible number.
        const lo = q.ref_low != null ? Number(q.ref_low) : null, hi = q.ref_high != null ? Number(q.ref_high) : null
        const x = lo != null && hi != null ? lo + (hi - lo) * (0.2 + rnd() * 0.6) : lo != null ? lo * (1.1 + rnd() * 0.3) : hi != null ? hi * (0.5 + rnd() * 0.3) : 8 + rnd() * 30
        const top = hi ?? lo ?? x
        v = String(top >= 1000 ? Math.round(x / 100) * 100 : top >= 50 ? Math.round(x) : top >= 5 ? x.toFixed(1) : x.toFixed(2))
      }
      if (v === undefined && q.kind === 'text') v = 'Normal'
      if (v !== undefined && v !== null) vals.push({ parameter_id: q.id, value: String(v) })
    }
    if (vals.length) await as(`select sehat_lab_save_results($1, $2::jsonb)`, [it.id, JSON.stringify(vals)])
  }
}
async function signedBy(order, who) {
  await raw(`update lab_reports set approved_by_name = $2, approved_by_qualification = $3 where order_id = $1`, [order, who.name, who.qualification])
}
async function labOrder(who, codes, { pkg = null, stage = 'reported', overrides = {}, home = false, urgent = false, by = 'GEN', partial = null } = {}) {
  const p = byName(who)
  const ids = codes.map(c => testId[c]).filter(Boolean)
  const pkgIds = pkg ? [(await asOne(`select id from lab_packages where business_id = $1 and name = $2`, [B, pkg])).id] : []
  const o = val(await asOne(`select sehat_lab_create_order($1, $2, $3::uuid[], $4::uuid[], null, $5, $6, $7, null, $8, null, null)`,
    [B, p.id, ids, pkgIds, home ? 'home' : 'lab', home ? 'H.No. 214, Model Town, Yamuna Nagar' : null, urgent ? 'urgent' : 'routine', STAFF[by].name]))
  if (stage === 'ordered') return o
  await as(`select sehat_lab_mark_collected($1, $2)`, [o, nurse.id])
  if (stage === 'collected') return o
  await results(o, overrides, partial)
  if (stage === 'in_progress') return o
  await as(`select sehat_lab_approve($1)`, [o])
  const imaging = codes.some(c => ['XRCHEST', 'USGABD', 'USGPEL', 'XRKNEE'].includes(c))
  await signedBy(o, imaging ? STAFF.RAD : STAFF.PATH)
  return o
}
const pkgName = (await asOne(`select name from lab_packages where business_id = $1 order by name limit 1`, [B]))?.name
await labOrder('Mohd. Irfan', ['CBC', 'WIDAL', 'CRP'], { overrides: { 'S. typhi O': '1:160', 'S. typhi H': '1:320', CRP: '48' } })
await labOrder('Rohit Kamboj', ['CBC', 'DENGUE'], { overrides: { 'NS1 antigen': 'Positive', 'Platelet count': '0.62' }, urgent: true })
await labOrder('Ramesh Kumar Sharma', ['HBA1C', 'FBS', 'LIPID', 'KFT'], { overrides: { HbA1c: '8.4', 'Fasting blood sugar': '168' } })
await labOrder('Sunita Sharma', ['THY'], { overrides: { TSH: '7.9' } })
if (pkgName) await labOrder('Deepak Jain', [], { pkg: pkgName })
await labOrder('Anil Gupta', ['LFT', 'LIPID'])
await labOrder('Satish Chand', ['XRCHEST'], { by: 'GEN' })
await labOrder('Deepak Jain', ['USGABD'], { by: 'GEN' })
await labOrder('Simran Arora', ['USGPEL'], { by: 'GYN' })
await labOrder('Rajinder Pal', ['ECG'], { urgent: true })
await labOrder('Kamlesh Devi', ['CBC', 'HBA1C', 'URINE'], { stage: 'in_progress', partial: ['CBC'] })
await labOrder('Pooja Mehta', ['CBC', 'VITD', 'B12'], { stage: 'collected' })
await labOrder('Lakshmi Devi', ['FBS', 'HBA1C', 'VITD'], { stage: 'ordered', home: true })
await labOrder('Balwinder Singh', ['LIPID', 'TSH'], { stage: 'ordered' })
log('lab: 14 orders — 10 reported (pathology, X-ray, ultrasound, ECG), 1 in progress, 1 collected, 2 waiting (1 home collection)')

// ── 12. Pharmacy sales ──────────────────────────────────────────────────────
let sales = 0
for (const [k, r] of RX.slice(0, 7).entries()) {
  const lines = r.items.map(([drug, , , , qty]) => MED[drug] && { item_id: MED[drug], qty: Math.max(1, Math.min(Number(qty) || 1, 30)) }).filter(Boolean)
  if (!lines.length) continue
  const net = await asOne(`select sehat_pharmacy_issue_bill($1, $2::jsonb, $3, null, null, $4, $5, $6, null) id`,
    [B, JSON.stringify(lines), r.p.id, r.rx, k === 2 ? 10 : 0, k === 2 ? 'Senior citizen' : null])
  const due = Number(val(await asOne(`select net_payable from pharmacy_bills where id = $1`, [net.id])))
  if (k !== 5) await as(`select sehat_pharmacy_record_payment($1, $2, $3, null)`, [net.id, due, pick(['cash', 'upi'])])
  sales++
}
for (const [cust, items] of [['Walk-in — Mukesh', [['Dolo 650', 10], ['Okacet 10', 10]]], ['Walk-in — Seema', [['Electral ORS', 4], ['Calpol 250 Syrup', 1]]],
  ['Walk-in — Rakesh', [['Pan 40', 15], ['Becosules', 20]]], ['Walk-in — Jyoti', [['Refresh Tears', 1], ['Shelcal 500', 15]]]]) {
  const id = val(await asOne(`select sehat_pharmacy_issue_bill($1, $2::jsonb, null, $3, null, null, 0, null, null)`,
    [B, JSON.stringify(items.map(([d, qty]) => ({ item_id: MED[d], qty }))), cust]))
  const due = Number(val(await asOne(`select net_payable from pharmacy_bills where id = $1`, [id])))
  await as(`select sehat_pharmacy_record_payment($1, $2, 'cash', null)`, [id, due])
  sales++
}
log(`pharmacy: ${sales} bills (one on credit, one discounted)`)

// ── 13. Nothing reaches a real phone ────────────────────────────────────────
const cleared = await rawOne(`with a as (delete from notification_outbox where created_at >= $1 and phone ~ $2 returning 1),
    b as (delete from email_outbox where created_at >= $1 and business_id = $3 returning 1),
    c as (delete from push_outbox where created_at >= $1 and business_id = $3 returning 1),
    d as (delete from rating_asks where created_at >= $1 and business_id = $3 returning 1)
  select (select count(*) from a) + (select count(*) from b) + (select count(*) from c) + (select count(*) from d) n`, [START, `^(91)?9000${RANGE}`, B])
log(`${cleared.n} queued messages to demo patients cleared`)

console.log('Done.\n')
await db.end()
