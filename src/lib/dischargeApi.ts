import { supabase } from './supabase'
import { activeConfig } from './env'

// The discharge summary — the document a patient carries out of the building.
//
// Issuing goes through sehat_issue_discharge_summary rather than a table
// insert, for the same reason prescriptions do: the number comes from a
// serialised counter, and almost every field is copied from the admission by
// the database so a tired registrar cannot get the ward, the dates or the
// consultant's registration number wrong at the end of a long week.
//
// It is immutable once issued. A correction is a NEW summary that supersedes
// the old one, so a patient holding a printed copy and a doctor reading the
// screen are never looking at silently different documents.

export type DischargeStatus = 'issued' | 'cancelled' | 'superseded'

export interface DischargeSummary {
  id: string
  summary_no: string
  admission_id: string
  business_id: string
  patient_member_id: string
  practitioner_id: string

  patient_name: string
  patient_age: number | null
  patient_gender: string | null
  clinic_name: string | null
  clinic_address: string | null
  clinic_phone: string | null
  doctor_name: string
  doctor_qualification: string | null
  doctor_reg_number: string | null
  ward_bed: string | null

  admitted_at: string | null
  discharged_at: string | null
  days_stayed: number | null

  admitting_diagnosis: string | null
  discharge_diagnosis: string | null
  condition_on_discharge: string | null
  course_in_hospital: string | null
  investigations: string | null
  procedures: string | null
  advice: string | null
  diet_advice: string | null
  activity_advice: string | null
  warning_signs: string | null
  follow_up_date: string | null
  follow_up_with: string | null

  prescription_id: string | null
  prescription_no?: string | null

  issued_at: string
  status: DischargeStatus
  supersedes: string | null
  superseded_by: string | null

  public_token: string
  token_expires_at: string
  sent_at: string | null
  sent_channels: string[] | null
  send_error: string | null
}

/** What the patient sees at /ds/:token. No ids, no phone number. */
export interface PublicDischargeSummary {
  summary_no: string
  issued_at: string
  status: DischargeStatus
  doctor_name: string
  doctor_qualification: string | null
  doctor_reg_number: string | null
  clinic_name: string | null
  clinic_address: string | null
  clinic_phone: string | null
  ward_bed: string | null
  patient_name: string
  patient_age: number | null
  patient_gender: string | null
  admitted_at: string | null
  discharged_at: string | null
  days_stayed: number | null
  admitting_diagnosis: string | null
  discharge_diagnosis: string | null
  condition_on_discharge: string | null
  course_in_hospital: string | null
  investigations: string | null
  procedures: string | null
  advice: string | null
  diet_advice: string | null
  activity_advice: string | null
  warning_signs: string | null
  follow_up_date: string | null
  follow_up_with: string | null
  medicines: {
    drug_name: string
    strength: string | null
    form: string | null
    dosage: string | null
    duration: string | null
    quantity: string | null
    instructions: string | null
  }[]
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

/** Every summary issued for one stay — usually one, more if it was corrected. */
export async function getDischargeSummaries(admissionId: string): Promise<DischargeSummary[]> {
  const { data, error } = await supabase
    .from('discharge_summary_detail')
    .select('*')
    .eq('admission_id', admissionId)
    .order('issued_at', { ascending: false })
  oops(error)
  return (data ?? []) as DischargeSummary[]
}

export interface IssueDischargeInput {
  admissionId: string
  practitionerId: string
  /** What actually happened between admission and discharge. */
  courseInHospital?: string
  investigations?: string
  procedures?: string
  advice?: string
  dietAdvice?: string
  activityAdvice?: string
  /** What would mean coming back sooner than the follow-up date. */
  warningSigns?: string
  followUpWith?: string
  /** Discharge medication, as a prescription. Pointed at, never copied. */
  prescriptionId?: string | null
  /** Set when this corrects an earlier summary, which it then supersedes. */
  supersedes?: string | null
}

export async function issueDischargeSummary(i: IssueDischargeInput): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_issue_discharge_summary', {
    p_admission_id: i.admissionId,
    p_practitioner_id: i.practitionerId,
    p_course_in_hospital: i.courseInHospital || null,
    p_investigations: i.investigations || null,
    p_procedures: i.procedures || null,
    p_advice: i.advice || null,
    p_diet_advice: i.dietAdvice || null,
    p_activity_advice: i.activityAdvice || null,
    p_warning_signs: i.warningSigns || null,
    p_follow_up_with: i.followUpWith || null,
    p_prescription_id: i.prescriptionId ?? null,
    p_supersedes: i.supersedes ?? null,
  })
  // The common refusal, worth saying plainly rather than showing raw SQL.
  if (error) {
    throw new Error(error.message.includes('discharge the patient before')
      ? 'Discharge the patient first — a summary of an unfinished stay is not one.'
      : error.message)
  }
  return data as string
}

export async function cancelDischargeSummary(id: string, reason: string) {
  const { error } = await supabase
    .from('discharge_summaries')
    .update({ status: 'cancelled', cancelled_reason: reason || null })
    .eq('id', id)
  oops(error)
}

/**
 * Send it to the patient.
 *
 * The doctor's own session token, so the function can read the summary through
 * it and let RLS decide whether this hospital may send it.
 */
export async function sendDischargeSummary(summaryId: string, email?: string) {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured for sending.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again to send this.')
  const res = await fetch(`${url}/functions/v1/discharge-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: anon,
    },
    body: JSON.stringify({ summaryId, email }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.ok) {
    throw new Error(body.message ?? body.error
      ?? 'Could not send it. The patient can still be given the printed copy.')
  }
  return body as { whatsapp: boolean; email: boolean }
}

/** The patient's own copy, by token. No login — the token is the authorisation. */
export async function fetchPublicDischargeSummary(token: string): Promise<PublicDischargeSummary> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured.')
  const res = await fetch(`${url}/functions/v1/discharge-view?token=${encodeURIComponent(token)}`, {
    headers: { Authorization: `Bearer ${anon}`, apikey: anon },
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 410) throw new Error(body.message ?? 'This discharge summary link has expired.')
  if (!res.ok) throw new Error('That discharge summary could not be found.')
  return body.summary as PublicDischargeSummary
}
