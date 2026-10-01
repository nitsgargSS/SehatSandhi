// business-staff-action — add, remove, bring back or promote clinic staff with an emailed code (0147).
//
// Called from Doctors & staff on the business dashboard, by an owner or manager:
//
//   { op: 'request', businessId, practitionerId, action: 'add'|'remove'|'restore'|'role', role?, reason? }
//       Emails a six-digit code to the person asking, with what will change,
//       to whom, and why. A reason is required to remove someone.
//       → { requestId, sentTo, expiresAt }
//
//   { op: 'confirm', requestId, code }
//       Checks the code (10 minutes, 5 tries), then calls sehat_staff_apply AS
//       THE CALLER — so attach/detach check their rights exactly as before — and
//       emails the staff member and the business what happened.
//       → { ok: true, result: { status, role, awaiting_payment } }
//
//   { op: 'request', action: 'add', … }  (29 Sep 2026)
//       No code: adding someone is applied at once. It is recorded as a
//       request already verified, so sehat_staff_apply and the trigger work
//       unchanged. The new person is sent a link to set up their login
//       (_shared/staffInvite.ts) by email, and WhatsApp when configured.
//       → { ok: true, result, invite: { link, setUp, email, whatsapp, phone, … } }
//       Removing, bringing back and promoting still need the code.
//
//   { op: 'invite', businessId, practitionerId, send? }
//       Send the set-up link again (send: true, default), or just return it
//       for the dashboard's WhatsApp button (send: false). → { invite }
//
// 0148: Sehatsandhi admins and managers may also remove or bring back (never
// add or re-role), from the admin panel. Only an owner removes an owner.
//
// A trigger on business_practitioners refuses these changes without a verified
// request, so this function is the only way to make them on a live business.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, ZEPTOMAIL_TOKEN

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { esc, layout, sendEmail } from '../_shared/email.ts'
import { sendStaffInvite } from '../_shared/staffInvite.ts'

const CODE_MINUTES = 10
const MAX_TRIES = 5
const MAX_REQUESTS = 8          // per person per 15 minutes; each sends an email
const ROLES = ['owner', 'doctor', 'nurse', 'receptionist', 'manager', 'pharmacist', 'delivery', 'driver']
const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', doctor: 'Doctor', nurse: 'Nurse', receptionist: 'Receptionist', manager: 'Manager',
  pharmacist: 'Pharmacist', delivery: 'Delivery', driver: 'Driver',
}

type Action = 'add' | 'remove' | 'restore' | 'role'
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

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

const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
const mask = (email: string) => { const [u, d] = email.split('@'); return `${u.slice(0, 1)}***@${d ?? ''}` }
/** Phone-OTP logins carry a made-up address (clinic-otp); nothing can be delivered to it. */
const deliverable = (e: unknown): e is string =>
  typeof e === 'string' && e.includes('@') && !e.toLowerCase().endsWith('@wa.sehatsandhi.in')

function describe(action: Action, role: string | null, prevRole: string | null): string {
  switch (action) {
    case 'add': return `Add as ${ROLE_LABEL[role ?? 'doctor']}`
    case 'remove': return 'Remove from the staff'
    case 'restore': return `Bring back as ${ROLE_LABEL[prevRole ?? 'doctor'] ?? prevRole}`
    case 'role': return `Change role${prevRole ? ` from ${ROLE_LABEL[prevRole] ?? prevRole}` : ''} to ${ROLE_LABEL[role ?? 'doctor']}`
  }
}

