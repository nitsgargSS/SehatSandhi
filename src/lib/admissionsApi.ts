import { supabase } from './supabase'

// Inpatients: wards, beds, stays and ward notes.
//
// Admitting and discharging go through RPCs rather than table writes. Each is
// several statements that have to agree — number the stay, check the bed is
// free and ours, put the patient on the clinic's list, write the first note —
// and the checks are the ones a busy ward gets wrong. Everything else here is
// a plain query, because RLS already answers "is this ours".

export interface Ward {
  id: string
  business_id: string
  name: string
  kind: string
  floor: string | null
  is_active: boolean
  sort_order: number
}

export interface Bed {
  id: string
  ward_id: string
  business_id: string
  label: string
  daily_charge: number | null
  is_active: boolean
}

/** A row of the bed board: one bed, and whoever is in it. */
export interface OccupancyRow {
  business_id: string
  ward_id: string
  ward_name: string
  kind: string
  floor: string | null
  bed_id: string
  bed_label: string
  daily_charge: number | null
  admission_id: string | null
  admission_no: string | null
  admitted_at: string | null
  expected_discharge: string | null
  patient_member_id: string | null
  patient_name: string | null
  age_years: number | null
  gender: string | null
  attending_name: string | null
  occupied: boolean
}

export type AdmissionStatus = 'admitted' | 'discharged' | 'lama' | 'transferred_out' | 'deceased'

export interface Admission {
  id: string
  admission_no: string
  business_id: string
  patient_member_id: string
  bed_id: string | null
  attending_practitioner_id: string | null
  admitted_at: string
  expected_discharge: string | null
  discharged_at: string | null
  status: AdmissionStatus
  reason: string | null
  admitting_diagnosis: string | null
  discharge_diagnosis: string | null
  discharge_summary: string | null
  condition_on_discharge: string | null
  follow_up_date: string | null
  // joined by the view
  patient_name: string
  age_years: number | null
  gender: string | null
  patient_phone: string | null
  ward_name: string | null
  bed_label: string | null
  attending_name: string | null
  discharged_by_name: string | null
  days_stayed: number
}

export interface AdmissionNote {
  id: string
  admission_id: string
  note_type: string
  body: string
  recorded_at: string
  recorded_by: string | null
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

// ── Wards and beds ──────────────────────────────────────────────────────────

export async function getWards(businessId: string): Promise<Ward[]> {
  const { data, error } = await supabase.from('wards').select('*')
    .eq('business_id', businessId).eq('is_active', true)
    .order('sort_order').order('name')
  oops(error)
  return (data ?? []) as Ward[]
}

export async function addWard(businessId: string, name: string, kind = 'general', floor?: string) {
  const { error } = await supabase.from('wards')
    .insert({ business_id: businessId, name, kind, floor: floor || null })
  oops(error)
}

export async function addBed(businessId: string, wardId: string, label: string, dailyCharge?: number | null) {
  const { error } = await supabase.from('beds').insert({
    business_id: businessId, ward_id: wardId, label,
    daily_charge: dailyCharge ?? null,
  })
  // The (ward_id, label) unique constraint is the common mistake — bed 7 typed
  // twice — so say what happened rather than surfacing a constraint name.
  if (error) {
    throw new Error(error.message.includes('duplicate') || error.code === '23505'
      ? `Bed ${label} already exists in that ward.`
      : error.message)
  }
}

/** The board a ward runs the day from. Empty beds are rows too. */
export async function getOccupancy(businessId: string): Promise<OccupancyRow[]> {
  const { data, error } = await supabase.from('ward_occupancy').select('*')
    .eq('business_id', businessId)
    .order('ward_name').order('bed_label')
  oops(error)
  return (data ?? []) as OccupancyRow[]
}

// ── Stays ───────────────────────────────────────────────────────────────────

export async function getAdmissions(memberId: string, businessId: string): Promise<Admission[]> {
  const { data, error } = await supabase.from('admission_detail').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('admitted_at', { ascending: false })
  oops(error)
  return (data ?? []) as Admission[]
}

export async function getCurrentAdmissions(businessId: string): Promise<Admission[]> {
  const { data, error } = await supabase.from('admission_detail').select('*')
    .eq('business_id', businessId).eq('status', 'admitted')
    .order('admitted_at', { ascending: false })
  oops(error)
  return (data ?? []) as Admission[]
}

export interface AdmitInput {
  patientMemberId: string
  businessId: string
  bedId?: string | null
  attendingPractitionerId?: string | null
  reason?: string
  admittingDiagnosis?: string
  expectedDischarge?: string | null
}

export async function admitPatient(i: AdmitInput): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_admit_patient', {
    p_patient_member_id: i.patientMemberId,
    p_business_id: i.businessId,
    p_bed_id: i.bedId ?? null,
    p_attending_practitioner_id: i.attendingPractitionerId ?? null,
    p_reason: i.reason || null,
    p_admitting_diagnosis: i.admittingDiagnosis || null,
    p_expected_discharge: i.expectedDischarge || null,
  })
  oops(error)
  return data as string
}

