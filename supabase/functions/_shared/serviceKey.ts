// Is this request from our own server side (cron, another function)?
//
// 29 Oct 2026: on the Mumbai project the functions' SUPABASE_SERVICE_ROLE_KEY
// is the new-format secret key (sb_secret_…), while the Vault's
// service_role_key — what every cron job sends — is the legacy service_role
// JWT. Both are valid; comparing against the first alone refused every
// scheduled call (618 × 401 in two days: pushes, automatic WhatsApp, billing).
// So either is accepted: the functions' own key, or the legacy JWT kept as the
// function secret SERVICE_ROLE_JWT.

export function isServiceKey(token: string | null | undefined): boolean {
  if (!token) return false
  const keys = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('SERVICE_ROLE_JWT')]
  return keys.some((k) => !!k && k === token)
}

/** The same, for an Authorization header ("Bearer …"). */
export const isServiceAuth = (header: string | null | undefined) =>
  isServiceKey((header ?? '').replace(/^Bearer\s+/i, '').trim())
