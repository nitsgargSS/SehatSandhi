// Sehatsandhi International (0312): the words and rules every portal page
// shares. No Supabase import here on purpose — the static pages that use only
// this file are prerendered for search engines (src/prerender.tsx).

export const INTL_WA_NUMBER = '918708718705'
export const INTL_WA_TEXT = 'Hello Sehatsandhi International, I would like help with treatment in India.'
export const intlWaLink = (text: string = INTL_WA_TEXT) =>
  `https://wa.me/${INTL_WA_NUMBER}?text=${encodeURIComponent(text)}`
export const INTL_EMAIL = 'contact@sehatsandhi.com'

export type CityLevel = 'metro' | 'regional' | 'smaller'
export type Grp = 'routine' | 'major' | 'complex' | 'very_complex'

export const LEVELS: Record<CityLevel, { name: string; short: string; examples: string; why: string }> = {
  metro: {
    name: 'Big metro', short: 'Metro',
    examples: 'Delhi, Gurugram, Mumbai, Bengaluru, Chennai, Hyderabad',
    why: 'The largest specialist centres and case volumes, for complex and rare treatment. Prices, hotels and travel inside the city cost the most.',
  },
  regional: {
    name: 'Regional city', short: 'Regional',
    examples: 'Chandigarh, Mohali, Dehradun, Jaipur, Lucknow, Ludhiana',
    why: 'Strong super-speciality hospitals at lower prices than metros, with easier travel and shorter waits.',
  },
  smaller: {
    name: 'Smaller city', short: 'Smaller city',
    examples: 'Yamunanagar, Ambala, Karnal, Kurukshetra and similar towns',
    why: 'The same routine procedures at the lowest total cost, more personal attention, short waits and calm surroundings.',
  },
}

export const GROUPS: Record<Grp, { name: string; levels: CityLevel[]; why: string; examples: string }> = {
  routine: {
    name: 'Routine, planned', levels: ['smaller', 'regional'],
    examples: 'Cataract, LASIK, dental, hernia, gallbladder, piles, health check-up',
    why: 'These procedures are done every day in good hospitals of every size. A smaller city usually gives the same care at a lower total cost and with a shorter wait.',
  },
  major: {
    name: 'Major but common', levels: ['smaller', 'regional'],
    examples: 'Knee or hip replacement, hysterectomy, IVF, angioplasty',
    why: 'Choose a hospital with full NABH accreditation and its own ICU. Good options exist in smaller and regional cities — compare them side by side.',
  },
  complex: {
    name: 'Complex', levels: ['regional', 'metro'],
    examples: 'Heart bypass, complex spine, brain surgery, major cancer surgery',
    why: 'These need high case volume and specialist teams around the clock. Regional cities and metros have the most experience.',
  },
  very_complex: {
    name: 'Very complex or rare', levels: ['metro'],
    examples: 'Organ transplant, children\'s heart surgery, bone marrow transplant',
    why: 'Only the most specialised centres should do these, and transplants for foreign nationals need government approvals. A big metro is the right choice.',
  },
}

/** The enquiry tracker, in the order a patient goes through it. */
export const STEPS: { key: string; label: string; hint: string }[] = [
  { key: 'new', label: 'Request received', hint: 'Your coordinator will reply on WhatsApp within 24 hours.' },
  { key: 'reports', label: 'Reports with the doctors', hint: 'The hospitals you chose are reviewing your reports.' },
  { key: 'quotes', label: 'Quotes ready', hint: 'Compare the written quotes and choose your hospital.' },
  { key: 'visa', label: 'Visa letter', hint: 'Your hospital issues the e-Medical visa invitation letter.' },
  { key: 'travel', label: 'Travel booked', hint: 'Airport pickup and stay are arranged.' },
  { key: 'arrived', label: 'Arrived in India', hint: 'Your coordinator meets you and takes you to the hospital.' },
  { key: 'discharged', label: 'Discharged', hint: 'You have your discharge summary, reports and fit-to-fly note.' },
  { key: 'followup', label: 'Follow-up at home', hint: 'Online follow-ups with your doctor on the booked dates.' },
]

export const FEE_LINE = 'Includes Sehatsandhi’s service fee.'
export const ESTIMATE_LINE = 'Estimate. Your final quote comes after the doctor reviews your reports.'

