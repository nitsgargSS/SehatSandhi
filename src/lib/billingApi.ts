import { supabase } from './supabase'
import { activeConfig } from './env'

// What a patient was charged and what they have paid.
//
// Nothing here touches `invoices` or `payments`. Those bill a BUSINESS for its
// Sehatsandhi listing, under our GSTIN, on our numbering series — our revenue.
// This is a clinic charging a patient: different payer, different payee, money
// that is never ours. Keeping the two apart is the whole reason this file
// exists rather than extending invoiceApi.
//
// Amounts are numbers with paise, unlike the whole-rupee integers used for
// listing prices. A strip of tablets is ₹12.50 and a bill that cannot hold that
// is wrong by rounding on every line.

export type ChargeCategory =
  | 'consultation' | 'bed' | 'procedure' | 'medicine' | 'lab' | 'consumable' | 'other'

export type PaymentMethod =
  | 'cash' | 'upi' | 'card' | 'netbanking' | 'cheque' | 'insurance' | 'other'

export interface Charge {
  id: string
  business_id: string
  patient_member_id: string
  visit_id: string | null
  admission_id: string | null
  category: ChargeCategory
  description: string
  quantity: number
  unit_price: number
  amount: number
  charged_on: string
  notes: string | null
  /** Set once this line was copied onto a bill. Non-null means frozen. */
  bill_id: string | null
}

export interface Payment {
  id: string
  business_id: string
  patient_member_id: string
  admission_id: string | null
  amount: number
  method: PaymentMethod
  reference: string | null
  received_on: string
  notes: string | null
  bill_id: string | null
}

export interface Account {
  business_id: string
  patient_member_id: string
  patient_name: string
  charged: number
  paid: number
  /** Positive means the patient owes; negative is an unused advance. */
  balance: number
  last_charged: string | null
  last_paid: string | null
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export async function getCharges(memberId: string, businessId: string): Promise<Charge[]> {
  const { data, error } = await supabase.from('patient_charges').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('charged_on', { ascending: false }).order('created_at', { ascending: false })
  oops(error)
  return (data ?? []) as Charge[]
}

export async function getPayments(memberId: string, businessId: string): Promise<Payment[]> {
  const { data, error } = await supabase.from('patient_payments').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('received_on', { ascending: false }).order('created_at', { ascending: false })
  oops(error)
  return (data ?? []) as Payment[]
}

export async function getAccount(memberId: string, businessId: string): Promise<Account | null> {
  const { data, error } = await supabase.from('patient_account').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId).maybeSingle()
  oops(error)
  return (data as Account) ?? null
}

export interface NewCharge {
  category: ChargeCategory
  description: string
  quantity?: number
  unitPrice?: number
  /** Omit to take quantity × unitPrice; pass it to record a discounted line. */
  amount?: number
  visitId?: string | null
  admissionId?: string | null
  notes?: string
}

export async function addCharge(
  memberId: string, businessId: string, c: NewCharge, recordedBy?: string | null,
) {
  const qty = c.quantity ?? 1
  const unit = c.unitPrice ?? 0
  const { error } = await supabase.from('patient_charges').insert({
    business_id: businessId,
    patient_member_id: memberId,
    visit_id: c.visitId ?? null,
    admission_id: c.admissionId ?? null,
    category: c.category,
    description: c.description,
    quantity: qty,
    unit_price: unit,
    // Rounded to paise here rather than left to float drift: 3 × 12.10 must be
    // 36.30 on the bill and in the total, not 36.299999999999997.
    amount: c.amount ?? Math.round(qty * unit * 100) / 100,
    notes: c.notes || null,
    recorded_by: recordedBy ?? null,
  })
  oops(error)
}

export async function removeCharge(id: string) {
  const { error } = await supabase.from('patient_charges').delete().eq('id', id)
  oops(error)
}

