import { supabase } from './supabase'

// 0192: insurance leads. Advisors list free and pay a flat fee for each lead
// they choose to accept, from their prepaid wallet. The first to accept gets
// the lead alone — only then the person's name and number. Nothing here is
// tied to a policy or its premium (Section 40, Insurance Act).

export type LeadStatus = 'open' | 'accepted' | 'contacted' | 'won' | 'lost' | 'disputed' | 'expired' | 'cancelled'
export interface LeadEvent { event: string; by: string | null; note: string | null; at: string }

export interface Lead {
  id: string; code: string; status: LeadStatus; pin_code: string
  cover: string | null; members: string | null; call_time: string | null
  created_at: string; accepted_at: string | null; accepted_by_name: string | null
  fee_paise: number | null; fee_refunded: boolean; contacted_at: string | null; outcome_at: string | null
  insurer: string | null; plan_name: string | null; lost_reason: string | null
  dispute_reason: string | null; dispute_resolution: string | null; patient_not_called_at: string | null
  patient_bought: boolean | null; rating: number | null; review: string | null; ended_reason: string | null
  mine: boolean; patient_name: string | null; patient_phone: string | null; events: LeadEvent[] | null
}
export type LeadScope = 'new' | 'active' | 'done'

export interface LeadSummary { lead_fee: number; balance_paise: number; licence: string | null; areas: number; is_owner: boolean }

export const LEAD_STATUS: Record<LeadStatus, string> = {
  open: 'New', accepted: 'To call', contacted: 'In talks', won: 'Policy bought', lost: 'Not bought',
  disputed: 'Reported', expired: 'Expired', cancelled: 'Cancelled',
}
export const LEAD_EVENT: Record<string, string> = {
  created: 'Requested', accepted: 'Accepted', declined: 'Declined', contacted: 'Contacted', won: 'Policy bought', lost: 'Not bought',
  disputed: 'Problem reported', refunded: 'Fee refunded', dispute_rejected: 'Report rejected', patient_not_called: 'Person says not called',
  patient_cancelled: 'Person cancelled', patient_rated: 'Person rated', outcome_mismatch: 'Outcomes differ', expired: 'Expired',
}

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const leadSummary = (businessId: string) => rpc<LeadSummary>('sehat_il_summary', { p_business: businessId })
export const listLeads = (businessId: string, scope: LeadScope) =>
  rpc<Lead[]>('sehat_il_list', { p_business: businessId, p_scope: scope }).then(r => r ?? [])
const act = (b: string, id: string, action: string, extra: Record<string, unknown> = {}) =>
  rpc<Lead>('sehat_il_act', { p_business: b, p_lead: id, p_action: action, ...extra })
export const acceptLead = (b: string, id: string) => act(b, id, 'accept')
export const declineLead = (b: string, id: string) => act(b, id, 'decline')
export const markContacted = (b: string, id: string, note: string) => act(b, id, 'contacted', { p_note: note || null })
export const markWon = (b: string, id: string, insurer: string, plan: string) => act(b, id, 'won', { p_insurer: insurer, p_plan: plan || null })
export const markLost = (b: string, id: string, reason: string) => act(b, id, 'lost', { p_note: reason || null })
export const reportLead = (b: string, id: string, reason: string) => act(b, id, 'dispute', { p_note: reason })

export const getLeadFee = () => rpc<number>('sehat_lead_fee', {})

export interface PublicLead {
  code: string; status: LeadStatus; pin_code: string; cover: string | null; members: string | null; call_time: string | null
  patient_name: string | null; created_at: string; accepted_at: string | null; contacted_at: string | null; outcome_at: string | null
  advisor: string | null; advisor_phone: string | null; advisor_licence: string | null
  patient_not_called_at: string | null; patient_bought: boolean | null; rating: number | null; review: string | null; others: string | null
}
export const getPublicLead = (token: string) => rpc<PublicLead | null>('sehat_il_public', { p_token: token })
export const leadNotCalled = (token: string) => rpc<PublicLead>('sehat_il_patient', { p_token: token, p_action: 'not_called' })
export const cancelLead = (token: string) => rpc<PublicLead>('sehat_il_patient', { p_token: token, p_action: 'cancel' })
export const rateLead = (token: string, bought: boolean | null, rating: number, review: string) =>
  rpc<PublicLead>('sehat_il_patient', { p_token: token, p_action: 'feedback', p_bought: bought, p_rating: rating, p_review: review || null })

export interface AdminLeadRow {
  id: string; code: string; status: LeadStatus; pin_code: string; created_at: string; advisor: string | null
  fee_paise: number | null; fee_refunded: boolean; dispute_reason: string | null; dispute_resolution: string | null
  patient_not_called: boolean; patient_bought: boolean | null; rating: number | null; outcome_mismatch: boolean; ended_reason: string | null
}
export const adminLeads = (days = 30) => rpc<AdminLeadRow[]>('sehat_admin_insurance_leads', { p_days: days }).then(r => r ?? [])
export const resolveLead = (id: string, refund: boolean, note: string) => rpc<string>('sehat_admin_resolve_lead', { p_lead: id, p_refund: refund, p_note: note || null })
export const setLeadFee = (rupees: number) => rpc<number>('sehat_admin_set_lead_fee', { p_rupees: rupees })
