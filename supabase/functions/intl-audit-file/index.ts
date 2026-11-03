// intl-audit-file — an auditor opens or downloads hospital documents (0313).
//
// The audit page (/audit/<token>) has no login. It sends the link's token, the
// passcode if the link has one, and the documents wanted; the database checks
// the link (not expired, not withdrawn, passcode right, documents within its
// hospitals), logs every file with the caller's address, and returns their
// storage paths. This signs each for 5 minutes. A bad link returns nothing.
//
// Public: deploy with --no-verify-jwt.
//
// POST { token, passcode?, ids: uuid[], action: 'view' | 'zip' }
//   → { files: [{ id, url, file_name, item_key, business_name }] }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { token?: unknown; passcode?: unknown; ids?: unknown; action?: unknown }
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const token = String(body.token ?? '')
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter((x) => UUID_RE.test(x)).slice(0, 200) : []
  if (!/^[0-9a-f]{24,64}$/.test(token) || ids.length === 0) return json({ error: 'not found' }, 404)

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 100) || null
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data, error } = await db.rpc('sehat_intl_audit_files', {
    p_token: token, p_passcode: body.passcode ? String(body.passcode) : null, p_ids: ids,
    p_action: body.action === 'zip' ? 'zip' : 'view', p_ip: ip, p_ua: ua,
  })
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as { id: string; path: string; file_name: string | null; item_key: string; business_name: string }[]
  if (!rows.length) return json({ error: 'This link has expired or been withdrawn, or the passcode is wrong.' }, 403)

  const files = []
  for (const r of rows) {
    const { data: s } = await db.storage.from('intl-docs').createSignedUrl(r.path, 300)
    if (s?.signedUrl) {
      const ext = r.path.split('.').pop() ?? 'pdf'
      files.push({ id: r.id, url: s.signedUrl, file_name: r.file_name || `${r.item_key}.${ext}`, item_key: r.item_key, business_name: r.business_name, ext })
    }
  }
  return json({ files })
})
