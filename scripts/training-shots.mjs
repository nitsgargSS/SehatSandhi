#!/usr/bin/env node
// training-shots — screenshots of the STAGING site for the Care Partner product
// track (docs/partner-training/). Drives the local Google Chrome (headless).
//
//   node scripts/training-shots.mjs explore [path]   sign in, list the menu and buttons
//   node scripts/training-shots.mjs shots [name…]    take the shots listed in SHOTS
//
// Signs in as the owner of "Sehatsandhi Training Hospital" (sandbox demo made
// by seed-demo-hospital.mjs; fake 9000… patients only) with TRAINING_DEMO_EMAIL /
// TRAINING_DEMO_PASSWORD from .env.supabase (sandbox only, never production).
// Images go to docs/partner-training/shots/<name>.png.

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import dotenv from 'dotenv'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(ROOT, '.env.supabase'), quiet: true })
const SITE = 'https://sehat-sandhi-staging.vercel.app'
const OUT = join(ROOT, 'docs/partner-training/shots')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DESKTOP = { width: 1366, height: 860, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function signIn(page) {
  const email = process.env.TRAINING_DEMO_EMAIL, pw = process.env.TRAINING_DEMO_PASSWORD
  if (!email || !pw) throw new Error('TRAINING_DEMO_EMAIL / TRAINING_DEMO_PASSWORD missing in .env.supabase')
  await page.goto(`${SITE}/business/login`, { waitUntil: 'networkidle2' })
  await page.evaluate(() => [...document.querySelectorAll('button')].find(e => e.innerText.trim() === 'Password')?.click())
  await page.waitForSelector('input[type=password]')
  await page.type('input[type=email]', email)
  await page.type('input[type=password]', pw)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.pathname.startsWith('/business/dashboard'), { timeout: 30000 })
  // Poll gently (not every frame) until the dashboard has painted.
  for (let i = 0; i < 20; i++) {
    await sleep(3000)
    if (!/Loading/.test(await page.evaluate(() => document.body.innerText))) break
  }
  await sleep(1500)
}

/** Wait until no "Loading…" text is on screen (or 45 s), then a moment more. */
async function settle(page) {
  for (let i = 0; i < 15; i++) {
    await sleep(1500)
    if (!/Loading…|Loading\.\.\./.test(await page.evaluate(() => document.body.innerText))) break
  }
  await sleep(800)
}

/** Click the first visible element whose own text is exactly `text` (or starts with it when loose). */
async function clickText(page, text, opts = {}) {
  for (let i = 0; i < 6; i++) {
    try { return await clickOnce(page, text, opts) } catch (e) { if (i === 5) throw e; await sleep(2000) }
  }
}
async function clickOnce(page, text, { loose = false, within = 'button, a, [role=tab], [role=button], li, summary, label, span, div' } = {}) {
  const ok = await page.evaluate((text, loose, within) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const els = [...document.querySelectorAll(within)].filter(vis)
    const hit = els.find(e => norm(e.innerText) === text) ?? (loose ? els.find(e => norm(e.innerText).startsWith(text)) : null)
    if (!hit) return false
    hit.scrollIntoView({ block: 'center' }); hit.click(); return true
  }, text, loose, within)
  if (!ok) throw new Error(`Nothing to click with text "${text}"`)
  await settle(page)
}

