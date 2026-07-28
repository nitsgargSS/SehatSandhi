// What happens once money has actually arrived — the single implementation.
//
// Two things can tell us a payment succeeded: the browser returning from
// Checkout (razorpay-verify) and Razorpay calling us server-to-server
// (razorpay-webhook). They must do identical work, because which one arrives
// first is a matter of whether a phone stayed awake. Writing it twice is how the
// two would drift, and the half that drifts is the half nobody watches.
//
// EVERYTHING HERE IS IDEMPOTENT
// Both paths normally fire for the same payment. Marking paid twice is a no-op,
// the listing lock is the same values written again, and sehat_issue_invoice is
// idempotent on payment_id and returns the existing invoice. So a double
// delivery costs one redundant write, never a second invoice or a second charge.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface FulfilResult {
  ok: boolean
  alreadyPaid: boolean
  doctorId: string | null
  invoiceNumber: string | null
  invoiceToken: string | null
  invoiceError: string | null
  error?: string
}

/**
 * Mark the payment paid, lock what was sold onto the listing, issue the tax
 * invoice and send it.
 *
 * Identify the payment by `paymentRowId` where the caller has it, otherwise by
 * the Razorpay order id stored when the order was created.
 */
export async function fulfilPayment(
  supabase: SupabaseClient,
  args: { orderId: string; paymentId: string; paymentRowId?: string | null },
): Promise<FulfilResult> {
  const { orderId, paymentId, paymentRowId } = args

  const { data: existing } = await supabase
    .from('payments')
    .select('id, status, doctor_id, pricing_plan_code, pricing_mode, monthly_price, period_months, term_start, term_end')
    .eq(paymentRowId ? 'id' : 'razorpay_order_id', paymentRowId ?? orderId)
    .maybeSingle()

  if (!existing) {
    return {
      ok: false, alreadyPaid: false, doctorId: null,
      invoiceNumber: null, invoiceToken: null, invoiceError: null,
      error: `no payment row for order ${orderId}`,
    }
  }

  const pay = existing as {
    id: string; status: string; doctor_id: string | null
    pricing_plan_code: string | null; pricing_mode: string | null
    monthly_price: number | null; period_months: number | null
    term_start: string | null; term_end: string | null
  }
  const alreadyPaid = pay.status === 'paid'

  const { error: uErr } = await supabase.from('payments')
    .update({ status: 'paid', razorpay_payment_id: paymentId })
    .eq('id', pay.id)
  if (uErr) {
    return {
      ok: false, alreadyPaid, doctorId: pay.doctor_id,
      invoiceNumber: null, invoiceToken: null, invoiceError: null, error: uErr.message,
    }
  }

  // Lock in what was sold. This is why a later plan toggle is safe: the plan,
  // price, mode and term are copied onto the listing, so re-pricing the platform
  // never re-prices a business mid-term. At term_end they are quoted whatever is
  // active then — see subscription_renewals_due.
  if (pay.doctor_id) {
    await supabase.from('doctors').update({
      status: 'active',
      pricing_plan_code: pay.pricing_plan_code,
      locked_monthly_price: pay.monthly_price,
      locked_mode: pay.pricing_mode,
      months_paid: pay.period_months,
      term_start: pay.term_start,
      term_end: pay.term_end,
      locked_at: new Date().toISOString(),
    }).eq('id', pay.doctor_id)
  }

  // After the payment is marked paid and the listing activated, deliberately: if
  // invoicing fails we must not leave a real payment looking unverified. The
  // issuer is idempotent, so this can be retried — including by the other path.
  let invoice: { invoice_number?: string; public_token?: string } | null = null
  let invoiceError: string | null = null
  try {
    const { data: inv, error: iErr } = await supabase
      .rpc('sehat_issue_invoice', { p_payment_id: pay.id })
    if (iErr) invoiceError = iErr.message
    else invoice = inv as { invoice_number?: string; public_token?: string }
  } catch (e) {
    invoiceError = String((e as Error).message ?? e)
  }

  // Best-effort delivery. A WhatsApp or email failure must never fail the
  // payment: the business can always download the invoice from their dashboard.
  // Skipped when the payment was already fulfilled, so a webhook arriving after
  // the browser does not send the same invoice twice.
  if (invoice?.public_token && !alreadyPaid) {
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

  return {
    ok: true,
    alreadyPaid,
    doctorId: pay.doctor_id,
    invoiceNumber: invoice?.invoice_number ?? null,
    invoiceToken: invoice?.public_token ?? null,
    invoiceError,
  }
}
