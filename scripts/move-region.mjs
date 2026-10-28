#!/usr/bin/env node
// move-region — copy production (Tokyo) into the Mumbai project.
// The plan, and why each part is done this way: docs/2026-10-mumbai-migration.md.
//
//   node scripts/move-region.mjs [step] [--rehearse | --cutover] [--yes]
//
// Steps, in the order `all` runs them:
//   preflight   both databases reachable; Mumbai is in ap-south-1 and empty
//   extensions  the extensions production uses (pg_cron, pg_net, …)
//   schema      our own schemas (public): tables, functions, views, policies, grants
//   managed     what we added inside Supabase's schemas: triggers on auth.*,
//               policies on storage.*
//   data        our tables + logins (auth.users / identities / mfa), triggers off
//   repoint     saved file links that name the Tokyo project now name Mumbai
//   cron        the scheduled jobs
//   vault       the Vault secrets — decrypted from Tokyo, recreated in Mumbai
//   storage     buckets and every file in them
//   verify      row, login, file, job and secret counts on both sides
// Run on their own:
//   auth-config copy Authentication settings (not the SMTP password)
//   functions   deploy every Edge Function, with Tokyo's verify_jwt per function
//   secrets     copy Tokyo's Edge Function secrets to Mumbai, through the one-off
//               move-secrets function (deploy it to Tokyo first, delete after);
//               the sending keys only with --cutover
//   wipe        empty Mumbai again, after a rehearsal
//   pause-tokyo / resume-tokyo   cutover only: stop / restart Tokyo's jobs
//
// --rehearse (the default) makes a copy that cannot message anybody: the
// scheduled jobs are created switched OFF and the Meta / AiSensy tokens are not
// copied into the Vault. Mumbai holds real queues (reminders, automatic
// messages, billing notices); a live job there would send them a second time.
// --cutover copies everything as it is.
//
// Never writes to Tokyo, except pause-tokyo / resume-tokyo. Dumps go to
// ~/sehatsandhi-move/<mode>/ — they hold patient data; delete them afterwards.

import pg from 'pg'
import dotenv from 'dotenv'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.supabase', quiet: true })
// Optional, never committed (.env.*.local): SMTP_PASS for auth-config.
dotenv.config({ path: '.env.mumbai.local', quiet: true })

const SRC_REF = 'ctxkkqqtasegoowuqbmi' // Tokyo, production today
const DST_REF = 'tbmlhawtnrvvnemcljma' // Mumbai
const SRC_DB = process.env.SUPABASE_DB_URL_PROD
const DST_DB = process.env.SUPABASE_DB_URL_MUMBAI
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const BIN = '/Applications/Postgres.app/Contents/Versions/latest/bin'

const argv = process.argv.slice(2)
const MODE = argv.includes('--cutover') ? 'cutover' : 'rehearse'
const YES = argv.includes('--yes')
const STEP = argv.find(a => !a.startsWith('--')) ?? 'all'
const WORK = join(homedir(), 'sehatsandhi-move', MODE)

// Supabase's own schemas: never dumped wholesale; what we added inside them is
// picked out by the `managed` step.
const MANAGED = new Set(['auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'realtime', '_realtime',
  'supabase_functions', 'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'pgbouncer',
  '_analytics', 'information_schema'])
// Logins move; sessions, tokens and audit history do not (the new project has
// its own signing keys, so every session ends at the move anyway).
const AUTH_TABLES = ['auth.users', 'auth.identities', 'auth.mfa_factors']
// Copied only at cutover: with these a copy can send real WhatsApp messages.
const SENDING_SECRETS = new Set(['meta_access_token', 'aisensy_api_key'])

// ── helpers ─────────────────────────────────────────────────────────────────

const say = (s = '') => console.log(s)
const step = (s) => say(`\n── ${s} ${'─'.repeat(Math.max(0, 70 - s.length))}`)
function die(msg) { console.error(`\n✗ ${msg}`); process.exit(1) }

