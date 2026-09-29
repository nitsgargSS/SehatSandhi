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
import { ADMIN_EMAIL, esc, layout, sendEmail } from './email.ts'

export interface FulfilResult {
  ok: boolean
  alreadyPaid: boolean
  businessId: string | null
  invoiceNumber: string | null
  invoiceToken: string | null
  invoiceError: string | null
  /** Set for a wallet top-up (0116): the balance after crediting it. */
  walletBalancePaise?: number | null
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
    .select('id, type, status, amount, business_id, pricing_plan_code, pricing_mode, monthly_price, period_months, term_start, term_end, modules, subscription_amount, whatsapp_addon, addon_practitioner_id')
    .eq(paymentRowId ? 'id' : 'razorpay_order_id', paymentRowId ?? orderId)
    .maybeSingle()

  if (!existing) {
    return {
      ok: false, alreadyPaid: false, businessId: null,
      invoiceNumber: null, invoiceToken: null, invoiceError: null,
      error: `no payment row for order ${orderId}`,
    }
  }

  const pay = existing as {
    id: string; type: string; status: string; amount: number | string | null; business_id: string | null
    pricing_plan_code: string | null; pricing_mode: string | null
    monthly_price: number | string | null; period_months: number | null
    term_start: string | null; term_end: string | null; modules: string[] | null
    subscription_amount: number | string | null; whatsapp_addon: boolean | null
    addon_practitioner_id?: string | null
  }
  const alreadyPaid = pay.status === 'paid'

  const { error: uErr } = await supabase.from('payments')
    .update({ status: 'paid', razorpay_payment_id: paymentId })
    .eq('id', pay.id)
  if (uErr) {
    return {
      ok: false, alreadyPaid, businessId: pay.business_id,
      invoiceNumber: null, invoiceToken: null, invoiceError: null, error: uErr.message,
    }
  }

  // A wallet top-up buys credit, not a listing: no plan lock, no listing
  // invoice. Credit it — once, however many times this runs — and stop.
  if (pay.type === 'wallet_topup') {
    const { data: credit, error: cErr } = await supabase
      .rpc('sehat_wallet_credit_topup', { p_payment_id: pay.id })
    return {
      ok: !cErr, alreadyPaid, businessId: pay.business_id,
      invoiceNumber: null, invoiceToken: null, invoiceError: null,
      walletBalancePaise: (credit as { balance_paise?: number } | null)?.balance_paise ?? null,
      ...(cErr ? { error: `wallet credit: ${cErr.message}` } : {}),
    }
  }

