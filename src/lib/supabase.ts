import { createClient } from '@supabase/supabase-js'
import { activeConfig } from './env'

// The URL and key come from env.ts rather than straight from import.meta.env,
// so this client and the edge-function calls in businessApi.ts always agree on
// which backend they are talking to. See src/lib/env.ts for why that matters.
const { url, anon } = activeConfig()

if (!url || !anon) {
  console.warn('⚠️  Supabase env vars missing — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
}

// createClient throws on an empty URL, and this module is evaluated at import
// time — so a missing env var did not degrade, it white-screened the entire
// site with only "supabaseUrl is required" in the console. A syntactically
// valid but unroutable placeholder lets the module
// evaluate, the app render, and requests fail one by one — which is what
// businessBackendConfigured() and the various try/catch paths already expect.
const PLACEHOLDER = 'https://unconfigured.invalid'

// Namespaced by project ref rather than by a 'prod'/'sandbox' label. A build
// talks to one backend, but a developer's browser can hold sessions from
// several deployments on the same origin — localhost pointed at sandbox one day
// and production the next — and a token minted by one project is not valid at
// another. Keying on the ref keeps them apart without the client having to know
// which environment it is.
const projectRef = (() => {
  try { return new URL(url).hostname.split('.')[0] } catch { return 'unconfigured' }
})()

export const supabase = createClient(url || PLACEHOLDER, anon || 'unconfigured', {
  auth: { storageKey: `sb-sehat-${projectRef}-auth` },
})