export const ESTIMATE_CLAUSES = [
  'The estimate is based on the reports you send. The final quote comes after the doctor examines you in person.',
  'The price can rise if the doctor finds something new: another condition, a complication, extra days, ICU, blood, or a change of implant or room.',
  'The hospital tells you and Sehatsandhi in writing, with the reason, before any extra paid work. Emergencies are the only exception, and the reason is written afterwards.',
  'Without a written medical reason, the final bill stays within 10% of the final quote.',
]

// ── The hospital checklist (plan doc, Checklists A–F) ─────────────────────
export interface CheckItem { key: string; label: string; doc?: boolean; expires?: boolean; optional?: boolean }
export interface CheckGroup { key: string; title: string; note: string; items: CheckItem[] }

export const CHECKLIST: CheckGroup[] = [
  {
    key: 'A', title: 'A. Government licences', note: 'All required. Upload each with its expiry date. An expired licence pauses new enquiries until it is renewed.',
    items: [
      { key: 'A1', label: 'Hospital registration (Clinical Establishments Act / state rules) with bed count', doc: true, expires: true },
      { key: 'A2', label: 'Fire NOC', doc: true, expires: true },
      { key: 'A3', label: 'Building occupancy / completion certificate and structural safety', doc: true },
      { key: 'A4', label: 'Bio-medical waste authorisation and agreement with a treatment facility', doc: true, expires: true },
      { key: 'A5', label: 'Pollution Control Board consents (air and water)', doc: true, expires: true },
      { key: 'A6', label: 'AERB licence for every X-ray, CT, cath lab or C-arm', doc: true, expires: true },
      { key: 'A7', label: 'PC-PNDT registration (if you do ultrasound)', doc: true, expires: true, optional: true },
      { key: 'A8', label: 'Drug licence for the in-house pharmacy', doc: true, expires: true },
      { key: 'A9', label: 'Blood centre licence, or written tie-up with a licensed blood centre', doc: true, expires: true },
      { key: 'A10', label: 'Oxygen / medical gas storage licence (PESO)', doc: true, expires: true },
      { key: 'A11', label: 'Lift licence', doc: true, expires: true, optional: true },
      { key: 'A12', label: 'Registration numbers of every doctor (NMC / state council) and nurse', doc: true },
      { key: 'A13', label: 'Professional indemnity insurance for the hospital and its surgeons', doc: true, expires: true },
      { key: 'A14', label: 'Narcotic drugs licence (for post-surgery pain medicines)', doc: true, expires: true, optional: true },
      { key: 'A15', label: 'GST registration and PAN of the hospital', doc: true },
    ],
  },
  {
    key: 'B', title: 'B. Accreditation and panels', note: 'NABH at some level is required. Panels show the government already inspects and trusts the hospital. These set your star level.',
    items: [
      { key: 'B1', label: 'NABH accreditation certificate (full or entry-level), or proof of application', doc: true, expires: true },
      { key: 'B2', label: 'NABL accreditation of the in-house lab', doc: true, expires: true, optional: true },
      { key: 'B3', label: 'CGHS empanelment', doc: true, optional: true },
      { key: 'B4', label: 'ECHS empanelment', doc: true, optional: true },
      { key: 'B5', label: 'Ayushman Bharat (PM-JAY) / state scheme empanelment', doc: true, optional: true },
      { key: 'B6', label: 'Railways, ESIC or PSU panels', doc: true, optional: true },
      { key: 'B7', label: 'Cashless tie-ups with private insurers / TPAs', optional: true },
      { key: 'B8', label: 'JCI accreditation', doc: true, optional: true },
    ],
  },
  {
    key: 'C', title: 'C. Clinical facilities', note: 'All required. The test: can the hospital handle a complication at 2 AM without sending the patient elsewhere?',
    items: [
      { key: 'C1', label: 'IPD: at least 30 functional beds (50 for multi-speciality), with daily consultant rounds' },
      { key: 'C2', label: 'ICU: at least 5 beds with ventilators, monitors and defibrillator; intensivist or trained ICU doctor; 1 nurse per 2 ICU beds' },
      { key: 'C3', label: 'Duty doctor (RMO) on site 24x7; anaesthetist on call within 30 minutes' },
      { key: 'C4', label: '24x7 emergency with triage, crash cart and an ALS ambulance' },
      { key: 'C5', label: 'Modular OT with HEPA filters (laminar airflow for joint, spine and implant surgery); separate recovery area' },
      { key: 'C6', label: 'CSSD with autoclave logs and sterility indicators' },
      { key: 'C7', label: 'In-house lab, 24x7 for emergency tests' },
      { key: 'C8', label: 'X-ray and ultrasound in-house; CT in-house or tie-up within 15 minutes' },
      { key: 'C9', label: 'In-house pharmacy, 24x7' },
      { key: 'C10', label: 'Blood available within 1 hour' },
      { key: 'C11', label: 'Central oxygen pipeline to ICU, OT and wards, with backup cylinders' },
      { key: 'C12', label: 'Generator and UPS for ICU and OT' },
      { key: 'C13', label: 'Infection control committee, hand-hygiene audits, surgical site infection rate recorded monthly' },
      { key: 'C14', label: 'Electronic records and IPD billing on Sehatsandhi for every international patient' },
    ],
  },
  {
    key: 'D', title: 'D. 4–5 star comfort', note: 'All required. Checked on the video walkthrough.',
    items: [
      { key: 'D1', label: 'At least 4 private rooms for international patients: AC, attached bathroom with western toilet, hot water' },
      { key: 'D2', label: 'Companion bed or sofa-bed in the room; at least 1 deluxe room or suite (2 for 5-star)' },
      { key: 'D3', label: 'Free Wi-Fi, TV, fridge or kettle, wardrobe, charging points by the bed' },
      { key: 'D4', label: 'Nurse call bell at bed and in bathroom; grab rails in bathroom' },
      { key: 'D5', label: 'Clean linen daily, room cleaned twice a day, pest control records' },
      { key: 'D6', label: 'Dietitian plans meals; vegetarian, non-vegetarian and simple continental; Jain and halal on request' },
      { key: 'D7', label: 'RO drinking water; kitchen with FSSAI licence' },
      { key: 'D8', label: 'Lift, ramps, wheelchairs, clean public toilets, parking, CCTV and 24x7 security' },
      { key: 'D9', label: 'Family lounge; at least 1 checked hotel within 2 km for companions' },
    ],
  },
  {
    key: 'E', title: 'E. International patient desk', note: 'All required. One named person owns every international patient from quote to discharge.',
    items: [
      { key: 'E1', label: 'Named English-speaking coordinator on WhatsApp 9 AM–9 PM IST, with a backup' },
      { key: 'E2', label: 'English and Hindi at the desk; interpreter arranged on request' },
      { key: 'E3', label: 'Registered on the Medical and Ayush Visa Portal (e-FRRO); visa letter within 2–3 working days, plus up to 2 attendants', doc: true },
      { key: 'E4', label: 'Reports every foreign in-patient to the FRRO within 24 hours (Immigration and Foreigners Act 2025)' },
      { key: 'E5', label: 'Written quotes: treatment, days, room, included and not included, valid 30 days, sent through Sehatsandhi' },
      { key: 'E6', label: 'Final bill within 10% of the quote unless a written reason is shared first' },
      { key: 'E7', label: 'Consent forms in English, explained by the surgeon' },
      { key: 'E8', label: 'Itemised English bill; international cards and bank transfer; receipts for every payment' },
      { key: 'E9', label: 'English discharge summary, digital copies of all reports and images, fit-to-fly note' },
      { key: 'E10', label: 'Online follow-ups after the patient goes home' },
      { key: 'E11', label: 'A named senior person answers any complaint within 48 hours' },
    ],
  },
  {
    key: 'F', title: 'F. Speciality extras', note: 'Only for the specialities you list. Upload the licence where one applies.',
    items: [
      { key: 'F_ortho', label: 'Joint replacement / spine: laminar-flow OT, C-arm (AERB), daily physiotherapy', optional: true },
      { key: 'F_cardiac', label: 'Heart: cath lab (AERB), cardiac ICU; cardiac surgeon and perfusionist for bypass', doc: true, optional: true },
      { key: 'F_ivf', label: 'IVF: ART clinic and bank registration (ART Act 2021), PC-PNDT, registered embryologist', doc: true, expires: true, optional: true },
      { key: 'F_transplant', label: 'Transplant: THOTA transplant centre registration and authorisation committee', doc: true, expires: true, optional: true },
      { key: 'F_cancer', label: 'Cancer: AERB for radiotherapy; medical, surgical and radiation oncologists', doc: true, optional: true },
      { key: 'F_eye', label: 'Eye: phaco machine, OCT and visual field tests', optional: true },
      { key: 'F_dental', label: 'Dental: Dental Council registration of dentists, sterilisation', doc: true, optional: true },
    ],
  },
]

