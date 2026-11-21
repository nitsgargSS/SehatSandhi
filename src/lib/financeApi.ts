import { supabase } from './supabase'

// Treatment on EMI, hospital side (0326). Reads go straight to the tables —
// RLS shows a hospital only its own cases and the lenders' statuses on them.
// Every write is a checked function in the database; nothing here writes a
// table directly. Sehatsandhi never lends, holds money or decides credit: the
// hospital confirms the treatment and estimate, the patient consents and picks
// a lender, the lender sanctions and pays the hospital.

export type CaseStatus = 'requested' | 'hospital_confirmed' | 'shared' | 'offered' | 'sanctioned'
  | 'disbursed' | 'closed' | 'declined' | 'withdrawn' | 'expired'
export type LenderCaseStatus = 'shared' | 'offered' | 'sanctioned' | 'disbursed' | 'declined' | 'withdrawn'

export interface CaseLender {
  id: string
  lender_id: string
  status: LenderCaseStatus
  shared_at: string
  lender_ref: string | null
  offer_amount: number | null
  offer_tenure_months: number | null
  offer_emi: number | null
  decline_reason: string | null
  disbursed_amount: number | null
  disbursed_on: string | null
  utr: string | null
  lender_name?: string
}

export interface CaseEvent { id: number; actor: string; actor_name: string | null; event: string; note: string | null; created_at: string; lender_id: string | null }

export interface FinanceCase {
  id: string
  case_no: string
  business_id: string
  patient_member_id: string | null
  patient_name: string
  patient_phone: string
  treatment: string
  treatment_category: string | null
  estimate_amount: number
  requested_amount: number
  planned_on: string | null
  admission_id: string | null
  planned_surgery_id: string | null
  bill_id: string | null
  started_by: 'hospital' | 'patient'
  status: CaseStatus
  hospital_confirmed_at: string | null
  hospital_confirmed_by: string | null
  admission_confirmed_at: string | null
  consent_at: string | null
  received_at: string | null
  closed_reason: string | null
  public_token: string
  created_at: string
  updated_at: string
  lenders: CaseLender[]
}

export interface LenderOption {
  business_id: string
  legal_name: string
  entity_type: 'bank' | 'nbfc'
  terms_summary: string | null
  min_amount: number
  max_amount: number | null
  tenures: string | null
  pays_to: 'hospital' | 'patient'
  grievance_email: string | null
  grievance_phone: string | null
  link_status: 'requested' | 'approved' | 'rejected' | null
  no_cost_emi: boolean
  agreement_done_on: string | null
}

export const MIN_EMI_AMOUNT = 10000

export const CASE_STATUS: Record<CaseStatus, string> = {
  requested: 'Patient asked — confirm',
  hospital_confirmed: 'Waiting for patient consent',
  shared: 'With lender',
  offered: 'Lender offered',
  sanctioned: 'Loan sanctioned',
  disbursed: 'Lender paid — confirm receipt',
  closed: 'Money received',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
}

export const LENDER_STATUS: Record<LenderCaseStatus, string> = {
  shared: 'Reviewing', offered: 'Offer made', sanctioned: 'Sanctioned', disbursed: 'Paid to hospital',
  declined: 'Declined', withdrawn: 'Withdrawn',
}

export const CASE_EVENT: Record<string, string> = {
  created: 'EMI offered by hospital', requested: 'Patient asked for EMI', confirmed: 'Hospital confirmed estimate',
  shared_with_lender: 'Patient consented, sent to lender', viewed: 'Lender opened the case',
  offered: 'Lender made an offer', sanctioned: 'Loan sanctioned', declined: 'Lender declined',
  disbursed: 'Lender paid the hospital', admission_confirmed: 'Hospital confirmed admission / date',
  money_received: 'Hospital confirmed money received', withdrawn: 'Withdrawn', expired: 'Expired',
}

