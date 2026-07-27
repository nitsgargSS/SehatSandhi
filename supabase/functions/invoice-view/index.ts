// invoice-view — fetch one invoice by its public token.
//
// The invoices table is service-role only: it carries the business's name,
// address, GSTIN and what they paid. But the WhatsApp and email links have to
// open without a login, so this function looks up exactly one row by an
// unguessable token and returns it.
//
// Deliberately narrow: token in, one invoice out. No listing, no filtering, no
// way to walk from one invoice to another. A leaked link exposes that one
// invoice, which is the same exposure as forwarding the email it came in.
//
// Request:  { token }               — or GET ?token=...
// Response: { invoice }             — 404 when the token matches nothing
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let token = ''
  if (req.method === 'GET') {
    token = new URL(req.url).searchParams.get('token') ?? ''
  } else if (req.method === 'POST') {
    try {
      const body = await req.json()
      token = typeof body.token === 'string' ? body.token : ''
    } catch {
      return json({ error: 'invalid JSON' }, 400)
    }
  } else {
    return json({ error: 'GET or POST only' }, 405)
  }

  // Reject anything that isn't a UUID before touching the database, so a
  // malformed token can't become a query error that leaks table structure.
  if (!UUID_RE.test(token)) return json({ error: 'not found' }, 404)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      invoice_number, invoice_date, fy, status,
      supplier_legal_name, supplier_trade_name, supplier_gstin, supplier_state_code, supplier_address,
      recipient_name, recipient_gstin, recipient_state_code, recipient_address, recipient_phone,
      sac_code, description, period_start, period_end, months, pin_codes,
      taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, tax_total, total_amount,
      place_of_supply, reverse_charge, currency
    `)
    .eq('public_token', token)
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!data) return json({ error: 'not found' }, 404)

  return json({ invoice: data })
})
