// Dry-run migrations: apply them, in order, in ONE transaction, then ROLL BACK.
//
// Proves a set of migrations will apply cleanly on a database — including
// production — without changing it. Nothing is written, not even the ledger.
//
//   node scripts/dry-run.mjs prod 0116_whatsapp_marketing 0117_… 0118_…
//
// Exit 0 = every migration applied and was rolled back. Exit 1 = the first
// failure is printed and everything was rolled back.
import pg from 'pg'; import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
dotenv.config({ path: '.env.supabase', quiet: true })

const [envArg, ...versions] = process.argv.slice(2)
const env = (envArg || '').toUpperCase()
if (!['PROD', 'SANDBOX'].includes(env) || !versions.length) {
  console.error('usage: dry-run.mjs <prod|sandbox> <version> [version…]'); process.exit(1)
}
const c = new pg.Client({ connectionString: process.env[`SUPABASE_DB_URL_${env}`], ssl: { rejectUnauthorized: false } })
await c.connect()
let ok = true
try {
  await c.query('begin')
  for (const v of versions) {
    const done = (await c.query('select 1 from public.schema_migrations where version=$1', [v])).rowCount
    if (done) { console.log(`${v} … already applied, skipped`); continue }
    await c.query(`savepoint s`)
    try {
      await c.query(readFileSync(`supabase/migrations/${v}.sql`, 'utf8'))
      console.log(`${v} … would apply`)
    } catch (e) {
      console.log(`${v} … WOULD FAIL: ${e.message}`); ok = false; break
    }
  }
} finally {
  await c.query('rollback').catch(() => {})
  await c.end()
}
console.log(ok ? `\nAll good on ${env}. Nothing was changed.` : `\nStopped. Nothing was changed on ${env}.`)
process.exit(ok ? 0 : 1)
