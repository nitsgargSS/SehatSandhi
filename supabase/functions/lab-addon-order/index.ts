// lab-addon-order — buy an in-clinic test add-on (0178) for a plan already paid.
//
// Pathology and Radiology cost addon_prices.monthly_price a month (₹1,000 to
// start, editable in the admin). Bought mid-term they are charged for the rest
// of the plan term, pro rata by days — as an extra doctor and WhatsApp are —
// then renewed with the plan (computePrice reads businesses.renewal_addons).
// The free Heart tests & X-ray group needs no payment: the owner switches it on.
//
//   Monthly plan, 10 of 30 days left, ₹1,000/month  →  ₹333 + GST
//
// Request:  { businessId, code: 'pathology' | 'radiology', action: 'quote' | 'order' }
//   quote → { ok, code, label, termMonths, termLabel, termStart, termEnd, daysLeft,
//             daysInTerm, monthly, fullFee, amount, tax, lineItems }
//   order → the quote plus { orderId, amountPaise, currency, keyId, paymentRowId }
//
// Signed-in owner or manager only; clinics and hospitals (a lab is its kind).
// Fulfilment is the shared one: subscription_amount 0 leaves the plan alone,
// and addon_codes switches the add-on on (sehat_grant_paid_addons).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { resolveActivePlan, termLabel } from '../_shared/pricing.ts'
import { applyGst, extractGst, resolveRecipientState, resolveTaxSettings } from '../_shared/tax.ts'

const DAY = 86_400_000
/** Today in India, as a UTC-midnight date, so day counts match the calendar. */
function todayIst(): Date {
  const d = new Date(Date.now() + 5.5 * 3_600_000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { businessId?: unknown; code?: unknown; action?: unknown }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const businessId = typeof body.businessId === 'string' ? body.businessId : ''
  const code = body.code === 'pathology' || body.code === 'radiology' ? body.code : ''
  const action = body.action === 'order' ? 'order' : 'quote'
  if (!businessId) return json({ error: 'businessId required' }, 400)
  if (!code) return json({ error: "code must be 'pathology' or 'radiology'" }, 400)

  const who = caller(req)
  if (!who) return json({ error: 'Please sign in.' }, 401)
  const db = who.asService
  if (!who.isServiceRole) {
    const { data: role, error } = await who.asCaller.rpc('sehat_caller_role', { p_business: businessId })
    if (error) return json({ error: error.message }, 500)
    if (role !== 'owner' && role !== 'manager') {
      return json({ error: 'Only the business’s owner or manager can buy add-ons.' }, 403)
    }
  }

  const { data: b, error: bErr } = await db.from('businesses')
    .select('id, name, vertical, status, months_paid, term_start, term_end, lab_categories')
    .eq('id', businessId).maybeSingle()
  if (bErr) return json({ error: bErr.message }, 500)
  if (!b) return json({ error: 'no such business' }, 404)

  if (b.vertical === 'lab') {
    return json({ error: 'not_for_labs', message: 'A lab chooses its kind under Lab & team; add-ons are for clinics and hospitals.' }, 409)
  }

  // ── Is there a paid term to add it to? ──
  const today = todayIst()
  const end = b.term_end ? new Date(`${String(b.term_end).slice(0, 10)}T00:00:00Z`) : null
  if (b.status !== 'active' || !end || end.getTime() <= today.getTime()) {
    return json({ error: 'no_active_term', message: 'Your plan is not active. Renew your plan first, then add this.' }, 409)
  }

  // ── Not already on ──
  if (((b.lab_categories ?? []) as string[]).includes(code)) {
    return json({ error: 'already_active', message: 'This add-on is already on.' }, 409)
  }

  // ── The price, per month, for the term the business is on ──
  const { data: ap } = await db.from('addon_prices').select('label, monthly_price, is_enabled').eq('code', code).maybeSingle()
  if (!ap || !ap.is_enabled) return json({ error: 'not_offered', message: 'This add-on is not offered at the moment.' }, 409)
  const monthly = Number(ap.monthly_price ?? 0)
  if (!(monthly > 0)) {
    return json({ error: 'free', message: 'This add-on is free — switch it on from Add-ons.' }, 409)
  }
  const termMonths = [1, 3, 6, 12].includes(Number(b.months_paid)) ? Number(b.months_paid) : 1
  const fullFee = monthly * termMonths

  // Pro rata by days. The term is the one on the listing; if its start is
  // missing, it is the term's length back from its end.
  const start = b.term_start
    ? new Date(`${String(b.term_start).slice(0, 10)}T00:00:00Z`)
    : (() => { const d = new Date(end); d.setUTCMonth(d.getUTCMonth() - termMonths); return d })()
  const daysInTerm = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY))
  const daysLeft = Math.min(daysInTerm, Math.max(1, Math.round((end.getTime() - today.getTime()) / DAY)))
  const amount = Math.max(1, Math.round(fullFee * daysLeft / daysInTerm))

  const [plan, taxSettings, recipientState] = await Promise.all([
    resolveActivePlan(db), resolveTaxSettings(db), resolveRecipientState(db, businessId),
  ])
  const tax = plan.price_includes_gst
    ? extractGst(amount, taxSettings, recipientState)
    : applyGst(amount, taxSettings, recipientState)

  const label = termLabel(termMonths)
  const lineItems = [{
    label: `${ap.label} add-on — ₹${monthly}/month × ${termMonths}, ${daysLeft} of ${daysInTerm} days (${isoDate(today)} to ${isoDate(end)})`,
    amount,
  }]
  const quote = {
    ok: true, code, label: ap.label, termMonths, termLabel: label, termStart: isoDate(today), termEnd: isoDate(end),
    daysLeft, daysInTerm, monthly, fullFee, amount, tax, lineItems,
  }
  if (action === 'quote') return json(quote)

  // ── Order ──
  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) return json({ error: 'Razorpay not configured' }, 500)

  const { data: pay, error: pErr } = await db.from('payments').insert({
    business_id: businessId,
    amount: tax.grandTotal,
    type: 'listing',
    status: 'pending',
    period_months: termMonths,
    term_start: isoDate(today),
    term_end: isoDate(end),
    taxable_value: tax.taxableValue,
    gst_rate: tax.applied ? tax.rate : 0,
    cgst_amount: tax.cgst,
    sgst_amount: tax.sgst,
    igst_amount: tax.igst,
    tax_total: tax.taxTotal,
    place_of_supply: tax.placeOfSupply,
    subscription_amount: 0,
    whatsapp_addon: false,
    addon_codes: [code],
    coupon_discount: 0,
    line_items: lineItems,
  }).select('id').single()
  if (pErr) return json({ error: `payments insert: ${pErr.message}` }, 500)

  const amountPaise = Math.round(tax.grandTotal * 100)
  const rzp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountPaise, currency: 'INR', receipt: pay.id,
      notes: { payment_row_id: pay.id, business_id: businessId, kind: 'lab_addon', addon: code },
    }),
  })
  const order = await rzp.json()
  if (!rzp.ok) {
    await db.from('payments').update({ status: 'failed' }).eq('id', pay.id)
    return json({ error: 'razorpay order failed', detail: order }, 502)
  }
  await db.from('payments').update({ razorpay_order_id: order.id }).eq('id', pay.id)

  return json({ ...quote, orderId: order.id, amountPaise, currency: 'INR', keyId, paymentRowId: pay.id })
})
