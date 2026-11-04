// intl-article-image — a picture for a Sehatsandhi International article (0315).
//
// Same providers, in the same order, as the social posts' AI pictures
// (social-posts: Cloudflare FLUX.2, then Gemini, then Pollinations), but wide
// (16:9) for the article banners and cards. The picture is stored in the
// public intl-media bucket under articles/ and set as the article's image_url.
//
// Who: a Sehatsandhi admin (from Admin → International → Articles), or the
// service role. Body: { slug, scene? } — scene describes the picture; without
// one it is drawn from the article's title and summary.
// 0322: or { machine: key } — a picture of one of the machines on treatment
// pages (intl_machines), from its stored scene; stored under machines/.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN, GEMINI_API_KEY, POLLINATIONS_KEY
//      (whichever are set; the first that works is used).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { isServiceAuth } from '../_shared/serviceKey.ts'

const FLUX = '@cf/black-forest-labs/flux-2-dev'
const FLUX_FAST = '@cf/black-forest-labs/flux-2-klein-9b'
const GEMINI_MODEL = 'gemini-nano-banana-2.1'
const W = 1344, H = 768

type Pic = { bytes: Uint8Array; type: string }

// deno-lint-ignore no-explicit-any
function geminiImage(v: any): { data: string; mime?: string } | null {
  if (!v || typeof v !== 'object') return null
  if (typeof v.data === 'string' && v.data.length > 1000 && (v.type === 'image' || /^image\//.test(v.mime_type ?? v.mimeType ?? ''))) {
    return { data: v.data, mime: v.mime_type ?? v.mimeType }
  }
  for (const x of Object.values(v)) { const f = geminiImage(x); if (f) return f }
  return null
}

async function cloudflare(model: string, prompt: string): Promise<Pic> {
  const account = Deno.env.get('CLOUDFLARE_ACCOUNT_ID'), token = Deno.env.get('CLOUDFLARE_AI_TOKEN')
  if (!account || !token) throw new Error('not set up')
  const f = new FormData()
  f.set('prompt', prompt); f.set('width', String(W)); f.set('height', String(H))
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f,
  })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
  const type = r.headers.get('content-type') ?? ''
  if (type.startsWith('image/')) return { bytes: new Uint8Array(await r.arrayBuffer()), type: type.split(';')[0] }
  const b64 = (await r.json())?.result?.image
  if (!b64) throw new Error('empty')
  return { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type: 'image/jpeg' }
}

const MAKERS: { model: string; make: (p: string) => Promise<Pic> }[] = [
  { model: `cloudflare:${FLUX}`, make: (p) => cloudflare(FLUX, p) },
  { model: `cloudflare:${FLUX_FAST}`, make: (p) => cloudflare(FLUX_FAST, p) },
  {
    model: `gemini:${GEMINI_MODEL}`,
    make: async (prompt) => {
      const key = Deno.env.get('GEMINI_API_KEY')
      if (!key) throw new Error('not set up')
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ model: GEMINI_MODEL, input: prompt, response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '1K' } }),
      })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`)
      const img = geminiImage(await r.json())
      if (!img) throw new Error('no image in the answer')
      return { bytes: Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0)), type: img.mime?.split(';')[0] || 'image/jpeg' }
    },
  },
  {
    model: 'pollinations:flux.1-schnell',
    make: async (prompt) => {
      const key = Deno.env.get('POLLINATIONS_KEY')
      if (!key) throw new Error('not set up')
      const r = await fetch(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=black-forest-labs/flux.1-schnell&width=${W}&height=${H}`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      const type = r.headers.get('content-type') ?? ''
      if (!r.ok || !/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
      return { bytes: new Uint8Array(await r.arrayBuffer()), type: type.split(';')[0] }
    },
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  if (!isServiceAuth(auth)) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: isAdmin } = await asUser.rpc('sehat_is_admin')
    if (isAdmin !== true) return json({ error: 'Admins only.' }, 401)
  }
  let body: { slug?: string; scene?: string; machine?: string }
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Which row the picture is for: an article, or a machine (0322).
  let target: { table: 'intl_articles' | 'intl_machines'; col: 'id' | 'key'; val: string; folder: string; name: string; scene: string }
  if (body.machine) {
    const { data: m } = await db.from('intl_machines').select('key, name, scene').eq('key', String(body.machine)).maybeSingle()
    if (!m) return json({ error: 'No such machine.' }, 404)
    target = { table: 'intl_machines', col: 'key', val: m.key, folder: 'machines', name: m.key,
      scene: String(body.scene ?? '').trim().slice(0, 600) || m.scene || `A modern ${m.name} in a clean hospital room, no people` }
  } else {
    const { data: a } = await db.from('intl_articles').select('id, slug, title, summary').eq('slug', String(body.slug ?? '')).maybeSingle()
    if (!a) return json({ error: 'No such article.' }, 404)
    target = { table: 'intl_articles', col: 'id', val: a.id, folder: 'articles', name: a.slug,
      scene: String(body.scene ?? '').trim().slice(0, 600) || `A calm, reassuring scene that illustrates: ${a.title}. ${a.summary}` }
  }
  const scene = target.scene
  const prompt = `${scene}. Photorealistic editorial photograph filling the whole frame edge to edge, warm natural light, soft background, wide 16:9 landscape composition. ` +
    'Real-looking people of mixed nationalities where people appear; a modern Indian setting. No brand names or manufacturer logos on any equipment. ' +
    'No text, no letters, no numbers, no logos, no watermark. No surgery, no needles, no blood, no wounds, no close-up of an eye.'

  const failures: string[] = []
  for (const m of MAKERS) {
    let pic: Pic
    try { pic = await m.make(prompt) } catch (e) { failures.push(`${m.model}: ${e instanceof Error ? e.message : e}`); continue }
    const ext = pic.type === 'image/png' ? 'png' : pic.type === 'image/webp' ? 'webp' : 'jpg'
    const path = `${target.folder}/${target.name}-${Date.now()}.${ext}`
    const { error } = await db.storage.from('intl-media').upload(path, pic.bytes, { contentType: pic.type })
    if (error) return json({ error: `storing the picture: ${error.message}` }, 500)
    const url = db.storage.from('intl-media').getPublicUrl(path).data.publicUrl
    const { error: e2 } = await db.from(target.table).update({ image_url: url }).eq(target.col, target.val)
    if (e2) return json({ error: e2.message }, 500)
    return json({ ok: true, image_url: url, model: m.model })
  }
  return json({ error: `No picture could be made — ${failures.join('; ')}` }, 502)
})
