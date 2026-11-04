// Makes a picture for each International article with the intl-article-image
// function, using the scenes in scripts/intl-article-scenes.json (4 Nov 2026).
//   node scripts/make-article-pictures.mjs <sandbox|prod> [slug ...]
import dotenv from 'dotenv'; import { readFileSync } from 'node:fs'
dotenv.config({ path: '.env.supabase', quiet: true })
const env = process.argv[2]
if (!['sandbox', 'prod'].includes(env)) { console.error('usage: make-article-pictures.mjs <sandbox|prod> [slug ...]'); process.exit(1) }
const url = env === 'sandbox' ? process.env.SANDBOX_SUPABASE_URL : process.env.SUPABASE_URL
const key = env === 'sandbox' ? process.env.SANDBOX_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error(`no URL/key for ${env} in .env.supabase`); process.exit(1) }
const scenes = JSON.parse(readFileSync('scripts/intl-article-scenes.json', 'utf8'))
const only = process.argv.slice(3)
for (const [slug, scene] of Object.entries(scenes)) {
  if (only.length && !only.includes(slug)) continue
  const r = await fetch(`${url}/functions/v1/intl-article-image`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, scene }),
  })
  const j = await r.json().catch(() => ({}))
  console.log(slug.padEnd(44), j.ok ? `${j.model}  ${j.image_url}` : `FAILED ${r.status} ${j.error ?? ''}`)
}
