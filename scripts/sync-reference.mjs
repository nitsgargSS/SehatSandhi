#!/usr/bin/env node
// sync-reference — copy reference data from production into the sandbox.
//
// Sandbox needs real pricing to be a real test: with an empty service_areas the
// wizard shows ₹0 and razorpay-order rejects the payment outright. But it must
// never hold real doctors, payments or patient records. So this copies only the
// tables classified `sync` in supabase/tables.config.yaml, and nothing else.
//
// Strictly one-way: prod is opened read-only and sandbox is the only write
// target. That direction is the whole point of a separate project — a sync that
// could write to prod would give back everything the isolation buys.
//
//   node scripts/sync-reference.mjs --dry-run
//   node scripts/sync-reference.mjs                  # mirror (default)
//   node scripts/sync-reference.mjs --mode upsert
//
// mirror  sandbox becomes an exact copy: upsert prod rows, delete the rest.
//         Guarantees sandbox prices exactly as prod does.
// upsert  prod rows are inserted/updated; sandbox-only rows survive. Keeps
//         hand-added experimental pincodes, at the cost of sandbox possibly
//         pricing differently from prod.
//
// The mode applies to every synced table. Per-table modes would leave you
// unable to answer "does sandbox price like prod?" with a straight yes or no.

import { join } from 'node:path'
import pg from 'pg'
import dotenv from 'dotenv'
import { ROOT, loadTablesConfig, syncTables } from './lib/tables-config.mjs'
import { assertDbUrls } from './lib/db-url.mjs'

dotenv.config({ path: join(ROOT, '.env.supabase'), quiet: true })

// ── args ──
const argv = process.argv.slice(2)
const has = (n) => argv.includes(`--${n}`)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1] }

const mode = flag('mode') ?? 'mirror'
const dryRun = has('dry-run')

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

if (!['mirror', 'upsert'].includes(mode)) fail('--mode must be "mirror" or "upsert"')

const PROD_URL = process.env.SUPABASE_DB_URL_PROD
const SANDBOX_URL = process.env.SUPABASE_DB_URL_SANDBOX
if (!PROD_URL) fail('SUPABASE_DB_URL_PROD is not set (see .env.supabase).')
if (!SANDBOX_URL) fail('SUPABASE_DB_URL_SANDBOX is not set (see .env.supabase).')
assertDbUrls([['SUPABASE_DB_URL_PROD', PROD_URL], ['SUPABASE_DB_URL_SANDBOX', SANDBOX_URL]])

// ── Safety: never write to production ──
// A transposed connection string here would overwrite live pricing — the most
// damaging mistake available in this repo.
//
// Identity is the PROJECT, not the host: every project in a region shares one
// pooler hostname (aws-0-<region>.pooler.supabase.com) and the database is
// always "postgres", so host+db alone would call two different projects
// identical. The project ref lives in the username as postgres.<ref>, and on
// the legacy direct host it is the first hostname label.
function projectRef(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    fail('Could not parse a connection string in .env.supabase — expected a postgresql:// URL.')
  }
  const user = decodeURIComponent(u.username)
  if (user.includes('.')) return user.split('.').slice(1).join('.').toLowerCase()  // pooler: postgres.<ref>
  const m = /^db\.([^.]+)\./.exec(u.hostname)
  if (m) return m[1].toLowerCase()                                                  // legacy: db.<ref>.supabase.co
  return `${u.hostname}${u.pathname}`.toLowerCase()                                 // anything else: fall back to host
}

const prodRef = projectRef(PROD_URL)
const sandboxRef = projectRef(SANDBOX_URL)
if (prodRef === sandboxRef) {
  fail(
    `SUPABASE_DB_URL_PROD and SUPABASE_DB_URL_SANDBOX both point at project "${prodRef}".\n` +
    '    Refusing to run: this would rewrite production reference data.'
  )
}

// ── which tables ──
let tables
try {
  tables = syncTables(loadTablesConfig())
} catch (e) {
  fail(e.message)
}
if (!tables.length) fail('No tables are classified `sync` in supabase/tables.config.yaml.')

