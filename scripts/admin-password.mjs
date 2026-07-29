#!/usr/bin/env node
// admin-password — set an admin's password, and keep their admin_users row.
//
// Why this exists: the admin login is two independent checks, and losing either
// one produces the *same* "Invalid credentials" message.
//
//   1. Supabase Auth verifies the password.
//   2. src/pages/admin/Login.tsx then looks the user up in admin_users, and
//      signs them straight back out if there is no row.
//
// Step 2 is the trap. admin_users.auth_uid is `on delete cascade`, so deleting
// and recreating the auth user in the dashboard silently takes the admin row
// with it — and the only SELECT policy on admin_users is sehat_is_admin(),
// which reads admin_users itself. Once the last row is gone no client can read
// or restore it, and the login reports a perfectly correct password as wrong.
//
// So this script always repairs the admin_users row, not just the password.
//
//   node scripts/admin-password.mjs --env both
//   node scripts/admin-password.mjs --env sandbox
//   node scripts/admin-password.mjs --env prod --email nits.garg@gmail.com
//   node scripts/admin-password.mjs --env both --check
//
// --env both sets the SAME password on sandbox and production. They are
// separate Supabase projects with separately salted hashes, so "the same
// password" means running the update twice, not copying a hash. Each project is
// its own transaction: if production fails, sandbox stays as it was and the
// script says so rather than reporting a half-applied change as success.
//
// The password is prompted for and never echoed, so it stays out of your shell
// history and out of `ps`. Pass it via the ADMIN_PASSWORD env var for CI.
//
// Connection strings come from .env.supabase (gitignored — they carry the
// database password and bypass RLS entirely).

import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { join } from 'node:path'
import pg from 'pg'
import dotenv from 'dotenv'
import { ROOT } from './lib/tables-config.mjs'
import { assertDbUrls } from './lib/db-url.mjs'

dotenv.config({ path: join(ROOT, '.env.supabase'), quiet: true })

// ── args ──
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? null : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

const envArg = flag('env')
if (!['prod', 'sandbox', 'both'].includes(envArg)) {
  fail('--env must be "prod", "sandbox" or "both"')
}
// Sandbox first: if the two projects somehow disagree, discovering it on the
// disposable one is cheaper than discovering it on production.
const envs = envArg === 'both' ? ['sandbox', 'prod'] : [envArg]

const DEFAULT_EMAIL = 'nits.garg@gmail.com'
const email = (flag('email') ?? DEFAULT_EMAIL).trim().toLowerCase()
const checkOnly = has('check')

// Resolve and validate every connection string up front, so --env both cannot
// change sandbox and then discover production was never configured.
const dbUrls = envs.map((env) => {
  const key = `SUPABASE_DB_URL_${env.toUpperCase()}`
  const url = process.env[key]
  if (!url) {
    fail(
      `${key} is not set.\n` +
      `Create .env.supabase (see .env.supabase.example) with the connection string for ${env}.`,
    )
  }
  return [env, key, url]
})
assertDbUrls(dbUrls.map(([, key, url]) => [key, url]))

// Two envs pointing at one database would apply the "second" change to the
// project already updated, and report success for an environment never touched.
if (dbUrls.length === 2 && dbUrls[0][2] === dbUrls[1][2]) {
  fail('SUPABASE_DB_URL_SANDBOX and SUPABASE_DB_URL_PROD are identical. Refusing to run.')
}

// ── password rules ──
// 12 characters matches what the in-app Account tab enforces
// (src/pages/admin/Dashboard.tsx). Setting a shorter one here would create a
// password that works at login but cannot be re-entered as the "current" one
// when changing it in the app.
const MIN_LENGTH = 12

function passwordProblems(pw) {
  const problems = []
  if (pw.length < MIN_LENGTH) {
    problems.push(`must be at least ${MIN_LENGTH} characters (the Account tab enforces this too) — got ${pw.length}`)
  }
  if (pw !== pw.trim()) {
    problems.push('starts or ends with a space, which is almost always a paste error')
  }
  return problems
}

