// POST /api/social-reel — make one post's Reel (MP4) and upload it (0299).
//
// Called only by the social-posts Supabase function, with the shared secret in
// x-render-secret. A Reel is bigger than a function may answer with, so the
// caller sends a one-time Supabase Storage upload link and the video goes
// straight there; nothing here holds a database key.
//
// Request:  { template, data: { clinic, headline, … }, voiceUrl?, musicUrl?, uploadUrl }
// Response: { ok, seconds, bytes }
//
// Env: SOCIAL_RENDER_SECRET (same value as the Supabase secret of that name)

import chromium from '@sparticuz/chromium'
import ffmpegPath from 'ffmpeg-static'
import puppeteer from 'puppeteer-core'
import { renderReel } from './_social/reel.js'

// Only a signed upload link to a Supabase project's storage.
const UPLOAD = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/upload\/sign\//

let browserP = null
async function browser() {
  if (browserP) {
    const b = await browserP.catch(() => null)
    if (b?.connected) return b
  }
  browserP = (async () => puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  }))()
  return browserP
}

export async function POST(request) {
  const secret = process.env.SOCIAL_RENDER_SECRET
  if (!secret || request.headers.get('x-render-secret') !== secret) {
    return new Response('forbidden', { status: 403 })
  }
  let body
  try { body = await request.json() } catch { return new Response('bad json', { status: 400 }) }
  const { template, data, voiceUrl, musicUrl, uploadUrl } = body ?? {}
  if (!data?.clinic || !data?.headline) return new Response('clinic and headline are required', { status: 400 })
  if (!UPLOAD.test(uploadUrl ?? '')) return new Response('uploadUrl must be a Supabase signed upload link', { status: 400 })
  try {
    const { mp4, seconds } = await renderReel(await browser(), ffmpegPath, template, data, { voiceUrl, musicUrl })
    const up = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'x-upsert': 'true' }, body: mp4 })
    if (!up.ok) return new Response(`upload: ${up.status} ${(await up.text()).slice(0, 200)}`, { status: 502 })
    return Response.json({ ok: true, seconds, bytes: mp4.length })
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 422 })
  }
}
