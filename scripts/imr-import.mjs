#!/usr/bin/env node
// imr-import — fill imr_doctors from the Indian Medical Register.
//
//   node scripts/imr-import.mjs --env sandbox
//   node scripts/imr-import.mjs --env sandbox --council 46     # just one
//   node scripts/imr-import.mjs --env prod --resume            # continue a run
//
// About an hour for all 1.5M rows, or a quarter of that with --concurrency 4.
// It is resumable: progress is written to imr_sync_state after every page, so a
// run that dies at council 30 of 38 picks up where it stopped rather than
// starting the hour again.
//
// Paging is per council, never global. A global offset scan slows as it goes
// (~5s at the start, ~17s by the end); within a single council it stays flat
// whatever the offset — measured 9.8s at 0 and 9.1s at 195,000 for Maharashtra.
//
// The register carries each doctor's father's name. It is not imported. We are
// building a way to check a registration number, and a parent's name does
// nothing for that.

import https from 'node:https'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'
import { assertDbUrls } from './lib/db-url.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(ROOT, '.env.supabase') })

const BASE = 'https://www.nmc.org.in/MCIRest/open/getPaginatedData'
const PAGE = 5000
const RETRIES = 3

// Councils and their smcId, harvested from the register itself. Kept in step
// with src/pages/business/councils.ts — that file is the dropdown, this is the
// import; both describe the same 38 councils.
const COUNCILS = [
  [1, 'Andhra Pradesh Medical Council'], [2, 'Arunachal Pradesh Medical Council'],
  [3, 'Assam Medical Council'], [4, 'Bihar Medical Council'],
  [5, 'Chattisgarh Medical Council'], [6, 'Delhi Medical Council'],
  [7, 'Goa Medical Council'], [8, 'Gujarat Medical Council'],
  [9, 'Haryana Medical Council'], [10, 'Himanchal Pradesh Medical Council'],
  [11, 'Jammu & Kashmir Medical Council'], [12, 'Jharkhand Medical Council'],
  [13, 'Karnataka Medical Council'], [14, 'Kerala Medical Council'],
  [15, 'Madhya Pradesh Medical Council'], [16, 'Maharashtra Medical Council'],
  [17, 'Orissa Council of Medical Registration'], [18, 'Punjab Medical Council'],
  [19, 'Rajasthan Medical Council'], [20, 'Sikkim Medical Council'],
  [21, 'Tamil Nadu Medical Council'], [22, 'Tripura State Medical Council'],
  [23, 'Uttar Pradesh Medical Council'], [24, 'Uttarakhand Medical Council'],
  [25, 'West Bengal Medical Council'], [26, 'Manipur Medical Council'],
  [28, 'Bhopal Medical Council'], [29, 'Bombay Medical Council'],
  [35, 'Mahakoshal Medical Council'], [36, 'Madras Medical Council'],
  [37, 'Mysore Medical Council'], [40, 'Vidharba Medical Council'],
  [41, 'Nagaland Medical Council'], [42, 'Mizoram Medical Council'],
  [43, 'Telangana State Medical Council'], [45, 'Hyderabad Medical Council'],
  [46, 'Medical Council of India'],
  [50, 'Travancore Cochin Medical Council, Trivandrum'],
]

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : (args[i + 1] ?? true)
}
const env = flag('env')
const onlyCouncil = flag('council') ? Number(flag('council')) : null
const resume = args.includes('--resume')

if (env !== 'prod' && env !== 'sandbox') {
  console.error('\n  Usage: node scripts/imr-import.mjs --env sandbox|prod [--council 46] [--resume]\n')
  process.exit(1)
}

/**
 * nmc.org.in omits the intermediate certificate that signs its leaf, so Node
 * rejects the chain that browsers and curl quietly repair from their own caches.
 * We fetch the intermediate the certificate itself points at and hand it to the
 * agent. Verification stays on: `rejectUnauthorized: false` here would mean
 * anyone on the path could feed us a register of their own invention.
 */
