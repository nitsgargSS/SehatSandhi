import { supabase } from './supabase'
import { activeConfig } from './env'

// The lab (0168): tests, packages, orders, results, signed reports.
//
// For businesses registered as a Diagnostic Lab, and clinics or hospitals an
// admin switches the in-house lab on for. Every write is an RPC, so the order,
// its charges and its numbering move together inside the database.

export type LabCategory = 'pathology' | 'radiology' | 'cardiology' | 'other'
export type ParamKind = 'number' | 'text' | 'select' | 'long_text'
export type OrderStatus = 'ordered' | 'collected' | 'in_progress' | 'ready' | 'reported' | 'cancelled'

export interface LabParameter {
  id?: string
  name: string
  unit?: string | null
  kind: ParamKind
  options?: string[] | null
  ref_low?: number | null
  ref_high?: number | null
  ref_low_f?: number | null
  ref_high_f?: number | null
  ref_text?: string | null
}

export interface LabTest {
  id: string
  business_id: string
  catalogue_code: string | null
  name: string
  category: LabCategory
  department: string | null
  sample_type: string | null
  report_kind: 'parameters' | 'narrative'
  price: number
  tat_hours: number | null
  is_active: boolean
  parameters?: LabParameter[]
}

export interface LabPackage {
  id: string
  name: string
  description: string | null
  price: number
  is_active: boolean
  test_ids: string[]
}

export interface LabOrderItem {
  id: string
  name: string
  package_name: string | null
  status: 'pending' | 'entered' | 'approved'
  report_kind: 'parameters' | 'narrative'
  test_id: string | null
  category: LabCategory | null
}

export interface LabReportRef {
  id: string
  report_no: string
  version: number
  token: string
  approved_by_name: string | null
  approved_at: string
  sent_at: string | null
  sent_channels: string[]
  send_error: string | null
}

export interface LabOrder {
  id: string
  business_id: string
  order_no: string
  patient_member_id: string
  patient_name: string
  patient_age: number | null
  patient_gender: string | null
  patient_phone: string | null
  mrn: string | null
  visit_id: string | null
  source: 'desk' | 'doctor'
  ordered_by_name: string | null
  referred_by: string | null
  collection: 'lab' | 'home'
  collection_address: string | null
  collection_slot: string | null
  collector_id: string | null
  collector_name: string | null
  home_fee: number
  priority: 'routine' | 'urgent'
  notes: string | null
  status: OrderStatus
  collected_at: string | null
  collected_by_name: string | null
  cancelled_reason: string | null
  created_by_name: string | null
  created_at: string
  item_count: number
  pending_count: number
  entered_count: number
  items: LabOrderItem[]
  latest_report: LabReportRef | null
}

export interface LabResult {
  parameter_id: string | null
  name: string
  unit: string | null
  kind: ParamKind
  value_num: number | null
  value_text: string | null
  ref_low: number | null
  ref_high: number | null
  ref_text: string | null
  flag: 'L' | 'H' | 'N' | null
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  ordered: 'To collect', collected: 'Sample collected', in_progress: 'Results in progress',
  ready: 'Ready to approve', reported: 'Reported', cancelled: 'Cancelled',
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

// ── Settings & catalogue ────────────────────────────────────────────────────

export async function getLabSettings(businessId: string): Promise<{ on: boolean; homeFee: number }> {
  const [{ data: on }, { data: b }] = await Promise.all([
    supabase.rpc('sehat_lab_on', { p_business: businessId }),
    supabase.from('businesses').select('lab_home_fee').eq('id', businessId).maybeSingle(),
  ])
  return { on: Boolean(on), homeFee: Number((b as { lab_home_fee?: number } | null)?.lab_home_fee ?? 0) }
}

export async function saveLabSettings(businessId: string, homeFee: number) {
  const { error } = await supabase.rpc('sehat_lab_settings', { p_business: businessId, p_home_fee: homeFee })
  oops(error)
}

export async function adminSetLab(businessId: string, on: boolean) {
  const { error } = await supabase.rpc('sehat_admin_set_lab', { p_business: businessId, p_on: on })
  oops(error)
}

export async function importCatalogue(businessId: string, codes: string[] | null = null): Promise<number> {
  const { data, error } = await supabase.rpc('sehat_lab_import_catalogue', { p_business: businessId, p_codes: codes })
  oops(error)
  return Number(data ?? 0)
}

export async function getTests(businessId: string, withParams = false): Promise<LabTest[]> {
  const { data, error } = await supabase.from('lab_tests')
    .select(withParams ? '*, parameters:lab_test_parameters(*)' : '*')
    .eq('business_id', businessId).order('category').order('name')
  oops(error)
  return ((data ?? []) as unknown as LabTest[]).map(t => ({
    ...t, price: Number(t.price),
    parameters: t.parameters ? [...t.parameters].sort((a, b) => ((a as { sort_order?: number }).sort_order ?? 0) - ((b as { sort_order?: number }).sort_order ?? 0)) : undefined,
  }))
}

export async function getTestParameters(testId: string): Promise<(LabParameter & { id: string })[]> {
  const { data, error } = await supabase.from('lab_test_parameters').select('*').eq('test_id', testId).order('sort_order')
  oops(error)
  return (data ?? []) as (LabParameter & { id: string })[]
}

export async function saveTest(businessId: string, test: Partial<LabTest>, params: LabParameter[] | null): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_lab_save_test', { p_business: businessId, p_test: test, p_params: params })
  oops(error)
  return data as string
}

