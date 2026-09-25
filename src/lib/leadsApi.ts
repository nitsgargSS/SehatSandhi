import { supabase } from './supabase'

// Doctor leads, the admin's CRM (0115). Admin-only by RLS: for anyone else
// every read comes back empty and every write is refused.

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
}

export interface LeadNote {
  id: string
  lead_id: string
  note: string
  created_at: string
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

export async function createLead(lead: Pick<Lead, 'name' | 'phone' | 'source' | 'consent_type'>): Promise<Lead> {
  const { data, error } = await supabase.from('doctor_leads').insert(lead).select('*').single()
  if (error) throw new Error(error.code === '23505' ? 'This number already has a lead.' : error.message)
  return data as Lead
}

export async function updateLead(id: string, patch: Partial<Pick<Lead, 'stage' | 'next_followup'>>): Promise<Lead> {
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
  const { data, error } = await supabase.from('doctor_lead_notes').insert({ lead_id: leadId, note }).select('*').single()
  if (error) throw new Error(error.message)
  return data as LeadNote
}
