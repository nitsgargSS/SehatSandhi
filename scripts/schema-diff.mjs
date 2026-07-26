#!/usr/bin/env node
// schema-diff — has the live database drifted from the repo?
//
// This is the recurring failure, not a one-time cleanup: ten tables the app
// queries were created directly in the SQL Editor and exist in no committed
// file, and discount_codes has a different primary key live than the committed
// DDL claims. Nobody noticed because nothing was checking.
//
// Compares the tables/views actually present in a database against those the
// repo's SQL defines, and against the classification manifest.
//
//   node scripts/schema-diff.mjs --env prod
//   node scripts/schema-diff.mjs --env sandbox
//   node scripts/schema-diff.mjs --env prod --tables      # per-column detail
//
// Queries information_schema directly rather than shelling out to `supabase db
// dump`, so it needs no external binary and reports at the granularity we
// actually care about.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import dotenv from 'dotenv'
import { ROOT, loadTablesConfig } from './lib/tables-config.mjs'
import { assertDbUrls } from './lib/db-url.mjs'

dotenv.config({ path: join(ROOT, '.env.migrate'), quiet: true })

const argv = process.argv.slice(2)
const has = (n) => argv.includes(`--${n}`)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1] }

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

const env = flag('env')
if (!['prod', 'sandbox'].includes(env)) fail('--env must be "prod" or "sandbox"')

const dbUrl = process.env[`SUPABASE_DB_URL_${env.toUpperCase()}`]
if (!dbUrl) fail(`SUPABASE_DB_URL_${env.toUpperCase()} is not set (see .env.migrate).`)
assertDbUrls([[`SUPABASE_DB_URL_${env.toUpperCase()}`, dbUrl]])

// ── what the repo says the schema is ──
function repoObjects() {
  const dirs = [join(ROOT, 'supabase', 'migrations'), join(ROOT, 'supabase', 'legacy'), join(ROOT, 'supabase')]
  const tables = new Set()
  const views = new Set()
  let source = null

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith('.sql'))
    if (!files.length) continue
    source = dir.slice(ROOT.length + 1)
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8')
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
        tables.add(m[1].toLowerCase())
      }
      for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
        views.add(m[1].toLowerCase())
      }
    }
    break
  }
  return { tables, views, source }
}

// ── what the database actually has ──
async function dbObjects(client) {
  const { rows } = await client.query(`
    select table_name, table_type
      from information_schema.tables
     where table_schema = 'public'
     order by table_name
  `)
  const tables = new Set(rows.filter(r => r.table_type === 'BASE TABLE').map(r => r.table_name))
  const views = new Set(rows.filter(r => r.table_type === 'VIEW').map(r => r.table_name))
  return { tables, views }
}

async function dbColumns(client, table) {
  const { rows } = await client.query(`
    select column_name, data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position
  `, [table])
  return rows
}

// ── run ──
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
try {
  await client.connect()
} catch (e) {
  fail(`Could not connect to ${env}: ${e.message}`)
}

let exitCode = 0
try {
  const repo = repoObjects()
  const live = await dbObjects(client)
  const manifest = loadTablesConfig()

  console.log(`\n  Schema drift — ${env}`)
  console.log(`  repo: ${repo.source}/ (${repo.tables.size} tables, ${repo.views.size} views)`)
  console.log(`  live: ${live.tables.size} tables, ${live.views.size} views\n`)

  const sorted = (s) => [...s].sort()

  // 1. In the database but not in any committed SQL. This is the drift that
  //    makes a fresh project unbuildable from the repo.
  const undocumented = sorted(live.tables).filter(t => !repo.tables.has(t) && t !== 'schema_migrations')
  if (undocumented.length) {
    exitCode = 1
    console.log(`  ✗ In the database but NOT in ${repo.source}/ (${undocumented.length}):`)
    for (const t of undocumented) {
      const cls = manifest[t]?.class
      console.log(`      ${t}${cls ? `  (classified "${cls}")` : '  — and unclassified'}`)
    }
    console.log('\n      These cannot be recreated from the repo. Capture them into')
    console.log('      supabase/migrations/0001_baseline.sql via `supabase db dump`.\n')
  }

  const undocumentedViews = sorted(live.views).filter(v => !repo.views.has(v))
  if (undocumentedViews.length) {
    exitCode = 1
    console.log(`  ✗ Views in the database but NOT in ${repo.source}/ (${undocumentedViews.length}):`)
    undocumentedViews.forEach(v => console.log(`      ${v}`))
    console.log('')
  }

  // 2. In the repo but missing from the database. On sandbox this means the
  //    migration was never applied; on prod it means the file lies.
  const missing = sorted(repo.tables).filter(t => !live.tables.has(t))
  if (missing.length) {
    exitCode = 1
    console.log(`  ✗ In ${repo.source}/ but NOT in the ${env} database (${missing.length}):`)
    missing.forEach(t => console.log(`      ${t}`))
    console.log(env === 'sandbox'
      ? '\n      Run: node scripts/migrate.mjs up --env sandbox\n'
      : '\n      The committed SQL describes tables production does not have.\n')
  }

  // 3. Live tables with no classification — the sync and purge would both skip
  //    them silently.
  const unclassified = sorted(live.tables).filter(t => !manifest[t])
  if (unclassified.length) {
    exitCode = 1
    console.log(`  ✗ Live tables missing from tables.config.yaml (${unclassified.length}):`)
    unclassified.forEach(t => console.log(`      ${t}`))
    console.log('\n      Unclassified tables are never synced and never purged.\n')
  }

  // 4. Optional per-column detail for tables both sides agree exist.
  if (has('tables')) {
    console.log('  Column detail:\n')
    for (const t of sorted(live.tables)) {
      const cols = await dbColumns(client, t)
      console.log(`      ${t} (${cols.length} columns)`)
      for (const c of cols) {
        const nul = c.is_nullable === 'YES' ? '' : ' not null'
        const def = c.column_default ? ` default ${c.column_default}` : ''
        console.log(`          ${c.column_name} ${c.data_type}${nul}${def}`)
      }
      console.log('')
    }
  }

  if (!exitCode) {
    console.log('  ✓ No drift: the repo, the database, and the manifest agree.\n')
  } else {
    console.log(`  Run with --tables for per-column detail.\n`)
  }
} finally {
  await client.end()
}

process.exit(exitCode)
