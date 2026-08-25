export type DoctorStatus = 'pending' | 'active' | 'suspended'

/**
 * A listing: the business a patient finds and the entity we bill.
 *
 * Never a person. This used to be one `Doctor` type covering both, which is why
 * a pharmacy had a `qualification` and a clinic had a `speciality` — see
 * migration 0037 for the split.
 */
export interface Business {
  id: string
  name: string
  /** clinic | hospital | pharmacy | lab | insurance | ambulance. Its own column,
   *  not smuggled into a speciality code. */
  vertical: string
  address: string
  pin_codes: string[]
  phone: string
  email: string
  working_hours: string
  photo_url?: string
  /** The BUSINESS's licence. A doctor's medical registration belongs to them and
   *  lives on Practitioner. */
  reg_number?: string | null
  google_place_id?: string | null
  status: DoctorStatus
  created_at: string
  // GST registration of the BUSINESS BEING BILLED — ours lives in tax_settings.
  // Optional: a business that isn't registered simply pays the GST. When set, it
  // is printed on their tax invoice so they can claim it as input credit, and
  // its first two digits decide CGST+SGST versus IGST. Columns added in
  // migration 0007.
  gstin?: string
  gst_legal_name?: string
  state_code?: string
  billing_address?: string
}

/** A person. Exists independently of any business, so one doctor can hold
 *  several posts — typically one full-time and a few visiting. */
export interface Practitioner {
  id: string
  full_name: string
  speciality: string | null
  qualification: string | null
  reg_number: string | null
  smc_id: number | null
  imr_status?: string
  phone?: string | null
  email?: string | null
  photo_url?: string | null
  status: DoctorStatus
  created_at: string
}

/** Who works where, and on what terms. */
export interface BusinessPractitioner {
  id: string
  business_id: string
  practitioner_id: string
  role: 'owner' | 'doctor' | 'receptionist' | 'manager'
  is_primary: boolean
  consultation_fee: number
  status: DoctorStatus
  sort_order: number
}

// Where a business actually operates. It may have several branches; exactly one
// is primary, and that is where any booking that does not name one lands —
// including every booking the WhatsApp bot makes until it starts asking.
// Belongs to the business, not the doctor: a branch is the establishment's.
export interface PracticeLocation {
  id: string
  business_id: string
  name: string
  address?: string | null
  pin_code?: string | null
  landmark?: string | null
  phone?: string | null
  is_primary: boolean
  is_active: boolean
  created_at?: string
}

export interface Appointment {
  id: string
  patient_phone: string
  patient_name: string
  patient_age: number
  business_id: string
  /** Which doctor the patient is seeing. Null when the booking is with the
   *  business itself — a pharmacy order, a lab test. */
  practitioner_id?: string | null
  slot_datetime: string
  // 'no_show' is distinct from 'cancelled': nobody cancelled, the patient just
  // didn't arrive. Conflating them hides the thing worth measuring.
  status: 'booked' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  booked_via: string
  created_at: string
  cancelled_by?: 'patient' | 'clinic' | 'admin' | 'system' | null
  cancel_reason?: string | null
  previous_slot_datetime?: string | null
  reschedule_count?: number | null
  /** Which of the doctor's clinics. Defaults to their primary by trigger. */
  location_id?: string | null
}

export interface Payment {
  id: string
  business_id: string
  amount: number
  type: 'subscription' | 'premium_slot'
  razorpay_payment_id?: string
  status: 'pending' | 'paid' | 'failed'
  created_at: string
}

export const SPECIALITIES = [
  { id: 'GEN',  en: 'General / Family Doctor',   hi: 'सामान्य डॉक्टर' },
  { id: 'SKIN', en: 'Skin (Dermatology)',          hi: 'त्वचा रोग' },
  { id: 'DENT', en: 'Dental',                      hi: 'दंत चिकित्सा' },
  { id: 'EYE',  en: 'Eye (Ophthalmology)',          hi: 'नेत्र रोग' },
  { id: 'PAED', en: 'Child Specialist',             hi: 'बाल रोग' },
  { id: 'GYN',  en: 'Gynaecology / Maternity',     hi: 'स्त्री रोग' },
  { id: 'IVF',  en: 'IVF / Fertility',              hi: 'बांझपन / आईवीएफ' },
  { id: 'ORTH', en: 'Orthopaedics / Bones',        hi: 'हड्डी रोग' },
  { id: 'CARD', en: 'Heart (Cardiology)',           hi: 'हृदय रोग' },
  { id: 'ENT',  en: 'ENT (Ear Nose Throat)',        hi: 'कान नाक गला' },
  { id: 'GAST', en: 'Gastro / Stomach',             hi: 'पेट रोग' },
  { id: 'NEUR', en: 'Neuro / Brain & Spine',       hi: 'मस्तिष्क रोग' },
  { id: 'URO',  en: 'Urology / Kidney',             hi: 'मूत्र रोग' },
  { id: 'ONC',  en: 'Oncology / Cancer',            hi: 'कैंसर' },
  { id: 'PSY',  en: 'Psychiatry / Mental Health',  hi: 'मनोरोग' },
  { id: 'DIAB', en: 'Diabetologist',               hi: 'मधुमेह रोग' },
  { id: 'PHYS', en: 'Physiotherapy',               hi: 'फिजियोथेरेपी' },
  { id: 'ALT',  en: 'Ayurveda / Homeopathy',       hi: 'आयुर्वेद' },
  { id: 'LAB',  en: 'Blood Test / Diagnostics',    hi: 'जांच' },
  // PHARMACY, not PHRM: this id is written to doctors.speciality, and the
  // pricing engine resolves a listing's vertical from that value. A code it
  // does not know is billed as a doctor, so a pharmacy picked here would have
  // been charged monthly instead of commission.
  { id: 'PHARMACY', en: 'Pharmacy / Medicine',     hi: 'दवाई' },
]

export const PIN_CODES = [
  { code: '135001', area: 'Yamuna Nagar' },
  { code: '135002', area: 'Radaur' },
  { code: '135003', area: 'Jagadhri' },
  { code: '135004', area: 'Bilaspur' },
  { code: '135021', area: 'Chhachhrauli' },
  { code: '135051', area: 'Damla' },
  { code: '135052', area: 'Bhud' },
  { code: '135053', area: 'Mustafabad' },
  { code: '135071', area: 'Sadhaura' },
  { code: '135078', area: 'Budhera' },
  { code: '135101', area: 'Shahbad' },
  { code: '135102', area: 'Rupar' },
  { code: '135103', area: 'Jathlana' },
  { code: '135106', area: 'Barara' },
  { code: '135107', area: 'Kalesar' },
  { code: '135130', area: 'Buria' },
  { code: '135133', area: 'Saha' },
  { code: '135134', area: 'Kamnala' },
  { code: '135201', area: 'Naharpur' },
  { code: '135202', area: 'Pratapnagar' },
]

// Digits only, country code, no '+' or spaces — it goes straight into
// `https://wa.me/${WA_NUMBER}` at ~20 call sites, and wa.me rejects a '+'.
export const WA_NUMBER = '917015399355'
// No listing price lives in code. It is pricing_plans.monthly_price (flat plans)
// or pricing_tiers.monthly_price (per-pincode), read at runtime by usePricing —
// a constant here would be one more place to forget when the rate changes.