export interface DischargeInput {
  status?: AdmissionStatus
  dischargeDiagnosis?: string
  dischargeSummary?: string
  condition?: string
  followUp?: string | null
  practitionerId?: string | null
}

export async function dischargePatient(admissionId: string, d: DischargeInput = {}) {
  const { error } = await supabase.rpc('sehat_discharge_patient', {
    p_admission_id: admissionId,
    p_status: d.status ?? 'discharged',
    p_discharge_diagnosis: d.dischargeDiagnosis || null,
    p_discharge_summary: d.dischargeSummary || null,
    p_condition: d.condition || null,
    p_follow_up: d.followUp || null,
    p_practitioner_id: d.practitionerId ?? null,
  })
  oops(error)
}

/**
 * Move a patient to another bed.
 *
 * A plain update: the partial unique index refuses an occupied bed, and a
 * trigger writes the move into the ward notes — so where somebody slept is
 * recorded without anyone remembering to record it.
 */
export async function moveToBed(admissionId: string, bedId: string | null) {
  const { error } = await supabase.from('admissions')
    .update({ bed_id: bedId }).eq('id', admissionId)
  if (error) {
    throw new Error(error.code === '23505'
      ? 'That bed is already occupied.'
      : error.message)
  }
}

// ── Ward notes ──────────────────────────────────────────────────────────────

export async function getAdmissionNotes(admissionId: string): Promise<AdmissionNote[]> {
  const { data, error } = await supabase.from('admission_notes')
    .select('id,admission_id,note_type,body,recorded_at,recorded_by')
    .eq('admission_id', admissionId).order('recorded_at', { ascending: false })
  oops(error)
  return (data ?? []) as AdmissionNote[]
}

export async function addAdmissionNote(
  admissionId: string, businessId: string, body: string,
  noteType = 'progress', recordedBy?: string | null,
) {
  const { error } = await supabase.from('admission_notes').insert({
    admission_id: admissionId, business_id: businessId,
    note_type: noteType, body, recorded_by: recordedBy ?? null,
  })
  oops(error)
}

// ── Bed history, and correcting it ──────────────────────────────────────────
//
// The periods a stay is made of. 0053 writes them by trigger when the bed on an
// admission changes; 0062 added a way to fix one that was recorded wrongly,
// because until then the only route back was to discharge and re-admit — which
// invents a second admission for a patient who never left.
//
// The table itself stays SELECT-only. A bed stay multiplies into a charge, so a
// plain UPDATE would be an unvalidated edit of a bill; both calls below go
// through functions that check the invariants and re-post the charges.

export interface BedStay {
  id: string
  admission_id: string
  business_id: string
  ward_name: string | null
  bed_label: string | null
  daily_charge_snapshot: number | null
  from_at: string
  to_at: string | null
  days: number
  /** The bed they are in now. Exactly one period per admission has this. */
  current: boolean
  corrected_at: string | null
  correction_reason: string | null
  /** Bill number holding these charges, or null while they are still editable. */
  billed_on: string | null
}

export async function getBedHistory(admissionId: string): Promise<BedStay[]> {
  const { data, error } = await supabase
    .from('admission_bed_history').select('*')
    .eq('admission_id', admissionId)
  oops(error)
  return (data ?? []) as BedStay[]
}

export interface BedStayCorrection {
  /** Omit to leave unchanged — restating a value is how you change it by accident. */
  fromAt?: string | null
  toAt?: string | null
  bedId?: string | null
}

/** Fix a period's times, its bed, or both. Re-posts the bed charges after. */
export async function correctBedStay(
  stayId: string, reason: string, c: BedStayCorrection = {}, correctedBy?: string | null,
) {
  const { error } = await supabase.rpc('sehat_correct_bed_stay', {
    p_stay_id: stayId,
    p_reason: reason,
    p_from_at: c.fromAt ?? null,
    p_to_at: c.toAt ?? null,
    p_bed_id: c.bedId ?? null,
    p_corrected_by: correctedBy ?? null,
  })
  oops(error)
}

/** A transfer that never happened: drop this period and reopen the one before. */
export async function undoBedMove(stayId: string, reason: string, correctedBy?: string | null) {
  const { error } = await supabase.rpc('sehat_undo_bed_move', {
    p_stay_id: stayId,
    p_reason: reason,
    p_corrected_by: correctedBy ?? null,
  })
  oops(error)
}

// ── The drug chart ──────────────────────────────────────────────────────────
//
// In OPD a prescription is a slip the patient carries away. In IPD it is a
// chart the nurse works from every shift, and prescribed is not the same fact
// as administered — the gap between them is where harm lives, so they are two
// tables and two calls.
//
// A doctor orders; a NURSE administers. 0067 added the role for exactly this,
// because until then a nurse had to be given 'doctor', which means allowed to
// prescribe.

