#!/usr/bin/env node
// test:matching — every row of tests/message-matching.csv through the
// database's match_message (0201), with accuracy per category and the plan's
// acceptance checks: emergencies 100% caught; correct intent ≥ 85% overall;
// no non-emergency message sent to a wrong speciality / intent with high
// confidence. Read-only: match_message writes nothing.
//
//   npm run test:matching                 (staging)
//   node scripts/test-matching.mjs --ref <project ref> [--show-all]
//
// Uses SUPABASE_ACCESS_TOKEN from .env.supabase (the Management API).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const ref = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : 'xmsycnlztqmyvtcyxkmg'
const showAll = argv.includes('--show-all')
const token = readFileSync(join(ROOT, '.env.supabase'), 'utf8').match(/^SUPABASE_ACCESS_TOKEN=["']?([^"'\n]+)/m)?.[1]
if (!token) { console.error('SUPABASE_ACCESS_TOKEN missing from .env.supabase'); process.exit(2) }

const [head, ...lines] = readFileSync(join(ROOT, 'tests', 'message-matching.csv'), 'utf8').split(/\r?\n/).filter(l => l.trim())
const cols = head.split(',')
const rows = lines.map(l => {
  // The message is the second column and may not contain commas; the rest are fixed.
  const c = l.split(',')
  const r = Object.fromEntries(cols.map((k, i) => [k, (c[i] ?? '').trim()]))
  return r
})

const lit = s => `$m$${s}$m$`
const sql = `select i, match_message(msg, null) as m from (values ${rows.map((r, i) => `(${i}, ${lit(r.message)})`).join(', ')}) v(i, msg) order by i`
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
})
const out = await res.json()
if (!res.ok || !Array.isArray(out)) { console.error('Query failed:', JSON.stringify(out).slice(0, 500)); process.exit(2) }

const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const dayOf = d => d ? Math.round((new Date(d + 'T00:00:00') - new Date(today.toDateString())) / 86400000) : null
const per = {}
const fails = []
let emMissed = 0, emTotal = 0, emFalse = 0, wrongHigh = 0, ok = 0
for (const { i, m } of out) {
  const r = rows[i]
  const em = r.expected_emergency === 'true'
  const why = []
  if (em) {
    emTotal++
    if (!m.is_emergency) { emMissed++; why.push('emergency MISSED') }
  } else {
    if (m.is_emergency) { emFalse++; why.push('false emergency') }
    else if (!r.expected_intent) {
      if (m.action !== 'menu') why.push(`expected menu, got ${m.intent}/${m.speciality ?? '-'} (${m.action} ${m.confidence})`)
    } else {
      if (m.intent !== r.expected_intent) why.push(`intent ${m.intent ?? 'none'} ≠ ${r.expected_intent}`)
      if (r.expected_speciality && m.speciality !== r.expected_speciality) why.push(`speciality ${m.speciality ?? 'none'} ≠ ${r.expected_speciality}`)
      if (m.action === 'menu') why.push(`menu (confidence ${m.confidence})`)
      if (why.length && m.action === 'proceed') wrongHigh++
    }
    if (!r.expected_intent && m.action === 'proceed' && !m.is_emergency) wrongHigh++
    if (r.expected_pin && m.pincode !== r.expected_pin) why.push(`pin ${m.pincode ?? 'none'} ≠ ${r.expected_pin}`)
    if (r.expected_day !== '' && r.expected_day != null && dayOf(m.target_date) !== Number(r.expected_day)) why.push(`day ${dayOf(m.target_date)} ≠ ${r.expected_day}`)
  }
  const p = (per[r.category] ??= { n: 0, ok: 0 })
  p.n++
  if (!why.length) { p.ok++; ok++ } else fails.push({ r, m, why })
  if (showAll) console.log(`${why.length ? '✗' : '✓'} [${r.category}] ${r.message} → ${m.is_emergency ? 'EMERGENCY' : `${m.intent ?? '-'}/${m.speciality ?? '-'} ${m.action} ${m.confidence}`}`)
}

console.log(`\nAccuracy by category (${ref})`)
for (const [k, v] of Object.entries(per)) console.log(`  ${k.padEnd(12)} ${String(v.ok).padStart(3)}/${String(v.n).padEnd(3)} ${Math.round(100 * v.ok / v.n)}%`)
console.log(`  ${'overall'.padEnd(12)} ${String(ok).padStart(3)}/${String(out.length).padEnd(3)} ${Math.round(100 * ok / out.length)}%`)
if (fails.length) {
  console.log('\nFailures')
  for (const f of fails) console.log(`  [${f.r.category}] "${f.r.message}" — ${f.why.join('; ')}  (terms: ${(f.m.matched_terms ?? []).join(', ')})`)
}
const pass1 = emMissed === 0, pass2 = ok / out.length >= 0.85, pass3 = wrongHigh === 0
console.log(`\nAcceptance`)
console.log(`  ${pass1 ? '✓' : '✗'} emergencies caught: ${emTotal - emMissed}/${emTotal}${emFalse ? `  (false alarms on other messages: ${emFalse})` : ''}`)
console.log(`  ${pass2 ? '✓' : '✗'} overall correct: ${Math.round(100 * ok / out.length)}% (need ≥ 85%)`)
console.log(`  ${pass3 ? '✓' : '✗'} wrong branch with high confidence: ${wrongHigh} (need 0)`)
process.exit(pass1 && pass2 && pass3 ? 0 : 1)
