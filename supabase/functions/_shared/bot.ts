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
//     matcher then finds the sub-speciality: "sugar", "piles", "gupt rog");
//   • one clinic's patients (0224): a message carrying a clinic's SS-code —
//     its QR or slip link — goes to that clinic's doctors, on either number.
//     On the CLINIC LINE, the second number every clinic's messages go out
//     from, the bot also works out which clinic is meant from the message
//     being replied to or from who has been in touch, asks when it cannot
//     tell, and stays with that clinic until the patient asks for more.
//
// EVERY MESSAGE COSTS (0227): Meta prices each one we send, so a turn is ONE
// message. A long result list is one tappable list, not a text and then a
// list; a patient whose area is known is not asked for it again; a search
// that finds one doctor goes straight to that doctor's times; and the app is
// offered inside a message being sent anyway, never as one of its own.
//
// Nothing here knows about HTTP or Meta — step() takes where the patient is
// and what they just sent, and returns where they are now and what to send
// back. whatsapp-inbound does the rest.
//
// The database functions decide everything that matters (what was meant, what
// was found, whether a slot is free, whether a booking went through) and
// answer with the text to show and a route. This file shows it and follows.

export type State = 'idle' | 'ask_pin' | 'ask_pin_insurance' | 'ask_selection' | 'ask_slot' | 'ask_name'
  /** 0232: they sent a rating as a bare number; what they send next is the review in their words. */
  | 'ask_review'
  /** 0243: part-way through asking for an ambulance, medicines or an insurance advisor. */
  | 'req'
  /** 0244: choosing tests, lab or home, and a time, at a lab picked from the list. */
  | 'lab'

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
  /** The clinic this conversation is with (0224). */
  clinic?: Clinic
  /** Clinic line: they asked for all of Sehatsandhi — do not steer back to a clinic this conversation. */
  general?: boolean
  /** 0243: a request being put together — which one, what was just asked, and the answers so far. */
  req?: { what: 'ambulance' | 'medicine' | 'insurance'; ask: string; f: Record<string, string> }
  /** 0245: the kind of test being looked for ('pathology' | 'radiology' | '' for any), and its name as chosen ("MRI"). */
  labKind?: string
  labWant?: string
  /** 0244: a lab booking being put together. */
  lab?: {
    /** 0245: the kind of test, and what was asked for; a scan is always at the centre. */
    kind?: string; want?: string; visit?: boolean; cats?: Record<string, string>
    /** 0246: the centre's own one-line offer ("10% off on MRI"). */
    offer?: string
    ask: 'items' | 'more' | 'how' | 'address' | 'slot' | 'name'
    biz: string; name: string; fee: number; menu: boolean
    /** 'p:<id>' / 't:<id>' chosen so far, and their names. */
    items: string[]; names: string[]
    /** The rows last shown, to name what is tapped. */
    shown?: Record<string, string>
    note?: string; how?: 'lab' | 'home'; address?: string; slot?: string
  }
}

/** A clinic as the bot shows it — sehat_wa_clinic_card. */
export interface Clinic { code: string; name: string; phone?: string; city?: string; doctors?: number; /** 0241: this number said STOP to its updates. */ stopped?: boolean }

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
  /** Which number was written to: Sehatsandhi's own, or the one clinics' messages come from. */
  line?: 'main' | 'clinic'
  /** The id of the message being replied to, when WhatsApp says. */
  replyTo?: string | null
  /** Their WhatsApp profile name. */
  name?: string | null
  /** Where a shared location is, for an ambulance's map pin. */
  coords?: { lat: number; lng: number } | null
  /** A photo they sent, already saved: a link the pharmacy can open. */
  image?: string | null
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
const AREA_ROW = { id: 'nav:pin', title: '📍 दूसरा एरिया', description: 'Search in another area' }
const TYPE_IT = 'सीधे लिखकर भी बता सकते हैं — जैसे "दांत का डॉक्टर जगाधरी"।'
const APP_WELCOME = '📱 Sehatsandhi ऐप में अपॉइंटमेंट ट्रैक करें, पर्चे और रिपोर्ट एक जगह रखें — मुफ़्त:'
const ALL_BUTTON = { id: 'nav:all', title: '🔎 और डॉक्टर खोजें' }
const QR_UNKNOWN = 'यह QR कोड अभी सक्रिय नहीं है। 🙏\nThis clinic code is not active right now.\n\nआप नीचे से चुन सकते हैं:'
const WHICH_CLINIC = 'नमस्ते! 🙏\nआप किससे बात करना चाहते हैं? नीचे से चुनें 👇\nWho would you like to reach?'
const FAILED = 'कुछ गड़बड़ हो गई। कृपया थोड़ी देर बाद फिर कोशिश करें।\nSomething went wrong. Please try again in a little while.'

