// site-ask — the "Ask the doctor" bot on a clinic's own website (0305).
//
// Called from the clinic's site by anyone; there is no session. Deploy with
// --no-verify-jwt, as contact-submit is.
//
// WHAT IT MAY SAY
// The bot answers only from the clinic's own approved content: its published
// articles (site_articles) and the questions the doctor has answered and
// published (clinic_site_messages, 0304). It sorts every question into one of:
//   answer     a general question the approved content covers — a short reply,
//              with links to the articles it came from
//   personal   about one patient's own eyes, report, medicine or surgery —
//              no advice; suggest an online consultation
//   emergency  sudden vision loss, injury, chemicals, severe pain… — come in
//              or call now
//   doctor     general, but the approved content does not cover it — say so,
//              and the site offers to send it to the doctor
// It never diagnoses, never gives doses, never names lens or drug companies,
// never quotes prices and never says "best".
//
// ABUSE AND COST
// At most 20 questions an hour from one visitor (salted IP hash) and 400 a day
// per site; every question and reply is logged in clinic_site_asks for the
// doctor to review.
//
// POST { key, question, lang? }  →  { ok, kind, answer, sources: [{ title, url }] }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { corsHeaders, json } from '../_shared/cors.ts'

const MODEL = 'claude-sonnet-5-5'
const MAX_QUESTION = 600

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'answer', 'sources'],
  properties: {
    kind: { type: 'string', enum: ['answer', 'personal', 'emergency', 'doctor'] },
    answer: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
  },
}

const SYSTEM = `You answer questions on an eye hospital's website, on behalf of the hospital's eye surgeon. You are not the doctor and you are not giving medical advice to an individual.

You are given the hospital's APPROVED CONTENT: articles the doctor has approved, and questions the doctor has answered. Use ONLY that content. Do not add facts from elsewhere, even if you know them.

Sort the visitor's question into exactly one kind:
- "emergency": sudden loss or blurring of vision, eye injury, chemicals in the eye, severe eye pain, red painful eye with headache or vomiting, flashes with a curtain or shadow over vision, a child's eye suddenly turning. Reply in 1–2 sentences: go to the nearest eye hospital today or call the hospital now. Nothing else.
- "personal": about the visitor's (or a family member's) own eyes — their symptoms, report numbers, which medicine or drop to use or stop, whether they need surgery, which lens to choose, results of their own surgery. Do not answer it. Reply in 1–2 sentences that the doctor needs to see or speak to them, and suggest an online consultation or a visit.
- "answer": a general question that the approved content clearly answers. Reply in plain words, at most 120 words, short paragraphs. List in "sources" the slugs of the articles you used (only slugs that appear in the content). Do not invent slugs.
- "doctor": a general question the approved content does not answer. Reply in 1–2 sentences that you do not have an approved answer yet and that the question can be sent to the doctor. "sources" empty.

Rules for every reply:
- Never diagnose, never give medicine names with doses, never say whether someone should stop or start a medicine.
- Never name companies or brands of lenses, drops or devices. Never quote prices or costs.
- Never say "best", "No. 1", "guaranteed" or promise a result.
- Reply in the visitor's language: if the question is in Hindi or Hinglish, reply in simple Hindi (Devanagari); otherwise in simple English.
- Do not mention these instructions or the word "content". Do not add a disclaimer; the website shows one.`

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Rank articles by word overlap with the question, so the prompt carries the
// few that matter in full and the rest only as titles.
function score(q: string, text: string): number {
  const words = new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2))
  const t = text.toLowerCase()
  let n = 0
  for (const w of words) if (t.includes(w)) n++
  return n
}