export type DoseStatus = 'due' | 'given' | 'missed' | 'refused' | 'withheld' | 'omitted' | 'self_administered'

export interface MedicationOrder {
  id: string
  admission_id: string
  drug_name: string
  strength: string | null
  form: string | null
  route: string
  dose_text: string
  frequency_code: string
  times: string[]
  prn: boolean
  prn_indication: string | null
  max_per_day: number | null
  start_at: string
  stop_at: string | null
  instructions: string | null
  status: 'active' | 'stopped' | 'completed'
  stop_reason: string | null
  allergy_override: string | null
}

/** One scheduled dose: what is due, and what happened to it. */
export interface DueDose {
  order_id: string
  drug_name: string
  strength: string | null
  dose_text: string
  route: string
  frequency_code: string
  instructions: string | null
  due_at: string
  administration_id: string | null
  given_at: string | null
  dose_given: string | null
  reason: string | null
  slot_status: DoseStatus
}

export interface AllergyWarning {
  substance: string
  severity: string | null
  reaction: string | null
}

export async function getMedicationOrders(admissionId: string): Promise<MedicationOrder[]> {
  const { data, error } = await supabase
    .from('admission_medication_orders').select('*')
    .eq('admission_id', admissionId)
    .order('status').order('ordered_at', { ascending: false })
  oops(error)
  return (data ?? []) as MedicationOrder[]
}

/** The chart itself — scheduled doses a few days either side of now. */
export async function getDueDoses(admissionId: string): Promise<DueDose[]> {
  const { data, error } = await supabase
    .from('medication_due').select('*')
    .eq('admission_id', admissionId).order('due_at')
  oops(error)
  return (data ?? []) as DueDose[]
}

/**
 * Anything recorded against this patient that looks like the drug being
 * ordered. WARNS — it never blocks. There are real reasons to give a drug
 * somebody once reacted to, and the decision is the prescriber's; what the
 * system owes is that they saw it, which is why the order carries the override.
 */
export async function checkAllergy(memberId: string, drug: string): Promise<AllergyWarning[]> {
  const { data, error } = await supabase.rpc('sehat_allergy_warning', {
    p_member: memberId, p_drug: drug,
  })
  if (error) return []
  return (data ?? []) as AllergyWarning[]
}

export interface NewMedicationOrder {
  drugName: string
  doseText: string
  frequencyCode?: string
  times?: string[] | null
  route?: string
  strength?: string
  form?: string
  prn?: boolean
  prnIndication?: string
  maxPerDay?: number | null
  instructions?: string
  /** Set when the prescriber saw an allergy warning and went ahead. */
  allergyOverride?: string | null
}

export async function orderMedication(
  admissionId: string, o: NewMedicationOrder, orderedBy?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_order_medication', {
    p_admission_id: admissionId,
    p_drug_name: o.drugName,
    p_dose_text: o.doseText,
    p_frequency_code: o.frequencyCode ?? 'BD',
    p_times: o.times ?? null,
    p_route: o.route ?? 'oral',
    p_strength: o.strength || null,
    p_form: o.form || null,
    p_prn: o.prn ?? false,
    p_prn_indication: o.prnIndication || null,
    p_max_per_day: o.maxPerDay ?? null,
    p_instructions: o.instructions || null,
    p_ordered_by: orderedBy ?? null,
    p_allergy_override: o.allergyOverride || null,
  })
  oops(error)
  return data as string
}

// Named for the ward, not for OPD: patientsApi.stopMedication ends a long-term
// medication on someone's record; this ends an inpatient order and with it the
// remaining slots on the chart. Two different acts, so two different names.
export async function stopDrugOrder(orderId: string, reason: string, by?: string | null) {
  const { error } = await supabase.rpc('sehat_stop_medication', {
    p_order_id: orderId, p_reason: reason, p_stopped_by: by ?? null,
  })
  oops(error)
}

/** The nursing act. A dose not given needs a reason, enforced server-side. */
export async function recordDose(args: {
  orderId: string
  status: 'given' | 'refused' | 'withheld' | 'omitted' | 'self_administered'
  dueAt?: string | null
  doseGiven?: string
  reason?: string
  givenBy?: string | null
  witnessedBy?: string | null
  notes?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_record_administration', {
    p_order_id: args.orderId,
    p_status: args.status,
    p_due_at: args.dueAt ?? null,
    p_dose_given: args.doseGiven || null,
    p_reason: args.reason || null,
    p_given_by: args.givenBy ?? null,
    p_witnessed_by: args.witnessedBy ?? null,
    p_notes: args.notes || null,
  })
  oops(error)
  return data as string
}

/** Struck through, never erased — the same as a line through a paper chart. */
export async function voidDose(id: string, reason: string, by?: string | null) {
  const { error } = await supabase.rpc('sehat_void_administration', {
    p_id: id, p_reason: reason, p_voided_by: by ?? null,
  })
  oops(error)
}