/** Make a screenshot presentable: no staging banner/badge, no chat bubble, no parked EMI tab, no test address. */
async function clean(page) {
  await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    for (const e of document.querySelectorAll('body *')) {
      const t = norm(e.innerText)
      if (e.children.length <= 2 && (/^⚠ STAGING/.test(t) || t === 'STAGING')) e.style.display = 'none'
      if (e.tagName === 'A' && /wa\.me|whatsapp\.com/.test(e.href || '') && getComputedStyle(e).position === 'fixed') e.style.display = 'none'
      if (['A', 'BUTTON'].includes(e.tagName) && t === 'EMI') e.style.display = 'none'
    }
    const fixed = [...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).position === 'fixed' && e.querySelector('svg') && e.getBoundingClientRect().width < 90 && e.getBoundingClientRect().bottom > innerHeight - 140 && e.getBoundingClientRect().left > innerWidth - 140)
    fixed.forEach(e => { e.style.display = 'none' })
    // The four summary cards repeat at the top of every tab: hide them.
    const cards = [...document.querySelectorAll('body *')].filter(e => /Total Appointments/.test(e.innerText || '') && /Listing Status/.test(e.innerText || ''))
    const row = cards.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]
    if (row && (row.innerText || '').length < 200) row.style.display = 'none'
    document.body.style.border = 'none'; document.documentElement.style.border = 'none'
    for (const e of document.querySelectorAll('body, body > *, #root, #root > *')) { e.style.outline = 'none'; e.style.boxShadow = 'none'; e.style.borderColor = 'transparent' }
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n; while ((n = w.nextNode())) {
      if (n.nodeValue.includes('919000000077@wa.sehatsandhi.in')) n.nodeValue = n.nodeValue.replace('919000000077@wa.sehatsandhi.in', 'owner · Training Hospital')
      if (n.nodeValue.includes('919000000077@wa.sehatsand')) n.nodeValue = n.nodeValue.replace(/919000000077@wa\.sehatsand\S*/, 'owner · Training Hospital')
    }
  })
  await sleep(300)
}

async function shot(page, name, { full = false } = {}) {
  mkdirSync(OUT, { recursive: true })
  await clean(page)
  // Dashboard shots: crop off the side menu so the screen itself is larger.
  const menuRight = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('aside, nav, div')].find(e => /Patient report/.test(e.innerText || '') && /Logout/.test(e.innerText || '') && e.getBoundingClientRect().width < 420 && e.getBoundingClientRect().height > 400)
    return nav ? Math.round(nav.getBoundingClientRect().right) : 0
  })
  const vp = page.viewport()
  const scrollY = await page.evaluate(() => window.scrollY)
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full,
    ...(menuRight > 0 && !full ? { clip: { x: menuRight, y: scrollY, width: vp.width - menuRight, height: vp.height } } : {}) })
  console.log('  ✓', name)
}

async function explore(page, path) {
  if (path) { await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle2' }); await settle(page) }
  const items = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    return [...document.querySelectorAll('button, a, [role=tab]')].filter(vis)
      .map(e => (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 120)
  })
  console.log(items.join(' | '))
  await shot(page, '_explore')
}

// name → { phone?, steps(page) } — filled in as the modules are written.
/** Patients tab → search → open the named patient. */
async function openPatient(page, name) {
  await clickText(page, 'Patients')
  const box = await page.$('input[placeholder*="Search by name"]')
  await box.click({ clickCount: 3 }); await box.type(name); await page.keyboard.press('Enter')
  await settle(page)
  await clickText(page, name, { loose: true, within: 'button, a, li, [role=button]' })
}

/** List what can be clicked on screen now (for planning shots). */
async function listClickable(page) {
  return page.evaluate(() => [...document.querySelectorAll('button, a, [role=tab], summary')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '))
}

/** Scroll so the first element whose text starts with `text` sits near the top. */
async function top(page, text) {
  await page.evaluate((text) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const els = [...document.querySelectorAll('h1, h2, h3, h4, legend, summary, button, p, div, span')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && norm(e.innerText).startsWith(text) })
    const hit = els[els.length - 1] && els.sort((a, b) => norm(a.innerText).length - norm(b.innerText).length)[0]
    if (!hit) return
    let p = hit.parentElement
    while (p) { if (p.scrollHeight > p.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) { p.scrollTop += hit.getBoundingClientRect().top - p.getBoundingClientRect().top - 20; return } p = p.parentElement }
    document.scrollingElement.scrollTop += hit.getBoundingClientRect().top - 70
  }, text)
  await sleep(700)
}

