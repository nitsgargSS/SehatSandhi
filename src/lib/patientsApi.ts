// The clinic's patient records.
//
// Reads go through patient_summary and the clinical tables directly, because
// RLS already answers "may this clinic see this patient" — every policy in 0045
// resolves through sehat_caller_owns_business(), so a query that returns
// nothing is a query about somebody else's patient. Search is an RPC because it
// spans three tables and needs the caller's businesses resolved server-side.
//
// Two rules from the migration that this file must not quietly break:
//
//   1. Recording needs the PATIENT's consent, recorded against them. The toggle
//      lives in the doctor's UI but the permission is not the doctor's to give,
//      so grantRecordingConsent writes a patient_consents row and the database
//      re-checks it on every insert. Turning the toggle on without that call
//      fails at the trigger, by design.
//
//   2. A machine transcript is a draft. confirmTranscript is the only path from
//      draft to record, and it is what a prescription may later be built from —
//      never transcript_draft.

import { supabase } from './supabase'
import { activeConfig } from './env'

export interface PatientSearchResult {
  patient_member_id: string
  business_id: string
  full_name: string
  relation: string
  phone: string
  age_years: number | null
  gender: string | null
  mrn: string | null
  last_seen_at: string | null
  visit_count: number
}

export interface PatientSummary {
  patient_member_id: string
  business_id: string
  full_name: string
  relation: string
  gender: string | null
  age_years: number | null
  date_of_birth: string | null
  blood_group: string | null
  abha_number: string | null
  phone: string
  lang: string | null
  pin_code: string | null
  area: string | null
  mrn: string | null
  source: string
  first_seen_at: string
  last_seen_at: string | null
  visit_count: number
  visits_here: number
  allergies: string[] | null
  conditions: string[] | null
  next_follow_up: string | null
  recording_consent: boolean
}

export interface Visit {
  id: string
  visit_date: string | null
  visit_type: string
  chief_complaint: string | null
  diagnosis: string | null
  icd10_code: string | null
  advice: string | null
  follow_up_due: string | null
  practitioner_id: string | null
  appointment_id: string | null
  notes: string | null
  created_at: string
}

export interface Vital {
  id: string
  recorded_at: string
  bp_systolic: number | null
  bp_diastolic: number | null
  pulse: number | null
  temperature_c: number | null
  weight_kg: number | null
  height_cm: number | null
  spo2: number | null
  blood_sugar_mg_dl: number | null
  blood_sugar_type: string | null
  notes: string | null
}

export interface Allergy {
  id: string
  substance: string
  category: string | null
  reaction: string | null
  severity: 'mild' | 'moderate' | 'severe' | null
  is_active: boolean
  noted_on: string | null
}

export interface Condition {
  id: string
  condition: string
  icd10_code: string | null
  status: 'active' | 'resolved' | 'inactive'
  onset_date: string | null
  notes: string | null
}

