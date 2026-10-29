// Turn a post's story design into a Reel: an MP4 with music and, for some
// businesses, a voice (0299). Shared by the Vercel function (social-reel.js)
// and the local preview script.
//
// The page is the story design in Reel mode (templates.js): the renderer
// moves it to each frame's time with window.__seek and takes a JPEG of it;
// ffmpeg joins the frames with the sound. Only allowed hosts are fetched,
// as for images (render.js).

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowedUrl } from './render.js'
import { postHtml, SIZES } from './templates.js'

const FPS = 24
const MIN_S = 10, MAX_S = 30, PLAIN_S = 12

function run(bin, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [], err = []
    p.stdout.on('data', (b) => out.push(b))
    p.stderr.on('data', (b) => err.push(b))
    p.on('error', reject)
    p.on('close', (code) => resolve({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString() }))
    if (input) input(p.stdin); else p.stdin.end()
  })
}

async function fetchTo(dir, name, url) {
  if (!allowedUrl(url)) throw new Error(`${name} is not from an allowed host`)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${name}: ${r.status}`)
  const path = join(dir, name)
  await writeFile(path, Buffer.from(await r.arrayBuffer()))
  return path
}

/** Seconds of an audio file, from ffmpeg's own report. */
async function seconds(ffmpeg, path) {
  const { err } = await run(ffmpeg, ['-hide_banner', '-i', path])
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

/**
 * @param {{ voiceUrl?: string, musicUrl?: string }} sound
 * @returns {Promise<{ mp4: Buffer, seconds: number }>}
 */
export async function renderReel(browser, ffmpeg, template, data, sound = {}) {
  for (const k of ['logo', 'photo']) {
    if (data[k] && !allowedUrl(data[k])) throw new Error(`${k} is not from an allowed host`)
  }
  const dir = await mkdtemp(join(tmpdir(), 'reel-'))
  try {
    const voice = sound.voiceUrl ? await fetchTo(dir, 'voice.mp3', sound.voiceUrl) : null
    const music = sound.musicUrl ? await fetchTo(dir, 'music.mp3', sound.musicUrl) : null
    // With a voice, the Reel lasts as long as it speaks, plus a moment.
    const D = voice ? Math.min(MAX_S, Math.max(MIN_S, Math.ceil((await seconds(ffmpeg, voice)) + 1.5))) : PLAIN_S

    const page = await browser.newPage()
    const frames = []
    try {
      await page.setViewport({ ...SIZES.story, deviceScaleFactor: 1 })
      await page.setRequestInterception(true)
      page.on('request', (r) => (allowedUrl(r.url()) || r.url() === 'about:blank' ? r.continue() : r.abort()))
      await page.setContent(postHtml(template, 'story', data, { duration: D }), { waitUntil: 'networkidle0', timeout: 20000 })
      await page.waitForFunction('window.__ready === true', { timeout: 15000 })
      for (let i = 0; i < D * FPS; i++) {
        await page.evaluate((t) => window.__seek(t), i / FPS)
        frames.push(await page.screenshot({ type: 'jpeg', quality: 88, clip: { x: 0, y: 0, ...SIZES.story } }))
      }
    } finally {
      await page.close()
    }

    // Frames on stdin; music under a voice is quiet, alone it is louder; both fade out at the end.
    const args = ['-hide_banner', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-']
    const mix = []
    if (music) { args.push('-stream_loop', '-1', '-i', music); mix.push(`[1:a]volume=${voice ? 0.16 : 0.55},afade=t=out:st=${D - 1.5}:d=1.5[m]`) }
    if (voice) { args.push('-i', voice); mix.push(`[${music ? 2 : 1}:a]adelay=500|500,volume=1.0[v]`) }
    if (music && voice) mix.push('[m][v]amix=inputs=2:duration=longest:normalize=0[a]')
    const audio = music && voice ? '[a]' : music ? '[m]' : voice ? '[v]' : null
    if (mix.length) args.push('-filter_complex', mix.join(';'))
    args.push('-map', '0:v', ...(audio ? ['-map', audio, '-c:a', 'aac', '-b:a', '128k'] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-t', String(D), '-movflags', '+faststart', '-f', 'mp4', join(dir, 'reel.mp4'))
    const res = await run(ffmpeg, args, (stdin) => {
      ;(async () => {
        for (const f of frames) if (!stdin.write(f)) await new Promise((r) => stdin.once('drain', r))
        stdin.end()
      })().catch(() => stdin.destroy())
    })
    if (res.code !== 0) throw new Error(`ffmpeg: ${res.err.slice(-300)}`)
    return { mp4: await readFile(join(dir, 'reel.mp4')), seconds: D }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