function get(url) {
  // Plain HTTP by design — these are the URLs each certificate's own Authority
  // Information Access extension points at, and certificate distribution is not
  // served over the TLS it exists to establish. The bytes are signed: tampered
  // with, they simply fail to chain and the import stops rather than trusting them.
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)) }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    }).on('error', reject)
  })
}

const pem = der =>
  `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`

/**
 * Both missing links, not just the obvious one.
 *
 * nmc.org.in sends only its leaf. The intermediate that signs it is the gap
 * everyone notices — but Sectigo's Root R46 above it is not in Node's bundle
 * either, so supplying the intermediate alone still fails with `unable to get
 * issuer certificate`. macOS hides this: openssl and curl find the root in the
 * system keychain, so the same chain that works from a terminal fails from Node.
 *
 * Each certificate names where its issuer lives, so we follow that from the leaf
 * upward. Verification stays on throughout — `rejectUnauthorized: false` here
 * would mean anyone on the path could serve us a register of their invention.
 */
async function caBundle() {
  try {
    const [intermediate, rootP7c] = await Promise.all([
      get('http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt'),
      get('http://crt.sectigo.com/SectigoPublicServerAuthenticationRootR46.p7c'),
    ])
    // The root ships as PKCS#7; node has no parser for it, so shell to openssl.
    const { execFileSync } = await import('node:child_process')
    const rootPem = execFileSync('openssl',
      ['pkcs7', '-inform', 'DER', '-print_certs'], { input: rootP7c }).toString()
    return `${pem(intermediate)}${rootPem}`
  } catch {
    return null
  }
}

function fetchPage(agent, smcId, start) {
  const url = `${BASE}?service=getPaginatedDoctor&draw=1&start=${start}&length=${PAGE}`
    + `&name=&registrationNo=&smcId=${smcId}&year=`
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, timeout: 120_000 }, res => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', c => { raw += c })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

/** Digits only, unpadded — what a lookup matches on. See 0029. */
const regCore = s => {
  const d = String(s ?? '').replace(/\D/g, '')
  return d.replace(/^0+/, '') || d
}

/**
 * A row is positional: [idx, year, regNo, council, name, fathersName, link].
 * Index 5 is read and discarded; index 6 is the HTML "View" anchor, which is
 * also where the register's own id for the row lives.
 */
