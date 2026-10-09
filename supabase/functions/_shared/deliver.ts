// Handing a patient a document, as a link.
//
// Shared by prescription-send and discharge-send, which differ only in which
// table they read, which path the link points at, and which WhatsApp template
// carries it. Everything else — which channel, what it costs, what gets
// recorded — is the same job, and was the same code twice until this file
// existed.
//
// THE CLINIC CHOOSES THE CHANNEL (0218):
//   whatsapp  needs the WhatsApp add-on and is paid for from the wallet;
//   email     is free — sent from no-reply@ under the clinic's name, with
//             replies going to the clinic's own address.
// A caller that names no channel (the app before 1.2) gets what it always
// did: WhatsApp, and email as well when an address came with it.
//
// THE CLINIC PAYS FOR THE WHATSAPP MESSAGE (0217). Its wallet is charged
// before the send and refunded if WhatsApp does not take it; a wallet that
// cannot cover it means no WhatsApp message, and the clinic is told why.
// Email is not charged.
//
// A LINK, NEVER AN ATTACHMENT. No PDF library, it renders on whatever phone
// opens it, and — the part that matters for health data — no second copy
// sitting in an inbox or a WhatsApp media folder after the link has expired.

import { canSendTemplate, sendTemplate, type WaProvider } from './whatsapp.ts'
import { emailConfigured, esc, layout, sendEmail } from './email.ts'

export type Channel = 'whatsapp' | 'email'

/** The channel a request asked for; undefined when it named none. */
export const asChannel = (v: unknown): Channel | undefined => v === 'whatsapp' || v === 'email' ? v : undefined

export interface DeliveryTarget {
  /** Digits only. Empty means WhatsApp is skipped. */
  phone: string
  /** Whose wallet pays for the WhatsApp message. */
  businessId: string
  /** The one channel to use. Unset: WhatsApp, and email too when an address is given. */
  channel?: Channel
  patientName: string
  clinicName: string
  /** The full https URL the patient opens. */
  link: string
  /** Secret holding the AiSensy campaign name for this document type (see whatsapp.ts). */
  campaignEnv: string
  /** Optional — email is skipped entirely without one. */
  email?: string | null
  /** For the message log: 'prescription', 'discharge_summary'. */
  documentKind: string
  /** Shown in the log preview, e.g. 'Prescription RX/2026-27/0041'. */
  documentLabel: string
}

export interface DeliveryResult {
  sent: string[]
  errors: string[]
  /** Which WhatsApp provider answered, for the message log. */
  whatsappProvider?: WaProvider | null
  /** What the wallet paid for the WhatsApp message, in paise. 0: nothing was taken, or it was put back. */
  chargedPaise: number
  /** The wallet could not cover the message — the clinic needs to top up. */
  walletShort?: { ratePaise: number; balancePaise: number }
  /** The clinic does not have the WhatsApp add-on: why, in words for it. */
  needsPlan?: string
}

/**
 * Send the link over whatever channels are configured.
 *
 * Never throws. A provider outage must not fail whatever called this — a
 * prescription is still issued and a patient still discharged if the message
 * does not go. The caller records `errors` so a clinic can see the send failed
 * rather than assuming it worked.
 */