export interface Medication {
  id: string
  drug_name: string
  strength: string | null
  dosage: string | null
  duration: string | null
  instructions: string | null
  is_current: boolean
  started_on: string | null
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

// ── Finding somebody ────────────────────────────────────────────────────────

/** Name, phone or file number, across this caller's own clinics. */
export async function searchPatients(query: string, businessId?: string): Promise<PatientSearchResult[]> {
  const q = query.trim()
  if (q.length < 2) return []          // one character matches most of the register
  const { data, error } = await supabase.rpc('sehat_search_patients', {
    p_query: q,
    ...(businessId ? { p_business: businessId } : {}),
  })
  oops(error)
  return (data ?? []) as PatientSearchResult[]
}

export async function getPatientSummary(memberId: string, businessId: string): Promise<PatientSummary | null> {
  const { data, error } = await supabase
    .from('patient_summary').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .maybeSingle()
  oops(error)
  return (data as PatientSummary) ?? null
}

// ── The record ──────────────────────────────────────────────────────────────

export async function getVisits(memberId: string, businessId: string): Promise<Visit[]> {
  const { data, error } = await supabase
    .from('patient_visits')
    .select('id,visit_date,visit_type,chief_complaint,diagnosis,icd10_code,advice,follow_up_due,practitioner_id,appointment_id,notes,created_at')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('visit_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  oops(error)
  return (data ?? []) as Visit[]
}

export async function getVitals(memberId: string, businessId: string): Promise<Vital[]> {
  const { data, error } = await supabase
    .from('patient_vitals').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('recorded_at', { ascending: false }).limit(50)
  oops(error)
  return (data ?? []) as Vital[]
}

export async function getAllergies(memberId: string, businessId: string): Promise<Allergy[]> {
  const { data, error } = await supabase
    .from('patient_allergies').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('is_active', { ascending: false }).order('created_at', { ascending: false })
  oops(error)
  return (data ?? []) as Allergy[]
}

export async function getConditions(memberId: string, businessId: string): Promise<Condition[]> {
  const { data, error } = await supabase
    .from('patient_conditions').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('status').order('created_at', { ascending: false })
  oops(error)
  return (data ?? []) as Condition[]
}

export async function getMedications(memberId: string, businessId: string): Promise<Medication[]> {
  const { data, error } = await supabase
    .from('patient_medications').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('is_current', { ascending: false }).order('started_on', { ascending: false })
  oops(error)
  return (data ?? []) as Medication[]
}

// ── Writing ─────────────────────────────────────────────────────────────────

export interface NewVisit {
  visitType?: string
  chiefComplaint?: string
  diagnosis?: string
  advice?: string
  followUpDue?: string | null
  notes?: string
  practitionerId?: string | null
  appointmentId?: string | null
}

export async function addVisit(memberId: string, businessId: string, v: NewVisit): Promise<string> {
  const { data, error } = await supabase.from('patient_visits').insert({
    patient_member_id: memberId,
    business_id: businessId,
    visit_date: new Date().toISOString().slice(0, 10),
    visit_type: v.visitType ?? 'opd',
    chief_complaint: v.chiefComplaint || null,
    diagnosis: v.diagnosis || null,
    advice: v.advice || null,
    follow_up_due: v.followUpDue || null,
    notes: v.notes || null,
    practitioner_id: v.practitionerId ?? null,
    appointment_id: v.appointmentId ?? null,
  }).select('id').single()
  oops(error)
  return (data as { id: string }).id
}

export async function addVital(memberId: string, businessId: string, v: Partial<Vital> & { visit_id?: string }) {
  const { error } = await supabase.from('patient_vitals').insert({
    patient_member_id: memberId, business_id: businessId, ...v,
  })
  oops(error)
}

export async function addAllergy(
  memberId: string, businessId: string,
  a: { substance: string; category?: string; reaction?: string; severity?: string },
) {
  const { error } = await supabase.from('patient_allergies').insert({
    patient_member_id: memberId, business_id: businessId,
    substance: a.substance, category: a.category || null,
    reaction: a.reaction || null, severity: a.severity || null,
  })
  oops(error)
}

export async function addCondition(
  memberId: string, businessId: string,
  c: { condition: string; icd10_code?: string; onset_date?: string; notes?: string },
) {
  const { error } = await supabase.from('patient_conditions').insert({
    patient_member_id: memberId, business_id: businessId,
    condition: c.condition, icd10_code: c.icd10_code || null,
    onset_date: c.onset_date || null, notes: c.notes || null,
  })
  oops(error)
}

export async function addMedication(
  memberId: string, businessId: string,
  m: { drug_name: string; strength?: string; dosage?: string; duration?: string; instructions?: string; visit_id?: string },
) {
  const { error } = await supabase.from('patient_medications').insert({
    patient_member_id: memberId, business_id: businessId,
    drug_name: m.drug_name, strength: m.strength || null, dosage: m.dosage || null,
    duration: m.duration || null, instructions: m.instructions || null,
    visit_id: m.visit_id ?? null,
  })
  oops(error)
}

export async function stopMedication(id: string) {
  const { error } = await supabase.from('patient_medications')
    .update({ is_current: false, stopped_on: new Date().toISOString().slice(0, 10) })
    .eq('id', id)
  oops(error)
}

// ── Consent, and the recording that depends on it ───────────────────────────

/**
 * Record that the patient agreed to be recorded.
 *
 * `basis` is what actually happened in the room — "asked and agreed verbally,
 * 19 Aug" or a signed form's serial. It is stored because consent you cannot
 * evidence is consent you cannot defend, which is the same reasoning
 * patient_consents was built with in 0004.
 */
export async function grantRecordingConsent(
  memberId: string, businessId: string, basis: string, recordedBy?: string,
): Promise<string> {
  const { data, error } = await supabase.from('patient_consents').insert({
    patient_member_id: memberId,
    business_id: businessId,
    purpose: 'recording',
    channel: 'in_person',
    action: 'granted',
    basis,
    recorded_by: recordedBy ?? null,
  }).select('id').single()
  oops(error)
  return (data as { id: string }).id
}

/** Withdrawal is a newer row, never a deletion — the log is the evidence. */
export async function withdrawRecordingConsent(memberId: string, businessId: string, basis = 'withdrawn by patient') {
  const { error } = await supabase.from('patient_consents').insert({
    patient_member_id: memberId, business_id: businessId,
    purpose: 'recording', channel: 'in_person', action: 'withdrawn', basis,
  })
  oops(error)
}

export async function hasRecordingConsent(memberId: string, businessId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('sehat_has_consent', {
    p_member: memberId, p_purpose: 'recording', p_business: businessId,
  })
  oops(error)
  return Boolean(data)
}

/** The consent row a recording will cite. Null when there is nothing live. */
export async function liveRecordingConsentId(memberId: string, businessId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('patient_consents')
    .select('id,action')
    .eq('patient_member_id', memberId).eq('purpose', 'recording')
    .order('created_at', { ascending: false }).limit(1)
  oops(error)
  const top = (data ?? [])[0] as { id: string; action: string } | undefined
  return top && top.action === 'granted' ? top.id : null
}

export interface Recording {
  id: string
  visit_id: string
  status: 'recording' | 'transcribing' | 'draft' | 'confirmed' | 'discarded' | 'failed'
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  transcript_draft: string | null
  transcript_confirmed: string | null
  transcript_engine: string | null
  audio_deleted_at: string | null
}

/** One recording by its own id — what the recorder needs after transcription. */
export async function getRecording(id: string): Promise<Recording | null> {
  const { data, error } = await supabase
    .from('consultation_recordings')
    .select('id,visit_id,status,started_at,ended_at,duration_seconds,transcript_draft,transcript_confirmed,transcript_engine,audio_deleted_at')
    .eq('id', id).maybeSingle()
  oops(error)
  return (data as Recording) ?? null
}

/**
 * Open a recording against a visit.
 *
 * Throws if consent is missing or withdrawn — the check is a database trigger,
 * so this cannot be bypassed by calling the table directly from elsewhere.
 */
export async function startRecording(
  visitId: string, memberId: string, businessId: string, practitionerId?: string | null,
): Promise<string> {
  const consentId = await liveRecordingConsentId(memberId, businessId)
  if (!consentId) {
    throw new Error('This patient has not agreed to be recorded. Ask first, then turn recording on.')
  }
  const { data, error } = await supabase.from('consultation_recordings').insert({
    visit_id: visitId,
    patient_member_id: memberId,
    business_id: businessId,
    practitioner_id: practitionerId ?? null,
    consent_id: consentId,
    status: 'recording',
  }).select('id').single()
  oops(error)
  return (data as { id: string }).id
}

export async function stopRecording(recordingId: string, durationSeconds?: number) {
  const { error } = await supabase.from('consultation_recordings').update({
    status: 'transcribing',
    ended_at: new Date().toISOString(),
    duration_seconds: durationSeconds ?? null,
  }).eq('id', recordingId)
  oops(error)
}

/**
 * The only path from what a machine heard to what the record says.
 *
 * The doctor's confirmed text is stored separately from the draft, so the two
 * can always be told apart afterwards. Nothing downstream — a prescription, an
 * emailed summary — may read transcript_draft.
 */
export async function confirmTranscript(recordingId: string, confirmedText: string, practitionerId?: string | null) {
  const { error } = await supabase.from('consultation_recordings').update({
    status: 'confirmed',
    transcript_confirmed: confirmedText,
    confirmed_by: practitionerId ?? null,
    confirmed_at: new Date().toISOString(),
  }).eq('id', recordingId)
  oops(error)
}

export async function getRecordings(visitId: string): Promise<Recording[]> {
  const { data, error } = await supabase
    .from('consultation_recordings')
    .select('id,visit_id,status,started_at,ended_at,duration_seconds,transcript_draft,transcript_confirmed,transcript_engine,audio_deleted_at')
    .eq('visit_id', visitId).order('started_at', { ascending: false })
  oops(error)
  return (data ?? []) as Recording[]
}

// ── Capturing the consultation ──────────────────────────────────────────────

const AUDIO_BUCKET = 'consultation-audio'

/**
 * Is recording even possible here?
 *
 * getUserMedia needs a secure context, so this is false on plain http — worth
 * checking before offering a button that cannot work.
 */
export const canRecord = (): boolean =>
  typeof navigator !== 'undefined'
  && !!navigator.mediaDevices?.getUserMedia
  && typeof MediaRecorder !== 'undefined'

/**
 * A live consultation capture.
 *
 * Kept deliberately small: start, stop, and the stream handle so the
 * microphone can be released. Everything after the blob — upload, transcribe —
 * is a separate step, so a failure there never costs the recording.
 */
export interface LiveRecording {
  stop: () => Promise<Blob>
  /** Release the microphone without keeping anything. */
  cancel: () => void
}

export async function startMicrophone(): Promise<LiveRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })
  // opus in webm is what every current browser can produce and what speech
  // recognition services accept; falling back to the default keeps Safari working.
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : ''
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start(1000)   // flush every second, so a crash loses a second not an hour

  const release = () => stream.getTracks().forEach(t => t.stop())

  return {
    stop: () => new Promise<Blob>((resolve) => {
      recorder.onstop = () => { release(); resolve(new Blob(chunks, { type: mime || 'audio/webm' })) }
      recorder.stop()
    }),
    cancel: () => { try { recorder.stop() } catch { /* already stopped */ } release() },
  }
}

