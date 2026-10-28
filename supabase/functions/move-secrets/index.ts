// move-secrets — ONE-OFF, for the move to Mumbai (docs/2026-10-mumbai-migration.md).
//
// Copies this project's Edge Function secrets to the Mumbai project through
// Supabase's Management API, so the values never pass through a person, a file
// or a screen: Supabase shows a saved secret's value to nobody, only this
// function's own environment holds them. Deploy to Tokyo, call it once
// (`node scripts/move-region.mjs secrets`), delete it.
//
// The caller's Supabase access token is the gate: it must be able to read this
// project's secrets, and it is what writes them into Mumbai. Without one that
// can, nothing is read or sent. The destination is fixed below.
//
// Request:  { token, includeSending? }   Response: { ok, copied, held, missing }
// Unless includeSending (the cutover), the keys that let Mumbai message or charge
// real people are held back — Mumbai is a copy of production until the switch.
//
// Deploy with --no-verify-jwt: the gate is the access token, not a login.

import { corsHeaders, json } from '../_shared/cors.ts'

const SRC = 'ctxkkqqtasegoowuqbmi'
const DST = 'tbmlhawtnrvvnemcljma'
const SENDING = new Set(['META_ACCESS_TOKEN', 'ZEPTOMAIL_TOKEN', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'WA_BOT_PHONE_IDS'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: { token?: string; includeSending?: boolean }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const token = String(body.token ?? '')
  if (!token) return json({ error: 'token required' }, 401)

  const api = (path: string, init: RequestInit = {}) => fetch(`https://api.supabase.com/v1${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const list = await api(`/projects/${SRC}/secrets`)
  if (!list.ok) return json({ error: `that token cannot read this project's secrets (${list.status})` }, 403)

  // SUPABASE_* are set by Supabase itself in every project; WA_INBOUND_SECRET is
  // made fresh at the cutover by scripts/wa-connect-production.sh.
  const names = ((await list.json()) as { name: string }[]).map(s => s.name)
    .filter(n => !n.startsWith('SUPABASE_') && n !== 'WA_INBOUND_SECRET')
  const send: { name: string; value: string }[] = []
  const held: string[] = [], missing: string[] = []
  for (const name of names) {
    const value = Deno.env.get(name)
    if (value == null) missing.push(name)
    else if (!body.includeSending && SENDING.has(name)) held.push(name)
    else send.push({ name, value })
  }
  if (send.length) {
    const r = await api(`/projects/${DST}/secrets`, { method: 'POST', body: JSON.stringify(send) })
    if (!r.ok) return json({ error: `Mumbai refused the secrets: ${r.status} ${(await r.text()).slice(0, 200)}` }, 502)
  }
  return json({ ok: true, copied: send.map(s => s.name), held, missing })
})
