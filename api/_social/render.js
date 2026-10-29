// Turn a post's HTML into a PNG with a headless Chrome page. Shared by the
// Vercel function (social-render.js, Chrome from @sparticuz/chromium) and the
// local preview script (the Mac's own Chrome).
//
// The page may load only fonts and images from places we trust: Google Fonts,
// our Supabase storage, the stock-photo host and our own site. Everything else is refused,
// so a URL slipped into a post's data cannot make the renderer fetch anything
// else (SSRF).

import { postHtml, SIZES } from './templates.js'

const ALLOWED = [
  /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
  /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\//,
  /^https:\/\/images\.pexels\.com\//,
  // Our own site: Sehatsandhi's logo on its own posts (0296).
  /^https:\/\/www\.sehatsandhi\.com\//,
  /^data:/,
]
export const allowedUrl = (u) => ALLOWED.some((re) => re.test(u))

/** @returns {Promise<Uint8Array>} */
export async function renderPng(browser, template, size, data) {
  for (const k of ['logo', 'photo']) {
    if (data[k] && !allowedUrl(data[k])) throw new Error(`${k} is not from an allowed host`)
  }
  const html = postHtml(template, size, data)
  const page = await browser.newPage()
  try {
    await page.setViewport({ ...SIZES[size], deviceScaleFactor: 1 })
    await page.setRequestInterception(true)
    page.on('request', (r) => (allowedUrl(r.url()) || r.url() === 'about:blank' ? r.continue() : r.abort()))
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 })
    await page.waitForFunction('window.__ready === true', { timeout: 15000 })
    return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...SIZES[size] } })
  } finally {
    await page.close()
  }
}