/** Share links and ids of the training hospital, read from the sandbox database at run time. */
let LINKS = null
async function links() {
  if (LINKS) return LINKS
  const db = process.env.SUPABASE_DB_URL_SANDBOX
  if (!db || !db.includes('xmsycnlztqmyvtcyxkmg')) throw new Error('sandbox DB url needed')
  const { default: pg } = await import('pg')
  const c = new pg.Client({ connectionString: db }); await c.connect()
  const one = async (sql) => (await c.query(sql)).rows[0]
  const b = await one("select id from businesses where name = 'Sehatsandhi Training Hospital'")
  const B = `'${b.id}'`
  const tok = async (t, extra = '') => (await one(`select public_token from ${t} where business_id = ${B} and public_token is not null ${extra} limit 1`))?.public_token
  const doc = await one(`select p.id, p.full_name from practitioners p join business_practitioners bp on bp.practitioner_id = p.id where bp.business_id = ${B} and bp.role = 'doctor' and p.status = 'active' order by p.full_name limit 1`)
  LINKS = { business: b.id, rx: await tok('prescriptions'), lab: await tok('lab_reports'), ds: await tok('discharge_summaries'), bill: await tok('patient_bills'),
            doctor: `/doctor/${doc.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${doc.id.slice(0, 8)}` }
  await c.end()
  return LINKS
}

/** Back to the dashboard (fresh) before each dashboard shot, so state never leaks between shots. */
async function dash(page) {
  await page.goto(`${SITE}/business/dashboard`, { waitUntil: 'networkidle2' })
  for (let i = 0; i < 20; i++) { await sleep(1500); if (/Patients/.test(await page.evaluate(() => document.body.innerText)) && !/Loading/.test(await page.evaluate(() => document.body.innerText))) break }
  await sleep(800)
}
const tab = (label, heading) => ({ steps: async (page, h) => { await dash(page); await h.clickText(label); if (heading) await top(page, heading) } })
const go = (path, opts = {}) => ({ ...opts, steps: async (page, h) => {
  const p = typeof path === 'function' ? path(await links()) : path
  await page.goto(`${SITE}${p}`, { waitUntil: 'networkidle2' }); await h.settle(); if (opts.after) await opts.after(page, h) } })
const patientPane = (name, pane, heading) => ({ steps: async (page, h) => {
  await dash(page); await openPatient(page, name); if (pane) await h.clickText(pane, { loose: true })
  if (heading) await top(page, heading)
  else if (pane) await page.evaluate((pane) => {   // the pane's tab row at the top, its content below
    const b = [...document.querySelectorAll('button')].find(e => e.innerText.replace(/\s+/g, ' ').trim() === pane && e.getBoundingClientRect().width > 0)
    if (!b) return
    let el = b.parentElement
    while (el) {
      if (el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
        el.scrollTop += b.getBoundingClientRect().top - el.getBoundingClientRect().top - 16; return
      }
      el = el.parentElement
    }
    document.scrollingElement.scrollTop += b.getBoundingClientRect().top - 16
  }, pane)
  await h.sleep(600) } })