export async function sendDocumentLink(
  // deno-lint-ignore no-explicit-any
  supabase: any, t: DeliveryTarget,
): Promise<DeliveryResult> {
  const sent: string[] = []
  const errors: string[] = []
  const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`
  let chargedPaise = 0
  let walletShort: DeliveryResult['walletShort']
  let needsPlan: string | undefined

  // ── WhatsApp ──
  let whatsappProvider: WaProvider | null = null
  if (t.channel === 'email') {
    // Email was chosen: nothing goes on WhatsApp and nothing is charged.
  } else if (!t.phone) {
    errors.push('no phone number on the record')
  } else if (!canSendTemplate({ campaignEnv: t.campaignEnv })) {
    // No provider carries this message yet: say so, and take no money.
    errors.push(`${t.campaignEnv} is not set`)
  } else {
    // Charged first, under the wallet's lock; put back if the message does not go.
    const { data: charge, error: cErr } = await supabase.rpc('sehat_wallet_charge_direct', {
      p_business: t.businessId, p_note: `${t.documentLabel} to ${t.patientName}`,
    })
    if (cErr) {
      errors.push(`whatsapp: the wallet could not be charged (${cErr.message})`)
    } else if (charge?.needs_plan) {
      needsPlan = String(charge.text ?? 'Add WhatsApp to your plan to send on WhatsApp.')
      errors.push(`whatsapp: ${needsPlan}`)
    } else if (!charge?.ok) {
      walletShort = { ratePaise: Number(charge?.rate_paise ?? 0), balancePaise: Number(charge?.balance_paise ?? 0) }
      errors.push(`whatsapp: not enough WhatsApp balance — this message costs ${rupees(walletShort.ratePaise)}, the wallet has ${rupees(walletShort.balancePaise)}. Top up to send.`)
    } else {
      const r = await sendTemplate({
        campaignEnv: t.campaignEnv, to: t.phone, userName: t.patientName,
        params: [t.patientName, t.clinicName, t.link], fromClinic: true,
      })
      whatsappProvider = r.provider
      if (r.ok) {
        sent.push('whatsapp')
        chargedPaise = Number(charge.rate_paise ?? 0)
      } else {
        errors.push(r.error ?? 'whatsapp: not sent')
        const { error: rErr } = await supabase.rpc('sehat_wallet_refund_direct', { p_tx: charge.tx })
        // The clinic paid for a message that did not go: this must be seen.
        if (rErr) console.error(`deliver: refund of wallet charge ${charge.tx} failed: ${rErr.message}`)
      }
    }
  }

  // ── Email ──
  if (t.channel === 'whatsapp') {
    // WhatsApp was chosen: no email.
  } else if (!t.email) {
    if (t.channel === 'email') errors.push('email: no email address was given')
  } else if (!emailConfigured()) {
    errors.push('email: sending email is not set up')
  } else {
    // Replies go to the clinic, not to us: it is the clinic's patient.
    const { data: biz } = await supabase.from('businesses').select('email').eq('id', t.businessId).maybeSingle()
    const replyTo = typeof biz?.email === 'string' && biz.email.includes('@') ? biz.email : undefined
    const title = `${t.documentLabel} from ${t.clinicName}`
    const r = await sendEmail({
      to: t.email, toName: t.patientName,
      fromName: `${t.clinicName} via Sehatsandhi`,
      replyTo, replyToName: replyTo ? t.clinicName : undefined,
      subject: title,
      html: layout(title, `
<p style="margin:0 0 14px">Hello ${esc(t.patientName)},</p>
<p style="margin:0 0 18px"><b>${esc(t.clinicName)}</b> has sent you: ${esc(t.documentLabel)}.</p>
<p style="margin:0 0 18px"><a href="${esc(t.link)}" style="display:inline-block;background:#0f6b4a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold">Open it</a></p>
<p style="margin:0;color:#5b6b63;font-size:13px">This link is private to you — please do not share it.${replyTo ? ` To write to ${esc(t.clinicName)}, reply to this email.` : ''}</p>`),
      text: [`Hello ${t.patientName},`, '', `${t.clinicName} has sent you: ${t.documentLabel}.`, '', `Open it: ${t.link}`, '',
        'This link is private to you — please do not share it.'].join('\n'),
    })
    if (r.ok) sent.push('email')
    else errors.push(`email: ${r.error.slice(0, 150)}`)
  }

  return { sent, errors, whatsappProvider, chargedPaise, walletShort, needsPlan }
}

/**
 * What to tell the clinic when its wallet could not cover the WhatsApp
 * message — in its words, not the provider's. undefined: that is not what happened.
 */
export function walletMessage(r: DeliveryResult): string | undefined {
  const also = r.sent.includes('email') ? ' It was sent by email.' : ''
  if (r.needsPlan) return `Not sent on WhatsApp: ${r.needsPlan}${also}`
  if (!r.walletShort) return undefined
  const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`
  return `Not sent on WhatsApp: a message costs ${rupees(r.walletShort.ratePaise)} and your WhatsApp wallet has ${rupees(r.walletShort.balancePaise)}. Top up in the WhatsApp tab, then send again.${also}`
}

/**
 * The same log every other outbound message writes, so everything that reaches
 * a patient is visible in one place.
 *
 * The link is deliberately NOT in the preview: message_log is read by staff,
 * and an unexpired document link sitting in it is a way around the access rules
 * on the record itself.
 */
export async function logDelivery(
  // deno-lint-ignore no-explicit-any
  supabase: any, t: DeliveryTarget, r: DeliveryResult,
) {
  await supabase.from('message_log').insert({
    phone: t.phone || null,
    channel: r.sent.includes('whatsapp') ? 'whatsapp' : (r.sent.includes('email') || t.channel === 'email' ? 'email' : 'whatsapp'),
    provider: r.sent.includes('email') && !r.sent.includes('whatsapp') ? 'zeptomail' : (r.whatsappProvider ?? 'aisensy'),
    campaign: t.documentKind,
    body_preview: `${t.documentLabel} from ${t.clinicName}`,
    status: r.sent.length ? 'sent' : 'failed',
    error_detail: r.errors.length ? r.errors.join(' | ').slice(0, 500) : null,
    sent_at: r.sent.length ? new Date().toISOString() : null,
  })
}
