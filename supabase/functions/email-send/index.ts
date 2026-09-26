// email-send — drain email_outbox (0125).
//
// Called every two minutes by the drain-email-outbox cron, with the service-role
// key from Vault. Picks up rows at least a minute old — the listing's doctors and
// plan choice are written just after the listing itself — reads the business
// fresh, writes the email, and sends it through _shared/email.ts.
//
//   business_welcome     → the business's own address
//   admin_new_business   → ADMIN_EMAIL (admin@sehatsandhi.com)
//   clinic_new_booking   → the business's address, and the doctor's if different (0136)
//
// Until ZEPTOMAIL_TOKEN is set nothing is sent and rows wait. A welcome still
// waiting after two days is skipped rather than sent late; the admin alert is
// sent however late, because admin still needs to know.
//
// Request: {} — service-role auth required.  Response: { ok, sent, failed, waiting }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, ZEPTOMAIL_TOKEN

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { ADMIN_EMAIL, type Email, emailConfigured, esc, layout, sendEmail, type SendResult } from '../_shared/email.ts'

const BATCH = 20
const MAX_ATTEMPTS = 5
const WELCOME_STALE_MS = 2 * 24 * 60 * 60 * 1000

const TYPE_LABEL: Record<string, string> = {
  clinic: 'Clinic', hospital: 'Hospital', lab: 'Diagnostic lab', pharmacy: 'Pharmacy',
  insurance: 'Health insurance', ambulance: 'Ambulance service',
}
const typeLabel = (v: string | null) => (v && TYPE_LABEL[v]) || (v ? v[0].toUpperCase() + v.slice(1) : 'Business')

