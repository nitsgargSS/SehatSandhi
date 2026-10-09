// The WhatsApp conversation: what the bot says next.
//
// It began as the flow that lived in AiSensy's flow builder until October 2026
// (docs/whatsapp-bot-flow.md) — the same menus, the same questions, the same
// five bot_*_json calls — and then took on what that builder could not do,
// the way the app's Find screen already works:
//
//   • say it any way: "kal jagadhri me dentist", "bachche ko bukhar" go to the
//     database's matcher (0201, sehat_free_text_whatsapp) and skip the menus;
//   • tap, don't type: doctors and times arrive as a list to pick from (a
//     typed number still works);
//   • it remembers: the last area and the last patient are one tap away;
//   • "where am I": the area question takes a shared location in place of a PIN;
//   • STOP / START, and a 1–5 rating after a visit, are answered;
//   • "लिखकर बताएं": for a patient who does not know which doctor to see,
//     every menu offers to take the problem in their own words (0221 — the
//     matcher then finds the sub-speciality: "sugar", "piles", "gupt rog").
//
// Nothing here knows about HTTP or Meta — step() takes where the patient is
// and what they just sent, and returns where they are now and what to send
// back. whatsapp-inbound does the rest.
//
// The database functions decide everything that matters (what was meant, what
// was found, whether a slot is free, whether a booking went through) and
// answer with the text to show and a route. This file shows it and follows.

export type State = 'idle' | 'ask_pin' | 'ask_pin_insurance' | 'ask_selection' | 'ask_slot' | 'ask_name'

export interface Vars {
  /** A speciality code (SKIN, DENT…) or a service kind (pharmacy, lab_booking…). */
  code?: string
  /** What the patient typed for city or PIN. */
  pin?: string
  /** The number they picked from the search results. */
  selection?: string
  /** The slot they picked. */
  slot?: string
  /** The last area that found something — offered again as a button. */
  lastPin?: string
  /** The last "name, age" booked for — offered again as a button. */
  lastPatient?: string
  /** What the matcher thinks they meant, waiting on a yes. */
  pending?: { branch: string; code: string; pin: string }
}

export interface Session { state: State; vars: Vars }

export interface Inbound {
  /** What they typed, or the title of what they tapped. */
  text: string | null
  /** The id of a list row or button they tapped. */
  replyId: string | null
  /** No conversation was under way: a first message, or the first in an hour. */
  fresh?: boolean
  /** They shared a location: the PIN code or town it is in, or null if that could not be worked out. */
  located?: string | null
}

export type Reply =
  | { kind: 'text'; body: string }
  /** A question answered by sharing a location: WhatsApp shows a "Send location" button. */
  | { kind: 'location'; body: string }
  | { kind: 'buttons'; body: string; buttons: { id: string; title: string }[] }
  | {
    kind: 'list'; header?: string; body: string; footer?: string; sectionTitle: string
    rows: { id: string; title: string; description?: string }[]
  }

/** Calls a database function; null when it failed. */
export type Rpc = (fn: string, args: Record<string, string>) => Promise<Record<string, unknown> | null>

const KEYWORDS = new Set(['HI', 'HELLO', 'NAMASTE', 'HELP', 'DOCTOR', 'LAB', 'PHARMACY', 'AMBULANCE', 'INSURANCE', 'HOSPITAL'])

const MENU_BUTTON = { id: 'nav:menu', title: '🏠 Main Menu' }
const PIN_BUTTON = { id: 'nav:pin', title: '📍 दूसरा PIN कोड' }

