// Handing a patient a document, as a link.
//
// Shared by prescription-send and discharge-send, which differ only in which
// table they read, which path the link points at, and which AiSensy campaign
// carries it. Everything else — WhatsApp first, email when an address is given,
// per-channel skip when unconfigured, what gets recorded — is the same job, and
// was the same code twice until this file existed.
//
// A LINK, NEVER AN ATTACHMENT. No PDF library, it renders on whatever phone
// opens it, and — the part that matters for health data — no second copy
// sitting in an inbox or a WhatsApp media folder after the link has expired.

export interface DeliveryTarget {
  /** Digits only. Empty means WhatsApp is skipped. */
  phone: string
  patientName: string
  clinicName: string
  /** The full https URL the patient opens. */
  link: string
  /** Env var holding the AiSensy campaign name for this document type. */
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
}

/**
 * Send the link over whatever channels are configured.
 *
 * Never throws. A provider outage must not fail whatever called this — a
 * prescription is still issued and a patient still discharged if the message
 * does not go. The caller records `errors` so a clinic can see the send failed
 * rather than assuming it worked.
 */
export async function sendDocumentLink(t: DeliveryTarget): Promise<DeliveryResult> {
  const sent: string[] = []
  const errors: string[] = []

  // ── WhatsApp ──
  const aisensyKey = Deno.env.get('AISENSY_API_KEY')
  const campaign = Deno.env.get(t.campaignEnv)

  if (aisensyKey && campaign && t.phone) {
    try {
      const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: aisensyKey,
          campaignName: campaign,
          destination: t.phone,
          userName: t.patientName,
          templateParams: [t.patientName, t.clinicName, t.link],
        }),
      })
      if (res.ok) sent.push('whatsapp')
      else errors.push(`whatsapp ${res.status}: ${(await res.text()).slice(0, 150)}`)
    } catch (e) {
      errors.push(`whatsapp: ${String((e as Error).message ?? e)}`)
    }
  } else if (!t.phone) {
    errors.push('no phone number on the record')
  } else if (!campaign) {
    errors.push(`${t.campaignEnv} is not set`)
  }

  // ── Email, only when an address was given ──
  const msg91Key = Deno.env.get('MSG91_AUTHKEY')
  const emailTemplate = Deno.env.get('MSG91_EMAIL_TEMPLATE_ID')
  const emailFrom = Deno.env.get('MSG91_EMAIL_FROM')
  const emailDomain = Deno.env.get('MSG91_EMAIL_DOMAIN')

  if (t.email && msg91Key && emailTemplate && emailFrom && emailDomain) {
    try {
      const res = await fetch('https://control.msg91.com/api/v5/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: msg91Key },
        body: JSON.stringify({
          to: [{ email: t.email, name: t.patientName }],
          from: { email: emailFrom, name: t.clinicName },
          domain: emailDomain,
          template_id: emailTemplate,
          variables: {
            patient_name: t.patientName,
            clinic_name: t.clinicName,
            document: t.documentLabel,
            link: t.link,
          },
        }),
      })
      if (res.ok) sent.push('email')
      else errors.push(`email ${res.status}: ${(await res.text()).slice(0, 150)}`)
    } catch (e) {
      errors.push(`email: ${String((e as Error).message ?? e)}`)
    }
  }

  return { sent, errors }
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
    channel: r.sent.includes('whatsapp') ? 'whatsapp' : (r.sent.includes('email') ? 'email' : 'whatsapp'),
    provider: r.sent.includes('email') && !r.sent.includes('whatsapp') ? 'msg91' : 'aisensy',
    campaign: t.documentKind,
    body_preview: `${t.documentLabel} from ${t.clinicName}`,
    status: r.sent.length ? 'sent' : 'failed',
    error_detail: r.errors.length ? r.errors.join(' | ').slice(0, 500) : null,
    sent_at: r.sent.length ? new Date().toISOString() : null,
  })
}
