#!/usr/bin/env node
// check-supabase-token — is SUPABASE_ACCESS_TOKEN one that actually works?
//
// This token is what stands between us and four things nobody can do from this
// repo today: setting the Auth password policy, setting SMTP, deploying edge
// functions, and setting function secrets. It has been the blocker for a while
// and the diagnosis in the notes was wrong, so here is the test rather than
// another guess.
//
//   node scripts/check-supabase-token.mjs
//
// Never prints the token. It reports the shape — length and prefix — because
// that is what tells a truncated paste from a revoked one, and nothing else.
//
// ── WHAT WAS ACTUALLY WRONG, 2026-08-29 ─────────────────────────────────────
// The stored token is `sbp_` + 57 base62 characters, unquoted, no stray
// whitespace: a well-formed personal access token. The note in memory said the
// CLI needed the older `sbp_` + 40 hex shape and that a longer one was rejected
// for being the wrong format. That was a misdiagnosis. The format is fine; the
// token is simply not accepted — 401 "JWT could not be decoded" on
// /v1/organizations, /v1/projects and the project's own /config/auth. A token
// that shape and that dead is revoked, expired, or short a few characters from
// the copy.
//
// ── WHERE A REAL ONE COMES FROM ─────────────────────────────────────────────
// https://supabase.com/dashboard/account/tokens — the ACCOUNT page, reachable
// from the avatar menu, not from inside a project. Tokens generated from a
// project's settings are scoped to that project and are a different thing;
// asking for one there is the likeliest way to end up with something that looks
// right and answers 401. Generate it, put it in .env.supabase as
// SUPABASE_ACCESS_TOKEN, and run this.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  // Read the file directly rather than through a shell: sourcing an env file
  // can carry quotes and trailing whitespace into the value, and that produces
  // exactly the same 401 as a dead token. Worth ruling out before blaming
  // Supabase.
  try {
    const line = readFileSync(join(ROOT, '.env.supabase'), 'utf8')
      .split('\n').find(l => l.startsWith('SUPABASE_ACCESS_TOKEN='))
    if (line) token = line.slice('SUPABASE_ACCESS_TOKEN='.length)
  } catch { /* reported below */ }
}

if (!token) {
  console.error('No SUPABASE_ACCESS_TOKEN, in the environment or in .env.supabase.')
  process.exit(1)
}

const raw = token
token = token.trim().replace(/^["']|["']$/g, '')

console.log('\nTOKEN SHAPE  (never the value)')
console.log(`  length            ${token.length}`)
console.log(`  prefix            ${token.slice(0, 8)}…`)
console.log(`  quoted or padded  ${raw.trim() !== raw || raw.trim() !== token ? 'YES — that alone causes a 401' : 'no'}`)
if (!token.startsWith('sbp_')) {
  console.log('  !! a personal access token starts sbp_. This is something else —')
  console.log('     a project API key or an anon key will never work here.')
}

const api = (path) => fetch(`https://api.supabase.com${path}`, {
  headers: { Authorization: `Bearer ${token}` },
})

console.log('\nWHAT IT CAN REACH')
let ok = 0, dead = 0
let projects = []

for (const [label, path] of [['organizations', '/v1/organizations'], ['projects', '/v1/projects']]) {
  let res, body
  try { res = await api(path); body = await res.json().catch(() => null) }
  catch (e) { console.log(`  FAIL  ${label}: could not reach the API — ${e.message}`); dead++; continue }

  if (res.ok) {
    ok++
    const n = Array.isArray(body) ? body.length : 0
    console.log(`  ok    ${label}: ${n}`)
    if (label === 'projects' && Array.isArray(body)) projects = body
  } else {
    dead++
    const msg = body?.message ?? `HTTP ${res.status}`
    console.log(`  FAIL  ${label}: ${res.status} ${msg}`)
  }
}

// The two settings that are actually wanted. Read-only here — this reports
// whether the token could set them, it does not set anything.
if (projects.length) {
  console.log('\nTHE SETTINGS THIS UNBLOCKS')
  for (const p of projects) {
    const res = await api(`/v1/projects/${p.id}/config/auth`)
    if (!res.ok) {
      console.log(`  FAIL  ${p.name}: cannot read auth config (${res.status})`)
      dead++
      continue
    }
    const cfg = await res.json().catch(() => ({}))
    const smtp = cfg.smtp_host ? `configured (${cfg.smtp_host})` : 'NOT configured — no login codes will arrive'
    const minLen = cfg.password_min_length ?? '(unset)'
    const classes = cfg.password_required_characters
      ? String(cfg.password_required_characters).slice(0, 40) + '…'
      : 'NONE — every rule in lib/credentials.ts is browser-only'
    console.log(`  ok    ${p.name} [${p.id}]`)
    console.log(`          SMTP                 ${smtp}`)
    console.log(`          password min length  ${minLen}  (lib/credentials.ts wants 10)`)
    console.log(`          required characters  ${classes}`)
    ok++
  }
}

console.log(`\n${'─'.repeat(70)}`)
if (dead === 0 && ok > 0) {
  console.log('The token works. Edge function deploys, function secrets, SMTP and the')
  console.log('password policy are all reachable from here now.')
  process.exit(0)
}
console.log('The token does not work.')
console.log('Generate a new one at https://supabase.com/dashboard/account/tokens —')
console.log('the ACCOUNT page from the avatar menu, not a project settings page —')
console.log('put it in .env.supabase as SUPABASE_ACCESS_TOKEN, and run this again.')
process.exit(1)
