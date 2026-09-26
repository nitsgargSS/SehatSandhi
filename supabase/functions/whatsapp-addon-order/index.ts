// whatsapp-addon-order — add WhatsApp to a plan that is already paid for.
//
// A business that registered without WhatsApp and wants it later used to be
// sent to the renewal screen, which charged the next plan term as well as the
// WhatsApp fee — paying ₹2,000 again for a month already paid. Decided
// 26 Sep 2026: adding WhatsApp mid-term charges the WhatsApp fee alone, for the
// plan term the business is on, pro rata for the days left in it. It then ends
// with the plan and renews with it.
//
//   Monthly plan, 10 of 30 days left, ₹500 fee  →  ₹167 + GST
//
// Request:  { businessId, action: 'quote' | 'order' }
//   quote → { ok, termMonths, termLabel, termStart, termEnd, daysLeft, daysInTerm,
//             fullFee, amount, tax, lineItems }
//   order → the quote plus { orderId, amount (paise), currency, keyId, paymentRowId }
//
// Signed-in owner or manager only. Fulfilment is the shared one: the payment
// has subscription_amount 0 and whatsapp_addon true, which leaves the plan alone,
// switches WhatsApp on until term_end, and invoices the line below.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { resolveActivePlan, resolveTypeTerms, termLabel } from '../_shared/pricing.ts'
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

  let body: { businessId?: unknown; action?: unknown }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const businessId = typeof body.businessId === 'string' ? body.businessId : ''
  const action = body.action === 'order' ? 'order' : 'quote'
  if (!businessId) return json({ error: 'businessId required' }, 400)

  const who = caller(req)
  if (!who) return json({ error: 'Please sign in.' }, 401)
  const db = who.asService
  if (!who.isServiceRole) {
    const { data: role, error } = await who.asCaller.rpc('sehat_caller_role', { p_business: businessId })
    if (error) return json({ error: error.message }, 500)
    if (role !== 'owner' && role !== 'manager') {
      return json({ error: 'Only the business’s owner or manager can add WhatsApp.' }, 403)
    }
  }

  const { data: b, error: bErr } = await db.from('businesses')
    .select('id, name, vertical, status, months_paid, term_start, term_end')
    .eq('id', businessId).maybeSingle()
  if (bErr) return json({ error: bErr.message }, 500)
  if (!b) return json({ error: 'no such business' }, 404)

  // ── Is there a paid term to add it to? ──
  const today = todayIst()
  const end = b.term_end ? new Date(`${String(b.term_end).slice(0, 10)}T00:00:00Z`) : null
  if (b.status !== 'active' || !end || end.getTime() <= today.getTime()) {
    return json({ error: 'no_active_term', message: 'Your plan is not active. Renew your plan and tick WhatsApp there.' }, 409)
  }

  // ── Not already on for this term ──
  const { data: acct } = await db.from('business_wa_accounts')
    .select('subscription_status, next_billing_date').eq('business_id', businessId).maybeSingle()
  const waEnd = acct?.next_billing_date ? new Date(`${String(acct.next_billing_date).slice(0, 10)}T00:00:00Z`) : null
  if (acct && acct.subscription_status !== 'inactive' && (!waEnd || waEnd.getTime() >= end.getTime())) {
    return json({ error: 'already_active', message: 'WhatsApp is already included until your plan ends.' }, 409)
  }

  // ── The fee for the term the business is on ──
  const termMonths = [1, 3, 6, 12].includes(Number(b.months_paid)) ? Number(b.months_paid) : 1
  const terms = await resolveTypeTerms(db, b.vertical)
  const term = terms.find(t => t.months === termMonths)
  const fullFee = Number(term?.whatsapp_price ?? 0)
  if (!(fullFee > 0)) {
    return json({ error: 'not_offered', message: 'WhatsApp is not offered for this business type.' }, 409)
  }

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
    label: `WhatsApp Business Verification & Activation Fee — ${label}, ${daysLeft} of ${daysInTerm} days (${isoDate(today)} to ${isoDate(end)})`,
    amount,
  }]
  const quote = {
    ok: true, termMonths, termLabel: label, termStart: isoDate(today), termEnd: isoDate(end),
    daysLeft, daysInTerm, fullFee, amount, tax, lineItems,
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
    whatsapp_addon: true,
    whatsapp_amount: amount,
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
      notes: { payment_row_id: pay.id, business_id: businessId, kind: 'whatsapp_addon' },
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
