// bill-view — fetch one patient bill by its public token.
//
// Same shape as prescription-view and discharge-view: token in, one document
// out, no listing and no way to walk from it to the patient behind it.
//
// One difference from the other two. The totals on a bill are snapshotted and
// never move, but what has been PAID against it does — a patient who settles
// the balance next week should see that when they reopen the link, and an
// insurer checking the outstanding amount should see the truth. So `paid` and
// `balance_due` are computed here rather than frozen at issue.
//
// The patient's phone is not returned, for the same reason as the others.
//
// Request:  { token }      — or GET ?token=...
// Response: { bill }       — 404 for no match, 410 for an expired link
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

  if (!UUID_RE.test(token)) return json({ error: 'not found' }, 404)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: bill, error } = await supabase
    .from('patient_bills')
    .select(`
      id, bill_no, bill_type, issued_at, status, token_expires_at,
      patient_name, patient_age, patient_gender, mrn,
      clinic_name, clinic_address, clinic_phone, clinic_gstin,
      admission_no, admitted_at, discharged_at,
      subtotal, discount_amount, discount_reason, round_off, net_payable
    `)
    .eq('public_token', token)
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!bill) return json({ error: 'not found' }, 404)

  if (bill.token_expires_at && new Date(bill.token_expires_at as string) < new Date()) {
    return json({
      error: 'expired',
      message: 'This bill link has expired. Please ask the clinic to send it again.',
    }, 410)
  }

  const { data: items } = await supabase
    .from('patient_bill_items')
    .select('category, description, quantity, unit_price, amount, charged_on')
    .eq('bill_id', bill.id)
    .order('sort_order')

  // Live, deliberately — see the header.
  const { data: paidRows } = await supabase
    .from('patient_payments')
    .select('amount, method, received_on')
    .eq('bill_id', bill.id)
    .order('received_on')

  const paid = (paidRows ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0)

  const { id: _id, token_expires_at: _exp, ...safe } = bill as Record<string, unknown>

  return json({
    bill: {
      ...safe,
      items: items ?? [],
      payments: paidRows ?? [],
      paid,
      balance_due: Number(bill.net_payable ?? 0) - paid,
    },
  })
})
