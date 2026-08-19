// discharge-view — fetch one discharge summary by its public token.
//
// Same shape as prescription-view: token in, one document out, no listing and
// no way to walk from it to the patient behind it. A leaked link exposes that
// one stay.
//
// It returns more than a prescription does, because it has to. This is what the
// next clinician reads when they have no access to the chart — the course in
// hospital, what was found, what was done, and what should happen next. Holding
// any of that back to be cautious would defeat the document.
//
// The patient's phone number is still NOT returned, for the same reason as
// prescription-view: whoever opened the link already knows it, and a document
// carrying it identifies them to everyone it is forwarded to.
//
// Discharge medication comes from the linked prescription rather than a copy,
// so a patient reading this sees exactly what a pharmacist would.
//
// Request:  { token }         — or GET ?token=...
// Response: { summary }       — 404 for no match, 410 for an expired link
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

  const { data: ds, error } = await supabase
    .from('discharge_summaries')
    .select(`
      id, summary_no, issued_at, status, token_expires_at, prescription_id,
      doctor_name, doctor_qualification, doctor_reg_number,
      clinic_name, clinic_address, clinic_phone, ward_bed,
      patient_name, patient_age, patient_gender,
      admitted_at, discharged_at, days_stayed,
      admitting_diagnosis, discharge_diagnosis, condition_on_discharge,
      course_in_hospital, investigations, procedures,
      advice, diet_advice, activity_advice, warning_signs,
      follow_up_date, follow_up_with
    `)
    .eq('public_token', token)
    .maybeSingle()

  if (error) return json({ error: error.message }, 500)
  if (!ds) return json({ error: 'not found' }, 404)

  if (ds.token_expires_at && new Date(ds.token_expires_at as string) < new Date()) {
    return json({
      error: 'expired',
      message: 'This discharge summary link has expired. Please ask the hospital to send it again.',
    }, 410)
  }

  // Discharge medication, read through the prescription so the two can never
  // disagree. Its own cancellation is respected: a prescription withdrawn after
  // discharge must not keep being handed to a pharmacist through this page.
  let medicines: unknown[] = []
  if (ds.prescription_id) {
    const { data: rx } = await supabase
      .from('prescriptions')
      .select('id, prescription_no, status')
      .eq('id', ds.prescription_id)
      .maybeSingle()

    if (rx && rx.status !== 'cancelled') {
      const { data: items } = await supabase
        .from('prescription_items')
        .select('drug_name, strength, form, dosage, duration, quantity, instructions')
        .eq('prescription_id', rx.id)
        .order('sort_order')
      medicines = items ?? []
    }
  }

  const { id: _id, prescription_id: _rx, token_expires_at: _exp, ...safe } =
    ds as Record<string, unknown>

  return json({ summary: { ...safe, medicines } })
})