/**
 * Put the audio where the edge function can read it.
 *
 * The path starts with the business id because the storage policy reads it —
 * the same convention as patient documents, and for the same reason.
 */
export async function uploadConsultationAudio(
  recordingId: string, businessId: string, audio: Blob,
): Promise<string> {
  const path = `${businessId}/${recordingId}.webm`
  const { error } = await supabase.storage.from(AUDIO_BUCKET)
    .upload(path, audio, { contentType: audio.type || 'audio/webm', upsert: true })
  if (error) throw new Error(error.message)

  await supabase.from('consultation_recordings')
    .update({ audio_path: path, status: 'transcribing' })
    .eq('id', recordingId)
  return path
}

const callTranscriber = async (body: Record<string, unknown>) => {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured for transcription.')
  const res = await fetch(`${url}/functions/v1/transcribe-consultation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}`, apikey: anon },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error ?? 'That did not work.')
  return out
}

/** Turn the uploaded audio into a draft the doctor will correct. */
export async function requestTranscription(recordingId: string) {
  return callTranscriber({ action: 'transcribe', recordingId }) as Promise<{ characters: number }>
}

export interface MedicineSuggestion {
  drug_name: string
  strength: string
  dosage: string
  duration: string
  instructions: string
  /** The phrase this was read from, so the doctor can check the reading. */
  verbatim: string
  /** The model was unsure. Shown, never hidden. */
  uncertain: boolean
}