const ASK_PIN = 'अपना शहर का नाम या PIN कोड भेजें 📍'
const OR_LOCATION = 'या नीचे के बटन से अपनी लोकेशन भेजें।'
const LOCATION_BUTTON = { id: 'loc:ask', title: '📌 लोकेशन भेजें' }
const NO_PLACE = 'हमें आपकी लोकेशन से एरिया नहीं मिल पाया। कृपया अपना 6 अंकों का PIN कोड या शहर का नाम भेजें।'
const ASK_SELECTION = 'कौनसे नंबर वाले डॉक्टर/सेंटर के साथ बुक करना चाहेंगे? नंबर बताएं (1, 2, 3 ....)'
const ASK_SLOT = 'कौनसा स्लॉट चुनना चाहेंगे?'
const ASK_NAME_AGE = 'मरीज़ का नाम और उम्र बताएं (जैसे: Sunita, 34)'
const DESCRIBE = 'अपनी तकलीफ़ या ज़रूरत अपने शब्दों में लिखकर भेजें — जैसे "शुगर", "घुटने में दर्द", "बच्चे को बुखार", "बवासीर"।\nहम सही डॉक्टर ढूंढ देंगे। 🙏\n\nJust type your problem in your own words.'
const DESCRIBE_ROW = { id: 'menu:describe', title: '✍️ लिखकर बताएं', description: 'Not sure which doctor? Type your problem' }
const NOT_UNDERSTOOD = 'माफ़ कीजिए, हम समझ नहीं पाए। 🙏\nआप लिखकर भी बता सकते हैं — जैसे "दांत का डॉक्टर जगाधरी" — या नीचे से चुनें:'
const PICK_ONE = 'किसके साथ बुक करना है? नीचे से चुनें या नंबर भेजें 👇'
const FAILED = 'कुछ गड़बड़ हो गई। कृपया थोड़ी देर बाद फिर कोशिश करें।\nSomething went wrong. Please try again in a little while.'

const MAIN_MENU: Reply = {
  kind: 'list',
  header: 'Sehatsandhi',
  body: 'नमस्ते! 🙏\nSehatsandhi में आपका स्वागत है —आपके एरिया के\nवेरिफाइड डॉक्टरों, फार्मेसी, लैब, एम्बुलेंस और इंश्योरेंस\nसे जुड़ें, बिल्कुल फ्री।\n\nआपको क्या चाहिए?',
  footer: 'Please select one option',
  sectionTitle: 'Please select one option',
  rows: [
    { id: 'menu:doctor', title: '🩺 डॉक्टर खोजें', description: 'Find a Doctor — verified, instant booking' },
    { id: 'menu:lab', title: '🔬 डायग्नोस्टिक लैब', description: 'Diagnostic — MRI, CT Scan, ultrasound, Blood Test, home sample collection' },
    { id: 'menu:pharmacy', title: '💊 मेडिसिन ऑर्डर करें', description: 'Order Medicine — home delivery' },
    { id: 'menu:ambulance', title: '🚑 एम्बुलेंस', description: 'Ambulance — help, anytime' },
    { id: 'menu:insurance', title: '🛡️ इंश्योरेंस', description: 'Insurance — free home visit' },
    { id: 'menu:camps', title: '🎉 कैंप्स & ऑफर्स', description: 'Camps & Offers near you' },
    DESCRIBE_ROW,
  ],
}

const TEST_TYPE_MENU: Reply = {
  kind: 'list',
  header: 'टेस्ट टाइप/Test Type',
  body: 'कौनसा टेस्ट चाहिए?\nPlease select Test Type',
  sectionTitle: 'Please select one option',
  rows: [
    { id: 'test:blood', title: '🩸 ब्लड टेस्ट', description: 'Blood Test — sugar, thyroid, CBC & more' },
    { id: 'test:mri', title: '🧠 MRI', description: 'MRI Scan — all body parts' },
    { id: 'test:ct', title: '📷 CT स्कैन', description: 'CT Scan — fast reporting' },
    { id: 'test:xray', title: '🦴 X-Ray', description: 'X-Ray — same day results' },
    { id: 'test:ultrasound', title: '🔊 अल्ट्रासाउंड', description: 'Ultrasound — pregnancy & abdomen scans' },
    { id: 'test:other', title: '📋 अन्य टेस्ट', description: 'Other Test — tell us what you need' },
  ],
}

const SPECIALITY_MENU: Reply = {
  kind: 'list',
  header: 'स्पेशलिटी चुनें',
  body: 'बढ़िया! किस तरह के डॉक्टर की तलाश है? 👇',
  footer: '100% वेरिफाइड डॉक्टर',
  sectionTitle: 'Choose one speciality:',
  rows: [
    { id: 'spec:SKIN', title: '🧴 त्वचा रोग', description: 'Skin (Dermatology)' },
    { id: 'spec:DENT', title: '🦷 डेंटल', description: 'Dental' },
    { id: 'spec:EYE', title: '👁️ आंख', description: 'Eye (Ophthalmology)' },
    { id: 'spec:PAED', title: '👶 बच्चों का डॉक्टर', description: 'Child Specialist' },
    { id: 'spec:GYN', title: '👩 स्त्री रोग', description: 'Gynaecology / Maternity' },
    { id: 'spec:ORTH', title: '🦴 हड्डी रोग', description: 'Orthopaedics / Bones' },
    { id: 'spec:ENT', title: '👂 कान-नाक-गला', description: 'ENT (Ear Nose Throat)' },
    { id: 'spec:GEN', title: 'जनरल फिजिशियन', description: 'General Physician' },
    { id: 'spec:more', title: 'अन्य स्पेशलिटी', description: 'More Specialities' },
    DESCRIBE_ROW,
  ],
}

