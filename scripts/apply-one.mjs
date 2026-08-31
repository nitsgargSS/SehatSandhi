// Apply ONE named migration, the way cmdUp does — same transaction, same
// sha256 ledger row. Exists because `migrate.mjs up` has no targeting and
// production deliberately holds 0082/0085 back.
import pg from 'pg'; import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto'
dotenv.config({ path: '.env.supabase', quiet: true })
const version = process.argv[2]
const env = (process.argv[3] || 'prod').toUpperCase()
if (!version) { console.error('usage: apply-one.mjs <version> [prod|sandbox]'); process.exit(1) }
const sql = readFileSync(`supabase/migrations/${version}.sql`, 'utf8')
const checksum = createHash('sha256').update(sql).digest('hex')
const c = new pg.Client({ connectionString: process.env[`SUPABASE_DB_URL_${env}`], ssl: { rejectUnauthorized: false } })
await c.connect()
if ((await c.query('select 1 from public.schema_migrations where version=$1', [version])).rowCount) {
  console.log(`${version} … already applied to ${env}`); await c.end(); process.exit(0)
}
try {
  await c.query('begin'); await c.query(sql)
  await c.query('insert into public.schema_migrations (version, checksum) values ($1,$2)', [version, checksum])
  await c.query('commit'); console.log(`${version} … ok`)
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.log(`${version} … FAILED, rolled back: ${e.message}`); process.exit(1)
}
await c.end()
