// Plausible, valid test data for the registration forms.
//
// Used only in sandbox (see src/lib/env.ts). The goal is to fill a form the way
// a real business would, so the flow under test is the real flow: every value
// satisfies the same validation, enum and format rules the app enforces, and
// nothing here is a placeholder that a submit handler would reject.
//
// Two conventions matter downstream:
//
//   • Display names carry a "[TEST]" prefix and a 4-digit run id. The prefix
//     makes generated rows obvious in the admin list and greppable if sandbox
//     data ever turns up somewhere it shouldn't; the run id distinguishes
//     repeated fills.
//   • Emails are sandbox+<run>@sehatsandhi.test. The purge function keys off
//     that exact shape to delete generated auth users, and deliberately does
//     NOT match the seeded sandbox-doctor@ / sandbox-admin@ logins — note the
//     plus versus the hyphen.

import { SPECIALITIES } from '../types'
import { VerticalKey, verticalFor } from '../pages/business/shared'

// ── primitives ───────────────────────────────────────────────────────────────

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]
const int = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1))

/** 4-digit tag tying one fill's values together. */
export const newRunId = (): number => int(1000, 9999)

/**
 * Indian mobile number: 10 digits starting 6-9.
 *
 * doctors.phone has no CHECK constraint, but patients.phone enforces
 * ^91[6-9][0-9]{9}$ — generating a number that satisfies the stricter rule
 * keeps this usable if a form is ever pointed at that table.
 */
export const testPhone = (): string =>
  String(pick([6, 7, 8, 9])) + String(int(100000000, 999999999))

export const testEmail = (run: number): string => `sandbox+${run}@sehatsandhi.test`

/** Comfortably clears the 6-character minimum on the doctor form. */
export const TEST_PASSWORD = 'Sandbox@123'

// ── name pools ───────────────────────────────────────────────────────────────
// Yamunanagar-flavoured, matching the service areas the app actually covers.

const SURNAMES = ['Aggarwal', 'Sharma', 'Verma', 'Gupta', 'Singh', 'Kaur', 'Bansal', 'Chopra', 'Mehra', 'Saini', 'Goyal', 'Arora']
const GIVEN_NAMES = ['Ramesh', 'Priya', 'Anil', 'Sunita', 'Vikram', 'Meena', 'Rajesh', 'Kavita', 'Suresh', 'Neha', 'Deepak', 'Pooja']
const LOCALITIES = ['Model Town', 'Jagadhri Road', 'Civil Lines', 'Sector 17', 'Workshop Road', 'Professor Colony', 'Camp Area', 'Radaur Road']
const STREET_TYPES = ['Main Market', 'Chowk', 'Bazaar', 'Road']

const personName = () => `${pick(GIVEN_NAMES)} ${pick(SURNAMES)}`
const address = () => `${int(1, 299)}, ${pick(LOCALITIES)}, ${pick(STREET_TYPES)}, Yamunanagar, Haryana`

/** Business names that read like the vertical they belong to. */
const BUSINESS_SUFFIX: Record<VerticalKey, string[]> = {
  doctors:   ['Clinic', 'Medical Centre', 'Polyclinic'],
  hospital:  ['Hospital', 'Nursing Home', 'Multispeciality Hospital'],
  pharmacy:  ['Medical Store', 'Pharmacy', 'Chemist'],
  lab:       ['Diagnostics', 'Path Lab', 'Diagnostic Centre'],
  insurance: ['Insurance Services', 'Insurance Advisors'],
  ambulance: ['Ambulance Service', 'Emergency Response'],
}

/** Speciality text for the free-text "Category / speciality" field. */
const CATEGORY_BY_VERTICAL: Record<VerticalKey, string[]> = {
  doctors:   ['General Physician', 'Ophthalmology', 'Paediatrics', 'Orthopaedics', 'Dermatology'],
  hospital:  ['Multispeciality', 'General & Emergency', 'Maternity & Surgical'],
  pharmacy:  ['Retail Pharmacy', 'Generic & Branded Medicines', 'Surgical & Ayurvedic'],
  lab:       ['Pathology', 'Radiology & Pathology', 'Blood & Urine Testing'],
  insurance: ['Health Insurance', 'Family Floater Plans', 'Mediclaim Advisory'],
  ambulance: ['Basic Life Support', 'Patient Transport', 'Emergency Response'],
}

/** Tag a display name so generated rows are unmistakable. */
const tag = (name: string, run: number) => `[TEST] ${name} ${run}`

// ── registration numbers ─────────────────────────────────────────────────────

/**
 * A qualification that makes sense for the speciality.
 *
 * Any value from QUALIFICATIONS would pass validation, but a BHMS neurologist
 * reads as obviously fake and makes the test rows harder to take seriously when
 * scanning the admin list. Dental is BDS, Ayurveda/Homeopathy is BAMS/BHMS,
 * and the rest are allopathic degrees.
 */
function qualificationFor(specialityId: string): string {
  if (specialityId === 'DENT') return 'BDS'
  if (specialityId === 'ALT') return pick(['BAMS', 'BHMS'])
  if (specialityId === 'PHYS') return 'Other'          // physiotherapy: BPT isn't an option
  if (specialityId === 'GEN') return pick(['MBBS', 'MD'])
  // Surgical specialities skew MS/MCh; medical ones MD/DM/DNB.
  if (['ORTH', 'ENT', 'EYE', 'URO'].includes(specialityId)) return pick(['MS', 'MCh', 'DNB'])
  return pick(['MD', 'DNB', 'DM', 'MBBS'])
}

