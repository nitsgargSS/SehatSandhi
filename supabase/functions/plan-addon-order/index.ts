// plan-addon-order — add a module mid-term, under the plans by doctors (0272).
//
// IPD, Pathology, Diagnostics or Pharmacy, bought while a plan is running: the
// difference it makes to the plan's price for the term — so the bundle
// discount it unlocks is counted — pro rata by the days left. Then it renews
// with the plan.
//
//   Polyclinic with Pharmacy, adds Pathology: ₹1,000 → ₹2,250 a month of
//   add-ons (two add-ons, 10% off) = ₹1,250 a month more; 10 of 30 days
//   left → ₹417 + GST.
//
// Request:  { businessId, code: 'ipd' | 'pathology' | 'diagnostics' | 'pharmacy', action: 'quote' | 'order' }
// Signed-in owner only; clinics and hospitals; only once the plans are live.
// Fulfilment is the shared one: subscription_amount 0 leaves the plan alone,
// plan_addons switches the module on (sehat_fulfil_plan_addons, 0273).
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
  const code = ['ipd', 'pathology', 'diagnostics', 'pharmacy', 'opd'].includes(String(body.code)) ? String(body.code) : ''
  const action = body.action === 'order' ? 'order' : 'quote'
  if (!businessId) return json({ error: 'businessId required' }, 400)
  if (!code) return json({ error: "code must be 'ipd', 'pathology', 'diagnostics', 'pharmacy' or 'opd'" }, 400)

  const who = caller(req)
  if (!who) return json({ error: 'Please sign in.' }, 401)
  const db = who.asService
  if (!who.isServiceRole) {
    const { data: role, error } = await who.asCaller.rpc('sehat_caller_role', { p_business: businessId })
    if (error) return json({ error: error.message }, 500)
    if (role !== 'owner') {
      return json({ error: 'Only the business’s owner can buy add-ons.' }, 403)
    }
  }

  const { data: b, error: bErr } = await db.from('businesses')
    .select('id, name, vertical, status, months_paid, term_start, term_end, lab_categories')
    .eq('id', businessId).maybeSingle()
  if (bErr) return json({ error: bErr.message }, 500)
  if (!b) return json({ error: 'no such business' }, 404)

  // 0278: a lab adds OPD (a pathology lab) or the pharmacy; clinics and hospitals the rest.
  const isLab = b.vertical === 'lab'
  const diagnostic = ((b.lab_categories ?? []) as string[]).some(c => c === 'radiology' || c === 'cardiology')
  if (isLab ? !(code === 'pharmacy' || (code === 'opd' && !diagnostic)) : !['clinic', 'hospital'].includes(String(b.vertical)) || code === 'opd') {
    return json({ error: 'not_offered', message: code === 'opd' && diagnostic ? 'OPD is already part of a diagnostic centre’s plan.' : 'This add-on is not offered for your kind of business.' }, 409)
  }

  // ── Is there a paid term to add it to? ──
  const today = todayIst()
  const end = b.term_end ? new Date(`${String(b.term_end).slice(0, 10)}T00:00:00Z`) : null
  if (b.status !== 'active' || !end || end.getTime() <= today.getTime()) {
    return json({ error: 'no_active_term', message: 'Your plan is not active. Renew your plan first, then add this.' }, 409)
  }

  // ── Not already on ──
  const { data: current } = await db.rpc('sehat_business_addons', { p_business: businessId })
  const have = ((current ?? []) as string[])
  if (have.includes(code)) return json({ error: 'already_active', message: 'This add-on is already on.' }, 409)

  // ── The difference it makes to this term's price ──
  const termMonths = [1, 6, 12].includes(Number(b.months_paid)) ? Number(b.months_paid) : 1
  const quote1 = async (addons: string[]) => {
    const { data, error } = await db.rpc('sehat_plan_quote', { p_business: businessId, p_months: termMonths, p_addons: addons })
    if (error) throw new Error(error.message)
    return data as { live: boolean; total: number; monthly: number } | null
  }
  let before, after
  try { [before, after] = await Promise.all([quote1(have), quote1([...have, code])]) }
  catch (e) { return json({ error: String((e as Error).message) }, 500) }
  if (!before || !after || !after.live) {
    return json({ error: 'not_live', message: 'Add-ons are not on sale yet.' }, 409)
  }
  const { data: ap } = await db.from('plan_addons').select('label, is_enabled').eq('code', code).maybeSingle()
  if (!ap || !ap.is_enabled) return json({ error: 'not_offered', message: 'This add-on is not offered at the moment.' }, 409)
  const monthly = Number(after.monthly) - Number(before.monthly)
  const fullFee = Number(after.total) - Number(before.total)
  if (!(fullFee > 0)) return json({ error: 'free', message: 'This add-on costs nothing more on your plan.' }, 409)

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
    label: `${ap.label} add-on — ₹${monthly}/month more, ${label.toLowerCase()} plan, ${daysLeft} of ${daysInTerm} days (${isoDate(today)} to ${isoDate(end)})`,
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
    plan_addons: [...have, code],
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
      notes: { payment_row_id: pay.id, business_id: businessId, kind: 'plan_addon', addon: code },
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
