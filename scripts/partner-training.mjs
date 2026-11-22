#!/usr/bin/env node
// partner-training — build the Care Partner module PDFs (English and Hindi) from
// docs/partner-training/content.mjs and the contract/policy PDFs from
// docs/partner-training/contracts.mjs, and optionally load them into sandbox.
//
//   node scripts/partner-training.mjs              PDFs into docs/partner-training/pdf/
//   node scripts/partner-training.mjs --sandbox    also: upload the PDFs to the
//        partner-content bucket, set each module's PDF paths, add the quiz
//        questions (a question already there by its English text is updated
//        in place) and publish every module that has enough questions; upload
//        the five contracts and make that version current.
//
// Sandbox only: it refuses any database or URL that is not the sandbox project.
// PDFs are printed by the local Google Chrome (headless), so Devanagari renders
// with the system's fonts. Credentials come from .env.supabase.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import dotenv from 'dotenv'
import { MODULES, VERSION } from '../docs/partner-training/content.mjs'
import { CONTRACTS, CONTRACT_VERSION, CONTRACT_DATE } from '../docs/partner-training/contracts.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs/partner-training/pdf')
const TMP = join(ROOT, 'docs/partner-training/.html')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SANDBOX_REF = 'xmsycnlztqmyvtcyxkmg'
dotenv.config({ path: join(ROOT, '.env.supabase'), quiet: true })

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function html(mod, n, lang, contract = false) {
  const t = mod[lang]
  const hi = lang === 'hi'
  const sections = t.sections.map(([h, items]) => `
    <h2>${esc(h)}</h2>
    ${items.length === 1 ? `<p>${esc(items[0])}</p>` : `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`}`).join('')
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(t.title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  body { font-family: ${hi ? '"Kohinoor Devanagari", "Noto Sans Devanagari", "Devanagari Sangam MN",' : ''} -apple-system, "Helvetica Neue", Arial, sans-serif;
         color: #1e2a4a; font-size: ${hi ? '12.5pt' : '11.5pt'}; line-height: 1.6; }
  .top { display: flex; justify-content: space-between; border-bottom: 2px solid #0f766e; padding-bottom: 6px; margin-bottom: 14px; font-size: 9.5pt; color: #0f766e; font-weight: 700; }
  h1 { font-size: 20pt; margin: 0 0 4px; line-height: 1.3; }
  .sub { color: #64748b; font-size: 9.5pt; margin-bottom: 16px; }
  h2 { font-size: 13pt; color: #0f766e; margin: 18px 0 6px; }
  ul { margin: 0; padding-left: 20px; } li { margin: 3px 0; } p { margin: 0; }
  .foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 8.5pt; color: #64748b; }
</style></head><body>
  <div class="top"><span>Sehatsandhi · ${hi ? 'केयर पार्टनर प्रोग्राम' : 'Care Partner Program'}</span><span>${contract ? (hi ? 'ड्राफ़्ट — वकील की समीक्षा बाकी' : 'DRAFT — for legal review') : `${hi ? 'मॉड्यूल' : 'Module'} ${n}`}</span></div>
  <h1>${esc(t.title)}</h1>
  <div class="sub">${contract ? `${hi ? 'संस्करण' : 'Version'} ${esc(CONTRACT_VERSION)} · ${esc(CONTRACT_DATE)}` : `${hi ? 'पढ़ने की सामग्री' : 'Reading'} · ${esc(VERSION)}`}</div>
  ${sections}
  <div class="foot">${contract ? (hi
    ? 'यह अंग्रेज़ी दस्तावेज़ का हिंदी अनुवाद है; अंतर होने पर अंग्रेज़ी मान्य होगी। NG Technologies (सेहतसंधि), जगाधरी, हरियाणा।'
    : 'NG Technologies (Sehatsandhi), Jagadhri, Haryana. A Hindi translation is provided; if it differs, this English version prevails.') : hi
    ? 'यह सामग्री सेहतसंधि केयर पार्टनर ट्रेनिंग के लिए है। इसमें बताए नंबर (कीमतें, दिन, राशि) बदल सकते हैं — नवीनतम जानकारी सहायता केंद्र और sehatsandhi.com/business पर है। इसमें कोई कमाई का वादा नहीं है।'
    : 'This material is for Sehatsandhi Care Partner training. Numbers in it (prices, days, amounts) can change — the latest are in the Help Center and on sehatsandhi.com/business. Nothing here promises any income.'}</div>
</body></html>`
}

function buildPdfs() {
  if (!existsSync(CHROME)) throw new Error('Google Chrome not found at ' + CHROME)
  mkdirSync(OUT, { recursive: true }); mkdirSync(TMP, { recursive: true })
  const files = []
  MODULES.forEach((m, i) => {
    for (const lang of ['en', 'hi']) {
      const h = join(TMP, `${m.slug}-${lang}.html`), pdf = join(OUT, `${m.slug}-${lang}.pdf`)
      writeFileSync(h, html(m, i + 1, lang))
      execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file://${h}`], { stdio: 'ignore' })
      files.push({ slug: m.slug, lang, pdf })
    }
  })
  const cdir = join(OUT, 'contracts'); mkdirSync(cdir, { recursive: true })
  for (const ct of CONTRACTS) {
    for (const lang of ['en', 'hi']) {
      const h = join(TMP, `${ct.kind}-${lang}.html`), pdf = join(cdir, `${ct.kind}-${CONTRACT_VERSION}-${lang}.pdf`)
      writeFileSync(h, html(ct, 0, lang, true))
      execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, `file://${h}`], { stdio: 'ignore' })
      files.push({ kind: ct.kind, lang, pdf })
    }
  }
  console.log(`✓ ${files.length} PDFs in docs/partner-training/pdf/ (modules + contracts/)`)
  return files
}

