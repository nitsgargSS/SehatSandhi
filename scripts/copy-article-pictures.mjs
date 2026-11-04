// Copies the International pictures from sandbox to production — the same
// files, so nothing is generated (or paid for) twice (4 Nov 2026): article
// pictures (intl-media/articles/) and machine pictures (intl-media/machines/,
// 0322). Each file is uploaded to production's intl-media bucket at the same
// path and the production row's image_url is set to it.
//   node scripts/copy-article-pictures.mjs
import pg from 'pg'; import dotenv from 'dotenv'
dotenv.config({ path: '.env.supabase', quiet: true })
const sb = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_SANDBOX, ssl: { rejectUnauthorized: false } })
const pr = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_PROD, ssl: { rejectUnauthorized: false } })
await sb.connect(); await pr.connect()
// Production: the project URL, and its service key fetched with the Supabase
// management token (SUPABASE_ACCESS_TOKEN, as scripts/deploy-functions.sh uses).
const PROD_REF = 'tbmlhawtnrvvnemcljma'
const url = `https://${PROD_REF}.supabase.co`
const keys = await fetch(`https://api.supabase.com/v1/projects/${PROD_REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
}).then((r) => r.json()).catch(() => [])
const key = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'service_role' || k.type === 'secret')?.api_key
if (!key) { console.error('Could not get the production service key (is SUPABASE_ACCESS_TOKEN set in .env.supabase?)'); process.exit(1) }
async function copy(table, keyCol, folder) {
  const { rows } = await sb.query(`select ${keyCol} as k, image_url from ${table} where image_url like '%/intl-media/${folder}/%'`)
  for (const { k, image_url } of rows) {
    const img = await fetch(image_url)
    if (!img.ok) { console.log(String(k).padEnd(44), 'sandbox file missing'); continue }
    const path = `${folder}/` + image_url.split(`/intl-media/${folder}/`)[1]
    const up = await fetch(`${url}/storage/v1/object/intl-media/${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': img.headers.get('content-type') || 'image/jpeg', 'x-upsert': 'true' },
      body: new Uint8Array(await img.arrayBuffer()),
    })
    if (!up.ok) { console.log(String(k).padEnd(44), 'upload failed', up.status, (await up.text()).slice(0, 120)); continue }
    const r = await pr.query(`update ${table} set image_url = $1 where ${keyCol} = $2`, [`${url}/storage/v1/object/public/intl-media/${path}`, k])
    console.log(`${folder}: ${String(k).padEnd(40)}`, r.rowCount ? 'ok' : 'not on production')
  }
}
await copy('intl_articles', 'slug', 'articles')
await copy('intl_machines', 'key', 'machines')
await sb.end(); await pr.end()
