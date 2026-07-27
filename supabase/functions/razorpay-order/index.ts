// razorpay-order — create a Razorpay order for a business's chosen coverage.
//
// The amount is computed HERE from the active pricing plan (via the shared
// computePrice), never taken from the client. A business may pay several months
// upfront, so the charge is monthlyTotal × months, with months clamped to what
// the plan allows. We create a pending `payments` row stamped with the plan and
// the term it covers, then hand the order back to the browser to open Razorpay
// Checkout. Verification happens in razorpay-verify, which is where the price
// gets locked onto the listing.
//
// Verticals with no monthly fee (a commission-only vertical, when no flat plan
// covers it) are rejected here — there is nothing to charge upfront. The plan
// and the vertical both come from the server, never from the request body.
//
// Request:  { pincodes: string[], doctorId: string, periodMonths?: number }
// Response: { orderId, amount, currency, keyId, paymentRowId, monthlyTotal,
//             periodMonths, total, planCode, termStart, termEnd }
//
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { computePrice } from '../_shared/pricing.ts'

// Term dates are whole calendar months from the start date.
function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

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
  const requestedMonths = Number.isFinite(body.periodMonths) ? Number(body.periodMonths) : null

  if (!pincodes.length) return json({ error: 'no pincodes selected' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Authoritative amount — server computes it, client cannot influence it.
  // computePrice clamps the requested months to the plan's min/max.
  let priced
  try {
    priced = await computePrice(supabase, pincodes, doctorId, null, requestedMonths)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }

  // Nothing to charge: a commission-only vertical with no flat plan covering it.
  // Refuse before writing a payments row so no half-finished order can exist.
  if (!priced.monthlyApplies) {
    return json({
      error: 'commission_vertical',
      message: priced.commissionPercent > 0
        ? `This listing is on the ${priced.commissionPercent}% commission plan — no upfront payment is taken.`
        : 'This listing has no monthly fee, so there is nothing to pay upfront.',
      commissionPercent: priced.commissionPercent,
    }, 400)
  }

  if (priced.monthlyTotal <= 0) {
    return json({ error: 'selected pincodes have no billable price' }, 400)
  }

  const months = priced.months
  const amountPaise = priced.total * 100   // total = monthlyTotal × months

  // The term this payment buys. A renewal continues from the existing term_end
  // rather than from today, so paying late costs no extra days and paying early
  // loses none.
  const today = new Date()
  let termStart = today
  if (doctorId) {
    const { data: doc } = await supabase
      .from('doctors').select('term_end').eq('id', doctorId).maybeSingle()
    const existingEnd = (doc as { term_end?: string } | null)?.term_end
    if (existingEnd) {
      const end = new Date(`${existingEnd}T00:00:00Z`)
      if (end.getTime() > today.getTime()) termStart = end
    }
  }
  const termEnd = addMonths(termStart, months)

  // Record a pending payment first, so every order is traceable even if the
  // browser never returns from Checkout. The plan is stamped here so the charge
  // can be reconciled after prices change.
  const { data: pay, error: pErr } = await supabase
    .from('payments')
    .insert({
      doctor_id: doctorId,
      amount: priced.total,
      type: 'listing',
      status: 'pending',
      pin_codes: priced.pincodes,
      period_months: months,
      pricing_plan_code: priced.planCode,
      pricing_mode: priced.mode,
      monthly_price: priced.monthlyTotal,
      term_start: isoDate(termStart),
      term_end: isoDate(termEnd),
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
      notes: {
        payment_row_id: pay.id,
        doctor_id: doctorId ?? '',
        pincodes: priced.pincodes.join(','),
        plan: priced.planCode ?? '',
        months: String(months),
      },
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
    periodMonths: months,
    total: priced.total,
    planCode: priced.planCode,
    planLabel: priced.planLabel,
    termStart: isoDate(termStart),
    termEnd: isoDate(termEnd),
  })
})
