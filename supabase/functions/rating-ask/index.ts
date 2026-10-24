// rating-ask — a clinic asks its own patients for a review (0232).
//
// Pressed in the clinic's panel, for the patients it picks. Each one is a
// WhatsApp message from the number kept for clinics, paid from the clinic's
// wallet like a prescription (0217): charged first, put back if it does not
// go. The patient replies 1 to 5 there, and the rating is theirs alone to
// write — nothing here creates one.
//
// Who may be asked is the database's decision (sehat_rating_ask_open, called
// as the caller): a patient of that clinic seen in the last 60 days, not asked
// or rated in the last 30, who has not said STOP.
//
// Request:  { businessId, memberIds: string[] }   — signed-in clinic user. Up to 100.
// Response: { ok, sent, skipped: [{ memberId, why }], needsPlan?, walletShort?, message? }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//      META_ACCESS_TOKEN, META_CLINIC_PHONE_NUMBER_ID
//      META_RATING_TEMPLATE   — the template's name, as approved ("rating_request:hi")

import { corsHeaders, json } from '../_shared/cors.ts'
import { caller } from '../_shared/caller.ts'
import { canSendTemplate, sendTemplate } from '../_shared/whatsapp.ts'
import { ownSender } from '../_shared/deliver.ts'

const CAMPAIGN = 'AISENSY_RATING_CAMPAIGN'
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const who = caller(req)
  if (!who) return json({ error: 'unauthorised' }, 401)

  let businessId = ''
  let memberIds: string[] = []
  try {
    const b = await req.json()
    businessId = typeof b.businessId === 'string' ? b.businessId : ''
    memberIds = Array.isArray(b.memberIds) ? [...new Set(b.memberIds.filter((x: unknown) => typeof x === 'string'))] as string[] : []
  } catch { return json({ error: 'invalid JSON' }, 400) }
  if (!businessId || !memberIds.length) return json({ error: 'businessId and memberIds required' }, 400)
  if (memberIds.length > 100) return json({ ok: false, message: 'Ask up to 100 patients at a time.' }, 400)

  const own = await ownSender(who.asService, businessId)
  // No template approved yet: say so before anybody is charged.
  if (!canSendTemplate({ campaignEnv: CAMPAIGN, sender: own ?? undefined })) {
    return json({ ok: false, sent: 0, skipped: [], message: 'Review requests on WhatsApp are not switched on yet. Sehatsandhi has been told.' })
  }

  let sent = 0
  const skipped: { memberId: string; why: string }[] = []
  for (const memberId of memberIds) {
    // As the caller: a patient of another clinic is simply refused.
    const { data: open, error } = await who.asCaller.rpc('sehat_rating_ask_open', { p_business: businessId, p_member: memberId })
    if (error) return json({ ok: false, sent, skipped, message: error.message.includes('Not your clinic') ? 'Not your clinic.' : error.message }, 403)
    if (!open?.ok) { skipped.push({ memberId, why: String(open?.text ?? 'Could not be asked.') }); continue }
    const close = (ok: boolean, id?: string, tx?: string, err?: string) =>
      who.asService.rpc('sehat_rating_ask_close', { p_ask: open.ask, p_sent: ok, p_message_id: id ?? null, p_tx: tx ?? null, p_error: err ?? null })
        .then(() => undefined, () => undefined)

    // 0261: from the clinic's own number when it has one (Pro) — the clinic
    // pays Meta for that itself, so nothing is taken from the wallet.
    if (own) {
      const r = await sendTemplate({
        campaignEnv: CAMPAIGN, to: open.phone, userName: open.name || 'Patient',
        params: [open.name || 'जी', open.doctor, open.visit], sender: own,
      })
      await close(r.ok, r.id, undefined, r.ok ? undefined : r.error ?? 'not sent')
      if (r.ok) {
        sent++
        await who.asService.rpc('sehat_wa_clinic_sent', { p_phone: open.phone, p_business: businessId, p_message_id: r.id ?? null }).then(() => undefined, () => undefined)
      } else skipped.push({ memberId, why: r.unreachable ? 'This number is not on WhatsApp.' : 'WhatsApp did not accept the message.' })
      continue
    }

    const { data: charge, error: cErr } = await who.asService.rpc('sehat_wallet_charge_direct', {
      p_business: businessId, p_note: `Review request to ${open.name || 'a patient'}`,
    })
    if (cErr) { await close(false, undefined, undefined, cErr.message); skipped.push({ memberId, why: 'The wallet could not be charged.' }); continue }
    if (charge?.needs_plan) {
      await close(false, undefined, undefined, 'no WhatsApp add-on')
      return json({ ok: sent > 0, sent, skipped, needsPlan: true, message: String(charge.text ?? 'Add WhatsApp to your plan to send on WhatsApp.') })
    }
    if (!charge?.ok) {
      await close(false, undefined, undefined, 'wallet short')
      return json({
        ok: sent > 0, sent, skipped, walletShort: true,
        message: `Your WhatsApp wallet has ${rupees(Number(charge?.balance_paise ?? 0))}; each request costs ${rupees(Number(charge?.rate_paise ?? 0))}. Top up in the WhatsApp tab to ask the rest.`,
      })
    }

    const r = await sendTemplate({
      campaignEnv: CAMPAIGN, to: open.phone, userName: open.name || 'Patient',
      params: [open.name || 'जी', open.doctor, open.visit], fromClinic: true,
    })
    if (r.ok) {
      sent++
      await close(true, r.id, charge.tx)
      // So the patient's reply on the shared clinic line is known to be for this clinic.
      await who.asService.rpc('sehat_wa_clinic_sent', { p_phone: open.phone, p_business: businessId, p_message_id: r.id ?? null }).then(() => undefined, () => undefined)
    } else {
      await who.asService.rpc('sehat_wallet_refund_direct', { p_tx: charge.tx }).then(() => undefined, () => undefined)
      await close(false, undefined, undefined, r.error ?? 'not sent')
      skipped.push({ memberId, why: r.unreachable ? 'This number is not on WhatsApp.' : 'WhatsApp did not accept the message; nothing was charged.' })
    }
  }
  return json({ ok: sent > 0 || skipped.length === 0, sent, skipped })
})