/**
 * Read a line from the terminal, echoing one "*" per character.
 *
 * Showing the length is the point: a fully silent prompt gives no feedback that
 * a keystroke registered, so a dropped character or a stray paste stays
 * invisible until the two entries fail to match. The characters themselves are
 * still never rendered, so nothing sensitive reaches the screen or scrollback.
 */
function promptHidden(question) {
  return new Promise((resolve) => {
    // Readline echoes keystrokes as it receives them, so repainting afterwards
    // is too late: the characters have already reached the terminal, and on a
    // fast paste they simply stay there. Intercept readline's output instead —
    // this stream swallows what readline writes while masking is on, leaving us
    // to draw the row of asterisks ourselves.
    let masking = false
    const out = new Writable({
      write(chunk, _enc, cb) {
        if (!masking) process.stdout.write(chunk)
        cb()
      },
    })
    // Readline reads these off its output stream to position the cursor.
    out.columns = process.stdout.columns
    out.rows = process.stdout.rows
    out.isTTY = true

    const rl = createInterface({ input: process.stdin, output: out, terminal: true })

    const redraw = () => {
      process.stdout.clearLine(0)
      process.stdout.cursorTo(0)
      // rl.line is readline's own buffer, so the count stays correct through
      // backspace, paste and ctrl-u rather than counting keypresses.
      process.stdout.write(question + '*'.repeat(rl.line.length))
    }
    // 'keypress' fires after readline has applied the key to rl.line, so the
    // mask is drawn from the true buffer. setImmediate would coalesce under a
    // fast paste and drop the final redraw.
    const onKey = () => { if (masking) redraw() }

    process.stdin.on('keypress', onKey)
    rl.question(question, (answer) => {
      masking = false
      process.stdin.removeListener('keypress', onKey)
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
    // Start swallowing only after the prompt itself has been written.
    masking = true
  })
}

// ── one environment ──
//
// Split into inspect → change so --env both can inspect every project, and
// prompt once, before writing anything to any of them.

/** Look up the user and their admin row. Returns null if the account is unusable. */
async function inspect(env, client) {
  const { rows: users } = await client.query(
    'select id, email, email_confirmed_at, banned_until from auth.users where lower(email) = $1',
    [email],
  )

  if (users.length === 0) {
    fail(
      `No auth user "${email}" in ${env}.\n` +
      `      Create them first: Supabase Dashboard → Authentication → Users → Add user.\n` +
      `      Then re-run this to set the password and link the admin_users row.`,
    )
  }
  if (users.length > 1) {
    // Should be impossible (auth.users has a unique index on email), but if it
    // ever happens, guessing which one to update would be worse than stopping.
    fail(`${users.length} auth users share "${email}" in ${env}. Resolve that in the dashboard first.`)
  }

  const user = users[0]
  const { rows: adminRows } = await client.query(
    'select role, is_active from admin_users where auth_uid = $1',
    [user.id],
  )
  const admin = adminRows[0] ?? null

  console.log(`\n  ${env} · ${user.email}`)
  console.log(`    auth user   ${user.id}`)
  console.log(`    confirmed   ${user.email_confirmed_at ? 'yes' : 'NO — login will fail until confirmed'}`)
  if (user.banned_until) console.log(`    banned      until ${user.banned_until}`)
  console.log(
    `    admin_users ${admin
      ? `present (role ${admin.role}, ${admin.is_active ? 'active' : 'INACTIVE — login will fail'})`
      : 'MISSING — login would fail with "Invalid credentials" even with the right password'}`,
  )

  const healthy = Boolean(user.email_confirmed_at) && !user.banned_until && Boolean(admin?.is_active)
  return { user, admin, healthy }
}

/** Set the password and repair the admin_users row, then verify under RLS. */
async function applyTo(env, client, user, password) {
  // One transaction: a password nobody can log in with is worse than no change.
  await client.query('begin')
  try {
    await client.query('create extension if not exists pgcrypto')
    await client.query(
      `update auth.users
          set encrypted_password = crypt($2, gen_salt('bf')),
              updated_at = now()
        where id = $1`,
      [user.id, password],
    )

    // Repair the admin_users row in the same breath. This is the half that
    // silently disappears, and the half no client can restore.
    const cols = (await client.query(
      `select column_name from information_schema.columns where table_name = 'admin_users'`,
    )).rows.map(r => r.column_name)
    const hasRole = cols.includes('role')
    const hasActive = cols.includes('is_active')

    await client.query(
      `insert into admin_users (auth_uid${hasRole ? ', role' : ''}${hasActive ? ', is_active' : ''})
       values ($1${hasRole ? ", 'owner'" : ''}${hasActive ? ', true' : ''})
       on conflict (auth_uid) do update
         set ${hasActive ? 'is_active = true' : 'auth_uid = excluded.auth_uid'}`,
      [user.id],
    )
    await client.query('commit')
  } catch (e) {
    await client.query('rollback')
    // Thrown, not fail()ed: the caller reports which environments already
    // changed, which it can only do if this returns control to it.
    throw new Error(`${e.message} (this project was rolled back)`)
  }

  // Verify the way the app does it, rather than trusting the write. Both halves
  // are checked as the logged-in user would see them, with RLS applied.
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query(
    `select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email })],
  )
  const { rows: [{ ok }] } = await client.query('select sehat_is_admin() as ok')
  const { rowCount: visible } = await client.query(
    'select role from admin_users where auth_uid = $1',
    [user.id],
  )
  await client.query('rollback')

  if (!ok || visible !== 1) {
    throw new Error(
      'password was set, but the admin check still fails ' +
      `(sehat_is_admin() = ${ok}, admin_users rows visible = ${visible}). ` +
      'Login would still say "Invalid credentials".',
    )
  }
}

// ── main ──
const clients = []
try {
  for (const [env, , url] of dbUrls) {
    const client = new pg.Client({ connectionString: url })
    try {
      await client.connect()
    } catch (e) {
      fail(`Could not connect to ${env}: ${e.message}`)
    }
    clients.push([env, client])
  }

  // Inspect every environment before writing to any of them.
  const found = []
  for (const [env, client] of clients) {
    found.push([env, client, await inspect(env, client)])
  }

  if (checkOnly) {
    const allHealthy = found.every(([, , r]) => r.healthy)
    console.log(`\n  ${allHealthy
      ? '✓ Every account checked can log in.'
      : '✗ At least one account cannot log in — re-run without --check to repair it.'}\n`)
    process.exit(allHealthy ? 0 : 1)
  }

  // Prompt once, apply everywhere: "the same password on both" is the point.
  let password = process.env.ADMIN_PASSWORD
  if (password) {
    const problems = passwordProblems(password)
    if (problems.length) fail(`ADMIN_PASSWORD ${problems.join('; ')}`)
  } else {
    if (!process.stdin.isTTY) fail('No terminal to prompt on. Set ADMIN_PASSWORD instead.')
    console.log(`\n  Setting one password for: ${found.map(([e]) => e).join(' and ')}`)
    password = await promptHidden('    New password: ')
    const problems = passwordProblems(password)
    if (problems.length) fail(`Password ${problems.join('; ')}`)
    const again = await promptHidden('    Again:        ')
    if (password !== again) fail('The two passwords do not match. Nothing was changed.')
  }

  const done = []
  for (const [env, client, { user }] of found) {
    try {
      await applyTo(env, client, user, password)
      done.push(env)
    } catch (e) {
      // Say plainly what did and did not change, rather than leaving the
      // operator to guess which project is now on which password.
      const already = done.length ? `Already changed: ${done.join(', ')}. ` : 'Nothing was changed. '
      fail(`${env} failed: ${e.message}\n      ${already}${env} is unchanged.`)
    }
  }

  console.log(`\n  ✓ Password set for ${email} on ${done.join(' and ')}.`)
  console.log('    admin_users row present, and visible under RLS to that user.')
  console.log('    Sign in at /ng-ctrl-2026 (add ?env=sandbox for the sandbox project).\n')
} finally {
  for (const [, client] of clients) await client.end()
}
