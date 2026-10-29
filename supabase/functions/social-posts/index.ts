// social-posts — make each business's social media post for a day (0292, 0293).
//
//   plan   the daily cron (1:30 PM IST): tomorrow's post for every business
//          with posts switched on and not paused, unless it already has one.
//   make   the owner (or an admin) presses "Make this post again" — remakes
//          the post for one day.
//
// A post is made in five steps:
//   1. TOPIC    a health day or festival from social_calendar for that date and
//               the business's speciality; else, on even dates, a season topic
//               not used in the last 30 days; else Claude picks an everyday tip.
//   2. WORDS    Claude picks the design (tips, photo, day, question, fact,
//               greeting) and writes its words in ONE language for the image —
//               Hindi and English alternate by date when the business wants
//               both — plus a caption in every language wanted.
//   3. CHECK    the words go through SAFETY_RULES. Medical advertising rules
//               (NMC 2023, Drugs and Magic Remedies Act) forbid cure claims,
//               "best doctor", guarantees and prices; a draft that breaks one is
//               sent back once with the reason, and if it fails again the day
//               gets a plain "we are here for you" post instead.
//   4. PICTURE  every design is built around a picture: the business's own
//               photo when one truly fits; else an AI picture for the topic,
//               made once and reused by every business (social_images). No
//               picture (no AI keys yet) → the design's brand-colour backdrop.
//   5. IMAGE    the render worker (Vercel, /api/social-render) draws the square
//               and the story image; both are stored in the social-posts bucket.
//
// ── NOTHING ABOUT PATIENTS ──────────────────────────────────────────────────
// This function reads the business's own details and its site only. It never
// touches patients, visits, records, ABHA or the ABDM tables, and it sends
// Claude and the picture model nothing about any patient. See "ABDM and
// privacy rules" in the build plan before adding any input here.
//
// Request:  { action: "plan" }                              service-role only
//           { action: "make", businessId, date?: "YYYY-MM-DD", note? }
//             owner or admin; date defaults to tomorrow (IST); note = the
//             owner's own ask ("about cataract"), which then needs their OK
//           { action: "preview" }   7 PM IST cron: tomorrow's post to the owner (0295)
//           { action: "publish" }   10 AM IST cron: today's posts to Facebook and Instagram
//           { action: "decide", postId, answer: "ok" | "skip" | "change" | "post", note?, from? }
//             the owner's answer, from the app (owner) or from WhatsApp
//             (whatsapp-inbound, service role, `from` = the number that answered)
//           { action: "preview-template", wabaId }   service role, once per
//             WhatsApp account: creates the social_post_preview template
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      ANTHROPIC_API_KEY       the words (absent = posts cannot be made)
//      SOCIAL_RENDER_URL       e.g. https://sehat-sandhi-staging.vercel.app/api/social-render
//      SOCIAL_RENDER_SECRET    shared with the render worker
//      GEMINI_API_KEY          AI pictures, first choice (Nano Banana, billed per picture)
//      CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN
//                              AI pictures (Workers AI, FLUX.1 schnell)
//      POLLINATIONS_KEY        AI pictures when Cloudflare fails (Pollen wallet)
//                              none set = own photos only

import Anthropic from 'npm:@anthropic-ai/sdk'
import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { APP_ID, GRAPH, graph } from '../_shared/metaGraph.ts'
import { graphSend } from '../_shared/whatsapp.ts'

const BUCKET = 'social-posts'
const MODEL = 'claude-opus-5-5'
// Compared 29 Oct 2026 on three scenes: FLUX.2 dev looked the most natural and
// Indian; FLUX.2 klein 9B was close and three times faster.
const PICTURE_MODEL = '@cf/black-forest-labs/flux-2-dev'
const PICTURE_MODEL_FAST = '@cf/black-forest-labs/flux-2-klein-9b'
const GEMINI_MODEL = 'gemini-nano-banana-2.1'
const TEMPLATES = ['tips', 'photo', 'day', 'question', 'fact', 'greeting'] as const
const MOTIFS = ['lights', 'colours', 'flag', 'stars'] as const
// Must match api/_social/icons.js.
const ICONS = ['eye', 'eye-off', 'glasses', 'sun', 'moon', 'droplet', 'droplets', 'heart', 'heart-pulse', 'activity',
  'shield-check', 'calendar', 'clock', 'phone', 'baby', 'stethoscope', 'thermometer', 'apple', 'salad', 'footprints',
  'bed', 'monitor', 'smartphone', 'wind', 'cloud-sun', 'snowflake', 'flame', 'sparkles', 'hand', 'hand-heart', 'brain',
  'pill', 'syringe', 'check', 'x', 'triangle-alert', 'info', 'users', 'user-round', 'smile', 'leaf', 'glass-water',
  'tree-pine', 'book-open', 'car', 'zap', 'ear', 'bone', 'scan-eye', 'microscope', 'calendar-check', 'badge-check',
  'gift', 'star', 'lamp']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_HI = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर']

// deno-lint-ignore no-explicit-any
type Db = any
type Lang = 'en' | 'hi' | 'both'

interface CalendarRow {
  id: string; kind: 'health_day' | 'festival' | 'season'; month: number; day: number | null; year: number | null
  title_en: string; title_hi: string | null; specialities: string[]; angle: string | null
}
interface Topic { title: string; titleHi: string | null; kind: string; angle: string | null; calendarId: string | null; dated: boolean }
interface Photo { url: string; label: string }
interface Draft {
  topic: string; template: typeof TEMPLATES[number]; icon: string; badge: string
  headline: string; highlight: string; body: string
  points: { icon: string; text: string }[]; myth: string; fact: string; motif: string
  photo_index: number; ai_picture: string
  caption: string; hashtags: string[]
}
interface Business {
  id: string; name: string; phone: string | null; city: string | null; hours: string | null
  website: string | null; brand: string | null; logo: string | null; tagline: string | null
  specialities: string[]; services: string[]; photos: Photo[]
}

// social_settings.profile (0296): only the fields it sets.
function profileOf(p: Record<string, unknown> | null): Partial<Business> {
  const out: Partial<Business> = {}
  for (const k of ['name', 'phone', 'website', 'logo', 'brand', 'city', 'tagline'] as const) {
    if (typeof p?.[k] === 'string' && (p[k] as string).trim()) out[k] = (p[k] as string).trim()
  }
  return out
}

// ── Safety ──────────────────────────────────────────────────────────────────
// Checked on every word that will be posted, whoever wrote it.
const SAFETY_RULES: [RegExp, string][] = [
  [/\b(best|top|no\.?\s?1|number\s?one|leading|finest)\s+(doctor|surgeon|hospital|clinic|eye|specialist|centre|center)/i, 'no "best/top/number one" claims'],
  [/\b(guarantee[ds]?|100\s?%|assured result|permanent(ly)? cure|miracle|risk[- ]free|painless guaranteed)\b/i, 'no guarantees or certain results'],
  [/\bcure[sd]?\b/i, 'do not promise a cure'],
  [/(₹|\brs\.?\s?\d|\binr\b|\d+\s?%\s?off|\bdiscount|\bcheapest|\blowest (price|cost)|\bfree (surgery|operation|treatment))/i, 'no prices, discounts or free treatment offers'],
  [/\b(abdm|nha|ayushman bharat digital)\b/i, 'no ABDM / NHA claims'],
  [/(गारंटी|सबसे अच्छ|नंबर\s?1|नंबर वन|पक्का इलाज|100\s?%|छूट|मुफ्त ऑपरेशन|मुफ़्त ऑपरेशन|सबसे सस्त)/, 'Hindi: no guarantees, "best", discounts'],
]

