// wallet-topup-order — a Razorpay order to add money to a clinic's WhatsApp
// marketing wallet (0116).
//
// Separate from razorpay-order on purpose: that one prices a listing and its
// fulfilment re-locks the plan and raises a listing invoice. A top-up buys
// nothing yet — it is credit spent later, a message at a time — so it gets its
// own payments.type ('wallet_topup'), and fulfilment branches on it.
//
// Unlike razorpay-order this checks who is asking: only the clinic's owner or
// manager (sehat_caller_role, read through their own token) may top up.
//
// Verification and the webhook are shared with listing payments: both call
// fulfilPayment, which credits the wallet once via sehat_wallet_credit_topup.
//
// ── GST ─────────────────────────────────────────────────────────────────────
// No invoice is raised for a top-up here. Whether GST falls due when the
// money is received or when a message is sent is a question for the CA before
// launch; the ledger keeps every recharge and every send, so either can be
// invoiced from it later.
//
// Request:  { businessId, amountRupees }        — signed-in owner or manager
// Response: { orderId, amount (paise), currency, keyId, paymentRowId }
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'

const MIN_RUPEES = 100
const MAX_RUPEES = 50000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const who = caller(req)
  if (!who || who.isServiceRole) return json({ error: 'Please sign in again.' }, 401)

  let businessId = ''
  let amountRupees = 0
  try {
    const body = await req.json()
    businessId = typeof body.businessId === 'string' ? body.businessId : ''
    amountRupees = Number(body.amountRupees)
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (!businessId) return json({ error: 'businessId required' }, 400)
  if (!Number.isInteger(amountRupees) || amountRupees < MIN_RUPEES || amountRupees > MAX_RUPEES) {
    return json({ error: `Top up between ₹${MIN_RUPEES} and ₹${MAX_RUPEES.toLocaleString('en-IN')}, in whole rupees.` }, 400)
  }

  const { data: role, error: roleErr } = await who.asCaller
    .rpc('sehat_caller_role', { p_business: businessId })
  if (roleErr) return json({ error: roleErr.message }, 500)
  if (role !== 'owner' && role !== 'manager') {
    return json({ error: 'Only the clinic’s owner or manager can top up the wallet.' }, 403)
  }

  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) return json({ error: 'Razorpay not configured' }, 500)

  const { data: pay, error: pErr } = await who.asService
    .from('payments')
    .insert({ business_id: businessId, amount: amountRupees, type: 'wallet_topup', status: 'pending' })
    .select('id')
    .single()
  if (pErr) return json({ error: `payments insert: ${pErr.message}` }, 500)

  const amountPaise = amountRupees * 100
  const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt: pay.id,
      notes: { payment_row_id: pay.id, business_id: businessId, purpose: 'wallet_topup' },
    }),
  })
  const order = await rzpRes.json()
  if (!rzpRes.ok) {
    await who.asService.from('payments').update({ status: 'failed' }).eq('id', pay.id)
    return json({ error: 'razorpay order failed', detail: order }, 502)
  }

  await who.asService.from('payments').update({ razorpay_order_id: order.id }).eq('id', pay.id)

  return json({ orderId: order.id, amount: amountPaise, currency: 'INR', keyId, paymentRowId: pay.id })
})
