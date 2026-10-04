import { supabase } from './supabase'

// 0191: ambulance requests. The patient is never kept waiting — the bot gives
// them numbers and 108 at once — while every service in that PIN is alerted
// and the first to accept takes the trip. Shared by the website and the app.

export type TripStatus = 'open' | 'accepted' | 'on_the_way' | 'picked_up' | 'completed' | 'cancelled' | 'expired'
export type TripKind = 'emergency' | 'scheduled'
export type FareMode = 'cash' | 'upi' | 'card' | 'other' | 'free'

export interface TripEvent { event: string; by: string | null; note: string | null; at: string }

export interface Trip {
  id: string
  code: string
  kind: TripKind
  status: TripStatus
  pin_code: string
  need: string | null
  created_at: string
  accepted_at: string | null
  accepted_by_name: string | null
  driver_practitioner_id: string | null
  driver_name: string | null
  driver_phone: string | null
  vehicle_no: string | null
  eta_minutes: number | null
  on_way_at: string | null
  picked_at: string | null
  completed_at: string | null
  completed_by_name: string | null
  fare: number | null
  paid_mode: FareMode | null
  ended_reason: string | null
  rating: number | null
  review: string | null
  patient_paid: number | null
  mine: boolean
  patient_name: string | null
  patient_phone: string | null
  pickup_address: string | null
  events: TripEvent[] | null
}

export type TripScope = 'new' | 'active' | 'done'

export const TRIP_STATUS: Record<TripStatus, string> = {
  open: 'Needs an ambulance', accepted: 'Accepted', on_the_way: 'On the way', picked_up: 'Patient picked up',
  completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired',
}
export const TRIP_EVENT: Record<string, string> = {
  created: 'Requested', accepted: 'Accepted', declined: 'Declined', dropped: 'Given up', on_the_way: 'On the way',
  picked_up: 'Picked up', completed: 'Completed', patient_cancelled: 'Patient cancelled', patient_rated: 'Patient rated',
  amount_mismatch: 'Amounts differ', expired: 'Expired',
}

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const listTrips = (businessId: string, scope: TripScope) =>
  rpc<Trip[]>('sehat_am_list', { p_business: businessId, p_scope: scope }).then(r => r ?? [])
export const getTrip = (businessId: string, id: string) => rpc<Trip>('sehat_am_get', { p_business: businessId, p_req: id })

const act = (b: string, id: string, action: string, extra: Record<string, unknown> = {}) =>
  rpc<Trip>('sehat_am_act', { p_business: b, p_req: id, p_action: action, ...extra })
export const acceptTrip = (b: string, id: string, driverId: string | null, vehicle: string, eta: number | null) =>
  act(b, id, 'accept', { p_driver: driverId, p_vehicle: vehicle || null, p_eta: eta })
export const declineTrip = (b: string, id: string, reason?: string) => act(b, id, 'decline', { p_note: reason ?? null })
export const dropTrip = (b: string, id: string, reason: string) => act(b, id, 'drop', { p_note: reason })
export const onTheWay = (b: string, id: string, eta: number | null) => act(b, id, 'on_the_way', { p_eta: eta })
export const pickedUp = (b: string, id: string) => act(b, id, 'picked_up')
export const completeTrip = (b: string, id: string, fare: number, mode: FareMode) => act(b, id, 'completed', { p_fare: fare, p_mode: mode })

export interface Driver { practitioner_id: string; name: string; role: string; phone: string | null }
export const tripDrivers = (businessId: string) => rpc<Driver[]>('sehat_am_drivers', { p_business: businessId }).then(r => r ?? [])

export interface PublicTrip {
  code: string; kind: TripKind; status: TripStatus; pin_code: string; need: string | null; patient_name: string | null
  created_at: string; accepted_at: string | null; on_way_at: string | null; picked_at: string | null; completed_at: string | null
  service: string | null; service_phone: string | null; driver_name: string | null; driver_phone: string | null
  vehicle_no: string | null; eta_minutes: number | null; fare: number | null; ended_reason: string | null
  rating: number | null; review: string | null; patient_paid: number | null; numbers: string | null
}
export const getPublicTrip = (token: string) => rpc<PublicTrip | null>('sehat_am_public', { p_token: token })
export const cancelTripAsPatient = (token: string) => rpc<PublicTrip>('sehat_am_patient', { p_token: token, p_action: 'cancel' })
export const rateTrip = (token: string, rating: number, review: string, paid: number | null) =>
  rpc<PublicTrip>('sehat_am_patient', { p_token: token, p_action: 'feedback', p_rating: rating, p_review: review || null, p_paid: paid })

export interface AdminTripRow {
  code: string; kind: TripKind; status: TripStatus; pin_code: string; created_at: string; service: string | null
  minutes_to_accept: number | null; fare: number | null; patient_paid: number | null; rating: number | null
  mismatch: boolean; ended_reason: string | null
}
export const adminTrips = (days = 30) => rpc<AdminTripRow[]>('sehat_admin_ambulance_requests', { p_days: days }).then(r => r ?? [])

/** 0196: where the patient was when they asked from the app — a map pin for the crew. */
export const tripLocation = (businessId: string, id: string) =>
  rpc<{ lat: number; lng: number } | null>('sehat_am_location', { p_business: businessId, p_req: id })
export const mapsUrl = (t: { pickup_address: string | null; pin_code: string }, loc: { lat: number; lng: number } | null) =>
  loc ? `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.pickup_address ?? ''}, ${t.pin_code}`)}`