export const AGREEMENT_VERSION = 'draft-v1-2026-11'
export const AGREEMENT_POINTS = [
  'Joining is free. Sehatsandhi’s service fee is 10% on top of the hospital’s price for every international patient Sehatsandhi brings. It is a business-to-business fee, never paid to or by an individual doctor.',
  'Patients see the hospital’s submitted price plus Sehatsandhi’s fee, and are told the fee is included.',
  'Price promise: the price given to Sehatsandhi equals the hospital’s own international rate.',
  'Every quote and answer to a Sehatsandhi patient goes through Sehatsandhi. For 12 months the hospital does not deal with that patient around Sehatsandhi.',
  'The hospital tells the patient and Sehatsandhi in writing, with the reason, before any extra paid work (emergencies excepted). Without a written medical reason the final bill stays within 10% of the final quote.',
  'Service standards: reply to an enquiry within 24 hours, quote within 48 hours of reports, answer complaints within 48 hours.',
  'The hospital keeps every licence valid. An expired licence pauses new enquiries until it is renewed.',
  'NMC rules: no paid ranking, no testimonials, no before/after photos, no claims of guaranteed results.',
  'Medical care and its outcome are the hospital’s responsibility; Sehatsandhi arranges travel and coordination.',
  'Sehatsandhi may pause or remove a listing that breaks these terms.',
]