  // Lock in what was sold. This is why a later plan toggle is safe: the plan,
  // price, mode and term are copied onto the listing, so re-pricing the platform
  // never re-prices a business mid-term. At term_end they are quoted whatever is
  // active then — see subscription_renewals_due.
  // A payment that bought only the WhatsApp add-on (0117: a commission-only
  // pharmacy, say) must not switch the listing on past admin review, nor
  // overwrite its plan. Legacy payments carry no subscription_amount: listing.
  const boughtListing = pay.subscription_amount == null || Number(pay.subscription_amount) > 0
  if (pay.business_id && boughtListing) {
    const bought = pay.modules ?? []

    // deno-lint-ignore no-explicit-any
    const patch: Record<string, any> = {
      status: 'active',
      pricing_plan_code: pay.pricing_plan_code,
      // Whole rupees: this column is integer (views depend on it) while
      // payments.monthly_price carries paise since 0175.
      locked_monthly_price: pay.monthly_price == null ? null : Math.round(Number(pay.monthly_price)),
      locked_mode: pay.pricing_mode,
      months_paid: pay.period_months,
      term_start: pay.term_start,
      term_end: pay.term_end,
      locked_at: new Date().toISOString(),
    }

    // Raised, never lowered. A business that adds IPD mid-term pays for IPD
    // alone, and that payment must not read as "OPD was not bought" and switch
    // off a system somebody is seeing patients with. Losing a module is
    // governed by term_end, which lapses everything together, or by an admin
    // acting deliberately.
    if (bought.includes('opd')) patch.opd_module = true
    if (bought.includes('ipd')) patch.ipd_module = true

    // Checked: a failed write here leaves a paid listing sitting in Pending,
    // which is exactly what payment is meant to skip.
    const { error: bErr } = await supabase.from('businesses').update(patch).eq('id', pay.business_id)
    if (bErr) console.error(`fulfilment: listing ${pay.business_id} not activated: ${bErr.message}`)
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

  // 0140: a doctor added mid-term goes live once their pro-rata fee is paid.
  if (pay.addon_practitioner_id && pay.business_id) {
    await supabase.rpc('sehat_release_paid_doctor', { p_business: pay.business_id, p_practitioner: pay.addon_practitioner_id })
  }

  // 0117: count the coupon once, and switch the WhatsApp add-on on for the term.
  // Both idempotent, so the second of verify/webhook changes nothing.
  await supabase.rpc('sehat_redeem_coupon', { p_payment_id: pay.id })
  if (pay.whatsapp_addon && pay.business_id) {
    const { data: acct } = await supabase.from('business_wa_accounts')
      .select('subscription_started_at, onboarding_fee_paid_at').eq('business_id', pay.business_id).maybeSingle()
    const now = new Date().toISOString()
    await supabase.from('business_wa_accounts').upsert({
      business_id: pay.business_id,
      subscription_status: 'active',
      past_due_since: null,
      next_billing_date: pay.term_end,
      subscription_started_at: (acct as { subscription_started_at?: string } | null)?.subscription_started_at ?? now,
      onboarding_fee_paid_at: (acct as { onboarding_fee_paid_at?: string } | null)?.onboarding_fee_paid_at ?? now,
    }, { onConflict: 'business_id' })
    // WhatsApp added mid-term (whatsapp-addon-order) renews with the plan from
    // now on. A plan payment already set this when its order was created.
    if (!boughtListing) {
      await supabase.from('businesses').update({ renewal_whatsapp: true }).eq('id', pay.business_id)
    }
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

  // Tell admin money arrived — once, like the invoice send above. Best-effort.
  if (!alreadyPaid && pay.business_id) {
    try { await alertAdminPaid(supabase, pay, invoice?.invoice_number ?? null) } catch { /* never fails the payment */ }
  }

  return {
    ok: true,
    alreadyPaid,
    businessId: pay.business_id,
    invoiceNumber: invoice?.invoice_number ?? null,
    invoiceToken: invoice?.public_token ?? null,
    invoiceError,
  }
}

const PAY_KIND: Record<string, string> = {
  listing: 'Listing plan', wallet_topup: 'WhatsApp wallet top-up',
}

async function alertAdminPaid(
  supabase: SupabaseClient,
  pay: { id: string; type: string; amount: number | string | null; business_id: string | null; period_months: number | null; whatsapp_addon: boolean | null },
  invoiceNumber: string | null,
) {
  const { data } = await supabase.from('businesses')
    .select('name, vertical, phone, email, own_city, own_district, status')
    .eq('id', pay.business_id).maybeSingle()
  const b = (data ?? {}) as { name?: string; vertical?: string; phone?: string; email?: string; own_city?: string; own_district?: string; status?: string }
  const name = b.name ?? 'A business'
  const amount = `₹${Number(pay.amount ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const rows: [string, string][] = [
    ['Business', name],
    ['Type', b.vertical ?? '—'],
    ['Place', [b.own_city, b.own_district].filter(Boolean).join(', ') || '—'],
    ['Phone', b.phone || '—'],
    ['Email', b.email || '—'],
    ['Paid for', `${PAY_KIND[pay.type] ?? pay.type}${pay.period_months && pay.type === 'listing' ? ` · ${pay.period_months} month(s)` : ''}${pay.whatsapp_addon ? ' + WhatsApp' : ''}`],
    ['Amount (incl. GST)', amount],
    ['Invoice', invoiceNumber ?? 'not issued — check the payment in admin'],
    ['Listing status', b.status === 'active' ? 'Live' : (b.status ?? '—')],
  ]
  const html = layout(`Payment received: ${name}`, `
<table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#5b6b63;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #eef2ef">${esc(v)}</td></tr>`).join('')}
</table>`)
  const text = [`Payment received: ${name}`, '', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n')
  const res = await sendEmail({ to: ADMIN_EMAIL, toName: 'Sehatsandhi Admin', subject: `Payment received ${amount}: ${name}${b.own_city ? `, ${b.own_city}` : ''}`, html, text })
  if (!res.ok) console.error(`fulfilment: admin payment email failed: ${res.error}`)
}