function table(rows: [string, string | null | undefined][]): { html: string; text: string } {
  const kept = rows.filter(([, v]) => v) as [string, string][]
  return {
    html: `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">${
      kept.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e6ece8;color:#5b6b63;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #e6ece8;vertical-align:top">${esc(v)}</td></tr>`).join('')
    }</table>`,
    text: kept.map(([k, v]) => `${k}: ${v}`).join('\n'),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Row
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const who = caller(req)
  if (!who || who.isServiceRole) return json({ error: 'Sign in first.' }, 401)
  const db = who.asService
  const token = (req.headers.get('Authorization') ?? '').slice(7).trim()
  const { data: { user } } = await db.auth.getUser(token)
  if (!user) return json({ error: 'Sign in first.' }, 401)

  if (body.op === 'request') return await request(who, user, body)
  if (body.op === 'confirm') return await confirm(who, user, body)
  if (body.op === 'invite') return await invite(who, body)
  return json({ error: "op must be 'request', 'confirm' or 'invite'" }, 400)
})

// deno-lint-ignore no-explicit-any
async function request(who: any, user: Row, body: Row): Promise<Response> {
  const db = who.asService
  const businessId = String(body.businessId ?? '')
  const practitionerId = String(body.practitionerId ?? '')
  const action = body.action as Action
  const role = body.role == null ? null : String(body.role)
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!businessId || !practitionerId) return json({ error: 'businessId and practitionerId are required' }, 400)
  if (!['add', 'remove', 'restore', 'role'].includes(action)) return json({ error: 'Unknown action.' }, 400)
  if ((action === 'add' || action === 'role') && !ROLES.includes(role ?? '')) return json({ error: 'Choose a role.' }, 400)
  if (action === 'remove' && reason.length < 10) return json({ error: 'Give a reason of at least 10 characters.' }, 400)
  if (reason.length > 1000) return json({ error: 'Keep the reason under 1,000 characters.' }, 400)

  // Owner or manager of THIS business — or (0148) Sehatsandhi's own team, who
  // may remove and bring back but not hire. Asked as the caller.
  const [{ data: myRole }, { data: isPlatform }] = await Promise.all([
    who.asCaller.rpc('sehat_caller_role', { p_business: businessId }),
    who.asCaller.rpc('sehat_is_staff'),
  ])
  const platform = isPlatform === true
  if (platform) {
    if (action !== 'remove' && action !== 'restore') {
      return json({ error: 'Sehatsandhi can remove or bring back staff; adding and roles are for the clinic.' }, 403)
    }
  } else if (myRole === 'doctor') {
    // 0149: a doctor may add a nurse of their own, who is linked to them.
    if (action !== 'add' || role !== 'nurse') {
      return json({ error: 'A doctor can add a nurse of their own; other staff changes are for the owner or manager.' }, 403)
    }
  } else if (myRole !== 'owner' && myRole !== 'manager') {
    return json({ error: 'Only an owner or manager can change the staff.' }, 403)
  }

  const [{ data: biz }, { data: person }, { data: aff }] = await Promise.all([
    db.from('businesses').select('id, name, email, auth_uid').eq('id', businessId).maybeSingle(),
    db.from('practitioners').select('id, full_name, email, phone, reg_number, auth_uid').eq('id', practitionerId).maybeSingle(),
    db.from('business_practitioners').select('role, status').eq('business_id', businessId).eq('practitioner_id', practitionerId).maybeSingle(),
  ])
  if (!biz || !person) return json({ error: 'Business or staff member not found.' }, 404)
  if (person.auth_uid && person.auth_uid === user.id) return json({ error: 'You cannot change your own place on the staff.' }, 400)
  if (action === 'remove' && (!aff || aff.status === 'suspended')) return json({ error: `${person.full_name} is not on the staff.` }, 400)
  if (action === 'restore' && aff?.status !== 'suspended') return json({ error: `${person.full_name} is not removed.` }, 400)
  if (action === 'remove' && aff?.role === 'owner' && myRole !== 'owner' && !platform) {
    return json({ error: 'Only an owner can remove an owner.' }, 403)
  }

  // Adding needs no code (29 Sep 2026): record it as already verified and
  // apply it now, as the caller, through the same path a confirmed code takes.
  if (action === 'add') {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const { error: insErr } = await db.from('business_staff_requests').insert({
      id, business_id: businessId, practitioner_id: practitionerId, action, role,
      requested_by: user.id, requested_by_email: user.email || biz.email || 'owner',
      code_hash: await sha256(crypto.randomUUID()), expires_at: now,
      status: 'verified', verified_at: now,
    })
    if (insErr) return json({ error: insErr.message }, 500)
    return await apply(who, id)
  }

  // Where the code goes: the caller's own address. A phone-OTP owner has none,
  // so their business address stands in — it is theirs as the owner.
  const to = deliverable(user.email) ? user.email
    : (!platform && myRole === 'owner' && deliverable(biz.email) ? biz.email : null)
  if (!to) return json({ error: 'Your login has no email address to send the code to. Add an email to your account first.' }, 400)

  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { count: recent } = await db.from('business_staff_requests')
    .select('id', { count: 'exact', head: true }).eq('requested_by', user.id).gte('created_at', since)
  if ((recent ?? 0) >= MAX_REQUESTS) return json({ error: 'Too many codes requested. Wait 15 minutes and try again.' }, 429)

  await db.from('business_staff_requests').update({ status: 'superseded' })
    .eq('business_id', businessId).eq('practitioner_id', practitionerId).eq('requested_by', user.id).eq('status', 'pending')

  const id = crypto.randomUUID()
  const code = newCode()
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000)
  const { error: insErr } = await db.from('business_staff_requests').insert({
    id, business_id: businessId, practitioner_id: practitionerId, action, role,
    reason: reason || null, requested_by: user.id, requested_by_email: to,
    code_hash: await sha256(`${id}:${code}`), expires_at: expiresAt.toISOString(),
  })
  if (insErr) return json({ error: insErr.message }, insErr.code === '23514' ? 400 : 500)

  const what = describe(action, role, aff?.role ?? null)
  const details = table([
    ['Clinic', biz.name],
    ['Change', what],
    ['Staff member', person.full_name],
    ['Registration no.', person.reg_number],
    ['Phone', person.phone],
    ['Email', person.email],
    ['Reason', reason || null],
    ['Requested by', to],
    ['Requested at', istTime(new Date())],
  ])
  const billing = (action === 'add' && role === 'doctor') || action === 'role' && role === 'doctor' || (action === 'restore' && aff?.role === 'doctor')
    ? 'If your plan\'s included doctors are already in use, this doctor goes live once the pro-rata fee for the rest of your term is paid, and is part of your plan from the next renewal.'
    : ''

  const sent = await sendEmail({
    to,
    subject: `${code} is your code to confirm a staff change at ${biz.name}`,
    html: layout('Confirm a staff change', `
