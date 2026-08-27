// The clinic's patient records.
//
// Reads go through patient_summary and the clinical tables directly, because
// RLS already answers "may this clinic see this patient" — every policy in 0047
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
 * else, and 0048 refuses to build a prescription from an unconfirmed recording
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

// ── Registering a walk-in ───────────────────────────────────────────────────
//
// Until 0063 a patient could only exist by having booked: the appointment
// trigger was the single way in, and a clinic could not write down somebody who
// walked through the door. In Indian OPD that is most of the day.
//
// One RPC rather than three inserts, because registering one person touches
// patients, patient_members and business_patients, and getting it wrong
// produces a second record for someone already on the list — so the allergy
// noted last month is not on the chart the doctor opens today.

export interface NewPatient {
  /** 10 digits as typed at the counter; the server normalises to 91XXXXXXXXXX. */
  phone: string
  fullName: string
  /** Who they are to the phone's owner. 'self' for the owner themselves. */
  relation?: string
  gender?: string
  ageYears?: number | null
  dateOfBirth?: string | null
  bloodGroup?: string | null
  /** The clinic's own file number, if they keep one. */
  mrn?: string
}

/**
 * Register a patient at the front desk. Returns their patient_member_id.
 *
 * Safe to call for somebody already on the list: same phone AND same name is
 * treated as the same person returning, and only blank fields are filled in —
 * a doctor's earlier entry outranks a hurried one at the counter.
 */
export async function registerPatient(businessId: string, p: NewPatient): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_register_patient', {
    p_business: businessId,
    p_phone: p.phone,
    p_full_name: p.fullName,
    p_relation: p.relation || 'self',
    p_gender: p.gender || null,
    p_age_years: p.ageYears ?? null,
    p_date_of_birth: p.dateOfBirth || null,
    p_blood_group: p.bloodGroup || null,
    p_mrn: p.mrn || null,
    p_source: 'walk_in',
  })
  if (error) throw new Error(error.message)
  return data as string
}

// ── What this speciality actually examines ──────────────────────────────────
//
// A visit carries chief_complaint, diagnosis and advice, all free text, and
// vitals has fixed columns for BP and weight. That is a general physician's
// consultation and nobody else's. An eye doctor's finding IS the refraction;
// a dentist's is a chart of thirty-two teeth.
//
// Fields are defined per speciality in the database (0066), so a new speciality
// is rows rather than a release. `sites` is what makes one mechanism carry a
// pair, a chart and a scalar: 'R'/'L' for eyes, FDI numbers for teeth, null for
// everything else.

export interface SpecialityField {
  id: string
  speciality: string
  section: string | null
  code: string
  label: string
  kind: 'number' | 'text' | 'select' | 'boolean'
  unit: string | null
  options: string[] | null
  /** null = one value. Otherwise the field repeats once per site. */
  sites: string[] | null
  min_value: number | null
  max_value: number | null
  help: string | null
  sort_order: number
}

export interface Finding {
  field_code: string
  site: string | null
  value_num: number | null
  value_text: string | null
  unit: string | null
  label?: string | null
  section?: string | null
  visit_date?: string
}

/** The examination form for one speciality. Empty for specialities not yet defined. */
export async function getSpecialityFields(speciality: string): Promise<SpecialityField[]> {
  const { data, error } = await supabase
    .from('speciality_fields').select('*')
    .eq('speciality', speciality).eq('is_active', true)
    .order('sort_order')
  oops(error)
  return (data ?? []) as SpecialityField[]
}

export async function getFindings(visitId: string): Promise<Finding[]> {
  const { data, error } = await supabase
    .from('visit_findings_detail').select('*')
    .eq('visit_id', visitId).order('sort_order')
  oops(error)
  return (data ?? []) as Finding[]
}

/**
 * The whole examination in one call.
 *
 * Replaces the visit's findings wholesale rather than diffing: a refraction is
 * eight fields across two eyes, and a half-saved one is worse than none.
 * Blanks are dropped server-side, so an unexamined tooth stays distinguishable
 * from a sound one.
 */
export async function saveFindings(
  visitId: string, speciality: string,
  findings: { code: string; site?: string | null; num?: string | null; text?: string | null }[],
  recordedBy?: string | null,
): Promise<number> {
  const { data, error } = await supabase.rpc('sehat_save_findings', {
    p_visit_id: visitId,
    p_speciality: speciality,
    p_findings: findings,
    p_recorded_by: recordedBy ?? null,
  })
  oops(error)
  return Number(data ?? 0)
}

/** One field's history for a patient — what a refraction is actually for. */
export async function getFindingSeries(
  memberId: string, fieldCode: string,
): Promise<Finding[]> {
  const { data, error } = await supabase
    .from('visit_findings_detail').select('*')
    .eq('patient_member_id', memberId).eq('field_code', fieldCode)
    .order('recorded_at', { ascending: false }).limit(20)
  oops(error)
  return (data ?? []) as Finding[]
}

/**
 * Which speciality this doctor practises.
 *
 * Read from the practitioner rather than the clinic: a hospital has an eye
 * surgeon and a dentist, and the examination form has to follow whoever is
 * holding the consultation, not the building they are in.
 */
export async function getPractitionerSpeciality(practitionerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('practitioners').select('speciality').eq('id', practitionerId).maybeSingle()
  if (error) return null
  return (data?.speciality as string) ?? null
}