/** Matches the placeholder on the doctor form: DMC/R/2018/45231 */
const medicalRegNumber = () => `DMC/R/20${int(10, 23)}/${int(10000, 99999)}`

/** Matches the business form's placeholder: HR-12345 */
const businessRegNumber = () => `HR-${int(10000, 99999)}`

const drugLicence = () => `DL-HR-${int(10000, 99999)}`
const irdaLicence = () => `IRDA/${int(100000, 999999)}`
const ambulancePermit = () => `HR-02-${int(1000, 9999)}`

// ── form payloads ────────────────────────────────────────────────────────────

export interface BusinessFill {
  form: Record<string, string>
  runId: number
}

/**
 * Business wizard (/business/register).
 *
 * Takes the vertical the tester already chose rather than picking one: whether
 * the flow ends at Razorpay or at the WhatsApp commission path depends on it,
 * so overwriting it would take away control of what is being tested.
 * Pincodes are chosen by the caller from live coverage, not here — see the
 * adapter, which needs the server to recognise them for pricing to be non-zero.
 */
export function generateBusiness(vertical: VerticalKey): BusinessFill {
  const runId = newRunId()
  const v = verticalFor(vertical)
  const owner = personName()
  const businessName = `${pick(SURNAMES)} ${pick(BUSINESS_SUFFIX[vertical] ?? ['Clinic'])}`

  return {
    runId,
    form: {
      business_name: tag(businessName, runId),
      owner_name: v.key === 'doctors' ? `Dr. ${owner}` : owner,
      phone: testPhone(),
      category: pick(CATEGORY_BY_VERTICAL[vertical] ?? ['General']),
      reg_number: businessRegNumber(),
      email: testEmail(runId),
      address: address(),
    },
  }
}

export interface DoctorFill {
  form: {
    name: string; qualification: string; speciality: string; reg_number: string
    clinic_name: string; address: string; consultation_fee: string
    phone: string; email: string; password: string
  }
  runId: number
}

/**
 * Doctor registration (/doctor).
 *
 * speciality and qualification come from the same arrays the <select> options
 * are built from, so the values always match an existing option. working_days,
 * from_time and to_time are left alone — their defaults are already valid, and
 * overwriting them would only make the fill noisier.
 */
export function generateDoctor(): DoctorFill {
  const runId = newRunId()
  const name = personName()
  const speciality = pick(SPECIALITIES).id
  return {
    runId,
    form: {
      name: `[TEST] Dr. ${name} ${runId}`,
      qualification: qualificationFor(speciality),
      speciality,
      reg_number: medicalRegNumber(),
      clinic_name: tag(`${pick(SURNAMES)} ${pick(BUSINESS_SUFFIX.doctors)}`, runId),
      address: address(),
      consultation_fee: String(pick([200, 300, 400, 500, 600])),
      phone: testPhone(),
      email: testEmail(runId),
      password: TEST_PASSWORD,
    },
  }
}

export type PartnerType = 'pharmacy' | 'lab' | 'insurance' | 'ambulance'

export interface PartnerFill {
  form: Record<string, string>
  runId: number
}

/**
 * Partner registration (/partner).
 *
 * The type-specific fields (licence, NABL, IRDA, permit…) are generated even
 * though handleSubmit currently drops every one of them before the insert.
 * That is a pre-existing gap in the form, not something to model here: the
 * fill should exercise the form as written, and it costs nothing to already be
 * correct if the persistence is fixed.
 */
export function generatePartner(type: PartnerType): PartnerFill {
  const runId = newRunId()
  const vertical = type as VerticalKey
  const base: Record<string, string> = {
    business_name: type === 'insurance'
      ? `[TEST] ${personName()} ${runId}`
      : tag(`${pick(SURNAMES)} ${pick(BUSINESS_SUFFIX[vertical] ?? ['Services'])}`, runId),
    phone: testPhone(),
    email: testEmail(runId),
    address: address(),
  }

  const specific: Record<PartnerType, Record<string, string>> = {
    pharmacy: {
      license: drugLicence(),
      delivery: pick(['yes', 'no']),
      hours: pick(['8am-10pm', '9am-9pm', '24 hours']),
      open24: pick(['yes', 'no']),
    },
    lab: {
      license: `LAB-HR-${int(1000, 9999)}`,
      nabl: pick(['yes', 'no']),
      home_collection: pick(['yes', 'no']),
      collection_time: pick(['6am-10am', '7am-11am', '6am-12pm']),
    },
    insurance: {
      irda: irdaLicence(),
      company: pick(['Star Health', 'Niva Bupa', 'HDFC Ergo', 'Care Health', 'ICICI Lombard']),
    },
    ambulance: {
      permit: ambulancePermit(),
      // Must match the <select> option values exactly.
      ambulance_type: pick(['BLS', 'ALS', 'transport']),
      available_24_7: pick(['yes', 'no']),
      response_time: pick(['15', '20', '30']),
    },
  }

  return { runId, form: { ...base, ...specific[type] } }
}
