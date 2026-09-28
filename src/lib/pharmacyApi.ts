import { supabase } from './supabase'

// In-house dispensing (0158): a small clinic's own medicine counter.
//
// Not the 'pharmacy' vertical — that is a chemist with its own listing. This is
// a module an admin switches on for a clinic: medicines, purchases in batches,
// stock, a numbered pharmacy bill with GST only when the clinic has a GSTIN for
// its dispensary, payments, returns and a day's summary.
//
// Every write is an RPC. Stock and the ledger behind it move together inside
// the database, so there is no insert here that could leave them apart.

export type PharmacyPayMethod = 'cash' | 'upi' | 'credit_card' | 'debit_card' | 'card' | 'netbanking' | 'cheque' | 'other'
// 0159: credit and debit apart. 'card' only exists on bills from before.
export const PAY_METHODS: [PharmacyPayMethod, string][] = [
  ['cash', 'Cash'], ['upi', 'UPI'], ['credit_card', 'Credit card'], ['debit_card', 'Debit card'],
  ['netbanking', 'Net banking'], ['cheque', 'Cheque'], ['other', 'Other'],
]
export const payMethodLabel = (m: string) =>
  m === 'card' ? 'Card' : PAY_METHODS.find(([v]) => v === m)?.[1] ?? m
export const GST_RATES = [0, 5, 12, 18, 28] as const

export type PaymentStatus = 'paid' | 'partly_paid' | 'unpaid' | 'cancelled'
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; cls: string }> = {
  paid: { label: 'Paid in full', cls: 'text-green-700 bg-green-50' },
  partly_paid: { label: 'Part paid', cls: 'text-amber-800 bg-amber-50' },
  unpaid: { label: 'Unpaid', cls: 'text-red-700 bg-red-50' },
  cancelled: { label: 'Cancelled', cls: 'text-gray-500 bg-gray-100' },
}

export interface PharmacyItem {
  id: string
  business_id: string
  name: string
  generic_name: string | null
  strength: string | null
  form: string | null
  unit: string
  pack_size: number
  hsn_code: string | null
  gst_rate: number
  reorder_level: number
  is_active: boolean
}

/** A medicine with what is on the shelf (view pharmacy_stock). */
export interface StockRow extends PharmacyItem {
  qty_available: number
  qty_expired: number
  next_expiry: string | null
  unit_mrp: number | null
  stock_value: number
}

export interface Batch {
  id: string
  item_id: string
  batch_no: string
  expiry_date: string
  qty_received: number
  qty_in_hand: number
  unit_cost: number
  unit_mrp: number
  created_at: string
}

export interface PharmacyBillItem {
  id: string
  item_id: string | null
  name: string
  batch_no: string | null
  expiry_date: string | null
  hsn_code: string | null
  quantity: number
  unit_mrp: number
  amount: number
  gst_rate: number
  taxable_value: number
  tax_amount: number
  returned_qty: number
}

export interface PharmacyBill {
  id: string
  business_id: string
  bill_no: string
  patient_member_id: string | null
  prescription_id: string | null
  customer_name: string
  customer_phone: string | null
  clinic_name: string | null
  clinic_address: string | null
  clinic_phone: string | null
  gstin: string | null
  drug_licence: string | null
  gst_applied: boolean
  subtotal: number
  discount_pct: number
  discount_amount: number
  discount_reason: string | null
  taxable_value: number
  cgst_amount: number
  sgst_amount: number
  round_off: number
  net_payable: number
  status: 'issued' | 'cancelled'
  cancelled_reason: string | null
  issued_at: string
  /** Whoever issued it — and so whoever gave any discount on it. */
  issued_by_name: string | null
  payment_status: PaymentStatus
  paid: number
  credited: number
  refunded: number
  balance_due: number
  items: PharmacyBillItem[]
  payments: { amount: number; method: PharmacyPayMethod; reference: string | null; received_at: string; received_by_name: string | null }[]
  returns: { kind: 'return' | 'cancel'; credit_amount: number; refund_amount: number; refund_method: string | null
             reason: string | null; created_at: string; items: { name: string; qty: number }[] }[]
}

