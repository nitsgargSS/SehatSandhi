import { supabase } from './supabase'

// 0251: a patient registers themselves at reception from a QR code; the
// receptionist sees them in the Queue, takes the fee and gives the token.

export interface Checkin {
  id: string; full_name: string; age: number | null; phone: string
  address: string | null; pin_code: string | null; created_at: string
  /** This number already belongs to a patient of the clinic. */
  known: boolean
}

/** The form a clinic's reception QR opens. */
export const checkinLink = (code: string): string => `${window.location.origin}/c/${code}`

export async function checkinInfo(code: string): Promise<{ ok: boolean; name?: string; city?: string | null }> {
  const { data, error } = await supabase.rpc('sehat_clinic_checkin_info', { p_code: code })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; name?: string; city?: string | null }
}

export async function submitCheckin(code: string, f: { name: string; age: number; phone: string; address?: string; pin?: string }): Promise<{ ok: boolean; text?: string }> {
  const { data, error } = await supabase.rpc('sehat_clinic_checkin', {
    p_code: code, p_name: f.name, p_age: f.age, p_phone: f.phone, p_address: f.address || null, p_pin: f.pin || null,
  })
  if (error) throw new Error(error.message)
  return data as { ok: boolean; text?: string }
}

export async function getCheckins(businessId: string): Promise<Checkin[]> {
  const { data, error } = await supabase.rpc('sehat_clinic_checkins', { p_business: businessId })
  if (error) throw new Error(error.message)
  return (data ?? []) as Checkin[]
}

export async function closeCheckin(id: string, status: 'registered' | 'dismissed'): Promise<void> {
  const { error } = await supabase.rpc('sehat_clinic_checkin_close', { p_id: id, p_status: status })
  if (error) throw new Error(error.message)
}