interface Biz {
  id: string; name: string; vertical: string | null; phone: string | null; email: string | null
  address: string | null; own_city: string | null; own_district: string | null; own_state: string | null
  own_pin_code: string | null; pin_codes: string[] | null; status: string | null; months_paid: number | null; category: string | null
  renewal_term_months: number | null; renewal_whatsapp: boolean | null; created_at: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${serviceKey}`) return json({ error: 'unauthorised' }, 401)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
  const site = (Deno.env.get('SITE_URL') ?? 'https://sehatsandhi.com').replace(/\/$/, '')

  // A run that died mid-send leaves its row at 'sending'. Ten minutes on, put it
  // back; the attempt count still caps how often that can happen.
  await db.from('email_outbox').update({ status: 'pending' })
    .eq('status', 'sending').lte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())

  const cutoff = new Date(Date.now() - 60_000).toISOString()
  const { data: rows, error } = await db.from('email_outbox')
    .select('id, kind, business_id, appointment_id, attempts, created_at')
    .eq('status', 'pending').lte('created_at', cutoff)
    .order('created_at').limit(BATCH)
  if (error) return json({ error: error.message }, 500)

  if (!emailConfigured()) {
    return json({ ok: true, sent: 0, failed: 0, waiting: rows?.length ?? 0, note: 'ZEPTOMAIL_TOKEN not set' })
  }

  let sent = 0, failed = 0
  for (const r of rows ?? []) {
    // Claim it, conditional on still being pending, so overlapping runs cannot
    // both send the same row.
    const { data: claimed } = await db.from('email_outbox')
      .update({ status: 'sending', attempts: r.attempts + 1 })
      .eq('id', r.id).eq('status', 'pending').select('id')
    if (!claimed?.length) continue

    const finish = (patch: Record<string, unknown>) => db.from('email_outbox').update(patch).eq('id', r.id)

    if (r.kind === 'business_welcome' && Date.now() - Date.parse(r.created_at) > WELCOME_STALE_MS) {
      await finish({ status: 'skipped', last_error: 'welcome older than two days' })
      continue
    }

    if (r.kind === 'clinic_new_booking') {
      const res = await sendBooking(db, r.appointment_id, site)
      if (res === 'skip') { await finish({ status: 'skipped', last_error: 'appointment gone or no address' }); continue }
      if (res.ok) { await finish({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }); sent++ }
      else {
        const giveUp = !res.retry || r.attempts + 1 >= MAX_ATTEMPTS
        await finish({ status: giveUp ? 'failed' : 'pending', last_error: res.error }); failed++
      }
      continue
    }

    const { data: b } = await db.from('businesses')
      .select('id, name, vertical, phone, email, address, own_city, own_district, own_state, own_pin_code, pin_codes, status, months_paid, category, renewal_term_months, renewal_whatsapp, created_at')
      .eq('id', r.business_id).maybeSingle()
    if (!b) { await finish({ status: 'skipped', last_error: 'business no longer exists' }); continue }

    const { data: docs } = await db.from('business_practitioners')
      .select('practitioners(full_name)').eq('business_id', b.id)
    // One practitioner per link, though the client types it as either shape.
    const doctors = ((docs ?? []) as unknown as { practitioners: { full_name: string | null } | { full_name: string | null }[] | null }[])
      .flatMap(d => [d.practitioners ?? []].flat().map(p => p.full_name))
      .filter(Boolean) as string[]

    const email = r.kind === 'business_welcome' ? welcome(b as Biz, site) : adminAlert(b as Biz, doctors)
    if (!email) { await finish({ status: 'skipped', last_error: 'no address' }); continue }

    const res = await sendEmail(email)
    if (res.ok) {
      await finish({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
      sent++
    } else {
      const giveUp = !res.retry || r.attempts + 1 >= MAX_ATTEMPTS
      await finish({ status: giveUp ? 'failed' : 'pending', last_error: res.error })
      failed++
    }
  }

  return json({ ok: true, sent, failed, waiting: 0 })
})

function place(b: Biz): string {
  return [b.own_city, b.own_district, b.own_state].filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i).join(', ') + (b.own_pin_code ? ` ${b.own_pin_code}` : '')
}

function welcome(b: Biz, site: string): Email | null {
  const to = (b.email ?? '').trim()
  if (!to.includes('@')) return null
  const login = `${site}/business/login`
  const live = b.status === 'active'

  const steps = [
    'Our team checks your details, usually within one working day. We may call or WhatsApp you on the number you registered with.',
    `Log in any time at <a href="${login}" style="color:#0f6b4a">${login.replace(/^https?:\/\//, '')}</a> with <b>${esc(to)}</b>. Choose "Email me a code" — no password needed.`,
    live
      ? 'Your listing is live. Your invoice is in your dashboard under Plan.'
      : 'Your listing goes live once it is paid or approved by our team. If your plan has a monthly fee, please pay from the dashboard within 7 days — after that the dashboard opens only to the payment screen until it is paid.',
    'Add your doctors, timings and fees from the dashboard so patients see the right details.',
  ]

  const html = layout(`Welcome to Sehatsandhi, ${b.name}`, `
<p style="margin:0 0 14px">Thank you for registering <b>${esc(b.name)}</b> (${esc(typeLabel(b.vertical))}${place(b) ? `, ${esc(place(b))}` : ''}). Here is what happens next:</p>
<ol style="margin:0 0 18px;padding-left:20px">${steps.map(s => `<li style="margin-bottom:8px">${s}</li>`).join('')}</ol>
<p style="margin:0 0 18px"><a href="${login}" style="display:inline-block;background:#0f6b4a;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:bold">Log in to your dashboard</a></p>
<p style="margin:0;color:#5b6b63;font-size:13px">If you did not register on Sehatsandhi, reply to this email and we will remove the listing.</p>`)

  const text = [
    `Welcome to Sehatsandhi, ${b.name}`, '',
    `Thank you for registering ${b.name} (${typeLabel(b.vertical)}${place(b) ? `, ${place(b)}` : ''}). What happens next:`, '',
    ...steps.map((s, i) => `${i + 1}. ${s.replace(/<[^>]+>/g, '')}`), '',
    `Log in: ${login}`, '',
    'If you did not register on Sehatsandhi, reply to this email and we will remove the listing.',
  ].join('\n')

  return { to, toName: b.name, subject: `Welcome to Sehatsandhi — ${b.name} is registered`, html, text }
}

function adminAlert(b: Biz, doctors: string[]): Email {
  const rows: [string, string][] = [
    ['Business', b.name],
    ['Type', typeLabel(b.vertical)],
    ['Category', b.category || '—'],
    ['Place', place(b) || '—'],
    ['Address', b.address || '—'],
    ['Phone', b.phone || '—'],
    ['Email', b.email || '— (no welcome email sent)'],
    ['Doctors', doctors.length ? doctors.join(', ') : '—'],
    ['Areas served', `${b.pin_codes?.length ?? 0} PIN code${(b.pin_codes?.length ?? 0) === 1 ? '' : 's'}`],
    ['Plan chosen', b.renewal_term_months ? `${b.renewal_term_months} month${b.renewal_term_months === 1 ? '' : 's'}${b.renewal_whatsapp ? ' + WhatsApp' : ''}` : '—'],
    ['Paid', (b.months_paid ?? 0) > 0 ? `Yes, ${b.months_paid} month(s)` : 'Not yet'],
    ['Status', b.status || '—'],
    ['Registered', new Date(b.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
  ]
  const html = layout(`New registration: ${b.name}`, `
<table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#5b6b63;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #eef2ef">${esc(v)}</td></tr>`).join('')}
</table>
<p style="margin:16px 0 0;color:#5b6b63;font-size:13px">Review it in the admin panel → Pending.</p>`)
  const text = [`New registration: ${b.name}`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', 'Review it in the admin panel → Pending.'].join('\n')
  return { to: ADMIN_EMAIL, toName: 'Sehatsandhi Admin', subject: `New ${typeLabel(b.vertical).toLowerCase()} registered: ${b.name}${b.own_city ? `, ${b.own_city}` : ''}`, html, text }
}

// A new booking (0136): to the clinic, and to the doctor when they have their
// own address. Until WhatsApp works this is how a clinic hears about a bot
// booking without keeping the dashboard open.
// deno-lint-ignore no-explicit-any
async function sendBooking(db: any, appointmentId: string | null, site: string): Promise<SendResult | 'skip'> {
  if (!appointmentId) return 'skip'
  const { data: a } = await db.from('appointments')
    .select('id, business_id, practitioner_id, slot_datetime, patient_name, patient_phone, patient_age, booked_via, status')
    .eq('id', appointmentId).maybeSingle()
  if (!a || !['booked', 'confirmed'].includes(a.status)) return 'skip'
  const { data: b } = await db.from('businesses').select('name, email').eq('id', a.business_id).maybeSingle()
  const { data: p } = a.practitioner_id
    ? await db.from('practitioners').select('full_name, email').eq('id', a.practitioner_id).maybeSingle()
    : { data: null }
  const to = [b?.email, p?.email].map(e => (e ?? '').trim().toLowerCase()).filter(e => e.includes('@'))
  const recipients = Array.from(new Set(to))
  if (!recipients.length) return 'skip'

  const when = new Date(a.slot_datetime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  const via = a.booked_via === 'whatsapp_bot' ? 'WhatsApp' : a.booked_via === 'website' ? 'the website' : (a.booked_via ?? 'Sehatsandhi')
  const rows: [string, string][] = [
    ['When', when],
    ['Patient', `${a.patient_name ?? '—'}${a.patient_age ? `, ${a.patient_age}y` : ''}`],
    ['Mobile', a.patient_phone ?? '—'],
    ['Doctor', p?.full_name ?? 'Any doctor'],
    ['Booked via', via],
  ]
  const dash = `${site}/business/dashboard`
  const html = layout(`New appointment: ${when}`, `
<table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#5b6b63;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #eef2ef">${esc(v)}</td></tr>`).join('')}
</table>
<p style="margin:16px 0 0"><a href="${dash}" style="display:inline-block;background:#0f6b4a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">Open your dashboard</a></p>
<p style="margin:12px 0 0;color:#5b6b63;font-size:13px">Please call the patient if the time does not work. WhatsApp confirmations to patients are not switched on yet.</p>`)
  const text = [`New appointment at ${b?.name ?? 'your clinic'}`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Dashboard: ${dash}`].join('\n')

  let last: SendResult = { ok: true }
  for (const addr of recipients) {
    last = await sendEmail({ to: addr, toName: b?.name ?? undefined, subject: `New appointment — ${a.patient_name ?? 'patient'}, ${when}`, html, text })
    if (!last.ok) return last
  }
  return last
}
