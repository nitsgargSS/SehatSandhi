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
// The amount charged INCLUDES GST when tax_settings has it enabled: the plan
// price is the taxable value and 18% is added on top (or backed out, for a plan
// quoted inclusive). The breakdown is stored on the payments row, and
// razorpay-verify turns it into an invoice.
//
// Response: { orderId, amount, currency, keyId, paymentRowId, monthlyTotal,
//             periodMonths, total, tax, planCode, termStart, termEnd }
//
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { computePrice } from '../_shared/pricing.ts'

/**
 * The GSTIN's own check digit, over the first 14 characters.
 *
 * Mirrors gstinCheckDigit in src/hooks/useTaxSettings.ts. A shape check alone
 * accepts a mistyped state code — a wrong first two digits nearly reached our
 * own invoices, and it is the same mistake a customer can make.
 */
function gstinCheckDigit(first14: string): string {
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = charset.indexOf(first14[i])
    if (value < 0) return ''
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return charset[(36 - (sum % 36)) % 36]
}

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

  let body: {
    pincodes?: unknown; doctorId?: unknown; periodMonths?: unknown
    gstin?: unknown; gstLegalName?: unknown; billingAddress?: unknown
  }
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

  // ── The buyer's own GST details, optional ────────────────────────────────
  // Written BEFORE the price is computed, because computePrice resolves the
  // recipient's state from this row to decide CGST+SGST versus IGST. Setting it
  // afterwards would tax the sale as intra-state and then print an inter-state
  // invoice — the money moved and the invoice would disagree.
  //
  // Validated here rather than trusting the client: this number goes on a tax
  // invoice, and a business that cannot claim the input credit because of a
  // typo has paid 18% for nothing.
  const rawGstin = typeof body.gstin === 'string' ? body.gstin.trim().toUpperCase() : ''
  if (rawGstin && doctorId) {
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(rawGstin)) {
      return json({ error: 'That GSTIN is not 15 characters in the expected format.' }, 400)
    }
    const expected = gstinCheckDigit(rawGstin.slice(0, 14))
    if (expected !== rawGstin[14]) {
      return json({
        error: `${rawGstin} fails its own check digit — please re-check it against your GST certificate.`,
      }, 400)
    }

    const patch: Record<string, unknown> = {
      gstin: rawGstin,
      state_code: rawGstin.slice(0, 2),
    }
    if (typeof body.gstLegalName === 'string' && body.gstLegalName.trim()) {
      patch.gst_legal_name = body.gstLegalName.trim()
    }
    if (typeof body.billingAddress === 'string' && body.billingAddress.trim()) {
      patch.billing_address = body.billingAddress.trim()
    }

    const { error: gstErr } = await supabase.from('doctors').update(patch).eq('id', doctorId)
    if (gstErr) return json({ error: `could not save GST details: ${gstErr.message}` }, 500)
  }

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
  // GST is charged on top unless the plan is quoted inclusive; either way
  // tax.grandTotal is the figure to take. Paise, because Razorpay works in paise
  // and rupee floats would drift a paisa from the invoice.
  const chargeable = priced.tax.grandTotal
  const amountPaise = Math.round(chargeable * 100)

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
      // amount is the grand total actually taken, so anything reading it sees
      // real money. The pre-tax figure lives in taxable_value.
      amount: chargeable,
      type: 'listing',
      status: 'pending',
      pin_codes: priced.pincodes,
      period_months: months,
      pricing_plan_code: priced.planCode,
      pricing_mode: priced.mode,
      monthly_price: priced.monthlyTotal,
      term_start: isoDate(termStart),
      term_end: isoDate(termEnd),
      taxable_value: priced.tax.taxableValue,
      gst_rate: priced.tax.applied ? priced.tax.rate : 0,
      cgst_amount: priced.tax.cgst,
      sgst_amount: priced.tax.sgst,
      igst_amount: priced.tax.igst,
      tax_total: priced.tax.taxTotal,
      place_of_supply: priced.tax.placeOfSupply,
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
    tax: priced.tax,
    planCode: priced.planCode,
    planLabel: priced.planLabel,
    termStart: isoDate(termStart),
    termEnd: isoDate(termEnd),
  })
})
