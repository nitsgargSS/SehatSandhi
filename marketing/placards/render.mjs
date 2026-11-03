// Renders placards.html to one PNG per placard and one PDF, into
// ~/Downloads/SehatsandhiDocuments/Marketing/Placards (2 Nov 2026).
//   node marketing/placards/render.mjs
import puppeteer from '../../node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
const dir = fileURLToPath(new URL('.', import.meta.url))
const out = `${homedir()}/Downloads/SehatsandhiDocuments/Marketing/Placards/`
mkdirSync(out, { recursive: true })
const names = ['00-sehatsandhi', '01-patients-find-you', '02-opd', '03-pharmacy', '04-lab-reports', '05-ipd-surgery', '06-reminders', '07-whatsapp-marketing', '08-website', '09-billing', '10-patient-records', '11-reception-qr', '12-reports', '13-team-access', '14-visiting-doctors', '15-camps-offers']
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await b.newPage()
await p.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 1 })
await p.goto(`file://${dir}placards.html`, { waitUntil: 'networkidle0' })
await p.evaluate(() => document.fonts.ready)
for (const [i, n] of names.entries()) {
  const el = await p.$(`#p${i}`)
  await el.screenshot({ path: `${out}${n}.png` })
}
await p.addStyleTag({ content: 'body{background:none} .card{margin:0}' })
await p.pdf({ path: `${out}Sehatsandhi-placards.pdf`, width: '1080px', height: '1350px', printBackground: true, pageRanges: '' })
await b.close()
console.log('done:', names.length, 'PNGs + Sehatsandhi-placards.pdf in', out)
