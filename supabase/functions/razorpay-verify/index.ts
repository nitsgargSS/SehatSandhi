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

  // Find the payment row by explicit id or by the order id we stored on create.
  const query = supabase.from('payments').update({
    status: valid ? 'paid' : 'failed',
    razorpay_payment_id: paymentId,
  })
  const { error: uErr } = paymentRowId
    ? await query.eq('id', paymentRowId)
    : await query.eq('razorpay_order_id', orderId)
  if (uErr) return json({ ok: false, error: uErr.message }, 500)

  if (!valid) return json({ ok: false, error: 'signature mismatch' }, 400)

  // On success, activate the listing and LOCK IN what was sold.
  //
  // The price lock is the reason a later plan toggle is safe: the plan code,
  // monthly price, mode and term dates are copied from the payment onto the
  // listing, so re-pricing the platform never re-prices a business mid-term.
  // At term_end they are quoted whatever plan is active then — see the
  // subscription_renewals_due view.
  const { data: pay } = await supabase
    .from('payments')
    .select('doctor_id, pricing_plan_code, pricing_mode, monthly_price, period_months, term_start, term_end')
    .eq('razorpay_order_id', orderId)
    .maybeSingle()

  if (pay?.doctor_id) {
    const p = pay as {
      doctor_id: string
      pricing_plan_code: string | null
      pricing_mode: string | null
      monthly_price: number | null
      period_months: number | null
      term_start: string | null
      term_end: string | null
    }
    await supabase.from('doctors').update({
      status: 'active',
      pricing_plan_code: p.pricing_plan_code,
      locked_monthly_price: p.monthly_price,
      locked_mode: p.pricing_mode,
      months_paid: p.period_months,
      term_start: p.term_start,
      term_end: p.term_end,
      locked_at: new Date().toISOString(),
    }).eq('id', p.doctor_id)
  }

  // Issue the tax invoice. Deliberately AFTER the payment is marked paid and the
  // listing activated: if invoicing fails we must not leave a verified payment
  // looking unverified, and the issuer is idempotent so it can be retried.
  let invoice: { invoice_number?: string; public_token?: string } | null = null
  let invoiceError: string | null = null
  const paymentRow = paymentRowId ?? null
  try {
    const targetId = paymentRow ?? (await supabase
      .from('payments').select('id').eq('razorpay_order_id', orderId).maybeSingle()).data?.id
    if (targetId) {
      const { data: inv, error: iErr } = await supabase
        .rpc('sehat_issue_invoice', { p_payment_id: targetId })
      if (iErr) invoiceError = iErr.message
      else invoice = inv as { invoice_number?: string; public_token?: string }
    }
  } catch (e) {
    invoiceError = String((e as Error).message ?? e)
  }

  // Send the invoice link over WhatsApp and email. Best-effort: a delivery
  // failure must never fail the payment response, and the business can always
  // download it from their dashboard.
  if (invoice?.public_token) {
    try {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/invoice-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ token: invoice.public_token }),
      })
    } catch { /* logged on the invoice row by invoice-send */ }
  }

  return json({
    ok: true,
    status: 'paid',
    invoiceNumber: invoice?.invoice_number ?? null,
    invoiceToken: invoice?.public_token ?? null,
    invoiceError,
  })
})
