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
