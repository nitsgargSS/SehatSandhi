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

export async function recordSurgery(memberId: string, businessId: string, s: NewSurgery): Promise<string> {
  const blank = (v: string | null | undefined) => (v && String(v).trim()) || null
  const { data, error } = await supabase.from('surgeries').insert({
    business_id: businessId, patient_member_id: memberId,
    admission_id: s.admission_id || null, visit_id: null,
    performed_on: s.performed_on, start_time: blank(s.start_time), end_time: blank(s.end_time),
    ot_type: s.ot_type, urgency: s.urgency, procedure_name: s.procedure_name.trim(),
    indication: blank(s.indication), surgeon_id: s.surgeon_id || null, surgeon_name: blank(s.surgeon_name),
    assistants: blank(s.assistants), anaesthetist: blank(s.anaesthetist), anaesthesia: s.anaesthesia || null,
    findings: blank(s.findings), procedure_notes: blank(s.procedure_notes), implants: blank(s.implants),
    specimen: blank(s.specimen), complications: blank(s.complications), post_op_instructions: blank(s.post_op_instructions),
  }).select('id').single()
  oops(error)
  return (data as { id: string }).id
}

export async function cancelSurgery(id: string, reason: string) {
  if (!reason.trim()) throw new Error('Say why this record is being cancelled.')
  const { error } = await supabase.from('surgeries').update({ status: 'cancelled', cancelled_reason: reason.trim() }).eq('id', id)
  oops(error)
}

// ── Planned surgery and its messages (0289) ─────────────────────────────────
//
// A surgery is planned for a date; the hospital's message plan turns into
// messages for this patient — before (tests, fasting, what to bring) and after
// (diet, wound care, warning signs) — sent by themselves with WhatsApp Pro.

export interface PlanStep { id?: string; day_offset: number; send_at: string; body: string }
export interface MessagePlan { id: string; name: string; is_default: boolean; steps: PlanStep[] }

export interface PlannedSurgery {
  id: string
  business_id: string
  patient_member_id: string
  admission_id: string | null
  procedure_name: string
  planned_on: string
  planned_time: string | null
  ot_type: OtType
  surgeon_id: string | null
  surgeon_name: string | null
  notes: string | null
  plan_id: string | null
  status: 'planned' | 'done' | 'cancelled'
  surgery_id: string | null
  cancelled_reason: string | null
  created_by_name: string | null
  created_at: string
}

export interface SurgeryMessage {
  id: string
  planned_id: string
  day_offset: number
  body: string
  due_at: string
  status: 'pending' | 'sending' | 'sent' | 'skipped' | 'failed' | 'cancelled'
  channel: 'whatsapp' | 'push' | null
  why: string | null
  sent_at: string | null
}

export interface UpcomingSurgery {
  id: string
  patient_member_id: string
  patient_name: string
  procedure_name: string
  planned_on: string
  planned_time: string | null
  ot_type: OtType
  surgeon_name: string | null
  messages_left: number
}

/** "3 days before", "the day of", "a week after" — how a step reads on screen. */
export function dayWords(offset: number): string {
  if (offset === 0) return 'On the day'
  const n = Math.abs(offset)
  const unit = n === 7 ? 'a week' : n === 14 ? 'two weeks' : n === 30 ? 'a month' : n === 1 ? '1 day' : `${n} days`
  return `${unit} ${offset < 0 ? 'before' : 'after'}`
}

export async function getMessagePlans(businessId: string): Promise<MessagePlan[]> {
  const { data, error } = await supabase.rpc('sehat_surgery_plans', { p_business: businessId })
  oops(error)
  return (data ?? []) as MessagePlan[]
}

export async function saveMessagePlan(businessId: string, plan: { id?: string; name: string; is_default: boolean; steps: PlanStep[] }): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_surgery_plan_save', { p_business: businessId, p_plan: plan })
  oops(error)
  return data as string
}

export async function deleteMessagePlan(planId: string) {
  const { error } = await supabase.rpc('sehat_surgery_plan_delete', { p_plan: planId })
  oops(error)
}

/** Whether surgery messages will go out at this hospital (WhatsApp Pro, not switched off). */
export async function surgeryMessagesOn(businessId: string): Promise<boolean> {
  const { data } = await supabase.rpc('sehat_surgery_messages_on', { p_business: businessId })
  return !!data
}

export async function setSurgeryMessagesOn(businessId: string, on: boolean) {
  const { error } = await supabase.rpc('sehat_wa_auto_surgery_set', { p_business: businessId, p_on: on })
  oops(error)
}

export async function getPlannedSurgeries(memberId: string, businessId: string): Promise<PlannedSurgery[]> {
  const { data, error } = await supabase.from('planned_surgeries').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId).order('planned_on', { ascending: false })
  if (error) return []
  return (data ?? []) as PlannedSurgery[]
}

export async function getSurgeryMessages(plannedId: string): Promise<SurgeryMessage[]> {
  const { data, error } = await supabase.from('surgery_messages').select('*').eq('planned_id', plannedId).order('due_at')
  oops(error)
  return (data ?? []) as SurgeryMessage[]
}

export async function planSurgery(businessId: string, memberId: string, p: {
  procedure_name: string; planned_on: string; planned_time?: string | null; ot_type: OtType
  surgeon_id?: string | null; surgeon_name?: string | null; admission_id?: string | null; notes?: string | null
  plan_id?: string | null; no_messages?: boolean
}): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_plan_surgery', { p_business: businessId, p_member: memberId, p })
  oops(error)
  return data as string
}

export async function rescheduleSurgery(plannedId: string, date: string, time: string | null) {
  const { error } = await supabase.rpc('sehat_surgery_reschedule', { p_planned: plannedId, p_date: date, p_time: time || null })
  oops(error)
}

export async function cancelPlannedSurgery(plannedId: string, reason: string) {
  const { error } = await supabase.rpc('sehat_surgery_cancel', { p_planned: plannedId, p_reason: reason })
  oops(error)
}

export async function markPlannedDone(plannedId: string, surgeryId: string) {
  const { error } = await supabase.rpc('sehat_surgery_mark_done', { p_planned: plannedId, p_surgery: surgeryId })
  oops(error)
}

/** Change one patient's message (messageId), or add one (messageId null). */
export async function saveSurgeryMessage(plannedId: string, messageId: string | null, dayOffset: number, sendAt: string, body: string) {
  const { error } = await supabase.rpc('sehat_surgery_message_save', {
    p_planned: plannedId, p_message: messageId, p_day_offset: dayOffset, p_send_at: sendAt, p_body: body,
  })
  oops(error)
}

export async function skipSurgeryMessage(messageId: string) {
  const { error } = await supabase.rpc('sehat_surgery_message_skip', { p_message: messageId })
  oops(error)
}

export async function upcomingSurgeries(businessId: string, days = 7): Promise<UpcomingSurgery[]> {
  const { data, error } = await supabase.rpc('sehat_upcoming_surgeries', { p_business: businessId, p_days: days })
  if (error) return []
  return (data ?? []) as UpcomingSurgery[]
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
