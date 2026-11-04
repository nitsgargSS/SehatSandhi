// Copies the International articles' pictures from sandbox to production —
// the same files, so nothing is generated (or paid for) twice (4 Nov 2026).
// For each sandbox article with an image_url under intl-media/articles/, the
// file is uploaded to production's intl-media bucket at the same path and the
// production article's image_url is set to it.
//   node scripts/copy-article-pictures.mjs
import pg from 'pg'; import dotenv from 'dotenv'
dotenv.config({ path: '.env.supabase', quiet: true })
const sb = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_SANDBOX, ssl: { rejectUnauthorized: false } })
const pr = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_PROD, ssl: { rejectUnauthorized: false } })
await sb.connect(); await pr.connect()
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
const { rows } = await sb.query("select slug, image_url from intl_articles where image_url like '%/intl-media/articles/%'")
for (const { slug, image_url } of rows) {
  const img = await fetch(image_url)
  if (!img.ok) { console.log(slug.padEnd(44), 'sandbox file missing'); continue }
  const path = 'articles/' + image_url.split('/intl-media/articles/')[1]
  const up = await fetch(`${url}/storage/v1/object/intl-media/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': img.headers.get('content-type') || 'image/jpeg', 'x-upsert': 'true' },
    body: new Uint8Array(await img.arrayBuffer()),
  })
  if (!up.ok) { console.log(slug.padEnd(44), 'upload failed', up.status, (await up.text()).slice(0, 120)); continue }
  const r = await pr.query('update intl_articles set image_url = $1 where slug = $2', [`${url}/storage/v1/object/public/intl-media/${path}`, slug])
  console.log(slug.padEnd(44), r.rowCount ? 'ok' : 'no such article on production')
}
await sb.end(); await pr.end()
