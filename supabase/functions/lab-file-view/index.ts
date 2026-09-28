// lab-file-view — the patient opens an uploaded lab report (0169).
//
// The report file is sent exactly as the lab uploaded it: this looks the link's
// token up and returns a 10-minute signed URL to that file in the private
// patient-documents bucket, with the few details the page shows around it.
// Nothing about the file is read or changed.
//
// Public: the patient has no login. Deploy with --no-verify-jwt, as
// contact-submit and record-visitor-location are. The token is a random uuid;
// an expired link (past the lab's retention) or a purged file answers 410.
//
// GET ?token=<uuid>  →  { title, lab_name, patient_name, report_date, uploaded_at,
//                         expires_on, mime_type, url }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'GET or POST only' }, 405)

  let token = new URL(req.url).searchParams.get('token') ?? ''
  if (!token && req.method === 'POST') {
    try { token = String((await req.json()).token ?? '') } catch { /* fall through */ }
  }
  if (!UUID_RE.test(token)) return json({ error: 'not found' }, 404)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: up, error } = await db.from('lab_uploaded_reports')
    .select('title, report_date, created_at, expires_on, mime_type, business_id, patient_member_id, document_id')
    .eq('public_token', token).maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!up) return json({ error: 'not found' }, 404)

  const { data: doc } = await db.from('patient_documents')
    .select('storage_path, purged_at').eq('id', up.document_id).maybeSingle()
  const expired = new Date(`${up.expires_on}T23:59:59+05:30`) < new Date()
  if (expired || !doc || doc.purged_at) {
    return json({ error: 'expired', message: 'This report is no longer kept online. Please ask the lab for a copy.' }, 410)
  }

  const { data: signed, error: sErr } = await db.storage.from('patient-documents').createSignedUrl(doc.storage_path, 600)
  if (sErr || !signed) return json({ error: 'could not open the file' }, 500)

  const [{ data: biz }, { data: pm }] = await Promise.all([
    db.from('businesses').select('name').eq('id', up.business_id).maybeSingle(),
    db.from('patient_members').select('full_name').eq('id', up.patient_member_id).maybeSingle(),
  ])

  return json({
    title: up.title,
    lab_name: biz?.name ?? null,
    // First name only: the link may be forwarded, and the page needs no more.
    patient_name: String(pm?.full_name ?? '').split(' ')[0] || null,
    report_date: up.report_date,
    uploaded_at: up.created_at,
    expires_on: up.expires_on,
    mime_type: up.mime_type,
    url: signed.signedUrl,
  })
})