export interface PurchaseLine {
  item_id: string
  batch_no: string
  expiry_date: string
  packs: number
  free_packs: number
  pack_cost: number
  pack_mrp: number
}

export interface Purchase {
  id: string
  supplier_name: string | null
  invoice_no: string | null
  invoice_date: string
  total_cost: number
  created_at: string
}

export interface RxForDispensing {
  prescription_id: string
  prescription_no: string
  issued_at: string
  prescriber_name: string
  items: { drug_name: string; strength: string | null; form: string | null; dosage: string | null
           duration: string | null; quantity: string | null }[]
  dispensed_bill_no: string | null
}

export interface PharmacySummary {
  bills: number
  cancelled: number
  sales: number
  discounts: number
  returns: number
  refunded: number
  collected: Partial<Record<PharmacyPayMethod, number>>
  gst: { rate: number; taxable: number; tax: number }[]
  purchases: number
  outstanding: number
}

export interface PharmacySettings {
  pharmacy_module: boolean
  pharmacy_gstin: string | null
  pharmacy_drug_licence: string | null
  gstin: string | null
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

// ── Settings ────────────────────────────────────────────────────────────────

export async function getPharmacySettings(businessId: string): Promise<PharmacySettings | null> {
  const { data, error } = await supabase.from('businesses')
    .select('pharmacy_module, pharmacy_gstin, pharmacy_drug_licence, gstin')
    .eq('id', businessId).maybeSingle()
  // A database without 0158 has no such columns: the module is simply off.
  if (error) return null
  return data as PharmacySettings | null
}

export async function savePharmacySettings(businessId: string, gstin: string, drugLicence: string) {
  const { error } = await supabase.rpc('sehat_pharmacy_settings', {
    p_business: businessId, p_gstin: gstin, p_drug_licence: drugLicence,
  })
  oops(error)
}

/** Sehatsandhi admin only. */
export async function adminSetPharmacy(businessId: string, on: boolean) {
  const { error } = await supabase.rpc('sehat_admin_set_pharmacy', { p_business: businessId, p_on: on })
  oops(error)
}

// ── Medicines and stock ─────────────────────────────────────────────────────

export async function getStock(businessId: string): Promise<StockRow[]> {
  const { data, error } = await supabase.from('pharmacy_stock').select('*')
    .eq('business_id', businessId).order('name')
  oops(error)
  return (data ?? []).map(r => ({
    ...r, unit_mrp: r.unit_mrp == null ? null : Number(r.unit_mrp), stock_value: Number(r.stock_value),
    gst_rate: Number(r.gst_rate),
  })) as StockRow[]
}

export async function saveItem(businessId: string, item: Partial<PharmacyItem>): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_pharmacy_save_item', { p_business: businessId, p_item: item })
  oops(error)
  return data as string
}

export async function getBatches(itemId: string): Promise<Batch[]> {
  const { data, error } = await supabase.from('pharmacy_batches').select('*')
    .eq('item_id', itemId).order('expiry_date')
  oops(error)
  return (data ?? []).map(b => ({ ...b, unit_cost: Number(b.unit_cost), unit_mrp: Number(b.unit_mrp) })) as Batch[]
}

export async function adjustStock(batchId: string, counted: number, reason: string) {
  const { error } = await supabase.rpc('sehat_pharmacy_adjust_stock', { p_batch: batchId, p_counted: counted, p_reason: reason })
  oops(error)
}

// ── Purchases ───────────────────────────────────────────────────────────────

export async function recordPurchase(
  businessId: string, supplier: string, invoiceNo: string, invoiceDate: string, lines: PurchaseLine[], notes = '',
): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_pharmacy_record_purchase', {
    p_business: businessId, p_supplier_name: supplier, p_invoice_no: invoiceNo,
    p_invoice_date: invoiceDate, p_lines: lines, p_notes: notes,
  })
  oops(error)
  return data as string
}

