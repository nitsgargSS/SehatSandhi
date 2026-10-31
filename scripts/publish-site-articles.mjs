// Publish approved articles to a clinic's website (site_articles, 0282/0303).
//
//   node scripts/publish-site-articles.mjs <site-slug> <folder> [sandbox|prod] [--dry]
//   e.g. node scripts/publish-site-articles.mjs sneyehospital ~/Projects/sneye/docs/articles prod
//
// Each Markdown file has a front-matter block:
//   group, slug, lang (en|hi), title, summary, image, read_minutes, status
// The English and Hindi files of one article share `group` (site_articles.
// group_key), so the site can link the two versions. Only files whose status
// starts with "approved" are published; drafts are skipped and listed.
// `image` may be a site path (/assets/…); it is stored as a full URL on the
// clinic's own domain so it also shows on the Sehatsandhi copy of the site.
//
// Defaults to SANDBOX. Writes to production only when "prod" is passed.
// Re-running updates the same articles in place (matched by slug).
import pg from 'pg'; import dotenv from 'dotenv'
import { readFileSync, readdirSync } from 'node:fs'
dotenv.config({ path: '.env.supabase', quiet: true })

const [slug, folder, target = 'sandbox'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const dry = process.argv.includes('--dry')
if (!slug || !folder || !['sandbox', 'prod'].includes(target)) {
  console.error('usage: publish-site-articles.mjs <site-slug> <folder> [sandbox|prod] [--dry]'); process.exit(1)
}

const files = readdirSync(folder).filter((f) => f.endsWith('.md')).sort()
const parsed = files.map((f) => {
  const raw = readFileSync(`${folder}/${f}`, 'utf8')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) throw new Error(`${f}: no front-matter block`)
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
  }))
  return { file: f, meta, body: m[2].trim() }
})

const c = new pg.Client({ connectionString: process.env[`SUPABASE_DB_URL_${target.toUpperCase()}`], ssl: { rejectUnauthorized: false } })
await c.connect()
const site = (await c.query('select business_id, custom_domain from business_sites where slug = $1', [slug])).rows[0]
if (!site) { console.error(`No website "${slug}" on ${target}.`); process.exit(1) }
const origin = site.custom_domain ? `https://www.${site.custom_domain.replace(/^www\./, '')}` : ''

let done = 0
for (const { file, meta, body } of parsed) {
  if (!/^approved/i.test(meta.status ?? '')) { console.log(`skip   ${file} (${meta.status || 'no status'})`); continue }
  const image = meta.image ? (meta.image.startsWith('/') && origin ? origin + meta.image : meta.image) : null
  const row = [site.business_id, meta.slug, meta.lang, meta.title, meta.summary || null, body, image,
    'Dr. Swati Goyal', Number(meta.read_minutes) || null, meta.group || null]
  if (dry) { console.log(`would  ${file} → ${meta.slug} (${meta.lang})`); continue }
  await c.query(`insert into site_articles (business_id, slug, lang, title, summary, body, image_url, author, read_minutes, group_key, published_on, is_published)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, (now() at time zone 'Asia/Kolkata')::date, true)
    on conflict (business_id, slug) do update set lang = excluded.lang, title = excluded.title, summary = excluded.summary,
      body = excluded.body, image_url = excluded.image_url, read_minutes = excluded.read_minutes,
      group_key = excluded.group_key, is_published = true, updated_at = now()`, row)
  console.log(`ok     ${file} → ${meta.slug} (${meta.lang})`); done++
}
await c.end()
console.log(`${done} article file(s) published to ${target}${dry ? ' (dry run)' : ''}.`)
