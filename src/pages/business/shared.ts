// Shared constants for the Sehatsandhi Business pages (design "Warm Care" look).
// Palette + verticals live here so the landing (2a) and onboarding wizard (2b)
// stay in sync. Colors are the exact values from the design mockup.

export const BIZ = {
  green: '#0E9F6E',
  greenDark: '#0b7d57',
  ink: '#14201c',
  cream: '#FBF7F0',
  creamAlt: '#f2ede2',
  border: '#ece5d7',
  inputBorder: '#e2dccf',
  muted: '#5f6b64',
  mutedWarm: '#8a8172',
  chipBg: '#e7f6ef',
  chipText: '#0b7d57',
} as const

export type VerticalKey =
  | 'doctors' | 'hospital' | 'pharmacy' | 'lab' | 'insurance' | 'ambulance'

export interface Vertical {
  key: VerticalKey
  label: string
  sub: string
  color: string
  /** maps to doctors.speciality / qualification for the DB insert */
  dbSpeciality: string
  qualification: string
}

// The six service categories patients can find a business under, matching
// the design's "Who can list" grid and the wizard's step-1 cards.
export const VERTICALS: Vertical[] = [
  { key: 'doctors',   label: 'Doctors / Clinic',           sub: '20 specialities',        color: '#0E9F6E', dbSpeciality: 'GEN',       qualification: 'Clinic' },
  { key: 'hospital',  label: 'Hospital',                   sub: 'Multi-speciality',       color: '#2563EB', dbSpeciality: 'HOSPITAL',  qualification: 'Hospital' },
  { key: 'pharmacy',  label: 'Pharmacy / Medical Store',   sub: 'Medicine delivery',      color: '#DB2777', dbSpeciality: 'PHARMACY',  qualification: 'Pharmacy' },
  { key: 'lab',       label: 'Diagnostic Lab',             sub: 'Tests & sample pickup',  color: '#7C3AED', dbSpeciality: 'LAB',       qualification: 'Diagnostic Lab' },
  { key: 'insurance', label: 'Health Insurance',           sub: 'Plans & agents',         color: '#0891B2', dbSpeciality: 'INSURANCE', qualification: 'IRDA Licensed' },
  { key: 'ambulance', label: 'Ambulance Service',          sub: 'Emergency response',     color: '#DC2626', dbSpeciality: 'AMBULANCE', qualification: 'Ambulance Service' },
]

// The four population tiers, matching supabase pricing_tiers and the landing's
// pricing section. Kept here so the landing renders the same numbers the wizard
// and server price against.
export interface PricingTier {
  tier_number: number
  tier_name: string
  monthly_price: number
  popLabel: string
  blurb: string
  mostPicked?: boolean
}

export const PRICING_TIERS: PricingTier[] = [
  { tier_number: 4, tier_name: 'Village',    monthly_price: 400,  popLabel: 'Population under 15,000',   blurb: 'Low-cost entry to reach a rural pincode near your clinic or store.' },
  { tier_number: 3, tier_name: 'Town',       monthly_price: 1000, popLabel: 'Population 15,000–50,000',  blurb: 'The sweet spot for most clinics — a busy town or large ward.', mostPicked: true },
  { tier_number: 2, tier_name: 'Large town', monthly_price: 2000, popLabel: 'Population 50,000–100,000', blurb: 'A whole small city or dense sub-district in one listing.' },
  { tier_number: 1, tier_name: 'City',       monthly_price: 3000, popLabel: 'Population 100,000+',       blurb: 'Maximum reach in a dense urban pincode. Add premium slots for top placement.' },
]

// Fallback coverage list — used only when Supabase service_areas is empty /
// unconfigured, so the wizard's step 3 is never blank in a fresh dev setup.
// Mirrors the pincode/tier data baked into the design mockup, with real-ish
// population per pincode.
export interface FallbackArea {
  pin_code: string
  area_name: string
  tier_number: number
  tier_name: string
  monthly_price: number
  pop: number
}

export const FALLBACK_AREAS: FallbackArea[] = [
  { pin_code: '135001', area_name: 'Yamunanagar City',   tier_number: 1, tier_name: 'City',       monthly_price: 3000, pop: 210000 },
  { pin_code: '135101', area_name: 'Jagadhri',           tier_number: 1, tier_name: 'City',       monthly_price: 3000, pop: 125000 },
  { pin_code: '135002', area_name: 'Model Town',         tier_number: 2, tier_name: 'Large town', monthly_price: 2000, pop: 85000 },
  { pin_code: '135003', area_name: 'Camp Area',          tier_number: 3, tier_name: 'Town',       monthly_price: 1000, pop: 42000 },
  { pin_code: '135102', area_name: 'Jagadhri Workshop',  tier_number: 3, tier_name: 'Town',       monthly_price: 1000, pop: 38000 },
  { pin_code: '135004', area_name: 'Professor Colony',   tier_number: 3, tier_name: 'Town',       monthly_price: 1000, pop: 28000 },
  { pin_code: '135103', area_name: 'Radaur',             tier_number: 3, tier_name: 'Town',       monthly_price: 1000, pop: 22000 },
  { pin_code: '135106', area_name: 'Saraswati Nagar',    tier_number: 3, tier_name: 'Town',       monthly_price: 1000, pop: 18000 },
  { pin_code: '133201', area_name: 'Bilaspur',           tier_number: 3, tier_name: 'Town',       monthly_price: 1000, pop: 16000 },
  { pin_code: '133204', area_name: 'Mustafabad',         tier_number: 4, tier_name: 'Village',    monthly_price: 400,  pop: 14000 },
  { pin_code: '133203', area_name: 'Sadhaura',           tier_number: 4, tier_name: 'Village',    monthly_price: 400,  pop: 12000 },
  { pin_code: '135133', area_name: 'Chhachhrauli',       tier_number: 4, tier_name: 'Village',    monthly_price: 400,  pop: 13000 },
]

// Approximate residents-per-pincode by tier — fallback only, for real Supabase
// areas whose population column hasn't been backfilled yet.
export const TIER_POP: Record<number, number> = { 1: 150000, 2: 70000, 3: 25000, 4: 12000 }