const MAIN_MENU: Reply = {
  kind: 'list',
  header: 'Sehatsandhi',
  body: `नमस्ते! 🙏\nSehatsandhi में आपका स्वागत है —आपके एरिया के\nवेरिफाइड डॉक्टरों, फार्मेसी, लैब, एम्बुलेंस और इंश्योरेंस\nसे जुड़ें, बिल्कुल फ्री।\n\nआपको क्या चाहिए? नीचे से चुनें।\n${TYPE_IT}`,
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
  return {
    ...(v.lastPin ? { lastPin: v.lastPin } : {}), ...(v.lastPatient ? { lastPatient: v.lastPatient } : {}),
    ...(v.clinic ? { clinic: v.clinic } : {}), ...(v.general ? { general: true } : {}),
  }
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
const labKept = (v: Vars): Vars => ({ ...(v.labKind !== undefined ? { labKind: v.labKind } : {}), ...(v.labWant ? { labWant: v.labWant } : {}) })
const askPin = (code: string, v: Vars, body?: string): Step =>
  ({ session: { state: 'ask_pin', vars: { ...carry(v), code, ...(code === 'lab_booking' ? labKept(v) : {}) } }, replies: [pinQuestion(v, body)] })
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
function pickList(text: string, again = false, o: { note?: string; areaRow?: boolean } = {}): Reply[] {
  const { intro, items } = parseItems(text)
  if (!items.length) return [{ kind: 'text', body: again ? text : `${text}\n\n${ASK_SELECTION}` }]
  const rows = items.slice(0, o.areaRow ? 9 : 10).map(i => {
    const [name, ...rest] = i.head.split(' — ')
    const more = [rest.join(' — '), ...i.details.filter(d => !/^https?:\/\//.test(d))].filter(Boolean).join(' · ')
    return { id: `sel:${i.n}`, title: `${i.n}. ${name}`, ...(more ? { description: more } : {}) }
  })
  const note = o.note ? `${o.note}\n\n` : ''
  const whole = note + (again ? text : `${text}\n\n${PICK_ONE}`)
  // One message, always (0227). The full text carries the profile links; a
  // list body holds 1,024 characters, so a long list keeps its rows — each
  // has the name, fee and rating — and drops the text above them.
  const short = `${note}${intro ? `${intro}\n\n` : ''}${items.length} विकल्प मिले${items.length > rows.length ? ` — पहले ${rows.length} नीचे हैं, बाक़ी sehatsandhi.com पर` : ''}।\n\n${PICK_ONE}`
  return [{
    kind: 'list', body: whole.length <= 1024 ? whole : short, sectionTitle: 'डॉक्टर / सेंटर चुनें',
    rows: o.areaRow ? [...rows, AREA_ROW] : rows,
  }]
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
  // One message (0227): the first ten times; a later one can still be asked for by its number.
  return [items.length > 10 ? { ...list, body: `${list.body}\n(पहले 10 समय नीचे हैं)` } : list]
}

// ── The five calls ──

/** `note`: a line to put above the results — the area that was assumed, when it was not asked. */
async function search(vars: Vars, rpc: Rpc, note?: string): Promise<Step> {
  // 0245: labs have their own list — only those that do the kind of test asked for.
  if (vars.code === 'lab_booking') return labList(vars, rpc, note)
  // p_type is always 'doctor'; the service kind travels in p_filter_value (0105).
  const r = await rpc('bot_generic_search_json', { p_type: 'doctor', p_filter_value: vars.code ?? '', p_pincode: vars.pin ?? '' })
  const text = str(r?.text)
  if (!text) return failed(vars)
  return results(text, str(r?.route), vars, rpc, note)
}

/** A search answered: a list to pick from, something to read, or a question back. */
function found(text: string, route: string, vars: Vars, note?: string): Step {
  const above = note ? `${note}\n\n` : ''
  // A clinic's code stands in for the area when its own doctors are listed: not an area to offer again.
  const ofClinic = CLINIC_CODE.test(vars.pin ?? '')
  if (route === 'list') {
    const lastPin = ofClinic ? vars.lastPin : (vars.pin || vars.lastPin)
    return { session: { state: 'ask_selection', vars: { ...vars, lastPin } }, replies: pickList(text, false, { note, areaRow: !ofClinic }) }
  }
  if (route === 'info') {
    // "Nothing there yet" also comes back as info, so only a PIN code is worth remembering here.
    const lastPin = /^\d{6}$/.test(vars.pin ?? '') ? vars.pin : vars.lastPin
    return { session: { state: 'idle', vars: { ...vars, lastPin } }, replies: [{ kind: 'buttons', body: above + text, buttons: [MENU_BUTTON, PIN_BUTTON] }] }
  }
  // The text asks again; the answer is another city or PIN.
  return { session: { state: 'ask_pin', vars }, replies: [{ kind: 'text', body: above + text }] }
}

/**
 * found(), and one step saved (0227): a search that finds exactly one doctor
 * goes straight to that doctor's times, saying whose they are.
 */
async function results(text: string, route: string, vars: Vars, rpc: Rpc, note?: string): Promise<Step> {
  const step = found(text, route, vars, note)
  const { items } = route === 'list' ? parseItems(text) : { items: [] }
  if (items.length !== 1) return step
  const next = await slots({ ...step.session.vars, selection: '1' }, rpc)
  const first = next.replies[0]
  if (next.session.state !== 'ask_slot' || first?.kind !== 'list') return step      // no times: show the doctor as found
  const who = [items[0].head, ...items[0].details.filter(d => !/^https?:\/\//.test(d))].join('\n')
  next.replies[0] = { ...first, body: `${note ? `${note}\n\n` : ''}${who}\n\n${first.body}` }
  return next
}

async function slots(vars: Vars, rpc: Rpc): Promise<Step> {
  // 0244: a lab is not booked as a visit — its tests are chosen first.
  if (vars.code === 'lab_booking') {
    const lab = await labStart(vars, rpc)
    if (lab) return lab
  }
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
  // 0232: a button to rate the visit, good for a day — a tap and our answer cost nothing in that time.
  const buttons = r?.booked === true ? [{ id: `rate:${Date.now()}`, title: '⭐ रेटिंग दें' }, MENU_BUTTON] : [MENU_BUTTON]
  const done: Step = { session: { state: 'idle', vars: kept }, replies: [{ kind: 'buttons', body: text, buttons }] }
  return r?.booked === true ? invited(done, phone, rpc) : done
}

// ── Rating a visit (0232) ──

const RATE_BUTTON_MS = 24 * 3_600_000
const RATE_EXPIRED = 'यह बटन बुकिंग के 24 घंटे तक ही चलता है। डॉक्टर से मिलने के बाद रेटिंग देने के लिए यहीं 1 से 5 तक एक नंबर भेजें।'
const RATE_WORDS = 'अपना अनुभव एक-दो लाइन में लिखकर भी भेज सकते हैं।'
const RATE_LIST: Reply = {
  kind: 'list', header: 'रेटिंग दें', body: 'आपकी विज़िट कैसी रही? नीचे से चुनें 👇', sectionTitle: 'रेटिंग चुनें',
  rows: [
    { id: 'rate:score:5', title: '⭐⭐⭐⭐⭐', description: 'बहुत अच्छा / Excellent' },
    { id: 'rate:score:4', title: '⭐⭐⭐⭐', description: 'अच्छा / Good' },
    { id: 'rate:score:3', title: '⭐⭐⭐', description: 'ठीक-ठाक / Average' },
    { id: 'rate:score:2', title: '⭐⭐', description: 'खराब / Poor' },
    { id: 'rate:score:1', title: '⭐', description: 'बहुत खराब / Very poor' },
  ],
}

/** Their rating, recorded by the database if there is a visit to rate. null: there was not. */
async function rate(score: string, vars: Vars, phone: string, rpc: Rpc): Promise<Step | null> {
  const r = await rpc('bot_record_rating_json', { p_phone: phone, p_message: score })
  if (r?.recorded !== true || !str(r.text)) return null
  // A number alone: what they write next is kept as their review.
  const text = str(r.text)
  return { session: { state: 'ask_review', vars: carry(vars) }, replies: [{ kind: 'text', body: /लिखकर/.test(text) ? text : `${text}\n\n${RATE_WORDS}` }] }
}

/** The app's link if this patient has not been offered it at this moment before, else ''. */
/**
 * 0250: something was finished here — say what the app adds, with its store
 * links. In the confirmation when it fits, else straight after it. The
 * database decides whether (no link yet, has the app, invited this week: no).
 */
async function invited(step: Step, phone: string, rpc: Rpc): Promise<Step> {
  const pitch = str((await rpc('sehat_wa_app_pitch', { p_phone: phone, p_moment: 'done' }))?.text)
  const last = step.replies[step.replies.length - 1]
  if (!pitch || !last) return step
  if (last.kind === 'buttons' && `${last.body}\n\n${pitch}`.length <= 1024) {
    return { ...step, replies: [...step.replies.slice(0, -1), { ...last, body: `${last.body}\n\n${pitch}` }] }
  }
  return { ...step, replies: [...step.replies, { kind: 'text', body: pitch }] }
}

async function appOffer(phone: string, moment: 'welcome', rpc: Rpc): Promise<string> {
  const r = await rpc('sehat_wa_app_offer', { p_phone: phone, p_moment: moment })
  return str(r?.link)
}

/** The main menu to someone starting a conversation — with the app offered, the first time. */
async function welcome(v: Vars, phone: string, rpc: Rpc): Promise<Step> {
  const app = await appOffer(phone, 'welcome', rpc)
  return app ? menu(v, `${MAIN_MENU.body}\n\n${APP_WELCOME}\n${app}`) : menu(v)
}

async function insuranceLead(vars: Vars, pin: string, phone: string, rpc: Rpc): Promise<Step> {
  const r = await rpc('bot_submit_insurance_lead_json', { p_phone: phone, p_pincode: pin })
  const text = str(r?.text)
  if (!text) return failed(vars)
  return { session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'buttons', body: text, buttons: [MENU_BUTTON] }] }
}

// ── One clinic's patients (0224) ──

const CLINIC_CODE = /SS-[A-Z0-9]{5}/i

function asClinic(o: unknown): Clinic | null {
  const c = o as Record<string, unknown> | null
  if (!c || typeof c !== 'object' || !str(c.code) || !str(c.name)) return null
  return { code: str(c.code), name: str(c.name), phone: str(c.phone), city: str(c.city), doctors: Number(c.doctors ?? 0) }
}

/** Which clinic a message means: by its code, by the message replied to, or by who has been in touch. */
async function whichClinic(phone: string, code: string, replyTo: string, rpc: Rpc) {
  const r = await rpc('sehat_wa_clinic_line', { p_phone: phone, p_code: code, p_reply_to: replyTo })
  if (!r) return null
  // 0241: which of them this number said STOP to, so its menu can offer the updates again.
  const s = await rpc('sehat_wa_stopped_clinics', { p_phone: phone })
  const off = new Set((Array.isArray(s?.codes) ? s.codes : []).map(x => str(x)))
  const mark = (c: Clinic | null): Clinic | null => c && (s?.all === true || off.has(c.code)) ? { ...c, stopped: true } : c
  const clinics = (Array.isArray(r.clinics) ? r.clinics : []).map(asClinic).filter((c): c is Clinic => !!c).map(c => mark(c) as Clinic)
  return { by: str(r.by), chosen: mark(asClinic(r.chosen)), clinics }
}

/** A clinic's own menu: book with it, hear from it, or its number to ring. */
function clinicHome(v: Vars, c: Clinic): Step {
  const body = [
    `🏥 *${c.name}*${c.city ? `\n📍 ${c.city}` : ''}`,
    `नमस्ते! 🙏 आप Sehatsandhi के ज़रिए *${c.name}* से जुड़े हैं।\nYou are connected to ${c.name} through Sehatsandhi.`,
    ...(c.phone ? [`📞 बात करने के लिए कॉल करें / To speak to them, call:\n${c.phone}`] : []),
    ...(c.stopped ? [`🔕 आपने इस क्लिनिक के अपडेट बंद किए हैं। दोबारा पाने के लिए *अपडेट पाएं* दबाएं — या सीधे अपॉइंटमेंट बुक करें।\nYou stopped updates from this clinic. Tap *अपडेट पाएं* to get them again — or just book an appointment.`] : []),
    'नीचे से चुनें 👇',
  ].join('\n\n')
  const { general: _g, ...rest } = carry(v)
  return {
    session: { state: 'idle', vars: { ...rest, clinic: c } },
    replies: [{
      kind: 'buttons', body, buttons: [
        ...(c.doctors ? [{ id: `clinic:book:${c.code}`, title: '📅 अपॉइंटमेंट बुक' }] : []),
        { id: `clinic:optin:${c.code}`, title: '🔔 अपडेट पाएं' },
        ALL_BUTTON,
      ],
    }],
  }
}

/** Several clinics know this number: ask which. */
function clinicChoice(v: Vars, clinics: Clinic[]): Step {
  return {
    session: { state: 'idle', vars: carry(v) },
    replies: [{
      kind: 'list', header: 'Sehatsandhi', body: WHICH_CLINIC, sectionTitle: 'चुनें / Choose',
      rows: [
        ...clinics.slice(0, 9).map(c => ({ id: `clinic:pick:${c.code}`, title: c.name, ...(c.city ? { description: c.city } : {}) })),
        { id: 'nav:all', title: '🔎 और डॉक्टर खोजें', description: 'All of Sehatsandhi — doctors, labs, pharmacies' },
      ],
    }],
  }
}

/** The clinic's doctors, to book with — or, when it has one, straight to that doctor's times. */
async function clinicBook(v: Vars, code: string, rpc: Rpc): Promise<Step> {
  // The code is both what to look for and where (bot_pincode reads a clinic's area from it).
  const vars: Vars = { ...carry(v), code, pin: code }
  const r = await rpc('bot_generic_search_json', { p_type: 'doctor', p_filter_value: code, p_pincode: code })
  const text = str(r?.text)
  if (!text) return failed(v)
  if (str(r?.route) !== 'list') return { session: { state: 'idle', vars: carry(v) }, replies: [{ kind: 'buttons', body: text, buttons: [MENU_BUTTON] }] }
  return results(text, 'list', vars, rpc)
}

// ── Requests: an ambulance, medicines, an insurance advisor (0243) ──
// What the app's three screens ask, one question a message, and then the same
// request the app makes: everyone nearby is told, and the first to take it answers.

type Req = NonNullable<Vars['req']>
const asking = (v: Vars, req: Req, reply: Reply): Step => ({ session: { state: 'req', vars: { ...carry(v), req } }, replies: [reply] })
const pinOf = (s: string) => s.match(/(?<!\d)[1-9]\d{5}(?!\d)/)?.[0] ?? ''

const AMB_FIRST = '🚨 इमरजेंसी में पहले *108* पर कॉल करें — मुफ़्त।\nIn an emergency call *108* first.\n\nहम पास की एम्बुलेंस को भी अलर्ट कर देंगे — जो पहले स्वीकार करेगी, आपको कॉल करेगी।'
const AMB_WHERE = '📍 मरीज़ कहाँ है? लोकेशन भेजें, या PIN कोड के साथ पता लिखें।\nWhere is the patient?'
const AMB_PIN = 'हमें PIN कोड नहीं मिला। कृपया 6 अंकों का PIN कोड भेजें, या लोकेशन भेजें। इमरजेंसी हो तो अभी 108 पर कॉल करें।\nWe could not find a PIN code. Send the 6-digit PIN code or your location. If it is urgent, call 108 now.'
const MED_WHAT = '💊 पर्ची की फ़ोटो भेजें 📷 — या दवाइयों के नाम लिखें।\nSend the prescription photo, or type the medicines.'
const MED_ADDRESS = '🏠 डिलीवरी का पूरा पता, PIN कोड के साथ लिखें।\nType the delivery address with its PIN code.'
const INS_COVER: Reply = {
  kind: 'list', header: '🛡️ हेल्थ इंश्योरेंस',
  body: 'लाइसेंस वाला सलाहकार आपको कॉल करेगा।\nA licensed advisor will call you.\n\nकौनसा कवर चाहिए? 👇',
  sectionTitle: 'कवर चुनें / Choose',
  rows: [
    { id: 'req:cover:Family floater', title: '👨‍👩‍👧 पूरा परिवार', description: 'Family floater' },
    { id: 'req:cover:Just me', title: '🙋 सिर्फ़ मेरे लिए', description: 'Just me' },
    { id: 'req:cover:Parents / senior citizen', title: '👵 माता-पिता / बुज़ुर्ग', description: 'Parents / senior citizen' },
    { id: 'req:cover:Top-up of existing policy', title: '➕ टॉप-अप', description: 'Top-up of an existing policy' },
  ],
}
const INS_MEMBERS = 'किन्हें कवर करना है, उम्र के साथ लिखें — जैसे "मैं 34, पत्नी 31, 2 बच्चे"।\nWho should be covered, with ages?'
const INS_TIME: Reply = {
  kind: 'buttons', body: 'सलाहकार कब कॉल करे?\nWhen should the advisor call?',
  buttons: [{ id: 'req:time:Morning', title: '🌅 सुबह' }, { id: 'req:time:Afternoon', title: '☀️ दोपहर' }, { id: 'req:time:After 6 pm', title: '🌙 शाम 6 के बाद' }],
}

/** The first question of a request. `pin`: an area already known for it. */
function requestStart(what: Req['what'], v: Vars, pin = ''): Step {
  const f: Record<string, string> = pin ? { pin } : {}
  if (what === 'ambulance') {
    return asking(v, { what, ask: 'kind', f }, {
      kind: 'buttons', body: AMB_FIRST,
      buttons: [{ id: 'req:kind:emergency', title: '🚨 अभी चाहिए' }, { id: 'req:kind:scheduled', title: '📅 बुकिंग करनी है' }, MENU_BUTTON],
    })
  }
  if (what === 'medicine') return asking(v, { what, ask: 'what', f }, { kind: 'text', body: MED_WHAT })
  return asking(v, { what, ask: 'cover', f }, INS_COVER)
}

/** The request itself, and what the database says back (which names the page to follow it on). */
async function requestSend(v: Vars, req: Req, m: Inbound, phone: string, rpc: Rpc): Promise<Step> {
  const f = req.f, name = (m.name ?? '').trim() || (v.lastPatient ?? '').split(',')[0].trim()
  const r = req.what === 'ambulance'
    ? await rpc('bot_ambulance_request_json', { p_phone: phone, p_pin: f.pin ?? '', p_name: name, p_kind: f.kind ?? 'emergency', p_address: f.address ?? '', p_need: f.need ?? '', p_lat: f.lat ?? '', p_lng: f.lng ?? '' })
    : req.what === 'medicine'
      ? await rpc('bot_medicine_order_json', { p_phone: phone, p_pin: f.pin ?? '', p_name: name, p_address: f.address ?? '', p_medicines: f.meds ?? '', p_rx_url: f.rx ?? '' })
      : await rpc('bot_insurance_lead_json', { p_phone: phone, p_pin: f.pin ?? '', p_name: name, p_cover: f.cover ?? '', p_members: f.members ?? '', p_call_time: f.time ?? '' })
  const text = str(r?.text)
  if (!text) return failed(v)
  // The area did not read as one: ask for it again, keeping the rest.
  if (r?.ok !== true && !r?.code && /PIN/.test(text) && !f.pinAsked) {
    return asking(v, { ...req, ask: 'pin', f: { ...f, pin: '', pinAsked: '1' } }, pinQuestion(v, text))
  }
  const lastPin = /^\d{6}$/.test(f.pin ?? '') ? f.pin : v.lastPin
  const sent: Step = { session: { state: 'idle', vars: carry({ ...v, ...(lastPin ? { lastPin } : {}) }) }, replies: [{ kind: 'buttons', body: text, buttons: [MENU_BUTTON] }] }
  // 0250: the app, after an order or a request — not after an ambulance call.
  return r?.ok === true && req.what !== 'ambulance' ? invited(sent, phone, rpc) : sent
}

/**
 * One answer in a request. null: they have left it (a menu tap, a greeting,
 * STOP, a clinic's code) and the message is read as any other.
 */
async function requestStep(v: Vars, m: Inbound, phone: string, rpc: Rpc): Promise<Step | null> {
  const req = v.req!, f = { ...req.f }
  const id = m.replyId ?? '', typed = !m.replyId
  const text = typed ? (m.text ?? '').trim() : ''
  const next = (ask: string, reply: Reply) => asking(v, { ...req, ask, f }, reply)
  const send = () => requestSend(v, { ...req, f }, m, phone, rpc)
  const again = (reply: Reply) => asking(v, { ...req, f }, reply)

  if (id && !/^(req:|pin:last$|loc:ask$)/.test(id)) return null
  if (typed && text && (KEYWORDS.has(text.toUpperCase()) || /^(stop|start)$/i.test(text) || CLINIC_CODE.test(text))) return null
  if (id === 'loc:ask') return again({ kind: 'location', body: `${ASK_PIN}\n${OR_LOCATION}` })

  // A shared location answers "where", whichever request is asking.
  const here = m.located !== undefined
  if (here && m.coords) { f.lat = String(m.coords.lat); f.lng = String(m.coords.lng) }
  const area = id === 'pin:last' ? (v.lastPin ?? '') : here ? (m.located ?? '') : ''
  if (area) f.pin = area

  if (req.what === 'ambulance') {
    if (req.ask === 'kind') {
      const k = id.match(/^req:kind:(emergency|scheduled)$/)?.[1]
      if (!k) return requestStart('ambulance', v, f.pin)
      f.kind = k
      return next('where', { kind: 'location', body: AMB_WHERE })
    }
    if (req.ask === 'where') {
      if (area) f.pin = area
      else if (text) {
        // A bare PIN code sent after an address adds to it, not replaces it.
        if (!f.address || !/^\d{6}$/.test(text)) f.address = text.slice(0, 300)
        f.pin = pinOf(text) || f.pin || ''
      }
      // A location whose area we could not name still has its map pin; the PIN code is asked once.
      if (!f.pin) return f.asked ? send() : asking(v, { ...req, f: { ...f, asked: '1' } }, { kind: 'location', body: AMB_PIN })
      // 0247: a booking is not asked "when, from where to where" — the service that takes it calls and asks.
      return send()
    }
    if (req.ask === 'need') { if (text) f.need = text.slice(0, 300); return send() }
  }

  if (req.what === 'medicine') {
    if (req.ask === 'what') {
      if (m.image) f.rx = m.image
      else if (text.length >= 3) f.meds = text.slice(0, 1000)
      else return again({ kind: 'text', body: MED_WHAT })
      return next('address', { kind: 'text', body: (m.image ? '✅ पर्ची मिल गई। / Prescription received.\n\n' : '') + MED_ADDRESS })
    }
    if (req.ask === 'address') {
      if (m.image && !f.rx) { f.rx = m.image; return again({ kind: 'text', body: '✅ पर्ची मिल गई।\n\n' + MED_ADDRESS }) }
      if (text.length < 5) return again({ kind: 'text', body: MED_ADDRESS })
      f.address = text.slice(0, 300)
      f.pin = pinOf(text) || f.pin || ''
      return f.pin ? send() : next('pin', pinQuestion(v))
    }
  }

  if (req.what === 'insurance') {
    if (req.ask === 'cover') {
      const c = id.match(/^req:cover:(.+)$/)?.[1]
      if (!c) return again(INS_COVER)
      f.cover = c
      // 0247: who and when to call are the advisor's to ask on the call. The area last searched is used if known.
      if (!f.pin && /^\d{6}$/.test(v.lastPin ?? '')) f.pin = v.lastPin!
      return f.pin ? send() : next('pin', pinQuestion(v))
    }
    if (req.ask === 'members') {
      if (!text) return again({ kind: 'text', body: INS_MEMBERS })
      f.members = text.slice(0, 200)
      return next('time', INS_TIME)
    }
    if (req.ask === 'time') {
      const at = id.match(/^req:time:(.+)$/)?.[1]
      if (!at && !text) return again(INS_TIME)
      f.time = at ?? text.slice(0, 80)
      return f.pin ? send() : next('pin', pinQuestion(v))
    }
  }

  if (req.ask === 'pin') {
    f.pin = area || text
    if (!f.pin) return again(pinQuestion(v))
    return send()
  }
  return null
}

// ── Lab tests, as in the app (0244) ──
// The lab's own tests and packages with their prices, at the lab or a home
// collection, at a time the lab has open. A lab with no price list is told the
// tests in words.

type Lab = NonNullable<Vars['lab']>

/** What a row of the test menu stands for. A scan is radiology; blood is pathology; "other" may be either. */
const TESTS: Record<string, { kind: string; want: string }> = {
  'test:blood': { kind: 'pathology', want: '' }, 'test:mri': { kind: 'radiology', want: 'MRI' }, 'test:ct': { kind: 'radiology', want: 'CT Scan' },
  'test:xray': { kind: 'radiology', want: 'X-Ray' }, 'test:ultrasound': { kind: 'radiology', want: 'Ultrasound' }, 'test:other': { kind: '', want: '' },
}
const testOf = (id: string): Vars => ({ labKind: TESTS[id]?.kind ?? '', labWant: TESTS[id]?.want ?? '' })
/** The same, from what they typed. */
function testSaid(text: string): Vars {
  const scan = text.match(/\bmri\b|एमआरआई|\bct\b|सीटी|x[- ]?ray|एक्स[- ]?रे|ultra ?sound|अल्ट्रासाउंड|sonograph|सोनोग्राफी|\bscan\b|स्कैन|mammogra|\becho\b|\becg\b|ईसीजी/i)?.[0]
  // What they typed is what the centre is told ("MRI brain").
  if (scan) return { labKind: /echo|ecg|ईसीजी/i.test(scan) ? '' : 'radiology', labWant: text.replace(/\s+/g, ' ').slice(0, 80) }
  return /blood|खून|ब्लड|\bcbc\b|sugar|शुगर|thyroid|थायर|urine|पेशाब|lipid|vitamin|hba1c|\blft\b|\bkft\b/i.test(text) ? { labKind: 'pathology', labWant: '' } : { labKind: '', labWant: '' }
}
const KIND_HI: Record<string, string> = { pathology: 'खून / पेशाब की जांच (पैथोलॉजी)', radiology: 'स्कैन / एक्स-रे (रेडियोलॉजी)' }
const isScan = (lab: Lab) => lab.kind === 'radiology' || lab.kind === 'cardiology' || lab.visit === true

/** The labs near them that do this kind of test. */
async function labList(v: Vars, rpc: Rpc, note?: string): Promise<Step> {
  const kept: Vars = { ...carry(v), code: 'lab_booking', ...labKept(v) }
  const r = await rpc('bot_lab_list_json', { p_pincode: v.pin ?? '', p_kind: v.labKind ?? '' })
  if (!r) return failed(v)
  if (r.ok !== true) return { session: { state: 'ask_pin', vars: kept }, replies: [pinQuestion(v, NO_PLACE)] }
  const pin = str(r.pin), rows = rowsOf(r)
  const what = KIND_HI[v.labKind ?? ''] ?? 'जांच'
  if (!rows.length) {
    return { session: { state: 'idle', vars: { ...kept, pin } }, replies: [{
      kind: 'buttons', body: `${note ? `${note}\n\n` : ''}माफ़ कीजिए, इस एरिया में अभी ${what} के लिए कोई लैब हमारे साथ नहीं है। 🙏\nNo lab for this near you yet.`, buttons: [MENU_BUTTON, PIN_BUTTON],
    }] }
  }
  return { session: { state: 'idle', vars: { ...kept, pin, lastPin: /^\d{6}$/.test(v.pin ?? '') ? v.pin : pin } }, replies: [{
    kind: 'list', header: v.labWant ? `🔬 ${v.labWant}` : '🔬 लैब',
    body: `${note ? `${note}\n\n` : ''}${what} — आपके एरिया की लैब 👇\nकिसके साथ बुक करना है? चुनें।`,
    sectionTitle: 'लैब चुनें',
    rows: [...rows.slice(0, 9).map(({ id, title, description }) => ({ id, title, ...(description ? { description } : {}) })), AREA_ROW],
  }] }
}
const labAsk = (v: Vars, lab: Lab, reply: Reply): Step => ({ session: { state: 'lab', vars: { ...carry(v), lab } }, replies: [reply] })
const LAB_TYPE = 'कौनसे टेस्ट करवाने हैं? नाम लिखकर भेजें — जैसे "CBC, थायरॉइड, शुगर"।\nWhich tests do you need? Type their names.\n\nलैब आपको सही पैकेज और कीमत बताएगी।\nThe lab will tell you the right package and its price.'
const LAB_TYPE_SCAN = (want: string) => `${want ? `*${want}* — ` : ''}शरीर के किस हिस्से का, और डॉक्टर ने क्या लिखा है? लिखकर भेजें — जैसे "${want || 'MRI'} घुटना" या "पेट का अल्ट्रासाउंड"।\nWhich part of the body, and what did the doctor write? Type it.\n\nस्कैन सेंटर पर ही होता है; सेंटर कीमत और तैयारी बताएगा।\nA scan is done at the centre; it will tell you the price and how to prepare.`
const PATHOLOGY_NOTE = 'Blood / pathology tests — the lab will advise the tests or package'
const LAB_ADDRESS = '🏠 सैंपल कहाँ से लेना है? पूरा पता लिखें — मकान नं., गली, लैंडमार्क।\nType the full address for the home collection.'
const rupee = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

type Row = { id: string; title: string; description?: string }
const rowsOf = (r: Record<string, unknown> | null): (Row & { name: string })[] =>
  (Array.isArray(r?.rows) ? r.rows : []).map(x => x as Record<string, unknown>)
    .filter(x => str(x.id) && str(x.title))
    .map(x => ({ id: str(x.id), title: str(x.title), description: str(x.description) || undefined, name: str(x.name) || str(x.title) }))

/** The lab's list, or what matched `query`, as rows to tap. */
async function labItems(v: Vars, lab: Lab, rpc: Rpc, query = ''): Promise<Step> {
  if (!lab.menu) return labAsk(v, { ...lab, ask: 'items' }, { kind: 'text', body: `🔬 *${lab.name}*${lab.offer ? `\n🏷 ${lab.offer}` : ''}\n\n${isScan(lab) ? LAB_TYPE_SCAN(lab.want ?? '') : LAB_TYPE}` })
  const r = await rpc('bot_lab_menu_json', { p_pincode: '', p_selection: lab.biz, p_query: query, p_kind: lab.kind ?? '' })
  const rows = rowsOf(r).filter(x => !lab.items.includes(x.id.slice(6)))
  const chosen = lab.names.length ? `\n\n✅ चुने गए: ${lab.names.join(', ')}` : ''
  if (!rows.length) {
    const body = (query ? `"${query}" इस लैब की सूची में नहीं मिला। दूसरा नाम लिखकर देखें।\nNot on this lab's list — try another name.` : 'इस लैब की सूची में और कुछ नहीं है।') + chosen
    return labAsk(v, { ...lab, ask: lab.items.length ? 'more' : 'items' }, lab.items.length
      ? { kind: 'buttons', body, buttons: [{ id: 'lab:next', title: '✅ आगे बढ़ें' }, MENU_BUTTON] }
      : { kind: 'text', body })
  }
  const more = Number(r?.total ?? 0) > rows.length
  const eg = isScan(lab) ? 'MRI brain' : 'thyroid'
  const cats = Object.fromEntries((Array.isArray(r?.rows) ? r.rows : []).map(x => x as Record<string, unknown>).map(x => [str(x.id), str(x.cat)]))
  return labAsk(v, { ...lab, ask: 'items', shown: Object.fromEntries(rows.map(x => [x.id, x.name])), cats }, {
    kind: 'list', header: lab.name.slice(0, 60),
    body: `🧪 ${isScan(lab) ? 'स्कैन चुनें' : 'टेस्ट या पैकेज चुनें'} 👇${more || !query ? '\nसूची में न दिखे तो नाम लिखकर भेजें — जैसे "' + eg + '"।\nNot in the list? Type the test\'s name.' : ''}${chosen}`,
    sectionTitle: 'टेस्ट चुनें', rows: rows.map(({ id, title, description }) => ({ id, title, ...(description ? { description } : {}) })),
  })
}

/** Lab or home — but a scan is at the centre, so that is not asked. */
const labWhere = (v: Vars, lab: Lab, rpc: Rpc): Step | Promise<Step> => isScan(lab) ? labSlots(v, { ...lab, how: 'lab' }, rpc) : labHow(v, lab)
const labHow = (v: Vars, lab: Lab): Step => labAsk(v, { ...lab, ask: 'how' }, {
  kind: 'buttons', body: `🔬 *${lab.name}*\n${lab.note === PATHOLOGY_NOTE
    ? 'लैब आपको सही टेस्ट / पैकेज और कीमत बताएगी।\nThe lab will advise the right tests or package, and the price.'
    : `🧪 ${lab.names.length ? lab.names.join(', ') : lab.note}`}\n\nसैंपल कहाँ देंगे?\nWhere will the sample be given?`,
  buttons: [{ id: 'lab:how:lab', title: '🏥 लैब पर' }, { id: 'lab:how:home', title: lab.fee > 0 ? `🏠 घर से (+${rupee(lab.fee)})`.slice(0, 20) : '🏠 घर से सैंपल' }],
})

async function labSlots(v: Vars, lab: Lab, rpc: Rpc, note = ''): Promise<Step> {
  const rows = rowsOf(await rpc('bot_lab_slots_json', { p_business: lab.biz }))
  if (!rows.length) {
    return { session: { state: 'idle', vars: carry(v) }, replies: [{ kind: 'buttons', body: `${lab.name} के पास अगले 7 दिन कोई समय खाली नहीं है। कृपया दूसरी लैब चुनें।\nThis lab has no open time in the next 7 days.`, buttons: [MENU_BUTTON] }] }
  }
  return labAsk(v, { ...lab, ask: 'slot' }, {
    kind: 'list', body: `${note ? `${note}\n\n` : ''}🗓 ${lab.how === 'home' ? 'सैंपल लेने कब आएँ?' : isScan(lab) ? 'सेंटर पर कब आएँगे?' : 'लैब पर कब आएँगे?'} समय चुनें 👇`, sectionTitle: 'समय चुनें',
    rows: rows.map(({ id, title, description }) => ({ id, title, ...(description ? { description } : {}) })),
  })
}

const labName = (v: Vars, lab: Lab, note = ''): Step => labAsk(v, { ...lab, ask: 'name' }, v.lastPatient
  ? { kind: 'buttons', body: `${note ? `${note}\n\n` : ''}${ASK_NAME_AGE}`, buttons: [{ id: 'name:last', title: v.lastPatient.slice(0, 20) }] }
  : { kind: 'text', body: `${note ? `${note}\n\n` : ''}${ASK_NAME_AGE}` })

/** A lab picked from the list: its tests to choose from. null if it is not one we can take an order for. */
async function labStart(v: Vars, rpc: Rpc): Promise<Step | null> {
  const r = await rpc('bot_lab_menu_json', { p_pincode: v.pin ?? '', p_selection: v.selection ?? '', p_query: '', p_kind: v.labKind ?? '' })
  if (r?.ok !== true || !str(r.business)) return null
  const lab: Lab = {
    ask: 'items', biz: str(r.business), name: str(r.name), fee: Number(r.home_fee ?? 0), menu: r.has_menu === true, items: [], names: [],
    // 0246: a centre that only does scans is asked about a scan, whatever brought them here.
    ...(v.labKind ? { kind: v.labKind } : r.only_scans === true ? { kind: 'radiology' } : {}), ...(v.labWant ? { want: v.labWant } : {}),
    ...(str(r.offer) ? { offer: str(r.offer) } : {}),
  }
  // 0245: blood tests are mostly packages the lab advises — which test is not asked.
  if (lab.kind === 'pathology') return labHow(v, { ...lab, note: PATHOLOGY_NOTE })
  // 0247: nor which scan or part — the scan chosen is what the centre is told, and it asks the rest.
  if (isScan(lab)) {
    return labSlots(v, { ...lab, how: 'lab', note: lab.want || 'Scan / imaging — the centre will ask which' }, rpc,
      `🔬 *${lab.name}*${lab.want ? ` — ${lab.want}` : ''}${lab.offer ? `\n🏷 ${lab.offer}` : ''}`)
  }
  return labItems(v, lab, rpc)
}

/** One answer in a lab booking. null: they have left it. */
async function labStep(v: Vars, m: Inbound, phone: string, rpc: Rpc): Promise<Step | null> {
  const lab = v.lab!
  const id = m.replyId ?? '', typed = !m.replyId
  const text = typed ? (m.text ?? '').trim() : ''
  if (id && !/^(lab:|name:last$)/.test(id)) return null
  if (typed && (!text || KEYWORDS.has(text.toUpperCase()) || /^(stop|start)$/i.test(text) || CLINIC_CODE.test(text))) return text ? null : labAsk(v, lab, { kind: 'text', body: 'कृपया ऊपर से चुनें या लिखकर भेजें।' })

  // A test tapped, from this list or an earlier one.
  const item = id.match(/^lab:i:([pt]:[0-9a-f-]{36})$/)?.[1]
  if (item && lab.menu) {
    const items = lab.items.includes(item) ? lab.items : [...lab.items, item].slice(0, 12)
    const names = lab.items.includes(item) ? lab.names : [...lab.names, lab.shown?.[id] ?? (m.text ?? 'Test')].slice(0, 12)
    const visit = lab.visit || /^(radiology|cardiology)$/.test(lab.cats?.[id] ?? '')
    return labAsk(v, { ...lab, items, names, ask: 'more', ...(visit ? { visit: true } : {}) }, {
      kind: 'buttons', body: `✅ ${names.join(', ')}\n\nऔर टेस्ट जोड़ने हैं?\nAdd another test?`,
      buttons: [{ id: 'lab:more', title: '➕ और टेस्ट' }, { id: 'lab:next', title: '✅ आगे बढ़ें' }],
    })
  }
  if (id === 'lab:more') return labItems(v, lab, rpc)
  if (id === 'lab:next') return lab.items.length || lab.note ? labWhere(v, lab, rpc) : labItems(v, lab, rpc)

  if (lab.ask === 'items' || lab.ask === 'more') {
    if (!typed) return labItems(v, lab, rpc)
    if (lab.menu) return labItems(v, lab, rpc, text.slice(0, 40))
    if (text.length < 2) return labItems(v, lab, rpc)
    if (/\b(mri|ct|x-?ray|ultra ?sound|scan|echo|ecg)\b|एमआरआई|सीटी|एक्स|स्कैन|अल्ट्रासाउंड/i.test(text)) lab.visit = true   // a scan asked for in words
    return labWhere(v, { ...lab, note: (isScan(lab) && lab.want && !text.toLowerCase().includes(lab.want.toLowerCase()) ? `${lab.want}: ` : '') + text.slice(0, 280) }, rpc)
  }
  const how = id.match(/^lab:how:(lab|home)$/)?.[1] as 'lab' | 'home' | undefined
  if (how) {
    if (how === 'home' && isScan(lab)) return labSlots(v, { ...lab, how: 'lab' }, rpc, 'स्कैन सेंटर पर ही होता है। / A scan is done at the centre.')
    const next = { ...lab, how }
    return how === 'home' ? labAsk(v, { ...next, ask: 'address' }, { kind: 'text', body: LAB_ADDRESS }) : labSlots(v, next, rpc)
  }
  if (lab.ask === 'how') return labHow(v, lab)
  if (lab.ask === 'address') {
    if (text.length < 5) return labAsk(v, lab, { kind: 'text', body: LAB_ADDRESS })
    return labSlots(v, { ...lab, address: text.slice(0, 300) }, rpc)
  }
  const at = id.match(/^lab:s:(\d{9,11})$/)?.[1]
  if (at) return labName(v, { ...lab, slot: at })
  if (lab.ask === 'slot') return labSlots(v, lab, rpc)
  if (lab.ask === 'name') {
    const who = id === 'name:last' ? (v.lastPatient ?? '') : text
    if (who.length < 2 || !lab.slot || !lab.how) return labName(v, lab)
    const r = await rpc('bot_lab_order_json', {
      p_phone: phone, p_business: lab.biz, p_items: lab.items.join(','), p_collection: lab.how, p_slot: lab.slot,
      p_patient_info: who, p_address: lab.address ?? '', p_note: lab.note ?? '', p_kind: lab.kind ?? '',
    })
    const out = str(r?.text)
    if (!out) return failed(v)
    if (r?.ok !== true) {
      // Said in the database's words; a time that has gone is chosen again, a name asked again.
      if (r?.again === 'slot') return labSlots(v, lab, rpc, out)
      if (r?.again === 'name') return labName(v, lab, out)
      if (r?.again === 'how') return labSlots(v, { ...lab, how: 'lab', visit: true }, rpc, out)
      return { session: { state: 'idle', vars: carry(v) }, replies: [{ kind: 'buttons', body: out, buttons: [MENU_BUTTON] }] }
    }
    return invited({ session: { state: 'idle', vars: carry({ ...v, lastPatient: who }) }, replies: [{ kind: 'buttons', body: out, buttons: [MENU_BUTTON] }] }, phone, rpc)
  }
  return null
}

/** Back to where this conversation lives: the clinic's menu on the clinic line, else the main menu. */
const home = (v: Vars, m: Inbound): Step => m.line === 'clinic' && v.clinic && !v.general ? clinicHome(v, v.clinic) : menu(v)

// ── Said in their own words ──

/** Where a matched need goes next. `text` is what the matcher says back. */
function follow(branch: string, code: string, pin: string, text: string, vars: Vars): Step {
  if (branch === 'insurance') return requestStart('insurance', vars, /^\d{6}$/.test(pin) ? pin : '')
  if (code === 'pharmacy') return requestStart('medicine', vars, /^\d{6}$/.test(pin) ? pin : '')
  if (code === 'ambulance') return requestStart('ambulance', vars, /^\d{6}$/.test(pin) ? pin : '')
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
  // 0243: these three are requests, not lists — the area the matcher heard goes with them.
  if (route !== 'confirm') {
    const what = branch === 'insurance' ? 'insurance' : code === 'pharmacy' ? 'medicine' : code === 'ambulance' ? 'ambulance' : ''
    if (what) return requestStart(what, vars, /^\d{6}$/.test(pin) ? pin : '')
  }
  // 0245: a test asked for in words goes to the labs that do that kind.
  if (code === 'lab_booking' && route !== 'confirm') {
    const kept = { ...carry(vars), ...testSaid(text) }
    return /^\d{6}$/.test(pin) ? search({ ...kept, code, pin }, rpc) : askPin(code, kept, out || undefined)
  }
  if (route === 'list' || route === 'info') return results(out, route, { ...carry(vars), code, pin }, rpc)
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
function tapped(id: string, s: Session, m: Inbound): Step | null {
  const v = s.vars
  if (id === 'nav:menu') return home(v, m)
  // All of Sehatsandhi, from a clinic's menu.
  if (id === 'nav:all') return menu({ ...v, general: true })
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
  if (id.startsWith('test:')) return askPin('lab_booking', { ...v, ...testOf(id) })
  return null
}

/**
 * One turn of the conversation. `phone` is the patient's number, digits with
 * country code.
 */
export async function step(s: Session, m: Inbound, phone: string, rpc: Rpc): Promise<Step> {
  const vars = { ...s.vars }
  // "All of Sehatsandhi" lasts the conversation it was asked in.
  if (m.fresh) delete vars.general
  s = { state: s.state, vars }
  let state = s.state
  let text = (m.text ?? '').trim()
  let typed = !m.replyId

  // 0243: an ambulance, medicines, an insurance advisor — asked for as in the app.
  const asks = (m.replyId ?? '').match(/^menu:(ambulance|pharmacy|insurance)$/)?.[1]
  if (asks) return requestStart(asks === 'pharmacy' ? 'medicine' : asks as 'ambulance' | 'insurance', vars)
  if (state === 'req') {
    const r = vars.req ? await requestStep(vars, m, phone, rpc) : null
    if (r) return r
    delete vars.req; state = 'idle'; s = { state, vars }
  }
  // 0245: a lab tapped in the list of labs.
  const lab = (m.replyId ?? '').match(/^lab:b:([0-9a-f-]{36})$/)?.[1]
  if (lab) return (await labStart({ ...vars, selection: lab }, rpc)) ?? menu(vars)
  // 0244: choosing tests at a lab.
  if (state === 'lab') {
    const r = vars.lab ? await labStep(vars, m, phone, rpc) : null
    if (r) return r
    delete vars.lab; state = 'idle'; s = { state, vars }
  }

  if (m.replyId) {
    const id = m.replyId
    // 0227: the area is known — look there at once, and say where; "📍 दूसरा एरिया" changes it.
    // Not for an ambulance or a call back: those act on the area, so it is asked.
    const wanted = /^spec:(?!more2?$)/.test(id) ? id.slice(5)
      : id.startsWith('test:') ? 'lab_booking'
      : id === 'menu:camps' ? id.slice(5) : ''
    if (wanted && vars.lastPin) return search({ ...carry(vars), code: wanted, pin: vars.lastPin, ...(wanted === 'lab_booking' ? testOf(id) : {}) }, rpc, `📍 ${vars.lastPin}`)
    // 0232: the rating button on a booking confirmation, and the stars picked after it.
    const stars = id.match(/^rate:score:([1-5])$/)
    if (stars) return (await rate(stars[1], vars, phone, rpc)) ?? menu(vars)
    const rateAt = id.match(/^rate:(\d{10,})$/)
    if (rateAt) {
      const idle = (body: string): Step => ({ session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'buttons', body, buttons: [MENU_BUTTON] }] })
      if (Date.now() - Number(rateAt[1]) > RATE_BUTTON_MS) return idle(RATE_EXPIRED)
      const ready = await rpc('bot_rating_ready_json', { p_phone: phone })
      if (!ready) return failed(vars)
      // Only after the visit time: before it there is nothing to rate.
      return ready.ready === true ? { session: { state: 'idle', vars: carry(vars) }, replies: [RATE_LIST] } : idle(str(ready.text))
    }
    const t = tapped(id, s, m)
    if (t) return t
    // A clinic's own buttons carry its code, so they work from any earlier message.
    const cm = id.match(/^clinic:(pick|book|optin):(SS-[A-Z0-9]{5})$/)
    if (cm) {
      const [, what, code] = cm
      delete vars.general   // back with a clinic
      if (what === 'pick') {
        const w = await whichClinic(phone, code, '', rpc)
        return w?.chosen ? clinicHome(vars, w.chosen) : menu(vars, QR_UNKNOWN)
      }
      if (what === 'book') return clinicBook(vars, code, rpc)
      // 0143: agreeing to hear from this clinic — asked for, never assumed from a scan.
      const r = await rpc('bot_generic_search_json', { p_type: 'optin', p_filter_value: code, p_pincode: phone })
      const out = str(r?.text)
      if (!out) return failed(vars)
      return { session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'buttons', body: out, buttons: [MENU_BUTTON] }] }
    }
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
    else if (/^(pin|name|sel|slot|loc|clinic):/.test(id)) return home(vars, m)   // a button from a conversation that is over
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

  // 0232: a rating — the answer to a clinic's "how was your visit?" — on
  // either number, before the clinic line works out who they mean.
  if (typed && state === 'idle' && /^[1-5]$/.test(text)) {
    const done = await rate(text, vars, phone, rpc)
    if (done) return done
  }
  if (state === 'ask_review' && typed) {
    state = 'idle'
    // Their words, kept as the review. A tap, a greeting or a number is not one.
    if (text.length >= 3 && !KEYWORDS.has(text.toUpperCase()) && !/^(stop|start|\d+)$/i.test(text) && !CLINIC_CODE.test(text)) {
      const r = await rpc('sehat_rating_add_review', { p_phone: phone, p_text: text })
      if (r?.saved === true) return { session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'buttons', body: str(r.text), buttons: [MENU_BUTTON] }] }
    }
  }

  // 0234: a business asking for its invoice, or a staff member for where to
  // sign in — answered here, in the conversation they opened, and only to a
  // number that is one. Anyone else falls through as if nothing was asked.
  if (typed && state === 'idle') {
    const what = /\binvoices?\b|\breceipt\b|इनवॉइस|इन्वॉइस|रसीद/i.test(text) ? 'invoice'
      : /\b(log ?in|sign ?in|join(ing)?|invite)\b|लॉगिन|लॉग इन|जॉइन/i.test(text) ? 'login' : ''
    if (what) {
      const r = await rpc('bot_business_ask_json', { p_phone: phone, p_what: what })
      if (r?.found === true && str(r.text)) return { session: { state: 'idle', vars: carry(vars) }, replies: [{ kind: 'text', body: str(r.text) }] }
    }
  }

  // 0224: a clinic's code, wherever in the chat it arrives — its QR was scanned.
  const scanned = typed ? text.match(CLINIC_CODE)?.[0].toUpperCase() : undefined
  if (scanned) {
    const w = await whichClinic(phone, scanned, '', rpc)
    return w?.chosen ? clinicHome(vars, w.chosen) : menu(vars, QR_UNKNOWN)
  }

  const greeting = KEYWORDS.has(text.toUpperCase())
  if (m.line === 'clinic' && typed && m.located === undefined && !/^(stop|start)$/i.test(text)) {
    // On the clinic line a greeting starts over, and leaves "all of Sehatsandhi".
    if (greeting) { state = 'idle'; delete vars.general }
    // Not in the middle of a booking: which clinic is this for?
    if (state === 'idle' && (!vars.general || m.replyTo)) {
      const w = await whichClinic(phone, '', m.replyTo ?? '', rpc)
      if (w && !(vars.general && w.by !== 'reply')) {
        if (w.chosen) return clinicHome(vars, w.chosen)
        // Several, and none stands out: stay with the one this conversation is with, unless another has written since.
        if (!m.fresh && vars.clinic && w.clinics[0]?.code === vars.clinic.code) return clinicHome(vars, w.clinics[0])
        if (w.clinics.length > 1) return clinicChoice(vars, w.clinics)
      }
    }
  }

  if (greeting) return m.fresh ? welcome(vars, phone, rpc) : menu(vars)

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
  if (!text) return m.fresh ? welcome(vars, phone, rpc) : menu(vars)
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
  return m.fresh ? welcome(vars, phone, rpc) : menu(vars, NOT_UNDERSTOOD)
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
