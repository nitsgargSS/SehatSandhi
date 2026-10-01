import { supabase } from './supabase'

// 0189: medicine orders — a patient asks on WhatsApp, a pharmacy listed in
// that PIN accepts and prices it, the patient approves on their order link,
// the pharmacy packs and delivers. Shared by the website and the app.
//
// What a pharmacy sees grows with the order (the database decides, not this):
// offered → area and medicines; accepted → prescription and first name;
// approved → full name, phone and address.

export type OrderStatus = 'open' | 'accepted' | 'quoted' | 'confirmed' | 'packed'
  | 'out_for_delivery' | 'delivered' | 'cancelled' | 'expired' | 'no_pharmacy'

export interface OrderEvent { event: string; by: string | null; note: string | null; at: string }

export interface MedicineOrder {
  id: string
  code: string
  status: OrderStatus
  pin_code: string
  medicines: string | null
  has_prescription: boolean
  prescription_url: string | null
  patient_first_name: string | null
  patient_name: string | null
  patient_phone: string | null
  address: string | null
  created_at: string
  accepted_at: string | null
  accepted_by_name: string | null
  quote_amount: number | null
  delivery_fee: number | null
  total: number | null
  quote_note: string | null
  quoted_at: string | null
  quoted_by_name: string | null
  rx_checked: boolean
  confirmed_at: string | null
  packed_at: string | null
  packed_by_name: string | null
  delivery_practitioner_id: string | null
  delivery_name: string | null
  out_at: string | null
  delivered_at: string | null
  delivered_by_name: string | null
  collected_amount: number | null
  collected_mode: string | null
  ended_reason: string | null
  rating: number | null
  review: string | null
  patient_paid: number | null
  mine: boolean
  events: OrderEvent[] | null
}

export type OrderScope = 'new' | 'active' | 'done'
export type PayMode = 'cash' | 'upi' | 'card' | 'other'

export const ORDER_STATUS: Record<OrderStatus, string> = {
  open: 'New', accepted: 'To price', quoted: 'Waiting for patient', confirmed: 'Approved — pack it',
  packed: 'Packed', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  cancelled: 'Cancelled', expired: 'Expired', no_pharmacy: 'No pharmacy',
}

export const EVENT_WORD: Record<string, string> = {
  created: 'Order placed', accepted: 'Accepted', declined: 'Declined', quoted: 'Priced',
  dropped: 'Given up', released: 'Released (not priced in time)', patient_confirmed: 'Patient approved',
  patient_refused: 'Patient refused the price', patient_cancelled: 'Patient cancelled',
  packed: 'Packed', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  patient_rated: 'Patient rated', amount_mismatch: 'Amounts differ', expired: 'Expired',
}

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const listOrders = (businessId: string, scope: OrderScope) =>
  rpc<MedicineOrder[]>('sehat_mo_list', { p_business: businessId, p_scope: scope }).then(r => r ?? [])

export const getOrder = (businessId: string, orderId: string) =>
  rpc<MedicineOrder>('sehat_mo_get', { p_business: businessId, p_order: orderId })

const act = (businessId: string, orderId: string, action: string, extra: Record<string, unknown> = {}) =>
  rpc<MedicineOrder>('sehat_mo_act', { p_business: businessId, p_order: orderId, p_action: action, ...extra })

export const acceptOrder = (b: string, o: string) => act(b, o, 'accept')
export const declineOrder = (b: string, o: string, reason?: string) => act(b, o, 'decline', { p_note: reason ?? null })
export const quoteOrder = (b: string, o: string, medicines: number, fee: number, note: string, rxChecked: boolean) =>
  act(b, o, 'quote', { p_amount: medicines, p_fee: fee, p_note: note || null, p_rx_checked: rxChecked })
export const dropOrder = (b: string, o: string, reason: string) => act(b, o, 'drop', { p_note: reason })
export const packOrder = (b: string, o: string) => act(b, o, 'packed')
export const sendOut = (b: string, o: string, practitionerId: string | null) => act(b, o, 'assign', { p_practitioner: practitionerId })
export const markDelivered = (b: string, o: string, amount: number, mode: PayMode) =>
  act(b, o, 'delivered', { p_amount: amount, p_mode: mode })

// Where the pharmacy delivers — a subset of the PIN codes it is listed in.
// Nothing chosen, no orders.
export interface DeliveryArea { pin_code: string; area_name: string | null; chosen: boolean }
export const deliveryArea = (businessId: string) =>
  rpc<DeliveryArea[]>('sehat_mo_delivery_area', { p_business: businessId }).then(r => r ?? [])
export const setDeliveryArea = (businessId: string, pins: string[]) =>
  rpc<string[]>('sehat_mo_set_delivery_area', { p_business: businessId, p_pins: pins })

export interface DeliveryPerson { practitioner_id: string; name: string; role: string }
export const deliveryPeople = (businessId: string) =>
  rpc<DeliveryPerson[]>('sehat_mo_delivery_people', { p_business: businessId }).then(r => r ?? [])

// ── The patient's link (no login) ──────────────────────────────────────────
export interface PublicOrder {
  code: string
  status: OrderStatus
  pin_code: string
  medicines: string | null
  has_prescription: boolean
  patient_name: string | null
  created_at: string
  accepted_at: string | null
  quoted_at: string | null
  confirmed_at: string | null
  packed_at: string | null
  out_at: string | null
  delivered_at: string | null
  quote_amount: number | null
  delivery_fee: number | null
  total: number | null
  quote_note: string | null
  ended_reason: string | null
  pharmacy: string | null
  pharmacy_phone: string | null
  pharmacy_address: string | null
  delivery_name: string | null
  rating: number | null
  review: string | null
  patient_paid: number | null
  others: string | null
}

export const getPublicOrder = (token: string) => rpc<PublicOrder | null>('sehat_mo_public', { p_token: token })
export const patientStep = (token: string, action: 'confirm' | 'refuse' | 'cancel') =>
  rpc<PublicOrder>('sehat_mo_patient', { p_token: token, p_action: action })
export const patientFeedback = (token: string, rating: number, review: string, paid: number | null) =>
  rpc<PublicOrder>('sehat_mo_patient', { p_token: token, p_action: 'feedback', p_rating: rating, p_review: review || null, p_paid: paid })

export interface AdminOrderRow {
  code: string; status: OrderStatus; pin_code: string; created_at: string; pharmacy: string | null
  quote_total: number | null; collected_amount: number | null; patient_paid: number | null
  rating: number | null; mismatch: boolean; ended_reason: string | null
}
export const adminOrders = (days = 30) =>
  rpc<AdminOrderRow[]>('sehat_admin_medicine_orders', { p_days: days }).then(r => r ?? [])

export const rupees = (n: number | null | undefined) =>
  n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
