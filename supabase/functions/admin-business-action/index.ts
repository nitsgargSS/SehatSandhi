// admin-business-action — disable or delete a business, confirmed by an emailed code (0144).
//
// Two steps, both from the admin panel with the admin's own session:
//
//   { op: 'request', businessId, action: 'disable' | 'delete', reason }
//       Checks the caller is an admin and the action is allowed, then emails a
//       six-digit code to that admin's own address with the full detail: which
//       business, why, who asked, and for a delete what goes with it.
//       → { requestId, sentTo, expiresAt }
//
//   { op: 'confirm', requestId, code }
//       Same admin, within 10 minutes, at most 5 tries. Does the action, records
//       the outcome in admin_business_actions, and emails a receipt to the admin
//       and to ADMIN_EMAIL.
//       → { ok: true, action, result }
//
// The code is never stored, only sha256(requestId:code). The SQL that deletes
// is service-role only, so the browser cannot reach it without passing here.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, ZEPTOMAIL_TOKEN

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { ADMIN_EMAIL, esc, layout, sendEmail } from '../_shared/email.ts'

const CODE_MINUTES = 10
const MAX_TRIES = 5
// Requests per admin per 15 minutes — each one sends an email.
const MAX_REQUESTS = 5

type Action = 'disable' | 'delete'

const ACTION_WORD: Record<Action, { verb: string; done: string }> = {
  disable: { verb: 'Disable', done: 'disabled' },
  delete: { verb: 'Delete', done: 'deleted' },
}

const istTime = (d: Date | string) =>
  new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST'

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(6, '0')
}

