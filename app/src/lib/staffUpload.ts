import { supabase } from './supabase'
import { bytesOf, type Picked } from './patient'

// Staff add a photo or file to a patient's record from the phone (0196) — the
// website's uploadDocument (src/lib/prescriptionsApi.ts), minus the browser-only
// image squeeze: the camera and gallery already hand over a compressed JPEG.
// The path starts with the business id because the storage policy reads it.
export const DOC_KINDS: [string, string][] = [
  ['prescription_scan', 'Prescription'], ['lab_report', 'Lab report'], ['imaging', 'X-ray / scan'],
  ['discharge_summary', 'Discharge'], ['consent_form', 'Consent form'], ['insurance', 'Insurance'], ['other', 'Other'],
]

export async function uploadPatientFile(p: Picked, o: { businessId: string; memberId: string; kind: string; title: string; uploadedBy: string | null }): Promise<void> {
  const clean = p.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  const path = `${o.businessId}/${o.memberId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`
  const bytes = await bytesOf(p.uri)
  const { error: upErr } = await supabase.storage.from('patient-documents').upload(path, bytes, { contentType: p.mime, upsert: false })
  if (upErr) throw new Error(upErr.message)
  const { error } = await supabase.from('patient_documents').insert({
    business_id: o.businessId, patient_member_id: o.memberId, kind: o.kind, title: o.title || p.name,
    storage_path: path, mime_type: p.mime, size_bytes: bytes.byteLength, uploaded_by: o.uploadedBy,
  })
  if (error) {
    await supabase.storage.from('patient-documents').remove([path]).catch(() => undefined)
    throw new Error(error.message)
  }
}
