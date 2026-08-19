// prescription-view — fetch one prescription by its public token.
//
// Modelled on invoice-view, with one difference that matters: an invoice is
// about a business, a prescription is about a person's health. So this checks
// an expiry as well as a token, and returns nothing once the link has aged out.
//
// Deliberately narrow: token in, one prescription out. No listing, no
// filtering, no way to walk from one prescription to another or to the patient
// behind it. A leaked link exposes that one slip — the same exposure as
// forwarding the WhatsApp message it arrived in.
//
// The patient's phone number is NOT returned. The person opening the link
// already knows it, and a document that carries it is one that identifies them
// to anyone it is forwarded to.
//
// Request:  { token }              — or GET ?token=...
// Response: { prescription }       — 404 for no match, 410 for an expired link
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

  // Shape-check before touching the database: a token that is not a uuid cannot
  // match anything, and rejecting it here keeps junk out of the query.
  if (!UUID_RE.test(token)) return json({ error: 'not found' }, 404)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: rx, error } = await supabase
    .from('prescriptions')
    .select(`
      id, prescription_no, issued_at, status, token_expires_at,
      prescriber_name, prescriber_qualification, prescriber_reg_number,
      clinic_name, clinic_address, clinic_phone,
      patient_name, patient_age, patient_gender,
      diagnosis, advice, follow_up_date
    `)
    .eq('public_token', token)
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!rx) return json({ error: 'not found' }, 404)

  // 410 rather than 404: the difference between "this never existed" and "this
  // has expired" is worth telling a patient, so they know to ask for it again
  // rather than assume they misread the link.
  if (rx.token_expires_at && new Date(rx.token_expires_at as string) < new Date()) {
    return json({ error: 'expired', message: 'This prescription link has expired. Please ask your clinic to send it again.' }, 410)
  }

  const { data: items } = await supabase
    .from('prescription_items')
    .select('drug_name, strength, form, dosage, duration, quantity, instructions')
    .eq('prescription_id', rx.id)
    .order('sort_order')

  // The id and the expiry have both done their job here; neither belongs in a
  // payload that gets forwarded around.
  const { id: _id, token_expires_at: _exp, ...safe } = rx as Record<string, unknown>

  return json({ prescription: { ...safe, items: items ?? [] } })
})
