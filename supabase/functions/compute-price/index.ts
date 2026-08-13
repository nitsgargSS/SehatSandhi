// compute-price — authoritative, server-side pricing for a set of pincodes.
//
// The onboarding wizard shows a live total as the business taps pincodes, but
// that client total is NEVER trusted for payment. This function is the single
// source of truth: given pincodes it joins service_areas → pricing_tiers on the
// server (service-role key, bypassing RLS) and returns the exact monthly total,
// reach, and top tier. razorpay-order shares the same computePrice(), so the
// amount charged always matches what the wizard displays.
//
// The response also carries the active pricing plan and the billing shape it
// implies: a flat monthly price covering every pincode, a flat price per pincode,
// or population-tier pricing — times the number of months being bought upfront.
// Commission is reported separately, since a vertical can owe both or neither.
//
// Request:  { pincodes: string[], businessId?: string, vertical?: string, months?: number,
//             doctorCount?: number }
// Response: PriceResult (see _shared/pricing.ts)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { computePrice } from '../_shared/pricing.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: {
    pincodes?: unknown; businessId?: unknown; vertical?: unknown
    months?: unknown; doctorCount?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const pincodes = Array.isArray(body.pincodes) ? body.pincodes.map(String) : []
  const businessId = typeof body.businessId === 'string' ? body.businessId : null
  // Quote-time hint only: pre-signup there's no row to read the vertical from.
  // Ignored whenever businessId resolves, and it never decides an amount charged.
  const vertical = typeof body.vertical === 'string' ? body.vertical : null
  // Clamped server-side to the plan's min/max, so a hand-crafted request cannot
  // buy 999 months at the launch rate.
  const months = Number.isFinite(body.months) ? Number(body.months) : null

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // Hint only, and only while there is no listing to count — see computePrice.
    const doctorCount = Number.isFinite(body.doctorCount) ? Number(body.doctorCount) : null
    const result = await computePrice(supabase, pincodes, businessId, vertical, months, doctorCount)
    return json(result)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