const MORE_SPECIALITY_MENU: Reply = {
  kind: 'list',
  header: 'अन्य स्पेशलिटी',
  body: 'ये स्पेशलिटीज़ भी उपलब्ध हैं:',
  footer: '100% वेरिफाइड डॉक्टर',
  sectionTitle: 'Please choose one option',
  rows: [
    { id: 'spec:IVF', title: '🤰 IVF/फर्टिलिटी', description: 'IVF / Fertility' },
    { id: 'spec:CARD', title: '❤️ हृदय रोग', description: 'Heart (Cardiology)' },
    { id: 'spec:GAST', title: '🫃 पेट रोग', description: 'Gastro / Stomach' },
    { id: 'spec:NEUR', title: '🧠 न्यूरो', description: 'Neuro / Brain & Spine' },
    { id: 'spec:URO', title: '🩺 किडनी रोग', description: 'Urology / Kidney' },
    { id: 'spec:ONC', title: '🎗️ कैंसर रोग', description: 'Oncology / Cancer' },
    { id: 'spec:PSY', title: '🧘 मानसिक स्वास्थ्य', description: 'Psychiatry / Mental Health' },
    { id: 'spec:DIAB', title: '💉 डायबिटीज़', description: 'Diabetologist' },
    { id: 'spec:PHYS', title: '🏃 फिजियोथेरेपी', description: 'Physiotherapy' },
    { id: 'spec:more2', title: 'और स्पेशलिटी', description: 'Even more: chest, kidney, surgery…' },
  ],
}

// A WhatsApp list holds ten rows, so the specialities run to a third page.
const THIRD_SPECIALITY_MENU: Reply = {
  kind: 'list',
  header: 'और स्पेशलिटी',
  body: 'ये स्पेशलिटीज़ भी उपलब्ध हैं:',
  footer: '100% वेरिफाइड डॉक्टर',
  sectionTitle: 'Please choose one option',
  rows: [
    { id: 'spec:ALT', title: '🌿 आयुर्वेद-होम्योपैथी', description: 'Ayurveda / Homeopathy' },
    { id: 'spec:PULM', title: '🫁 छाती और सांस', description: 'Chest & Lungs — asthma, TB' },
    { id: 'spec:ENDO', title: '🦋 थायरॉइड-हार्मोन', description: 'Endocrinology — thyroid, hormones' },
    { id: 'spec:RHEU', title: '🤲 गठिया रोग', description: 'Rheumatology — arthritis, gout' },
    { id: 'spec:NEPH', title: '💧 किडनी (नेफ्रोलॉजी)', description: 'Kidney disease, dialysis' },
    { id: 'spec:SURG', title: '🏥 सर्जरी', description: 'General Surgery — hernia, piles, gallbladder' },
    { id: 'spec:SEXO', title: '🔒 यौन स्वास्थ्य', description: 'Sexual Health (Sexology) — private' },
    DESCRIBE_ROW,
  ],
}

type Step = { session: Session; replies: Reply[] }

const str = (v: unknown) => typeof v === 'string' ? v : ''

/** What outlives a conversation: the area and the patient offered again next time. */
export function carry(v: Vars): Vars {
  return { ...(v.lastPin ? { lastPin: v.lastPin } : {}), ...(v.lastPatient ? { lastPatient: v.lastPatient } : {}) }
}

const failed = (v: Vars): Step => ({ session: { state: 'idle', vars: carry(v) }, replies: [{ kind: 'buttons', body: FAILED, buttons: [MENU_BUTTON] }] })
const menu = (v: Vars, body?: string): Step =>
  ({ session: { state: 'idle', vars: carry(v) }, replies: [body ? { ...MAIN_MENU, body } as Reply : MAIN_MENU] })
const show = (v: Vars, list: Reply): Step => ({ session: { state: 'idle', vars: carry(v) }, replies: [list] })

