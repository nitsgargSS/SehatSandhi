import { activeConfig } from './env'
import { supabase } from './supabase'

// 0144: disable a business, confirmed by a code emailed to the admin. No delete.
// The admin-business-action edge function does both steps; see its header.

export interface ActionRequested { requestId: string; sentTo: string; expiresAt: string }
export interface ActionDone { ok: true; action: 'disable'; result: { previous_status?: string } }

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

export const requestDisable = (businessId: string, reason: string) =>
  call<ActionRequested>({ op: 'request', businessId, action: 'disable', reason })

export const confirmDisable = (requestId: string, code: string) =>
  call<ActionDone>({ op: 'confirm', requestId, code })
