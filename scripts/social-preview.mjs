// Draw every post template with sample words, using this Mac's Chrome, to look
// at a design without deploying anything.
//
//   node scripts/social-preview.mjs <out-dir> [pictures-dir]
//
// Uses SN Eye's real logo from sandbox storage. Pictures come from
// pictures-dir (reading.jpg, screen.jpg, winter.jpg, food.jpg, diwali.jpg —
// any missing one is drawn without a picture).
import puppeteer from 'puppeteer-core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderPng } from '../api/_social/render.js'

const out = process.argv[2] || 'social-preview'
const pics = process.argv[3]
mkdirSync(out, { recursive: true })
const logo = 'https://xmsycnlztqmyvtcyxkmg.supabase.co/storage/v1/object/public/site-images/08e4ba8c-cd7e-4a37-aae3-d7defb50c72f/sneye.png'
// Local files go in as data: URLs, the one non-web source the renderer allows.
const pic = (name) => {
  const f = pics && join(pics, `${name}.jpg`)
  return f && existsSync(f) && readFileSync(f).subarray(0, 3).toString('hex') === 'ffd8ff'
    ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : undefined
}

const base = { brand: '#0f4c5c', logo, clinic: 'SN Eye Hospital', phone: '94164 79792', website: 'sehatsandhi.com/s/sneyehospital', lang: 'en' }
const samples = [
  ['photo', { photo: pic('reading'), badge: 'After 40', icon: 'glasses', headline: 'Struggling to read small print?', highlight: 'small print',
    body: 'Near vision changes after 40. A quick eye test sorts it out.' }],
  ['tips', { photo: pic('screen'), badge: 'Screen-time tips', icon: 'monitor', headline: 'Protect young eyes', highlight: 'young eyes',
    points: [{ icon: 'clock', text: 'A break every 20 minutes' }, { icon: 'sun', text: 'Two hours of outdoor play' }, { icon: 'smartphone', text: 'Screen at arm’s length' }] }],
  ['question', { photo: pic('winter'), badge: 'You asked', icon: 'snowflake', headline: 'Why do my eyes burn in winter?', highlight: 'burn',
    body: 'Dry air and heaters dry them out. Blink often and drink water.' }],
  ['fact', { photo: pic('food'), badge: 'Myth vs Fact', icon: 'apple', headline: 'Carrots and your eyes', highlight: 'Carrots',
    myth: 'Eating carrots will remove your glasses.', fact: 'Good food keeps eyes healthy but does not change eye power.' }],
  ['day', { photo: pic('food'), badge: 'World Diabetes Day', icon: 'scan-eye', dateDay: '14', dateMonth: 'Nov', headline: 'Diabetes can quietly harm your eyes',
    body: 'A retina check once a year keeps your sight safe.' }],
  ['greeting', { photo: pic('diwali'), motif: 'lights', headline: 'Happy Diwali', body: 'Celebrate safely. Keep children at a distance from firecrackers.' }],
  ['tips', { photo: pic('winter'), lang: 'hi', badge: 'सर्दियों में', icon: 'snowflake', headline: 'आंखों में जलन? ये करें', highlight: 'जलन',
    points: [{ icon: 'glass-water', text: 'खूब पानी पिएं' }, { icon: 'eye-off', text: 'आंखें न रगड़ें' }, { icon: 'stethoscope', text: 'जलन रहे तो दिखाएं' }] }],
  ['photo', { photo: pic('reading'), lang: 'hi', badge: '40 के बाद', icon: 'glasses', headline: 'पढ़ने में दिक्कत?', highlight: 'दिक्कत',
    body: '40 के बाद पास की नज़र बदलती है। एक आसान आई चेकअप कराएं।' }],
]

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  let i = 0
  for (const [t, s] of samples) {
    i++
    for (const size of ['square', 'story']) {
      const png = await renderPng(browser, t, size, { ...base, ...s })
      const name = `${i}-${t}${s.lang === 'hi' ? '-hi' : ''}-${size}.png`
      writeFileSync(join(out, name), png)
      console.log(name)
    }
  }
} finally {
  await browser.close()
}
