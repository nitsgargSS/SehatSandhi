// Which backend is this session talking to?
//
// The app can point at either the production Supabase project or an isolated
// sandbox one. Sandbox exists so registration and payment can be tested end to
// end — real forms, real Razorpay Checkout in test mode — without creating junk
// rows in production or moving money.
//
// Everything derives from getEnv(): the Supabase client, the edge-function URL,
// and the anon key all read activeConfig(). That single authority is the point.
// The failure mode worth designing against is a split brain — writing listing
// rows to sandbox while calling production's payment functions — which is
// exactly what happens when two modules each read import.meta.env for
// themselves. They no longer do.
//
// Safety properties, in order of how much they matter:
//
//   1. Sandbox must be built in to be reachable. On a deployment with no
//      VITE_SANDBOX_* vars, getEnv() can only ever return 'prod'.
//   2. The choice lives in sessionStorage, so it dies with the tab. Nobody
//      comes back a week later still pointed at sandbox.
//   3. Anything unrecognised resolves to 'prod'. The safe value is the default.
//   4. Switching reloads the page rather than mutating live state, because a
//      half-swapped client is worse than either endpoint.

export type EnvName = 'prod' | 'sandbox'

const STORAGE_KEY = 'sehat_env'

export interface BackendConfig {
  url: string
  anon: string
}

// Vite inlines import.meta.env at build time, so these are literals in the
// bundle and the sandbox branch drops out entirely when the vars are unset.
const CONFIGS: Record<EnvName, BackendConfig> = {
  prod: {
    url: (import.meta.env.VITE_SUPABASE_URL as string) || '',
    anon: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '',
  },
  sandbox: {
    url: (import.meta.env.VITE_SANDBOX_SUPABASE_URL as string) || '',
    anon: (import.meta.env.VITE_SANDBOX_SUPABASE_ANON_KEY as string) || '',
  },
}

/**
 * Is a sandbox backend configured at all?
 *
 * When false the switcher never renders and getEnv() is pinned to 'prod', so a
 * production deployment cannot be talked into sandbox mode by a stray query
 * param or a leftover storage value.
 */
export const SANDBOX_AVAILABLE = Boolean(CONFIGS.sandbox.url && CONFIGS.sandbox.anon)

/** Token for the sandbox-purge function. Meaningless without the sandbox project. */
export const SANDBOX_PURGE_TOKEN = (import.meta.env.VITE_SANDBOX_PURGE_TOKEN as string) || ''

function readStored(): EnvName {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === 'sandbox' ? 'sandbox' : 'prod'
  } catch {
    // Safari private mode and some embedded webviews throw on storage access.
    return 'prod'
  }
}

/** The active backend for this session. Always 'prod' unless sandbox is both configured and chosen. */
export function getEnv(): EnvName {
  if (!SANDBOX_AVAILABLE) return 'prod'
  return readStored()
}

export const isSandbox = (): boolean => getEnv() === 'sandbox'

/** Config for the active backend — the only place clients should get URL/key from. */
export const activeConfig = (): BackendConfig => CONFIGS[getEnv()]

/**
 * Point this session at a different backend.
 *
 * Reloads rather than updating in place: the Supabase client, any open realtime
 * channel and every cached query would otherwise still be bound to the previous
 * project. A full reload rebuilds all of them from the new choice.
 */
export function switchEnv(env: EnvName): void {
  if (env === 'sandbox' && !SANDBOX_AVAILABLE) return
  try {
    sessionStorage.setItem(STORAGE_KEY, env)
  } catch {
    // If storage is unavailable the choice cannot persist across the reload,
    // so leave the session where it is rather than reloading into confusion.
    return
  }
  window.location.reload()
}

/**
 * Honour ?env=sandbox / ?env=prod once at startup, then strip it from the URL.
 *
 * Lets a tester open the sandbox directly from a link without hunting for the
 * switcher. Stripping matters: a shared or bookmarked URL carrying ?env=sandbox
 * would otherwise silently reselect sandbox on every visit. The param is a
 * request to switch, not a persistent mode.
 *
 * Returns true if a reload was triggered, so callers can skip rendering.
 */
export function applyEnvFromUrl(): boolean {
  if (!SANDBOX_AVAILABLE) return false

  const params = new URLSearchParams(window.location.search)
  const requested = params.get('env')
  if (requested !== 'sandbox' && requested !== 'prod') return false

  params.delete('env')
  const qs = params.toString()
  const cleanUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash

  if (requested === getEnv()) {
    // Already there — just tidy the URL, no reload needed.
    window.history.replaceState({}, '', cleanUrl)
    return false
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, requested)
  } catch {
    return false
  }
  window.location.replace(cleanUrl)
  return true
}
