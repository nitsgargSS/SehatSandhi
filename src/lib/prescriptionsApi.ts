import { supabase } from './supabase'
import { activeConfig } from './env'

// Prescriptions and uploaded documents.
//
// Issuing goes through sehat_issue_prescription rather than a table insert: the
// number comes from a serialised counter, and a prescription with a number but
// no medicines is not a half-written prescription — it is a numbered gap in a
// series that somebody could be shown at a chemist. One call, or nothing.
//
// The patient's copy is a LINK, resolved by the prescription-view function
// exactly as an invoice is. Nothing here generates a PDF or attaches a file.

export interface PrescriptionItem {
  drug_name: string
  strength?: string | null
  form?: string | null
  dosage?: string | null
  duration?: string | null
  quantity?: string | null
  instructions?: string | null
}

export interface Prescription {
  id: string
  prescription_no: string
  business_id: string
  patient_member_id: string
  visit_id: string | null
  prescriber_name: string
  prescriber_qualification: string | null
  prescriber_reg_number: string | null
  clinic_name: string | null
  clinic_address: string | null
  clinic_phone: string | null
  patient_name: string
  patient_age: number | null
  patient_gender: string | null
  diagnosis: string | null
  advice: string | null
  follow_up_date: string | null
  issued_at: string
  status: 'issued' | 'cancelled' | 'superseded'
  supersedes: string | null
  superseded_by: string | null
  sent_at: string | null
  sent_channels: string[] | null
  items: PrescriptionItem[]
}

export interface PatientDocument {
  id: string
  business_id: string
  patient_member_id: string
  visit_id: string | null
  kind: string
  title: string
  description: string | null
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  document_date: string | null
  created_at: string
  /** When this is due to be destroyed under the clinic's retention policy. */
  retain_until: string | null
  /** Blocks the sweeper. A document that is evidence outlives its date. */
  legal_hold: boolean
  legal_hold_reason: string | null
  /** Set once the file is gone. The row remains as a tombstone. */
  purged_at: string | null
}

/**
 * Hold a document beyond its retention date, or release it.
 *
 * The safety valve on automatic destruction: a scan that is evidence in a
 * complaint, a medico-legal case or an insurance dispute must not be swept
 * because a date passed. Holding requires a reason — an unexplained hold is
 * indistinguishable from a clinic quietly keeping everything.
 */