function safetyProblems(d: Draft): string[] {
  const text = [d.badge, d.headline, d.body, d.myth, d.fact, ...d.points.map((p) => p.text), d.caption, ...d.hashtags].join('\n')
  return SAFETY_RULES.filter(([re]) => re.test(text)).map(([, why]) => why)
}

// ── Small things ────────────────────────────────────────────────────────────
function istDate(offsetDays = 0): string {
  return new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10)
}

// "Monday: 9:30 am – 7:00 pm; …; Sunday: Closed" → "Mon–Sat 9:30 am – 7:00 pm"
function shortHours(raw: string | null): string | null {
  if (!raw) return null
  const parts = raw.split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(':')
    return i < 0 ? null : { day: p.slice(0, 3), value: p.slice(i + 1).trim() }
  })
  if (parts.some((p) => !p)) return raw.length <= 60 ? raw : null
  const groups: { from: string; to: string; value: string }[] = []
  for (const p of parts as { day: string; value: string }[]) {
    const last = groups.at(-1)
    if (last && last.value === p.value) last.to = p.day
    else groups.push({ from: p.day, to: p.day, value: p.value })
  }
  const open = groups.filter((g) => !/closed/i.test(g.value))
  const s = open.map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.value}`).join(', ')
  return s.length <= 70 ? s : null
}

// 9416479792 → 94164 79792
const showPhone = (p: string | null) => {
  const d = (p ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : p
}

const topicKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

// ── What the business is ────────────────────────────────────────────────────
async function loadBusiness(db: Db, id: string, focus: string[]): Promise<Business> {
  const [{ data: b, error }, { data: site }, { data: docs }] = await Promise.all([
    db.from('businesses').select('id, name, phone, own_city, working_hours').eq('id', id).single(),
    db.from('business_sites').select('slug, custom_domain, brand_color, logo_url, hero_image_url, content').eq('business_id', id).maybeSingle(),
    db.from('public_business_doctors').select('speciality').eq('business_id', id),
  ])
  if (error || !b) throw new Error(`business ${id} not found`)

  // Every photo the business has put on its own site, with a label for Claude.
  const photos: Photo[] = []
  const seen = new Set<string>()
  const add = (url: unknown, label: string) => {
    if (typeof url === 'string' && /^https:\/\/.+\.(jpe?g|png|webp)$/i.test(url) && !seen.has(url) && url !== site?.logo_url) {
      seen.add(url); photos.push({ url, label })
    }
  }
  add(site?.hero_image_url, 'main photo of the hospital')
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, path))
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const name = (o.name as { en?: string })?.en ?? (o.title as { en?: string })?.en
      for (const [k, x] of Object.entries(o)) {
        if (/image|photo/i.test(k)) add(x, name ? `${path}: ${name}` : path)
        else walk(x, k)
      }
    }
  }
  walk(site?.content ?? {}, 'site')

  const c = site?.content ?? {}
  const counts = new Map<string, number>()
  for (const d of docs ?? []) if (d.speciality) counts.set(d.speciality, (counts.get(d.speciality) ?? 0) + 1)
  const specialities = focus.length ? focus : [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)

  return {
    // The number on the business's website (Website → Visit), which is the one
    // patients should call; the listing's phone can be a doctor's own.
    id, name: b.name, phone: showPhone(typeof c.visit?.phone === 'string' && c.visit.phone.trim() ? c.visit.phone : b.phone), city: b.own_city, hours: shortHours(b.working_hours),
    website: site ? (site.custom_domain ?? `sehatsandhi.com/s/${site.slug}`) : null,
    brand: site?.brand_color ?? null, logo: site?.logo_url ?? null,
    tagline: c.tagline?.en ?? null,
    services: Array.isArray(c.treatments) ? c.treatments.map((t: { title?: { en?: string } }) => t.title?.en).filter(Boolean) : [],
    specialities, photos: photos.slice(0, 12),
  }
}

// ── 1. Topic ────────────────────────────────────────────────────────────────
function pickTopic(cal: CalendarRow[], date: string, specs: string[], recent: string[], blocked: string[]): Topic | null {
  const [y, m, d] = date.split('-').map(Number)
  const fits = (r: CalendarRow) =>
    (r.year == null || r.year === y) &&
    (r.specialities.length === 0 || r.specialities.some((s) => specs.includes(s))) &&
    !blocked.some((b) => r.title_en.toLowerCase().includes(b.toLowerCase()))
  const asTopic = (r: CalendarRow, dated: boolean): Topic =>
    ({ title: r.title_en, titleHi: r.title_hi, kind: r.kind, angle: r.angle, calendarId: r.id, dated })

  // A day of its own wins: the speciality's own day, then a festival, then any health day.
  const today = cal.filter((r) => r.kind !== 'season' && r.month === m && r.day === d && fits(r))
  const rank = (r: CalendarRow) => (r.specialities.length ? 0 : r.kind === 'festival' ? 1 : 2)
  today.sort((a, b) => rank(a) - rank(b))
  if (today.length) return asTopic(today[0], true)

  // On even dates, a season topic not used in the last 30 days (the date picks
  // among them); odd dates are left to Claude's everyday tip, so a month of
  // posts is not all about the season.
  const usedRecently = new Set(recent.map((t) => t.toLowerCase()))
  const seasons = cal.filter((r) => r.kind === 'season' && r.month === m && fits(r) && !usedRecently.has(r.title_en.toLowerCase()))
  if (seasons.length && d % 2 === 0) return asTopic(seasons[d % seasons.length], false)
  return null
}

// Sehatsandhi's own posts (0296), for doctors and clinic owners: one thing the
// software does, told as the everyday problem it solves. Taken in turn, each
// not again within 30 days; festivals and Doctors' Day come first.
const FEATURES: { title: string; angle: string }[] = [
  { title: 'No more crowd at reception', angle: 'OPD queue: patients get a token on WhatsApp and see their turn, the waiting room stays calm' },
  { title: 'Prescriptions on WhatsApp', angle: 'The doctor writes once; the patient gets a clean prescription link on WhatsApp, no lost paper slips' },
  { title: 'Bills in one tap', angle: 'GST bills made at the counter and sent on WhatsApp; the day\'s collection at a glance' },
  { title: 'Appointments that fill themselves', angle: 'Patients book on WhatsApp or the app any time; the clinic sees the day\'s list in the morning' },
  { title: 'Patients come back on time', angle: 'Automatic follow-up reminders on WhatsApp, so patients return for their review visit' },
  { title: 'A website for your clinic', angle: 'A clinic website with doctors, timings and a book button, made from what you already entered' },
  { title: 'Daily posts made for you', angle: 'A ready Facebook and Instagram post every day with your logo and photos; you just say OK' },
  { title: 'Your own WhatsApp number', angle: 'Messages to patients go from the clinic\'s own WhatsApp number, with the clinic\'s name' },
  { title: 'Lab reports to patients', angle: 'Lab results go to the patient on WhatsApp as a secure link the moment they are ready' },
  { title: 'Pharmacy stock without registers', angle: 'Stock entered in strips, sold per tablet; low stock and expiry warnings before they hurt' },
  { title: 'Beds and IPD on one screen', angle: 'Wards, beds, deposits and the running bill of every admitted patient, always up to date' },
  { title: 'Discharge papers in minutes', angle: 'Discharge summary and final bill ready together, sent to the family on WhatsApp' },
  { title: 'Surgery day, well prepared', angle: 'Reminders before a planned surgery and care messages after it, sent automatically' },
  { title: 'Reception, doctor, owner: each sees their part', angle: 'Staff roles: reception books and bills, doctors see their patients, the owner sees everything' },
  { title: 'Bring your old patient list', angle: 'Upload an Excel sheet of existing patients and start the same day' },
  { title: 'A QR poster at reception', angle: 'Patients scan the clinic\'s QR to join its WhatsApp list and book next time' },
  { title: 'Ratings that build trust', angle: 'After a visit, patients are asked once for a rating, so happy patients speak up' },
  { title: 'Health tips to your patients', angle: 'Send health tips and camp news to the patients who said yes, with a stop option for anyone' },
  { title: 'Tests sent to a partner lab', angle: 'Send a test to another lab on Sehatsandhi and the report comes back into the patient\'s file' },
  { title: 'Hospital and lab settle up', angle: 'Agreed terms, one ledger and monthly statements between hospitals, labs and pharmacies' },
  { title: 'Know your clinic\'s numbers', angle: 'Daily and monthly reports: patients seen, collection, top services, follow-ups due' },
  { title: 'Works on phone and computer', angle: 'Use it on the reception computer and the doctor\'s phone, nothing to install' },
  { title: 'Made for Indian clinics', angle: 'Hindi and English, WhatsApp first, built for small-city clinics and hospitals' },
  { title: 'Patient records in one place', angle: 'Every visit, prescription, bill and report of a patient on one page, searchable in seconds' },
  { title: 'Multi-doctor clinics, sorted', angle: 'Each doctor\'s own queue, slots and fees, one front desk for all' },
  { title: 'Myth: clinic software is costly and hard', angle: 'Myth vs fact: start with what you need, set up in a day, staff learn it in an hour' },
  { title: 'Your data stays yours', angle: 'Data kept in India, encrypted, access by role, every opening of a record logged' },
  { title: 'Try it with a free demo', angle: 'WhatsApp us for a free demo at your clinic or on a video call' },
]

function pickDoctorsTopic(cal: CalendarRow[], date: string, recent: string[]): Topic {
  const [y, m, d] = date.split('-').map(Number)
  const day = cal.filter((r) => r.month === m && r.day === d && (r.year == null || r.year === y) && r.specialities.length === 0 &&
    (r.kind === 'festival' || r.title_en === "National Doctors' Day"))
  if (day.length) {
    const r = day[0]
    return { title: r.title_en, titleHi: r.title_hi, kind: r.kind, calendarId: r.id, dated: true,
      angle: `Greetings from Sehatsandhi to doctors, clinic teams and their patients for ${r.title_en}. No selling on this day.` }
  }
  const used = new Set(recent.map((t) => t.toLowerCase()))
  const fresh = FEATURES.filter((f) => !used.has(f.title.toLowerCase()))
  const pool = fresh.length ? fresh : FEATURES
  const f = pool[Math.floor(Date.parse(date) / 864e5) % pool.length]
  return { title: f.title, titleHi: null, kind: 'feature', angle: f.angle, calendarId: null, dated: false }
}

// ── 2. Words ────────────────────────────────────────────────────────────────
// For both kinds of post: what makes people stop, answer and share (0296).
const REACH = `
Reach (more people see a post that gets comments, saves and shares):
- The caption's last words before the contact line are ONE easy thing to do, varied day to day: a question anyone can answer in a word or a number ("Which tip do you already follow? Comment 1, 2 or 3"), "Save this for later", "Share with someone who needs it", or "Tag a friend who…". Never "like and share".
- hashtags: 6–10, mixed: 2–3 local (the city and its district or state, e.g. #YamunaNagar #Jagadhri #Haryana), 2–3 on the topic (#EyeCare #DiwaliSafety), 1–2 broader (#HealthTips #India), and the business's own tag (its name without spaces, e.g. #SNEyeHospital). Prefer specific tags over huge ones. No spaces or punctuation inside a tag.`

const SYSTEM = `You design and write one daily social media post (Facebook and Instagram) for an Indian clinic or hospital, posted under the business's own name. The aim: a post people stop at, save and share — clear, warm, useful, never salesy.

Write for ordinary patients in a small Indian city. One idea per post. Few words on the image: people read a post in two seconds.

Rules (Indian medical advertising law, NMC 2023 and the Drugs and Magic Remedies Act). Breaking any of them means the post is thrown away:
- Never say best, top, number one, leading, finest, or compare with other doctors.
- Never promise a cure, a result, painless treatment or anything "guaranteed" or "100%".
- No prices, discounts, offers, free treatment or free surgery.
- Nothing about any individual patient, no testimonials, no before/after.
- No medicine names or doses; never tell people to self-medicate.
- No claims of government approval, ABDM or NHA certification.
- Facts about the business only from what you are given. Do not invent doctors, machines, awards or numbers.
- Medical facts must be mainstream and correct. If unsure, choose a simpler, safer message.

Pick the design that suits the topic, and vary designs from day to day:
- "tips": a headline and exactly 3 short points, each with an icon. Most practical advice.
- "question": a question patients really ask (headline) and a one-sentence answer (body).
- "fact": a common myth and the fact (myth, fact), with a short headline naming the subject.
- "day": a health awareness day that falls on this date. Headline = the message, body = one action. The badge is the day's name.
- "photo": the picture fills the post, with a headline and one sentence. Good for warm, everyday-life messages.
- "greeting": festival or national-day wishes. Headline = the greeting ("Happy Diwali"), body = one warm line, optionally a safety tip that fits the speciality. Choose a motif: "lights" (Diwali, lamps), "colours" (Holi), "flag" (Independence Day, Republic Day, Gandhi Jayanti), "stars" (New Year, Christmas, anything else).

Fields:
- image_language tells you the language for EVERYTHING ON THE IMAGE (badge, headline, highlight, body, points, myth, fact). Hindi means natural, simple Hindi in Devanagari, as people in North India speak it; common English medical words may stay in Devanagari (डॉक्टर, आई चेकअप).
- headline: at most 40 characters for English, 32 for Hindi. highlight: 1–3 words copied exactly from the headline to colour; empty if none.
- body: one sentence, at most 90 characters. Empty for tips and fact.
- points: for tips only, 3 items of at most 38 characters each, each with an icon; otherwise [].
- badge: 1–4 words in a pill (e.g. "Eye care tip", the day's name). icon: one icon from the list for the badge.
- Every design shows one picture. photo_index: index into photos when one of the business's own photos truly fits the words; else -1.
- ai_picture: ALWAYS fill this: a short English description of the picture for this post, for an AI image model. A real-life scene with Indian people in an everyday Indian setting that tells the story at a glance.
  The face and body must match the message. When the post is about a problem or symptom (trouble reading, blurry vision, burning or tired eyes, headache, breathlessness, joint pain), show the person HAVING that problem: squinting, frowning, holding a book or phone at arm's length, pressing their temples, tired or uncomfortable — never smiling. Only prevention tips, good habits, festivals and "life after care" messages show people happy or relaxed.
  Examples: problem — "an elderly Indian man in a kurta squinting and frowning, holding a medicine strip at arm's length to read it, on his home balcony"; good habit — "a schoolgirl doing homework at a desk by a window in daylight, sitting upright"; festival — "glowing clay diyas on a rangoli at night, marigolds".
  Show a problem gently and respectfully: no pain distorting the face, no crying, no injury. For festivals, the festival itself (e.g. "glowing clay diyas on a rangoli at night, marigolds"). Never a patient being examined, a procedure, a hospital bed, needles, blood, a close-up of an eye, medicines, text or a logo. Avoid anything with writing on it (newspapers, book pages, signboards, phone or laptop screens facing the viewer): AI pictures turn writing into nonsense letters. Keep the lower part of the scene simple, words go over it.
- caption: the text posted under the image, in caption_languages: 2–4 short lines (when both languages, Hindi lines first then English), then the business name, phone and website on the last line. No hashtags in it.
- hashtags: each starting with #, as below.
${REACH}`

// Sehatsandhi's own posts (0296): to doctors, clinic and hospital owners.
const SYSTEM_DOCTORS = `You design and write one daily social media post (Facebook and Instagram) for Sehatsandhi, Indian software for clinics, hospitals, labs and pharmacies. The readers are doctors, clinic and hospital owners and their staff in Indian towns and small cities. The aim: a busy doctor stops, nods ("that is my problem") and saves or shares it with a colleague.

Write like a helpful colleague, not an advert. One idea per post: the everyday problem first, then how Sehatsandhi solves it, in plain words. Few words on the image.

Rules. Breaking any of them means the post is thrown away:
- Never say best, top, number one, leading, cheapest, or compare with other software by name.
- No prices, discounts or offers ("free demo" is fine). No guarantees, "100%", or promised results ("double your patients").
- No claims of government approval, ABDM, NHA or any certification.
- Only features you are given in the topic; never invent features, customers, numbers or testimonials.
- No patients' details, no medical advice.

Pick the design that suits the topic, and vary designs from day to day:
- "tips": a headline and exactly 3 short points, each with an icon: three things the feature does.
- "question": a question doctors really ask ("Can my receptionist learn it?") and a one-sentence answer.
- "fact": a common myth about clinic software and the fact.
- "photo": the picture fills the post, with a headline and one sentence.
- "greeting": festival or national-day wishes from Sehatsandhi (headline the greeting, body one warm line). Choose a motif: "lights", "colours", "flag" or "stars".
- "day" is only for National Doctors' Day.

Fields:
- image_language tells you the language for EVERYTHING ON THE IMAGE. Hindi means natural, simple Hindi in Devanagari; software words may stay as they are said (ऐप, व्हाट्सऐप, बिल, रिपोर्ट).
- headline: at most 40 characters for English, 32 for Hindi. highlight: 1–3 words copied exactly from the headline; empty if none.
- body: one sentence, at most 90 characters. Empty for tips and fact.
- points: for tips only, 3 items of at most 38 characters each, each with an icon; otherwise [].
- badge: 1–4 words in a pill (e.g. "For clinics", "Doctor's tip"). icon: one icon from the list for the badge.
- photo_index: -1.
- ai_picture: ALWAYS fill this: a real-life scene in an Indian clinic or hospital that shows the problem or the relief: a calm reception desk, a doctor talking to a patient's family, a receptionist smiling at a patient, an evening clinic with few people waiting. Never screens facing the viewer, documents, writing, logos, needles, blood or anyone in pain.
- caption: in caption_languages: 2–4 short lines (Hindi lines first when both), then "WhatsApp 70153 99355 for a free demo · sehatsandhi.com" on the last line. No hashtags in it.
- hashtags: each starting with #, as below, with #Sehatsandhi always, and doctor-side tags (#ClinicManagement #DoctorsOfIndia #HospitalSoftware #HealthTech #DigitalClinic) instead of patient ones; local tags only when the topic is local.
${REACH}`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'template', 'icon', 'badge', 'headline', 'highlight', 'body', 'points', 'myth', 'fact', 'motif', 'photo_index', 'ai_picture', 'caption', 'hashtags'],
  properties: {
    topic: { type: 'string' },
    template: { type: 'string', enum: [...TEMPLATES] },
    icon: { type: 'string', enum: ICONS },
    badge: { type: 'string' },
    headline: { type: 'string' },
    highlight: { type: 'string' },
    body: { type: 'string' },
    points: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['icon', 'text'], properties: { icon: { type: 'string', enum: ICONS }, text: { type: 'string' } } },
    },
    myth: { type: 'string' },
    fact: { type: 'string' },
    motif: { type: 'string', enum: [...MOTIFS] },
    photo_index: { type: 'integer' },
    ai_picture: { type: 'string' },
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
}

