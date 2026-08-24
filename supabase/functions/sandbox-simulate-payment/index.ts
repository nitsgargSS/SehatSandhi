// sandbox-simulate-payment — take the money out of the loop, keep everything else.
//
// SANDBOX ONLY. Deploy this to the sandbox project and nowhere else.
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
// The chain from a captured payment to a working dashboard has never once
// executed: razorpay-order → checkout → razorpay-verify → fulfilPayment →
// module flags → the tab appears. The pricing half is verified and the
// entitlement half is verified; the join between them is not, and it is the
// join that decides whether a clinic who paid can admit a patient.
//
// Testing it through Razorpay needs working keys and a card. This does the same
// run WITHOUT the card: it prices the order exactly as razorpay-order does,
// writes the same payment row, and then calls the REAL fulfilPayment — the same
// function razorpay-verify and razorpay-webhook call. Nothing about fulfilment
// is stubbed or reimplemented here, because a test that reimplements the thing
// it is testing proves nothing.
//
// What it does NOT cover, and this matters: Razorpay's signature verification,
// the checkout widget, and whether the amount shown to the customer matches the
// amount captured. Those still need one real test-mode payment before live keys
// go anywhere near production.
//
// ── WHY IT IS SAFE ──────────────────────────────────────────────────────────
// The same three guards as sandbox-purge, which was written as a loaded gun and
// treated like one:
//   1. SANDBOX_PURGE_ENABLED must be 'true'. Production never sets it, so even
//      an accidental `functions deploy` against prod leaves this inert. This is
//      the guard that matters — the other two are for accidents, this one is
//      for the deploy that should not have happened.
//   2. The shared SANDBOX_PURGE_TOKEN must match, compared in constant time.
//   3. The body must carry the literal phrase "SIMULATE PAYMENT", so no stray
//      fetch or replayed URL can activate a listing.
//
// Request:  { token, confirm: "SIMULATE PAYMENT", businessId, modules?, pincodes? }
// Response: { ok, paymentRowId, amount, monthlyTotal, modules, invoiceNumber }
//
// Env: SANDBOX_PURGE_ENABLED, SANDBOX_PURGE_TOKEN, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { computePrice } from '../_shared/pricing.ts'
import { fulfilPayment } from '../_shared/fulfilment.ts'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // ── Guard 1: the project ──
  if (Deno.env.get('SANDBOX_PURGE_ENABLED') !== 'true') {
    return json({ error: 'payment simulation is disabled on this project' }, 403)
  }

  const expectedToken = Deno.env.get('SANDBOX_PURGE_TOKEN')
  if (!expectedToken) return json({ error: 'SANDBOX_PURGE_TOKEN is not configured' }, 500)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  // ── Guard 2: the token ──
  const token = typeof body.token === 'string' ? body.token : ''
  if (!timingSafeEqual(token, expectedToken)) return json({ error: 'forbidden' }, 403)

  // ── Guard 3: the phrase ──
  if (body.confirm !== 'SIMULATE PAYMENT') {
    return json({ error: 'confirm must be exactly "SIMULATE PAYMENT"' }, 400)
  }

  const businessId = typeof body.businessId === 'string' ? body.businessId : ''
  if (!businessId) return json({ error: 'businessId required' }, 400)

  const modules = Array.isArray(body.modules)
    ? (body.modules as unknown[]).filter((m): m is string => typeof m === 'string')
    : []

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: biz } = await supabase
    .from('businesses').select('id, pin_codes, term_end').eq('id', businessId).maybeSingle()
  if (!biz) return json({ error: 'no such business' }, 404)

  // Its own coverage unless the caller overrides — testing a price usually
  // means testing the price this business would actually be charged.
  const pincodes = Array.isArray(body.pincodes) && body.pincodes.length
    ? (body.pincodes as unknown[]).map(String)
    : ((biz as { pin_codes?: string[] }).pin_codes ?? [])
  if (!pincodes.length) return json({ error: 'the business has no pincodes and none were given' }, 400)

  // Priced by the same function razorpay-order uses, so a pricing bug shows up
  // here exactly as it would in a real order.
  let priced
  try {
    priced = await computePrice(supabase, pincodes, businessId, null, 1, null, modules)
  } catch (e) {
    return json({ error: `pricing: ${String((e as Error).message ?? e)}` }, 500)
  }

  const chargeable = priced.tax.applied ? priced.tax.grandTotal : priced.total

  // Renewals continue from the existing term, the same rule razorpay-order
  // applies — so simulating twice extends rather than overlaps.
  const today = new Date()
  const existingEnd = (biz as { term_end?: string | null }).term_end
  const termStart = existingEnd && new Date(existingEnd) > today ? new Date(existingEnd) : today
  const termEnd = new Date(termStart)
  termEnd.setUTCMonth(termEnd.getUTCMonth() + 1)

  // Marked in the id itself, so a simulated payment is obvious in the ledger
  // and can never be mistaken for money that actually arrived.
  const fakeOrderId = `order_SANDBOX_SIM_${crypto.randomUUID().slice(0, 12)}`
  const fakePaymentId = `pay_SANDBOX_SIM_${crypto.randomUUID().slice(0, 12)}`

  const { data: pay, error: pErr } = await supabase
    .from('payments')
    .insert({
      business_id: businessId,
      amount: chargeable,
      type: 'listing',
      status: 'pending',
      pin_codes: priced.pincodes,
      period_months: 1,
      pricing_plan_code: priced.planCode,
      pricing_mode: priced.mode,
      monthly_price: priced.monthlyTotal,
      modules: priced.modules.map((m) => m.code),
      term_start: isoDate(termStart),
      term_end: isoDate(termEnd),
      taxable_value: priced.tax.taxableValue,
      gst_rate: priced.tax.applied ? priced.tax.rate : 0,
      cgst_amount: priced.tax.cgst,
      sgst_amount: priced.tax.sgst,
      igst_amount: priced.tax.igst,
      tax_total: priced.tax.taxTotal,
      place_of_supply: priced.tax.placeOfSupply,
      razorpay_order_id: fakeOrderId,
    })
    .select('id')
    .single()

  if (pErr) return json({ error: `payments insert: ${pErr.message}` }, 500)

  // THE POINT OF THE EXERCISE. Not a copy of fulfilment — fulfilment itself,
  // the same call razorpay-verify makes when a browser comes back.
  const result = await fulfilPayment(supabase, {
    orderId: fakeOrderId,
    paymentId: fakePaymentId,
    paymentRowId: pay.id,
  })

  if (!result.ok) return json({ ok: false, error: result.error, paymentRowId: pay.id }, 500)

  return json({
    ok: true,
    simulated: true,
    paymentRowId: pay.id,
    amount: chargeable,
    monthlyTotal: priced.monthlyTotal,
    moduleTotal: priced.moduleTotal,
    modules: priced.modules.map((m) => m.code),
    termStart: isoDate(termStart),
    termEnd: isoDate(termEnd),
    invoiceNumber: result.invoiceNumber ?? null,
    invoiceError: result.invoiceError ?? null,
  })
})
