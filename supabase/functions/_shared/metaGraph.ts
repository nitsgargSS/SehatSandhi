// Meta's Graph API for Facebook Pages and Instagram (0295): social-connect
// and social-posts. WhatsApp has its own (_shared/whatsapp.ts, wa-connect).

export const GRAPH = 'https://graph.facebook.com/v25.0'
export const APP_ID = Deno.env.get('META_APP_ID') ?? '2239815556798206'

// deno-lint-ignore no-explicit-any
type Any = any

/** One Graph call. Never throws: { ok, body } with Meta's error in words. A body means POST. */
export async function graph(path: string, token: string, init?: { method?: string; body?: Record<string, unknown> }) {
  try {
    const res = await fetch(`${GRAPH}/${path}`, {
      method: init?.method ?? (init?.body ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    })
    const body = await res.json().catch(() => ({})) as Any
    const err = res.ok ? undefined
      : `${String(body?.error?.error_user_msg ?? body?.error?.message ?? res.status).slice(0, 200)}${body?.error?.code ? ` (${body.error.code})` : ''}`
    return { ok: res.ok, body, error: err, code: body?.error?.code as number | undefined }
  } catch (e) {
    return { ok: false, body: {} as Any, error: String((e as Error).message ?? e), code: undefined }
  }
}
