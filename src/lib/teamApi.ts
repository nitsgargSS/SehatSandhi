import { activeConfig } from './env'
import { supabase } from './supabase'

// 0145: the admin team — managers added by a full admin, and what everyone did.

export interface TeamMember {
  id: string
  auth_uid: string
  email: string | null
  full_name: string | null
  phone: string | null
  /** 0156 */
  phone_verified_at?: string | null
  role: 'admin' | 'owner' | 'manager'
  is_active: boolean
  created_at: string
  created_by: string | null
  deactivated_at: string | null
  last_sign_in_at: string | null
}

export interface StaffActivity {
  id: string
  actor_uid: string | null
  actor_email: string | null
  actor_role: string | null
  action: string
  entity_type: string
  entity_id: string | null
  entity_name: string | null
  detail: Record<string, unknown>
  created_at: string
}

async function team<T>(payload: unknown): Promise<T> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Supabase is not configured')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your admin session has ended. Sign in again.')
  const res = await fetch(`${url}/functions/v1/admin-team`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: anon },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body as T
}

export const listTeam = () => team<{ members: TeamMember[] }>({ op: 'list' }).then(r => r.members)

export const addManager = (m: { email: string; fullName: string; phone: string }) =>
  team<{ member: TeamMember; emailed: boolean; emailError: string | null }>({ op: 'add', ...m })

export const setMemberActive = (id: string, active: boolean) =>
  team<{ member: TeamMember }>({ op: 'setActive', id, active }).then(r => r.member)

/** 0156: an admin who has rung the person marks their number verified. */
export async function markPhoneVerified(kind: 'admin_user' | 'practitioner', id: string) {
  const { error } = await supabase.rpc('sehat_admin_mark_phone_verified', { p_kind: kind, p_id: id })
  if (error) throw new Error(error.message)
}

/** 0156: numbers that more than one person carries, from before the rule. */
export async function duplicatePhones(): Promise<{ phone: string; people: number; names: string[] }[]> {
  const { data, error } = await supabase.rpc('sehat_admin_duplicate_phones')
  if (error) throw new Error(error.message)
  return (data ?? []) as { phone: string; people: number; names: string[] }[]
}

/** Newest first. RLS returns everyone's to an admin and only their own to a manager. */
export async function listActivity(opts: { actorUid?: string | null; limit?: number } = {}): Promise<StaffActivity[]> {
  let q = supabase.from('staff_activity').select('*').order('created_at', { ascending: false }).limit(opts.limit ?? 100)
  if (opts.actorUid) q = q.eq('actor_uid', opts.actorUid)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as StaffActivity[]
}
