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

// Must match businesses.vertical and vertical_billing.vertical exactly: the
// billing row is looked up by this string, and a spelling that does not match
// silently falls through to the defaults. 'clinic', not 'doctors' — a doctor is
// a person now, and this names the establishment.
export type VerticalKey =
  | 'clinic' | 'hospital' | 'pharmacy' | 'lab' | 'insurance' | 'ambulance'

// How a vertical pays. Clinics, hospitals and labs buy pincodes monthly (see
// PRICING_TIERS below); pharmacies, insurance agents and ambulance services list
// free and pay a percentage of what they bill instead.
export type BillingModel = 'pincode_monthly' | 'commission'

export interface Vertical {
  key: VerticalKey
  label: string
  sub: string
  color: string
  billing: BillingModel
  /** commission plan only — % of billing we take */
  commissionPercent?: number
  /** commission plan only — short phrase for "10% of ___" */
  commissionBasis?: string
  /** commission plan only — the fine print under the headline */
  commissionNote?: string
  /** Partner programme (pharmacy, insurance, ambulance): what joining gets
   *  them, said as a benefit. The commission is not the headline — they join
   *  free during the launch offer, and the rate is one line of fine print. */
  partnerHeadline?: string
  partnerPoints?: string[]
}

/** The partner offer, said the same way on the landing page and at signup.
 *  Production bills these verticals commission-only with no monthly fee
 *  (vertical_billing), so "free to join" is what checkout actually does. */
export const PARTNER_OFFER = {
  badge: 'Free to join · launch offer',
  body: 'Registration is free during our launch — no monthly fee and nothing to pay upfront.',
  later: 'Later, a simple 10% commission will apply only to business that comes to you through Sehatsandhi. We will tell you before it starts.',
}

// The six service categories patients can find a business under, matching
// the design's "Who can list" grid and the wizard's step-1 cards.
// `billing` mirrors the supabase vertical_billing table, which is what the edge
// functions actually price against — this copy is for display and offline dev.
/**
 * Medical qualifications a doctor can hold, for the step 2 dropdown.
 *
 * Split matters downstream: the admin verification panel sends the first group
 * to the NMC's Indian Medical Register and the second to the relevant state
 * Dental or AYUSH council, because the IMR does not list them. Keep the `nmc`
 * flag honest — mis-flagging one sends a reviewer to a registry that will never
 * contain the doctor they are checking.
 */
export const DOCTOR_QUALIFICATIONS: { value: string; label: string; nmc: boolean }[] = [
  { value: 'MBBS', label: 'MBBS', nmc: true },
  { value: 'MD',   label: 'MD',   nmc: true },
  { value: 'MS',   label: 'MS',   nmc: true },
  { value: 'DNB',  label: 'DNB',  nmc: true },
  { value: 'DM',   label: 'DM',   nmc: true },
  { value: 'MCh',  label: 'MCh',  nmc: true },
  { value: 'BDS',  label: 'BDS (Dental)',      nmc: false },
  { value: 'MDS',  label: 'MDS (Dental)',      nmc: false },
  { value: 'BAMS', label: 'BAMS (Ayurveda)',   nmc: false },
  { value: 'BHMS', label: 'BHMS (Homeopathy)', nmc: false },
  { value: 'BUMS', label: 'BUMS (Unani)',      nmc: false },
  { value: 'BNYS', label: 'BNYS (Naturopathy)', nmc: false },
]

export const VERTICALS: Vertical[] = [
  { key: 'clinic',    label: 'Clinic',                     sub: 'One or more doctors',    color: '#0E9F6E', billing: 'pincode_monthly' },
  { key: 'hospital',  label: 'Hospital',                   sub: 'Multi-speciality',       color: '#2563EB', billing: 'pincode_monthly' },
  // 0189: a listing fee like a clinic's, no commission. The PIN codes a
  // pharmacy lists in are the areas it delivers medicine orders to.
  { key: 'pharmacy',  label: 'Pharmacy / Medical Store',   sub: 'Medicine delivery',      color: '#DB2777', billing: 'pincode_monthly' },
  { key: 'lab',       label: 'Diagnostic Lab',             sub: 'Tests & sample pickup',  color: '#7C3AED', billing: 'pincode_monthly' },
  { key: 'insurance', label: 'Health Insurance',           sub: 'Plans & agents',         color: '#0891B2', billing: 'commission', commissionPercent: 10,
    commissionBasis: 'your commission',
    commissionNote: 'Only on policies sold through Sehatsandhi, from your own commission — your rate with the insurer stays exactly as it is.',
    partnerHeadline: 'Leads for local insurance advisors',
    partnerPoints: [
      'Families in your area who are looking for health cover are passed to you as leads.',
      'Visit them at home or at work, explain the plans in person, and close the policy yourself.',
      'No cold calling, and your commission with the insurer stays exactly as it is.',
    ] },
  { key: 'ambulance', label: 'Ambulance Service',          sub: 'Emergency response',     color: '#DC2626', billing: 'commission', commissionPercent: 10,
    commissionBasis: 'non-emergency billing',
    commissionNote: 'Only on scheduled, non-emergency trips booked through Sehatsandhi — emergency calls are always free of any charge from us.',
    partnerHeadline: 'Ambulance requests from your own area',
    partnerPoints: [
      'Patients and families near you reach you through Sehatsandhi the moment they need an ambulance.',
      'Emergencies, hospital transfers, discharges and scheduled trips.',
      'Emergency calls always stay free of any charge from Sehatsandhi.',
    ] },
]

export const verticalFor = (key: VerticalKey): Vertical =>
  VERTICALS.find(v => v.key === key) ?? VERTICALS[0]

export const isCommissionVertical = (key: VerticalKey): boolean =>
  verticalFor(key).billing === 'commission'

/**
 * Does this vertical see patients at a booked time?
 *
 * A pharmacy takes orders, an agent takes calls and an ambulance takes
 * emergencies — none of them run an appointment book, so a schedule of
 * consultation slots is noise on their dashboard rather than a feature.
 */
export const takesAppointments = (key: VerticalKey): boolean =>
  key === 'clinic' || key === 'hospital' || key === 'lab'

/** Does this vertical have doctors working at it? Drives whether registration
 *  offers the "add your doctors" step at all. */
export const hasPractitioners = (key: VerticalKey): boolean =>
  key === 'clinic' || key === 'hospital'


// The four population tiers, matching supabase pricing_tiers and the landing's
// pricing section. Kept here so the landing renders the same numbers the wizard
// and server price against.
export interface PricingTier {
  tier_number: number
  tier_name: string
  monthly_price: number
  popLabel: string
  /** Marketing copy exists only for the local fallback tiers; DB tiers have none. */
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

// FALLBACK_AREAS lived here: eight Yamuna Nagar rows priced at ₹3,000/₹2,000,
// a plan that has not been sold for months. It was only ever reached when the
// database was unreachable, and on that one occasion it showed a visitor a
// district we may not operate in at a price we do not charge. Areas come from
// service_areas now, and an empty list is the honest answer while they load.
// Approximate residents-per-pincode by tier — fallback only, for real Supabase
// areas whose population column hasn't been backfilled yet.
export const TIER_POP: Record<number, number> = { 1: 150000, 2: 70000, 3: 25000, 4: 12000 }
