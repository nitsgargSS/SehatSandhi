// Renders hospital-agreement.html to PDF and copies the text version, into
// ~/Downloads/SehatsandhiDocuments/Marketing/Placards/International (3 Nov 2026).
//   node marketing/agreements/render.mjs
import puppeteer from '../../node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { mkdirSync, copyFileSync } from 'node:fs'
const dir = fileURLToPath(new URL('.', import.meta.url))
const out = `${homedir()}/Downloads/SehatsandhiDocuments/Marketing/Placards/International/`
mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await b.newPage()
await p.goto(`file://${dir}hospital-agreement.html`, { waitUntil: 'networkidle0' })
await p.evaluate(() => document.fonts.ready)
await p.pdf({ path: `${out}Sehatsandhi-International-Hospital-Agreement-DRAFT.pdf`, format: 'A4', printBackground: true, preferCSSPageSize: true })
await b.close()
copyFileSync(`${dir}hospital-agreement.txt`, `${out}Sehatsandhi-International-Hospital-Agreement-DRAFT.txt`)
console.log('done: PDF + TXT in', out)