export async function addPayment(
  memberId: string, businessId: string,
  p: { amount: number; method: PaymentMethod; reference?: string; admissionId?: string | null; notes?: string },
  recordedBy?: string | null,
) {
  if (!(p.amount > 0)) throw new Error('A payment has to be more than zero.')
  const { error } = await supabase.from('patient_payments').insert({
    business_id: businessId,
    patient_member_id: memberId,
    admission_id: p.admissionId ?? null,
    amount: p.amount,
    method: p.method,
    reference: p.reference || null,
    notes: p.notes || null,
    recorded_by: recordedBy ?? null,
  })
  oops(error)
}

export async function removePayment(id: string) {
  const { error } = await supabase.from('patient_payments').delete().eq('id', id)
  oops(error)
}

/**
 * Work out the bed charge for a stay and post it.
 *
 * Idempotent server-side: it deletes the bed line it previously wrote before
 * writing a new one, so calling it again after a bed move or a late discharge
 * corrects the bill rather than doubling it. Returns 0 when the bed has no
 * daily rate, which is not an error — plenty of clinics do not charge by bed.
 */
export async function postBedCharges(admissionId: string): Promise<number> {
  const { data, error } = await supabase.rpc('sehat_post_bed_charges', {
    p_admission_id: admissionId,
  })
  oops(error)
  return Number(data ?? 0)
}

/** Everyone who owes this clinic money. The end-of-day list. */
export async function getOutstanding(businessId: string): Promise<Account[]> {
  const { data, error } = await supabase.from('business_outstanding').select('*')
    .eq('business_id', businessId).order('balance', { ascending: false })
  oops(error)
  return (data ?? []) as Account[]
}

// ── Bills ───────────────────────────────────────────────────────────────────
//
// The charges above are a ledger; a bill is a document. It is numbered, its
// lines are copied rather than read live, and it cannot be edited once issued —
// because it leaves the building, and an insurer will hold a printed copy of it
// for months.
//
// Issuing stamps every charge it took with the bill id, which freezes them: a
// mistyped line stays deletable right up to the moment it is printed on
// something somebody filed, and not after.

export type BillType = 'opd' | 'ipd' | 'account'
export type BillStatus = 'issued' | 'cancelled' | 'superseded'

export interface BillItem {
  category: string
  description: string
  quantity: number
  unit_price: number
  amount: number
  charged_on: string | null
}

export interface Bill {
  id: string
  bill_no: string
  business_id: string
  patient_member_id: string
  admission_id: string | null
  visit_id: string | null
  bill_type: BillType

  patient_name: string
  patient_age: number | null
  patient_gender: string | null
  mrn: string | null
  clinic_name: string | null
  clinic_address: string | null
  clinic_phone: string | null
  clinic_gstin: string | null
  admission_no: string | null
  admitted_at: string | null
  discharged_at: string | null

  subtotal: number
  discount_amount: number
  discount_reason: string | null
  round_off: number
  net_payable: number
  /** Live, not snapshotted — a patient settling next week should see it move. */
  paid: number
  balance_due: number

  issued_at: string
  status: BillStatus
  supersedes: string | null
  superseded_by: string | null
  public_token: string
  sent_at: string | null

  items: BillItem[]
}

/** Every bill for one patient at this clinic, newest first. */
export async function getBills(memberId: string, businessId: string): Promise<Bill[]> {
  const { data, error } = await supabase.from('patient_bill_detail').select('*')
    .eq('patient_member_id', memberId).eq('business_id', businessId)
    .order('issued_at', { ascending: false })
  oops(error)
  return (data ?? []) as Bill[]
}

export async function getBillsForAdmission(admissionId: string): Promise<Bill[]> {
  const { data, error } = await supabase.from('patient_bill_detail').select('*')
    .eq('admission_id', admissionId).order('issued_at', { ascending: false })
  oops(error)
  return (data ?? []) as Bill[]
}

