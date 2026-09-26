// doctor-addon-order — pay for a doctor added mid-term (0140).
//
// A doctor who takes a business past the doctors its plan includes is held
// (business_practitioners.awaiting_payment) until this is paid: the extra
// doctor's monthly fee × the months of the current term, pro rata for the days
// left in it. Fulfilment (_shared/fulfilment.ts) then releases the doctor. From
// the next renewal the doctor is in the normal price.
//
//   Hospital, monthly term, 20 of 30 days left, ₹1,000 a doctor  →  ₹667 + GST
//
// Request:  { businessId, practitionerId, action: 'quote' | 'order' }
// Owner or manager only.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { resolveActivePlan, termLabel } from '../_shared/pricing.ts'
import { applyGst, extractGst, resolveRecipientState, resolveTaxSettings } from '../_shared/tax.ts'

const DAY = 86_400_000
function todayIst(): Date {
  const d = new Date(Date.now() + 5.5 * 3_600_000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { businessId?: unknown; practitionerId?: unknown; action?: unknown }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const businessId = typeof body.businessId === 'string' ? body.businessId : ''
  const practitionerId = typeof body.practitionerId === 'string' ? body.practitionerId : ''
  const action = body.action === 'order' ? 'order' : 'quote'
  if (!businessId || !practitionerId) return json({ error: 'businessId and practitionerId required' }, 400)

  const who = caller(req)
  if (!who || who.isServiceRole) return json({ error: 'Please sign in.' }, 401)
  const { data: role, error: rErr } = await who.asCaller.rpc('sehat_caller_role', { p_business: businessId })
  if (rErr) return json({ error: rErr.message }, 500)
  if (role !== 'owner' && role !== 'manager') {
    return json({ error: 'Only the owner or a manager can pay for a doctor.' }, 403)
  }
  const db = who.asService

  const { data: aff } = await db.from('business_practitioners')
    .select('awaiting_payment, practitioners(full_name)')
    .eq('business_id', businessId).eq('practitioner_id', practitionerId).maybeSingle()
  if (!aff?.awaiting_payment) return json({ error: 'nothing_due', message: 'This doctor is not waiting for payment.' }, 409)
  const name = (aff.practitioners as { full_name?: string } | null)?.full_name ?? 'Doctor'

  const { data: b } = await db.from('businesses')
    .select('status, months_paid, term_start, term_end').eq('id', businessId).maybeSingle()
  const today = todayIst()
  const end = b?.term_end ? new Date(`${String(b.term_end).slice(0, 10)}T00:00:00Z`) : null
  if (!b || b.status !== 'active' || !end || end.getTime() <= today.getTime()) {
    return json({ error: 'no_active_term', message: 'Your plan is not running, so this doctor is added at your next payment.' }, 409)
  }

  const { data: monthly } = await db.rpc('sehat_extra_doctor_monthly', { p_business: businessId, p_practitioner: practitionerId })
  const perMonth = Number(monthly ?? 0)
  if (!(perMonth > 0)) {
    // Nothing is owed any more (another doctor left meanwhile): just release.
    await db.rpc('sehat_release_paid_doctor', { p_business: businessId, p_practitioner: practitionerId })
    return json({ error: 'released', message: `${name} is live — no extra fee is due.` }, 409)
  }

  const termMonths = Math.max(1, Number(b.months_paid) || 1)
  const start = b.term_start
    ? new Date(`${String(b.term_start).slice(0, 10)}T00:00:00Z`)
    : (() => { const d = new Date(end); d.setUTCMonth(d.getUTCMonth() - termMonths); return d })()
  const daysInTerm = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY))
  const daysLeft = Math.min(daysInTerm, Math.max(1, Math.round((end.getTime() - today.getTime()) / DAY)))
  const fullTerm = perMonth * termMonths
  const amount = Math.max(1, Math.round(fullTerm * daysLeft / daysInTerm))

  const [plan, taxSettings, recipientState] = await Promise.all([
    resolveActivePlan(db), resolveTaxSettings(db), resolveRecipientState(db, businessId),
  ])
  const tax = plan.price_includes_gst ? extractGst(amount, taxSettings, recipientState) : applyGst(amount, taxSettings, recipientState)
  const lineItems = [{
    label: `Additional doctor — ${name}, ${termLabel(termMonths)}, ${daysLeft} of ${daysInTerm} days (${isoDate(today)} to ${isoDate(end)})`,
    amount,
  }]
  const quote = { ok: true, doctor: name, perMonth, termMonths, termLabel: termLabel(termMonths), termEnd: isoDate(end),
                  daysLeft, daysInTerm, fullTerm, amount, tax, lineItems }
  if (action === 'quote') return json(quote)

  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) return json({ error: 'Razorpay not configured' }, 500)

  const { data: pay, error: pErr } = await db.from('payments').insert({
    business_id: businessId, amount: tax.grandTotal, type: 'listing', status: 'pending',
    period_months: termMonths, term_start: isoDate(today), term_end: isoDate(end),
    taxable_value: tax.taxableValue, gst_rate: tax.applied ? tax.rate : 0,
    cgst_amount: tax.cgst, sgst_amount: tax.sgst, igst_amount: tax.igst, tax_total: tax.taxTotal,
    place_of_supply: tax.placeOfSupply,
    subscription_amount: 0, whatsapp_addon: false, whatsapp_amount: 0, coupon_discount: 0,
    addon_practitioner_id: practitionerId, line_items: lineItems,
  }).select('id').single()
  if (pErr) return json({ error: `payments insert: ${pErr.message}` }, 500)

  const amountPaise = Math.round(tax.grandTotal * 100)
  const rzp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: pay.id,
      notes: { payment_row_id: pay.id, business_id: businessId, kind: 'doctor_addon', practitioner_id: practitionerId } }),
  }).catch(() => null)
  const order = rzp ? await rzp.json().catch(() => ({})) : {}
  if (!rzp?.ok) {
    await db.from('payments').update({ status: 'failed' }).eq('id', pay.id)
    return json({ error: 'razorpay order failed', detail: order }, 502)
  }
  await db.from('payments').update({ razorpay_order_id: order.id }).eq('id', pay.id)
  return json({ ...quote, orderId: order.id, amountPaise, currency: 'INR', keyId, paymentRowId: pay.id })
})