/**
 * "Which area?" — typed, or with the last one a tap away, or by sharing a
 * location. WhatsApp's send-location message carries no other button, so with
 * an area to offer it is one more tap: "📌 लोकेशन भेजें" asks for it.
 */
function pinQuestion(v: Vars, body = ASK_PIN): Reply {
  return v.lastPin
    ? { kind: 'buttons', body, buttons: [{ id: 'pin:last', title: `📍 ${v.lastPin}` }, LOCATION_BUTTON] }
    : { kind: 'location', body: `${body}\n${OR_LOCATION}` }
}
const askPin = (code: string, v: Vars, body?: string): Step =>
  ({ session: { state: 'ask_pin', vars: { ...carry(v), code } }, replies: [pinQuestion(v, body)] })
const askPinInsurance = (v: Vars, body?: string): Step =>
  ({ session: { state: 'ask_pin_insurance', vars: carry(v) }, replies: [pinQuestion(v, body)] })

// ── Lists to tap ──
// The database answers with a numbered list in plain text:
//   "1. Dr. Anita Verma — Yamuna City Hospital (4.5★)\n   फ़ीस ₹500\n   https://…"
//   "1. शुक्र 9 अक्टूबर — 04:00 PM"
// Each numbered line becomes a row; the number is what the row sends back.

interface Item { n: string; head: string; details: string[] }

function parseItems(text: string): { intro: string; items: Item[] } {
  const items: Item[] = []
  const intro: string[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d{1,2})[.)]\s+(.+)$/)
    if (m) items.push({ n: m[1], head: m[2].trim(), details: [] })
    else if (!items.length) intro.push(line)
    else if (line.trim()) items[items.length - 1].details.push(line.trim())
  }
  return { intro: intro.join('\n').trim(), items }
}

/**
 * The search results, to pick a doctor or centre from. `again`: the text is
 * the database asking for another pick, and already says so.
 */
