#!/usr/bin/env node
// fix-env-passwords — percent-encode the passwords in .env.migrate in place.
//
// A Supabase-generated password often contains @ # / ? or :, and a literal @
// makes the URL parse against the wrong host boundary: the pooler then answers
// "Tenant or user not found", which reads like the project does not exist
// rather than like a quoting problem. Rather than hand-encode after every
// password reset, paste the URI exactly as the dashboard gives it and run this.
//
//   node scripts/fix-env-passwords.mjs            # rewrite in place
//   node scripts/fix-env-passwords.mjs --check    # report only, change nothing
//
// Idempotent: an already-encoded password is left alone rather than
// double-escaped (%40 must not become %2540).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/tables-config.mjs'

const ENV_PATH = join(ROOT, '.env.migrate')
const checkOnly = process.argv.includes('--check')

if (!existsSync(ENV_PATH)) {
  console.error(`\n  ✗ ${ENV_PATH} not found. Copy .env.migrate.example first.\n`)
  process.exit(1)
}

const KEYS = ['SUPABASE_DB_URL_PROD', 'SUPABASE_DB_URL_SANDBOX']
const original = readFileSync(ENV_PATH, 'utf8')
let updated = original
const changes = []

for (const key of KEYS) {
  const re = new RegExp(`^(${key}=)(postgresql://)(.+)$`, 'm')
  const m = re.exec(updated)
  if (!m) continue

  const rest = m[3]
  // Split on the LAST '@': everything before it is credentials, so an
  // unencoded '@' inside the password does not confuse the boundary.
  const lastAt = rest.lastIndexOf('@')
  if (lastAt === -1) continue
  const cred = rest.slice(0, lastAt)
  const hostPart = rest.slice(lastAt + 1)

  const firstColon = cred.indexOf(':')
  if (firstColon === -1) continue
  const user = cred.slice(0, firstColon)
  const rawPass = cred.slice(firstColon + 1)

  // Decode first so a partly-encoded value round-trips to the same result.
  let plain = rawPass
  try { plain = decodeURIComponent(rawPass) } catch { /* stray % — treat literally */ }
  const encoded = encodeURIComponent(plain)

  if (encoded === rawPass) continue   // already correct

  changes.push({ key, from: rawPass, to: encoded })
  updated = updated.replace(re, `$1$2${user}:${encoded}@${hostPart}`)
}

if (!changes.length) {
  console.log('\n  ✓ Passwords in .env.migrate are already correctly encoded.\n')
  process.exit(0)
}

console.log(`\n  ${checkOnly ? 'Would encode' : 'Encoded'} ${changes.length} password(s):\n`)
for (const c of changes) {
  // Show only the shape, never the secret itself.
  console.log(`      ${c.key}`)
  console.log(`        ${c.from.length} chars → ${c.to.length} chars (specials escaped)`)
}

if (checkOnly) {
  console.log('\n  Run without --check to apply.\n')
  process.exit(1)
}

writeFileSync(ENV_PATH, updated)
console.log('\n  ✓ .env.migrate updated. Verify with:  node scripts/migrate.mjs status --env prod\n')
