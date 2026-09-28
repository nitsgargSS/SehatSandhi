// admin-team — full admins add, list and deactivate managers (0145).
//
//   { op: 'list' }
//       → { members: [{ id, auth_uid, email, full_name, phone, role, is_active,
//                       created_at, created_by, deactivated_at, last_sign_in_at }] }
//   { op: 'add', email, fullName, phone }
//       Creates the login (email already confirmed — they sign in with an
//       emailed code) and a 'manager' row, then emails them how to sign in.
//   { op: 'setActive', id, active }
//       Deactivating takes effect on their very next request: every policy and
//       function checks is_active. Nobody can deactivate themselves.
//
// Full admins only. Managers can never add admins: this function creates
// managers and nothing else; admins are still made with scripts/admin-password.mjs.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SITE_URL, ZEPTOMAIL_TOKEN

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { esc, layout, sendEmail } from '../_shared/email.ts'

const ADMIN_PATH = 'ng-ctrl-2026'

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

/** 98765 43210 / +91-98765-43210 / 919876543210 → 919876543210, or null. */
function normalisePhone(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
    : digits
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Row
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }

  const who = caller(req)
  if (!who || who.isServiceRole) return json({ error: 'Sign in as an admin.' }, 401)
  const { data: isAdmin } = await who.asCaller.rpc('sehat_is_admin')
  if (isAdmin !== true) return json({ error: 'Only a full admin can manage the team.' }, 403)
  const db = who.asService
  const token = (req.headers.get('Authorization') ?? '').slice(7).trim()
  const { data: { user: me } } = await db.auth.getUser(token)
  if (!me) return json({ error: 'Sign in as an admin.' }, 401)
  const { data: meRow } = await db.from('admin_users').select('email').eq('auth_uid', me.id).maybeSingle()
  const myEmail = String(meRow?.email || me.email || me.id)

  const log = (action: string, row: Row, detail: Row = {}) =>
    db.from('staff_activity').insert({
      actor_uid: me.id, actor_email: myEmail, actor_role: 'admin',
      action, entity_type: 'admin_user', entity_id: row.id, entity_name: row.full_name || row.email, detail,
    })

  if (body.op === 'list') {
    const { data: rows, error } = await db.from('admin_users')
      .select('id, auth_uid, email, full_name, phone, role, is_active, created_at, created_by, deactivated_at')
      .order('created_at')
    if (error) return json({ error: error.message }, 500)
    const members = await Promise.all((rows ?? []).map(async (r: Row) => {
      const { data } = await db.auth.admin.getUserById(r.auth_uid)
      return { ...r, last_sign_in_at: data?.user?.last_sign_in_at ?? null }
    }))
    return json({ members })
  }

  if (body.op === 'add') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const fullName = String(body.fullName ?? '').trim()
    const phone = normalisePhone(body.phone)
    // Strict on purpose: the address also goes into a PostgREST filter below.
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400)
    if (fullName.length < 2) return json({ error: 'Enter the manager\'s name.' }, 400)
    if (!phone) return json({ error: 'Enter a valid 10-digit Indian mobile number.' }, 400)

    const { data: dupe } = await db.from('admin_users').select('email, phone')
      .or(`email.ilike.${email},phone.eq.${phone}`).limit(1)
    if (dupe?.length) {
      return json({ error: dupe[0].phone === phone
        ? 'That phone number already belongs to someone on the team.'
        : 'That email is already on the team.' }, 400)
    }

    // An existing login is reused only if it is nobody's clinic login: a
    // manager who is also a business would be reviewing themselves.
    const { data: existingUid } = await db.rpc('sehat_auth_uid_for_email', { p_email: email })
    let uid = existingUid as string | null
    let createdHere = false
    if (uid) {
      const [{ count: b }, { count: p }] = await Promise.all([
        db.from('businesses').select('id', { count: 'exact', head: true }).eq('auth_uid', uid),
        db.from('practitioners').select('id', { count: 'exact', head: true }).eq('auth_uid', uid),
      ])
      if ((b ?? 0) + (p ?? 0) > 0) {
        return json({ error: 'That email is a clinic or doctor login. Use a separate email for the manager.' }, 400)
      }
    } else {
      const { data: created, error: cErr } = await db.auth.admin.createUser({
        email, email_confirm: true, user_metadata: { full_name: fullName },
      })
      if (cErr || !created?.user) return json({ error: `Could not create the login: ${cErr?.message ?? 'unknown'}` }, 500)
      uid = created.user.id
      createdHere = true
    }

    const { data: row, error: iErr } = await db.from('admin_users').insert({
      auth_uid: uid, email, full_name: fullName, phone, role: 'manager', is_active: true, created_by: myEmail,
    }).select('*').single()
    if (iErr) {
      // Do not leave a login behind that belongs to nobody.
      if (createdHere) await db.auth.admin.deleteUser(uid!)
      return json({ error: iErr.message }, 500)
    }
    await log('manager_added', row, { email, phone })

    const site = (Deno.env.get('SITE_URL') ?? 'https://sehatsandhi.com').replace(/\/$/, '')
    const link = `${site}/${ADMIN_PATH}`
    const sent = await sendEmail({
      to: email, toName: fullName,
      subject: 'You have been added as a Sehatsandhi manager',
      html: layout(`Welcome, ${fullName}`, `
<p style="margin:0 0 12px">${esc(myEmail)} has added you to the Sehatsandhi team as a <b>manager</b>.</p>
<p style="margin:0 0 12px">Sign in at <a href="${esc(link)}" style="color:#0f6b4a">${esc(link)}</a> with this email address and choose “email me a code”. A new code comes to this inbox each time you sign in.</p>
<p style="margin:0;color:#5b6b63;font-size:13px">If you did not expect this, reply and let us know.</p>`),
      text: `${myEmail} has added you to the Sehatsandhi team as a manager.\n\nSign in at ${link} with this email address and choose "email me a code". A new code comes to this inbox each time you sign in.`,
    })
    return json({ member: row, emailed: sent.ok, emailError: sent.ok ? null : sent.error })
  }

  if (body.op === 'setActive') {
    const id = String(body.id ?? '')
    const active = body.active === true
    const { data: row } = await db.from('admin_users').select('*').eq('id', id).maybeSingle()
    if (!row) return json({ error: 'Team member not found.' }, 404)
    if (row.auth_uid === me.id) return json({ error: 'You cannot deactivate yourself.' }, 400)
    if (row.role !== 'manager') return json({ error: 'Only managers can be switched on and off here.' }, 400)
    const { data: updated, error } = await db.from('admin_users')
      .update({ is_active: active, deactivated_at: active ? null : new Date().toISOString() })
      .eq('id', id).select('*').single()
    if (error) return json({ error: error.message }, 500)
    await log(active ? 'manager_reactivated' : 'manager_deactivated', updated)
    return json({ member: updated })
  }

  return json({ error: "op must be 'list', 'add' or 'setActive'" }, 400)
})
