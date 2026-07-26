import { createClient } from '@supabase/supabase-js'
import { activeConfig, getEnv } from './env'

// The URL and key come from env.ts rather than straight from import.meta.env,
// so this client and the edge-function calls in businessApi.ts always agree on
// which backend they are talking to. See src/lib/env.ts for why that matters.
const { url, anon } = activeConfig()

if (!url || !anon) {
  console.warn(
    getEnv() === 'sandbox'
      ? '⚠️  Sandbox Supabase env vars missing — add VITE_SANDBOX_SUPABASE_URL and VITE_SANDBOX_SUPABASE_ANON_KEY to .env'
      : '⚠️  Supabase env vars missing — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env',
  )
}

// Auth tokens are namespaced per backend. Without this the two projects would
// share one storage key, so switching envs would hand a sandbox session token
// to production (and vice versa) — the client would look logged in and every
// request would fail.
export const supabase = createClient(url || '', anon || '', {
  auth: { storageKey: `sb-sehat-${getEnv()}-auth` },
})
