// invoice-send — deliver an invoice link over WhatsApp and email.
//
// Sends a LINK, not an attachment. Invoices are stored as data and rendered by
// the /invoice/:token page, which the business can save as a PDF from their
// browser. That avoids a PDF library and a storage bucket, and the link keeps
// working if an invoice is ever corrected.
//
// Best-effort by design: called from razorpay-verify after the payment is
// already confirmed, so a provider outage must never fail a payment. Failures
// are recorded on the invoice row (send_error) and the business can always
// download it from their dashboard.
//
// Each channel is skipped silently if its credentials are absent, so this works
// on day one with neither configured and starts sending as they are added.
//
// Request:  { token }                     — service-role auth required
// Response: { ok, whatsapp, email }       — per-channel outcome
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
//      AISENSY_API_KEY, AISENSY_INVOICE_CAMPAIGN   (WhatsApp)
//      ZEPTOMAIL_TOKEN                               (email, see _shared/email.ts)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { emailConfigured, esc, layout, sendEmail } from '../_shared/email.ts'

const money = (n: number | null) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Service-role only: this reads a business's billing details and messages
  // them. The anon key must never be able to trigger it.
  const auth = req.headers.get('Authorization') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  if (!auth.includes(serviceKey)) return json({ error: 'unauthorised' }, 401)

  let token = ''
  try {
    const body = await req.json()
    token = typeof body.token === 'string' ? body.token : ''
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  if (!token) return json({ error: 'token required' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  const { data: inv, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, total_amount, recipient_name, recipient_phone, recipient_email, sent_whatsapp_at, sent_email_at')
    .eq('public_token', token)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!inv) return json({ error: 'not found' }, 404)

  const i = inv as {
    id: string; invoice_number: string; invoice_date: string; total_amount: number
    recipient_name: string | null; recipient_phone: string | null; recipient_email: string | null
    sent_whatsapp_at: string | null; sent_email_at: string | null
  }

  const siteUrl = (Deno.env.get('SITE_URL') ?? 'https://www.sehatsandhi.com').replace(/\/$/, '')
  const link = `${siteUrl}/invoice/${token}`
  const errors: string[] = []

  // ── WhatsApp, via AISensy ──
  let whatsapp = 'skipped'
  const aisensyKey = Deno.env.get('AISENSY_API_KEY')
  const aisensyCampaign = Deno.env.get('AISENSY_INVOICE_CAMPAIGN')
  if (i.sent_whatsapp_at) {
    whatsapp = 'already sent'
  } else if (!aisensyKey || !aisensyCampaign) {
    whatsapp = 'skipped: AISENSY_API_KEY / AISENSY_INVOICE_CAMPAIGN not set'
  } else if (!i.recipient_phone) {
    whatsapp = 'skipped: no phone on the invoice'
  } else {
    try {
      const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: aisensyKey,
          campaignName: aisensyCampaign,
          destination: i.recipient_phone.replace(/[^0-9]/g, ''),
          userName: i.recipient_name ?? 'Business',
          // Order must match the approved template's variable order.
          templateParams: [i.invoice_number, money(i.total_amount), link],
        }),
      })
      if (res.ok) {
        whatsapp = 'sent'
        await supabase.from('invoices').update({ sent_whatsapp_at: new Date().toISOString() }).eq('id', i.id)
      } else {
        whatsapp = `failed: ${res.status}`
        errors.push(`whatsapp ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
    } catch (e) {
      whatsapp = 'failed'
      errors.push(`whatsapp: ${String((e as Error).message ?? e)}`)
    }
  }

  // ── Email, from no-reply@ via ZeptoMail (_shared/email.ts) ──
  let email = 'skipped'
  if (i.sent_email_at) {
    email = 'already sent'
  } else if (!emailConfigured()) {
    email = 'skipped: ZEPTOMAIL_TOKEN not set'
  } else if (!i.recipient_email) {
    // Email is optional at registration, so plenty of invoices will land here.
    email = 'skipped: no email on the invoice'
  } else {
    const who = i.recipient_name ?? 'there'
    const res = await sendEmail({
      to: i.recipient_email,
      toName: i.recipient_name ?? undefined,
      subject: `Sehatsandhi invoice ${i.invoice_number} — ${money(i.total_amount)}`,
      html: layout(`Invoice ${i.invoice_number}`, `
<p style="margin:0 0 14px">Hello ${esc(who)}, thank you for your payment. Your invoice is ready.</p>
<table cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 18px">
<tr><td style="padding:4px 14px 4px 0;color:#5b6b63">Invoice</td><td>${esc(i.invoice_number)}</td></tr>
<tr><td style="padding:4px 14px 4px 0;color:#5b6b63">Date</td><td>${esc(i.invoice_date)}</td></tr>
<tr><td style="padding:4px 14px 4px 0;color:#5b6b63">Amount</td><td><b>${esc(money(i.total_amount))}</b></td></tr>
</table>
<p style="margin:0 0 14px"><a href="${link}" style="display:inline-block;background:#0f6b4a;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:bold">View or download invoice</a></p>
<p style="margin:0;color:#5b6b63;font-size:13px">You can also find it any time in your dashboard under Plan.</p>`),
      text: `Hello ${who}, thank you for your payment.\n\nInvoice ${i.invoice_number}\nDate: ${i.invoice_date}\nAmount: ${money(i.total_amount)}\n\nView or download: ${link}\n\nYou can also find it in your dashboard under Plan.`,
    })
    if (res.ok) {
      email = 'sent'
      await supabase.from('invoices').update({ sent_email_at: new Date().toISOString() }).eq('id', i.id)
    } else {
      email = 'failed'
      errors.push(`email: ${res.error}`)
    }
  }

  if (errors.length) {
    await supabase.from('invoices').update({ send_error: errors.join(' | ').slice(0, 1000) }).eq('id', i.id)
  }

  return json({ ok: true, whatsapp, email, link })
})