<p style="margin:0 0 12px">Enter this code on your dashboard to confirm:</p>
<p style="margin:0 0 16px;font-size:30px;font-weight:bold;letter-spacing:6px;color:#0f6b4a">${code}</p>
<p style="margin:0 0 16px;color:#5b6b63;font-size:13px">It expires at ${esc(istTime(expiresAt))} and works once.</p>
${details.html}
${billing ? `<p style="margin:0 0 12px">${esc(billing)}</p>` : ''}
<p style="margin:0;color:#b42318;font-size:13px">If you did not ask for this, do not share the code. Nothing changes without it — but change your password.</p>`),
    text: `Code: ${code} (expires ${istTime(expiresAt)})\n\n${details.text}\n${billing ? `\n${billing}\n` : ''}\nIf you did not ask for this, do not share the code and change your password.`,
  })
  if (!sent.ok) {
    await db.from('business_staff_requests').update({ status: 'failed', result: { error: sent.error } }).eq('id', id)
    return json({ error: `The code email could not be sent: ${sent.error}` }, 502)
  }
  return json({ requestId: id, sentTo: mask(to), expiresAt: expiresAt.toISOString() })
}

// deno-lint-ignore no-explicit-any
async function confirm(who: any, user: Row, body: Row): Promise<Response> {
  const db = who.asService
  const requestId = String(body.requestId ?? '')
  const code = String(body.code ?? '').replace(/\D/g, '')
  if (!requestId || code.length !== 6) return json({ error: 'Enter the 6-digit code from the email.' }, 400)

  const { data: r } = await db.from('business_staff_requests').select('*').eq('id', requestId).maybeSingle()
  if (!r || r.requested_by !== user.id) return json({ error: 'That request was not found. Start again.' }, 404)
  if (r.status !== 'pending') {
    const why: Record<string, string> = {
      verified: 'This code was already accepted.', used: 'This code was already used.',
      superseded: 'A newer code was sent — use that one.', expired: 'This code has expired. Start again.',
      locked: 'Too many wrong codes. Start again.', failed: 'This request failed. Start again.',
    }
    return json({ error: why[r.status] ?? 'Start again.' }, 400)
  }
  if (new Date(r.expires_at) < new Date()) {
    await db.from('business_staff_requests').update({ status: 'expired' }).eq('id', requestId).eq('status', 'pending')
    return json({ error: 'This code has expired. Start again.' }, 400)
  }

  const tries = Number(r.attempts) + 1
  await db.from('business_staff_requests').update({ attempts: tries }).eq('id', requestId)
  if (!sameHex(await sha256(`${requestId}:${code}`), r.code_hash)) {
    const left = MAX_TRIES - tries
    if (left <= 0) {
      await db.from('business_staff_requests').update({ status: 'locked' }).eq('id', requestId).eq('status', 'pending')
      return json({ error: 'Too many wrong codes. Start again.' }, 400)
    }
    return json({ error: `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` }, 400)
  }

  // Only one confirm moves pending → verified; a double click stops here.
  const { data: claimed } = await db.from('business_staff_requests')
    .update({ status: 'verified', verified_at: new Date().toISOString() })
    .eq('id', requestId).eq('status', 'pending').select('id')
  if (!claimed?.length) return json({ error: 'This code was already accepted.' }, 400)

  return await apply(who, requestId)
}

/** Carry out a verified request as the caller, then tell the people concerned. */
// deno-lint-ignore no-explicit-any
async function apply(who: any, requestId: string): Promise<Response> {
  const db = who.asService
  const { data: r } = await db.from('business_staff_requests').select('*').eq('id', requestId).single()

  const { data: prevAff } = await db.from('business_practitioners').select('role')
    .eq('business_id', r.business_id).eq('practitioner_id', r.practitioner_id).maybeSingle()

  // As the caller: their rights decide, exactly as before 0147.
  const { data: result, error } = await who.asCaller.rpc('sehat_staff_apply', { p_request: requestId })
  if (error) {
    await db.from('business_staff_requests').update({ status: 'failed', result: { error: error.message } }).eq('id', requestId)
    return json({ error: error.message }, 400)
  }

  // Receipts. Best effort: the change is made whether or not these arrive.
  const [{ data: biz }, { data: person }] = await Promise.all([
    db.from('businesses').select('name, email').eq('id', r.business_id).maybeSingle(),
    db.from('practitioners').select('full_name, email').eq('id', r.practitioner_id).maybeSingle(),
  ])
  const res = result as Row
  // 0151: someone already known elsewhere is invited rather than added.
  const invited = res?.status === 'invited'
  const what = invited ? `Invite to join as ${ROLE_LABEL[r.role ?? 'doctor'] ?? r.role}` : describe(r.action, r.role, prevAff?.role ?? null)
  const details = table([
    ['Clinic', biz?.name],
    ['Change', what],
    ['Staff member', person?.full_name],
    ['Reason', r.reason],
    ['Done by', r.requested_by_email],
    ['At', istTime(new Date())],
    ['Now', invited ? 'Invited — waiting for them to accept'
      : res?.awaiting_payment ? 'Waiting for the extra-doctor fee to be paid' : res?.status],
  ])
  const sends: Promise<unknown>[] = []
  // Someone new on the staff gets the set-up link instead of a receipt. It
  // replaces the doctor_invite email the database queues for a doctor's own
  // nurse (0151), so they are not told twice.
  let invite = null
  const added = r.action === 'add' && !invited
  if (added) {
    invite = await sendStaffInvite(db, r.business_id, r.practitioner_id)
    await db.from('email_outbox').update({ status: 'skipped', last_error: 'sent by business-staff-action' })
      .eq('kind', 'doctor_invite').eq('practitioner_id', r.practitioner_id).eq('business_id', r.business_id).eq('status', 'pending')
  }
  if (!added && deliverable(person?.email)) {
    const login = `${(Deno.env.get('SITE_URL') ?? 'https://sehatsandhi.com').replace(/\/$/, '')}/business/login`
    const toPerson = invited
      ? { subject: `${biz?.name} has invited you to join as ${ROLE_LABEL[r.role ?? 'doctor'] ?? r.role}`,
          lead: `${biz?.name} would like you on its staff on Sehatsandhi. Sign in at ${login} with your usual email and accept or decline under Invitations at the top of your dashboard. You keep one login for every clinic you work at, and each clinic's patients stay with that clinic.` }
      : r.action === 'remove'
      ? { subject: `You have been removed from ${biz?.name}`, lead: `${biz?.name} has removed you from its staff on Sehatsandhi. You can no longer open its patients or records. Your own profile, and any other clinic you work with, are not affected.` }
      : { subject: `Your place at ${biz?.name} on Sehatsandhi`, lead: `${biz?.name} has made a change to your place on its staff.` }
    sends.push(sendEmail({
      to: person.email, toName: person.full_name, subject: toPerson.subject,
      html: layout(toPerson.subject, `<p style="margin:0 0 12px">${esc(toPerson.lead)}</p>${details.html}`),
      text: `${toPerson.lead}\n\n${details.text}`,
    }))
  }
  if (deliverable(biz?.email) && biz.email.toLowerCase() !== String(r.requested_by_email).toLowerCase()) {
    sends.push(sendEmail({
      to: biz.email, subject: `Staff change at ${biz.name}: ${person?.full_name}`,
      html: layout('A staff change was made', details.html),
      text: details.text,
    }))
  }
  await Promise.all(sends)

  return json({ ok: true, result, invite })
}

