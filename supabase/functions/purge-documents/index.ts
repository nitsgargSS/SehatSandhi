// purge-documents — destroy uploaded documents whose retention has run out.
//
// Its own function rather than another action on transcribe-consultation. That
// one is about a consultation and deletes audio as part of doing its job; this
// runs on a schedule, touches a different bucket, and destroys things a clinic
// may be asked about years later. Sharing a name with a transcription endpoint
// would make it easy to miss when reading what deletes what.
//
// SQL cannot delete a storage object, so the decision lives in the database —
// patient_documents_to_purge applies the retention policy and honours legal
// holds — and only the deletion happens here. This function contains no policy
// of its own, deliberately: a rule about how long medical records are kept must
// not be encoded in a place that a redeploy can change.
//
// The row survives as a tombstone. sehat_mark_document_purged clears the path
// and stamps purged_at, so a clinic asked "where is the July scan" can answer
// "destroyed to policy on this date" rather than shrug.
//
// Request:  { }                    — service-role auth required
//           { dryRun: true }       — report what WOULD go, delete nothing
// Response: { purged, failed, candidates }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const BUCKET = 'patient-documents'
// A cron tick, not a backlog drain. Bounded so one run cannot spend minutes
// deleting; whatever is left is picked up on the next tick, and the candidates
// count in the response says how much that is.
const BATCH = 200

interface Candidate {
  id: string
  business_id: string
  storage_path: string | null
  kind: string
  title: string
  retain_until: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.includes(serviceKey)) return json({ error: 'unauthorised' }, 401)

  let dryRun = false
  try {
    const body = await req.json().catch(() => ({}))
    dryRun = body?.dryRun === true
  } catch { /* an empty body is the normal cron call */ }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  const { data, error } = await supabase
    .from('patient_documents_to_purge').select('*').limit(BATCH)
  if (error) return json({ error: error.message }, 500)

  const rows = (data ?? []) as Candidate[]

  // Worth having: this destroys medical records, and being able to see what a
  // policy change is about to do BEFORE it does it is the difference between a
  // considered decision and finding out afterwards.
  if (dryRun) {
    return json({
      dryRun: true,
      candidates: rows.length,
      documents: rows.map(r => ({
        id: r.id, kind: r.kind, title: r.title, retain_until: r.retain_until,
      })),
    })
  }

  let purged = 0
  const failed: string[] = []

  for (const r of rows) {
    if (r.storage_path) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([r.storage_path])
      if (rmErr) {
        // Left for the next run rather than marked purged. Claiming a file is
        // destroyed when it is still sitting in the bucket is the one outcome
        // here that is worse than doing nothing.
        failed.push(`${r.id}: ${rmErr.message}`)
        continue
      }
    }
    const { error: markErr } = await supabase.rpc('sehat_mark_document_purged', {
      p_document_id: r.id,
    })
    if (markErr) { failed.push(`${r.id}: ${markErr.message}`); continue }
    purged++
  }

  return json({ purged, failed: failed.length, errors: failed.slice(0, 20), candidates: rows.length })
})
