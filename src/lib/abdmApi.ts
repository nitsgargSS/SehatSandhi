import { supabase } from './supabase'

// 0287: ABDM — the patient's ABHA, the clinic's HFR ID and each doctor's HPR ID.
// The screens show only for a clinic an admin has switched ABDM on for.

export async function abdmEnabled(businessId: string): Promise<boolean> {
  const { data } = await supabase.from('businesses').select('abdm_enabled').eq('id', businessId).maybeSingle()
  return !!(data as { abdm_enabled?: boolean } | null)?.abdm_enabled
}

/** Link, change or remove (both blank) a patient's ABHA. Typed in by staff, so not verified. */
export async function setAbha(businessId: string, memberId: string, abhaNumber: string, abhaAddress: string) {
  const { data, error } = await supabase.rpc('sehat_set_abha', {
    p_business: businessId, p_member: memberId, p_number: abhaNumber.trim() || null, p_address: abhaAddress.trim() || null,
  })
  if (error) throw new Error(error.message)
  return data as { changed: number }
}

export async function setHfrId(businessId: string, hfrId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('sehat_set_hfr_id', { p_business: businessId, p_hfr: hfrId.trim() || null })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

export async function setHprId(businessId: string, practitionerId: string, hprId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('sehat_set_hpr_id', { p_business: businessId, p_practitioner: practitionerId, p_hpr: hprId.trim() || null })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

/** 91-1234-5678-9012 as the patient's card prints it, from whatever was typed. */
export function formatAbhaNumber(s: string): string {
  const d = s.replace(/\D/g, '').slice(0, 14)
  return [d.slice(0, 2), d.slice(2, 6), d.slice(6, 10), d.slice(10, 14)].filter(Boolean).join('-')
}