async function write(
  anthropic: Anthropic, biz: Business, date: string, topic: Topic | null, imageLang: 'en' | 'hi', lang: Lang,
  recent: string[], favourites: string[], problems: string[], note: string | null, audience: 'patients' | 'doctors' = 'patients',
): Promise<Draft> {
  const brief = {
    date,
    image_language: imageLang === 'hi' ? 'Hindi' : 'English',
    caption_languages: lang === 'both' ? 'Hindi and English' : lang === 'hi' ? 'Hindi' : 'English',
    business: {
      name: biz.name, city: biz.city, phone: biz.phone, hours: biz.hours, website: biz.website,
      specialities: biz.specialities, services: biz.services, tagline: biz.tagline,
    },
    topic: topic
      ? { title: topic.title, hindi_title: topic.titleHi, kind: topic.kind, what_to_say: topic.angle, falls_on_this_date: topic.dated }
      : `No calendar topic today: choose one useful everyday topic for these specialities: ${biz.specialities.join(', ') || 'general health'}.`,
    favourite_topics: favourites,
    recent_topics_do_not_repeat: recent,
    photos: biz.photos.map((p, i) => ({ index: i, shows: p.label })),
    ...(note ? { the_owner_asks_for_this_post_it_wins_over_the_topic: note } : {}),
    ...(problems.length ? { your_last_draft_broke_these_rules_fix_them: problems } : {}),
  }
  const res = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: audience === 'doctors' ? SYSTEM_DOCTORS : SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify(brief) }],
  // deno-lint-ignore no-explicit-any
  } as any)
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to write this post')
  if (res.stop_reason === 'max_tokens') throw new Error('the post came back cut off')
  // deno-lint-ignore no-explicit-any
  const text = res.content.find((b: any) => b.type === 'text')?.text
  if (!text) throw new Error('no words came back')
  const d = JSON.parse(text) as Draft
  if (!TEMPLATES.includes(d.template)) d.template = 'tips'
  d.points = (d.points ?? []).slice(0, 3)
  d.hashtags = [...new Set((d.hashtags ?? []).filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h)))].slice(0, 10)
  return d
}