function pickList(text: string, again = false): Reply[] {
  const { items } = parseItems(text)
  if (!items.length) return [{ kind: 'text', body: again ? text : `${text}\n\n${ASK_SELECTION}` }]
  const list = (body: string): Reply => ({
    kind: 'list', body, sectionTitle: 'डॉक्टर / सेंटर चुनें',
    rows: items.slice(0, 10).map(i => {
      const [name, ...rest] = i.head.split(' — ')
      const more = [rest.join(' — '), ...i.details.filter(d => !/^https?:\/\//.test(d))].filter(Boolean).join(' · ')
      return { id: `sel:${i.n}`, title: `${i.n}. ${name}`, ...(more ? { description: more } : {}) }
    }),
  })
  const whole = again ? text : `${text}\n\n${PICK_ONE}`
  // The full text carries the profile links; a list body holds 1,024 characters.
  return whole.length <= 1024 ? [list(whole)] : [{ kind: 'text', body: text }, list(PICK_ONE)]
}

/** The open times, to pick one from. `again`: as for pickList. */
function slotList(text: string, again = false): Reply[] {
  const { intro, items } = parseItems(text)
  if (!items.length) return [{ kind: 'text', body: again ? text : `${text}\n\n${ASK_SLOT}` }]
  const list: Reply = {
    kind: 'list', body: again ? (intro || ASK_SLOT) : (intro ? `${intro}\n\n${ASK_SLOT}` : ASK_SLOT), sectionTitle: 'समय चुनें',
    rows: items.slice(0, 10).map(i => {
      // "शुक्र 9 अक्टूबर — 04:00 PM": the time is what is being picked, the day sits under it.
      const at = i.head.lastIndexOf(' — ')
      return at < 0 ? { id: `slot:${i.n}`, title: i.head }
        : { id: `slot:${i.n}`, title: i.head.slice(at + 3), description: i.head.slice(0, at) }
    }),
  }
  return items.length > 10 ? [{ kind: 'text', body: text }, list] : [list]
}

// ── The five calls ──

async function search(vars: Vars, rpc: Rpc): Promise<Step> {
  // p_type is always 'doctor'; the service kind travels in p_filter_value (0105).
  const r = await rpc('bot_generic_search_json', { p_type: 'doctor', p_filter_value: vars.code ?? '', p_pincode: vars.pin ?? '' })
  const text = str(r?.text)
  if (!text) return failed(vars)
  return found(text, str(r?.route), vars)
}

/** A search answered: a list to pick from, something to read, or a question back. */
function found(text: string, route: string, vars: Vars): Step {
  if (route === 'list') {
    return { session: { state: 'ask_selection', vars: { ...vars, lastPin: vars.pin || vars.lastPin } }, replies: pickList(text) }
  }
  if (route === 'info') {
    // "Nothing there yet" also comes back as info, so only a PIN code is worth remembering here.
    const lastPin = /^\d{6}$/.test(vars.pin ?? '') ? vars.pin : vars.lastPin
    return { session: { state: 'idle', vars: { ...vars, lastPin } }, replies: [{ kind: 'buttons', body: text, buttons: [MENU_BUTTON, PIN_BUTTON] }] }
  }
  // The text asks again; the answer is another city or PIN.
  return { session: { state: 'ask_pin', vars }, replies: [{ kind: 'text', body: text }] }
}

async function slots(vars: Vars, rpc: Rpc): Promise<Step> {
  const r = await rpc('bot_available_slots_json', {
    p_speciality: vars.code ?? '', p_pincode: vars.pin ?? '', p_selection: vars.selection ?? '', p_type: 'doctor',
  })
  const text = str(r?.text)
  if (!text) return failed(vars)
  if (r?.route === 'slots') return { session: { state: 'ask_slot', vars }, replies: slotList(text) }
  return { session: { state: 'ask_selection', vars }, replies: pickList(text, true) }
}

async function checkSlot(vars: Vars, rpc: Rpc): Promise<Step> {
  const r = await rpc('bot_check_slot_json', {
    p_speciality: vars.code ?? '', p_pincode: vars.pin ?? '', p_selection: vars.selection ?? '',
    p_slot_selection: vars.slot ?? '', p_type: 'doctor',
  })
  const text = str(r?.text)
  if (!text) return failed(vars)
  if (text === 'ok') {
    const ask: Reply = vars.lastPatient
      ? { kind: 'buttons', body: ASK_NAME_AGE, buttons: [{ id: 'name:last', title: vars.lastPatient }] }
      : { kind: 'text', body: ASK_NAME_AGE }
    return { session: { state: 'ask_name', vars }, replies: [ask] }
  }
  return { session: { state: 'ask_slot', vars }, replies: slotList(text, true) }
}

async function book(vars: Vars, patientInfo: string, phone: string, rpc: Rpc): Promise<Step> {
  const r = await rpc('bot_book_appointment_json', {
    p_speciality: vars.code ?? '', p_pincode: vars.pin ?? '', p_selection: vars.selection ?? '',
    p_patient_info: patientInfo, p_slot_selection: vars.slot ?? '', p_phone: phone, p_type: 'doctor',
  })
  const text = str(r?.text)
  if (!text) return failed(vars)
  const kept = carry(r?.booked === true ? { ...vars, lastPatient: patientInfo } : vars)
  return { session: { state: 'idle', vars: kept }, replies: [{ kind: 'buttons', body: text, buttons: [MENU_BUTTON] }] }
}

async function insuranceLead(vars: Vars, pin: string, phone: string, rpc: Rpc): Promise<Step> {
  const r = await rpc('bot_submit_insurance_lead_json', { p_phone: phone, p_pincode: pin })
  const text = str(r?.text)
  if (!text) return failed(vars)
  return { session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'buttons', body: text, buttons: [MENU_BUTTON] }] }
}

// ── Said in their own words ──

/** Where a matched need goes next. `text` is what the matcher says back. */
function follow(branch: string, code: string, pin: string, text: string, vars: Vars): Step {
  if (branch === 'insurance') return askPinInsurance(vars, text ? `${text}\n\n${ASK_PIN}` : undefined)
  if (branch === 'doctor_search' && !code) return show(vars, { ...SPECIALITY_MENU, ...(text ? { body: text } : {}) } as Reply)
  if (!code) return menu(vars)
  return askPin(code, vars, text ? `${text}\n\n${ASK_PIN}` : undefined)
}

/**
 * What they typed, understood by the database's matcher (0201) — the one the
 * app uses. null: it made nothing of it, and the caller carries on as before.
 */