async function connect(url, label) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try { await c.connect() } catch (e) { die(`${label}: cannot connect (${e.message})`) }
  return c
}

async function mgmt(path, init = {}) {
  if (!TOKEN) die('SUPABASE_ACCESS_TOKEN is not in .env.supabase')
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) throw new Error(`Management API ${init.method ?? 'GET'} ${path}: ${res.status} ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 400))
  return body
}

/**
 * The connection string as libpq wants it. node-pg splits user from host at the
 * LAST "@", libpq at the first, so a password with "@" (or ":", "/", "#"…)
 * works for one and not the other. Percent-encoding the password suits both.
 */
function libpq(url) {
  const m = url?.match(/^(postgres(?:ql)?:\/\/)([^:@/]+):(.*)@([^@]+)$/)
  if (!m) return url
  let pw = m[3]
  try { pw = decodeURIComponent(pw) } catch { /* not encoded */ }
  return `${m[1]}${m[2]}:${encodeURIComponent(pw)}@${m[4]}`
}

/** pg_dump / psql, never through a shell; the connection string goes as an argument, not on screen. */
function tool(name, args) {
  args = args.map(a => [SRC_DB, DST_DB].reduce((s, u) => (u ? s.split(u).join(libpq(u)) : s), a))
  const r = spawnSync(join(BIN, name), args, { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 30 })
  if (r.status !== 0) die(`${name} failed:\n${(r.stderr ?? '').replace(/postgresql:\/\/\S+/g, '<db>').slice(-3000)}`)
  if (r.stderr?.trim()) say(r.stderr.replace(/postgresql:\/\/\S+/g, '<db>').trim().split('\n').slice(-5).join('\n'))
}

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`
const arr = (v) => Array.isArray(v) ? v : String(v ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean)

async function appSchemas(src) {
  const { rows } = await src.query(`
    select nspname from pg_namespace
     where nspname not like 'pg\\_%' and nspname <> 'information_schema'
     order by nspname`)
  return rows.map(r => r.nspname).filter(n => !MANAGED.has(n))
}

async function serviceKey(ref, like) {
  const keys = await mgmt(`/projects/${ref}/api-keys?reveal=true`)
  // The same kind of key as Tokyo's Vault holds: a legacy JWT (eyJ…) or a new sb_secret_ key.
  const wantSecret = like?.startsWith('sb_secret_')
  const k = wantSecret ? keys.find(k => k.type === 'secret') : keys.find(k => k.name === 'service_role')
  if (!k?.api_key) die(`no ${wantSecret ? 'secret' : 'service_role'} key found for ${ref}`)
  return k.api_key
}

async function confirm(question) {
  if (YES) return
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = (await rl.question(`${question} Type "yes" to go on: `)).trim().toLowerCase()
  rl.close()
  if (a !== 'yes') die('stopped — nothing further was done')
}

// ── steps ───────────────────────────────────────────────────────────────────

async function preflight(src, dst) {
  step('preflight')
  if (!SRC_DB || !DST_DB) die('SUPABASE_DB_URL_PROD and SUPABASE_DB_URL_MUMBAI must both be in .env.supabase')
  if (!DST_DB.includes(DST_REF) || DST_DB.includes(SRC_REF)) die('SUPABASE_DB_URL_MUMBAI does not point at the Mumbai project')
  const [s, d] = await Promise.all([mgmt(`/projects/${SRC_REF}`), mgmt(`/projects/${DST_REF}`)])
  say(`Tokyo  ${SRC_REF}  ${s.region}  ${s.status}`)
  say(`Mumbai ${DST_REF}  ${d.region}  ${d.status}`)
  if (d.region !== 'ap-south-1') die('the target is not in ap-south-1')
  const v = await Promise.all([src, dst].map(c => c.query(`select current_setting('server_version') v`)))
  say(`Postgres ${v[0].rows[0].v} → ${v[1].rows[0].v}`)
  const schemas = await appSchemas(src)
  say(`Our schemas in Tokyo: ${schemas.join(', ')}`)
  const { rows: [e] } = await dst.query(`
    select (select count(*) from pg_tables where schemaname = 'public')::int tables,
           (select count(*) from auth.users)::int users`)
  if (e.tables || e.users) die(`Mumbai is not empty (${e.tables} tables, ${e.users} logins). Run the "wipe" step first.`)
  say('Mumbai is empty.')
  say(`Mode: ${MODE}${MODE === 'rehearse' ? ' — scheduled jobs off, sending tokens left out' : ' — EVERYTHING copied, jobs as in Tokyo'}`)
  if (MODE === 'cutover') await confirm('Cutover copy into Mumbai.')
  mkdirSync(WORK, { recursive: true }); chmodSync(WORK, 0o700)
  say(`Working files: ${WORK}`)
}

async function extensions(src, dst) {
  step('extensions')
  const q = `select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname <> 'plpgsql'`
  const [{ rows: want }, { rows: have }] = await Promise.all([src.query(q), dst.query(q)])
  const got = new Set(have.map(r => r.extname))
  for (const { extname, nspname } of want) {
    if (got.has(extname)) continue
    const sql = extname === 'pg_cron' ? `create extension if not exists pg_cron`
      : `create extension if not exists ${ident(extname)} with schema ${ident(nspname)}`
    await dst.query(sql)
    say(`+ ${extname} (${nspname})`)
  }
  say(`${want.length} extensions in place.`)
}

async function schema(src, dst) {
  step('schema')
  const schemas = await appSchemas(src)
  const file = join(WORK, 'schema.sql')
  tool('pg_dump', [`--dbname=${SRC_DB}`, '--schema-only', '--no-owner', '--no-publications', '--no-subscriptions',
    ...schemas.flatMap(n => ['-n', n]), '-f', file])
  // Two things the target refuses: re-creating a schema it already has, and
  // default privileges for supabase_admin, a role we do not own.
  const sql = readFileSync(file, 'utf8')
    .replace(/^CREATE SCHEMA /gm, 'CREATE SCHEMA IF NOT EXISTS ')
    .split('\n').filter(l => !/FOR ROLE "?supabase_admin"?/.test(l) && !/^COMMENT ON SCHEMA /.test(l)).join('\n')
  writeFileSync(file, sql)
  tool('psql', [DST_DB, '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', file])
  const { rows: [n] } = await dst.query(`select count(*)::int n from pg_tables where schemaname = any($1)`, [schemas])
  say(`${n.n} tables created.`)
}

async function managed(src, dst) {
  step('managed (auth triggers, storage policies)')
  const { rows: trg } = await src.query(`
    select n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid) def
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
     where not t.tgisinternal and n.nspname in ('auth', 'storage')
       and pn.nspname not in ('auth', 'storage', 'realtime', 'supabase_functions', 'extensions', 'vault')`)
  const { rows: pol } = await src.query(`
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies where schemaname in ('auth', 'storage')`)
  const out = []
  for (const t of trg) out.push(`drop trigger if exists ${ident(t.tgname)} on ${ident(t.nspname)}.${ident(t.relname)};`, `${t.def};`)
  for (const p of pol) {
    const on = `${ident(p.schemaname)}.${ident(p.tablename)}`
    const roles = arr(p.roles).map(r => (r === 'public' ? 'public' : ident(r))).join(', ')
    out.push(`drop policy if exists ${ident(p.policyname)} on ${on};`,
      `create policy ${ident(p.policyname)} on ${on} as ${p.permissive} for ${p.cmd} to ${roles}` +
      (p.qual ? ` using (${p.qual})` : '') + (p.with_check ? ` with check (${p.with_check})` : '') + ';')
  }
  const file = join(WORK, 'managed.sql')
  writeFileSync(file, out.join('\n') + '\n')
  if (out.length) tool('psql', [DST_DB, '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', file])
  say(`${trg.length} triggers, ${pol.length} policies.`)
}

async function data(src, dst) {
  step('data')
  const schemas = await appSchemas(src)
  const auth = join(WORK, 'data-auth.sql'), app = join(WORK, 'data-app.sql')
  // Two dumps: pg_dump ignores -n when -t is given.
  tool('pg_dump', [`--dbname=${SRC_DB}`, '--data-only', '--no-owner', ...AUTH_TABLES.flatMap(t => ['-t', t]), '-f', auth])
  tool('pg_dump', [`--dbname=${SRC_DB}`, '--data-only', '--no-owner', ...schemas.flatMap(n => ['-n', n]), '-f', app])
  // Triggers off for the load: the rows are already what the triggers made.
  tool('psql', [DST_DB, '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction',
    '-c', 'SET session_replication_role = replica', '-f', auth, '-f', app])
  const { rows: [u] } = await dst.query(`select count(*)::int n from auth.users`)
  say(`Loaded. ${u.n} logins.`)
}

async function repoint(src, dst) {
  step('repoint')
  // Public file links (letterheads, photos, broadcast images) are saved as full
  // URLs with the project's address in them; after the move they must name Mumbai.
  const schemas = await appSchemas(src)
  const { rows: cols } = await dst.query(`
    select c.table_schema s, c.table_name t, c.column_name col, c.data_type dt
      from information_schema.columns c join pg_tables p on p.schemaname = c.table_schema and p.tablename = c.table_name
     where c.table_schema = any($1) and c.data_type in ('text', 'character varying', 'jsonb', 'json')
       and c.is_generated = 'NEVER'`, [schemas])
  const from = `${SRC_REF}.supabase.co`, to = `${DST_REF}.supabase.co`
  await dst.query('SET session_replication_role = replica')
  let n = 0
  for (const r of cols) {
    const col = ident(r.col), tbl = `${ident(r.s)}.${ident(r.t)}`
    const expr = r.dt.startsWith('json') ? `replace(${col}::text, $1, $2)::${r.dt}` : `replace(${col}, $1, $2)`
    const res = await dst.query(`update ${tbl} set ${col} = ${expr} where ${col}::text like '%' || $1 || '%'`, [from, to])
    if (res.rowCount) { n += res.rowCount; say(`  ${r.s}.${r.t}.${r.col}: ${res.rowCount}`) }
  }
  await dst.query('SET session_replication_role = origin')
  say(`${n} values now point at Mumbai.`)
}

async function cron(src, dst) {
  step('cron')
  const { rows } = await src.query(`select jobname, schedule, command, active from cron.job order by jobname`)
  // At cutover Tokyo's jobs are paused before the copy; pause-tokyo saved how they were.
  const saved = join(WORK, 'cron-state.json')
  const before = existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : null
  for (const j of rows) {
    const live = MODE === 'cutover' ? (before ? before[j.jobname] ?? j.active : j.active) : false
    const { rows: [{ id }] } = await dst.query(`select cron.schedule($1, $2, $3) id`, [j.jobname, j.schedule, j.command])
    await dst.query(`select cron.alter_job($1, active := $2)`, [id, live])
    say(`${live ? '●' : '○'} ${j.jobname}  ${j.schedule}`)
  }
  say(`${rows.length} jobs${MODE === 'rehearse' ? ', all switched off' : ''}.`)
}

async function vault(src, dst) {
  step('vault')
  const { rows } = await src.query(`select name, description, decrypted_secret from vault.decrypted_secrets order by name`)
  const oldKey = rows.find(r => r.name === 'service_role_key')?.decrypted_secret
  const left = []
  for (const r of rows) {
    if (r.name.startsWith('wa_clinic_token_')) { left.push(`${r.name} (clinic reconnects)`); continue }
    if (MODE === 'rehearse' && SENDING_SECRETS.has(r.name)) { left.push(`${r.name} (rehearsal)`); continue }
    let value = r.decrypted_secret
    if (r.name === 'project_url') value = `https://${DST_REF}.supabase.co`
    if (r.name === 'service_role_key') value = await serviceKey(DST_REF, oldKey)
    await dst.query(`delete from vault.secrets where name = $1`, [r.name])
    await dst.query(`select vault.create_secret($1, $2, $3)`, [value, r.name, r.description ?? ''])
    say(`+ ${r.name}${['project_url', 'service_role_key'].includes(r.name) ? ' (Mumbai value)' : ''}`)
  }
  for (const l of left) say(`  left out: ${l}`)
}

async function storage(src, dst) {
  step('storage')
  const [sk, dk] = await Promise.all([serviceKey(SRC_REF), serviceKey(DST_REF)])
  const S = createClient(`https://${SRC_REF}.supabase.co`, sk, { auth: { persistSession: false } }).storage
  const D = createClient(`https://${DST_REF}.supabase.co`, dk, { auth: { persistSession: false } }).storage
  const { rows: buckets } = await src.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`)
  const { rows: haveB } = await dst.query(`select id from storage.buckets`)
  for (const b of buckets) {
    if (haveB.some(h => h.id === b.id)) continue
    const { error } = await D.createBucket(b.id, {
      public: b.public,
      ...(b.file_size_limit ? { fileSizeLimit: Number(b.file_size_limit) } : {}),
      ...(b.allowed_mime_types?.length ? { allowedMimeTypes: arr(b.allowed_mime_types) } : {}),
    })
    if (error) die(`bucket ${b.id}: ${error.message}`)
    say(`+ bucket ${b.id}${b.public ? ' (public)' : ''}`)
  }
  const { rows: objs } = await src.query(`
    select bucket_id, name, owner, owner_id, metadata, user_metadata, created_at, updated_at
      from storage.objects order by bucket_id, name`)
  const { rows: haveO } = await dst.query(`select bucket_id, name, metadata->>'size' size from storage.objects`)
  const done = new Set(haveO.map(o => `${o.bucket_id}/${o.name}|${o.size}`))
  const todo = objs.filter(o => !done.has(`${o.bucket_id}/${o.name}|${o.metadata?.size}`))
  say(`${objs.length} files in Tokyo; ${objs.length - todo.length} already in Mumbai; copying ${todo.length}.`)
  let n = 0; const failed = []
  const work = async (o) => {
    const { data: blob, error: e1 } = await S.from(o.bucket_id).download(o.name)
    if (e1) { failed.push(`${o.bucket_id}/${o.name}: download ${e1.message}`); return }
    const { error: e2 } = await D.from(o.bucket_id).upload(o.name, blob, {
      upsert: true, contentType: o.metadata?.mimetype ?? 'application/octet-stream',
      cacheControl: String(o.metadata?.cacheControl ?? '').replace(/^max-age=/, '') || '3600',
    })
    if (e2) { failed.push(`${o.bucket_id}/${o.name}: upload ${e2.message}`); return }
    if (++n % 50 === 0) say(`  ${n}/${todo.length}`)
  }
  for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(work))
  // The upload made fresh rows; give them back their owner and dates, which
  // owner-based storage policies and "uploaded on" screens read.
  let fixed = 0
  for (const o of objs) {
    const r = await dst.query(`
      update storage.objects set owner = $3, owner_id = $4, user_metadata = $5, created_at = $6, updated_at = $7
       where bucket_id = $1 and name = $2`,
      [o.bucket_id, o.name, o.owner, o.owner_id, o.user_metadata, o.created_at, o.updated_at]).catch(e => ({ error: e }))
    if (r.error) { say(`  ! could not restore owners/dates: ${r.error.message}`); break }
    fixed += r.rowCount
  }
  say(`${n} copied, ${fixed} owners/dates restored.`)
  if (failed.length) { failed.slice(0, 20).forEach(f => say(`  ✗ ${f}`)); die(`${failed.length} files failed — run "storage" again; it skips what is already there`) }
}

async function verify(src, dst) {
  step('verify')
  const schemas = await appSchemas(src)
  const { rows: tables } = await src.query(
    `select schemaname s, tablename t from pg_tables where schemaname = any($1) order by 1, 2`, [schemas])
  const bad = []
  const count = async (c, s, t) => (await c.query(`select count(*)::bigint n from ${ident(s)}.${ident(t)}`)).rows[0].n
  for (const { s, t } of [...tables, ...AUTH_TABLES.map(x => ({ s: x.split('.')[0], t: x.split('.')[1] }))]) {
    const [a, b] = await Promise.all([count(src, s, t), count(dst, s, t).catch(() => 'missing')])
    if (String(a) !== String(b)) bad.push(`${s}.${t}: Tokyo ${a}, Mumbai ${b}`)
  }
  say(`${tables.length + AUTH_TABLES.length} tables compared.`)
  const files = async (c) => Object.fromEntries((await c.query(
    `select bucket_id, count(*)::int n from storage.objects group by 1`)).rows.map(r => [r.bucket_id, r.n]))
  const [fa, fb] = await Promise.all([files(src), files(dst)])
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) if ((fa[k] ?? 0) !== (fb[k] ?? 0)) bad.push(`files in ${k}: Tokyo ${fa[k] ?? 0}, Mumbai ${fb[k] ?? 0}`)
  say(`${Object.values(fa).reduce((x, y) => x + y, 0)} files compared.`)
  const jobs = async (c) => (await c.query(`select jobname from cron.job order by 1`)).rows.map(r => r.jobname).join(',')
  const [ja, jb] = await Promise.all([jobs(src), jobs(dst)])
  if (ja !== jb) bad.push(`scheduled jobs differ:\n    Tokyo  ${ja}\n    Mumbai ${jb}`)
  const { rows: [{ n: active }] } = await dst.query(`select count(*)::int n from cron.job where active`)
  say(`${ja.split(',').filter(Boolean).length} scheduled jobs, ${active} switched on in Mumbai.`)
  const secrets = async (c) => (await c.query(`select name from vault.secrets where name not like 'wa\\_clinic\\_token\\_%' order by 1`)).rows.map(r => r.name)
  const [sa, sb] = await Promise.all([secrets(src), secrets(dst)])
  const missing = sa.filter(x => !sb.includes(x))
  say(`Vault: ${sb.length} of ${sa.length} secrets${missing.length ? ` (not copied: ${missing.join(', ')})` : ''}.`)
  if (MODE === 'cutover' && missing.length) bad.push(`Vault secrets missing in Mumbai: ${missing.join(', ')}`)
  if (bad.length) { bad.forEach(b => say(`  ✗ ${b}`)); die('verification found differences') }
  say('✓ Everything matches.')
}

async function authConfig() {
  step('auth-config')
  const [cfg, now] = await Promise.all([mgmt(`/projects/${SRC_REF}/config/auth`), mgmt(`/projects/${DST_REF}/config/auth`)])
  // Only what differs from Mumbai, with any mention of the Tokyo project pointed
  // at Mumbai. Sending everything trips over features that are off in both
  // (OAuth server, hooks) but come with rules about being set together.
  // Secrets cannot be read from Tokyo and are not sent.
  const patch = {}
  for (const [k, v0] of Object.entries(cfg)) {
    if (v0 === null || /(secrets?|pass(word)?|_key)$/i.test(k)) continue
    const v = typeof v0 === 'string' ? v0.replaceAll(SRC_REF, DST_REF) : v0
    if (JSON.stringify(v) !== JSON.stringify(now[k])) patch[k] = v
  }
  // Auth hooks that are off in Tokyo are left out entirely: some (password and
  // MFA verification attempts) cannot even be set to "off" on the Free plan.
  for (const k of Object.keys(patch)) {
    const hook = k.match(/^(hook_[a-z_]+?)_(enabled|uri|secrets)$/)?.[1]
    if (hook && !cfg[`${hook}_enabled`]) delete patch[k]
  }
  // Supabase refuses any SMTP setting (and the email rate limit, which only
  // custom SMTP allows) unless the SMTP password comes in the same request.
  // It is the ZeptoMail token; give it as SMTP_PASS in .env.mumbai.local to
  // send them all, or leave it out and enter the SMTP card by hand.
  const smtpKeys = Object.keys(patch).filter(k => k.startsWith('smtp_') || k === 'rate_limit_email_sent')
  const pass = process.env.SMTP_PASS
  if (pass && cfg.smtp_host) patch.smtp_pass = pass
  else for (const k of smtpKeys) delete patch[k]
  if (!Object.keys(patch).length) { say('Mumbai already has the same settings.'); return }
  await mgmt(`/projects/${DST_REF}/config/auth`, { method: 'PATCH', body: JSON.stringify(patch) })
  say(`${Object.keys(patch).filter(k => k !== 'smtp_pass').length} settings copied${patch.smtp_pass ? ', SMTP included' : ''}:`)
  for (const k of Object.keys(patch)) if (k !== 'smtp_pass') say(`  ${k}`)
  if (cfg.smtp_host && !patch.smtp_pass) {
    say('SMTP was left out. In Mumbai: Authentication → Emails → SMTP Settings → Enable custom SMTP, then:')
    for (const k of ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_admin_email', 'smtp_sender_name']) if (cfg[k] != null) say(`  ${k.padEnd(18)} ${cfg[k]}`)
    say('  password           the ZeptoMail SMTP token (the same one Tokyo uses)')
    if (cfg.rate_limit_email_sent != null) say(`Then Authentication → Rate Limits → emails per hour: ${cfg.rate_limit_email_sent}`)
  }
}

async function functions() {
  step('functions')
  const live = await mgmt(`/projects/${SRC_REF}/functions`)
  const local = new Set(readdirSync('supabase/functions', { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'move-secrets').map(d => d.name))
  const group = (jwt) => live.filter(f => f.verify_jwt === jwt && local.has(f.slug)).map(f => f.slug)
  for (const f of live) if (!local.has(f.slug)) say(`  ! ${f.slug} is live in Tokyo but not in the repo — not deployed`)
  const all = [...group(true).map(s => [s, true]), ...group(false).map(s => [s, false])]
  let i = 0
  for (const [slug, jwt] of all) {
    say(`[${++i}/${all.length}] ${slug}${jwt ? '' : '  (--no-verify-jwt)'}`)
    const r = spawnSync('npx', ['supabase', 'functions', 'deploy', slug, '--project-ref', DST_REF, ...(jwt ? [] : ['--no-verify-jwt'])],
      { stdio: ['ignore', 'ignore', 'inherit'] })
    if (r.status !== 0) die(`deploy of ${slug} failed — run "functions" again`)
  }
}

async function secrets() {
  step('secrets')
  if (!TOKEN) die('SUPABASE_ACCESS_TOKEN is not in .env.supabase')
  const res = await fetch(`https://${SRC_REF}.supabase.co/functions/v1/move-secrets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, includeSending: MODE === 'cutover' }),
  })
  const r = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (res.status === 404) die('move-secrets is not deployed to Tokyo:\n  npx supabase functions deploy move-secrets --no-verify-jwt --project-ref ' + SRC_REF)
  if (!r.ok) die(`move-secrets: ${r.error}`)
  say(`${r.copied.length} copied: ${r.copied.join(', ')}`)
  if (r.held.length) say(`held back until --cutover: ${r.held.join(', ')}`)
  if (r.missing.length) say(`listed but not in Tokyo's environment: ${r.missing.join(', ')}`)
  say(`Now delete it from Tokyo:\n  npx supabase functions delete move-secrets --project-ref ${SRC_REF}`)
}

