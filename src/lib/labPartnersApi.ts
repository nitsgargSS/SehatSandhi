import { supabase } from './supabase'

// 0291: a hospital and a lab settle up — agreed terms, one ledger both sides
// see, statements, paid. Business to business only: nothing goes to a doctor.

export interface Partner {
  partnership_id: string | null
  other_id: string
  other_name: string
  other_phone: string | null
  /** This business's side of the pair. */
  i_am: 'hospital' | 'lab'
  status: 'none' | 'proposed' | 'active' | 'ended'
  proposed_by_me: boolean | null
  b2b_pct: number | null
  fee_pct: number | null
  cycle: 'weekly' | 'monthly' | null
  notes: string | null
  agreed_b2b_pct: number | null
  agreed_fee_pct: number | null
  agreed_cycle: 'weekly' | 'monthly' | null
  agreed_at: string | null
  open_hospital_owes: number
  open_lab_owes: number
  open_lines: number
  unpaid_statements: number
  unpaid_net: number
}

export interface LedgerLine {
  entry_date: string
  order_no: string
  patient_name: string
  tests: string | null
  ordered_by_name: string | null
  payer: 'patient' | 'hospital'
  kind: 'hospital_owes' | 'lab_owes'
  gross: number
  pct: number
  amount: number
  statement_no: string | null
}

export interface Statement {
  id: string
  hospital_id: string
  lab_id: string
  statement_no: string
  period_from: string
  period_to: string
  hospital_owes: number
  lab_owes: number
  /** Positive: the hospital pays the lab. Negative: the lab pays the hospital. */
  net: number
  lines: number
  status: 'open' | 'paid'
  paid_at: string | null
  paid_ref: string | null
  paid_by_name: string | null
  made_by_name: string | null
  created_at: string
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }
const nums = <T extends object>(r: T, keys: (keyof T)[]): T => {
  const o = { ...r } as Record<string, unknown>
  for (const k of keys) if (o[k as string] != null) o[k as string] = Number(o[k as string])
  return o as T
}

export async function getPartners(businessId: string): Promise<Partner[]> {
  const { data, error } = await supabase.rpc('sehat_lab_partners', { p_business: businessId })
  oops(error)
  return ((data ?? []) as Partner[]).map(p => nums(p, ['b2b_pct', 'fee_pct', 'agreed_b2b_pct', 'agreed_fee_pct', 'open_hospital_owes', 'open_lab_owes', 'unpaid_net']))
}

export async function getPartnerCandidates(businessId: string, query: string): Promise<{ id: string; name: string; city: string | null; sent: number }[]> {
  const { data, error } = await supabase.rpc('sehat_partner_candidates', { p_business: businessId, p_query: query.trim() || null })
  oops(error)
  return (data ?? []) as { id: string; name: string; city: string | null; sent: number }[]
}

export async function proposeTerms(businessId: string, otherId: string, t: { b2bPct: number; feePct: number; cycle: 'weekly' | 'monthly'; notes: string }) {
  const { error } = await supabase.rpc('sehat_lab_partner_propose', {
    p_business: businessId, p_other: otherId, p_b2b_pct: t.b2bPct, p_fee_pct: t.feePct, p_cycle: t.cycle, p_notes: t.notes.trim() || null,
  })
  oops(error)
}

export async function acceptTerms(partnershipId: string) {
  const { error } = await supabase.rpc('sehat_lab_partner_accept', { p_partnership: partnershipId })
  oops(error)
}

export async function endPartnership(partnershipId: string) {
  const { error } = await supabase.rpc('sehat_lab_partner_end', { p_partnership: partnershipId })
  oops(error)
}

export async function getLedgerLines(businessId: string, otherId: string, statementId?: string): Promise<LedgerLine[]> {
  const { data, error } = await supabase.rpc('sehat_lab_ledger_lines', { p_business: businessId, p_other: otherId, p_statement: statementId ?? null })
  oops(error)
  return ((data ?? []) as LedgerLine[]).map(l => nums(l, ['gross', 'pct', 'amount']))
}

export async function getStatements(businessId: string, otherId: string): Promise<Statement[]> {
  const { data, error } = await supabase.rpc('sehat_lab_statements', { p_business: businessId, p_other: otherId })
  oops(error)
  return ((data ?? []) as Statement[]).map(s => nums(s, ['hospital_owes', 'lab_owes', 'net']))
}

export async function makeStatement(businessId: string, otherId: string) {
  const { error } = await supabase.rpc('sehat_lab_statement_make', { p_business: businessId, p_other: otherId, p_to: null })
  oops(error)
}

export async function markStatementPaid(statementId: string, ref: string) {
  const { error } = await supabase.rpc('sehat_lab_statement_paid', { p_statement: statementId, p_ref: ref })
  oops(error)
}

/** The terms in words, from the hospital's or the lab's side. */
export function termsText(b2b: number | null, fee: number | null, cycle: string | null): string {
  const parts = [
    `tests the hospital pays for at ${b2b ? `${b2b}% off` : 'the lab\'s price'}`,
    fee ? `a ${fee}% service fee to the hospital on tests the patient pays the lab for` : 'no service fee',
    `${cycle ?? 'monthly'} statements`,
  ]
  return parts.join(' · ')
}