// The day's post when Claude's words fail the check twice.
function fallbackDraft(biz: Business, imageLang: 'en' | 'hi'): Draft {
  const hi = imageLang === 'hi'
  return {
    topic: 'We are here for you', template: 'tips', icon: 'hand-heart', badge: hi ? 'हम आपके साथ हैं' : 'We are here for you',
    headline: hi ? 'आपकी सेहत, हमारी ज़िम्मेदारी' : 'Your health, our care', highlight: '', body: '',
    points: [
      ...(biz.hours ? [{ icon: 'clock', text: biz.hours }] : []),
      ...(biz.phone ? [{ icon: 'phone', text: hi ? `कॉल करें ${biz.phone}` : `Call ${biz.phone}` }] : []),
      ...(biz.city ? [{ icon: 'heart', text: biz.city }] : []),
    ],
    myth: '', fact: '', motif: 'stars', photo_index: -1, ai_picture: '',
    caption: [`${biz.name}${biz.city ? `, ${biz.city}` : ''}`, biz.hours, [biz.phone, biz.website].filter(Boolean).join(' · ')].filter(Boolean).join('\n'),
    hashtags: biz.city ? [`#${biz.city.replace(/\s+/g, '')}`, '#Health'] : ['#Health'],
  }
}

// ── 4. Picture ──────────────────────────────────────────────────────────────
// One AI picture per topic, reused by every business. Made by the first model
// that has keys and answers: Cloudflare Workers AI FLUX.2 dev, then FLUX.2
// klein (both on the free daily allowance), then Gemini (paid per picture,
// about ₹3, once its project has billing), then Pollinations (Pollen wallet).
// None set up → no picture.
type Maker = { model: string; make: (prompt: string) => Promise<{ bytes: Uint8Array; type: string }> }