export interface IssueBillInput {
  patientMemberId: string
  businessId: string
  /** Set for an IPD final bill. Scopes the bill to that stay's charges. */
  admissionId?: string | null
  /** Set for a single OPD visit. Omit both to settle everything unbilled. */
  visitId?: string | null
  discount?: number
  discountReason?: string
  /** Charges land on paise, bills settle in rupees. */
  roundOff?: number
  issuedBy?: string | null
  /** Correcting an issued bill: it is superseded and its lines released. */
  supersedes?: string | null
}

export async function issueBill(i: IssueBillInput): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_issue_patient_bill', {
    p_patient_member_id: i.patientMemberId,
    p_business_id: i.businessId,
    p_admission_id: i.admissionId ?? null,
    p_visit_id: i.visitId ?? null,
    p_discount: i.discount ?? 0,
    p_discount_reason: i.discountReason || null,
    p_round_off: i.roundOff ?? 0,
    p_issued_by: i.issuedBy ?? null,
    p_supersedes: i.supersedes ?? null,
  })
  // The everyday refusal: someone pressed Bill twice, or is billing a stay
  // whose charges are already on a bill.
  if (error) {
    throw new Error(error.message.includes('no unbilled charges')
      ? 'Everything here is already on a bill. Add charges, or correct the existing bill.'
      : error.message)
  }
  return data as string
}

/**
 * Cancel a bill and release its charges so they can be billed again.
 *
 * Goes through the RPC rather than a status update: cancelling is two things,
 * and a bill marked cancelled whose charges stayed frozen would be unbillable
 * forever with nothing on screen to say why.
 */
export async function cancelBill(billId: string, reason: string) {
  const { error } = await supabase.rpc('sehat_cancel_patient_bill', {
    p_bill_id: billId,
    p_reason: reason,
  })
  oops(error)
}

/** What the clinic has actually asked for in writing and not been paid. */
export async function getBillsOutstanding(businessId: string): Promise<Bill[]> {
  const { data, error } = await supabase.from('business_bills_outstanding').select('*')
    .eq('business_id', businessId).order('issued_at', { ascending: false })
  oops(error)
  return (data ?? []) as Bill[]
}

/** What the patient sees at /bill/:token. No ids, no phone number. */
export interface PublicBill {
  bill_no: string
  bill_type: BillType
  issued_at: string
  status: BillStatus
  patient_name: string
  patient_age: number | null
  patient_gender: string | null
  mrn: string | null
  clinic_name: string | null
  clinic_address: string | null
  clinic_phone: string | null
  clinic_gstin: string | null
  admission_no: string | null
  admitted_at: string | null
  discharged_at: string | null
  subtotal: number
  discount_amount: number
  discount_reason: string | null
  round_off: number
  net_payable: number
  paid: number
  balance_due: number
  items: BillItem[]
  payments: { amount: number; method: string; received_on: string }[]
}

/**
 * Send the bill to the patient.
 *
 * The doctor's own session token, so the function reads the bill through it and
 * lets RLS decide whether this clinic may send it.
 */
export async function sendBill(billId: string, email?: string) {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured for sending.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again to send this.')
  const res = await fetch(`${url}/functions/v1/bill-send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: anon,
    },
    body: JSON.stringify({ billId, email }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.ok) {
    throw new Error(body.message ?? body.error
      ?? 'Could not send it. The patient can still be given the printed copy.')
  }
  return body as { whatsapp: boolean; email: boolean }
}

/** The patient's own copy, by token. No login — the token is the authorisation. */
export async function fetchPublicBill(token: string): Promise<PublicBill> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Not configured.')
  const res = await fetch(`${url}/functions/v1/bill-view?token=${encodeURIComponent(token)}`, {
    headers: { Authorization: `Bearer ${anon}`, apikey: anon },
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 410) throw new Error(body.message ?? 'This bill link has expired.')
  if (!res.ok) throw new Error('That bill could not be found.')
  return body.bill as PublicBill
}
