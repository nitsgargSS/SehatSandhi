#!/usr/bin/env node
// seed-site-sneye — SN Eye Hospital's website content, taken from its current
// site (www.sneyeshospital.com), into Sehatsandhi's website blocks (0282).
//
//   node scripts/seed-site-sneye.mjs --business <uuid> [--env sandbox|prod] [--slug sneyehospital]
//   node scripts/seed-site-sneye.mjs --name "SN Eye" --env prod      (finds the business by name)
//
// Copies the site's photos into the site-images bucket, writes business_sites
// (content blocks, English; the template falls back to English where Hindi is
// missing), and imports every article on /posts/ with its full text. Safe to
// run again: the row and the articles are upserted, photos overwritten.

import pg from 'pg'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.supabase', quiet: true })
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const ENV = arg('env', 'sandbox')
let BUSINESS = arg('business')
const NAME = arg('name')
const SLUG = arg('slug', 'sneyehospital')
const SRC = 'https://www.sneyeshospital.com'
if (!BUSINESS && !NAME) { console.error('usage: --business <uuid> | --name <part of the name>  [--env sandbox|prod] [--slug …]'); process.exit(1) }

const DB = ENV === 'prod' ? process.env.SUPABASE_DB_URL_PROD : process.env.SUPABASE_DB_URL_SANDBOX
const REF = DB.match(/postgres\.([a-z]+)/)[1]
async function serviceKey() {
  if (ENV === 'sandbox' && process.env.SANDBOX_SERVICE_ROLE_KEY) return process.env.SANDBOX_SERVICE_ROLE_KEY
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`,
    { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } })
  const k = (await r.json()).find(k => k.name === 'service_role')
  if (!k) throw new Error('no service_role key')
  return k.api_key
}

const en = (s) => ({ en: s })
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
const strip = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

const IMAGES = {
  logo: '/assets/logo/sneye.png',
  hero: '/assets/images/sneye/hero-slit-lamp.jpg',
  avatar: '/assets/images/sneye/dr-swati-avatar.jpg',
  portrait: '/assets/images/sneye/dr-swati-portrait.jpg',
  team: '/assets/images/sneye/team.jpg',
  exterior: '/assets/images/sneye/exterior.jpg',
  zeiss: '/assets/images/sneye/zeiss-microscope.jpg',
  phaco: '/assets/images/sneye/phaco-console.jpg',
  oct: '/assets/images/sneye/huvitz-oct.jpg',
  ava: '/assets/images/sneye/ava-perimeter.jpg',
}

const TREATMENTS = [
  ['cataract', 'Cataract', 'Phaco & premium lens options', 'Stitchless phacoemulsification, usually done in under twenty minutes. We walk you through the lens choices — including what is genuinely worth paying more for.'],
  ['glaucoma', 'Glaucoma', 'Our deepest speciality', 'The condition Dr. Swati trained for in Texas and New York. It steals sight quietly, so we screen for it in every adult who walks in.'],
  ['paediatric-ophthalmology', 'Paediatric ophthalmology', 'Squint, lazy eye, school screening', 'Squint, lazy eye, and the "he sits too close to the TV" worry. Children get longer appointments here, because rushing them never works.'],
  ['retina', 'Retina', 'Diabetic screening & injections', 'Diabetic retinopathy screening, laser, and intravitreal injections. If you are diabetic, you should be seen once a year even when nothing hurts.'],
  ['cornea', 'Cornea', 'Infections, keratoconus, scarring', 'Infections, injuries, keratoconus and scarring — diagnosed with topography, treated with the least invasive option that will work.'],
  ['oculoplasty', 'Oculoplasty', 'Eyelid, tear duct and orbit', 'Eyelid, tear duct and orbit surgery. Function first, appearance close behind — both matter, and we plan for both.'],
  ['dry-eyes', 'Dry eyes', 'Find the cause, not just drops', 'Screens, air conditioning and age all play a part. We find which one is yours instead of handing you a bottle of drops.'],
  ['contact-lenses', 'Contact lenses', 'Soft, toric and rigid', 'Soft, toric, and specialty rigid lenses for irregular corneas. Fittings include a proper lesson in handling them safely.'],
  ['computerised-eye-testing', 'Computerised eye testing', 'Refraction and pressure in 15 minutes', 'A full refraction and pressure check in about fifteen minutes, with the numbers printed for you to keep.'],
]

const INSURERS = ['Niva Bupa Health Insurance', 'Tata AIG General Insurance', 'Paramount Health Services & Insurance TPA',
  'Safeway Insurance TPA', 'Park MediClaim Insurance TPA', 'MD India Health Insurance TPA', 'Iffco-Tokio General Insurance',
  'Ericson Insurance TPA', 'Medi Assist Insurance TPA', 'Raksha TPA (with Medi Assist)', 'Manipal Cigna Health Insurance (with Medi Assist)',
  'Bajaj Allianz General Insurance', 'Good Health Insurance TPA', 'HDFC ERGO General Insurance', 'Volo Health Insurance (formerly East West TPA)',
  'Cholamandalam MS', 'ICICI Lombard Health Insurance', 'Aditya Birla Health Insurance', 'Care Health Insurance',
  'Future Generali India Insurance', 'AKNA TPA', 'K-Link', 'Reliance General Insurance', 'FHPL', 'Vidal Health', 'Galaxy Health Insurance']

function content(img) {
  return {
    kicker: en('Super-speciality eye care'),
    tagline: en('Seeing clearly is a kind of freedom.'),
    intro: en('Cataract, glaucoma, retina and children\'s eye care under one roof — with a surgeon who has trained in Texas, New York and Chennai, and who will sit with you until your questions run out.'),
    google: { rating: 4.4, url: 'https://share.google/iVaLk0aoYvBa4xzky' },
    doctor: {
      name: 'Dr. Swati Goyal',
      role: en('Founder & chief surgeon'),
      qualification: en('M.S. Ophthalmology, MBBS · Glaucoma & cataract surgeon'),
      summary: en('Fifteen years, four fellowships, and more than a hundred thousand patients who have sat in the same chair you will.'),
      bio: en('She trained at PGIMS Rohtak, then spent years at Sankara Netralaya in Chennai, then went further — to the Glaucoma Associates of Texas and the New York Eye & Ear Infirmary — to specialise in the disease that takes sight without warning.\n\nShe came back to practise here, close to home, and has done so for fifteen years. Patients mention two things most often in reviews: that she listens, and that she explains.'),
      photo_url: img.portrait, avatar_url: img.avatar,
      training: [
        { title: 'Glaucoma Research Fellowship', place: 'Glaucoma Associates of Texas, USA', short: 'Texas, USA' },
        { title: 'Glaucoma Fellowship', place: 'New York Eye & Ear Infirmary, USA', short: 'NY Eye & Ear' },
        { title: 'Phacoemulsification Fellowship', place: 'Sankara Netralaya, Chennai', short: 'Sankara Netralaya' },
        { title: 'Clinical & Surgical Fellowship, Glaucoma', place: 'Medical Research Foundation, Sankara Netralaya' },
        { title: 'General Ophthalmology Fellowship', place: 'Sankara Netralaya, Chennai', short: 'Chennai' },
        { title: 'M.S. Ophthalmology & MBBS', place: 'PGIMS, Rohtak, Haryana' },
      ],
      team: { photo_url: img.team, text: en('Optometrists, surgical nurses and a front desk that knows your file before you reach the counter.') },
    },
    highlights: [
      { value: '100k+', label: en('Patients cared for') }, { value: '5k+', label: en('Glaucoma surgeries') },
      { value: '10k+', label: en('Cataract surgeries') }, { value: '15', label: en('Years in practice') },
    ],
    treatments_title: en('Nine specialities, one building'),
    treatments_intro: en('Nine specialities, each led by Dr. Swati and supported by trained technicians. Not sure which you need? Call and describe it — we will tell you honestly.'),
    treatments: TREATMENTS.map(([slug, title, teaser, body], i) => ({ slug, title: en(title), teaser: en(teaser), body: en(body), featured: i < 4 })),
    not_sure: en('Describe the problem on the phone. If it is not something we treat, we will say so and point you somewhere better.'),
    technology: {
      title: en('The machines do the arguing for us'),
      intro: en('Every diagnosis is backed by an image you can look at yourself, on the screen, before anything is decided.'),
      items: [
        { name: en('Zeiss operating microscope'), image_url: img.zeiss }, { name: en('Johnson & Johnson phaco system'), image_url: img.phaco },
        { name: en('Huvitz OCT scanner'), image_url: img.oct }, { name: en('AVA visual field analyser'), image_url: img.ava },
      ],
    },
    testimonials: [
      { text: 'Dr. Swati is very humble down to earth good doctor. She listens well & explains well.', name: 'Pranav Bansal', when: '5 years ago', source: 'Google' },
      { text: 'Dr. Swati of SN EYE HOSPITAL is an excellent ophthalmologist. I had serious vision issue, which was taken care to my ultra satisfaction', name: 'Saurabh Jerath', when: '3 years ago', source: 'Google' },
      { text: 'Best eye hospital in the town.. Dr Swati is very knowledgeable and hears to the problems of the patients very patiently...Very satisfied with the treatment', name: 'Nitin Gupta', when: '3 years ago', source: 'Google' },
      { text: 'Dr. Swati of SN EYE HOSPITAL is an excellent ophthalmologist.She takes care of her patients nicely.', name: 'Ashok Goyal', when: '2 years ago', source: 'Google' },
    ],
    insurance: {
      title: en('Cashless insurance accepted'),
      intro: en('Bring your card and ID. We handle the paperwork with the insurer directly, so surgery is not delayed by approvals.'),
      points: [en('Empanelled with the Haryana government.'), en('Surgery is done through our tie-up with Capital Super Speciality Hospital, Jagadhri, where the insurers below are empanelled.')],
      panel: INSURERS,
      note: en('Not sure whether your policy is covered? Call us with your card to hand and we will check before you travel.'),
    },
    visit: {
      phone: '+91 94164 79792',
      hours: [en('Mon–Sat · 9:30 am – 2 pm, 5 pm – 8 pm'), en('Sunday · by appointment only')],
      address: en('Civil Lines, Jagadhri\nYamunanagar, Haryana'),
      photo_url: img.exterior,
    },
    social: {
      google: 'https://share.google/iVaLk0aoYvBa4xzky', facebook: 'https://www.facebook.com/sneyehospital',
      instagram: 'https://www.instagram.com/sneyehospital/', youtube: 'https://www.youtube.com/@drswatigoyal',
      justdial: 'https://www.justdial.com/Jagadhri/SN-Eye-Hospital-Vishnu-Garden-Civil-Lines/9999P1732-1732-200110121319-X2D5_BZDET',
    },
  }
}

// An article page's <article> → Markdown: headings, paragraphs, lists, a video link.
function toMarkdown(articleHtml) {
  let h = articleHtml.replace(/<script[\s\S]*?<\/script>/g, '')
  const out = []
  const re = /<(h[1-6]|p|li|iframe|img)\b([^>]*)>([\s\S]*?)(?:<\/\1>)?/g
  const blocks = h.match(/<(h2|h3|h4|p|li)\b[^>]*>[\s\S]*?<\/\1>|<iframe\b[^>]*>|<img\b[^>]*>/g) ?? []
  for (const b of blocks) {
    const tag = b.match(/^<(\w+)/)[1]
    if (tag === 'iframe') { const src = b.match(/src="([^"]+)"/)?.[1]; if (src) out.push(`[Watch the video](${src.replace('/embed/', '/watch?v=').replace('youtube-nocookie', 'youtube')})`); continue }
    if (tag === 'img') continue
    const t = strip(b)
    if (!t) continue
    if (tag === 'h2') out.push(`## ${t}`)
    else if (tag === 'h3' || tag === 'h4') out.push(`### ${t}`)
    else if (tag === 'li') out.push(`- ${t}`)
    else out.push(t)
  }
  void re
  return out.join('\n\n').replace(/\n\n- /g, '\n- ').replace(/^(- .*)\n\n(?!- )/gm, '$1\n\n')
}

