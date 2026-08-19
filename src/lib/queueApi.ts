import { supabase } from './supabase'

// The OPD line.
//
// appointments is a promise to come; this is being here. A patient who booked
// through the bot still takes a token when they walk in, and the two are linked
// rather than merged — a clinic needs to see who honoured their slot.
//
// Issuing, calling and status changes all go through RPCs. Issuing needs the
// next number under a lock so two receptions cannot collide; calling needs
// SKIP LOCKED so two doctors pressing Next never get the same patient. Neither
// is expressible as a table write.

export type TokenStatus =
  | 'waiting' | 'called' | 'in_consultation' | 'completed' | 'skipped' | 'left'

export interface QueueEntry {
  id: string
  business_id: string
  practitioner_id: string | null
  queue_date: string
  token_number: number
  patient_member_id: string
  appointment_id: string | null
  visit_id: string | null
  status: TokenStatus
  priority: number
  priority_reason: string | null
  reason: string | null
  arrived_at: string
  called_at: string | null
  started_at: string | null
  completed_at: string | null
  // joined by the board
  patient_name: string
  age_years: number | null
  gender: string | null
  patient_phone: string | null
  practitioner_name: string | null
  mrn: string | null
  /** 1 = next. Null once they are no longer waiting. */
  waiting_position: number | null
  avg_consult_minutes: number
  /** Roughly how long they still have to wait, from today's own pace. */
  approx_wait_minutes: number | null
  had_appointment: boolean
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

/** Today's line, every doctor in the clinic. */
export async function getBoard(businessId: string): Promise<QueueEntry[]> {
  const { data, error } = await supabase.from('opd_board').select('*')
    .eq('business_id', businessId)
    .order('status').order('priority', { ascending: false }).order('arrived_at')
  oops(error)
  return (data ?? []) as QueueEntry[]
}

export interface IssueTokenInput {
  patientMemberId: string
  businessId: string
  practitionerId?: string | null
  reason?: string
  appointmentId?: string | null
  /** Higher is seen sooner. Anything non-zero must say why. */
  priority?: number
  priorityReason?: string
  createdBy?: string | null
}

export async function issueToken(i: IssueTokenInput): Promise<QueueEntry> {
  const { data, error } = await supabase.rpc('sehat_issue_token', {
    p_patient_member_id: i.patientMemberId,
    p_business_id: i.businessId,
    p_practitioner_id: i.practitionerId ?? null,
    p_reason: i.reason || null,
    p_appointment_id: i.appointmentId ?? null,
    p_priority: i.priority ?? 0,
    p_priority_reason: i.priorityReason || null,
    p_created_by: i.createdBy ?? null,
  })
  // The duplicate guard is the common one — somebody clicking twice, or a
  // patient sent back to reception who already has a live number.
  if (error) {
    throw new Error(error.message.includes('already has a live token')
      ? 'That patient already has a token in this line today.'
      : error.message)
  }
  return data as QueueEntry
}

/**
 * Call whoever is next.
 *
 * Returns null when the line is empty — not an error, just nobody waiting.
 */
export async function callNext(
  businessId: string, practitionerId?: string | null,
): Promise<QueueEntry | null> {
  const { data, error } = await supabase.rpc('sehat_call_next', {
    p_business_id: businessId,
    p_practitioner_id: practitionerId ?? null,
  })
  oops(error)
  return (data as QueueEntry) ?? null
}

export async function setTokenStatus(
  tokenId: string, status: TokenStatus, visitId?: string | null,
): Promise<QueueEntry> {
  const { data, error } = await supabase.rpc('sehat_set_token_status', {
    p_token_id: tokenId,
    p_status: status,
    p_visit_id: visitId ?? null,
  })
  oops(error)
  return data as QueueEntry
}

/** Still in the line, in the order they will be seen. */
export const stillWaiting = (board: QueueEntry[]): QueueEntry[] =>
  board.filter(e => e.status === 'waiting')
    .sort((a, b) => b.priority - a.priority || a.arrived_at.localeCompare(b.arrived_at))

/** Called or mid-consultation — the people a doctor is actually dealing with. */
export const inProgress = (board: QueueEntry[]): QueueEntry[] =>
  board.filter(e => e.status === 'called' || e.status === 'in_consultation')

/** Done, skipped or gone. What the day looked like. */
export const finished = (board: QueueEntry[]): QueueEntry[] =>
  board.filter(e => ['completed', 'skipped', 'left'].includes(e.status))