/**
 * Read medicines out of the CONFIRMED note.
 *
 * Only ever called after confirmTranscript. The edge function refuses anything
 * else, and 0046 refuses to build a prescription from an unconfirmed recording
 * — the same rule enforced twice, on purpose.
 */
export async function requestMedicineSuggestions(recordingId: string) {
  return callTranscriber({ action: 'suggest', recordingId }) as Promise<{
    configured: boolean
    suggestions?: { medicines: MedicineSuggestion[]; advice: string; follow_up: string }
  }>
}

/** Delete the audio now that the note is signed. Best effort — swept anyway. */
export async function discardConsultationAudio(recordingId: string, businessId: string) {
  await supabase.storage.from(AUDIO_BUCKET)
    .remove([`${businessId}/${recordingId}.webm`]).catch(() => undefined)
  await supabase.from('consultation_recordings')
    .update({ audio_deleted_at: new Date().toISOString(), audio_path: null })
    .eq('id', recordingId)
}

// ── The audit trail ─────────────────────────────────────────────────────────

/**
 * Note that somebody opened a record.
 *
 * Deliberately not awaited by callers: a failed log line must never stop a
 * doctor reading a chart in front of a patient. It is append-only in the
 * database, so nothing here can rewrite history either.
 */
export function logAccess(
  businessId: string, memberId: string | null,
  action: 'search' | 'view' | 'create' | 'update' | 'export' | 'email' | 'print',
  detail?: string,
) {
  void supabase.from('patient_record_access').insert({
    business_id: businessId,
    patient_member_id: memberId,
    action,
    detail: detail ?? null,
  }).then(() => undefined, () => undefined)
}
