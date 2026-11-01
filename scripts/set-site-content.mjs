// Load a clinic's website content into Sehatsandhi (business_sites, 0282) from
// a JSON file — the same fields the Website tab edits.
//
//   node scripts/set-site-content.mjs <site-slug> <file.json> [sandbox|prod] [--dry]
//
// The file has { content, brand_color?, logo_url?, hero_image_url? }. Content
// replaces the stored content as a whole (keys starting with "_" are dropped);
// the other fields are set only when present. Tier and domain are not touched
// (admin decisions). Prints what changes. Defaults to SANDBOX.
import pg from 'pg'; import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
dotenv.config({ path: '.env.supabase', quiet: true })

const [slug, file, target = 'sandbox'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const dry = process.argv.includes('--dry')
if (!slug || !file || !['sandbox', 'prod'].includes(target)) {
  console.error('usage: set-site-content.mjs <site-slug> <file.json> [sandbox|prod] [--dry]'); process.exit(1)
}
const data = JSON.parse(readFileSync(file, 'utf8'))
if (!data.content || typeof data.content !== 'object') { console.error('The file has no "content" object.'); process.exit(1) }
const content = Object.fromEntries(Object.entries(data.content).filter(([k]) => !k.startsWith('_')))

const c = new pg.Client({ connectionString: process.env[`SUPABASE_DB_URL_${target.toUpperCase()}`], ssl: { rejectUnauthorized: false } })
await c.connect()
const before = (await c.query('select business_id, tier, brand_color, logo_url, hero_image_url, content from business_sites where slug = $1', [slug])).rows[0]
if (!before) { console.error(`No website "${slug}" on ${target}.`); process.exit(1) }

const keys = new Set([...Object.keys(before.content ?? {}), ...Object.keys(content)])
for (const k of [...keys].sort()) {
  const a = JSON.stringify(before.content?.[k] ?? null), b = JSON.stringify(content[k] ?? null)
  if (a !== b) console.log(`${a === 'null' ? 'add    ' : b === 'null' ? 'remove ' : 'change '} content.${k}`)
}
for (const f of ['brand_color', 'logo_url', 'hero_image_url']) {
  if (data[f] !== undefined && data[f] !== before[f]) console.log(`change  ${f}: ${before[f] ?? '—'} → ${data[f]}`)
}
if (before.tier !== 'full') console.log(`note: this site is on the "${before.tier}" tier — the clinic template serves only "full" sites.`)
if (dry) { console.log('(dry run, nothing written)'); await c.end(); process.exit(0) }

await c.query(`update business_sites set content = $2,
    brand_color = coalesce($3, brand_color), logo_url = coalesce($4, logo_url), hero_image_url = coalesce($5, hero_image_url),
    updated_at = now() where slug = $1`,
  [slug, content, data.brand_color ?? null, data.logo_url ?? null, data.hero_image_url ?? null])
await c.end()
console.log(`Saved to ${target}.`)
