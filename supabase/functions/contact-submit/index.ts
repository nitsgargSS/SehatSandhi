// The Contact Us form (0165): keep the inquiry, then email it to us.
//
// Called from the public Contact page by anyone — there is no session. Deploy
// with --no-verify-jwt, as record-visitor-location is.
//
// ORDER MATTERS
// The row is written before the email is tried. An inquiry must survive a mail
// outage: if ZeptoMail refuses, the row keeps email_error and the visitor is
// still told we have it, because we do.
//
// ABUSE
// A public form that sends email is a spam relay if left open. So:
//   • a honeypot field ("website") that people never see and bots fill in —
//     answered with a normal success and nothing stored;
//   • at most 3 inquiries per sender IP in 10 minutes and 10 in a day, counted
//     on a salted hash of the IP (x-forwarded-for), never the address itself;
//   • everything user-supplied is escaped into the email, and the subject
//     carries only the topic and the name.
//
// POST { name, phone?, email?, topic, message, page?, lang?, website? }
//   → { ok: true }                    stored (and emailed, or queued to retry by hand)
//   → { ok: false, error: string }    400 on bad input, 429 when rate-limited

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { esc, layout, sendEmail } from '../_shared/email.ts'

const CONTACT_TO = Deno.env.get('CONTACT_TO') ?? 'contact@sehatsandhi.com'

const TOPICS: Record<string, string> = {
  booking: 'Booking an appointment',
  listing: 'Listing a clinic or business',
  partner: 'Joining as a pharmacy / ambulance service / insurance advisor',
  // 0194: a patient's problem with a medicine order, ambulance or insurance request.
  request: 'Medicine order, ambulance or insurance request',
  billing: 'Billing, refund or cancellation',
  listing_change: 'Correcting or removing a listing',
  // 0174: also files a privacy request (trigger on contact_inquiries), which
  // the admin "Privacy" tab works to the 24-hour / 15-day deadlines.
  privacy: 'Privacy request — personal data',
  other: 'Something else',
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** 10-digit Indian mobile, with or without +91 / 0 → 91XXXXXXXXXX, else null. */
function normalisePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '').replace(/^0+/, '')
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null
}

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ ok: false, error: 'Could not read the form.' }, 400) }

  // Bots fill every field. Look successful, store nothing.
  if (clean(body.website, 200)) return json({ ok: true })

  const name = clean(body.name, 100)
  const phoneRaw = clean(body.phone, 20)
  const email = clean(body.email, 200).toLowerCase()
  const topic = TOPICS[clean(body.topic, 30)] ? clean(body.topic, 30) : 'other'
  // Keep the visitor's line breaks in the message itself.
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 3000) : ''
  const page = clean(body.page, 200) || null
  const lang = clean(body.lang, 5) || null

  const phone = phoneRaw ? normalisePhone(phoneRaw) : null
  if (name.length < 2) return json({ ok: false, error: 'Please tell us your name.' }, 400)
  if (phoneRaw && !phone) return json({ ok: false, error: 'Please give a 10-digit Indian mobile number.' }, 400)
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'That email address does not look right.' }, 400)
  if (!phone && !email) return json({ ok: false, error: 'Please give a mobile number or an email so we can reply.' }, 400)
  if (message.length < 5) return json({ ok: false, error: 'Please write a few words about what you need.' }, 400)

  const url = Deno.env.get('SUPABASE_URL')!
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  const ipHash = ip ? await sha256(`${url}|contact|${ip}`) : null
  if (ipHash) {
    const since = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()
    const [recent, today] = await Promise.all([
      db.from('contact_inquiries').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since(10)),
      db.from('contact_inquiries').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since(1440)),
    ])
    if ((recent.count ?? 0) >= 3 || (today.count ?? 0) >= 10) {
      return json({ ok: false, error: 'We have already received several messages from you. We will reply soon — or message us on WhatsApp.' }, 429)
    }
  }

  const { data: row, error: insErr } = await db.from('contact_inquiries')
    .insert({ name, phone, email: email || null, topic, message, page, lang, ip_hash: ipHash })
    .select('id, created_at').single()
  if (insErr || !row) {
    console.error('contact-submit insert', insErr?.message)
    return json({ ok: false, error: 'We could not send your message just now. Please try again, or message us on WhatsApp.' }, 500)
  }

  const when = new Date(row.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  const rows: [string, string][] = [
    ['Name', name],
    ['Mobile', phone ? `+${phone}` : '—'],
    ['Email', email || '—'],
    ['About', TOPICS[topic]],
    ['Received', `${when} IST`],
    ...(page ? [['Page', page] as [string, string]] : []),
  ]
  const html = layout(`New inquiry: ${TOPICS[topic]}`, `
<table style="border-collapse:collapse;margin:0 0 16px;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#5b6b63">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('\n')}
</table>
<div style="white-space:pre-wrap;background:#f6f4ee;border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.55">${esc(message)}</div>
<p style="margin:16px 0 0;color:#5b6b63;font-size:12.5px">${email ? 'Reply to this email to answer them directly.' : 'No email given — reply on their mobile.'} Inquiry ${esc(row.id)}.</p>`)
  const text = [...rows.map(([k, v]) => `${k}: ${v}`), '', message, '', `Inquiry ${row.id}`].join('\n')

  const sent = await sendEmail({
    to: CONTACT_TO, toName: 'Sehatsandhi',
    subject: `Contact form — ${TOPICS[topic]} — ${name}`.slice(0, 150),
    html, text,
    ...(email ? { replyTo: email, replyToName: name } : {}),
  })
  await db.from('contact_inquiries')
    .update(sent.ok ? { emailed_at: new Date().toISOString() } : { email_error: sent.error.slice(0, 300) })
    .eq('id', row.id)
  if (!sent.ok) console.error('contact-submit email', sent.error)

  // Stored either way, so the visitor is told the truth: we have it.
  return json({ ok: true })
})