export async function getPurchases(businessId: string): Promise<Purchase[]> {
  const { data, error } = await supabase.from('pharmacy_purchases')
    .select('id, supplier_name, invoice_no, invoice_date, total_cost, created_at')
    .eq('business_id', businessId).order('invoice_date', { ascending: false }).limit(50)
  oops(error)
  return (data ?? []) as Purchase[]
}

export async function getSuppliers(businessId: string): Promise<string[]> {
  const { data, error } = await supabase.from('pharmacy_suppliers').select('name')
    .eq('business_id', businessId).order('name')
  oops(error)
  return (data ?? []).map(s => s.name as string)
}

// ── Bills ───────────────────────────────────────────────────────────────────

export interface NewPharmacyBill {
  lines: { item_id: string; qty: number }[]
  patientMemberId?: string | null
  customerName?: string
  customerPhone?: string
  prescriptionId?: string | null
  discountPct?: number
  discountReason?: string
  /** Nothing, or 0, leaves the whole bill on credit. */
  payment?: { amount: number; method: PharmacyPayMethod; reference?: string } | null
}

export async function issueBill(businessId: string, b: NewPharmacyBill): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_pharmacy_issue_bill', {
    p_business: businessId,
    p_lines: b.lines,
    p_patient_member_id: b.patientMemberId ?? null,
    p_customer_name: b.customerName ?? null,
    p_customer_phone: b.customerPhone ?? null,
    p_prescription_id: b.prescriptionId ?? null,
    p_discount_pct: b.discountPct ?? 0,
    p_discount_reason: b.discountReason ?? null,
    p_payment: b.payment && b.payment.amount > 0 ? b.payment : null,
  })
  oops(error)
  return data as string
}

const toBill = (r: Record<string, unknown>): PharmacyBill => {
  const n = (k: string) => Number(r[k] ?? 0)
  return {
    ...(r as unknown as PharmacyBill),
    subtotal: n('subtotal'), discount_pct: n('discount_pct'), discount_amount: n('discount_amount'),
    taxable_value: n('taxable_value'), cgst_amount: n('cgst_amount'), sgst_amount: n('sgst_amount'),
    round_off: n('round_off'), net_payable: n('net_payable'), paid: n('paid'), credited: n('credited'),
    refunded: n('refunded'), balance_due: n('balance_due'),
  }
}

export async function getBills(
  businessId: string, opts: { from?: string; to?: string; dueOnly?: boolean; memberId?: string } = {},
): Promise<PharmacyBill[]> {
  let q = supabase.from('pharmacy_bill_detail').select('*').eq('business_id', businessId)
  if (opts.from) q = q.gte('issued_at', opts.from)
  if (opts.to) q = q.lt('issued_at', opts.to)
  if (opts.dueOnly) q = q.gt('balance_due', 0).eq('status', 'issued')
  if (opts.memberId) q = q.eq('patient_member_id', opts.memberId)
  const { data, error } = await q.order('issued_at', { ascending: false }).limit(200)
  oops(error)
  return (data ?? []).map(toBill)
}

export async function getBill(billId: string): Promise<PharmacyBill | null> {
  const { data, error } = await supabase.from('pharmacy_bill_detail').select('*').eq('id', billId).maybeSingle()
  oops(error)
  return data ? toBill(data) : null
}

export async function recordPayment(billId: string, amount: number, method: PharmacyPayMethod, reference = '') {
  const { error } = await supabase.rpc('sehat_pharmacy_record_payment', {
    p_bill: billId, p_amount: amount, p_method: method, p_reference: reference,
  })
  oops(error)
}

export async function returnItems(
  billId: string, lines: { bill_item_id: string; qty: number }[], refundMethod: PharmacyPayMethod, reason: string,
): Promise<{ credit: number; refund: number }> {
  const { data, error } = await supabase.rpc('sehat_pharmacy_return', {
    p_bill: billId, p_lines: lines, p_refund_method: refundMethod, p_reason: reason,
  })
  oops(error)
  return data as { credit: number; refund: number }
}

