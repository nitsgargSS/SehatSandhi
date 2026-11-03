// intl-docs-backup — weekly copy of hospital documents (0313).
//
// Supabase's daily database backups do not include Storage files, so the
// intl-docs bucket is copied elsewhere every week (cron 'intl-docs-backup',
// Mondays 03:00 IST). Only files not copied before are sent; uploads are never
// overwritten (each upload has its own name), so a copied file stays correct.
//
// Where to:
//   BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY, BACKUP_S3_SECRET
//   (+ BACKUP_S3_REGION, default 'auto') set → an S3-compatible bucket outside
//   Supabase: Cloudflare R2, AWS S3, Backblaze B2. This is the real off-site copy.
//   Not set → the private 'intl-docs-backup' bucket in this project. That
//   guards against a file being deleted or damaged, not against losing the
//   whole project.
//
// The cron (service role), or a Sehatsandhi admin's "Back up now" in the panel.
// POST {} → { target, copied, already, failed }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { corsHeaders, json } from '../_shared/cors.ts'
import { isServiceAuth } from '../_shared/serviceKey.ts'

const BUCKET = 'intl-docs'
const MAX_PER_RUN = 500

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const auth = req.headers.get('Authorization') ?? ''
  if (!isServiceAuth(auth)) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: isAdmin } = await asUser.rpc('sehat_is_admin')
    if (isAdmin !== true) return json({ error: 'unauthorised' }, 401)
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const s3 = {
    endpoint: (Deno.env.get('BACKUP_S3_ENDPOINT') ?? '').replace(/\/$/, ''),
    bucket: Deno.env.get('BACKUP_S3_BUCKET') ?? '',
    key: Deno.env.get('BACKUP_S3_KEY') ?? '',
    secret: Deno.env.get('BACKUP_S3_SECRET') ?? '',
    region: Deno.env.get('BACKUP_S3_REGION') ?? 'auto',
  }
  const useS3 = !!(s3.endpoint && s3.bucket && s3.key && s3.secret)
  const target = useS3 ? `s3:${new URL(s3.endpoint).host}/${s3.bucket}` : 'supabase:intl-docs-backup'
  const aws = useS3 ? new AwsClient({ accessKeyId: s3.key, secretAccessKey: s3.secret, region: s3.region, service: 's3' }) : null

  const { data: run } = await db.from('intl_backup_runs').insert({ target }).select('id').single()
  let copied = 0, already = 0, failed = 0
  const errors: string[] = []

  try {
    // Every file: <business id>/<file>.
    const paths: { path: string; size: number }[] = []
    const { data: folders, error: fErr } = await db.storage.from(BUCKET).list('', { limit: 1000 })
    if (fErr) throw fErr
    for (const f of folders ?? []) {
      if (f.id) continue // a file at the top level — not expected
      for (let offset = 0; ; offset += 1000) {
        const { data: files, error } = await db.storage.from(BUCKET).list(f.name, { limit: 1000, offset })
        if (error) throw error
        for (const x of files ?? []) if (x.id) paths.push({ path: `${f.name}/${x.name}`, size: Number(x.metadata?.size ?? 0) })
        if (!files || files.length < 1000) break
      }
    }

    const { data: done } = await db.from('intl_backup_files').select('path').eq('target', target)
    const have = new Set((done ?? []).map((r: { path: string }) => r.path))
    already = paths.filter((p) => have.has(p.path)).length

    for (const p of paths.filter((x) => !have.has(x.path)).slice(0, MAX_PER_RUN)) {
      try {
        const { data: blob, error } = await db.storage.from(BUCKET).download(p.path)
        if (error || !blob) throw error ?? new Error('empty download')
        const type = blob.type || 'application/octet-stream'
        if (aws) {
          const url = `${s3.endpoint}/${s3.bucket}/${BUCKET}/${p.path.split('/').map(encodeURIComponent).join('/')}`
          const res = await aws.fetch(url, { method: 'PUT', body: await blob.arrayBuffer(), headers: { 'Content-Type': type } })
          if (!res.ok) throw new Error(`S3 ${res.status}: ${(await res.text()).slice(0, 200)}`)
        } else {
          const { error: upErr } = await db.storage.from('intl-docs-backup').upload(p.path, blob, { upsert: true, contentType: type })
          if (upErr) throw upErr
        }
        await db.from('intl_backup_files').upsert({ path: p.path, size_bytes: p.size || blob.size, target, copied_at: new Date().toISOString() })
        copied++
      } catch (e) {
        failed++
        if (errors.length < 5) errors.push(`${p.path}: ${(e as Error).message}`)
      }
    }
  } catch (e) {
    errors.unshift((e as Error).message)
  }

  if (run?.id) {
    await db.from('intl_backup_runs').update({
      finished_at: new Date().toISOString(), copied, already, failed, error: errors.length ? errors.join(' | ').slice(0, 1000) : null,
    }).eq('id', run.id)
  }
  return json({ target, copied, already, failed, errors })
})