async function loadSandbox(files) {
  const dbUrl = process.env.SUPABASE_DB_URL_SANDBOX, url = process.env.SANDBOX_SUPABASE_URL, key = process.env.SANDBOX_SERVICE_ROLE_KEY
  if (!dbUrl || !url || !key) throw new Error('SUPABASE_DB_URL_SANDBOX, SANDBOX_SUPABASE_URL and SANDBOX_SERVICE_ROLE_KEY are needed in .env.supabase')
  if (!url.includes(SANDBOX_REF) || !dbUrl.includes(SANDBOX_REF)) throw new Error('Refusing: this is not the sandbox project.')

  for (const f of files) {
    const path = f.kind ? `contracts/${f.kind}-${CONTRACT_VERSION}-${f.lang}.pdf` : `modules/${f.slug}-${f.lang}.pdf`
    const r = await fetch(`${url.replace(/\/$/, '')}/storage/v1/object/partner-content/${path}`, {
      method: 'POST', body: readFileSync(f.pdf),
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    })
    if (!r.ok) throw new Error(`Upload ${path} failed: ${r.status} ${await r.text()}`)
    f.path = path
  }
  console.log(`✓ uploaded ${files.length} PDFs to partner-content/`)

  const c = new pg.Client({ connectionString: dbUrl }); await c.connect()
  try {
    await c.query('begin')
    const need = Number((await c.query("select value from site_settings where key = 'partner_module_questions'")).rows[0]?.value ?? 5)
    let added = 0, published = 0
    for (const m of MODULES) {
      const en = files.find(f => f.slug === m.slug && f.lang === 'en').path, hi = files.find(f => f.slug === m.slug && f.lang === 'hi').path
      const { rows: [mod] } = await c.query('update care_partner_modules set pdf_path_en = $2, pdf_path_hi = $3, updated_at = now() where slug = $1 returning id', [m.slug, en, hi])
      if (!mod) throw new Error(`No module with slug ${m.slug} in sandbox`)
      for (const [type, qEn, qHi, opts, correct, xEn, xHi] of m.questions) {
        const options = type === 'truefalse'
          ? [{ id: 't', text_en: 'True', text_hi: 'सही' }, { id: 'f', text_en: 'False', text_hi: 'गलत' }]
          : opts.map(([oe, oh], i) => ({ id: 'abcdef'[i], text_en: oe, text_hi: oh }))
        const r = await c.query(`insert into care_partner_questions (module_id, qtype, text_en, text_hi, options, correct, explain_en, explain_hi)
          select $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8
           where not exists (select 1 from care_partner_questions where module_id = $1 and text_en = $3)`,
          [mod.id, type, qEn, qHi, JSON.stringify(options), JSON.stringify(correct), xEn, xHi])
        added += r.rowCount
        if (!r.rowCount) await c.query(`update care_partner_questions set qtype = $2, text_hi = $4, options = $5::jsonb, correct = $6::jsonb,
            explain_en = $7, explain_hi = $8 where module_id = $1 and text_en = $3`,
          [mod.id, type, qEn, qHi, JSON.stringify(options), JSON.stringify(correct), xEn, xHi])
      }
      // A question taken out of content.mjs is switched off (kept for past attempts).
      await c.query('update care_partner_questions set is_active = false where module_id = $1 and is_active and not (text_en = any($2::text[]))',
        [mod.id, m.questions.map(q => q[1])])
      const { rows: [{ n }] } = await c.query('select count(*)::int n from care_partner_questions where module_id = $1 and is_active', [mod.id])
      if (n >= need) { await c.query('update care_partner_modules set is_published = true, updated_at = now() where id = $1', [mod.id]); published++ }
    }
    for (const ct of CONTRACTS) {
      const pe = files.find(f => f.kind === ct.kind && f.lang === 'en').path, ph = files.find(f => f.kind === ct.kind && f.lang === 'hi').path
      const { rows: [row] } = await c.query(`insert into care_partner_contracts (kind, version, title_en, title_hi, pdf_path_en, pdf_path_hi, effective_from)
        values ($1, $2, $3, $4, $5, $6, current_date)
        on conflict (kind, version) do update set title_en = excluded.title_en, title_hi = excluded.title_hi,
          pdf_path_en = excluded.pdf_path_en, pdf_path_hi = excluded.pdf_path_hi returning id`,
        [ct.kind, CONTRACT_VERSION, ct.en.title, ct.hi.title, pe, ph])
      await c.query('update care_partner_contracts set is_current = false where kind = $1 and id <> $2 and is_current', [ct.kind, row.id])
      await c.query('update care_partner_contracts set is_current = true where id = $1', [row.id])
    }
    console.log(`✓ ${CONTRACTS.length} contracts (${CONTRACT_VERSION}) uploaded and made current`)
    await c.query('commit')
    console.log(`✓ ${added} questions added, ${published} of ${MODULES.length} modules published (need ${need} questions each)`)
  } catch (e) { await c.query('rollback'); throw e } finally { await c.end() }
}

const files = buildPdfs()
if (process.argv.includes('--sandbox')) await loadSandbox(files)
