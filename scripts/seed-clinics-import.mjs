#!/usr/bin/env node
// seed-clinics-import — clinics we know exist, from open government data.
//
//   node scripts/seed-clinics-import.mjs --env sandbox --district Yamunanagar
//   node scripts/seed-clinics-import.mjs --env sandbox --state Haryana --dry-run
//   node scripts/seed-clinics-import.mjs --env sandbox --state Haryana \
//     --csv ~/Downloads/hospital_directory.csv
//
// Prefer --csv for anything larger than a district. The API hands out ten rows a
// call and rate-limits well before a state is done; the same data downloaded
// whole from the catalogue page is one file and no quota.
//
// Source: the National Hospital Directory published by MoHFW / NIHFW on
// data.gov.in, under the Government Open Data License – India. GODL grants a
// royalty-free licence to adapt and publish commercially, on condition the
// source is attributed — so anywhere these rows surface must say where they came
// from. See ATTRIBUTION below; keep it with the data, not just in this file.
//
// Needs DATA_GOV_IN_KEY in .env.supabase. Register free at
// https://data.gov.in/user/register for your own key rather than borrowing the
// public demo one, which is shared and rate-limited to nothing.
//
// WHAT YOU GET, measured across all 80 Yamunanagar rows rather than promised by
// the schema: name 100%, address 96%, pincode 100%, coordinates 60%, and phone
// numbers 0% — the column exists upstream and is the literal string "0" in every
// row. The schema advertises 49 fields including beds, specialities and tariffs;
// substantially all of them are empty. Treat this as a list of names and
// addresses to go and call, not a directory.

import http from 'node:http'
import https from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'
import { assertDbUrls } from './lib/db-url.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(ROOT, '.env.supabase'), quiet: true })

const RESOURCE = '98fa254e-c5f8-4910-a19b-4828939b477d'
const BASE = `https://api.data.gov.in/resource/${RESOURCE}`
const SOURCE = 'data.gov.in/nhp-hospital-directory'
const ATTRIBUTION =
  'National Hospital Directory, Ministry of Health and Family Welfare / NIHFW, ' +
  'via data.gov.in. Government Open Data License – India.'

// The API ignores larger values and returns ten at a time regardless.
const PAGE = 10

/** Carries the rows fetched before the limit hit, so a partial run still saves. */
class RateLimited extends Error {
  constructor(rows) {
    super('rate limited')
    this.rows = [...rows.values()]
  }
}

const args = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = args.indexOf(`--${n}`)
  return i === -1 ? d : (args[i + 1] ?? true)
}
const env = flag('env')
const district = flag('district')
const state = flag('state', 'Haryana')
const csvPath = flag('csv')
const dryRun = args.includes('--dry-run')

if (env !== 'prod' && env !== 'sandbox') {
  console.error('\n  Usage: node scripts/seed-clinics-import.mjs --env sandbox|prod [--district Yamunanagar] [--state Haryana] [--dry-run]\n')
  process.exit(1)
}

const KEY = process.env.DATA_GOV_IN_KEY
if (!KEY && !csvPath) {
  console.error('\n  DATA_GOV_IN_KEY is not set in .env.supabase.')
  console.error('  Register free at https://data.gov.in/user/register,')
  console.error('  or download the CSV from the catalogue and pass --csv <path>.\n')
  process.exit(1)
}

function get(url) {
  const mod = url.startsWith('http://') ? http : https
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { timeout: 60_000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)) }
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', c => { raw += c })
      res.on('end', () => { try { resolve(JSON.parse(raw)) } catch (e) { reject(e) } })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

/**
 * Upstream fills empty fields with the string "0" rather than leaving them null,
 * so a naive import gives every clinic the address "0" and the phone number 0.
 */
const clean = v => {
  const s = String(v ?? '').trim()
  return s === '' || s === '0' || s.toUpperCase() === 'NA' || s === '-' ? null : s
}

/** '30.1702088, 77.2865519' → [lat, lng]. Absent on 40% of rows. */
function coords(raw) {
  const s = clean(raw)
  if (!s) return [null, null]
  const [a, b] = s.split(',').map(x => Number.parseFloat(x.trim()))
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : [null, null]
}

async function fetchAll() {
  const rows = new Map()
  for (let offset = 0; ; offset += PAGE) {
    const filters = district
      ? `&filters%5Bdistrict%5D=${encodeURIComponent(district)}`
      : `&filters%5Bstate%5D=${encodeURIComponent(state)}`
    const url = `${BASE}?api-key=${KEY}&format=json&limit=${PAGE}&offset=${offset}${filters}`

    let page
    try {
      page = await get(url)
    } catch (e) {
      // Rate limiting is not the end of the data, and treating it as one is how
      // you get a run that reports success having written nothing. Say what
      // happened, keep what we have, and exit non-zero.
      if (String(e.message).includes('429')) {
        process.stdout.write('\n')
        console.error(`  Rate limited by data.gov.in after ${rows.size} records.`)
        console.error('  The key in DATA_GOV_IN_KEY is shared if it is the public demo one.')
        console.error('  Register your own (free): https://data.gov.in/user/register\n')
        throw new RateLimited(rows)
      }
      console.error(`\n  Failed at offset ${offset}: ${e.message}`)
      break
    }

    const recs = page.records ?? []
    if (!recs.length) break
    for (const r of recs) rows.set(String(r._sr_no), r)

    process.stdout.write(`\r  fetched ${rows.size} of ${page.total ?? '?'}`)
    if (page.total && rows.size >= page.total) break
    // The endpoint is a shared government service; do not hammer it.
    await new Promise(r => setTimeout(r, 400))
  }
  process.stdout.write('\n')
  return [...rows.values()]
}