/** Which list a case belongs in on the hospital's screen. */
export type CaseScope = 'action' | 'active' | 'done'
export function caseScope(c: FinanceCase): CaseScope {
  if (['closed', 'declined', 'withdrawn', 'expired'].includes(c.status)) return 'done'
  if (c.status === 'requested' || c.status === 'disbursed') return 'action'
  // A lender has it and the payout waits on the hospital confirming admission.
  if (['shared', 'offered', 'sanctioned'].includes(c.status) && !c.admission_confirmed_at) return 'action'
  return 'active'
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

// One request per page load, shared by every caller; hidden if it can't be read.
let enabledP: Promise<boolean> | null = null
export const financeEnabled = (): Promise<boolean> => {
  enabledP ??= Promise.resolve(supabase.rpc('sehat_finance_enabled')).then(({ data }) => data === true, () => false)
  return enabledP
}

export async function listCases(businessId: string): Promise<FinanceCase[]> {
  const { data, error } = await supabase.from('finance_cases')
    .select('*, lenders:finance_case_lenders(id, lender_id, status, shared_at, lender_ref, offer_amount, offer_tenure_months, offer_emi, decline_reason, disbursed_amount, disbursed_on, utr)')
    .eq('business_id', businessId).order('updated_at', { ascending: false }).limit(300)
  oops(error)
  const cases = (data ?? []) as FinanceCase[]
  const ids = [...new Set(cases.flatMap(c => (c.lenders ?? []).map(l => l.lender_id)))]
  if (ids.length) {
    const { data: names } = await supabase.from('lender_profiles').select('business_id, legal_name').in('business_id', ids)
    const byId = new Map((names ?? []).map((n: { business_id: string; legal_name: string }) => [n.business_id, n.legal_name]))
    for (const c of cases) for (const l of c.lenders ?? []) l.lender_name = byId.get(l.lender_id) ?? 'Lender'
  }
  return cases
}

export async function caseEvents(caseId: string): Promise<CaseEvent[]> {
  const { data, error } = await supabase.from('finance_case_events')
    .select('id, actor, actor_name, event, note, created_at, lender_id').eq('case_id', caseId).order('created_at')
  oops(error)
  return (data ?? []) as CaseEvent[]
}

export async function listLenders(businessId: string): Promise<LenderOption[]> {
  const [{ data: lp, error }, { data: links }] = await Promise.all([
    supabase.from('lender_profiles')
      .select('business_id, legal_name, entity_type, terms_summary, min_amount, max_amount, tenures, pays_to, grievance_email, grievance_phone')
      .eq('status', 'approved').order('legal_name'),
    supabase.from('lender_hospital_links').select('lender_id, status, no_cost_emi, agreement_done_on').eq('hospital_id', businessId),
  ])
  oops(error)
  const byLender = new Map((links ?? []).map((k: { lender_id: string; status: LenderOption['link_status']; no_cost_emi: boolean; agreement_done_on: string | null }) => [k.lender_id, k]))
  return ((lp ?? []) as Omit<LenderOption, 'link_status' | 'no_cost_emi' | 'agreement_done_on'>[]).map(l => {
    const k = byLender.get(l.business_id)
    return { ...l, link_status: k?.status ?? null, no_cost_emi: k?.no_cost_emi ?? false, agreement_done_on: k?.agreement_done_on ?? null }
  })
}

export async function setFinanceModule(businessId: string, on: boolean) {
  const { error } = await supabase.rpc('sehat_finance_module_set', { p_business: businessId, p_on: on })
  oops(error)
}

export interface NewCase {
  memberId?: string | null
  patientName?: string
  patientPhone?: string
  treatment: string
  category?: string
  estimate: number
  requested: number
  plannedOn?: string | null
  admissionId?: string | null
  surgeryId?: string | null
  billId?: string | null
}

export async function createCase(businessId: string, n: NewCase): Promise<FinanceCase> {
  const { data, error } = await supabase.rpc('sehat_finance_case_create', {
    p_business: businessId, p_member: n.memberId ?? null,
    p_patient_name: n.patientName ?? '', p_patient_phone: n.patientPhone ?? '',
    p_treatment: n.treatment, p_category: n.category ?? null,
    p_estimate: n.estimate, p_requested: n.requested, p_planned_on: n.plannedOn || null,
    p_admission: n.admissionId ?? null, p_surgery: n.surgeryId ?? null, p_bill: n.billId ?? null,
  })
  oops(error)
  return data as FinanceCase
}

export async function confirmCase(caseId: string, p: { treatment: string; estimate: number; requested: number; plannedOn?: string | null; memberId?: string | null }) {
  const { error } = await supabase.rpc('sehat_finance_case_confirm', {
    p_case: caseId, p_treatment: p.treatment, p_estimate: p.estimate, p_requested: p.requested,
    p_planned_on: p.plannedOn || null, p_member: p.memberId ?? null,
  })
  oops(error)
}

export async function confirmAdmission(caseId: string, plannedOn?: string | null, admissionId?: string | null) {
  const { error } = await supabase.rpc('sehat_finance_case_admission_confirm', {
    p_case: caseId, p_planned_on: plannedOn || null, p_admission: admissionId ?? null,
  })
  oops(error)
}

export async function markReceived(caseId: string, amount: number, receivedOn: string) {
  const { error } = await supabase.rpc('sehat_finance_case_received', { p_case: caseId, p_amount: amount, p_received_on: receivedOn })
  oops(error)
}

export async function withdrawCase(caseId: string, reason: string) {
  const { error } = await supabase.rpc('sehat_finance_case_withdraw', { p_case: caseId, p_token: null, p_reason: reason })
  oops(error)
}

// ── Where a case can start from ─────────────────────────────────────────────

export interface EmiSource {
  kind: 'admission' | 'surgery' | 'bill'
  id: string
  memberId: string
  patientName: string
  patientPhone: string | null
  treatment: string
  amount: number | null
  plannedOn: string | null
  admissionId: string | null
  label: string
}

/** Current admissions, planned surgeries in the next 60 days, and recent bills of ₹10,000+. */
export async function emiSources(businessId: string): Promise<EmiSource[]> {
  const since = new Date(Date.now() - 45 * 86400000).toISOString()
  const [adm, sur, bills] = await Promise.all([
    supabase.from('admission_detail')
      .select('id, patient_member_id, patient_name, patient_phone, reason, admitting_diagnosis, admitted_at, expected_discharge')
      .eq('business_id', businessId).eq('status', 'admitted').order('admitted_at', { ascending: false }).limit(100),
    supabase.rpc('sehat_upcoming_surgeries', { p_business: businessId, p_days: 60 }),
    supabase.from('patient_bills')
      .select('id, bill_no, patient_member_id, patient_name, patient_phone, net_payable, admission_id, created_at')
      .eq('business_id', businessId).eq('status', 'issued').gte('net_payable', MIN_EMI_AMOUNT)
      .gte('created_at', since).order('created_at', { ascending: false }).limit(50),
  ])
  const out: EmiSource[] = []
  for (const a of (adm.data ?? []) as { id: string; patient_member_id: string; patient_name: string; patient_phone: string | null; reason: string | null; admitting_diagnosis: string | null; admitted_at: string; expected_discharge: string | null }[]) {
    const what = a.reason || a.admitting_diagnosis || 'In-patient treatment'
    out.push({ kind: 'admission', id: a.id, memberId: a.patient_member_id, patientName: a.patient_name, patientPhone: a.patient_phone,
      treatment: what, amount: null, plannedOn: a.admitted_at.slice(0, 10), admissionId: a.id,
      label: `Admitted · ${a.patient_name} · ${what}` })
  }
  for (const s of (sur.data ?? []) as { id: string; patient_member_id: string; patient_name: string; procedure_name: string; planned_on: string }[]) {
    out.push({ kind: 'surgery', id: s.id, memberId: s.patient_member_id, patientName: s.patient_name, patientPhone: null,
      treatment: s.procedure_name, amount: null, plannedOn: s.planned_on, admissionId: null,
      label: `Surgery ${s.planned_on} · ${s.patient_name} · ${s.procedure_name}` })
  }
  for (const b of (bills.data ?? []) as { id: string; bill_no: string; patient_member_id: string; patient_name: string; patient_phone: string | null; net_payable: number; admission_id: string | null }[]) {
    out.push({ kind: 'bill', id: b.id, memberId: b.patient_member_id, patientName: b.patient_name, patientPhone: b.patient_phone,
      treatment: `Bill ${b.bill_no}`, amount: Number(b.net_payable), plannedOn: null, admissionId: b.admission_id,
      label: `Bill ${b.bill_no} · ${b.patient_name} · ₹${Number(b.net_payable).toLocaleString('en-IN')}` })
  }
  return out
}

// ── Patient, by link (no login) — /emi/<public_token> ───────────────────────

export const EMI_TOKEN_RE = /^[0-9a-f]{32}$/
/** Bump when the consent wording below changes; the version is stored with the consent. */
export const CONSENT_VERSION = 'emi-consent-v1'

export interface PublicLenderShared {
  lender_id: string; name: string; status: LenderCaseStatus; journey_url: string | null
  grievance_email: string | null; grievance_phone: string | null
  offer_amount: number | null; offer_tenure_months: number | null; offer_emi: number | null
}
export interface PublicLenderAvailable {
  lender_id: string; name: string; entity_type: 'bank' | 'nbfc'; terms: string | null; tenures: string | null
  pays_to: 'hospital' | 'patient'; no_cost_emi: boolean
}
export interface PublicCase {
  case_no: string; status: CaseStatus; treatment: string; estimate: number; requested: number; planned_on: string | null
  patient_name: string; hospital: string; hospital_address: string | null
  hospital_confirmed: boolean; consent_at: string | null; received: boolean
  lenders_shared: PublicLenderShared[]; lenders_available: PublicLenderAvailable[]
}

export async function getPublicCase(token: string): Promise<PublicCase | null> {
  const { data, error } = await supabase.rpc('sehat_finance_case_by_token', { p_token: token })
  oops(error)
  return (data ?? null) as PublicCase | null
}

export async function shareWithLenders(token: string, lenderIds: string[], channel: 'web' | 'whatsapp' | 'app' = 'web') {
  const { error } = await supabase.rpc('sehat_finance_case_share', {
    p_token: token, p_lenders: lenderIds, p_consent_version: CONSENT_VERSION, p_channel: channel,
  })
  oops(error)
}

export async function withdrawByToken(token: string, reason: string) {
  const { error } = await supabase.rpc('sehat_finance_case_withdraw', { p_case: null, p_token: token, p_reason: reason || null })
  oops(error)
}

/** The patient's link, and a WhatsApp message the hospital can send from its own phone. */
export const patientEmiUrl = (token: string) => `${window.location.origin}/emi/${token}`
export function patientEmiWhatsApp(c: Pick<FinanceCase, 'patient_name' | 'patient_phone' | 'treatment' | 'public_token'>, hospital: string) {
  const phone = c.patient_phone.replace(/\D/g, '').slice(-10)
  const text = `नमस्ते ${c.patient_name}, ${hospital} ने आपके इलाज (${c.treatment}) के लिए EMI का अनुरोध तैयार किया है। सहमति देने और बैंक/NBFC चुनने के लिए यह लिंक खोलें:\n\n`
    + `Hello ${c.patient_name}, ${hospital} has set up an EMI request for your treatment (${c.treatment}). Open this link to give consent and choose a lender:\n`
    + `${patientEmiUrl(c.public_token)}\n\nSehatsandhi is not a lender and charges you nothing.`
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
}