async function wipe(dst) {
  step('wipe Mumbai')
  if (!DST_DB?.includes(DST_REF)) die('refusing: SUPABASE_DB_URL_MUMBAI is not the Mumbai project')
  await confirm(`This empties the Mumbai project (${DST_REF}): our schemas, logins, jobs, Vault and files.`)
  const dk = await serviceKey(DST_REF)
  const D = createClient(`https://${DST_REF}.supabase.co`, dk, { auth: { persistSession: false } }).storage
  const { data: bs } = await D.listBuckets()
  for (const b of bs ?? []) { await D.emptyBucket(b.id); await D.deleteBucket(b.id); say(`- bucket ${b.id}`) }
  await dst.query(`select cron.unschedule(jobid) from cron.job`).catch(() => undefined)
  await dst.query(`delete from vault.secrets`)
  const { rows: pol } = await dst.query(`select schemaname, tablename, policyname from pg_policies where schemaname = 'storage'`)
  for (const p of pol) await dst.query(`drop policy if exists ${ident(p.policyname)} on ${ident(p.schemaname)}.${ident(p.tablename)}`)
  for (const n of await appSchemas(dst)) await dst.query(`drop schema if exists ${ident(n)} cascade`)
  await dst.query(`
    create schema public;
    grant usage on schema public to anon, authenticated, service_role;
    grant all on schema public to postgres;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
  await dst.query(`truncate auth.users cascade`)
  say('Mumbai is empty again.')
}

async function pauseTokyo(src, active) {
  step(active ? 'resume Tokyo jobs' : 'pause Tokyo jobs')
  if (MODE !== 'cutover') die('pause-tokyo / resume-tokyo are for --cutover only')
  mkdirSync(WORK, { recursive: true }); chmodSync(WORK, 0o700)
  const saved = join(WORK, 'cron-state.json')
  const { rows } = await src.query(`select jobid, jobname, active from cron.job`)
  if (!active) {
    if (!existsSync(saved)) writeFileSync(saved, JSON.stringify(Object.fromEntries(rows.map(r => [r.jobname, r.active])), null, 2))
    await confirm('This stops every scheduled job in production (Tokyo).')
    for (const r of rows) await src.query(`select cron.alter_job($1, active := false)`, [r.jobid])
    say(`${rows.length} Tokyo jobs paused (their earlier state is in ${saved}).`)
  } else {
    const was = existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')) : {}
    for (const r of rows) await src.query(`select cron.alter_job($1, active := $2)`, [r.jobid, was[r.jobname] ?? true])
    say(`${rows.length} Tokyo jobs back as they were.`)
  }
}

// ── run ─────────────────────────────────────────────────────────────────────

const ORDER = ['preflight', 'extensions', 'schema', 'managed', 'data', 'repoint', 'cron', 'vault', 'storage', 'verify']
const known = [...ORDER, 'all', 'auth-config', 'functions', 'secrets', 'wipe', 'pause-tokyo', 'resume-tokyo']
if (!known.includes(STEP)) die(`unknown step "${STEP}". Steps: ${known.join(', ')}`)
if (!existsSync(join(BIN, 'pg_dump'))) die(`pg_dump not found in ${BIN} — install Postgres.app`)

const started = Date.now()
const src = await connect(SRC_DB, 'Tokyo')
const dst = await connect(DST_DB, 'Mumbai')
try {
  if (STEP === 'auth-config') await authConfig()
  else if (STEP === 'functions') await functions()
  else if (STEP === 'secrets') await secrets()
  else if (STEP === 'wipe') await wipe(dst)
  else if (STEP === 'pause-tokyo') await pauseTokyo(src, false)
  else if (STEP === 'resume-tokyo') await pauseTokyo(src, true)
  else {
    mkdirSync(WORK, { recursive: true }); chmodSync(WORK, 0o700)
    const steps = { preflight, extensions, schema, managed, data, repoint, cron, vault, storage, verify }
    for (const s of STEP === 'all' ? ORDER : [STEP]) await steps[s](src, dst)
  }
  say(`\nDone in ${Math.round((Date.now() - started) / 1000)} s.`)
} finally {
  await src.end().catch(() => undefined)
  await dst.end().catch(() => undefined)
}