async function freeText(text: string, vars: Vars, phone: string, rpc: Rpc): Promise<Step | null> {
  // '<pin hint>|<text>': the hint is the area they last searched.
  const r = await rpc('sehat_free_text_whatsapp', { p_phone: phone, p_payload: `${/^\d{6}$/.test(vars.lastPin ?? '') ? vars.lastPin : ''}|${text}` })
  const out = str(r?.text), route = str(r?.route)
  if (!r || route === 'menu' || !route) return null
  const branch = str(r.next_branch)
  // What the search takes for this need: a speciality code, or the service kind.
  const code = str(r.search_type) === 'doctor' ? str(r.filter_value) : str(r.search_type)
  const pin = str(r.pincode)

  if (route === 'emergency') return { session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'buttons', body: out, buttons: [MENU_BUTTON] }] }
  if (route === 'list' || route === 'info') return found(out, route, { ...carry(vars), code, pin })
  if (route === 'ask_pin') return askPin(code, vars, out)
  if (route === 'confirm') {
    return {
      session: { state: 'idle', vars: { ...carry(vars), pending: { branch, code, pin } } },
      replies: [{ kind: 'buttons', body: out.replace(/\n?हाँ \/ नहीं\s*$/, ''), buttons: [{ id: 'ft:yes', title: 'हाँ / Yes' }, { id: 'nav:menu', title: 'नहीं / No' }] }],
    }
  }
  // The matcher already knows the area (said now, or the one last searched):
  // look straight away. Insurance still asks — its answer sends a request.
  if (code && pin && branch !== 'insurance') return search({ ...carry(vars), code, pin }, rpc)
  return follow(branch, code, pin, out, vars)
}

/** A tap on a menu row or a navigation button. null: not one of those. */
function tapped(id: string, s: Session): Step | null {
  const v = s.vars
  if (id === 'nav:menu') return menu(v)
  if (id === 'nav:pin') return v.code ? askPin(v.code, v) : menu(v)
  if (id === 'menu:doctor') return show(v, SPECIALITY_MENU)
  if (id === 'menu:lab') return show(v, TEST_TYPE_MENU)
  if (id === 'menu:insurance') return askPinInsurance(v)
  if (id === 'menu:pharmacy' || id === 'menu:ambulance' || id === 'menu:camps') return askPin(id.slice(5), v)
  if (id === 'menu:describe') return { session: { state: 'idle', vars: carry(v) }, replies: [{ kind: 'text', body: DESCRIBE }] }
  if (id === 'spec:more') return show(v, MORE_SPECIALITY_MENU)
  if (id === 'spec:more2') return show(v, THIRD_SPECIALITY_MENU)
  if (id.startsWith('spec:')) return askPin(id.slice(5), v)
  // The test type itself is not kept: a named test books, anything else gets a call back.
  if (id.startsWith('test:')) return askPin(id === 'test:other' ? 'lab_callback' : 'lab_booking', v)
  return null
}

/**
 * One turn of the conversation. `phone` is the patient's number, digits with
 * country code.
 */
