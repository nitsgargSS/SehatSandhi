import { supabase } from './supabase'

// Client wrappers for the business Edge Functions. Pricing is always fetched
// from the server (compute-price) — the wizard uses the returned total for
// display AND the same server recomputes it for the Razorpay charge, so the
// two can't diverge and the client can't tamper with the amount.

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
  monthlyTotal: number
  residents: number
  topTier: { tier_number: number; tier_name: string } | null
  breakdown: PriceLine[]
}

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
  : ''
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function callFn<T>(name: string, payload: unknown): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`${name} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export const computePrice = (pincodes: string[], doctorId?: string | null) =>
  callFn<PriceResult>('compute-price', { pincodes, doctorId })

export interface RazorpayOrder {
  orderId: string
  amount: number
  currency: string
  keyId: string
  paymentRowId: string
  monthlyTotal: number
  periodMonths: number
}

export const createRazorpayOrder = (pincodes: string[], doctorId: string, periodMonths = 1) =>
  callFn<RazorpayOrder>('razorpay-order', { pincodes, doctorId, periodMonths })

export const verifyRazorpayPayment = (args: {
  orderId: string
  paymentId: string
  signature: string
  paymentRowId?: string
}) => callFn<{ ok: boolean; status?: string; error?: string }>('razorpay-verify', args)

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
export const businessBackendConfigured = Boolean(FUNCTIONS_URL && ANON)