/**
 * Minimal RFC 4180 reader — quoted fields, escaped quotes, newlines inside
 * quotes. The file is one download of a published dataset, not arbitrary input,
 * and pulling in a CSV dependency for one script is not worth it.
 */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return []
  const head = rows[0].map(h => h.trim())
  return rows.slice(1)
    .filter(r => r.length >= head.length - 2)
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

/**
 * The CSV names its columns in TitleCase where the API returns snake_case, and
 * carries a few the API never exposes. Mapped to the API's shape so both routes
 * feed the same normalise().
 */
function fromCsvRow(r) {
  return {
    _sr_no: r.Sr_No,
    hospital_name: r.Hospital_Name,
    _address_original_first_line: r.Address_Original_First_Line,
    _location: r.Location,
    _location_coordinates: r.Location_Coordinates,
    _pincode: r.Pincode,
    district: r.District,
    state: r.State,
    telephone: r.Telephone,
    mobile_number: r.Mobile_Number,
    hospital_category: r.Hospital_Category,
  }
}

async function fetchCsv() {
  const { readFile } = await import('node:fs/promises')
  const path = String(csvPath).replace(/^~/, process.env.HOME ?? '~')
  const text = await readFile(path, 'utf8')
  const all = parseCsv(text)

  const want = (v, target) => String(v ?? '').trim().toLowerCase() === target.toLowerCase()
  const rows = all.filter(r =>
    district ? want(r.District, district) : want(r.State, state))

  console.log(`  ${all.length.toLocaleString()} rows in the file, ${rows.length} matching`)
  return rows.map(fromCsvRow)
}

function normalise(r) {
  const [lat, lng] = coords(r._location_coordinates)
  return {
    source: SOURCE,
    source_ref: String(r._sr_no),
    name: clean(r.hospital_name),
    address: clean(r._address_original_first_line) ?? clean(r._location),
    pincode: clean(r._pincode),
    district: clean(r.district),
    state: clean(r.state),
    latitude: lat,
    longitude: lng,
    phone: clean(r.telephone) ?? clean(r.mobile_number),
    category: clean(r.hospital_category),
  }
}

async function main() {
  const dbUrlKey = env === 'prod' ? 'SUPABASE_DB_URL_PROD' : 'SUPABASE_DB_URL_SANDBOX'
  const conn = process.env[dbUrlKey]
  assertDbUrls([[dbUrlKey, conn]])

  console.log(`\n  ${ATTRIBUTION}`)
  console.log(`  ${district ? `district ${district}` : `state ${state}`} → ${env}${dryRun ? '  (dry run)' : ''}\n`)

  // A partial fetch is still worth writing — the run is resumable by re-running,
  // and rows already collected should not be thrown away because the next page
  // was refused.
  let raw, partial = false
  try {
    raw = csvPath ? await fetchCsv() : await fetchAll()
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e
    raw = e.rows
    partial = true
  }
  const rows = raw.map(normalise).filter(r => r.name)

  const withAddr = rows.filter(r => r.address).length
  const withGeo = rows.filter(r => r.latitude !== null).length
  const withPhone = rows.filter(r => r.phone).length
  console.log(`  ${rows.length} clinics — ${withAddr} with an address, ${withGeo} geocoded, ${withPhone} with a phone number`)

  if (dryRun) {
    console.log('\n  Dry run, nothing written. First five:\n')
    rows.slice(0, 5).forEach(r => console.log(`    ${r.name}\n      ${r.address ?? '(no address)'} — ${r.pincode ?? ''}`))
    console.log()
    return
  }

  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()

  let inserted = 0, updated = 0, skipped = 0
  for (const r of rows) {
    // A clinic that asked not to be listed stays unlisted. Re-running an import
    // must not quietly undo that, so those rows are left exactly as they are.
    const { rows: [existing] } = await client.query(
      'select id, status from seed_clinics where source = $1 and source_ref = $2',
      [r.source, r.source_ref])

    if (existing?.status === 'rejected' || existing?.status === 'claimed') { skipped++; continue }

    const { rowCount } = await client.query(
      `insert into seed_clinics (source, source_ref, name, address, pincode, district,
                                 state, latitude, longitude, phone, category)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (source, source_ref) do update set
         name = excluded.name,
         -- Never overwrite something a human filled in with an upstream blank.
         address   = coalesce(excluded.address,   seed_clinics.address),
         pincode   = coalesce(excluded.pincode,   seed_clinics.pincode),
         latitude  = coalesce(excluded.latitude,  seed_clinics.latitude),
         longitude = coalesce(excluded.longitude, seed_clinics.longitude),
         phone     = coalesce(seed_clinics.phone, excluded.phone),
         category  = coalesce(excluded.category,  seed_clinics.category),
         updated_at = now()`,
      [r.source, r.source_ref, r.name, r.address, r.pincode, r.district,
       r.state, r.latitude, r.longitude, r.phone, r.category])

    if (existing) updated += rowCount; else inserted += rowCount
  }

  console.log(`\n  ${inserted} new, ${updated} updated, ${skipped} left alone (claimed or rejected)`)
  await client.end()

  if (partial) {
    console.log('\n  Incomplete — re-run to continue from where the rate limit stopped it.\n')
    process.exitCode = 1
  } else {
    console.log()
  }
}

main().catch(e => { console.error(`\n  ${e.message}\n`); process.exit(1) })
