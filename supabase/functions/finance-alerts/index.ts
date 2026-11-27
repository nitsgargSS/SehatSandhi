// finance-alerts — sends Treatment on EMI's WhatsApp alerts (0344).
//
// The finance_alerts queue is filled by a trigger on finance_case_events: each
// step of a case queues a message to the patient, the hospital or a lender
// (who gets what: the header of 0344). Every 2 minutes (cron 'finance-alerts')
// this writes each message from the case as it is now and sends it from
// Sehatsandhi's main number (+91 70153 99355) with the house templates in
// _shared/financeTemplates.ts. A failure is retried up to 6 times over about a
// day — so messages wait while Meta reviews the templates — then marked failed.
//
// Off production, only numbers in site_settings 'finance_alert_test_numbers'
// get a message; the rest are skipped (sandbox cases carry real hospitals'
// phones).
//
// Service role only (the cron). POST {} → { sent, failed, retrying, skipped }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'
import { isServiceAuth } from '../_shared/serviceKey.ts'
import { sendTemplate } from '../_shared/whatsapp.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const BACKOFF_MIN = [5, 15, 60, 180, 480, 720]
const PRODUCTION_REF = 'tbmlhawtnrvvnemcljma'

const rupee = (n: unknown) => `₹${Math.round(Number(n ?? 0)).toLocaleString('en-IN')}`
const firstName = (s: string) => String(s ?? '').trim().split(/\s+/)[0] || 'there'
const day = (d: string | null) => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''

interface Msg { campaign: string; params: string[] }