const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`

/** Read every row of a synced table from prod. */
async function readProd(client, table) {
  const { rows } = await client.query(`select * from ${quoteIdent(table)}`)
  return rows
}

/**
 * Write rows into sandbox.
 *
 * One transaction per table: a failure mid-table leaves that table exactly as
 * it was rather than half-synced. Deletes are confined to the table being
 * synced — a sync must never reach into user-generated data.
 */
async function writeSandbox(client, { name, key }, rows) {
  const cols = rows.length ? Object.keys(rows[0]) : []
  let upserted = 0
  let deleted = 0

  // A dry run wraps the WHOLE sweep in one transaction (opened by the caller)
  // and rolls it back at the end. Per-table rollback would undo each table
  // before the next one runs, so a child table would never see the parent rows
  // it references — service_areas.tier_number would fail its foreign key on
  // every dry run while a real run succeeded. Savepoints keep per-table
  // isolation inside that outer transaction.
  const begin = dryRun ? `savepoint sp_${name}` : 'begin'
  const undo = dryRun ? `rollback to savepoint sp_${name}` : 'rollback'
  const done = dryRun ? `release savepoint sp_${name}` : 'commit'

  await client.query(begin)
  try {
    if (rows.length) {
      const colList = cols.map(quoteIdent).join(', ')
      const conflict = key.map(quoteIdent).join(', ')
      // Every non-key column is overwritten from prod; if a table is all key
      // columns there is nothing to update, so the row is left as-is.
      const updates = cols.filter(c => !key.includes(c))
      const setClause = updates.length
        ? `do update set ${updates.map(c => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`).join(', ')}`
        : 'do nothing'

      for (const row of rows) {
        const params = cols.map(c => row[c])
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
        await client.query(
          `insert into ${quoteIdent(name)} (${colList}) values (${placeholders})
           on conflict (${conflict}) ${setClause}`,
          params,
        )
        upserted++
      }
    }

    if (mode === 'mirror') {
      // Remove sandbox rows prod no longer has, matching on the declared key.
      if (rows.length) {
        // NOT EXISTS rather than NOT IN: with NOT IN, a single NULL anywhere in
        // the value list makes the predicate never true, so nothing would be
        // deleted and mirror would silently degrade into upsert.
        const keyTuple = key.map(quoteIdent).join(', ')
        const values = rows
          .map((_, r) => `(${key.map((_, c) => `$${r * key.length + c + 1}`).join(', ')})`)
          .join(', ')
        const params = rows.flatMap(row => key.map(k => row[k]))
        // Compare as text. Parameters in a bare VALUES list arrive untyped, and
        // Postgres cannot always infer the column type (it errors on
        // "could not determine data type of parameter"). Casting both sides
        // sidesteps inference entirely; these are key columns, so the text form
        // is a faithful identity.
        const joinPred = key
          .map((k, i) => `t.${quoteIdent(k)}::text is not distinct from keep.c${i}::text`)
          .join(' and ')
        const colAliases = key.map((_, i) => `c${i}`).join(', ')
        const res = await client.query(
          `delete from ${quoteIdent(name)} t
             where not exists (
               select 1 from (values ${values}) as keep(${colAliases})
               where ${joinPred}
             )`,
          params.map(v => (v === null || v === undefined ? null : String(v))),
        )
        deleted = res.rowCount ?? 0
      } else {
        const res = await client.query(`delete from ${quoteIdent(name)}`)
        deleted = res.rowCount ?? 0
      }
    }

    await client.query(done)
  } catch (e) {
    await client.query(undo).catch(() => {})
    throw e
  }

  return { upserted, deleted }
}

// ── run ──
const prod = new pg.Client({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } })
const sandbox = new pg.Client({ connectionString: SANDBOX_URL, ssl: { rejectUnauthorized: false } })

try {
  await prod.connect()
} catch (e) {
  fail(`Could not connect to prod: ${e.message}`)
}
try {
  await sandbox.connect()
} catch (e) {
  await prod.end()
  fail(`Could not connect to sandbox: ${e.message}`)
}

// Belt and braces: keep this session read-only so no code path below can write
// to production even by mistake.
await prod.query('set session characteristics as transaction read only')

console.log(`\n  Reference sync — prod → sandbox (${mode}${dryRun ? ', DRY RUN' : ''})\n`)

// One outer transaction for a dry run, so tables can see each other's rows
// while nothing is ever committed.
if (dryRun) await sandbox.query('begin')

let failures = 0
const pad = Math.max(...tables.map(t => t.name.length))

try {
  for (const t of tables) {
    const label = t.name.padEnd(pad)
    try {
      const rows = await readProd(prod, t.name)
      const { upserted, deleted } = await writeSandbox(sandbox, t, rows)
      const delNote = mode === 'mirror' && deleted ? `, ${String(deleted).padStart(3)} deleted` : ''
      console.log(`      ${label}  ${String(upserted).padStart(5)} rows  → upserted${delNote}`)
      if (t.unverified) {
        console.log(`      ${' '.repeat(pad)}  ↳ key [${t.key.join(', ')}] is unverified — confirm against the baseline dump`)
      }
    } catch (e) {
      // A table absent from BOTH databases is not a sync failure — several
      // classified tables come from legacy SQL that was never applied to
      // production. Only report it when the two sides disagree, since that is
      // the case that leaves sandbox pricing differently from prod.
      if (/relation .* does not exist/i.test(e.message)) {
        const inSandbox = await sandbox
          .query('select to_regclass($1) reg', [`public.${t.name}`])
          .then(r => !!r.rows[0].reg)
          .catch(() => false)
        if (!inSandbox) {
          console.log(`      ${label}  — skipped (absent from both databases)`)
          continue
        }
      }
      failures++
      console.error(`      ${label}  ✗ ${e.message}`)
    }
  }
} finally {
  if (dryRun) await sandbox.query('rollback').catch(() => {})
  await prod.end()
  await sandbox.end()
}

if (failures) {
  console.error(`\n  ${failures} table(s) failed. Sandbox may not price like prod.\n`)
  process.exit(1)
}
console.log(
  dryRun
    ? '\n  ✓ Dry run complete — nothing was written.\n'
    : '\n  ✓ Sandbox reference data now matches prod.\n    (user-generated tables untouched)\n'
)
