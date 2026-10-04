import * as Location from 'expo-location'
import * as ImagePicker from 'expo-image-picker'
import * as DocumentPicker from 'expo-document-picker'
import { supabase } from './supabase'
import { activeConfig } from './env'

// Patients in the app (0196): sign in with a WhatsApp code, see their
// requests, rate what they used, and make requests with their location and a
// photo of the prescription. A patient login reaches nothing of any clinic.

export interface Me { phone: string; name: string | null; pin_code: string | null }

const fn = async (body: Record<string, unknown>) => {
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

export const requestCode = (phone: string) => fn({ action: 'request', phone })
export async function verifyCode(phone: string, code: string) {
  const r = await fn({ action: 'verify', phone, code })
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash!, type: 'email' })
  if (error) throw new Error('Could not start your session. Please try again.')
}

/** The signed-in patient, or null (not signed in, or signed in as a business). */
export async function me(): Promise<Me | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data, error } = await supabase.rpc('sehat_me')
  return error ? null : (data as Me)
}

const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

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

// ── Location ────────────────────────────────────────────────────────────────
export interface Place { lat: number; lng: number; pin: string | null; area: string | null }
/** Where the phone is, and its PIN code (BigDataCloud, as the website's area check). */
export async function whereAmI(): Promise<Place> {
  const { status } = await Location.requestForegroundPermissionsAsync()
  if (status !== 'granted') throw new Error('Location is off for Sehatsandhi. Turn it on in phone settings, or type your PIN code.')
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  const { latitude: lat, longitude: lng } = pos.coords
  let pin: string | null = null, area: string | null = null
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
    const j = await r.json() as { postcode?: string; locality?: string; city?: string }
    pin = /^[1-9][0-9]{5}$/.test(j.postcode ?? '') ? j.postcode! : null
    area = j.locality || j.city || null
  } catch { /* the coordinates alone still help an ambulance */ }
  return { lat, lng, pin, area }
}

// ── Photos and files ────────────────────────────────────────────────────────
export interface Picked { uri: string; name: string; mime: string }
export async function takePhoto(): Promise<Picked | null> {
  const p = await ImagePicker.requestCameraPermissionsAsync()
  if (!p.granted) throw new Error('Camera is off for Sehatsandhi. Turn it on in phone settings.')
  const r = await ImagePicker.launchCameraAsync({ quality: 0.6, mediaTypes: ['images'] })
  if (r.canceled || !r.assets?.[0]) return null
  const a = r.assets[0]
  return { uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, mime: a.mimeType ?? 'image/jpeg' }
}
export async function pickPhoto(): Promise<Picked | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] })
  if (r.canceled || !r.assets?.[0]) return null
  const a = r.assets[0]
  return { uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, mime: a.mimeType ?? 'image/jpeg' }
}
export async function pickFile(): Promise<Picked | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true })
  if (r.canceled || !r.assets?.[0]) return null
  const a = r.assets[0]
  return { uri: a.uri, name: a.name, mime: a.mimeType ?? 'application/octet-stream' }
}

export const bytesOf = async (uri: string): Promise<ArrayBuffer> => (await fetch(uri)).arrayBuffer()

/** A patient's photo, kept privately and shared with the pharmacy as a 14-day link. */
export async function uploadPrescription(p: Picked): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Please sign in again.')
  const path = `${user.id}/${Date.now()}-${p.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)}`
  const { error } = await supabase.storage.from('patient-uploads').upload(path, await bytesOf(p.uri), { contentType: p.mime, upsert: false })
  if (error) throw new Error(error.message)
  const { data, error: sErr } = await supabase.storage.from('patient-uploads').createSignedUrl(path, 14 * 86400)
  if (sErr || !data) throw new Error(sErr?.message ?? 'Could not share the photo.')
  return data.signedUrl
}

// ── 0197: my health records, and messages with my clinics ───────────────────
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
