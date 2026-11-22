// partner-fee-order — the Care Partner certification fee (0333).
//
// The signed-in partner (their own session token) asks for an order. The
// amount, the GST in it and the payment row all come from the database
// (sehat_care_fee_prepare, which refuses anyone who has not passed the final
// exam) — nothing about the price is taken from the browser. This function only
// adds the Razorpay order and hands Checkout what it needs.
//
// Payment is confirmed exactly like every other payment: razorpay-verify (the
// browser) or razorpay-webhook (Razorpay itself) → fulfilPayment, which sees
// type 'partner_fee' and calls sehat_care_fee_paid (Partner ID + invoice).
//
// Request:  {}   (Authorization: the partner's session)
// Response: { orderId, amount, currency, keyId, paymentRowId, name, phone, email }
//
// Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const keyId = Deno.env.get('RAZORPAY_KEY_ID')
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keyId || !keySecret) return json({ error: 'Payments are not available just now.' }, 500)

  const who = caller(req)
  if (!who || who.isServiceRole) return json({ error: 'Please sign in first.' }, 401)

  // As the partner: their own eligibility, price and payment row.
  const { data: prep, error } = await who.asCaller.rpc('sehat_care_fee_prepare')
  if (error) return json({ error: error.message }, 400)
  const p = prep as { payment_id: string; amount_paise: number; name: string; phone: string; email: string | null }

  const rzp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: p.amount_paise, currency: 'INR', receipt: p.payment_id,
      // product: one Razorpay account serves several products (see razorpay-webhook).
      notes: { product: 'sehatsandhi', kind: 'partner_fee', payment_row_id: p.payment_id },
    }),
  })
  const order = await rzp.json()
  if (!rzp.ok) {
    await who.asService.from('payments').update({ status: 'failed' }).eq('id', p.payment_id)
    return json({ error: 'Could not start the payment. Please try again.' }, 502)
  }
  await who.asService.from('payments').update({ razorpay_order_id: order.id }).eq('id', p.payment_id)

  return json({
    orderId: order.id, amount: p.amount_paise, currency: 'INR', keyId, paymentRowId: p.payment_id,
    name: p.name, phone: p.phone, email: p.email,
  })
})
