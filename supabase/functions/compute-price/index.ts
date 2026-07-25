// compute-price — authoritative, server-side pricing for a set of pincodes.
//
// The onboarding wizard shows a live total as the business taps pincodes, but
// that client total is NEVER trusted for payment. This function is the single
// source of truth: given pincodes it joins service_areas → pricing_tiers on the
// server (service-role key, bypassing RLS) and returns the exact monthly total,
// reach, and top tier. razorpay-order shares the same computePrice(), so the
// amount charged always matches what the wizard displays.
//
// Request:  { pincodes: string[], doctorId?: string }
// Response: PriceResult (see _shared/pricing.ts)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { computePrice } from '../_shared/pricing.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { pincodes?: unknown; doctorId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const pincodes = Array.isArray(body.pincodes) ? body.pincodes.map(String) : []
  const doctorId = typeof body.doctorId === 'string' ? body.doctorId : null

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const result = await computePrice(supabase, pincodes, doctorId)
    return json(result)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
