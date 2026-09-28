import { supabase } from './supabase'

// Doctor leads, the admin's CRM (0115). Since 0154 a lead has an owner, a
// timeline of who did what, a target date and a closing reason. RLS: an admin
// sees every lead; a manager sees their own and the unassigned ones.

export const LEAD_STAGES = ['called', 'interested', 'registered', 'active', 'not_interested'] as const
export type LeadStage = typeof LEAD_STAGES[number]

export const STAGE_LABEL: Record<LeadStage, string> = {
  called: 'Called',
  interested: 'Interested',
  registered: 'Registered',
  active: 'Active',
  not_interested: 'Not interested',
}

// Where a lead came from. A known list rather than free text, so the source
// filter groups them; add a campaign here when a new video or ad goes out.
export const LEAD_SOURCES: { id: string; label: string }[] = [
  { id: 'video_founder_intro', label: 'Video: founder intro' },
  { id: 'video_doctors_flow', label: 'Video: doctors flow' },
  { id: 'meta_ad', label: 'Meta ad' },
  { id: 'inbound_call', label: 'Inbound call' },
  { id: 'referral', label: 'Referral' },
  { id: 'other', label: 'Other' },
]

export const CONSENT_TYPES: { id: string; label: string }[] = [
  { id: 'called_us', label: 'Called us' },
  { id: 'messaged_us', label: 'Messaged us' },
  { id: 'ad_optin', label: 'Ad opt-in' },
]

export const sourceLabel = (id: string | null) =>
  LEAD_SOURCES.find(s => s.id === id)?.label ?? id ?? '—'

export const CLOSE_REASONS: { id: string; label: string; won?: boolean }[] = [
  { id: 'registered', label: 'Registered — won', won: true },
  { id: 'not_interested', label: 'Not interested' },
  { id: 'too_expensive', label: 'Too expensive' },
  { id: 'other_software', label: 'Uses other software' },
  { id: 'unreachable', label: 'Unreachable' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'other', label: 'Other' },
]
export const closeLabel = (id: string | null) => CLOSE_REASONS.find(r => r.id === id)?.label ?? id ?? ''

/** What a person can log by hand. The rest of the timeline is written by the database. */
export const ACTIVITY_KINDS = [
  { id: 'call', label: 'Call' }, { id: 'whatsapp', label: 'WhatsApp' }, { id: 'email', label: 'Email' },
  { id: 'meeting', label: 'Meeting' }, { id: 'note', label: 'Note' },
] as const
export type ActivityKind = typeof ACTIVITY_KINDS[number]['id']

export const CALL_OUTCOMES: { id: string; label: string }[] = [
  { id: 'connected', label: 'Spoke to them' }, { id: 'no_answer', label: 'No answer' }, { id: 'busy', label: 'Busy' },
  { id: 'switched_off', label: 'Switched off' }, { id: 'callback', label: 'Asked to call back' },
  { id: 'interested', label: 'Interested' }, { id: 'not_interested', label: 'Not interested' },
  { id: 'wrong_number', label: 'Wrong number' },
]
export const outcomeLabel = (id: string | null) => CALL_OUTCOMES.find(o => o.id === id)?.label ?? id ?? ''

export interface Lead {
  id: string
  name: string | null
  /** 91XXXXXXXXXX */
  phone: string
  source: string | null
  consent_type: string | null
  stage: LeadStage
  next_followup: string | null
  registered_at: string | null
  created_at: string
  updated_at: string
  /** 0154 */
  assigned_to: string | null
  target_close: string | null
  closed_at: string | null
  close_reason: string | null
  email: string | null
  city: string | null
}

export interface LeadNote {
  id: string
  lead_id: string
  note: string
  created_at: string
  /** 0154: note | call | whatsapp | email | meeting, or an automatic entry. */
  kind: string
  outcome: string | null
  author_uid: string | null
  author_label: string | null
}

export interface Assignee { auth_uid: string; name: string; role: string }

export interface TeamRow {
  auth_uid: string; name: string; role: string
  open_leads: number; due_today: number; overdue: number
  touches_7d: number; calls_7d: number; won_30d: number; lost_30d: number
  last_touch: string | null
}

/**
 * Any way an Indian mobile gets typed — "98765 43210", "+91-98765-43210",
 * "09876543210" — to 91XXXXXXXXXX, or null if it is not one. The same shape
 * the table's CHECK accepts, so the duplicate lookup and the insert agree.
 */
export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10) d = '91' + d
  return /^91[6-9]\d{9}$/.test(d) ? d : null
}

/** 919876543210 → +91 98765 43210 */
export const displayPhone = (p: string) =>
  p.length === 12 ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : p

export async function listLeads(): Promise<Lead[]> {
  const { data, error } = await supabase.from('doctor_leads').select('*')
  if (error) throw new Error(error.message)
  return (data ?? []) as Lead[]
}

export async function findLeadByPhone(phone: string): Promise<Lead | null> {
  const { data, error } = await supabase.from('doctor_leads').select('*').eq('phone', phone).maybeSingle()
  if (error) throw new Error(error.message)
  return data as Lead | null
}

export async function createLead(lead: Pick<Lead, 'name' | 'phone' | 'source' | 'consent_type'> & Partial<Pick<Lead, 'assigned_to' | 'email' | 'city'>>): Promise<Lead> {
  const { data, error } = await supabase.from('doctor_leads').insert(lead).select('*').single()
  if (error) throw new Error(error.code === '23505' ? 'This number already has a lead.' : error.message)
  return data as Lead
}

export async function updateLead(id: string, patch: Partial<Pick<Lead, 'stage' | 'next_followup' | 'assigned_to' | 'target_close' | 'close_reason' | 'email' | 'city'>>): Promise<Lead> {
  // .select() so a write RLS silently filtered out comes back as an error
  // rather than as a success that changed nothing.
  const { data, error } = await supabase.from('doctor_leads').update(patch).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as Lead
}

export async function listNotes(leadId: string): Promise<LeadNote[]> {
  const { data, error } = await supabase.from('doctor_lead_notes').select('*')
    .eq('lead_id', leadId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LeadNote[]
}

export async function addNote(leadId: string, note: string): Promise<LeadNote> {
  return logActivity(leadId, 'note', null, note)
}

/** A call, WhatsApp, email, meeting or note. The author is set by the database. */
export async function logActivity(leadId: string, kind: ActivityKind, outcome: string | null, note: string): Promise<LeadNote> {
  const { data, error } = await supabase.from('doctor_lead_notes')
    .insert({ lead_id: leadId, kind, outcome, note: note.trim() }).select('*').single()
  if (error) throw new Error(error.message)
  return data as LeadNote
}

export async function listAssignees(): Promise<Assignee[]> {
  const { data, error } = await supabase.rpc('sehat_lead_assignees')
  if (error) throw new Error(error.message)
  return (data ?? []) as Assignee[]
}

/** Admins only; a manager gets an empty list. */
export async function teamSummary(): Promise<TeamRow[]> {
  const { data, error } = await supabase.rpc('sehat_lead_team_summary')
  if (error) throw new Error(error.message)
  return (data ?? []) as TeamRow[]
}