export async function cancelBill(billId: string, reason: string, refundMethod: PharmacyPayMethod): Promise<{ refund: number }> {
  const { data, error } = await supabase.rpc('sehat_pharmacy_cancel_bill', {
    p_bill: billId, p_reason: reason, p_refund_method: refundMethod,
  })
  oops(error)
  return data as { refund: number }
}

/** One row per patient (or walk-in) who owes the counter money. */
export interface Due {
  patient_member_id: string | null
  customer_name: string
  customer_phone: string | null
  total_due: number
  bills: number
  oldest_bill_at: string
  last_paid_at: string | null
  bill_ids: string[]
}

export async function getDues(businessId: string): Promise<Due[]> {
  const { data, error } = await supabase.rpc('sehat_pharmacy_dues', { p_business: businessId })
  oops(error)
  return (data ?? []).map((d: Due) => ({ ...d, total_due: Number(d.total_due) }))
}

export async function getBillsByIds(ids: string[]): Promise<PharmacyBill[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('pharmacy_bill_detail').select('*').in('id', ids).order('issued_at')
  oops(error)
  return (data ?? []).map(toBill)
}

export interface StockMove {
  id: string
  kind: 'purchase' | 'sale' | 'return' | 'cancel' | 'adjust'
  qty: number
  reason: string | null
  created_at: string
  batch: { batch_no: string } | null
  bill: { bill_no: string; customer_name: string } | null
  purchase: { supplier_name: string | null; invoice_no: string | null } | null
}

/** Every movement of one medicine, newest first — to reconcile a count against. */
export async function getStockMoves(itemId: string): Promise<StockMove[]> {
  const { data, error } = await supabase.from('pharmacy_stock_moves')
    .select('id, kind, qty, reason, created_at, batch:pharmacy_batches(batch_no), bill:pharmacy_bills(bill_no, customer_name), purchase:pharmacy_purchases(supplier_name, invoice_no)')
    .eq('item_id', itemId).order('created_at', { ascending: false }).limit(100)
  oops(error)
  return (data ?? []) as unknown as StockMove[]
}

export async function getPrescriptionsForDispensing(businessId: string, memberId: string): Promise<RxForDispensing[]> {
  const { data, error } = await supabase.rpc('sehat_pharmacy_prescriptions', { p_business: businessId, p_member: memberId })
  oops(error)
  return (data ?? []) as RxForDispensing[]
}

export async function getSummary(businessId: string, from: string, to: string): Promise<PharmacySummary> {
  const { data, error } = await supabase.rpc('sehat_pharmacy_summary', { p_business: businessId, p_from: from, p_to: to })
  oops(error)
  return data as PharmacySummary
}

/** "Paracetamol 500mg tablet" — how a medicine is named on screen and on the bill. */
export const itemLabel = (i: Pick<PharmacyItem, 'name' | 'strength' | 'form'>) =>
  [i.name, i.strength, i.form].filter(Boolean).join(' ')

/**
 * The clinic's medicine that best matches a prescription line, by name.
 * A prescription is free text ("Tab. Dolo 650"), so this is a suggestion the
 * counter confirms, never a silent substitution.
 */
export function matchItem(stock: StockRow[], drugName: string, strength?: string | null): StockRow | null {
  const clean = (s: string) => s.toLowerCase().replace(/^(tab|cap|syp|inj|oint|drop)s?\.?\s+/, '').replace(/[^a-z0-9]/g, '')
  const want = clean(drugName)
  if (!want) return null
  const active = stock.filter(s => s.is_active)
  const byName = active.filter(s => clean(s.name) === want || clean(s.name).startsWith(want) || want.startsWith(clean(s.name)))
  const pool = byName.length ? byName : active.filter(s => s.generic_name && clean(s.generic_name) === want)
  if (!pool.length) return null
  const st = (strength ?? '').toLowerCase().replace(/\s/g, '')
  return pool.find(s => st && (s.strength ?? '').toLowerCase().replace(/\s/g, '') === st)
    ?? pool.find(s => s.qty_available > 0) ?? pool[0]
}
