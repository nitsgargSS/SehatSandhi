// POST /api/social-render — draw one social post as a PNG (0292).
//
// Called only by the social-posts Supabase function, with the shared secret in
// x-render-secret. Supabase functions cannot run a browser, which is the only
// reason this lives on Vercel.
//
// Request:  { template, size: 'square' | 'story', data: { clinic, headline, … } }
// Response: image/png
//
// Env: SOCIAL_RENDER_SECRET (same value as the Supabase secret of that name)

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { renderPng } from './_social/render.js'

// One browser per warm instance; a crashed one is replaced on the next call.
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
  const { template, size = 'square', data } = body ?? {}
  if (!data?.clinic || !data?.headline) return new Response('clinic and headline are required', { status: 400 })
  try {
    const png = await renderPng(await browser(), template, size, data)
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } })
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 422 })
  }
}
