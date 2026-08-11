#!/usr/bin/env node
// check-table-config — every table in the schema must have a sync/purge classification.
//
// Without this, supabase/tables.config.yaml becomes the same drift problem one
// level up: someone adds a migration, forgets the manifest, and the new table
// silently gets no treatment — never synced, never purged, invisible. So a table
// that exists in migrations/ but not in the manifest is a hard failure. Deciding
// is cheap; discovering months later that sandbox has been accumulating rows in
// a table nobody classified is not.
//
//   node scripts/check-table-config.mjs
//
// Exit 0 = every table classified. Exit 1 = something needs a decision.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, VALID_CLASSES, loadTablesConfig } from './lib/tables-config.mjs'

const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const LEGACY_DIR = join(ROOT, 'supabase', 'legacy')

let problems = 0
const problem = (msg) => { problems++; console.error(`  ✗ ${msg}`) }
const warn = (msg) => console.error(`  ! ${msg}`)

// ── load the manifest ──
let declared
try {
  declared = loadTablesConfig()
} catch (e) {
  console.error(`\n  ✗ ${e.message}\n`)
  process.exit(1)
}

// ── find the SQL that defines the schema ──
// Prefer migrations/. Fall back to legacy/ (or the pre-move root layout) so this
// check is useful before the production baseline has been captured.
function sqlSources() {
  for (const dir of [MIGRATIONS_DIR, LEGACY_DIR, join(ROOT, 'supabase')]) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(f => f.endsWith('.sql'))
    if (files.length) return { dir, files, isBaseline: dir === MIGRATIONS_DIR }
  }
  return null
}

const src = sqlSources()
if (!src) {
  console.error('\n  ✗ No .sql files found under supabase/ — nothing to check.\n')
  process.exit(1)
}
/** Path shown in messages, relative to the repo root. */
const srcLabel = src.dir.slice(ROOT.length + 1)

// ── extract table + view names ──
// Deliberately simple regexes: this reads DDL we control, not arbitrary SQL.
const tablesInSql = new Set()
const viewsInSql = new Set()

for (const file of src.files) {
  const sql = readFileSync(join(src.dir, file), 'utf8')
    .replace(/--[^\n]*/g, '')          // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')  // strip block comments

  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    tablesInSql.add(m[1].toLowerCase())
  }
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    viewsInSql.add(m[1].toLowerCase())
  }
  // A renamed table is the same table under a new name, so the manifest must
  // classify the new one and stop being asked about the old. Without this, 0037
  // renaming doctor_availability to availability left the check demanding a
  // classification for a table that no longer exists and rejecting the one
  // that does.
  for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
    tablesInSql.delete(m[1].toLowerCase())
    tablesInSql.add(m[2].toLowerCase())
  }
  // Likewise a dropped table: 0037 removed the whole doctors/organizations
  // cluster, and the manifest should not have to keep describing it.
  for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    tablesInSql.delete(m[1].toLowerCase())
  }
  for (const m of sql.matchAll(/drop\s+view\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    viewsInSql.delete(m[1].toLowerCase())
  }
}

console.log(`\n  Schema source: ${srcLabel}/ (${src.files.length} file(s))`)
console.log(`  Found ${tablesInSql.size} table(s), ${viewsInSql.size} view(s); manifest declares ${Object.keys(declared).length}\n`)

// ── 1. every table/view in SQL must be classified ──
for (const name of [...tablesInSql, ...viewsInSql].sort()) {
  if (!declared[name]) {
    problem(`"${name}" exists in the schema but is not classified in tables.config.yaml.\n` +
            `      Add it as "sync" (reference data, copied prod→sandbox) or\n` +
            `      "isolated" (user-generated, purgeable) — or "view".`)
  }
}

// ── 2. every manifest entry must be well-formed ──
for (const [name, entry] of Object.entries(declared).sort()) {
  if (!entry || typeof entry !== 'object') {
    problem(`"${name}" has a malformed manifest entry.`)
    continue
  }
  if (!VALID_CLASSES.includes(entry.class)) {
    problem(`"${name}" has class "${entry.class}" — must be one of: ${VALID_CLASSES.join(', ')}`)
    continue
  }
  if (entry.class === 'sync') {
    if (!Array.isArray(entry.key) || !entry.key.length) {
      problem(`"${name}" is class "sync" but has no "key" array. The sync needs a conflict target for upserts.`)
    }
  }
  if (entry.class === 'isolated') {
    if (typeof entry.purgeOrder !== 'number') {
      problem(`"${name}" is class "isolated" but has no numeric "purgeOrder". The purge needs an FK-safe order.`)
    }
  }
  // A view classified as isolated/sync would be sent a DELETE or an upsert.
  if (viewsInSql.has(name) && entry.class !== 'view') {
    problem(`"${name}" is a VIEW in the schema but classified "${entry.class}". Views cannot be purged or synced.`)
  }
}

// ── 3. purgeOrder must be unique — ties make delete order nondeterministic ──
const orders = new Map()
for (const [name, entry] of Object.entries(declared)) {
  if (entry?.class !== 'isolated' || typeof entry.purgeOrder !== 'number') continue
  if (orders.has(entry.purgeOrder)) {
    problem(`purgeOrder ${entry.purgeOrder} is used by both "${orders.get(entry.purgeOrder)}" and "${name}". ` +
            `Ties make FK-safe ordering nondeterministic.`)
  }
  orders.set(entry.purgeOrder, name)
}

// ── 4. the one FK ordering rule we can assert from committed SQL ──
// payments.doctor_id has no ON DELETE clause (legacy/schema.sql), so it is
// NO ACTION: deleting a doctor that still has payments raises an FK violation.
const payments = declared.payments, doctors = declared.doctors
if (payments?.class === 'isolated' && doctors?.class === 'isolated'
    && typeof payments.purgeOrder === 'number' && typeof doctors.purgeOrder === 'number'
    && payments.purgeOrder >= doctors.purgeOrder) {
  problem(`payments (purgeOrder ${payments.purgeOrder}) must be deleted BEFORE doctors ` +
          `(purgeOrder ${doctors.purgeOrder}) — payments.doctor_id is NO ACTION, so the delete would fail.`)
}

// ── 5. manifest entries with no matching table ──
// Not fatal: the app queries several tables that no committed SQL defines yet,
// which is exactly the drift the baseline dump will fix.
const unknown = Object.keys(declared)
  .filter(n => !tablesInSql.has(n) && !viewsInSql.has(n) && declared[n]?.class !== 'never_purge')
if (unknown.length) {
  warn(`Declared but not found in ${srcLabel}/: ${unknown.join(', ')}`)
  if (!src.isBaseline) {
    warn('Expected before the production baseline is captured — these are the known-drifted tables.')
  }
}

// ── 6. remind about provisional entries ──
const unverified = Object.entries(declared).filter(([, e]) => e?.unverified).map(([n]) => n)
if (unverified.length && src.isBaseline) {
  warn(`${unverified.length} entr(ies) still marked "unverified" — confirm against the baseline dump ` +
       `and remove the flag: ${unverified.join(', ')}`)
}

// ── report ──
if (problems) {
  console.error(`\n  ${problems} problem(s). Every table needs a classification decision.\n`)
  process.exit(1)
}
console.log('  ✓ Every table and view is classified.\n')
