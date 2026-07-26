#!/usr/bin/env node
// migrate — apply supabase/migrations/*.sql to a target database, in order, once.
//
// The problem this solves: schema changes used to be pasted into the Supabase
// SQL Editor by hand, so the repo and the live DB drifted with nothing recording
// what had actually been applied. Ten tables the app queries existed only in
// production. This runner makes the repo the source of truth and, crucially,
// *checksums* what it applied — so editing an already-applied migration is a
// hard error rather than a silent divergence.
//
//   node scripts/migrate.mjs status   --env sandbox
//   node scripts/migrate.mjs up       --env sandbox
//   node scripts/migrate.mjs verify   --env prod
//   node scripts/migrate.mjs baseline   --env prod --version 0001_baseline
//   node scripts/migrate.mjs rebaseline --env prod --version 0001_baseline
//
// Connection strings come from .env.migrate (gitignored — they carry passwords):
//   SUPABASE_DB_URL_PROD=postgresql://...
//   SUPABASE_DB_URL_SANDBOX=postgresql://...

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'
import { assertDbUrls } from './lib/db-url.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

dotenv.config({ path: join(ROOT, '.env.migrate'), quiet: true })

// ── args ──
const argv = process.argv.slice(2)
const command = argv.find(a => !a.startsWith('--')) ?? 'status'
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? null : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

const env = flag('env')
if (!['prod', 'sandbox'].includes(env)) {
  fail('--env must be "prod" or "sandbox"')
}

const dbUrlKey = `SUPABASE_DB_URL_${env.toUpperCase()}`
const dbUrl = process.env[dbUrlKey]
if (!dbUrl) {
  fail(
    `${dbUrlKey} is not set.\n` +
    `Create .env.migrate (see .env.migrate.example) with the connection string for ${env}.`
  )
}
// Catch the two common malformed-URL cases before they surface as a bare DNS
// error or a misleading "tenant not found".
assertDbUrls([[dbUrlKey, dbUrl]])

// ── helpers ──
function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/** Migration files, sorted by filename. The NNNN_ prefix defines order. */
function loadMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) {
    fail(`No migrations directory at ${MIGRATIONS_DIR}`)
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(file => {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      return { version: file.replace(/\.sql$/, ''), file, sql, checksum: sha256(sql) }
    })
}

/**
 * The ledger of what has actually run against this database.
 *
 * Every reference is schema-qualified. A pg_dump preamble typically contains
 * `SELECT pg_catalog.set_config('search_path', '', false)`, which empties the
 * search path for the rest of the session — an unqualified `schema_migrations`
 * then fails to resolve mid-migration even though the table plainly exists.
 */
async function ensureLedger(client) {
  await client.query(`
    create table if not exists public.schema_migrations (
      version    text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )
  `)
}

async function appliedMap(client) {
  const { rows } = await client.query('select version, checksum, applied_at from public.schema_migrations')
  return new Map(rows.map(r => [r.version, r]))
}

/**
 * Compare the repo against the ledger.
 *
 * A checksum mismatch means a migration that already ran was edited afterwards.
 * We refuse rather than guess: re-running it is unsafe (it may not be
 * idempotent) and ignoring it means the DB no longer matches the file that
 * claims to describe it. The fix is a NEW migration, never an edit.
 */
function classify(migrations, applied) {
  const pending = []
  const drifted = []
  for (const m of migrations) {
    const prior = applied.get(m.version)
    if (!prior) pending.push(m)
    else if (prior.checksum !== m.checksum) drifted.push({ ...m, was: prior.checksum })
  }
  const orphans = [...applied.keys()].filter(v => !migrations.some(m => m.version === v))
  return { pending, drifted, orphans }
}

function reportDrift(drifted, orphans) {
  if (drifted.length) {
    console.error('\n  ✗ These migrations were edited after being applied:\n')
    for (const d of drifted) {
      console.error(`      ${d.file}`)
      console.error(`        applied: ${d.was.slice(0, 16)}…`)
      console.error(`        on disk: ${d.checksum.slice(0, 16)}…`)
    }
    console.error('\n    An applied migration is history — it cannot be rewritten.')
    console.error('    Revert the edit, or express the change as a NEW migration.\n')
  }
  if (orphans.length) {
    console.error(`\n  ! Applied but missing from the repo: ${orphans.join(', ')}`)
    console.error('    Someone applied a migration that was never committed.\n')
  }
}

// ── commands ──
async function cmdStatus(client) {
  const migrations = loadMigrations()
  const applied = await appliedMap(client)
  const { pending, drifted, orphans } = classify(migrations, applied)

  console.log(`\n  ${env} — ${migrations.length} migration(s) in repo, ${applied.size} applied\n`)
  for (const m of migrations) {
    const prior = applied.get(m.version)
    const mark = !prior ? '·  pending'
      : prior.checksum !== m.checksum ? '✗  CHECKSUM MISMATCH'
      : '✓  applied'
    console.log(`      ${mark}   ${m.file}`)
  }
  reportDrift(drifted, orphans)
  console.log(pending.length ? `\n  ${pending.length} pending. Run: migrate.mjs up --env ${env}\n` : '\n  Up to date.\n')
  if (drifted.length || orphans.length) process.exit(1)
}