/** Resend the set-up link, or just hand it back for a WhatsApp share. */
// deno-lint-ignore no-explicit-any
async function invite(who: any, body: Row): Promise<Response> {
  const db = who.asService
  const businessId = String(body.businessId ?? '')
  const practitionerId = String(body.practitionerId ?? '')
  if (!businessId || !practitionerId) return json({ error: 'businessId and practitionerId are required' }, 400)

  const [{ data: myRole }, { data: aff }] = await Promise.all([
    who.asCaller.rpc('sehat_caller_role', { p_business: businessId }),
    db.from('business_practitioners').select('role, status').eq('business_id', businessId).eq('practitioner_id', practitionerId).maybeSingle(),
  ])
  if (!aff || aff.status === 'suspended') return json({ error: 'That person is not on the staff.' }, 400)
  if (myRole !== 'owner' && myRole !== 'manager') {
    // A doctor may reach their own nurses (0149), nobody else.
    const { data: mine } = await who.asCaller.rpc('sehat_caller_practitioner_id')
    const { count } = await db.from('nurse_doctor_links').select('nurse_id', { count: 'exact', head: true })
      .eq('business_id', businessId).eq('nurse_id', practitionerId).eq('doctor_id', mine ?? '')
    if (myRole !== 'doctor' || !count) return json({ error: 'Only the owner or a manager can send this.' }, 403)
  }
  return json({ invite: await sendStaffInvite(db, businessId, practitionerId, { send: body.send !== false }) })
}
