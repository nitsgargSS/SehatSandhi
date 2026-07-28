// razorpay-webhook — Razorpay tells us server-to-server that money arrived.
//
// WHY THIS EXISTS
// Without it the whole post-payment chain depended on the customer's browser
// getting back from Checkout and calling razorpay-verify. If their phone died,
// the network dropped or they closed the tab at the wrong moment, Razorpay had
// the money and we had no record: the payment stuck 'pending', the listing never
// activated, no invoice issued, and nobody found out until the business
// complained. This path does not involve their browser at all.
//
// SETUP (Razorpay Dashboard → Settings → Webhooks)
//   URL     https://<project>.supabase.co/functions/v1/razorpay-webhook
//   Secret  any long random string, also set as RAZORPAY_WEBHOOK_SECRET
//   Events  payment.captured
// Deploy with --no-verify-jwt: Razorpay sends no Supabase auth header, and the
// signature below is what authenticates the request.
//
// ALWAYS 200 ONCE THE SIGNATURE CHECKS OUT
// Razorpay retries on any non-2xx. A retry is right when we genuinely failed to
// record the payment, and wrong when the event is simply one we do not act on —
// that would have it redelivered for hours. So: 400 for a bad signature, 500
// only when fulfilment actually failed, 200 for everything else.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { json } from '../_shared/cors.ts'
import { fulfilPayment } from '../_shared/fulfilment.ts'

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  if (!secret) {
    // 500 so Razorpay retries: the event is real and we are the ones misconfigured.
    return json({ error: 'RAZORPAY_WEBHOOK_SECRET not configured' }, 500)
  }

  // The RAW body, not a re-serialised object. Razorpay signs the exact bytes it
  // sent, and JSON.stringify of a parsed body will not reproduce them — key
  // order and whitespace both differ.
  const raw = await req.text()
  const signature = req.headers.get('x-razorpay-signature') ?? ''

  const expected = await hmacSha256Hex(secret, raw)
  if (!timingSafeEqual(expected, signature)) {
    // Anyone can POST here. Without this check, a stranger could activate any
    // listing and issue an invoice for a payment that never happened.
    return json({ error: 'signature mismatch' }, 400)
  }

  let event: {
    event?: string
    payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } }
  }
  try {
    event = JSON.parse(raw)
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  // Only captured payments mean money has settled. 'authorized' is a hold, and
  // acting on it would activate a listing that may never be charged.
  if (event.event !== 'payment.captured') {
    return json({ ok: true, ignored: event.event ?? 'unknown' })
  }

  const entity = event.payload?.payment?.entity
  const paymentId = entity?.id
  const orderId = entity?.order_id
  if (!paymentId || !orderId) {
    // Malformed but correctly signed — retrying will not improve it.
    return json({ ok: true, ignored: 'missing payment or order id' })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const result = await fulfilPayment(supabase, { orderId, paymentId })

  if (!result.ok) {
    // A payment we cannot find or cannot record is exactly the case worth
    // retrying — it is the money-taken-with-no-record scenario this exists for.
    return json({ ok: false, error: result.error }, 500)
  }

  return json({
    ok: true,
    alreadyPaid: result.alreadyPaid,
    invoiceNumber: result.invoiceNumber,
    invoiceError: result.invoiceError,
  })
})
