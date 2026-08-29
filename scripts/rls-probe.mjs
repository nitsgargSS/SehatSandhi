#!/usr/bin/env node
// rls-probe — ask every view and table in `public` what each kind of caller can see.
//
// The problem this solves: a view without `security_invoker` runs as its owner
// and so skips the RLS on its base tables. Whether that leaks depends on whether
// the view scopes itself in its own WHERE — which you cannot tell by reading the
// grant table, and cannot safely guess. So measure it: count rows as anon, as one
// clinic, as a second clinic, and as an admin, and compare.
//
// It is also the regression net for tightening RLS. Adding `security_invoker` can
// blank out a screen if the base table has no policy for that caller. Baseline
// first, change, compare: a clinic's own count dropping to 0 is a broken screen,
// and anon seeing another clinic's rows is a leak.
//
//   node scripts/rls-probe.mjs --env sandbox --out before.json
//   node scripts/rls-probe.mjs --env sandbox --compare before.json
//
// Connection strings come from .env.supabase (gitignored).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(ROOT, '.env.supabase'), quiet: true })

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1] }
const env = flag('env') ?? 'sandbox'
const url = env === 'prod' ? process.env.SUPABASE_DB_URL_PROD : process.env.SUPABASE_DB_URL_SANDBOX
if (!url) { console.error(`no connection string for --env ${env}`); process.exit(1) }

const client = new pg.Client({ connectionString: url, keepAlive: true, statement_timeout: 120000 })
await client.connect()

// ── who we will pretend to be ────────────────────────────────────────────────
// Two different clinics, so "can A see B's rows" is answerable. Picking them by
// oldest-first keeps the personas stable between baseline and compare runs.
const clinics = (await client.query(`
  select b.id, b.name, coalesce(b.auth_uid, bp.auth_uid) as uid
    from businesses b
    left join lateral (
      select p.auth_uid from business_practitioners x
        join practitioners p on p.id = x.practitioner_id
       where x.business_id = b.id and p.auth_uid is not null
       order by x.created_at limit 1) bp on true
   where coalesce(b.auth_uid, bp.auth_uid) is not null
   order by b.created_at limit 2`)).rows

const admin = (await client.query(
  `select auth_uid as uid from admin_users where is_active and auth_uid is not null limit 1`)).rows[0]

const personas = [
  { key: 'anon', role: 'anon', claims: null },
  ...clinics.map((c, i) => ({ key: `clinic${'AB'[i]}`, role: 'authenticated',
                              claims: { sub: c.uid, role: 'authenticated' }, label: c.name, id: c.id })),
  ...(admin ? [{ key: 'admin', role: 'authenticated', claims: { sub: admin.uid, role: 'authenticated' } }] : []),
]

console.log(`env=${env}  personas: ${personas.map(p => p.key + (p.label ? `(${p.label})` : '')).join(', ')}`)
if (clinics.length < 2) console.log('!! fewer than two clinics with a login — cross-tenant checks are weak')

// ── every relation worth asking about ────────────────────────────────────────
const rels = (await client.query(`
  select c.relname, c.relkind,
         coalesce(array_to_string(c.reloptions, ',') like '%security_invoker%', false) as invoker
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v')
   order by c.relname`)).rows

// One round trip per persona, not one per relation-persona pair. A remote pooler
// hangs up long before 500 sequential queries finish, and the counting belongs
// server-side anyway. SECURITY INVOKER (the default) is the point: the body runs
// as whoever we have just become, so RLS applies to it.
await client.query(`
  create or replace function pg_temp.probe(rels text[])
  returns table(rel text, n int, err text)
  language plpgsql as $fn$
  declare r text; c int;
  begin
    foreach r in array rels loop
      begin
        -- Cap the scan: we want visibility, not a full count on a large table.
        execute format('select count(*)::int from (select 1 from public.%I limit 1000) s', r) into c;
        rel := r; n := c; err := null;
      exception when others then
        rel := r; n := null; err := left(sqlerrm, 60);
      end;
      return next;
    end loop;
  end $fn$;`)

const result = {}
for (const rel of rels) result[rel.relname] = { kind: rel.relkind, invoker: rel.invoker, counts: {} }

const names = rels.map(r => r.relname)
for (const p of personas) {
  await client.query('begin')
  try {
    await client.query(`set local role ${p.role}`)
    await client.query(`select set_config('request.jwt.claims', $1, true)`,
                       [p.claims ? JSON.stringify(p.claims) : ''])
    const r = await client.query(`select * from pg_temp.probe($1)`, [names])
    for (const row of r.rows) result[row.rel].counts[p.key] = row.err ? `ERR:${row.err}` : row.n
  } finally { await client.query('rollback') }
  process.stdout.write(`  probed as ${p.key}\n`)
}
await client.end()

// ── report ───────────────────────────────────────────────────────────────────
const keys = personas.map(p => p.key)
const prior = flag('compare') ? JSON.parse(readFileSync(flag('compare'), 'utf8')) : null

if (!prior) {
  // Flag the shape that matters: anon can see rows in something that is not
  // deliberately public. We cannot know intent, so we surface, we do not judge.
  const exposed = Object.entries(result)
    .filter(([, v]) => typeof v.counts.anon === 'number' && v.counts.anon > 0)
  console.log(`\n### anon sees rows in ${exposed.length} relations`)
  for (const [name, v] of exposed) console.log(`   ${v.kind === 'v' ? 'view ' : 'table'} ${name.padEnd(34)} ${v.counts.anon}${v.invoker ? '' : v.kind === 'v' ? '   (no security_invoker)' : ''}`)
} else {
  let changed = 0
  console.log('\n### changes vs baseline')
  for (const [name, v] of Object.entries(result)) {
    const b = prior[name]
    if (!b) { console.log(`   NEW    ${name}`); changed++; continue }
    for (const k of keys) {
      const before = b.counts[k], after = v.counts[k]
      if (JSON.stringify(before) === JSON.stringify(after)) continue
      changed++
      const worse = typeof before === 'number' && typeof after === 'number' && after < before && k !== 'anon'
      const fixed = k === 'anon' && typeof before === 'number' && typeof after === 'number' && after < before
      const tag = fixed ? 'CLOSED' : worse ? 'BROKE?' : 'change'
      console.log(`   ${tag} ${name}.${k}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    }
  }
  if (!changed) console.log('   none')
}

if (flag('out')) { writeFileSync(flag('out'), JSON.stringify(result, null, 1)); console.log(`\nwrote ${flag('out')}`) }