export const SHOTS = {
  // ── Patients: WhatsApp, website, app, document links (phone screens) ──
  'wa-booking-demo': go('/business/booking-demo', { phone: true }),
  'web-home': go('/', { phone: true }),
  'web-book': go('/my/book', { phone: true }),
  'web-doctor-profile': go(l => l.doctor, { phone: true }),
  'link-prescription': go(l => `/rx/${l.rx}`, { phone: true }),
  'link-bill': go(l => `/bill/${l.bill}`, { phone: true }),
  'link-lab-report': go(l => `/lab/${l.lab}`, { phone: true }),
  'link-discharge': go(l => `/ds/${l.ds}`, { phone: true }),
  // ── Clinic dashboard ──
  'today': tab('Today'),
  'today-cards': tab('Today', 'OPD queue'),
  'queue': tab('Queue', 'Line'),
  'queue-give-token': { steps: async (page, h) => { await dash(page); await h.clickText('Queue'); await h.clickText('Give a token', { loose: true }) } },
  'appointments': tab('Appointments', 'Book an appointment'),
  'patient-visits': patientPane('Ramesh Kumar Sharma', 'Visits'),
  'patient-vitals': patientPane('Ramesh Kumar Sharma', 'Vitals'),
  'patient-prescriptions': patientPane('Ramesh Kumar Sharma', 'Prescriptions'),
  'patient-history': patientPane('Ramesh Kumar Sharma', 'Medical history'),
  'patient-lab-tests': patientPane('Rajinder Pal', 'Lab tests'),
  'patient-billing': patientPane('Ramesh Kumar Sharma', 'Billing'),
  'patient-refer': patientPane('Ramesh Kumar Sharma', 'Refer to doctor'),
  'ipd-beds': tab('Beds'),
  'ipd-admission': patientPane('Vikram Saini', 'Admissions'),
  'ipd-operations': patientPane('Vikram Saini', 'Operations'),
  'ipd-billing': patientPane('Rajinder Pal', 'Billing'),
  'ipd-discharged': patientPane('Rekha Rani', 'Admissions'),
  'lab-orders': tab('Lab'),
  'pharmacy': tab('Pharmacy'),
  'collections': tab('Collections'),
  'patient-report': tab('Patient report'),
  'doctors': tab('Doctors'),
  'schedule': tab('Schedule'),
  'team': tab('Clinic & team'),
  'qr-codes': { steps: async (page, h) => { await dash(page); await h.clickText('Clinic & team'); await h.clickText('QR codes', { loose: true }); await top(page, 'QR codes') } },
  'qr-review-poster': go(l => `/business/print/qr/${l.business}?kind=review`),
  'plan': tab('Plan'),
  'whatsapp': tab('WhatsApp'),
  'website': tab('Website'),
  'international': tab('International'),
  // ── Public pages ──
  'pricing': go('/business', { after: async (page) => { await top(page, 'Clinic') } }),
  'register': go('/business/register'),
  'intl-compare': go('/international/compare'),
}

const [mode, ...rest] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: DESKTOP.width, height: DESKTOP.height } })
try {
  const page = await browser.newPage()
  if (process.env.SHOTS_DEBUG === '3') {
    page.on('request', r => { const u = r.url(); if (u.includes('supabase')) console.log('  [req]', r.method(), u.replace(/\?.*/, '').replace(/^https:\/\/[^/]+/, '').slice(0, 90)) })
    page.on('requestfailed', r => console.log('  [failed]', r.url().slice(0, 100), r.failure()?.errorText))
    page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
    page.on('console', m => console.log('  [console:' + m.type() + ']', m.text().slice(0, 160)))
    page.on('response', async r => { if (/caller_business_ids|password_state|link-my-login|practitioners/.test(r.url()) && r.request().method() !== 'OPTIONS') console.log('  [ids]', r.status(), (await r.text().catch(() => '?')).slice(0, 160)) })
  }
  if (process.env.SHOTS_DEBUG) {
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('  [console]', m.text().slice(0, 200)) })
    page.on('response', r => { if (r.status() >= 400 || process.env.SHOTS_DEBUG === '2') { const u = r.url(); if (u.includes('supabase')) console.log('  [http]', r.status(), u.replace(/\?.*/, '').replace(/^https:\/\/[^/]+/, '').slice(0, 100)) } })
  }
  await signIn(page)
  await page.setViewport(DESKTOP)
  await settle(page)
  if (mode === 'patient') {
    await openPatient(page, rest[0] ?? 'Kavya Verma')
    for (const t of rest.slice(1)) await clickText(page, t, { loose: true })
    console.log(await listClickable(page))
    await shot(page, '_patient')
  } else if (mode === 'explore') {
    await explore(page, rest[0])
    console.log('at', page.url())
  } else if (mode === 'shots') {
    const want = rest.length ? rest : Object.keys(SHOTS)
    for (const name of want) {
      const s = SHOTS[name]; if (!s) { console.log('  ? no shot', name); continue }
      await page.setViewport(s.phone ? PHONE : DESKTOP)
      try { await s.steps(page, { clickText: (t, o) => clickText(page, t, o), sleep, settle: () => settle(page), SITE }); await shot(page, name, s) } catch (e) { console.log('  ✗', name, e.message) }
    }
  } else console.log('usage: explore [path] | shots [name…]')
} finally { await browser.close() }
