// razorpay-order — create a Razorpay order for a business's chosen pincodes.
//
// The amount is computed HERE from the pincodes (via the shared computePrice),
// never taken from the client. We create a pending `payments` row and a
// Razorpay order for `monthlyTotal * periodMonths`, then hand the order back to
// the browser to open Razorpay Checkout. Verification happens in razorpay-verify.
//
// Verticals on the commission plan (pharmacy, insurance, ambulance) are rejected
// here — they list free and pay a percentage of billing, so there is no upfront
// amount. The plan is read from the listing's speciality, never from the client.
//
// Request:  { pincodes: string[], doctorId: string, periodMonths?: number }
// Response: { orderId, amount, currency, keyId, paymentRowId, monthlyTotal }
//
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { computePrice } from '../_shared/pricing.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) return json({ error: 'Razorpay not configured' }, 500)

  let body: { pincodes?: unknown; doctorId?: unknown; periodMonths?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const pincodes = Array.isArray(body.pincodes) ? body.pincodes.map(String) : []
  const doctorId = typeof body.doctorId === 'string' ? body.doctorId : null
  const periodMonths = Number.isInteger(body.periodMonths) && (body.periodMonths as number) > 0
    ? (body.periodMonths as number)
    : 1

  if (!pincodes.length) return json({ error: 'no pincodes selected' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Authoritative amount — server computes it, client cannot influence it.
  let priced
  try {
    priced = await computePrice(supabase, pincodes, doctorId)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }

  // Commission verticals (pharmacy, insurance, ambulance) list free and pay a
  // percentage of what they bill — there is nothing to charge upfront. Refuse
  // before writing a payments row so no half-finished order can exist. The
  // vertical here comes from doctors.speciality, not from the request body.
  if (priced.model === 'commission') {
    return json({
      error: 'commission_vertical',
      message: `This listing is on the ${priced.commissionPercent}% commission plan — no upfront payment is taken.`,
      commissionPercent: priced.commissionPercent,
    }, 400)
  }

  if (priced.monthlyTotal <= 0) return json({ error: 'selected pincodes have no billable price' }, 400)

  const amountPaise = priced.monthlyTotal * periodMonths * 100 // Razorpay works in paise

  // Record a pending payment first, so every order is traceable even if the
  // browser never returns from Checkout.
  const { data: pay, error: pErr } = await supabase
    .from('payments')
    .insert({
      doctor_id: doctorId,
      amount: priced.monthlyTotal * periodMonths,
      type: 'listing',
      status: 'pending',
      pin_codes: priced.pincodes,
      period_months: periodMonths,
    })
    .select('id')
    .single()
  if (pErr) return json({ error: `payments insert: ${pErr.message}` }, 500)

  // Create the Razorpay order via their REST API (Basic auth = key:secret).
  const auth = btoa(`${keyId}:${keySecret}`)
  const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: pay.id,
      notes: { payment_row_id: pay.id, doctor_id: doctorId ?? '', pincodes: priced.pincodes.join(',') },
    }),
  })
  const order = await rzpRes.json()
  if (!rzpRes.ok) {
    await supabase.from('payments').update({ status: 'failed' }).eq('id', pay.id)
    return json({ error: 'razorpay order failed', detail: order }, 502)
  }

  await supabase.from('payments').update({ razorpay_order_id: order.id }).eq('id', pay.id)

  return json({
    orderId: order.id,
    amount: amountPaise,
    currency: 'INR',
    keyId,
    paymentRowId: pay.id,
    monthlyTotal: priced.monthlyTotal,
    periodMonths,
  })
})
