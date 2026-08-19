import { supabase } from './supabase'

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