// The image block of a Gemini interaction: the docs show it only through the
// SDK (output_image.data / a model_output step's image block), so look for it.
// deno-lint-ignore no-explicit-any
function geminiImage(v: any): { data: string; mime?: string } | null {
  if (!v || typeof v !== 'object') return null
  if (typeof v.data === 'string' && v.data.length > 1000 && (v.type === 'image' || /^image\//.test(v.mime_type ?? v.mimeType ?? ''))) {
    return { data: v.data, mime: v.mime_type ?? v.mimeType }
  }
  for (const x of Object.values(v)) { const f = geminiImage(x); if (f) return f }
  return null
}

// Workers AI takes JSON for most models, form fields for FLUX.2; both answer
// with { result: { image: base64 } }.
async function cloudflarePicture(model: string, prompt: string): Promise<{ bytes: Uint8Array; type: string }> {
  const account = Deno.env.get('CLOUDFLARE_ACCOUNT_ID'), token = Deno.env.get('CLOUDFLARE_AI_TOKEN')
  if (!account || !token) throw new Error('not set up')
  let body: BodyInit, headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (model.includes('flux-2')) {
    const f = new FormData()
    f.set('prompt', prompt); f.set('width', '1024'); f.set('height', '1024')
    body = f
  } else {
    body = JSON.stringify(model.includes('flux-1-schnell') ? { prompt, steps: 8 } : { prompt, width: 1024, height: 1024 })
    headers = { ...headers, 'content-type': 'application/json' }
  }
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, { method: 'POST', headers, body })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
  // Some models (Leonardo Phoenix) answer with the image itself, not JSON.
  const type = r.headers.get('content-type') ?? ''
  if (type.startsWith('image/')) return { bytes: new Uint8Array(await r.arrayBuffer()), type: type.split(';')[0] }
  const b64 = (await r.json())?.result?.image
  if (!b64) throw new Error('empty')
  return { bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type: 'image/jpeg' }
}

const MAKERS: Maker[] = [
  {
    model: `cloudflare:${PICTURE_MODEL}`,
    make: (prompt) => cloudflarePicture(PICTURE_MODEL, prompt),
  },
  {
    model: `cloudflare:${PICTURE_MODEL_FAST}`,
    make: (prompt) => cloudflarePicture(PICTURE_MODEL_FAST, prompt),
  },
  {
    model: `gemini:${GEMINI_MODEL}`,
    make: async (prompt) => {
      const key = Deno.env.get('GEMINI_API_KEY')
      if (!key) throw new Error('not set up')
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: GEMINI_MODEL, input: prompt,
          response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '1:1', image_size: '1K' },
        }),
      })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`)
      const body = await r.json()
      const img = geminiImage(body)
      if (!img) throw new Error(`no image in the answer: ${JSON.stringify(body).slice(0, 300)}`)
      return { bytes: Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0)), type: img.mime?.split(';')[0] || 'image/jpeg' }
    },
  },
  {
    model: 'pollinations:black-forest-labs/flux.1-schnell',
    make: async (prompt) => {
      const key = Deno.env.get('POLLINATIONS_KEY')
      if (!key) throw new Error('not set up')
      const r = await fetch(`https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=black-forest-labs/flux.1-schnell`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      const type = r.headers.get('content-type') ?? ''
      if (!r.ok || !/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
      return { bytes: new Uint8Array(await r.arrayBuffer()), type: type.split(';')[0] }
    },
  },
]

async function aiPicture(db: Db, topic: string, scene: string, only?: string): Promise<string | null> {
  const key = topicKey(topic)
  if (!key || !scene) return null
  const { data: have } = await db.from('social_images').select('image_url').eq('topic_key', key).order('created_at', { ascending: false }).limit(1)
  if (have?.length) return have[0].image_url

  const prompt = `${scene}. Photorealistic photograph, warm natural light, Indian people, clean everyday setting, soft background. ` +
    'No text, no letters, no logos, no watermark. No medical procedure, no needles, no blood, no close-up of an eye.'
  const failures: string[] = []
  for (const m of MAKERS.filter((m) => !only || m.model.startsWith(only))) {
    let got: { bytes: Uint8Array; type: string }
    try { got = await m.make(prompt) } catch (e) { failures.push(`${m.model}: ${e instanceof Error ? e.message : e}`); continue }
    const path = `ai/${key}-${Date.now()}.${got.type === 'image/png' ? 'png' : got.type === 'image/webp' ? 'webp' : 'jpg'}`
    const { error } = await db.storage.from(BUCKET).upload(path, got.bytes, { contentType: got.type })
    if (error) throw new Error(`storing the AI picture: ${error.message}`)
    const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    await db.from('social_images').insert({ topic_key: key, prompt, image_url: url, model: m.model })
    return url
  }
  // Nothing set up at all is not an error: the design has a brand-colour backdrop.
  if (failures.every((f) => f.endsWith('not set up'))) return null
  throw new Error(`AI picture failed — ${failures.join('; ')}`)
}

// ── 5. Image ────────────────────────────────────────────────────────────────
async function render(template: string, size: 'square' | 'story', data: Record<string, unknown>): Promise<Uint8Array> {
  const url = Deno.env.get('SOCIAL_RENDER_URL'), secret = Deno.env.get('SOCIAL_RENDER_SECRET')
  if (!url || !secret) throw new Error('the render worker is not set up (SOCIAL_RENDER_URL / SOCIAL_RENDER_SECRET)')
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-render-secret': secret },
    body: JSON.stringify({ template, size, data }),
  })
  if (!r.ok) throw new Error(`render ${size} failed: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return new Uint8Array(await r.arrayBuffer())
}