/** The message for one alert, or null when the step no longer calls for one. */
function compose(a: Any, c: Any, hospital: string, lender: Any | null, link: string): Msg | null {
  const lname = lender?.legal_name ?? 'The lender'
  if (a.audience === 'patient') {
    if (a.event === 'created' || a.event === 'confirmed') {
      return { campaign: 'AISENSY_EMI_LINK_CAMPAIGN',
               params: [firstName(c.patient_name), hospital, c.treatment, rupee(c.requested_amount), link] }
    }
    let text: string
    switch (a.event) {
      case 'offered':
        text = `${lname} has sent you an offer` +
          (lender?.offer_amount ? ` of ${rupee(lender.offer_amount)}` : '') +
          (lender?.offer_tenure_months ? ` over ${lender.offer_tenure_months} months` : '') +
          '. Please complete their steps from your link to go ahead.'
        break
      case 'sanctioned':
        text = `${lname} has sanctioned your loan` + (lender?.offer_amount ? ` of ${rupee(lender.offer_amount)}` : '') +
          (c.admission_confirmed_at ? '. They will now pay the hospital.'
                                    : '. They will pay the hospital once the hospital confirms your admission date.')
        break
      case 'declined':
        text = c.status === 'declined'
          ? `${lname} could not approve the loan. Please speak to the hospital about other ways to pay.`
          : `${lname} could not approve the loan. Your request is still with the other lender you chose.`
        break
      case 'disbursed':
        text = `${lname} has paid ${rupee(lender?.disbursed_amount)} to ${hospital}` + (lender?.utr ? ` (reference ${lender.utr})` : '') +
          '. Your EMIs are paid to the lender, not to Sehatsandhi or the hospital.'
        break
      case 'money_received':
        text = `${hospital} has confirmed it received the loan amount. Your EMI request is complete.`
        break
      case 'withdrawn':
        text = 'This EMI request has been withdrawn by the hospital. Please speak to the hospital if you still need help.'
        break
      case 'expired':
        text = 'This EMI request was closed because nothing happened on it for 15 days. You can ask again any time.'
        break
      default: return null
    }
    return { campaign: 'AISENSY_EMI_STATUS_CAMPAIGN', params: [c.case_no, hospital, text, link] }
  }

  if (a.audience === 'hospital') {
    let text: string
    switch (a.event) {
      case 'requested':
        text = `the patient has asked to pay ${rupee(c.requested_amount)} in EMIs. Please confirm the estimate.`
        break
      case 'sanctioned':
        // The hospital may have confirmed in the meantime.
        if (c.admission_confirmed_at) return null
        text = `${lname} has sanctioned the loan. Please confirm the admission or treatment date so the lender can pay.`
        break
      case 'disbursed':
        text = `${lname} has paid ${rupee(lender?.disbursed_amount)}` + (lender?.utr ? ` (UTR ${lender.utr})` : '') +
          '. Please check your bank and mark the money as received.'
        break
      case 'withdrawn':
        text = 'the patient has withdrawn this EMI request.'
        break
      default: return null
    }
    return { campaign: 'AISENSY_EMI_HOSPITAL_CAMPAIGN', params: [c.case_no, c.patient_name, c.treatment, text] }
  }

  // lender
  let text: string
  switch (a.event) {
    case 'shared_with_lender': text = 'A patient has shared this request with you.'; break
    case 'admission_confirmed':
      text = `The hospital has confirmed the admission${c.planned_on ? ` for ${day(c.planned_on)}` : ''}.`; break
    case 'withdrawn': text = 'This request has been withdrawn.'; break
    case 'expired': text = 'This request has closed after 15 days without action.'; break
    case 'money_received': text = 'The hospital has confirmed it received your payment.'; break
    default: return null
  }
  return { campaign: 'AISENSY_EMI_LENDER_CAMPAIGN', params: [c.case_no, c.treatment, hospital, rupee(c.requested_amount), text] }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!isServiceAuth(req.headers.get('Authorization'))) return json({ error: 'unauthorised' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const site = (Deno.env.get('SITE_URL') ?? 'https://www.sehatsandhi.com').replace(/\/$/, '')
  const onProduction = (Deno.env.get('SUPABASE_URL') ?? '').includes(PRODUCTION_REF)

  let testNumbers: string[] = []
  if (!onProduction) {
    const { data: s } = await db.from('site_settings').select('value').eq('key', 'finance_alert_test_numbers').maybeSingle()
    testNumbers = String(s?.value ?? '').split(',').map(x => x.replace(/\D/g, '')).filter(Boolean)
  }

  const { data: due, error } = await db.from('finance_alerts').select('*')
    .eq('state', 'pending').lte('next_try_at', new Date().toISOString()).order('created_at').limit(40)
  if (error) return json({ error: error.message }, 500)

  let sent = 0, failed = 0, retrying = 0, skipped = 0
  const skip = async (id: string, why: string) => {
    await db.from('finance_alerts').update({ state: 'skipped', error: why }).eq('id', id); skipped++
  }
  for (const a of due ?? []) {
    const { data: c } = await db.from('finance_cases')
      .select('case_no, business_id, patient_name, treatment, requested_amount, planned_on, status, admission_confirmed_at, public_token')
      .eq('id', a.case_id).maybeSingle()
    if (!c) { await skip(a.id, 'case removed'); continue }
    if (!onProduction && !testNumbers.includes(a.to_phone)) { await skip(a.id, 'not production: number not on the test list'); continue }

    const { data: h } = await db.from('businesses').select('name').eq('id', c.business_id).maybeSingle()
    let lender: Any = null
    if (a.lender_id) {
      const [{ data: lp }, { data: cl }] = await Promise.all([
        db.from('lender_profiles').select('legal_name').eq('business_id', a.lender_id).maybeSingle(),
        db.from('finance_case_lenders').select('offer_amount, offer_tenure_months, disbursed_amount, utr')
          .eq('case_id', a.case_id).eq('lender_id', a.lender_id).maybeSingle(),
      ])
      lender = { ...(cl ?? {}), legal_name: lp?.legal_name }
    }
    const msg = compose(a, c, h?.name ?? 'the hospital', lender, `${site}/emi/${c.public_token}`)
    if (!msg) { await skip(a.id, 'no longer needed'); continue }

    const r = await sendTemplate({ campaignEnv: msg.campaign, to: a.to_phone,
      userName: a.audience === 'patient' ? c.patient_name : (a.audience === 'hospital' ? h?.name ?? 'Hospital' : lender?.legal_name ?? 'Lender'),
      params: msg.params, source: 'finance-alerts' })
    const attempts = a.attempts + 1
    if (r.ok) {
      await db.from('finance_alerts').update({ state: 'sent', sent_at: new Date().toISOString(), error: null, attempts }).eq('id', a.id); sent++
    } else if (r.unreachable || attempts >= BACKOFF_MIN.length) {
      await db.from('finance_alerts').update({ state: 'failed', attempts, error: (r.error ?? 'failed').slice(0, 300) }).eq('id', a.id); failed++
    } else {
      await db.from('finance_alerts').update({ attempts, error: (r.error ?? 'failed').slice(0, 300),
        next_try_at: new Date(Date.now() + BACKOFF_MIN[attempts - 1] * 60_000).toISOString() }).eq('id', a.id); retrying++
    }
  }
  return json({ sent, failed, retrying, skipped })
})
