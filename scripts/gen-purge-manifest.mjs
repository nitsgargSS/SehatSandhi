#!/usr/bin/env node
// gen-purge-manifest — compile tables.config.yaml into a Deno module.
//
// Edge functions cannot read the repo at runtime, so the purge order has to be
// baked in at deploy time. Generating it keeps supabase/tables.config.yaml the
// single source of truth: adding a table to the manifest is enough, and the
// generated file lands in a diff where the change is reviewable.
//
//   node scripts/gen-purge-manifest.mjs           # write the file
//   node scripts/gen-purge-manifest.mjs --check   # fail if stale (for CI)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadTablesConfig, purgeTables } from './lib/tables-config.mjs'

const OUT = join(ROOT, 'supabase', 'functions', 'sandbox-purge', 'tables.gen.ts')
const check = process.argv.includes('--check')

let tables
try {
  tables = purgeTables(loadTablesConfig())
} catch (e) {
  console.error(`\n  ✗ ${e.message}\n`)
  process.exit(1)
}

const rows = tables
  .map(t => `  { name: '${t.name}', purgeOrder: ${t.purgeOrder}, pk: '${t.pk}' },`)
  .join('\n')

const content = `// GENERATED FILE — do not edit.
//
// Source: supabase/tables.config.yaml
// Regenerate: node scripts/gen-purge-manifest.mjs
//
// Tables classified \`isolated\` (user-generated, safe to wipe in sandbox), in
// FK-safe delete order. Anything classified sync/view/never_purge is absent by
// construction, so reference data cannot be caught up in a purge.

export interface PurgeTable {
  name: string
  /** Ascending: children before parents. */
  purgeOrder: number
  /** Column used to build the "match every row" filter; PostgREST rejects an unfiltered delete. */
  pk: string
}

export const PURGE_TABLES: PurgeTable[] = [
${rows}
]
`

if (check) {
  if (!existsSync(OUT)) {
    console.error(`\n  ✗ ${OUT.slice(ROOT.length + 1)} is missing. Run: node scripts/gen-purge-manifest.mjs\n`)
    process.exit(1)
  }
  if (readFileSync(OUT, 'utf8') !== content) {
    console.error(
      `\n  ✗ ${OUT.slice(ROOT.length + 1)} is out of date with tables.config.yaml.\n` +
      `    Run: node scripts/gen-purge-manifest.mjs\n`
    )
    process.exit(1)
  }
  console.log(`  ✓ purge manifest matches tables.config.yaml (${tables.length} tables)`)
  process.exit(0)
}

writeFileSync(OUT, content)
console.log(`\n  ✓ Wrote ${OUT.slice(ROOT.length + 1)} — ${tables.length} tables in purge order.\n`)
