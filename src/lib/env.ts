// Which backend this build talks to.
//
// It used to be a runtime choice: one bundle carried BOTH projects' credentials
// and a switcher picked between them, storing the answer in sessionStorage. That
// bought convenience — one URL, flip to sandbox, test, flip back — at a price
// that got steeper the longer it stayed:
//
//   • Both projects' anon keys shipped to every visitor, so production served
//     the sandbox keys and sandbox served production's.
//   • Which database you were writing to depended on a storage value you could
//     not see. A tab that had ever visited ?env=sandbox stayed there, and a new
//     tab silently did not.
//   • Every module that touched a backend had to ask getEnv() and agree, or you
//     got a split brain: listing rows written to one project while the payment
//     functions were called on the other.
//
// Now the deployment decides. Each Vercel environment carries its own
// VITE_SUPABASE_* pair — staging points at the sandbox project, production at
// the production one — so a build has exactly one backend, and it is the one
// whoever deployed it chose. Nothing in the browser can move it.

export interface BackendConfig {
  url: string
  anon: string
}

// Vite inlines import.meta.env at build time, so these are literals in the
// bundle: only the keys for this deployment's own project are ever shipped.
const CONFIG: BackendConfig = {
  url: (import.meta.env.VITE_SUPABASE_URL as string) || '',
  anon: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '',
}

/**
 * Is this a staging build?
 *
 * Gates the testing affordances — signup autofill, the sandbox purge panel, the
 * login code shown on screen — that must never appear in front of a real
 * patient. Set VITE_IS_STAGING=true on the staging deployment only; anywhere
 * else the checks below are false and the code they guard is dropped from the
 * bundle by dead-code elimination.
 *
 * Deliberately not derived from the hostname: a preview URL, a custom domain or
 * a local `vite preview` would each need their own special case, and getting one
 * wrong shows test tooling to the public.
 */
export const IS_STAGING = String(import.meta.env.VITE_IS_STAGING) === 'true'

/** Token for the sandbox-purge function. Only meaningful on staging. */
export const SANDBOX_PURGE_TOKEN = (import.meta.env.VITE_SANDBOX_PURGE_TOKEN as string) || ''

/** The backend for this build — the only place clients should get URL/key from. */
export const activeConfig = (): BackendConfig => CONFIG
