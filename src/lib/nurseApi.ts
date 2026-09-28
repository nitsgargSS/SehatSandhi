import { supabase } from './supabase'

// 0149: which nurse works for which doctor. Reads are open to everyone at the
// clinic; changes go through RPCs that let the owner/manager link anyone and a
// doctor link nurses only to themself.

export interface NurseLink { nurse_id: string; doctor_id: string }

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export async function listNurseLinks(businessId: string): Promise<NurseLink[]> {
  const { data, error } = await supabase.from('nurse_doctor_links').select('nurse_id, doctor_id').eq('business_id', businessId)
  oops(error)
  return (data ?? []) as NurseLink[]
}

export async function linkNurse(businessId: string, nurseId: string, doctorId: string) {
  oops((await supabase.rpc('sehat_link_nurse', { p_business: businessId, p_nurse: nurseId, p_doctor: doctorId })).error)
}

export async function unlinkNurse(businessId: string, nurseId: string, doctorId: string) {
  oops((await supabase.rpc('sehat_unlink_nurse', { p_business: businessId, p_nurse: nurseId, p_doctor: doctorId })).error)
}

export async function setWardNurse(businessId: string, nurseId: string, on: boolean) {
  oops((await supabase.rpc('sehat_set_ward_nurse', { p_business: businessId, p_nurse: nurseId, p_on: on })).error)
}

/** The doctors a nurse caller works for, or null when the caller is not a nurse here. */
export async function myNurseDoctors(businessId: string): Promise<string[] | null> {
  const { data, error } = await supabase.rpc('sehat_caller_nurse_doctors', { p_business: businessId })
  oops(error)
  return (data as string[] | null) ?? null
}