export async function getPackages(businessId: string): Promise<LabPackage[]> {
  const { data, error } = await supabase.from('lab_packages')
    .select('id, name, description, price, is_active, lab_package_tests(test_id)')
    .eq('business_id', businessId).order('name')
  oops(error)
  return (data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string, name: p.name as string, description: (p.description as string) ?? null,
    price: Number(p.price), is_active: Boolean(p.is_active),
    test_ids: ((p.lab_package_tests as { test_id: string }[]) ?? []).map(x => x.test_id),
  }))
}

export async function savePackage(businessId: string, pkg: Partial<LabPackage>, testIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_lab_save_package', {
    p_business: businessId,
    p_package: { id: pkg.id, name: pkg.name, description: pkg.description, price: pkg.price, is_active: pkg.is_active },
    p_test_ids: testIds,
  })
  oops(error)
  return data as string
}

// ── Orders ──────────────────────────────────────────────────────────────────

export interface NewLabOrder {
  memberId: string
  testIds: string[]
  packageIds: string[]
  visitId?: string | null
  collection?: 'lab' | 'home'
  address?: string
  slot?: string | null
  homeFee?: number | null
  priority?: 'routine' | 'urgent'
  notes?: string
  referredBy?: string
}

export async function createOrder(businessId: string, o: NewLabOrder): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_lab_create_order', {
    p_business: businessId, p_member: o.memberId, p_test_ids: o.testIds, p_package_ids: o.packageIds,
    p_visit_id: o.visitId ?? null, p_collection: o.collection ?? 'lab', p_address: o.address ?? null,
    p_priority: o.priority ?? 'routine', p_notes: o.notes ?? null, p_referred_by: o.referredBy ?? null,
    p_slot: o.slot || null, p_home_fee: o.homeFee ?? null,
  })
  oops(error)
  return data as string
}

const toOrder = (r: Record<string, unknown>) => ({ ...(r as unknown as LabOrder), home_fee: Number(r.home_fee ?? 0) })

export async function getOrders(businessId: string, opts: { memberId?: string; statuses?: OrderStatus[]; since?: string } = {}): Promise<LabOrder[]> {
  let q = supabase.from('lab_order_detail').select('*').eq('business_id', businessId)
  if (opts.memberId) q = q.eq('patient_member_id', opts.memberId)
  if (opts.statuses?.length) q = q.in('status', opts.statuses)
  if (opts.since) q = q.gte('created_at', opts.since)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(300)
  oops(error)
  return (data ?? []).map(toOrder)
}

export async function getOrder(orderId: string): Promise<LabOrder | null> {
  const { data, error } = await supabase.from('lab_order_detail').select('*').eq('id', orderId).maybeSingle()
  oops(error)
  return data ? toOrder(data) : null
}

export async function markCollected(orderId: string) {
  const { error } = await supabase.rpc('sehat_lab_mark_collected', { p_order: orderId })
  oops(error)
}

export async function assignCollector(orderId: string, collectorId: string | null, slot: string | null) {
  const { error } = await supabase.rpc('sehat_lab_assign_collector', { p_order: orderId, p_collector: collectorId, p_slot: slot || null })
  oops(error)
}

