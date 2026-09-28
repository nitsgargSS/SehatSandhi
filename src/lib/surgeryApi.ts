import { supabase } from './supabase'

// The OT register and the clinical search (0162).
//
// A surgery is its own record — date performed, major or minor OT, surgeon,
// anaesthesia, findings, implants, post-op instructions — rather than a line
// of free text in a discharge summary. The search reads every clinical text
// there is, so a doctor finds patients by what was done and what was written.

export type OtType = 'major' | 'minor'
export const ANAESTHESIA = ['general', 'spinal', 'epidural', 'regional', 'local', 'sedation', 'none'] as const
export type Anaesthesia = typeof ANAESTHESIA[number]

export interface Surgery {
  id: string
  business_id: string
  patient_member_id: string
  admission_id: string | null
  performed_on: string
  start_time: string | null
  end_time: string | null
  ot_type: OtType
  urgency: 'elective' | 'emergency'
  procedure_name: string
  indication: string | null
  surgeon_id: string | null
  surgeon_name: string | null
  assistants: string | null
  anaesthetist: string | null
  anaesthesia: Anaesthesia | null
  findings: string | null
  procedure_notes: string | null
  implants: string | null
  specimen: string | null
  complications: string | null
  post_op_instructions: string | null
  status: 'done' | 'cancelled'
  cancelled_reason: string | null
  recorded_by_name: string | null
  created_at: string
}

export type NewSurgery = Omit<Surgery, 'id' | 'business_id' | 'patient_member_id' | 'status' | 'cancelled_reason' | 'recorded_by_name' | 'created_at'>

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export async function getSurgeries(memberId: string, businessId: string): Promise<Surgery[]> {
  const { data, error } = await supabase.from('surgeries').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('performed_on', { ascending: false })
  // A database without 0162 has no OT register: nothing to show, not an error.
  if (error) return []
  return (data ?? []) as Surgery[]
}

export async function recordSurgery(memberId: string, businessId: string, s: NewSurgery) {
  const blank = (v: string | null | undefined) => (v && String(v).trim()) || null
  const { error } = await supabase.from('surgeries').insert({
    business_id: businessId, patient_member_id: memberId,
    admission_id: s.admission_id || null, visit_id: null,
    performed_on: s.performed_on, start_time: blank(s.start_time), end_time: blank(s.end_time),
    ot_type: s.ot_type, urgency: s.urgency, procedure_name: s.procedure_name.trim(),
    indication: blank(s.indication), surgeon_id: s.surgeon_id || null, surgeon_name: blank(s.surgeon_name),
    assistants: blank(s.assistants), anaesthetist: blank(s.anaesthetist), anaesthesia: s.anaesthesia || null,
    findings: blank(s.findings), procedure_notes: blank(s.procedure_notes), implants: blank(s.implants),
    specimen: blank(s.specimen), complications: blank(s.complications), post_op_instructions: blank(s.post_op_instructions),
  })
  oops(error)
}

export async function cancelSurgery(id: string, reason: string) {
  if (!reason.trim()) throw new Error('Say why this record is being cancelled.')
  const { error } = await supabase.from('surgeries').update({ status: 'cancelled', cancelled_reason: reason.trim() }).eq('id', id)
  oops(error)
}

// ── The search ──────────────────────────────────────────────────────────────

export type RecordSource = 'surgery' | 'discharge' | 'visit' | 'admission' | 'prescription' | 'condition'
export const SOURCES: [RecordSource, string][] = [
  ['surgery', 'Surgeries (OT)'], ['discharge', 'Discharge summaries'], ['admission', 'Admissions (IPD)'],
  ['visit', 'OPD visits'], ['prescription', 'Prescriptions'], ['condition', 'Conditions'],
]

export interface ClinicalHit {
  patient_member_id: string
  full_name: string
  phone: string | null
  age_years: number | null
  gender: string | null
  mrn: string | null
  source: RecordSource
  source_id: string
  event_date: string | null
  title: string | null
  matched_field: string | null
  snippet: string | null
  doctor_name: string | null
  ot_type: OtType | null
  admission_no: string | null
}

export interface SearchFilters {
  from?: string
  to?: string
  sources?: RecordSource[]
  otType?: OtType | null
  practitionerId?: string | null
}

/**
 * Every word must appear (any order, any part of a word) in one record. With
 * no words, the filters alone list — "all minor OTs in March". Owner,
 * manager, doctor (their own patients) and nurse; logged server-side.
 */
export async function clinicalSearch(businessId: string, query: string, f: SearchFilters = {}): Promise<ClinicalHit[]> {
  const { data, error } = await supabase.rpc('sehat_clinical_search', {
    p_business: businessId,
    p_query: query.trim() || null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_sources: f.sources?.length ? f.sources : null,
    p_ot_type: f.otType || null,
    p_practitioner: f.practitionerId || null,
    p_limit: 300,
  })
  oops(error)
  return (data ?? []) as ClinicalHit[]
}
