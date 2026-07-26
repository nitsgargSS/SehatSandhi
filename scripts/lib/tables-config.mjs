// Shared loader for supabase/tables.config.yaml.
//
// One parse point so the sync script, the purge-manifest generator and the
// checker can never disagree about what a class means.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// js-yaml 5.x is ESM-only and exports `load` as a named export (no default).
import { load as parseYaml } from 'js-yaml'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CONFIG_PATH = join(ROOT, 'supabase', 'tables.config.yaml')

export const VALID_CLASSES = ['sync', 'isolated', 'view', 'never_purge']

/** Parse the manifest. Throws with an actionable message rather than a stack. */
export function loadTablesConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}`)
  }
  let doc
  try {
    doc = parseYaml(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new Error(`tables.config.yaml is not valid YAML: ${e.message}`)
  }
  if (!doc || typeof doc !== 'object' || !doc.tables) {
    throw new Error('tables.config.yaml has no top-level "tables:" mapping.')
  }
  return doc.tables
}

/**
 * Tables copied prod -> sandbox, with their upsert conflict target.
 *
 * Ordered by `syncOrder` (parents first) — the mirror image of purgeOrder.
 * service_areas.tier_number references pricing_tiers, so inserting service
 * areas before their tiers exist fails the foreign key. Alphabetical order
 * does exactly that.
 */
export const syncTables = (tables) =>
  Object.entries(tables)
    .filter(([, e]) => e?.class === 'sync')
    .map(([name, e]) => ({
      name,
      key: e.key ?? [],
      syncOrder: e.syncOrder ?? Number.MAX_SAFE_INTEGER,
      unverified: !!e.unverified,
    }))
    .sort((a, b) => a.syncOrder - b.syncOrder || a.name.localeCompare(b.name))

/**
 * Tables the sandbox purge clears, children first.
 * `pk` names the column used to build the "delete all" filter, since PostgREST
 * rejects an unfiltered delete and not every table has an `id`.
 */
export const purgeTables = (tables) =>
  Object.entries(tables)
    .filter(([, e]) => e?.class === 'isolated')
    .map(([name, e]) => ({ name, purgeOrder: e.purgeOrder ?? Number.MAX_SAFE_INTEGER, pk: e.pk ?? 'id' }))
    .sort((a, b) => a.purgeOrder - b.purgeOrder)
