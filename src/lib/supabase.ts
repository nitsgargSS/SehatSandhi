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

// createClient throws on an empty URL, and this module is evaluated as an
// import — before any statement in main.tsx runs, including applyEnvFromUrl().
// So a missing env var did not degrade, it white-screened the entire site
// before the ?env= param could be read, with only "supabaseUrl is required" in
// the console. A syntactically valid but unroutable placeholder lets the module
// evaluate, the app render, and requests fail one by one — which is what
// businessBackendConfigured() and the various try/catch paths already expect.
const PLACEHOLDER = 'https://unconfigured.invalid'

// Auth tokens are namespaced per backend. Without this the two projects would
// share one storage key, so switching envs would hand a sandbox session token
// to production (and vice versa) — the client would look logged in and every
// request would fail.
export const supabase = createClient(url || PLACEHOLDER, anon || 'unconfigured', {
  auth: { storageKey: `sb-sehat-${getEnv()}-auth` },
})
