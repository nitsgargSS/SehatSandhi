// Make one Reel on this Mac (its own Chrome, the ffmpeg from ffmpeg-static),
// to look at before it goes live (0299). The post is a JSON file:
//   { template, design: { headline, … }, photo_url? , clinic, phone, website, logo, brand }
//
//   node scripts/social-reel-preview.mjs post.json out.mp4 [musicUrl] [voiceUrl]
// Music and voice must be on an allowed host (our Supabase storage).
import ffmpegPath from 'ffmpeg-static'
import puppeteer from 'puppeteer-core'
import { readFile, writeFile } from 'node:fs/promises'
import { renderReel } from '../api/_social/reel.js'

const [file, out, musicUrl, voiceUrl] = process.argv.slice(2)
if (!file || !out) { console.error('usage: social-reel-preview.mjs post.json out.mp4 [musicUrl] [voiceUrl]'); process.exit(1) }
const p = JSON.parse(await readFile(file, 'utf8'))
const data = { ...p.design, photo: p.photo_url ?? undefined, clinic: p.clinic, phone: p.phone, website: p.website, logo: p.logo, brand: p.brand }
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const t0 = Date.now()
try {
  const { mp4, seconds } = await renderReel(browser, ffmpegPath, p.template, data, { musicUrl, voiceUrl })
  await writeFile(out, mp4)
  console.log(`${out}: ${seconds} s, ${(mp4.length / 1e6).toFixed(1)} MB, made in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
} finally {
  await browser.close()
}