export const FAQ: { q: string; a: string }[] = [
  { q: 'What does Sehatsandhi do?', a: 'We help you compare checked hospitals in every city in India, get written quotes, and arrange your travel: airport pickup, stay and local transport. Your coordinator stays with you from the first message until your follow-ups at home.' },
  { q: 'Who chooses the hospital?', a: 'You do. We show every checked hospital that offers your treatment and suggest which size of city usually suits it, but the final decision is always yours. No hospital pays to appear higher.' },
  { q: 'Are the prices final?', a: 'No. Prices on the portal are close estimates from the hospitals, including our service fee. Your final quote comes after the doctor reviews your reports. The hospital must tell you in writing before any extra paid work.' },
  { q: 'Why would a smaller city be a good choice?', a: 'For routine planned procedures — like cataract, dental work or hernia repair — good hospitals in smaller cities do the same procedure every day. The treatment, hotel and food usually cost less, waits are shorter and the attention is more personal. For complex or rare treatment we suggest regional cities or metros.' },
  { q: 'How do you check hospitals?', a: 'A hospital must have in-patient beds and an ICU, every government licence valid, NABH accreditation at some level, and an international patient desk. We check its documents, do a live video walkthrough and sign an agreement before its listing opens. Licences are re-checked when they expire.' },
  { q: 'How do I get a medical visa?', a: 'Once you accept a quote, your hospital issues an invitation letter through the government\'s Medical and Ayush Visa Portal. You then apply online for an e-Medical visa. Up to two family members can come with you on e-Medical Attendant visas. Citizens of Nepal and Bhutan do not need a visa.' },
  { q: 'Can my family come with me?', a: 'Yes, up to two attendants. Most hospitals let one companion stay in your room; food and stay for companions are usually extra and shown in your quote.' },
  { q: 'How do I pay?', a: 'By international card or bank transfer, as written in your quote, with a receipt for every payment. Never pay cash to anyone claiming to represent us.' },
  { q: 'What if something goes wrong?', a: 'Your coordinator is your first contact, any time. Every listed hospital has a senior person who must answer complaints within 48 hours. If you are not satisfied, write to our Grievance Officer at contact@sehatsandhi.com; we acknowledge within 24 hours and resolve within 15 days.' },
  { q: 'Do I need to send reports before travelling?', a: 'Yes. Recent reports let the doctor give a real quote and tell you if treatment in India is right for you. A clear phone photo of each page is enough.' },
  { q: 'Is my medical information safe?', a: 'We share your reports only with the hospitals you choose, and only after you agree. We follow India\'s Digital Personal Data Protection Act, 2023.' },
]