async function cmdUp(client) {
  const migrations = loadMigrations()
  await ensureLedger(client)
  const applied = await appliedMap(client)
  const { pending, drifted, orphans } = classify(migrations, applied)

  if (drifted.length || orphans.length) {
    reportDrift(drifted, orphans)
    fail('Refusing to apply migrations while the ledger disagrees with the repo.')
  }
  if (!pending.length) {
    console.log(`\n  ${env} is up to date — nothing to apply.\n`)
    return
  }

  console.log(`\n  Applying ${pending.length} migration(s) to ${env}…\n`)
  for (const m of pending) {
    process.stdout.write(`      ${m.file} … `)
    // Each migration is atomic: if any statement fails the whole file rolls
    // back and we stop, so the ledger never claims a half-applied migration.
    try {
      await client.query('begin')
      await client.query(m.sql)
      await client.query(
        'insert into public.schema_migrations (version, checksum) values ($1, $2)',
        [m.version, m.checksum],
      )
      await client.query('commit')
      console.log('ok')
    } catch (e) {
      await client.query('rollback').catch(() => {})
      console.log('FAILED')
      fail(`${m.file} rolled back:\n\n    ${e.message}\n\n  No further migrations were applied.`)
    }
  }
  console.log(`\n  ✓ ${env} is up to date.\n`)
}

async function cmdVerify(client) {
  const migrations = loadMigrations()
  const applied = await appliedMap(client)
  const { pending, drifted, orphans } = classify(migrations, applied)
  reportDrift(drifted, orphans)
  if (pending.length) {
    console.error(`\n  ! ${pending.length} migration(s) not yet applied to ${env}: ${pending.map(p => p.file).join(', ')}\n`)
  }
  if (drifted.length || orphans.length || pending.length) process.exit(1)
  console.log(`\n  ✓ ${env} matches the repo exactly (${applied.size} migrations).\n`)
}

/**
 * Record a migration as applied WITHOUT running it.
 *
 * Needed exactly once: 0001_baseline.sql was dumped *from* production, so
 * production already has that schema. Executing it there would fail on
 * duplicate objects. Sandbox, being empty, runs it for real via `up`.
 */
async function cmdBaseline(client) {
  const version = flag('version')
  if (!version) fail('baseline requires --version <migration-version>')

  const m = loadMigrations().find(x => x.version === version)
  if (!m) fail(`No migration named "${version}" in supabase/migrations/`)

  await ensureLedger(client)
  const existing = (await appliedMap(client)).get(version)
  if (existing) {
    console.log(`\n  ${version} is already recorded for ${env} (applied ${existing.applied_at.toISOString()}).\n`)
    return
  }

  if (!has('yes')) {
    console.log(`\n  This marks ${m.file} as applied to ${env} WITHOUT running it.`)
    console.log('  Only correct when the database already has this schema.')
    console.log(`\n  Re-run with --yes to confirm.\n`)
    return
  }

  await client.query(
    'insert into public.schema_migrations (version, checksum) values ($1, $2)',
    [m.version, m.checksum],
  )
  console.log(`\n  ✓ Recorded ${m.file} as applied to ${env} (not executed).\n`)
}

/**
 * Update a recorded checksum to match the file on disk.
 *
 * Narrow but real: a baseline dumped from production usually needs edits before
 * it will replay elsewhere (stripping psql meta-commands, making CREATE SCHEMA
 * idempotent). Those edits change the file's checksum while describing exactly
 * the same schema, so the database that was baselined first is left holding a
 * stale hash and every later command refuses to run.
 *
 * This is NOT a way to legitimise editing a migration that really ran. It only
 * rewrites the ledger, never the database, so the operator has to be sure the
 * schema is unchanged — hence the diff-checking advice and the explicit --yes.
 */
async function cmdRebaseline(client) {
  const version = flag('version')
  if (!version) fail('rebaseline requires --version <migration-version>')

  const m = loadMigrations().find(x => x.version === version)
  if (!m) fail(`No migration named "${version}" in supabase/migrations/`)

  const existing = (await appliedMap(client)).get(version)
  if (!existing) {
    fail(`${version} is not recorded for ${env}. Use \`baseline\` to record it first.`)
  }
  if (existing.checksum === m.checksum) {
    console.log(`\n  ${version} already matches the file on disk for ${env} — nothing to do.\n`)
    return
  }

  if (!has('yes')) {
    console.log(`\n  ${env} recorded ${m.file} with a different checksum than the file now has:`)
    console.log(`      ledger : ${existing.checksum.slice(0, 16)}…`)
    console.log(`      on disk: ${m.checksum.slice(0, 16)}…`)
    console.log('\n  This updates the LEDGER ONLY — the database is not touched.')
    console.log('  Only correct if the edits did not change the schema the file produces.')
    console.log(`  Confirm with: node scripts/schema-diff.mjs --env ${env}`)
    console.log('\n  Re-run with --yes to confirm.\n')
    return
  }

  await client.query(
    'update public.schema_migrations set checksum = $2 where version = $1',
    [m.version, m.checksum],
  )
  console.log(`\n  ✓ ${env} ledger now records ${m.file} at its current checksum.\n`)
}

// ── main ──
const client = new pg.Client({
  connectionString: dbUrl,
  // Supabase requires TLS but serves a cert chain node doesn't bundle.
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
} catch (e) {
  fail(`Could not connect to ${env}: ${e.message}`)
}

try {
  await ensureLedger(client)
  switch (command) {
    case 'status':   await cmdStatus(client); break
    case 'up':       await cmdUp(client); break
    case 'verify':   await cmdVerify(client); break
    case 'baseline': await cmdBaseline(client); break
    case 'rebaseline': await cmdRebaseline(client); break
    default:
      fail(`Unknown command "${command}". Expected: status | up | verify | baseline | rebaseline`)
  }
} finally {
  await client.end()
}