// ── One post ────────────────────────────────────────────────────────────────
async function makePost(db: Db, businessId: string, date: string, note: string | null = null): Promise<{ id: string; status: string; error?: string }> {
  const { data: s } = await db.from('social_settings').select('*').eq('business_id', businessId).maybeSingle()
  if (!s?.enabled) throw new Error('posts are not switched on for this business')
  const lang: Lang = s.languages
  // Both languages: Hindi and English take turns on the image, day by day.
  const imageLang: 'en' | 'hi' = lang === 'both' ? (Number(date.slice(8)) % 2 ? 'hi' : 'en') : lang

  // A business with no website of its own (Sehatsandhi, 0296) is described by its profile.
  const biz = { ...await loadBusiness(db, businessId, s.focus_specialities ?? []), ...profileOf(s.profile) }
  const since = new Date(Date.parse(date) - 30 * 864e5).toISOString().slice(0, 10)
  const [{ data: cal }, { data: past }] = await Promise.all([
    db.from('social_calendar').select('id, kind, month, day, year, title_en, title_hi, specialities, angle').eq('is_active', true),
    db.from('social_posts').select('topic').eq('business_id', businessId).gte('post_date', since).neq('post_date', date),
  ])
  const recent: string[] = (past ?? []).map((p: { topic: string }) => p.topic)
  const topic = s.audience === 'doctors'
    ? pickDoctorsTopic(cal ?? [], date, recent)
    : pickTopic(cal ?? [], date, biz.specialities, recent, s.blocked_topics ?? [])

  const { data: was } = await db.from('social_posts').select('status').eq('business_id', businessId).eq('post_date', date).maybeSingle()
  if (was?.status === 'published') throw new Error('this post is already on Facebook')
  // Claim the day first so a second run does not make it twice. New words
  // need a new answer from the owner, and a new preview.
  const { data: row, error: upErr } = await db.from('social_posts').upsert({
    business_id: businessId, post_date: date, topic: topic?.title ?? 'Everyday tip', template: 'tips',
    calendar_id: topic?.calendarId ?? null, status: 'planned', error: null, image_lang: imageLang, updated_at: new Date().toISOString(),
    approval: null, approved_at: null, owner_note: note, needs_ok: !!note, preview_sent_at: null, preview_error: null, publish_error: null,
  }, { onConflict: 'business_id,post_date' }).select('id, image_url, story_url').single()
  if (upErr) throw new Error(upErr.message)

  try {
    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set')
    const anthropic = new Anthropic({ apiKey: key })
    const favourites = s.favourite_topics ?? []

    let draft = await write(anthropic, biz, date, topic, imageLang, lang, recent, favourites, [], note, s.audience)
    let problems = safetyProblems(draft)
    let writtenBy: 'claude' | 'fallback' = 'claude'
    if (problems.length) {
      draft = await write(anthropic, biz, date, topic, imageLang, lang, recent, favourites, problems, note, s.audience)
      problems = safetyProblems(draft)
      if (problems.length) { draft = fallbackDraft(biz, imageLang); writtenBy = 'fallback' }
    }

    // The picture: the business's own photo, else an AI one, else no photo design.
    let template: string = draft.template
    let photo: string | null = draft.photo_index >= 0 ? biz.photos[draft.photo_index]?.url ?? null : null
    let photoSource: 'own' | 'ai' | null = photo ? 'own' : null
    if (!photo && draft.ai_picture) {
      // Shared per topic and speciality: an eye clinic's Diabetes Day picture
      // is not a heart clinic's.
      // Every picture maker failing (daily quotas) still leaves a post: the
      // design's brand-colour backdrop.
      try { photo = await aiPicture(db, `${topic?.title ?? draft.topic} ${biz.specialities[0] ?? ''}`, draft.ai_picture) }
      catch (e) { console.warn(e instanceof Error ? e.message : e) }
      if (photo) photoSource = 'ai'
    }
    if (template === 'tips' && draft.points.length < 2) template = 'question'

    const [, mm, dd] = date.split('-').map(Number)
    const design = {
      lang: imageLang, badge: draft.badge || undefined, icon: draft.icon, headline: draft.headline,
      highlight: draft.highlight || undefined, body: draft.body || undefined,
      points: template === 'tips' ? draft.points : undefined,
      myth: template === 'fact' ? draft.myth : undefined, fact: template === 'fact' ? draft.fact : undefined,
      motif: template === 'greeting' ? draft.motif : undefined,
      dateDay: template === 'day' && topic?.dated ? String(dd) : undefined,
      dateMonth: template === 'day' && topic?.dated ? (imageLang === 'hi' ? MONTHS_HI : MONTHS_EN)[mm - 1] : undefined,
    }
    const data = { ...design, brand: biz.brand, logo: biz.logo, photo, clinic: biz.name, phone: biz.phone, website: biz.website }
    const [square, story] = await Promise.all([render(template, 'square', data), render(template, 'story', data)])

    const stamp = Date.now()
    const paths = { square: `${businessId}/${date}-${stamp}-square.png`, story: `${businessId}/${date}-${stamp}-story.png` }
    for (const [k, bytes] of [['square', square], ['story', story]] as const) {
      const { error } = await db.storage.from(BUCKET).upload(paths[k], bytes, { contentType: 'image/png', upsert: true })
      if (error) throw new Error(`storing the ${k} image: ${error.message}`)
    }
    const pub = (p: string) => db.storage.from(BUCKET).getPublicUrl(p).data.publicUrl

    const { error: saveErr } = await db.from('social_posts').update({
      topic: draft.topic, template, badge: draft.badge || null, design,
      headline_en: imageLang === 'en' ? draft.headline : null, subline_en: imageLang === 'en' ? draft.body || null : null,
      headline_hi: imageLang === 'hi' ? draft.headline : null, subline_hi: imageLang === 'hi' ? draft.body || null : null,
      caption: draft.caption, hashtags: draft.hashtags, photo_url: photo, photo_source: photoSource,
      image_url: pub(paths.square), story_url: pub(paths.story),
      status: 'ready', error: null, written_by: writtenBy, updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (saveErr) throw new Error(saveErr.message)

    // The images this remake replaced.
    const old = [row.image_url, row.story_url].filter(Boolean).map((u: string) => u.split(`/${BUCKET}/`)[1]).filter(Boolean)
    if (old.length) await db.storage.from(BUCKET).remove(old)
    return { id: row.id, status: 'ready' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('social_posts').update({ status: 'failed', error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', row.id)
    return { id: row.id, status: 'failed', error: msg }
  }
}

// ── 6. Preview, the owner's answer, and posting (0295) ──────────────────────
// 7 PM: tomorrow's post goes to the owner on WhatsApp (our number, template
// social_post_preview: the image, then OK / Change / Skip) and to the app.
// 10 AM: the day's post goes to the Page and Instagram, if the rules allow.
const PREVIEW_TEMPLATE = 'social_post_preview'
const FIRST_POSTS_NEED_OK = 7
const waNumber = (v: unknown): string | null => {
  const d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`
  if (d.length === 12 && d.startsWith('91')) return d
  return null
}
const istMinutes = () => { const t = new Date(Date.now() + 5.5 * 3600e3); return t.getUTCHours() * 60 + t.getUTCMinutes() }

/** Does this post wait for the owner's OK? */
async function needsOk(db: Db, post: { business_id: string; needs_ok: boolean }, approval: string): Promise<boolean> {
  if (post.needs_ok || approval === 'ask') return true
  if (approval === 'auto') return false
  const { count } = await db.from('social_posts').select('id', { count: 'exact', head: true })
    .eq('business_id', post.business_id).eq('status', 'published')
  return (count ?? 0) < FIRST_POSTS_NEED_OK
}

/** Where the preview goes: the owner's choice, their login phone, else the business's phone. */
async function previewPhone(db: Db, businessId: string, chosen: string | null): Promise<string | null> {
  if (waNumber(chosen)) return waNumber(chosen)
  const { data: b } = await db.from('businesses').select('phone, auth_uid').eq('id', businessId).single()
  if (b?.auth_uid) {
    const { data } = await db.auth.admin.getUserById(b.auth_uid)
    if (waNumber(data?.user?.phone)) return waNumber(data.user.phone)
  }
  return waNumber(b?.phone)
}

// deno-lint-ignore no-explicit-any
async function sendPreview(db: Db, post: any, s: any): Promise<string | null> {
  const wait = await needsOk(db, post, s.approval)
  const { data: b } = await db.from('businesses').select('name, auth_uid').eq('id', post.business_id).single()
  const rule = wait ? 'It goes out (Facebook 10 AM, Instagram 7:30 PM) only after you say OK.'
    : 'It goes out on Facebook at 10 AM and Instagram at 7:30 PM unless you say otherwise.'
  const to = await previewPhone(db, post.business_id, s.preview_phone)
  let error: string | null = null
  if (to) {
    const button = (index: number, answer: string) => ({
      type: 'button', sub_type: 'quick_reply', index, parameters: [{ type: 'payload', payload: `sp:${answer}:${post.id}` }],
    })
    const r = await graphSend({
      to, type: 'template',
      template: {
        name: PREVIEW_TEMPLATE, language: { code: 'en' },
        components: [
          { type: 'header', parameters: [{ type: 'image', image: { link: post.image_url } }] },
          { type: 'body', parameters: [b?.name ?? 'your clinic', post.topic, rule].map((text) => ({ type: 'text', text })) },
          button(0, 'ok'), button(1, 'change'), button(2, 'skip'),
        ],
      },
    })
    if (!r.ok) error = r.error ?? 'not sent'
  } else error = 'no phone number for the preview'
  // The app too, for owners who have it.
  if (b?.auth_uid) {
    await db.rpc('sehat_queue_push', {
      p_kind: 'social_preview', p_business: post.business_id, p_users: [b.auth_uid],
      p_title: "Tomorrow's post is ready", p_body: `${post.topic}. ${rule} Open Social posts on sehatsandhi.com to see it.`,
      p_data: { kind: 'social_preview', post_id: post.id },
    }).then(() => undefined, () => undefined)
  }
  await db.from('social_posts').update({
    preview_sent_at: error ? null : new Date().toISOString(), preview_to: to, preview_error: error,
  }).eq('id', post.id)
  return error
}

type Channel = 'facebook' | 'instagram' | 'both'

/** Instagram makes the media from the image URL first; publishing before it has fails (9007). */
async function igPublish(igUser: string, token: string, media: Record<string, unknown>): Promise<{ id?: string; error?: string }> {
  const c = await graph(`${igUser}/media`, token, { body: media })
  if (!c.ok) return { error: c.error }
  for (let i = 0; i < 5; i++) {
    const p = await graph(`${igUser}/media_publish`, token, { body: { creation_id: c.body.id } })
    if (p.ok) return { id: String(p.body.id) }
    if (p.code !== 9007 || i === 4) return { error: p.error }
    await new Promise((r) => setTimeout(r, 4000))
  }
  return { error: 'not ready' }
}

/**
 * The post on the Page (10 AM) or Instagram (7:30 PM, 0296), each with its
 * Story. A failed Story does not hold the post back; each part is tried again
 * on the next run only if it has no id yet.
 */
// deno-lint-ignore no-explicit-any
async function publishPost(db: Db, post: any, channel: Channel = 'both'): Promise<{ ok: boolean; error?: string }> {
  const { data: acct } = await db.from('social_accounts').select('*').eq('business_id', post.business_id).maybeSingle()
  if (!acct) return { ok: false, error: 'Facebook is not connected' }
  const { data: token } = await db.rpc('sehat_social_token', { p_business: post.business_id, p_kind: 'page' })
  if (!token) return { ok: false, error: 'Facebook is not connected' }
  const caption = [post.caption, (post.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n')
  const errors: string[] = [], notes: string[] = []
  const ids = { fb_post_id: post.fb_post_id, fb_story_id: post.fb_story_id, ig_media_id: post.ig_media_id, ig_story_id: post.ig_story_id }

  if (channel !== 'instagram') {
    if (!ids.fb_post_id) {
      const r = await graph(`${acct.page_id}/photos`, token, { body: { url: post.image_url, caption } })
      if (r.ok) ids.fb_post_id = String(r.body.post_id ?? r.body.id)
      else errors.push(`Facebook: ${r.error}`)
    }
    if (post.story_url && !ids.fb_story_id) {
      const ph = await graph(`${acct.page_id}/photos`, token, { body: { url: post.story_url, published: false } })
      const st = ph.ok ? await graph(`${acct.page_id}/photo_stories`, token, { body: { photo_id: ph.body.id } }) : ph
      if (st.ok) ids.fb_story_id = String(st.body.post_id ?? st.body.id ?? 'ok')
      else notes.push(`Facebook story: ${st.error}`)
    }
  }
  if (channel !== 'facebook' && acct.ig_user_id) {
    if (!ids.ig_media_id) {
      const r = await igPublish(acct.ig_user_id, token, { image_url: post.image_url, caption })
      if (r.id) ids.ig_media_id = r.id; else errors.push(`Instagram: ${r.error}`)
    }
    if (post.story_url && !ids.ig_story_id) {
      const r = await igPublish(acct.ig_user_id, token, { image_url: post.story_url, media_type: 'STORIES' })
      if (r.id) ids.ig_story_id = r.id; else notes.push(`Instagram story: ${r.error}`)
    }
  }

  const error = [...errors, ...notes].join('; ') || null
  const any = ids.fb_post_id || ids.ig_media_id
  await db.from('social_posts').update({
    ...ids, publish_error: error,
    ...(any ? { status: 'published', published_at: post.published_at ?? new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', post.id)
  if (error) await db.from('social_accounts').update({ last_error: error.slice(0, 500), updated_at: new Date().toISOString() }).eq('business_id', post.business_id)
  return errors.length ? { ok: false, error: errors.join('; ') } : { ok: true }
}

/** The owner's answer: OK, Skip, Change (with what to change), or Post now. */
async function decide(db: Db, postId: string, answer: string, note: string | null): Promise<Record<string, unknown>> {
  const { data: post } = await db.from('social_posts').select('*').eq('id', postId).maybeSingle()
  if (!post) return { ok: false, message: 'That post is not there any more.' }
  if (post.status === 'published') return { ok: false, message: 'This post is already on Facebook.' }
  if (post.post_date < istDate(0)) return { ok: false, message: 'That day has passed.' }
  const now = new Date().toISOString()

  if (answer === 'skip') {
    await db.from('social_posts').update({ status: 'skipped', approval: null, updated_at: now }).eq('id', postId)
    return { ok: true, message: 'Skipped. Nothing goes out that day.' }
  }
  if (answer === 'change') {
    if (!note) {
      await db.from('social_posts').update({ approval: 'change', updated_at: now }).eq('id', postId)
      return { ok: true, message: 'What should be different? Write it in one line — for example "about cataract", "in Hindi", "a different picture" — or write NEW for another topic.' }
    }
    const r = await makePost(db, post.business_id, post.post_date, /^new$/i.test(note.trim()) ? null : note)
    if (r.status !== 'ready') return { ok: false, message: `The new post could not be made: ${r.error ?? 'unknown'}` }
    const { data: fresh } = await db.from('social_posts').select('*').eq('id', r.id).single()
    const { data: s } = await db.from('social_settings').select('*').eq('business_id', post.business_id).single()
    const err = await sendPreview(db, fresh, s)
    return { ok: true, message: err ? `The new post is ready in Social posts (the preview could not be sent: ${err}).` : 'Here is the new one.' }
  }
  if (post.status !== 'ready' && post.status !== 'skipped') return { ok: false, message: 'This post is not ready yet.' }
  await db.from('social_posts').update({ status: 'ready', approval: 'ok', approved_at: now, updated_at: now }).eq('id', postId)
  // "Post now", or OK on the day itself after its time: what is due goes out
  // straight away (Facebook after 10 AM; Instagram too after 7:30 PM).
  const late = post.post_date === istDate(0) ? (istMinutes() >= 19 * 60 + 30 ? 'both' : istMinutes() >= 10 * 60 ? 'facebook' : null) : null
  if (answer === 'post' || late) {
    const r = await publishPost(db, { ...post, status: 'ready' }, answer === 'post' ? 'both' : late!)
    return r.ok ? { ok: true, message: answer === 'post' || late === 'both' ? 'Posted on Facebook and Instagram.' : 'Posted on Facebook; Instagram follows at 7:30 PM.' }
      : { ok: false, message: `Not posted: ${r.error}` }
  }
  return { ok: true, message: 'OK — Facebook at 10 AM, Instagram at 7:30 PM.' }
}

/** Creates social_post_preview in one WhatsApp account: an image header needs a sample image uploaded first. */
async function createPreviewTemplate(wabaId: string): Promise<Record<string, unknown>> {
  const token = Deno.env.get('META_ACCESS_TOKEN')
  if (!token) return { ok: false, error: 'META_ACCESS_TOKEN not set' }
  const sample = await fetch('https://www.sehatsandhi.com/logo.png')
  if (!sample.ok) return { ok: false, error: `sample image: ${sample.status}` }
  const bytes = new Uint8Array(await sample.arrayBuffer())
  const start = await fetch(`${GRAPH}/${APP_ID}/uploads?file_name=sample.png&file_length=${bytes.length}&file_type=image/png&access_token=${encodeURIComponent(token)}`, { method: 'POST' })
  const sb = await start.json().catch(() => ({}))
  if (!sb?.id) return { ok: false, error: `upload start: ${JSON.stringify(sb).slice(0, 200)}` }
  const up = await fetch(`${GRAPH}/${sb.id}`, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_offset: '0' }, body: bytes })
  const ub = await up.json().catch(() => ({}))
  if (!ub?.h) return { ok: false, error: `upload: ${JSON.stringify(ub).slice(0, 200)}` }
  const r = await graph(`${wabaId}/message_templates`, token, {
    body: {
      name: PREVIEW_TEMPLATE, language: 'en', category: 'UTILITY',
      components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [ub.h] } },
        {
          type: 'BODY',
          text: "Tomorrow's social media post for {{1}} is ready: {{2}}.\n\n{{3}}\n\nTap OK to post it, Change for a different one, or Skip for no post that day.",
          example: { body_text: [['SN Eye Hospital', 'Winter dry eyes', 'It goes out at 10 AM unless you say otherwise.']] },
        },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'OK' }, { type: 'QUICK_REPLY', text: 'Change' }, { type: 'QUICK_REPLY', text: 'Skip' }] },
      ],
    },
  })
  return r.ok ? { ok: true, template: r.body } : { ok: false, error: r.error }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const who = caller(req)
  if (!who) return json({ error: 'Sign in first.' }, 401)
  let body: {
    action?: string; businessId?: string; date?: string; topic?: string; scene?: string; maker?: string; cfModel?: string
    note?: string; postId?: string; answer?: string; from?: string; wabaId?: string; channel?: string
  }
  try { body = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const db = who.asService

  if (body.action === 'plan') {
    if (!who.isServiceRole) return json({ error: 'Not allowed.' }, 403)
    const date = istDate(1)
    const { data: on } = await db.from('social_settings').select('business_id').eq('enabled', true).eq('paused', false)
    const { data: done } = await db.from('social_posts').select('business_id').eq('post_date', date).in('status', ['ready', 'skipped'])
    const skip = new Set((done ?? []).map((r: { business_id: string }) => r.business_id))
    // One at a time: each post is a Claude call and two renders. Enough for the
    // pilot; many businesses will need a queue (stage 5).
    const results = []
    for (const r of on ?? []) {
      if (skip.has(r.business_id)) continue
      try { results.push({ business: r.business_id, ...(await makePost(db, r.business_id, date)) }) }
      catch (e) { results.push({ business: r.business_id, status: 'failed', error: e instanceof Error ? e.message : String(e) }) }
    }
    return json({ date, results })
  }

  // Admin's check that the picture model works: one picture for a described
  // scene, kept in the shared library like any other.
  if (body.action === 'picture') {
    if (!who.isServiceRole) return json({ error: 'Not allowed.' }, 403)
    const { topic, scene, maker, cfModel } = body as { topic?: string; scene?: string; maker?: string; cfModel?: string }
    if (!topic || !scene) return json({ error: 'topic and scene are required' }, 400)
    // Trying another Cloudflare model: made and stored, not added to the library.
    if (cfModel) {
      if (!/^@cf\/[a-z0-9-]+\/[a-z0-9.-]+$/.test(cfModel)) return json({ error: 'bad model' }, 400)
      try {
        const t0 = Date.now()
        const got = await cloudflarePicture(cfModel, `${scene}. Photorealistic photograph, warm natural light, Indian people. No text, no letters, no logos, no watermark.`)
        const path = `ai/compare/${topicKey(topic)}-${cfModel.split('/').pop()}-${Date.now()}.jpg`
        const { error } = await db.storage.from(BUCKET).upload(path, got.bytes, { contentType: got.type })
        if (error) throw new Error(error.message)
        return json({ url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, ms: Date.now() - t0 })
      } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400) }
    }
    try { return json({ url: await aiPicture(db, topic, scene, maker) }) }
    catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400) }
  }

  if (body.action === 'preview') {
    if (!who.isServiceRole) return json({ error: 'Not allowed.' }, 403)
    const date = istDate(1)
    const { data: on } = await db.from('social_settings').select('*').eq('enabled', true).eq('paused', false).neq('approval', 'auto')
    const results = []
    for (const s of on ?? []) {
      const { data: post } = await db.from('social_posts').select('*')
        .eq('business_id', s.business_id).eq('post_date', date).eq('status', 'ready').is('preview_sent_at', null).maybeSingle()
      if (post) results.push({ business: s.business_id, error: await sendPreview(db, post, s) })
    }
    return json({ date, results })
  }

  if (body.action === 'publish') {
    if (!who.isServiceRole) return json({ error: 'Not allowed.' }, 403)
    // 0296: 'facebook' at 10 AM, 'instagram' at 7:30 PM; nothing given = both.
    const channel: Channel = body.channel === 'facebook' || body.channel === 'instagram' ? body.channel : 'both'
    const date = istDate(0)
    const { data: on } = await db.from('social_settings').select('*').eq('enabled', true).eq('paused', false)
    const results = []
    for (const s of on ?? []) {
      const { data: post } = await db.from('social_posts').select('*')
        .eq('business_id', s.business_id).eq('post_date', date).in('status', ['ready', 'published']).maybeSingle()
      if (!post) continue
      // Instagram's run: already on Instagram, nothing to do.
      if (channel === 'instagram' && post.ig_media_id) continue
      if (channel === 'facebook' && post.fb_post_id) continue
      // In 'preview', no answer counts as yes only once the owner was asked.
      // Already on Facebook means it was allowed.
      const go = post.status === 'published' || post.approval === 'ok' ||
        (!(await needsOk(db, post, s.approval)) && (s.approval === 'auto' || !!post.preview_sent_at))
      if (!go) {
        await db.from('social_posts').update({ publish_error: 'Waiting for your OK' }).eq('id', post.id)
        results.push({ business: s.business_id, status: 'waiting for OK' })
        continue
      }
      results.push({ business: s.business_id, ...(await publishPost(db, post, channel)) })
    }
    return json({ date, results })
  }

  if (body.action === 'decide') {
    const postId = body.postId ?? '', answer = body.answer ?? ''
    if (!postId || !['ok', 'skip', 'change', 'post'].includes(answer)) return json({ error: 'postId and answer required' }, 400)
    const { data: post } = await db.from('social_posts').select('business_id, preview_to').eq('id', postId).maybeSingle()
    if (!post) return json({ ok: false, message: 'That post is not there any more.' }, 404)
    if (who.isServiceRole) {
      // From WhatsApp: only the number the preview went to may answer.
      if (body.from !== undefined && waNumber(body.from) !== post.preview_to) return json({ ok: false, message: 'Not your post.' }, 403)
    } else {
      const { data: owner } = await who.asCaller.rpc('sehat_caller_is_owner', { p_business: post.business_id })
      if (!owner) return json({ error: 'Only the owner can answer.' }, 403)
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null
    try { return json(await decide(db, postId, answer, note)) }
    catch (e) { return json({ ok: false, message: e instanceof Error ? e.message : String(e) }, 400) }
  }

  if (body.action === 'preview-template') {
    if (!who.isServiceRole) return json({ error: 'Not allowed.' }, 403)
    if (!body.wabaId || !/^\d+$/.test(body.wabaId)) return json({ error: 'wabaId required' }, 400)
    return json(await createPreviewTemplate(body.wabaId))
  }

  if (body.action === 'make') {
    const id = body.businessId
    if (!id) return json({ error: 'Which business?' }, 400)
    if (!who.isServiceRole) {
      const [{ data: owner }, { data: admin }] = await Promise.all([
        who.asCaller.rpc('sehat_caller_is_owner', { p_business: id }),
        who.asCaller.rpc('sehat_is_admin'),
      ])
      if (!owner && !admin) return json({ error: 'Only the owner can make posts.' }, 403)
    }
    const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : istDate(1)
    if (date < istDate(0)) return json({ error: 'That day has passed.' }, 400)
    // Two minutes before a post still being made can be started again: each
    // one is a paid Claude call.
    const { data: last } = await db.from('social_posts').select('updated_at, status').eq('business_id', id).eq('post_date', date).maybeSingle()
    if (last && last.status === 'planned' && Date.now() - Date.parse(last.updated_at) < 120e3) {
      return json({ error: 'This post is already being made. Wait a minute.' }, 409)
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null
    try { return json(await makePost(db, id, date, note)) }
    catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400) }
  }

  return json({ error: 'Unknown action.' }, 400)
})
