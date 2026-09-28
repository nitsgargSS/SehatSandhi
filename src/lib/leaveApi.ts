import { supabase } from './supabase'

// 0150: doctors' leave (everywhere, or at one clinic), the bookings a new leave
// now covers, and a doctor's week across clinics.

export interface Leave {
  id: string
  practitioner_id: string
  business_id: string | null
  starts_at: string
  ends_at: string
  reason: string | null
  cancelled_at: string | null
}

export interface LeaveConflict {
  appointment_id: string
  slot_datetime: string
  practitioner_id: string
  doctor_name: string
  patient_name: string | null
  patient_phone: string | null
  status: string
}

export interface WeekItem {
  slot_datetime: string
  business_id: string
  business_name: string
  location_name: string | null
  status: string
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

/** Leave that has not ended and is not cancelled. RLS decides whose. */
export async function listUpcomingLeave(practitionerIds?: string[]): Promise<Leave[]> {
  let q = supabase.from('practitioner_leave').select('*')
    .is('cancelled_at', null).gt('ends_at', new Date().toISOString()).order('starts_at')
  if (practitionerIds) q = q.in('practitioner_id', practitionerIds)
  const { data, error } = await q
  oops(error)
  return (data ?? []) as Leave[]
}

/** businessId null = the doctor's own leave at every clinic (only the doctor may). */
export async function addLeave(practitionerId: string, businessId: string | null, from: Date, to: Date, reason?: string) {
  const { error } = await supabase.rpc('sehat_add_leave', {
    p_practitioner: practitionerId, p_business: businessId,
    p_from: from.toISOString(), p_to: to.toISOString(), p_reason: reason ?? null,
  })
  oops(error)
}

export async function cancelLeave(id: string) {
  oops((await supabase.rpc('sehat_cancel_leave', { p_leave: id })).error)
}

export async function listLeaveConflicts(businessId: string): Promise<LeaveConflict[]> {
  const { data, error } = await supabase.rpc('sehat_leave_conflicts', { p_business: businessId })
  oops(error)
  return (data ?? []) as LeaveConflict[]
}

export async function myWeek(from: string, to: string): Promise<WeekItem[]> {
  const { data, error } = await supabase.rpc('sehat_my_week', { p_from: from, p_to: to })
  oops(error)
  return (data ?? []) as WeekItem[]
}
