import { supabase } from './supabase'
import { activeConfig } from './env'

// Sending a patient their document — a prescription, bill, discharge summary
// or lab report — by the channel the clinic picks (0218):
//
//   whatsapp  needs the WhatsApp add-on, and is paid for from the wallet;
//   email     free: sent by Sehatsandhi under the clinic's name, replies go to the clinic;
//   own email the clinic's own mail app, opened with the link filled in.
//
// One function per document already exists (sendPrescription, sendBill, …);
// those name no channel and are what older screens and the app before 1.2
// call. The Send menu uses these.

export type DocKind = 'prescription' | 'bill' | 'discharge' | 'report' | 'report_file'

const FN: Record<DocKind, [fn: string, idKey: string]> = {
  prescription: ['prescription-send', 'prescriptionId'],
  bill: ['bill-send', 'billId'],
  discharge: ['discharge-send', 'summaryId'],
  report: ['lab-report-send', 'reportId'],
  report_file: ['lab-report-send', 'uploadId'],
}

async function call(kind: DocKind, id: string, extra: Record<string, unknown>) {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured for sending.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again to send this.')
  const [fn, idKey] = FN[kind]
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: anon },
    body: JSON.stringify({ [idKey]: id, ...extra }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.message ?? body.error ?? 'Could not send it.')
  return body
}

/** 0232: ask patients of this clinic for a review on WhatsApp, each paid from the clinic's wallet. */
export interface ReviewAsk { ok: boolean; sent: number; skipped: { memberId: string; why: string }[]; needsPlan?: boolean; walletShort?: boolean; message?: string }
export async function askForReviews(businessId: string, memberIds: string[]): Promise<ReviewAsk> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured for sending.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again.')
  const res = await fetch(`${url}/functions/v1/rating-ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: anon },
    body: JSON.stringify({ businessId, memberIds }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok && !('sent' in body)) throw new Error(body.message ?? body.error ?? 'Could not ask.')
  return { sent: 0, skipped: [], ...body } as ReviewAsk
}

export interface Sent {
  whatsapp: boolean
  email: boolean
  /** The clinic does not have the WhatsApp add-on. */
  needsPlan?: boolean
}

/** Send on one channel. Throws, in words for the clinic, when nothing went. */
export async function sendDocument(kind: DocKind, id: string, channel: 'whatsapp' | 'email', email?: string): Promise<Sent> {
  const body = await call(kind, id, { channel, email })
  if (!body.ok) {
    const e = new Error(body.message ?? (channel === 'email'
      ? 'The email could not be sent. Check the address, or use your own email app.'
      : 'It could not be sent on WhatsApp. Try email, or give the patient a printed copy.')) as Error & { needsPlan?: boolean }
    e.needsPlan = !!body.needsPlan
    throw e
  }
  return body as Sent
}

export interface DocLink { link: string; patientName: string; clinicName: string; label: string }

/** The patient's private link, for the clinic to send from its own email app. */
export async function documentLink(kind: DocKind, id: string): Promise<DocLink> {
  const body = await call(kind, id, { channel: 'link' })
  if (!body.link) throw new Error('Update needed: this option is not available yet. Use Email.')
  return body as DocLink
}

export interface SendOptions {
  /** Why this clinic cannot send on WhatsApp; null when it can. */
  whatsapp_blocker: string | null
  whatsapp_paise: number
  balance_paise: number
  /** 0259: this month's free messages; absent before 0259. */
  free_total?: number
  free_left?: number
  free_renews_on?: string | null
}

const dayMonth = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** 0259: free messages left this month (0 before 0259 or without the add-on). */
export const freeLeft = (o: SendOptions | null) => Math.max(0, o?.free_left ?? 0)

/** Can a WhatsApp message go now — free, or paid from the wallet? */
export const canAfford = (o: SendOptions) => freeLeft(o) > 0 || o.balance_paise >= o.whatsapp_paise

/** The line under the WhatsApp button about the free messages, or null when the clinic has none this month. */
export function freeNote(o: SendOptions | null): string | null {
  if (!o?.free_total) return null
  const renews = o.free_renews_on ? `renews ${dayMonth(o.free_renews_on)}` : 'renews next month'
  return freeLeft(o) > 0
    ? `Free this month: ${freeLeft(o)} of ${o.free_total} left (${renews}). After that, from your wallet.`
    : `This month's ${o.free_total} free messages are used (${renews}).`
}

/** null when the database does not know yet (before 0218): the menu then shows WhatsApp without a price. */
export async function getSendOptions(businessId: string): Promise<SendOptions | null> {
  const { data, error } = await supabase.rpc('sehat_send_options', { p_business: businessId })
  return error ? null : (data as SendOptions)
}

/** A mailto: link that opens the clinic's own email app with everything filled in. */
export function mailtoFor(d: DocLink, to: string): string {
  const subject = `${d.label} from ${d.clinicName}`
  const body = [`Hello ${d.patientName},`, '', `Please find your ${d.label} here:`, d.link, '',
    'This link is private to you — please do not share it.', '', d.clinicName].join('\n')
  return `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
