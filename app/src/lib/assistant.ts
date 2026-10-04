// What the patient means, from what they type — English, Hindi or Hinglish.
// Plain rules, no AI service: a speciality from symptom or doctor words, a
// 6-digit PIN or a place name, and a day. Anything not understood is asked for
// with buttons, the way the WhatsApp bot asks.

export interface Understood {
  speciality?: string
  pin?: string
  place?: string
  day?: 0 | 1 | 2
  other?: 'pharmacy' | 'lab' | 'ambulance' | 'insurance' | 'hospital'
  /** A word that might be a town — confirmed against the place list before use. */
  guess?: string
}

// Code → words that point to it. Lower-case; Devanagari matched as typed.
// A leading/trailing space makes a short word match only on its own (" ent "
// must not match "appointment").
const WORDS: [string, string[]][] = [
  ['EYE', ['eye', 'aankh', 'ankh', 'aakh', 'nazar', 'najar', 'chashma', 'specs', 'spectacle', 'ophthal', 'cataract', 'motiyabind', 'glaucoma', 'आँख', 'आंख', 'नेत्र', 'चश्मा']],
  ['DENT', [' dent', 'teeth', 'tooth', 'daant', 'dant', 'daat', 'masoode', 'gum', 'root canal', 'दांत', 'दाँत']],
  ['SKIN', ['skin', 'twacha', 'chamdi', 'derma', 'rash', 'acne', 'pimple', 'khujli', 'itching', 'hair fall', 'त्वचा', 'खुजली']],
  ['PAED', ['child', 'children', 'baby', 'bacha', 'bachcha', 'bachche', 'bacche', 'bache', 'baccha', 'bachon', 'paed', 'pediatric', 'paediatric', 'shishu', 'बच्चा', 'बच्चे', 'शिशु']],
  ['GYN', ['gyn', 'gynae', 'pregnan', 'women', 'mahila', 'period', 'garbh', 'delivery', 'maternity', 'स्त्री', 'गर्भ', 'महिला']],
  ['IVF', ['ivf', 'infertil', 'fertility', 'santan', 'संतान']],
  ['ORTH', ['bone', 'haddi', 'joint', 'ortho', 'kamar', 'ghutna', 'ghutne', 'knee', 'back pain', 'fracture', 'हड्डी', 'घुटना', 'कमर']],
  ['CARD', ['heart', 'dil', 'cardio', 'chest pain', 'seene', 'हृदय', 'दिल']],
  ['ENT', [' ent ', ' ear', 'kaan', 'nose', 'naak', 'throat', 'gala', 'tonsil', 'कान', 'नाक', 'गला']],
  ['GAST', ['stomach', ' pet ', 'gastro', 'liver', 'acidity', ' gas ', 'पेट']],
  ['NEUR', ['neuro', 'brain', 'dimag', 'migraine', 'paralysis', 'lakwa', 'spine', 'मस्तिष्क', 'दिमाग']],
  ['URO', ['kidney', 'urine', 'peshab', ' uro', 'pathri', 'stone', 'गुर्दा', 'पेशाब', 'पथरी']],
  ['PSY', ['mental', 'depression', 'anxiety', 'psych', 'tanav', 'stress', 'neend', 'मानसिक', 'तनाव']],
  ['DIAB', ['sugar', 'diabet', 'madhumeh', 'शुगर', 'मधुमेह']],
  ['ONC', ['cancer', 'tumour', 'tumor', 'कैंसर']],
  ['PHYS', ['physio', 'exercise therapy', 'फिजियो']],
  ['ALT', ['ayurved', 'homeo', 'आयुर्वेद']],
  ['GEN', ['fever', 'bukhar', 'bukhaar', 'general', 'cough', 'khansi', 'cold', 'zukam', 'jukam', 'body pain', 'weakness', 'kamzori', 'बुखार', 'खांसी', 'जुकाम', 'सामान्य']],
]

export function understand(raw: string): Understood {
  const t = ` ${raw.toLowerCase().replace(/[.,!?]/g, ' ')} `
  const u: Understood = {}
  const pin = raw.match(/\b[1-9]\d{5}\b/)
  if (pin) u.pin = pin[0]
  if (/(pharmacy|medical store|chemist|dawai|dawa|दवा)/.test(t)) u.other = 'pharmacy'
  else if (/(\blab\b|test|blood test|jaanch|janch|x-?ray|ultrasound|जांच)/.test(t)) u.other = 'lab'
  else if (/(ambulance|एम्बुलेंस)/.test(t)) u.other = 'ambulance'
  else if (/(insurance|bima|beema|बीमा|policy|mediclaim)/.test(t)) u.other = 'insurance'
  else if (/(hospital|aspatal|haspatal|अस्पताल)/.test(t)) u.other = 'hospital'
  for (const [code, words] of WORDS) {
    if (words.some(w => t.includes(w))) { u.speciality = code; break }
  }
  if (/\b(aaj|today|abhi|now)\b|आज/.test(t)) u.day = 0
  else if (/\b(kal|tomorrow|tmrw)\b|कल/.test(t)) u.day = 1
  else if (/\b(parso|parson)\b|परसों/.test(t)) u.day = 2
  // A place: what follows "in / mein / near", if it looks like a name and is
  // not a symptom word ("daant me dard" is not a town called Dard).
  const place = raw.match(/(?:\bin\b|\bmein\b|\bme\b|\bnear\b|\bpaas\b)\s+([A-Za-z][A-Za-z ]{2,30})/i)
  const cleaned = place?.[1].replace(FILLER, '').trim()
  if (cleaned && !u.pin && !NOT_A_PLACE.test(cleaned)) u.place = cleaned
  // No "in": the last word may still be the town ("dil ka doctor jagadhri").
  // Only a guess — the screen checks it against the place list first.
  if (!u.pin && !u.place) {
    const last = raw.trim().split(/\s+/).pop() ?? ''
    if (/^[A-Za-z]{4,}$/.test(last) && !NOT_A_PLACE.test(last) && !FILLER.test(` ${last} `) && !WORDS.some(([, ws]) => ws.some(w => w.trim() === last.toLowerCase())))
      u.guess = last
  }
  return u
}

const FILLER = /\b(kal|aaj|today|tomorrow|parso|ke|ka|ki|ko|hai|doctor|dr|chahiye|wala|wale|please|plz)\b/gi
const NOT_A_PLACE = /^(dard|dukh|pain|problem|takleef|taklif|khujli|sujan|jalan|infection|bukhar|fever|doctor|hai|chahiye)\b/i

/** A bare reply to "which area?" — a PIN, or a place name. */
export function asPlace(raw: string): { pin?: string; place?: string } {
  const pin = raw.match(/\b[1-9]\d{5}\b/)
  if (pin) return { pin: pin[0] }
  const p = raw.trim()
  return p.length >= 3 && /^[A-Za-zऀ-ॿ ]+$/.test(p) ? { place: p } : {}
}