export const TRAVEL = {
  airports: [
    { code: 'DEL', name: 'Delhi (Indira Gandhi International)', note: 'Most international flights. About 4 hours by road to Yamunanagar, 1 hour to Gurugram.' },
    { code: 'IXC', name: 'Chandigarh International', note: 'Flights from the Gulf and Indian cities. About 2 hours by road to Yamunanagar.' },
    { code: 'BOM', name: 'Mumbai (Chhatrapati Shivaji Maharaj International)', note: 'Second largest international airport; connections to every Indian city.' },
    { code: 'ATQ', name: 'Amritsar (Sri Guru Ram Dass Jee International)', note: 'Direct flights from the UK and the Gulf; useful for Punjab.' },
  ],
  countries: [
    { name: 'Nepal and Bhutan', note: 'No visa needed. Carry your passport or citizenship document. Road and rail links to North India.' },
    { name: 'Bangladesh', note: 'e-Medical visa or a medical visa from the Indian mission. Flights to Delhi and Kolkata.' },
    { name: 'Gulf countries', note: 'e-Medical visa. Direct flights to Delhi, Chandigarh and Amritsar.' },
    { name: 'Africa', note: 'e-Medical visa for most countries. Connections through the Gulf to Delhi and Mumbai.' },
    { name: 'NRIs and people of Indian origin (Canada, UK, USA, Australia)', note: 'OCI card holders need no visa. Others use the e-Medical visa.' },
  ],
  tips: [
    'Passport valid at least 6 months beyond your return date.',
    'Bring enough of your regular medicines for the whole trip plus one week.',
    'An international card works in hospitals and hotels. Keep some rupees for small purchases.',
    'Your coordinator can help you get an Indian SIM with your passport and visa.',
    'North India is hot from April to June, wet from July to September, and cold in December and January. October–March is the most comfortable.',
    'Hospitals register your stay with the FRRO. You only show your passport and visa.',
  ],
}

export const PATIENT_CHECKLISTS: { title: string; items: string[] }[] = [
  { title: 'Before you travel', items: [
    'Passport valid at least 6 months beyond your return date',
    'Written quote accepted with your chosen hospital',
    'Hospital\'s visa letter received; e-Medical visa applied for online (attendants: e-Medical Attendant visa, up to 2)',
    'All reports, scans, prescriptions and a list of current medicines (names and doses)',
    'Enough of your regular medicines for the whole trip plus 1 week',
    'Travel insurance; tell your insurer about the planned treatment',
    'Flight details shared with your coordinator for airport pickup',
    'An international card, some rupees, and a phone that works with an Indian SIM or roaming',
  ] },
  { title: 'On arrival', items: [
    'Your driver meets you at the airport',
    'The hospital desk registers you and reports your stay to the FRRO (you only give your passport and visa)',
    'Meet your coordinator; tests and consultation as in your quote',
    'Read and sign consent forms only after the surgeon explains them',
  ] },
  { title: 'At discharge', items: [
    'English discharge summary, all reports and images (digital copies)',
    'Itemised final bill and payment receipts',
    'Fit-to-fly note and the earliest safe flight date',
    'Medicines with written instructions; follow-up dates booked',
  ] },
  { title: 'Back home', items: [
    'Online follow-up on the booked dates',
    'Show the discharge summary to your local doctor',
    'Rate the hospital and the Sehatsandhi service',
  ] },
]

/** Rupees, Indian grouping. */
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

export const CURRENCIES = ['INR', 'USD', 'GBP', 'EUR', 'CAD', 'AUD', 'AED', 'SAR', 'NPR', 'BDT'] as const
export type Currency = typeof CURRENCIES[number]

/** A rupee amount in the visitor's currency, when an admin has set that rate. */
export function inCurrency(n: number, cur: string, fx: Record<string, number>): string | null {
  if (cur === 'INR') return null
  const rate = Number(fx?.[cur])
  if (!rate || rate <= 0) return null
  const v = n / rate
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v)
  } catch { return `${cur} ${Math.round(v).toLocaleString('en')}` }
}

// Small, guarded storage for per-visitor conveniences (currency, shortlist).
export function readStore<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback }
}
export function writeStore(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}
