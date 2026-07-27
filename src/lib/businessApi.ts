import { activeConfig } from './env'

// Client wrappers for the business Edge Functions. Pricing is always fetched
// from the server (compute-price) — the wizard uses the returned total for
// display AND the same server recomputes it for the Razorpay charge, so the
// two can't diverge and the client can't tamper with the amount.

export type PricingMode = 'flat_all_pincodes' | 'flat_per_pincode' | 'pincode_tiers'

export interface PriceLine {
  pin_code: string
  area_name: string
  population: number
  tier_number: number
  tier_name: string
  monthly_price: number
}

export interface PriceResult {
  pincodes: string[]
  count: number
  residents: number
  topTier: { tier_number: number; tier_name: string } | null
  breakdown: PriceLine[]

  /** Which pricing plan produced this quote. */
  planCode: string | null
  planLabel: string | null
  mode: PricingMode

  /** Money is always a monthly rate times a term. total = monthlyTotal × months. */
  monthlyTotal: number
  months: number
  total: number
  defaultMonths: number
  minMonths: number
  maxMonths: number

  /** Commission is independent of the monthly fee — a vertical can owe both. */
  monthlyApplies: boolean
  commissionPercent: number
  commissionBasis: string | null
  commissionSuspended: boolean
}

// Resolved per call from env.ts, not captured at module load, so these requests
// always hit the same backend the Supabase client is writing to. Reading
// import.meta.env directly here would let the two drift apart — creating
// listing rows in one project while charging through another's Razorpay keys.
async function callFn<T>(name: string, payload: unknown): Promise<T> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error(`${name} unavailable: Supabase is not configured`)

  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    // The edge functions return a JSON body explaining the refusal (e.g.
    // commission_vertical, or a month-bound violation). Surfacing it turns an
    // opaque "failed: 400" into something a tester can act on.
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.message || body?.error || ''
    } catch { /* non-JSON error body */ }
    throw new Error(detail ? `${name} failed: ${detail}` : `${name} failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

// `vertical` is a quote-time hint so a pharmacy sees its own terms before its
// listing row exists. Once doctorId is known the server reads the vertical off
// that row instead, so the hint can never change what's charged. `months` is
// clamped server-side to the active plan's bounds.
export const computePrice = (
  pincodes: string[],
  doctorId?: string | null,
  vertical?: string | null,
  months?: number | null,
) => callFn<PriceResult>('compute-price', { pincodes, doctorId, vertical, months })

export interface RazorpayOrder {
  orderId: string
  amount: number
  currency: string
  keyId: string
  paymentRowId: string
  monthlyTotal: number
  periodMonths: number
  total: number
  planCode: string | null
  planLabel: string | null
  termStart: string
  termEnd: string
}

export const createRazorpayOrder = (pincodes: string[], doctorId: string, periodMonths = 1) =>
  callFn<RazorpayOrder>('razorpay-order', { pincodes, doctorId, periodMonths })

export const verifyRazorpayPayment = (args: {
  orderId: string
  paymentId: string
  signature: string
  paymentRowId?: string
}) => callFn<{ ok: boolean; status?: string; error?: string }>('razorpay-verify', args)

// ── Admin pricing writes ──
// These never go over the anon key: VITE_ADMIN_PASS ships in the public bundle,
// so an anon write policy on pricing would let anyone re-price the platform. The
// edge function holds a server-only key, which the admin types once per session.
export const adminPricing = <T>(key: string, action: string, args: Record<string, unknown> = {}) =>
  callFn<T>('admin-pricing', { key, action, actor: 'admin', ...args })

// Lazily inject the Razorpay Checkout script (self-contained; no bundler dep).
let rzpLoading: Promise<void> | null = null
export function loadRazorpayCheckout(): Promise<void> {
  if ((window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve()
  if (rzpLoading) return rzpLoading
  rzpLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Razorpay Checkout failed to load'))
    document.body.appendChild(s)
  })
  return rzpLoading
}

// Are the business/payment Edge Functions reachable? Used to gracefully hide
// the "Pay with Razorpay" path in a dev setup with no Supabase configured.
// A function, not a constant: the answer depends on which backend is active,
// and that is only known at render time.
export const businessBackendConfigured = (): boolean => {
  const { url, anon } = activeConfig()
  return Boolean(url && anon)
}

/**
 * Wipe all user-generated data from the sandbox database.
 *
 * Only ever reaches the sandbox project — the function is deployed there and
 * stays inert anywhere SANDBOX_PURGE_ENABLED is unset. Reference data
 * (pricing, service areas) is preserved; see supabase/tables.config.yaml.
 */
export const purgeSandbox = (token: string) =>
  callFn<{ ok: boolean; results: Record<string, string>; authUsersDeleted?: number }>(
    'sandbox-purge',
    { token, confirm: 'PURGE SANDBOX' },
  )
