import { activeConfig } from './env'
import { supabase } from './supabase'

// 0147: adding, removing, bringing back or promoting staff on a live business
// is confirmed with a code emailed to the owner/manager making the change.
// The business-staff-action edge function does both steps; see its header.

export type StaffAction = 'add' | 'remove' | 'restore' | 'role'

export interface StaffCodeSent { requestId: string; sentTo: string; expiresAt: string }
export interface StaffChangeDone { ok: true; result: { status: string; role: string; awaiting_payment: boolean } }

export interface StaffLogRow {
  id: string
  practitioner_id: string | null
  practitioner_name: string | null
  action: 'added' | 'removed' | 'restored' | 'role_changed'
  role_from: string | null
  role_to: string | null
  status_to: string | null
  reason: string | null
  actor_label: string | null
  created_at: string
}

async function call<T>(payload: unknown): Promise<T> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Supabase is not configured')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session has ended. Sign in again.')
  const res = await fetch(`${url}/functions/v1/business-staff-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: anon },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body as T
}

export const requestStaffCode = (args: {
  businessId: string; practitionerId: string; action: StaffAction; role?: string | null; reason?: string
}) => call<StaffCodeSent>({ op: 'request', ...args })

export const confirmStaffCode = (requestId: string, code: string) =>
  call<StaffChangeDone>({ op: 'confirm', requestId, code })

/** Owners and managers only (RLS). Newest first. */
export async function listStaffLog(businessId: string, limit = 50): Promise<StaffLogRow[]> {
  const { data, error } = await supabase.from('business_staff_log').select('*')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as StaffLogRow[]
}

// ── 0151: one person, several clinics ─────────────────────────────────────

export interface PersonMatch {
  practitioner_id: string
  full_name: string
  speciality: string | null
  /** Has a login or works at another clinic: they must accept an invitation. */
  needs_invitation: boolean
  /** Their place at THIS clinic, if any. */
  here_status: string | null
  here_role: string | null
}

export interface MyInvitation {
  id: string
  business_id: string
  business_name: string
  business_city: string | null
  role: string
  invited_by_label: string | null
  created_at: string
  expires_at: string
}

export interface ClinicInvitation {
  id: string
  practitioner_id: string
  full_name: string
  role: string
  created_at: string
  expires_at: string
}

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

/** Anyone already on Sehatsandhi with this email or phone (up to five). */
export async function findPeople(businessId: string, email: string, phone: string): Promise<PersonMatch[]> {
  const { data, error } = await supabase.rpc('sehat_find_person', {
    p_business: businessId, p_email: email.trim() || null, p_phone: phone.trim() || null,
  })
  fail(error)
  return (data ?? []) as PersonMatch[]
}

export async function listMyInvitations(): Promise<MyInvitation[]> {
  const { data, error } = await supabase.rpc('sehat_my_invitations')
  fail(error)
  return (data ?? []) as MyInvitation[]
}

export async function respondInvitation(id: string, accept: boolean): Promise<{ status: string; awaiting_payment?: boolean }> {
  const { data, error } = await supabase.rpc('sehat_respond_invitation', { p_invitation: id, p_accept: accept })
  fail(error)
  return data as { status: string; awaiting_payment?: boolean }
}

/** Invitations this clinic has sent that are still open (owners and managers). */
export async function listClinicInvitations(businessId: string): Promise<ClinicInvitation[]> {
  const { data, error } = await supabase.rpc('sehat_clinic_invitations', { p_business: businessId })
  fail(error)
  return (data ?? []) as ClinicInvitation[]
}

export async function cancelInvitation(id: string) {
  fail((await supabase.rpc('sehat_cancel_invitation', { p_invitation: id })).error)
}
