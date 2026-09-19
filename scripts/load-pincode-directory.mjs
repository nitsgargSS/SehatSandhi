#!/usr/bin/env node
// load-pincode-directory — fill pincode_directory from the committed CSV.
//
// Migration 0110 makes every search cover the patient's whole district, and
// learns the district from this table. The table ships empty; this fills it.
// Run once per environment after 0110, and again whenever the CSV changes.
//
//   node scripts/load-pincode-directory.mjs --env sandbox
//   node scripts/load-pincode-directory.mjs --env prod
//
// Source: supabase/reference/pincode_directory.csv — India Post's All India
// Pincode Directory (data.gov.in, Government Open Data License – India),
// reduced to one row per pincode: the district holding most of its post
// offices. Committed rather than fetched, so a deploy depends on nothing
// outside the repo and both environments get identical rows.
//
// Idempotent: an upsert on pin_code. Pincodes that leave the CSV are removed,
// so the table always equals the file.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { ROOT } from './lib/tables-config.mjs'
import { assertDbUrls } from './lib/db-url.mjs'

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const env = argv[argv.indexOf('--env') + 1]
if (!argv.includes('--env') || !['prod', 'sandbox'].includes(env)) {
  fail('--env must be "prod" or "sandbox"')
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

const key = `SUPABASE_DB_URL_${env.toUpperCase()}`
const dbUrl = process.env[key] || readEnv('.env.supabase')[key]
if (!dbUrl) fail(`${key} is not set (see .env.supabase).`)
assertDbUrls([[key, dbUrl]])

// Three plain columns, no quoting in the data — checked when the file was built.
const lines = readFileSync(join(ROOT, 'supabase', 'reference', 'pincode_directory.csv'), 'utf8')
  .split(/\r?\n/).filter(Boolean)
if (lines[0] !== 'pin_code,district,state') fail('Unexpected CSV header: ' + lines[0])
const pins = [], districts = [], states = []
for (const line of lines.slice(1)) {
  const [pin, district, state] = line.split(',')
  if (!/^[1-9][0-9]{5}$/.test(pin) || !district || !state) fail(`Bad CSV row: ${line}`)
  pins.push(pin); districts.push(district); states.push(state)
}

const client = new pg.Client({
  connectionString: dbUrl,
  // Supabase requires TLS but serves a cert chain node doesn't bundle.
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('begin')
  const up = await client.query(
    `insert into pincode_directory (pin_code, district, state)
     select * from unnest($1::text[], $2::text[], $3::text[])
     on conflict (pin_code) do update
       set district = excluded.district, state = excluded.state
     where (pincode_directory.district, pincode_directory.state)
           is distinct from (excluded.district, excluded.state)`,
    [pins, districts, states])
  const gone = await client.query(
    'delete from pincode_directory where not (pin_code = any($1::text[]))', [pins])
  await client.query('commit')
  const { rows: [{ n }] } = await client.query('select count(*)::int as n from pincode_directory')
  console.log(`\n  ✓ ${env}: ${n} pincodes (${up.rowCount} added or changed, ${gone.rowCount} removed)\n`)
} catch (e) {
  await client.query('rollback').catch(() => {})
  fail(e.message)
} finally {
  await client.end()
}
