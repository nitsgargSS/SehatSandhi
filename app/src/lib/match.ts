import { supabase } from './supabase'

// What a patient types, understood by the database (0201 match_message, through
// sehat_match_text) — the same matcher the WhatsApp bot uses, so a word added
// in the admin's Message Review works here too. No matching rules live in the
// app: the one exception is the emergency word list below, kept on the phone so
// that with no network the 108 screen still opens.

export interface Match {
  is_emergency: boolean
  intent: 'doctor' | 'lab' | 'medicine' | 'ambulance' | 'insurance' | 'camps' | null
  speciality: string | null
  speciality_name_hi: string | null
  /** 0201: which test, when it is a lab need — sugar, thyroid, cbc, xray… */
  lab_test_hint: string | null
  location: string | null
  /** 0212: the place in Hindi when it was typed in Hindi. */
  location_hi?: string | null
  /** 0212: false = a place Sehatsandhi is not in yet (Karnal, Delhi…); null = no place said. */
  place_live?: boolean | null
  pincode: string | null
  target_date: string | null
  time_window: 'morning' | 'afternoon' | 'evening' | null
  secondary_intents: string[]
  confidence: number
  action: 'proceed' | 'confirm' | 'menu' | 'emergency'
  next_branch: string | null
  reply_text: string
}

// ── Emergency words, on the phone ────────────────────────────────────────────
// A starter list shipped with the app; replaced by the server's list
// (sehat_emergency_terms, 0204) whenever the app is online.
const BUNDLED = [
  'behosh', 'बेहोश', 'unconscious', 'hosh nahi', 'saans nahi', 'sans nahi', 'सांस नहीं', 'saans nahi aa rahi',
  'chest pain', 'seene me dard', 'seene mein dard', 'सीने में दर्द', 'heart attack', 'dil ka daura', 'accident',
  'एक्सीडेंट', 'khoon beh raha', 'खून बह रहा', 'bleeding', 'daura pada', 'mirgi', 'seizure', 'zeher', 'jahar',
  'जहर', 'poison', 'jal gaya', 'जल गया', 'burn', 'delivery pain', 'labour pain', 'stroke', 'lakwa', 'saanp ne kata',
  'snake bite', 'suicide', 'aatmhatya', 'doob gaya', 'current laga', 'emergency', 'इमरजेंसी',
]
const KEY_TERMS = 'sehat:emergencyTerms'
const KEY_RECENT = 'sehat:recentSearches'

const norm = (s: string) => s.toLowerCase()
  .replace(/[़‌‍]/g, '').replace(/ँ/g, 'ं')
  .replace(/[^a-z0-9ऀ-ॣ०-ॿ]+/g, ' ')
  .replace(/(.)\1\1+/g, '$1$1').replace(/\s+/g, ' ').trim()

const terms = (): string[] => {
  try { const t = JSON.parse(localStorage.getItem(KEY_TERMS) ?? 'null'); if (Array.isArray(t) && t.length) return t } catch { /* first run */ }
  return BUNDLED.map(norm)
}

/** Refresh the phone's emergency list from the server. Quietly does nothing offline. */
export async function refreshEmergencyTerms() {
  const { data, error } = await supabase.rpc('sehat_emergency_terms')
  if (!error && Array.isArray(data) && data.length) { try { localStorage.setItem(KEY_TERMS, JSON.stringify(data)) } catch { /* fine */ } }
}

/** True when the text contains an emergency word — no network, no negation
 *  handling: on the phone a false alarm is the safe mistake. */
export function looksLikeEmergency(text: string): boolean {
  const t = ` ${norm(text)} `
  return terms().some(w => w && t.includes(` ${w} `))
}

// ── The server ───────────────────────────────────────────────────────────────
/** null = no answer within the time (offline or slow) — the caller falls back. */
export async function matchText(text: string, pin?: string | null, timeoutMs = 5000): Promise<Match | null> {
  const call = supabase.rpc('sehat_match_text', { p_text: text, p_pin: pin ?? null })
    .then(({ data, error }) => (error ? null : (data as Match)), () => null)
  const timeout = new Promise<null>(r => setTimeout(() => r(null), timeoutMs))
  return Promise.race([call, timeout])
}

/** Days from today (India) to the match's date: 0 today, 1 tomorrow… */
export function dayOffset(m: Match): number | undefined {
  if (!m.target_date) return undefined
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  return Math.max(0, Math.round((Date.parse(m.target_date) - Date.parse(today)) / 86_400_000))
}

// ── Where each answer goes in the app ────────────────────────────────────────
// The one map from the matcher's next_branch to a screen. Doctors and labs open
// Find with the search filled in; the rest have their own screens.
export type Go = { pathname: string; params?: Record<string, string> }
export function routeFor(m: Match, text: string): Go | null {
  switch (m.next_branch) {
    case 'doctor_search':
    case 'lab_booking':
      return { pathname: '/find', params: { q: text, m: JSON.stringify(m) } }
    case 'medicine': return { pathname: '/me/order' }
    case 'ambulance': return { pathname: '/me/ambulance' }
    case 'insurance': return { pathname: '/me/insurance' }
    case 'camps': return { pathname: '/camps' }
    default: return null
  }
}

/** "बाल रोग · जगाधरी · कल सुबह" — what was understood, for the chip. */
export function summary(m: Match): string {
  const what = m.speciality_name_hi ?? ({ doctor: 'डॉक्टर', lab: 'जांच लैब', medicine: 'दवाई', ambulance: 'एम्बुलेंस', insurance: 'इंश्योरेंस', camps: 'कैंप / ऑफ़र' } as Record<string, string>)[m.intent ?? ''] ?? ''
  const d = dayOffset(m)
  const day = d === undefined ? '' : (['आज', 'कल', 'परसों'][d] ?? m.target_date ?? '')
  const win = m.time_window ? ({ morning: 'सुबह', afternoon: 'दोपहर', evening: 'शाम' })[m.time_window] : ''
  return [what, m.location, [day, win].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
}

export const SECONDARY_HI: Record<string, string> = {
  lab: 'जांच (टेस्ट) भी बुक करें?', doctor: 'डॉक्टर भी चाहिए?', medicine: 'दवाई भी मंगवाएँ?',
  insurance: 'इंश्योरेंस के बारे में भी?', camps: 'कैंप / ऑफ़र भी देखें?', ambulance: 'एम्बुलेंस भी?',
}

// ── Recent searches (this phone only) ────────────────────────────────────────
export function recentSearches(): string[] {
  try { const r = JSON.parse(localStorage.getItem(KEY_RECENT) ?? '[]'); return Array.isArray(r) ? r.slice(0, 5) : [] } catch { return [] }
}
export function rememberSearch(text: string) {
  const t = text.trim()
  if (!t) return
  try { localStorage.setItem(KEY_RECENT, JSON.stringify([t, ...recentSearches().filter(x => x !== t)].slice(0, 5))) } catch { /* fine */ }
}