export async function setLegalHold(documentId: string, hold: boolean, reason?: string) {
  const { error } = await supabase.rpc('sehat_set_legal_hold', {
    p_document_id: documentId,
    p_hold: hold,
    p_reason: reason || null,
  })
  oops(error)
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

const BUCKET = 'patient-documents'

// ── Prescriptions ───────────────────────────────────────────────────────────

export interface IssueInput {
  patientMemberId: string
  businessId: string
  practitionerId: string
  items: PrescriptionItem[]
  visitId?: string | null
  diagnosis?: string
  advice?: string
  followUpDate?: string | null
  /** Only ever a CONFIRMED transcript — the database rejects a draft. */
  sourceRecordingId?: string | null
  /** The prescription this one corrects. Both ends get linked. */
  supersedes?: string | null
}

export async function issuePrescription(input: IssueInput): Promise<string> {
  const items = input.items.filter(i => i.drug_name?.trim())
  if (items.length === 0) throw new Error('Add at least one medicine before issuing.')

  const { data, error } = await supabase.rpc('sehat_issue_prescription', {
    p_patient_member_id: input.patientMemberId,
    p_business_id: input.businessId,
    p_practitioner_id: input.practitionerId,
    p_items: items,
    p_visit_id: input.visitId ?? null,
    p_diagnosis: input.diagnosis || null,
    p_advice: input.advice || null,
    p_follow_up: input.followUpDate || null,
    p_source_recording_id: input.sourceRecordingId ?? null,
    p_supersedes: input.supersedes ?? null,
  })
  oops(error)
  return data as string
}

export async function getPrescriptions(memberId: string, businessId: string): Promise<Prescription[]> {
  const { data, error } = await supabase
    .from('prescription_detail').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('issued_at', { ascending: false })
  oops(error)
  return (data ?? []) as Prescription[]
}

/**
 * Cancel an issued prescription.
 *
 * Cancelling is a status change, which is all the immutability trigger permits.
 * The medicines and the number stay exactly as they were — a cancelled
 * prescription is still a record that one was written.
 */
export async function cancelPrescription(id: string, reason: string) {
  const { error } = await supabase.from('prescriptions')
    .update({ status: 'cancelled', cancelled_reason: reason || null })
    .eq('id', id)
  oops(error)
}

/**
 * Hand the patient their copy.
 *
 * Sends the doctor's own session token, not the anon key: the function reads
 * the prescription through it so RLS is what decides this clinic may send it.
 * The anon key would authenticate nobody and is rejected.
 */
export async function sendPrescription(prescriptionId: string, email?: string) {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured for sending.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again to send this.')
  const res = await fetch(`${url}/functions/v1/prescription-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: anon,
    },
    body: JSON.stringify({ prescriptionId, email }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? 'Could not send it. The patient can still be given the printed copy.')
  }
  return body as { whatsapp: boolean; email: boolean }
}

// ── Documents ───────────────────────────────────────────────────────────────

/**
 * Upload a file against a patient.
 *
 * The path starts with the business id because the storage policy reads it:
 * the path IS the permission, so a file cannot be written somewhere its owner
 * would not be allowed to read it back from.
 */
export async function uploadDocument(
  file: File,
  opts: {
    businessId: string
    patientMemberId: string
    kind: string
    title: string
    visitId?: string | null
    documentDate?: string | null
    uploadedBy?: string | null
  },
): Promise<string> {
  const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  const path = `${opts.businessId}/${opts.patientMemberId}/${crypto.randomUUID()}-${clean}`

  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (upErr) throw new Error(upErr.message)

  const { data, error } = await supabase.from('patient_documents').insert({
    business_id: opts.businessId,
    patient_member_id: opts.patientMemberId,
    visit_id: opts.visitId ?? null,
    kind: opts.kind,
    title: opts.title || file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    document_date: opts.documentDate || null,
    uploaded_by: opts.uploadedBy ?? null,
  }).select('id').single()

  if (error) {
    // The row is what makes the file findable. Without it the upload is an
    // orphan nobody can see or delete, so take the file back out.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => undefined)
    throw new Error(error.message)
  }
  return (data as { id: string }).id
}

export async function getDocuments(memberId: string, businessId: string): Promise<PatientDocument[]> {
  const { data, error } = await supabase
    .from('patient_documents').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('created_at', { ascending: false })
  oops(error)
  return (data ?? []) as PatientDocument[]
}

/**
 * A short-lived URL for one file.
 *
 * The bucket is private, so there is no permanent address to link to. Ten
 * minutes is enough to open or save it and short enough that a copied URL is
 * not a lasting way around the access rules.
 */
export async function documentUrl(storagePath: string, seconds = 600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, seconds)
  // data and error are separate fields rather than a discriminated union, so a
  // null error does not prove a non-null data — check both.
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'That file could not be opened. It may have been removed.')
  }
  return data.signedUrl
}

export async function deleteDocument(doc: PatientDocument) {
  const { error } = await supabase.from('patient_documents').delete().eq('id', doc.id)
  oops(error)
  // Row first, file second: if the file removal fails the record is already
  // gone from the chart, which is the outcome the doctor asked for. An orphaned
  // object is a storage cleanup problem, not a clinical one.
  await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => undefined)
}

// ── The patient's copy ──────────────────────────────────────────────────────

export interface PublicPrescription {
  prescription_no: string
  issued_at: string
  status: string
  prescriber_name: string
  prescriber_qualification: string | null
  prescriber_reg_number: string | null
  clinic_name: string | null
  clinic_address: string | null
  clinic_phone: string | null
  patient_name: string
  patient_age: number | null
  patient_gender: string | null
  diagnosis: string | null
  advice: string | null
  follow_up_date: string | null
  items: PrescriptionItem[]
}

/** Resolve a /rx/:token link. No login: the token is the authorisation. */
export async function fetchPublicPrescription(token: string): Promise<PublicPrescription> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured.')
  const res = await fetch(`${url}/functions/v1/prescription-view?token=${encodeURIComponent(token)}`, {
    headers: { Authorization: `Bearer ${anon}`, apikey: anon },
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 410) throw new Error(body.message ?? 'This prescription link has expired.')
  if (!res.ok) throw new Error('That prescription could not be found.')
  return body.prescription as PublicPrescription
}
