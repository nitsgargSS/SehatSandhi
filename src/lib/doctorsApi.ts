import { supabase } from './supabase'

// A hospital's doctors, and the per-doctor views on top of one shared patient
// list (0121). Every patient belongs to the business; each record says which
// doctor it is for, and these read and set that.

export interface BusinessDoctor {
  practitioner_id: string
  full_name: string
  speciality: string | null
}

export interface DoctorPerformanceRow {
  practitioner_id: string | null   // null = "Not assigned"
  doctor_name: string
  speciality: string | null
  appointments: number
  completed: number
  no_shows: number
  cancelled: number
  opd_visits: number
  prescriptions: number
  admissions: number
  discharges: number
  patients: number
  registered_patients: number
  billed: number
  collected: number
}

export interface DoctorPatientRow {
  patient_member_id: string
  full_name: string
  phone: string | null
  mrn: string | null
  registered_under_me: boolean
  last_visit: string | null
  visits: number
  admitted_now: boolean
  admission_id: string | null
  bed_label: string | null
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

/** Doctors (and a doctor-owner) at this business, not suspended, by name. */
export async function listBusinessDoctors(businessId: string): Promise<BusinessDoctor[]> {
  const { data, error } = await supabase.from('business_practitioners')
    .select('practitioner_id, role, status, practitioners(full_name, speciality)')
    .eq('business_id', businessId).in('role', ['doctor', 'owner']).neq('status', 'suspended')
  oops(error)
  return ((data ?? []) as unknown as { practitioner_id: string; practitioners: { full_name: string; speciality: string | null } | null }[])
    .filter(r => r.practitioners)
    .map(r => ({ practitioner_id: r.practitioner_id, full_name: r.practitioners!.full_name, speciality: r.practitioners!.speciality }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

const num = (v: unknown) => Number(v ?? 0)

export async function getDoctorPerformance(businessId: string, from: string, to: string): Promise<DoctorPerformanceRow[]> {
  const { data, error } = await supabase.rpc('sehat_doctor_performance', { p_business: businessId, p_from: from, p_to: to })
  oops(error)
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    practitioner_id: (r.practitioner_id as string) ?? null,
    doctor_name: String(r.doctor_name), speciality: (r.speciality as string) ?? null,
    appointments: num(r.appointments), completed: num(r.completed), no_shows: num(r.no_shows), cancelled: num(r.cancelled),
    opd_visits: num(r.opd_visits), prescriptions: num(r.prescriptions), admissions: num(r.admissions),
    discharges: num(r.discharges), patients: num(r.patients), registered_patients: num(r.registered_patients),
    billed: num(r.billed), collected: num(r.collected),
  }))
}

/** A doctor's own patients; owner/manager may pass any doctor. */
export async function getDoctorPatients(businessId: string, practitionerId?: string | null): Promise<DoctorPatientRow[]> {
  const { data, error } = await supabase.rpc('sehat_doctor_patients', { p_business: businessId, p_practitioner: practitionerId ?? null })
  oops(error)
  return ((data ?? []) as DoctorPatientRow[]).map(r => ({ ...r, visits: num(r.visits) }))
}

export async function setPatientDoctor(businessId: string, memberId: string, practitionerId: string | null) {
  const { error } = await supabase.rpc('sehat_set_patient_doctor', { p_business: businessId, p_member: memberId, p_practitioner: practitionerId })
  oops(error)
}

export async function getPatientDoctor(businessId: string, memberId: string): Promise<string | null> {
  const { data, error } = await supabase.from('business_patients').select('primary_practitioner_id')
    .eq('business_id', businessId).eq('patient_member_id', memberId).maybeSingle()
  oops(error)
  return (data as { primary_practitioner_id: string | null } | null)?.primary_practitioner_id ?? null
}

export async function setAttending(admissionId: string, practitionerId: string | null) {
  const { error } = await supabase.rpc('sehat_set_attending', { p_admission: admissionId, p_practitioner: practitionerId })
  oops(error)
}
