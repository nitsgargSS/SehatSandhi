import { supabase } from './supabase'

// 0255: marketing partners — who brought a business, and what they are owed.
// Admin only; the database refuses everyone else.

export interface Partner {
  id: string; name: string; code: string; kind: 'online' | 'field'
  contact_name: string | null; phone: string | null; email: string | null; notes: string | null
  active_from: string; active_to: string | null; active: boolean
  percent: number
  rates: { percent: number; effective_from: string; set_by: string | null }[]
  businesses: number; waiting: number
}
export interface Credit {
  business_id: string; name: string; vertical: string; city: string | null; business_status: string; registered_at: string
  status: 'proposed' | 'approved' | 'direct'
  heard_from: string | null; heard_detail: string | null
  proposed_id: string | null; proposed: string | null; partner_id: string | null; partner: string | null
  decided_by: string | null; decided_at: string | null; note: string | null; paid: number
}
export interface StatementLine {
  ref: string; business_id: string; business: string; kind: 'payment' | 'refund'; paid_on: string
  base: number; percent: number; incentive: number; detail: string; excluded: boolean; reason: string | null
}
export interface Statement {
  status: 'draft' | 'final' | 'paid'; month: string; total: number; lines: StatementLine[]
  finalised_by?: string | null; finalised_at?: string | null; paid_on?: string | null; paid_reference?: string | null
}

/** The registration form's question, and how each answer reads in admin. */
export const HEARD_FROM: [string, string][] = [
  ['online_search', 'Google / internet search'], ['online_ad', 'An online advertisement'], ['social_media', 'Facebook, Instagram or YouTube'],
  ['another_doctor', 'Another doctor or clinic'], ['sehatsandhi_person', 'Someone from Sehatsandhi visited or called'],
  ['patient', 'A patient told me'], ['other', 'Other'],
]
export const heardLabel = (k: string | null) => HEARD_FROM.find(h => h[0] === k)?.[1] ?? (k ? k : 'Not answered')

const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const getPartners = () => rpc<Partner[]>('sehat_partners')
export const savePartner = (p: { id?: string | null; name: string; code: string; kind: string; contact_name?: string; phone?: string; email?: string; notes?: string; active_from: string; active_to?: string | null }) =>
  rpc<string>('sehat_partner_save', {
    p_id: p.id ?? null, p_name: p.name, p_code: p.code, p_kind: p.kind, p_contact_name: p.contact_name ?? null, p_phone: p.phone ?? null,
    p_email: p.email ?? null, p_notes: p.notes ?? null, p_from: p.active_from, p_to: p.active_to || null,
  })
export const setPartnerRate = (partnerId: string, percent: number, from: string) =>
  rpc<void>('sehat_partner_set_rate', { p_partner: partnerId, p_percent: percent, p_from: from })
export const getCredits = (status?: string) => rpc<Credit[]>('sehat_partner_credits', { p_status: status ?? null })
/** partnerId null = nobody's (direct). */
export const decideCredit = (businessId: string, partnerId: string | null, note?: string) =>
  rpc<void>('sehat_partner_credit_decide', { p_business: businessId, p_partner: partnerId, p_note: note ?? null })
export const getStatement = (partnerId: string, month: string) => rpc<Statement>('sehat_partner_statement', { p_partner: partnerId, p_month: month })
/** reason '' puts the line back. */
export const excludeLine = (partnerId: string, month: string, ref: string, reason: string) =>
  rpc<void>('sehat_partner_statement_exclude', { p_partner: partnerId, p_month: month, p_ref: ref, p_reason: reason || null })
export const finaliseStatement = (partnerId: string, month: string) => rpc<Statement>('sehat_partner_statement_finalise', { p_partner: partnerId, p_month: month })
export const markStatementPaid = (partnerId: string, month: string, paidOn: string, reference: string) =>
  rpc<void>('sehat_partner_statement_paid', { p_partner: partnerId, p_month: month, p_paid_on: paidOn, p_reference: reference })

/** Registration: how the business heard of Sehatsandhi. Best effort. */
export const saveHeardFrom = (businessId: string, answer: string, detail?: string) =>
  supabase.rpc('sehat_signup_heard_from', { p_business: businessId, p_answer: answer, p_detail: detail ?? null }).then(() => undefined, () => undefined)