/** n***@gmail.com — enough to recognise, not enough to harvest. */
function mask(email: string): string {
  const [user, domain] = email.split('@')
  return `${user.slice(0, 1)}***@${domain ?? ''}`
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

/** The business as the email and the audit record describe it. */
function snapshotOf(b: Row, doctors: string[]): Row {
  return {
    name: b.name, vertical: b.vertical, status: b.status,
    phone: b.phone, email: b.email, reg_number: b.reg_number,
    place: [b.own_city, b.own_district, b.own_state, b.own_pin_code].filter(Boolean).join(', '),
    registered: b.created_at, term_end: b.term_end, doctors,
  }
}

function detailRows(snap: Row, extra: [string, string][]): { html: string; text: string } {
  const rows: [string, string][] = [
    ['Business', snap.name],
    ['Type', snap.vertical],
    ['Current status', snap.status],
    ['Phone', snap.phone],
    ['Email', snap.email],
    ['Registration no.', snap.reg_number],
    ['Location', snap.place],
    ['Registered', snap.registered ? istTime(snap.registered) : ''],
    ['Paid until', snap.term_end ?? ''],
    ['Doctors', (snap.doctors ?? []).join(', ')],
    ...extra,
  ].filter(([, v]) => v) as [string, string][]
  return {
    html: `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">${
      rows.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e6ece8;color:#5b6b63;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #e6ece8;vertical-align:top">${esc(v)}</td></tr>`).join('')
    }</table>`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
  }
}

/** { patient_bills: 3 } → "Patient bills: 3" lines. */
function footprintLines(f: Row | null | undefined): string {
  const entries = Object.entries(f ?? {})
  if (!entries.length) return 'No other records.'
  return entries.map(([t, n]) => `${t.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}: ${n}`).join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Row
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  // ── Who is asking: a signed-in admin whose password has not expired ──
  const who = caller(req)
  if (!who || who.isServiceRole) return json({ error: 'Sign in as an admin.' }, 401)
  const { data: isAdmin } = await who.asCaller.rpc('sehat_is_admin')
  if (isAdmin !== true) return json({ error: 'Admins only.' }, 403)
  const token = (req.headers.get('Authorization') ?? '').slice(7).trim()
  const db = who.asService
  const { data: { user } } = await db.auth.getUser(token)
  if (!user) return json({ error: 'Sign in as an admin.' }, 401)
  const { data: adminRow } = await db.from('admin_users').select('email').eq('auth_uid', user.id).maybeSingle()
  const adminEmail = String(adminRow?.email || user.email || '').trim()
  if (!adminEmail.includes('@')) {
    return json({ error: 'Your admin login has no email address, so no code can be sent.' }, 400)
  }

  if (body.op === 'request') return await request(db, user.id, adminEmail, body)
  if (body.op === 'confirm') return await confirm(db, user.id, adminEmail, body)
  return json({ error: "op must be 'request' or 'confirm'" }, 400)
})

// deno-lint-ignore no-explicit-any
async function request(db: any, uid: string, adminEmail: string, body: Row): Promise<Response> {
  const businessId = typeof body.businessId === 'string' ? body.businessId : ''
  const action = body.action as Action
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!businessId) return json({ error: 'businessId required' }, 400)
  if (action !== 'disable' && action !== 'delete') return json({ error: "action must be 'disable' or 'delete'" }, 400)
  if (reason.length < 10) return json({ error: 'Give a reason of at least 10 characters.' }, 400)
  if (reason.length > 1000) return json({ error: 'Keep the reason under 1,000 characters.' }, 400)

  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: recent } = await db.from('admin_business_actions')
    .select('id', { count: 'exact', head: true }).eq('requested_by_uid', uid).gte('created_at', since)
  if ((recent ?? 0) >= MAX_REQUESTS) {
    return json({ error: 'Too many codes requested. Wait 15 minutes and try again.' }, 429)
  }

  const { data: biz } = await db.from('businesses').select('*').eq('id', businessId).maybeSingle()
  if (!biz) return json({ error: 'Business not found.' }, 404)
  if (action === 'disable' && biz.status === 'suspended') {
    return json({ error: `${biz.name} is already disabled.` }, 400)
  }

  let footprint: Row | null = null
  if (action === 'delete') {
    const { data: blocker, error: bErr } = await db.rpc('sehat_admin_delete_blocker', { p_business: businessId })
    if (bErr) return json({ error: bErr.message }, 500)
    if (blocker) return json({ error: blocker }, 400)
    const { data: f, error: fErr } = await db.rpc('sehat_admin_business_footprint', { p_business: businessId })
    if (fErr) return json({ error: fErr.message }, 500)
    footprint = f
  }

  const { data: links } = await db.from('business_practitioners')
    .select('practitioners(full_name)').eq('business_id', businessId)
  const doctors = ((links ?? []) as Row[]).map(l => l.practitioners?.full_name).filter(Boolean)
  const snap = snapshotOf(biz, doctors)

  // A newer request replaces any code this admin still holds for this business.
  await db.from('admin_business_actions').update({ status: 'superseded' })
    .eq('business_id', businessId).eq('requested_by_uid', uid).eq('status', 'pending')

  const id = crypto.randomUUID()
  const code = newCode()
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000)
  const { error: insErr } = await db.from('admin_business_actions').insert({
    id, business_id: businessId, business_name: biz.name, business_snapshot: { ...snap, footprint },
    action, reason, requested_by_uid: uid, requested_by_email: adminEmail,
    code_hash: await sha256(`${id}:${code}`), expires_at: expiresAt.toISOString(),
  })
  if (insErr) return json({ error: insErr.message }, 500)

  const word = ACTION_WORD[action]
  const details = detailRows(snap, [
    ['Action', action === 'delete' ? 'DELETE permanently' : 'Disable (can be reactivated later)'],
    ['Reason', reason],
    ['Requested by', adminEmail],
    ['Requested at', istTime(new Date())],
  ])
  const consequence = action === 'delete'
    ? 'The business and everything below will be removed for good. Doctors no other business lists, and logins nothing else uses, go too. This cannot be undone.'
    : 'The business will be hidden from patients and the WhatsApp bot, and its login will show it as suspended. You can reactivate it from the admin panel.'
  const removed = footprintLines(footprint)

  const sent = await sendEmail({
    to: adminEmail,
    subject: `${code} is your code to ${action} ${biz.name}`,
    html: layout(`${word.verb} ${biz.name}?`, `
<p style="margin:0 0 12px">Someone signed in to the Sehatsandhi admin panel as you asked to <b>${esc(action)}</b> this business. Enter this code to confirm:</p>
<p style="margin:0 0 16px;font-size:30px;font-weight:bold;letter-spacing:6px;color:#0f6b4a">${code}</p>
<p style="margin:0 0 16px;color:#5b6b63;font-size:13px">It expires at ${esc(istTime(expiresAt))} and works once.</p>
${details.html}
<p style="margin:0 0 12px">${esc(consequence)}</p>
${action === 'delete' ? `<p style="margin:0 0 6px;font-weight:bold">What will be removed</p><pre style="margin:0 0 16px;font-family:inherit;font-size:14px;white-space:pre-wrap">${esc(removed)}</pre>` : ''}
<p style="margin:0;color:#b42318;font-size:13px">If you did not ask for this, do not share the code. Nothing happens without it — but change your admin password, because someone has it.</p>`),
    text: `Code to ${action} ${biz.name}: ${code}\nExpires ${istTime(expiresAt)}.\n\n${details.text}\n\n${consequence}\n` +
      (action === 'delete' ? `\nWhat will be removed:\n${removed}\n` : '') +
      `\nIf you did not ask for this, do not share the code and change your admin password.`,
  })
  if (!sent.ok) {
    await db.from('admin_business_actions').update({ status: 'failed', result: { error: sent.error } }).eq('id', id)
    return json({ error: `The code email could not be sent: ${sent.error}` }, 502)
  }

  return json({ requestId: id, sentTo: mask(adminEmail), expiresAt: expiresAt.toISOString() })
}

// deno-lint-ignore no-explicit-any
async function confirm(db: any, uid: string, adminEmail: string, body: Row): Promise<Response> {
  const requestId = typeof body.requestId === 'string' ? body.requestId : ''
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : ''
  if (!requestId || code.length !== 6) return json({ error: 'Enter the 6-digit code from the email.' }, 400)

  const { data: row } = await db.from('admin_business_actions').select('*').eq('id', requestId).maybeSingle()
  // Another admin's request reads as missing: codes are personal.
  if (!row || row.requested_by_uid !== uid) return json({ error: 'That request was not found. Start again.' }, 404)
  if (row.status !== 'pending') {
    const why: Record<string, string> = {
      done: 'This was already confirmed.', superseded: 'A newer code was sent — use that one.',
      expired: 'This code has expired. Start again.', locked: 'Too many wrong codes. Start again.',
      failed: 'This request failed. Start again.',
    }
    return json({ error: why[row.status] ?? 'Start again.' }, 400)
  }
  if (new Date(row.expires_at) < new Date()) {
    await db.from('admin_business_actions').update({ status: 'expired' }).eq('id', requestId).eq('status', 'pending')
    return json({ error: 'This code has expired. Start again.' }, 400)
  }

  // Count the try before judging it, so parallel guesses cannot all slip in.
  const tries = Number(row.attempts) + 1
  await db.from('admin_business_actions').update({ attempts: tries }).eq('id', requestId)
  if (!sameHex(await sha256(`${requestId}:${code}`), row.code_hash)) {
    const left = MAX_TRIES - tries
    if (left <= 0) {
      await db.from('admin_business_actions').update({ status: 'locked' }).eq('id', requestId).eq('status', 'pending')
      return json({ error: 'Too many wrong codes. Start again.' }, 400)
    }
    return json({ error: `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` }, 400)
  }

  // Claim it. Only one confirm can move pending → done, so a double click or a
  // second tab cannot run the action twice.
  const { data: claimed } = await db.from('admin_business_actions')
    .update({ status: 'done', confirmed_at: new Date().toISOString() })
    .eq('id', requestId).eq('status', 'pending').select('id')
  if (!claimed?.length) return json({ error: 'This was already confirmed.' }, 400)

  const action = row.action as Action
  let result: Row
  if (action === 'disable') {
    const { data: biz } = await db.from('businesses').select('status, verification_notes').eq('id', row.business_id).maybeSingle()
    if (!biz) {
      await db.from('admin_business_actions').update({ status: 'failed', result: { error: 'business not found' } }).eq('id', requestId)
      return json({ error: 'That business no longer exists.' }, 404)
    }
    const day = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })
    const line = `Disabled ${day} by ${adminEmail}: ${row.reason}`
    const prev = String(biz.verification_notes ?? '').trim()
    const { error } = await db.from('businesses')
      .update({ status: 'suspended', verification_notes: prev ? `${line}\n\n${prev}` : line }).eq('id', row.business_id)
    if (error) {
      await db.from('admin_business_actions').update({ status: 'failed', result: { error: error.message } }).eq('id', requestId)
      return json({ error: error.message }, 500)
    }
    result = { previous_status: biz.status }
  } else {
    const { data, error } = await db.rpc('sehat_admin_delete_business', { p_business: row.business_id })
    if (error) {
      await db.from('admin_business_actions').update({ status: 'failed', result: { error: error.message } }).eq('id', requestId)
      return json({ error: error.message }, 400)
    }
    result = data as Row
  }
  await db.from('admin_business_actions').update({ result }).eq('id', requestId)

  // The receipt. Best effort: the action is done whether or not this arrives.
  const snap = row.business_snapshot ?? {}
  const word = ACTION_WORD[action]
  const extra: [string, string][] = [
    ['Action', action === 'delete' ? 'Deleted permanently' : 'Disabled'],
    ['Reason', row.reason],
    ['Requested by', row.requested_by_email],
    ['Confirmed at', istTime(new Date())],
  ]
  if (action === 'delete') {
    extra.push(['Doctors removed', String(result.doctors_removed ?? 0)], ['Logins removed', String(result.logins_removed ?? 0)])
  }
  const details = detailRows(snap, extra)
  const removed = action === 'delete' ? footprintLines(result.removed) : ''
  const receipt = {
    subject: `${snap.name ?? row.business_name} was ${word.done}`,
    html: layout(`${snap.name ?? row.business_name} was ${word.done}`, `
${details.html}
${action === 'delete' ? `<p style="margin:0 0 6px;font-weight:bold">Removed</p><pre style="margin:0 0 16px;font-family:inherit;font-size:14px;white-space:pre-wrap">${esc(removed)}</pre>` : ''}
<p style="margin:0;color:#5b6b63;font-size:13px">Record ${esc(requestId)} in admin_business_actions.</p>`),
    text: `${details.text}\n` + (action === 'delete' ? `\nRemoved:\n${removed}\n` : '') + `\nRecord ${requestId}`,
  }
  const to = [...new Set([adminEmail.toLowerCase(), ADMIN_EMAIL.toLowerCase()])]
  await Promise.all(to.map(addr => sendEmail({ to: addr, ...receipt })))

  return json({ ok: true, action, result })
}
