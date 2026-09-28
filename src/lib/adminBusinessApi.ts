import { activeConfig } from './env'
import { supabase } from './supabase'

// 0144: disable or delete a business, confirmed by a code emailed to the admin.
// The admin-business-action edge function does both steps; see its header.

export type BusinessAction = 'disable' | 'delete'

export interface ActionRequested { requestId: string; sentTo: string; expiresAt: string }
export interface ActionDone {
  ok: true
  action: BusinessAction
  result: { removed?: Record<string, number>; doctors_removed?: number; logins_removed?: number; previous_status?: string }
}

async function call<T>(payload: unknown): Promise<T> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Supabase is not configured')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your admin session has ended. Sign in again.')
  const res = await fetch(`${url}/functions/v1/admin-business-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: anon },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body as T
}

export const requestBusinessAction = (businessId: string, action: BusinessAction, reason: string) =>
  call<ActionRequested>({ op: 'request', businessId, action, reason })

export const confirmBusinessAction = (requestId: string, code: string) =>
  call<ActionDone>({ op: 'confirm', requestId, code })