async function articles() {
  const list = await (await fetch(`${SRC}/posts/`)).text()
  const slugs = [...new Set([...list.matchAll(/href="\/post\/([a-z0-9-]+)\/"/g)].map(m => m[1]))]
  const out = []
  for (const slug of slugs) {
    const h = await (await fetch(`${SRC}/post/${slug}/`)).text()
    const art = h.match(/<article[\s\S]*?<\/article>/)?.[0]
    if (!art) { console.log(`  ! no article body: ${slug}`); continue }
    const title = strip(art.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? slug)
    const meta = strip(art).match(/(\d{1,2} \w+ \d{4})\s*·\s*(\d+) min/)
    // The video is a play button over a YouTube thumbnail; the thumbnail names the video.
    const yt = art.match(/(?:ytimg\.com\/vi|youtube\.com\/embed|youtu\.be)\/([\w-]{11})/)?.[1]
    const bodyHtml = art.replace(/^[\s\S]*?<\/h1>/, '')
    let body = toMarkdown(bodyHtml)
    // The byline line ("Dr. Swati Goyal · date · n min") is metadata, not body.
    body = body.split('\n\n').filter(p => !/^Dr\. Swati Goyal\s*·/.test(p))
      .map(p => p === 'Watch the video' ? (yt ? `[Watch the video on YouTube](https://www.youtube.com/watch?v=${yt})` : '') : p)
      .filter(Boolean).join('\n\n')
    const first = body.split('\n\n').find(p => !p.startsWith('#') && !p.startsWith('[') && p.length > 60) ?? ''
    out.push({ slug, title, body, summary: first.length > 220 ? first.slice(0, first.lastIndexOf(' ', 217)) + '…' : first,
      published_on: meta ? new Date(meta[1] + ' UTC').toISOString().slice(0, 10) : null, read_minutes: meta ? Number(meta[2]) : null })
  }
  return out
}

