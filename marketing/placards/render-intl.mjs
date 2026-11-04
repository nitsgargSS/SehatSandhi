// Renders intl-placards.html (Sehatsandhi International, 3 Nov 2026) to one
// PNG per placard and one PDF, into
// ~/Downloads/SehatsandhiDocuments/Marketing/Placards/International.
//   node marketing/placards/render-intl.mjs
import puppeteer from '../../node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
const dir = fileURLToPath(new URL('.', import.meta.url))
const out = `${homedir()}/Downloads/SehatsandhiDocuments/Marketing/Placards/International/`
mkdirSync(out, { recursive: true })
const names = ['00-patients-treatment-in-india', '01-patients-how-it-works', '02-hospitals-how-to-list', '03-hospitals-who-can-join', '04-partners-travel-visa-hotels']
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await b.newPage()
await p.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 1 })
await p.goto(`file://${dir}intl-placards.html`, { waitUntil: 'networkidle0' })
await p.evaluate(() => document.fonts.ready)
for (const [i, n] of names.entries()) {
  const el = await p.$(`#p${i}`)
  await el.screenshot({ path: `${out}${n}.png` })
}
await p.addStyleTag({ content: 'body{background:none} .card{margin:0}' })
await p.pdf({ path: `${out}Sehatsandhi-International-placards.pdf`, width: '1080px', height: '1350px', printBackground: true })
await b.close()
console.log('done:', names.length, 'PNGs + PDF in', out)
