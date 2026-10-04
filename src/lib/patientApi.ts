import { supabase } from './supabase'
import { activeConfig } from './env'

// Patients on the website (sehatsandhi.com/my) — the same account as the app:
// sign in with a WhatsApp code (patient-otp, 0196), then the patient's own
// records, requests, bookings, ratings and messages with their clinics.
// Everything goes through the functions the app uses (0196–0199), which act on
// the signed-in number only; a patient login reaches nothing of any clinic.

export interface Me { phone: string; name: string | null; pin_code: string | null }

const otp = async (body: Record<string, unknown>) => {
  const { url, anon } = activeConfig()
  const r = await fetch(`${url}/functions/v1/patient-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.message ?? j.error ?? 'Something went wrong. Please try again.')
  return j as { ok?: boolean; devCode?: string; retryInSeconds?: number; tokenHash?: string }
}

export const requestCode = (phone: string) => otp({ action: 'request', phone })
export async function verifyCode(phone: string, code: string) {
  const r = await otp({ action: 'verify', phone, code })
  // A clinic login in this browser gives way to the patient's.
  await supabase.auth.signOut().catch(() => {})
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash!, type: 'email' })
  if (error) throw new Error('Could not start your session. Please try again.')
}
export const signOut = () => supabase.auth.signOut()

/** The signed-in patient, or null (not signed in, or signed in as a clinic). */
export async function me(): Promise<Me | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data, error } = await supabase.rpc('sehat_me')
  return error ? null : (data as Me)
}

const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(/permission denied|JWT|42501/i.test(`${error.message} ${error.code}`) && !/sign in/i.test(error.message)
    ? 'Please sign in with your mobile number first.' : error.message)
  return data as T
}

// ── Requests and ratings (0196) ─────────────────────────────────────────────
export interface Activity {
  bookings: { id: string; when: string; status: string; name: string | null; place: string | null; doctor: string | null; rated: boolean; rateable: boolean }[]
  orders: { id: string; code: string; token: string; status: string; created_at: string; pharmacy: string | null; total: number | null; rated: boolean; rateable: boolean }[]
  trips: { id: string; code: string; token: string; status: string; kind: string; created_at: string; service: string | null; rated: boolean; rateable: boolean }[]
  insurance: { id: string; code: string; token: string; status: string; created_at: string; advisor: string | null; rated: boolean; rateable: boolean }[]
  site: string
}
export const myActivity = () => rpc<Activity>('sehat_my_activity')
export type RateKind = 'booking' | 'order' | 'trip' | 'insurance'
export const rate = (kind: RateKind, id: string, rating: number, review: string, paid: number | null, bought: boolean | null) =>
  rpc('sehat_my_rate', { p_kind: kind, p_id: id, p_rating: rating, p_review: review || null, p_paid: paid, p_bought: bought })

export interface Reply { ok?: boolean; code?: string; token?: string; text?: string }
export const orderMedicines = (pin: string, name: string, address: string, medicines: string, rxUrl: string) =>
  rpc<Reply>('sehat_app_medicine_order', { p_pin: pin, p_name: name, p_address: address, p_medicines: medicines, p_rx_url: rxUrl })
export const askAmbulance = (pin: string, name: string, kind: 'emergency' | 'scheduled', address: string, need: string, lat: number | null, lng: number | null) =>
  rpc<Reply>('sehat_app_ambulance_request', { p_pin: pin, p_name: name, p_kind: kind, p_address: address, p_need: need, p_lat: lat, p_lng: lng })
export const askInsurance = (pin: string, name: string, cover: string, members: string, callTime: string) =>
  rpc<Reply>('sehat_app_insurance_lead', { p_pin: pin, p_name: name, p_cover: cover, p_members: members, p_call_time: callTime })

// ── Location (the browser asks the person first) ────────────────────────────
export interface Place { lat: number; lng: number; pin: string | null; area: string | null }
export function whereAmI(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser cannot share your location. Please type your PIN code.')); return }
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      let pin: string | null = null, area: string | null = null
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
        const j = await r.json() as { postcode?: string; locality?: string; city?: string }
        pin = /^[1-9][0-9]{5}$/.test(j.postcode ?? '') ? j.postcode! : null
        area = j.locality || j.city || null
      } catch { /* the coordinates alone still help an ambulance */ }
      resolve({ lat, lng, pin, area })
    }, () => reject(new Error('Location is blocked for this site. Allow it in the browser, or type your PIN code.')),
    { enableHighAccuracy: true, timeout: 15000 })
  })
}

// ── Photos: kept privately, shared as a 14-day link ─────────────────────────
export async function uploadPhoto(f: File): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Please sign in again.')
  if (f.size > 10 * 1024 * 1024) throw new Error('That file is over 10 MB. Please choose a smaller photo.')
  const path = `${user.id}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)}`
  const { error } = await supabase.storage.from('patient-uploads').upload(path, f, { contentType: f.type || 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message)
  const { data, error: sErr } = await supabase.storage.from('patient-uploads').createSignedUrl(path, 14 * 86400)
  if (sErr || !data) throw new Error(sErr?.message ?? 'Could not share the photo.')
  return data.signedUrl
}

// ── My health records and messages with my clinics (0197) ──────────────────
export interface Records {
  members: { id: string; name: string; relation: string; age: number | null; gender: string | null }[]
  visits: { id: string; member_id: string; date: string | null; clinic: string; business_id: string; doctor: string | null; complaint: string | null; diagnosis: string | null; advice: string | null; follow_up: string | null }[]
  prescriptions: { id: string; member_id: string; no: string; clinic: string; doctor: string; date: string; diagnosis: string | null }[]
  lab_reports: { id: string; member_id: string; no: string; clinic: string; by: string | null; date: string }[]
  bills: { id: string; member_id: string; no: string; clinic: string; date: string; amount: number; type: string }[]
  discharges: { id: string; member_id: string; no: string; clinic: string; doctor: string | null; date: string; diagnosis: string | null }[]
  clinics: { business_id: string; name: string; phone: string | null; address: string | null; last_seen: string | null; unread: number }[]
}
export const myRecords = () => rpc<Records>('sehat_my_records')
export const openRecord = (kind: 'rx' | 'lab' | 'bill' | 'ds', id: string) => rpc<string>('sehat_my_open', { p_kind: kind, p_id: id })

export interface ChatMessage { id: number; from: 'patient' | 'clinic'; by: string | null; body: string; photo_url: string | null; at: string; read: boolean }
export const myThread = (businessId: string) =>
  rpc<{ clinic: { name: string; phone: string | null; address: string | null }; messages: ChatMessage[] }>('sehat_my_thread', { p_business: businessId })
export const sendToClinic = (businessId: string, body: string, photoUrl: string | null) =>
  rpc<ChatMessage>('sehat_my_send', { p_business: businessId, p_body: body, p_photo_url: photoUrl })

// ── Booking (0198) and finding (public) ─────────────────────────────────────
export interface Booked { id: string; doctor: string | null; clinic: string; address: string | null; phone: string | null; at: string; name: string }
export const bookAppointment = (businessId: string, practitionerId: string | null, slot: string, name: string, age: number | null) =>
  rpc<Booked>('sehat_app_book', { p_business: businessId, p_practitioner: practitionerId, p_slot: slot, p_name: name, p_age: age })
export const cancelBooking = (id: string) => rpc<null>('sehat_app_cancel_booking', { p_id: id })

export interface Doctor {
  practitioner_id: string | null; full_name: string; qualification: string | null; business_id: string; business_name: string
  address: string | null; consultation_fee: number | null; nearby: boolean; area: string | null
}
export const findDoctors = async (speciality: string, pin: string): Promise<Doctor[]> => {
  const rows = await rpc<Doctor[]>('sehat_find_doctors', { p_speciality: speciality, p_pin_code: pin })
  const seen = new Set<string>()
  return (rows ?? []).filter(d => { const k = `${d.practitioner_id}|${d.business_id}`; if (seen.has(k)) return false; seen.add(k); return true })
}
export interface Listed { business_id: string; title: string; phone: string | null; address: string | null; avg_rating: number | null; total_reviews: number | null }
export const findPlaces = (kind: 'lab' | 'hospital' | 'pharmacy' | 'ambulance' | 'insurance', pin: string) =>
  rpc<Listed[]>('bot_bookable', { p_kind: 'business', p_filter: kind, p_pincode: pin }).then(r => r ?? [])

const istDate = (plusDays: number) => new Date(Date.now() + 5.5 * 3_600_000 + plusDays * 86_400_000).toISOString().slice(0, 10)
/** Bookable times on the asked day; with none, the next day that has some (up to 2 days on). */
export async function openTimes(business: string, practitioner: string | null, fromDay = 0): Promise<{ day: number; slots: string[] }> {
  for (let k = fromDay; k <= Math.max(fromDay, 2); k++) {
    const { data } = await supabase.rpc('sehat_open_windows', { p_business_id: business, p_date: istDate(k), p_practitioner_id: practitioner })
    const now = Date.now()
    const slots = ((data ?? []) as { window_start: string; seats_left: number }[])
      .filter(x => x.seats_left > 0 && new Date(x.window_start).getTime() > now + 15 * 60_000).map(x => x.window_start).slice(0, 8)
    if (slots.length) return { day: k, slots }
  }
  return { day: fromDay, slots: [] }
}

export interface Camp {
  id: string; kind: 'free_camp' | 'special_offer'; title: string; description: string; services: string | null
  date_from: string; date_to: string; time_slot: string | null; near: boolean
  business_id: string | null; business_name: string | null; phone: string | null; address: string | null; city: string | null
}
export const findCamps = (pin: string) => rpc<Camp[]>('sehat_find_camps', { p_pin_code: pin }).then(r => r ?? [])