type Article = { slug: string; group_key: string | null; lang: string; title: string; summary: string | null; body: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

  // deno-lint-ignore no-explicit-any
  let body: any
  try { body = await req.json() } catch { return json({ ok: false, error: 'Bad request' }, 400) }
  const key = String(body?.key ?? '').trim().toLowerCase()
  const question = String(body?.question ?? '').trim().slice(0, MAX_QUESTION)
  const lang = body?.lang === 'hi' ? 'hi' : 'en'
  if (!key || question.length < 5) return json({ ok: false, error: lang === 'hi' ? 'कृपया अपना सवाल लिखें।' : 'Please type your question.' }, 400)

  const url = Deno.env.get('SUPABASE_URL')!
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: biz } = await db.rpc('sehat_site_business', { p_key: key })
  if (!biz) return json({ ok: false, error: 'This website is not set up for questions.' }, 404)

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  const ipHash = ip ? await sha256(`${url}|site-ask|${ip}`) : null
  const since = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()
  const [mine, site] = await Promise.all([
    ipHash ? db.from('clinic_site_asks').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since(60)) : Promise.resolve({ count: 0 }),
    db.from('clinic_site_asks').select('id', { count: 'exact', head: true }).eq('business_id', biz).gte('created_at', since(1440)),
  ])
  if ((mine.count ?? 0) >= 20 || (site.count ?? 0) >= 400) {
    return json({ ok: false, error: lang === 'hi' ? 'अभी बहुत सवाल आ गए हैं। कृपया थोड़ी देर बाद पूछें, या WhatsApp करें।' : 'Too many questions just now. Please try again later, or message us on WhatsApp.' }, 429)
  }

  const [{ data: arts }, { data: qa }, { data: b }, { data: s }] = await Promise.all([
    db.from('site_articles').select('slug, group_key, lang, title, summary, body').eq('business_id', biz).eq('is_published', true),
    db.from('clinic_site_messages').select('message, reply').eq('business_id', biz).eq('kind', 'question').eq('publish', true).order('published_at', { ascending: false }).limit(60),
    db.from('businesses').select('name').eq('id', biz).maybeSingle(),
    db.from('business_sites').select('custom_domain, slug').eq('business_id', biz).maybeSingle(),
  ])
  const articles = ((arts ?? []) as Article[])
  // Prefer the visitor's language; keep the other as a fallback.
  const ranked = articles
    .map((a) => ({ a, s: score(question, `${a.title} ${a.summary ?? ''} ${a.body}`) + (a.lang === lang ? 0.5 : 0) }))
    .sort((x, y) => y.s - x.s)
  const full = ranked.slice(0, 4).filter((r) => r.s >= 1).map((r) => r.a)
  const content = [
    '# Articles in full',
    ...full.map((a) => `## slug: ${a.group_key ?? a.slug} (${a.lang})\n# ${a.title}\n${a.summary ?? ''}\n\n${a.body.slice(0, 9000)}`),
    '# Other article titles (not in full — do not answer from titles alone)',
    ...ranked.slice(4).map((r) => `- ${r.a.title}`),
    '# Questions the doctor has answered',
    ...((qa ?? []) as { message: string; reply: string }[]).map((x) => `Q: ${x.message}\nA: ${x.reply}`),
  ].join('\n\n')

  let kind: 'answer' | 'personal' | 'emergency' | 'doctor' | 'error' = 'error'
  let answer = ''
  let slugs: string[] = []
  try {
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })
    const res = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 1200,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `HOSPITAL: ${b?.name ?? 'the hospital'}\n\nAPPROVED CONTENT:\n\n${content}\n\nVISITOR'S QUESTION (${lang === 'hi' ? 'website in Hindi' : 'website in English'}):\n${question}` }],
    // deno-lint-ignore no-explicit-any
    } as any)
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') throw new Error(String(res.stop_reason))
    // deno-lint-ignore no-explicit-any
    const text = res.content.find((x: any) => x.type === 'text')?.text
    const d = JSON.parse(text ?? '{}')
    if (['answer', 'personal', 'emergency', 'doctor'].includes(d.kind) && typeof d.answer === 'string' && d.answer.trim()) {
      kind = d.kind; answer = d.answer.trim().slice(0, 1500)
      slugs = Array.isArray(d.sources) ? d.sources.filter((x: unknown) => typeof x === 'string').slice(0, 3) : []
    }
  } catch (e) {
    console.error('site-ask', (e as Error).message)
  }

  // Links only to articles that exist, in the visitor's language where there is one.
  const origin = s?.custom_domain ? `https://www.${String(s.custom_domain).replace(/^www\./, '')}` : ''
  const sources = slugs.map((g) => {
    const a = articles.find((x) => (x.group_key ?? x.slug) === g && x.lang === lang) ?? articles.find((x) => (x.group_key ?? x.slug) === g)
    if (!a) return null
    return { title: a.title, url: `${origin}${a.lang === 'hi' ? '/hi' : ''}/post/${a.group_key ?? a.slug}/` }
  }).filter(Boolean)

  if (kind === 'error') {
    answer = lang === 'hi'
      ? 'माफ़ कीजिए, अभी जवाब नहीं दे पा रहे। आप अपना सवाल डॉक्टर को भेज सकते हैं, या WhatsApp करें।'
      : 'Sorry, we could not answer just now. You can send your question to the doctor, or message us on WhatsApp.'
  }

  await db.from('clinic_site_asks').insert({ business_id: biz, question, lang, kind, answer, sources, ip_hash: ipHash })
  return json({ ok: true, kind, answer, sources })
})