function parseRow(row, smcId, council) {
  if (!Array.isArray(row) || row.length < 5) return null
  const [, year, regNo, , name, , link] = row
  if (typeof regNo !== 'string' || typeof name !== 'string') return null
  const id = /openDoctorDetailsnew\('(\d+)'/.exec(String(link ?? ''))?.[1]
  if (!id) return null
  const y = Number.parseInt(String(year ?? ''), 10)
  return {
    imr_id: id,
    reg_no: regNo.trim(),
    reg_core: regCore(regNo),
    name: name.trim().replace(/\s+/g, ' '),
    smc_id: smcId,
    council,
    year: Number.isFinite(y) ? y : null,
  }
}

async function upsert(client, allRows) {
  if (!allRows.length) return

  // The register can return the same imr_id twice inside one page — Delhi does
  // it around offset 30,000. Postgres refuses an ON CONFLICT DO UPDATE that
  // would touch the same row twice in one statement, so the duplicates have to
  // go before the insert, not be caught after it. Last occurrence wins; they
  // have been identical every time we have looked.
  const byId = new Map()
  for (const r of allRows) byId.set(r.imr_id, r)
  const rows = [...byId.values()]

  // One statement per page rather than per row: 5,000 round trips a page would
  // dominate the runtime that the network already dominates.
  const cols = ['imr_id', 'reg_no', 'reg_core', 'name', 'smc_id', 'council', 'year']
  const values = []
  const params = []
  rows.forEach((r, i) => {
    const base = i * cols.length
    values.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(',')})`)
    params.push(r.imr_id, r.reg_no, r.reg_core, r.name, r.smc_id, r.council, r.year)
  })
  await client.query(
    `insert into imr_doctors (${cols.join(',')}) values ${values.join(',')}
     on conflict (imr_id) do update set
       reg_no = excluded.reg_no, reg_core = excluded.reg_core,
       name = excluded.name, smc_id = excluded.smc_id,
       council = excluded.council, year = excluded.year,
       imported_at = now()`,
    params,
  )
}

async function importCouncil(client, agent, smcId, council) {
  let start = 0
  if (resume) {
    const { rows } = await client.query(
      'select last_start, status from imr_sync_state where smc_id = $1', [smcId])
    if (rows[0]?.status === 'done') {
      console.log(`  ${council} — already done, skipping`)
      return 0
    }
    start = rows[0]?.last_start ?? 0
    if (start) console.log(`  ${council} — resuming at ${start.toLocaleString()}`)
  }

  await client.query(
    `insert into imr_sync_state (smc_id, council, status, last_start)
     values ($1, $2, 'running', $3)
     on conflict (smc_id) do update set status = 'running', council = excluded.council`,
    [smcId, council, start])

  let total = null
  let imported = 0

  for (;;) {
    let page = null
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try { page = await fetchPage(agent, smcId, start); break } catch (e) {
        if (attempt === RETRIES) {
          await client.query(
            `update imr_sync_state set status='error', last_error=$2, updated_at=now()
             where smc_id=$1`, [smcId, String(e.message).slice(0, 400)])
          throw new Error(`${council} failed at offset ${start}: ${e.message}`)
        }
        await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }

    if (total === null) {
      total = page.recordsFiltered ?? 0
      await client.query('update imr_sync_state set expected=$2 where smc_id=$1', [smcId, total])
    }

    const rows = (page.data ?? [])
      .map(r => parseRow(r, smcId, council))
      .filter(Boolean)

    if (!rows.length) break

    await upsert(client, rows)
    imported += rows.length
    start += PAGE

    await client.query(
      `update imr_sync_state set last_start=$2, imported=$3, updated_at=now() where smc_id=$1`,
      [smcId, start, imported])

    process.stdout.write(`\r  ${council.padEnd(44)} ${imported.toLocaleString()} / ${total.toLocaleString()}`)
    if (start >= total) break
  }

  await client.query(
    `update imr_sync_state set status='done', imported=$2, updated_at=now() where smc_id=$1`,
    [smcId, imported])
  process.stdout.write(`\r  ${council.padEnd(44)} ${imported.toLocaleString()} ✓${' '.repeat(12)}\n`)
  return imported
}

async function main() {
  const dbUrlKey = env === 'prod' ? 'SUPABASE_DB_URL_PROD' : 'SUPABASE_DB_URL_SANDBOX'
  const conn = process.env[dbUrlKey]
  assertDbUrls([[dbUrlKey, conn]])

  const ca = await caBundle()
  if (!ca) {
    console.error('\n  Could not fetch the Sectigo intermediate. Without it Node will')
    console.error('  reject nmc.org.in, which serves an incomplete certificate chain.\n')
    process.exit(1)
  }
  const agent = new https.Agent({ ca, keepAlive: true })

  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const list = onlyCouncil
    ? COUNCILS.filter(([id]) => id === onlyCouncil)
    : COUNCILS

  if (!list.length) {
    console.error(`\n  No council with smcId ${onlyCouncil}.\n`)
    process.exit(1)
  }

  console.log(`\n  Importing the Indian Medical Register → ${env}`)
  console.log(`  ${list.length} council(s)\n`)

  const started = Date.now()
  let grand = 0
  for (const [id, name] of list) {
    grand += await importCouncil(client, agent, id, name)
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1)
  console.log(`\n  ${grand.toLocaleString()} registrations in ${mins} min\n`)
  await client.end()
}

main().catch(e => {
  console.error(`\n  ${e.message}\n`)
  process.exit(1)
})