const c = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
await c.connect()
if (!BUSINESS) {
  const { rows } = await c.query(`select id, name, vertical, status from businesses where name ilike '%' || $1 || '%' order by status = 'active' desc, name`, [NAME])
  if (rows.length !== 1) {
    console.log(rows.length ? 'More than one match — run again with --business <id>:' : 'No business matches that name.')
    for (const r of rows) console.log(`  ${r.id}  ${r.name}  (${r.vertical}, ${r.status})`)
    process.exit(1)
  }
  BUSINESS = rows[0].id
}
const { rows: [biz] } = await c.query('select id, name from businesses where id = $1', [BUSINESS])
if (!biz) { console.error('no such business in ' + ENV); process.exit(1) }
console.log(`${ENV}: ${biz.name}`)

const storage = createClient(`https://${REF}.supabase.co`, await serviceKey(), { auth: { persistSession: false } }).storage
const img = {}
for (const [k, path] of Object.entries(IMAGES)) {
  const res = await fetch(SRC + path)
  if (!res.ok) { console.log(`  ! ${path}: ${res.status}`); continue }
  const file = `${BUSINESS}/${path.split('/').pop()}`
  const { error } = await storage.from('site-images').upload(file, await res.arrayBuffer(),
    { upsert: true, contentType: res.headers.get('content-type') ?? 'image/jpeg' })
  if (error) throw new Error(`${file}: ${error.message}`)
  img[k] = storage.from('site-images').getPublicUrl(file).data.publicUrl
}
console.log(`  ${Object.keys(img).length} photos`)

await c.query(`
  insert into business_sites (business_id, slug, template, brand_color, logo_url, hero_image_url, content, updated_at)
  values ($1, $2, 'clinic', '#0f4c5c', $3, $4, $5, now())
  on conflict (business_id) do update set slug = excluded.slug, template = excluded.template,
    brand_color = excluded.brand_color, logo_url = excluded.logo_url, hero_image_url = excluded.hero_image_url,
    content = excluded.content, updated_at = now()`,
  [BUSINESS, SLUG, img.logo ?? null, img.hero ?? null, content(img)])
console.log(`  site: /s/${SLUG}`)

const list = await articles()
for (const a of list) {
  await c.query(`
    insert into site_articles (business_id, slug, lang, title, summary, body, author, read_minutes, published_on)
    values ($1, $2, 'en', $3, $4, $5, 'Dr. Swati Goyal', $6, $7)
    on conflict (business_id, slug) do update set title = excluded.title, summary = excluded.summary, body = excluded.body,
      read_minutes = excluded.read_minutes, published_on = excluded.published_on, updated_at = now()`,
    [BUSINESS, a.slug, a.title, a.summary, a.body, a.read_minutes, a.published_on])
}
console.log(`  ${list.length} articles`)
await c.end()
