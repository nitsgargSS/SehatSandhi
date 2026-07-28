// razorpay-verify — verify a completed Razorpay payment and mark it paid.
//
// After Checkout succeeds the browser posts back { orderId, paymentId,
// signature }. Razorpay signs `${order_id}|${payment_id}` with HMAC-SHA256 using
// the key secret; we recompute it server-side and only mark the payment `paid`
// if it matches. This is what makes the payment trustworthy — a client can't
// fake a "paid" status because it never had the secret.
//
// Request:  { orderId, paymentId, signature, paymentRowId? }
// Response: { ok: true, status } | { ok: false, error }
//
// Env: RAZORPAY_KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { fulfilPayment } from '../_shared/fulfilment.ts'

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Constant-time compare so we don't leak signature bytes via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keySecret) return json({ error: 'Razorpay not configured' }, 500)

  let body: { orderId?: string; paymentId?: string; signature?: string; paymentRowId?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  const { orderId, paymentId, signature, paymentRowId } = body
  if (!orderId || !paymentId || !signature) return json({ ok: false, error: 'missing fields' }, 400)

  const expected = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`)
  const valid = timingSafeEqual(expected, signature)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // A bad signature still gets recorded, so a tampered return is visible rather
  // than silent — but it must never fulfil.
  if (!valid) {
    await supabase.from('payments')
      .update({ status: 'failed', razorpay_payment_id: paymentId })
      .eq(paymentRowId ? 'id' : 'razorpay_order_id', paymentRowId ?? orderId)
    return json({ ok: false, error: 'signature mismatch' }, 400)
  }

  // Shared with razorpay-webhook, which does the same work when the browser
  // never makes it back. Both are idempotent, so whichever arrives first wins
  // and the second is a no-op.
  const result = await fulfilPayment(supabase, { orderId, paymentId, paymentRowId })
  if (!result.ok) return json({ ok: false, error: result.error }, 500)
  const invoice = { invoice_number: result.invoiceNumber, public_token: result.invoiceToken }
  const invoiceError = result.invoiceError

  return json({
    ok: true,
    status: 'paid',
    invoiceNumber: invoice?.invoice_number ?? null,
    invoiceToken: invoice?.public_token ?? null,
    invoiceError,
  })
})