export async function step(s: Session, m: Inbound, phone: string, rpc: Rpc): Promise<Step> {
  const vars = { ...s.vars }
  let state = s.state
  let text = (m.text ?? '').trim()
  let typed = !m.replyId

  if (m.replyId) {
    const id = m.replyId
    const t = tapped(id, s)
    if (t) return t
    // Taps that stand for an answer.
    if (id === 'ft:yes') {
      const p = vars.pending
      if (!p) return menu(vars)
      if (p.code && p.pin) return search({ ...carry(vars), code: p.code, pin: p.pin }, rpc)
      return follow(p.branch, p.code, p.pin, '', vars)
    }
    if (id === 'loc:ask' && (state === 'ask_pin' || state === 'ask_pin_insurance')) {
      return { session: s, replies: [{ kind: 'location', body: `${ASK_PIN}\n${OR_LOCATION}` }] }
    }
    if (id === 'pin:last' && vars.lastPin && (state === 'ask_pin' || state === 'ask_pin_insurance')) text = vars.lastPin
    else if (id === 'name:last' && vars.lastPatient && state === 'ask_name') text = vars.lastPatient
    // A doctor or a time picked from a list — also from an earlier list, to change one's mind.
    else if (id.startsWith('sel:') && vars.code && vars.pin) { text = id.slice(4); state = 'ask_selection' }
    else if (id.startsWith('slot:') && vars.code && vars.pin && vars.selection) { text = id.slice(5); state = 'ask_slot' }
    else if (/^(pin|name|sel|slot|loc):/.test(id)) return menu(vars)   // a button from a conversation that is over
    else typed = true                                             // not ours (a template's button): read its words
  }

  if (m.located !== undefined) {
    // A shared location stands for the area, wherever in the chat it arrives.
    if (!m.located) return { session: s, replies: [{ kind: 'text', body: NO_PLACE }] }
    if (state !== 'ask_pin' && state !== 'ask_pin_insurance') {
      // Nothing was asked: keep it for the next search.
      return menu({ ...vars, lastPin: m.located })
    }
    text = m.located
  }

  if (KEYWORDS.has(text.toUpperCase())) return menu(vars)

  if (typed && /^(stop|start)$/i.test(text)) {
    // 0173: opting out of, and back into, messages we start.
    const r = await rpc('bot_generic_search_json', { p_type: text.toLowerCase(), p_filter_value: text, p_pincode: phone })
    const out = str(r?.text)
    if (!out) return failed(vars)
    return { session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'text', body: out }] }
  }

  switch (state) {
    case 'ask_pin': {
      // Not a PIN code: it may be a place — or they have moved on to another
      // problem ("bawasir ka ilaj"). The matcher knows a need from a town.
      if (typed && text && !/\d{6}/.test(text) && m.located === undefined) {
        const f = await freeText(text, vars, phone, rpc)
        if (f) return f
      }
      return search({ ...vars, pin: text }, rpc)
    }
    case 'ask_pin_insurance': return insuranceLead(vars, text, phone, rpc)
    case 'ask_name': return book(vars, text, phone, rpc)
    case 'ask_selection':
    case 'ask_slot': {
      // No number in it: they may be asking for something else altogether.
      if (typed && text && !/\d/.test(text)) {
        const f = await freeText(text, vars, phone, rpc)
        if (f) return f
      }
      return state === 'ask_selection' ? slots({ ...vars, selection: text }, rpc) : checkSlot({ ...vars, slot: text }, rpc)
    }
  }

  // Not in the middle of anything.
  if (!text) return menu(vars)
  if (/^[1-5]$/.test(text)) {
    // 0164 / 0215: a rating after a visit, or the answer to the question after it.
    const r = await rpc('bot_record_rating_json', { p_phone: phone, p_message: text })
    if (r?.recorded === true && str(r.text)) {
      return { session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'buttons', body: str(r.text), buttons: [MENU_BUTTON] }] }
    }
    return menu(vars)
  }
  const f = await freeText(text, vars, phone, rpc)
  if (f) return f
  // A greeting gets the welcome; anything else mid-chat, the matcher's "did not understand".
  return m.fresh ? menu(vars) : menu(vars, NOT_UNDERSTOOD)
}

// ── Meta's message shapes ──

/** Cut to Meta's limit, counted the way Meta counts, never through an emoji. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s
  let out = ''
  for (const ch of s) {
    if (out.length + ch.length > max) break
    out += ch
  }
  return out.trimEnd()
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()

/** A reply as the message bodies Meta's Cloud API takes (without `to`). */
export function toMeta(r: Reply): Record<string, unknown>[] {
  if (r.kind === 'text') return [{ type: 'text', text: { body: clip(r.body, 4096) } }]

  if (r.kind === 'location') {
    return [{ type: 'interactive', interactive: { type: 'location_request_message', body: { text: clip(r.body, 1024) }, action: { name: 'send_location' } } }]
  }

  if (r.kind === 'buttons') {
    const buttons = r.buttons.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, 20) } }))
    const interactive = (body: string) => ({ type: 'interactive', interactive: { type: 'button', body: { text: body }, action: { buttons } } })
    // A button message holds 1,024 characters; a long answer goes first, on its own.
    if (r.body.length > 1024) return [{ type: 'text', text: { body: clip(r.body, 4096) } }, interactive('👇')]
    return [interactive(r.body)]
  }

  return [{
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(r.header ? { header: { type: 'text', text: clip(r.header, 60) } } : {}),
      body: { text: clip(r.body, 1024) },
      ...(r.footer ? { footer: { text: clip(r.footer, 60) } } : {}),
      action: {
        button: 'चुनें / Select',
        sections: [{
          title: clip(r.sectionTitle, 24),
          rows: r.rows.slice(0, 10).map(row => ({
            id: row.id, title: clip(row.title, 24),
            ...(row.description ? { description: clip(oneLine(row.description), 72) } : {}),
          })),
        }],
      },
    },
  }]
}