export async function cancelOrder(orderId: string, reason: string) {
  const { error } = await supabase.rpc('sehat_lab_cancel_order', { p_order: orderId, p_reason: reason })
  oops(error)
}

// ── Results & reports ───────────────────────────────────────────────────────

export async function getResults(itemId: string): Promise<LabResult[]> {
  const { data, error } = await supabase.from('lab_results').select('*').eq('order_item_id', itemId).order('sort_order')
  oops(error)
  return (data ?? []).map(r => ({ ...r, value_num: r.value_num == null ? null : Number(r.value_num) })) as LabResult[]
}

/** The same parameter's last approved values for this patient, newest first — to compare against. */
export async function getPreviousValues(memberId: string, testId: string, beforeOrderId: string): Promise<Record<string, string>> {
  const { data: orders } = await supabase.from('lab_orders').select('id, created_at')
    .eq('patient_member_id', memberId).neq('id', beforeOrderId).neq('status', 'cancelled')
    .order('created_at', { ascending: false }).limit(20)
  const ids = (orders ?? []).map(o => o.id as string)
  if (!ids.length) return {}
  const { data: items } = await supabase.from('lab_order_items').select('id, order_id')
    .in('order_id', ids).eq('test_id', testId).eq('status', 'approved')
  // Newest order first: `ids` is already in that order.
  const latest = ids.map(id => (items ?? []).find(i => i.order_id === id)).find(Boolean)
  if (!latest) return {}
  const { data: res } = await supabase.from('lab_results').select('parameter_id, value_num, value_text').eq('order_item_id', latest.id)
  const out: Record<string, string> = {}
  for (const r of res ?? []) if (r.parameter_id) out[r.parameter_id] = r.value_text ?? (r.value_num != null ? String(r.value_num) : '')
  return out
}

export async function saveResults(itemId: string, values: { parameter_id: string; value: string }[]) {
  const { error } = await supabase.rpc('sehat_lab_save_results', { p_item: itemId, p_values: values })
  oops(error)
}

export async function approveOrder(orderId: string): Promise<{ report_id: string; token: string; version: number }> {
  const { data, error } = await supabase.rpc('sehat_lab_approve', { p_order: orderId })
  oops(error)
  return data as { report_id: string; token: string; version: number }
}

/** WhatsApp link (and email when given) — the same path prescriptions use. */
export async function sendReport(reportId: string, email?: string): Promise<{ whatsapp: boolean; email: boolean; errors?: string[] }> {
  const { url, anon } = activeConfig()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again to send this.')
  const res = await fetch(`${url}/functions/v1/lab-report-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: anon },
    body: JSON.stringify({ reportId, email }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'Could not send the report.')
  return body
}

export async function getPublicReport(token: string) {
  const { data, error } = await supabase.rpc('sehat_lab_report_public', { p_token: token })
  if (error) throw new Error(error.message)
  return data as PublicReport
}

export interface PublicReport {
  error?: 'not_found' | 'expired'
  report_no: string
  version: number
  approved_at: string
  approved_by_name: string | null
  approved_by_qualification: string | null
  lab: { name: string; address: string | null; phone: string | null; letterhead_url: string | null; reg_number: string | null }
  patient: { name: string; age: number | null; gender: string | null }
  order: { order_no: string; created_at: string; collected_at: string | null; referred_by: string | null }
  items: { name: string; department: string | null; report_kind: 'parameters' | 'narrative'
           results: { name: string; unit: string | null; kind: ParamKind; value: string | null; flag: 'L' | 'H' | 'N' | null
                      ref_low: number | null; ref_high: number | null; ref_text: string | null }[] }[]
}

/** "13 – 17 g/dL", or the lab's own wording where it gave one. */
export function rangeText(r: { ref_low: number | null; ref_high: number | null; ref_text: string | null; unit?: string | null }): string {
  if (r.ref_text && r.ref_low == null && r.ref_high == null) return r.ref_text
  const u = r.unit ? ` ${r.unit}` : ''
  if (r.ref_low != null && r.ref_high != null) return `${r.ref_low} – ${r.ref_high}${u}`
  if (r.ref_low != null) return `≥ ${r.ref_low}${u}`
  if (r.ref_high != null) return `≤ ${r.ref_high}${u}`
  return r.ref_text ?? ''
}
