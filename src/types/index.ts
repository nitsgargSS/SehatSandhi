export type DoctorStatus = 'pending' | 'active' | 'suspended'

export interface Doctor {
  id: string
  name: string
  qualification: string
  reg_number: string
  speciality: string
  clinic_name: string
  address: string
  pin_codes: string[]
  phone: string
  email: string
  consultation_fee: number
  working_hours: string
  photo_url?: string
  status: DoctorStatus
  created_at: string
}

export interface Appointment {
  id: string
  patient_phone: string
  patient_name: string
  patient_age: number
  doctor_id: string
  slot_datetime: string
  status: 'booked' | 'confirmed' | 'completed' | 'cancelled'
  booked_via: string
  created_at: string
}

export interface Payment {
  id: string
  doctor_id: string
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
  { id: 'PHRM', en: 'Pharmacy / Medicine',         hi: 'दवाई' },
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

export const WA_NUMBER = '91XXXXXXXXXX' // replace with real number
export const BASE_LISTING_FEE = 5000    // ₹ per PIN per month
