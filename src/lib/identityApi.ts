// Businesses, practitioners, and who works where.
//
// The three RPCs the registration flows call, plus the reads that back the
// "attach someone who is already here" box. All of them go through SECURITY
// DEFINER functions rather than table writes, because a just-created row is
// 'pending' and therefore invisible to its own creator under the public read
// policy — a plain insert cannot even read back the id it just made.

import { supabase } from './supabase'

export type Vertical = 'clinic' | 'hospital' | 'pharmacy' | 'lab' | 'insurance' | 'ambulance'
// Mirrors business_practitioners_role_check. 'nurse' arrived in 0067 and was
// never added here, which is why the frontend could not tell a nurse from a
// receptionist and showed them neither the record nor the drug chart.
export type AffiliationRole = 'owner' | 'doctor' | 'nurse' | 'receptionist' | 'manager'

export interface PractitionerMatch {
  id: string
  full_name: string
  speciality: string | null
  qualification: string | null
  reg_number: string | null
  smc_id: number | null
  /** How many businesses they already work at. Shown so the user can tell two
   *  people with the same name apart. */
  affiliation_count: number
}

export interface Affiliation {
  id: string
  business_id: string
  practitioner_id: string
  role: AffiliationRole
  is_primary: boolean
  consultation_fee: number
  status: 'pending' | 'active' | 'suspended'
  sort_order: number
}

/** Where a doctor works, for their own dashboard. */
export interface PractitionerPost extends Affiliation {
  business_name: string
  vertical: Vertical
  address: string | null
}

export interface RegisterBusinessInput {
  name: string
  vertical: Vertical
  address?: string
  pinCodes?: string[]
  phone?: string
  email?: string
  regNumber?: string | null
  workingHours?: string | null
  placeId?: string | null
  /**
   * Whether the auto-renewal box was left ticked. Sent at registration because
   * signup runs on the anon key: there is no session yet, so the owner-only
   * sehat_set_auto_renew() cannot record an untick after the fact. Omitted
   * means true, matching the column default.
   */
  autoRenew?: boolean
}

/** A doctor being registered alongside the business, in the same call. */
export interface DoctorToRegister {
  /** Set when the picker matched somebody already on the platform. */
  practitioner_id?: string
  name: string
  speciality?: string
  qualification?: string
  reg_number?: string
  smc_id?: number
  phone?: string
  consultation_fee?: number
  is_primary?: boolean
}

/**
 * Register a business and its doctors in one call.
 *
 * One RPC rather than three, because signup happens BEFORE anybody has logged
 * in: attaching is an owner-only operation, and at this moment the caller owns
 * nothing. Split up, the business and the practitioners were created and the
 * link between them silently was not — a doctor registered, and was then
 * missing from search because search resolves through the affiliation.
 */
export async function registerBusiness(
  input: RegisterBusinessInput,
  doctors: DoctorToRegister[] = [],
): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_register_business_with_doctors', {
    p_name: input.name,
    p_vertical: input.vertical,
    p_address: input.address ?? '',
    p_pin_codes: input.pinCodes ?? [],
    p_phone: input.phone ?? '',
    p_email: input.email ?? '',
    p_reg_number: input.regNumber ?? null,
    p_working_hours: input.workingHours ?? null,
    p_place_id: input.placeId ?? null,
    p_doctors: doctors,
    p_auto_renew: input.autoRenew ?? true,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export interface RegisterPractitionerInput {
  fullName: string
  speciality?: string | null
  qualification?: string | null
  regNumber?: string | null
  smcId?: number | null
  phone?: string
  email?: string
}

/**
 * Create a doctor — or return the one already on file.
 *
 * The server deduplicates on (council, registration number), so two clinics
 * adding the same visiting consultant end up pointing at one person instead of
 * two records that drift apart. Returns the id either way.
 */
export async function registerPractitioner(input: RegisterPractitionerInput): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_register_practitioner', {
    p_full_name: input.fullName,
    p_speciality: input.speciality ?? null,
    p_qualification: input.qualification ?? null,
    p_reg_number: input.regNumber ?? null,
    p_smc_id: input.smcId ?? null,
    p_phone: input.phone ?? '',
    p_email: input.email ?? '',
  })
  if (error) throw new Error(error.message)
  return data as string
}

/**
 * Link a person to a business.
 *
 * Attaching someone previously suspended revives that affiliation rather than
 * failing — "they are back" is the common case, and a doctor returning to a
 * clinic should not become a second record of the same person.
 */
export async function attachPractitioner(args: {
  businessId: string
  practitionerId: string
  role?: AffiliationRole
  isPrimary?: boolean
  consultationFee?: number
}): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_attach_practitioner', {
    p_business_id: args.businessId,
    p_practitioner_id: args.practitionerId,
    p_role: args.role ?? 'doctor',
    p_is_primary: args.isPrimary ?? false,
    p_consultation_fee: args.consultationFee ?? 0,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** Suspends the affiliation. Never deletes it: the appointments made through it
 *  are the record of who a patient actually saw. */
export async function detachPractitioner(businessId: string, practitionerId: string): Promise<void> {
  const { error } = await supabase.rpc('sehat_detach_practitioner', {
    p_business_id: businessId,
    p_practitioner_id: practitionerId,
  })
  if (error) throw new Error(error.message)
}

/** Which post is their main one. At most one per person, enforced in the DB. */
export async function setPrimaryAffiliation(practitionerId: string, businessId: string): Promise<void> {
  const { error } = await supabase.rpc('sehat_set_primary_affiliation', {
    p_practitioner_id: practitionerId,
    p_business_id: businessId,
  })
  if (error) throw new Error(error.message)
}

/**
 * Find a doctor already on the platform, by name or registration number.
 *
 * Deliberately returns no contact details: registration is a public page, so
 * this is reachable by anyone and must not become a way to harvest phone
 * numbers. Enough to recognise someone, and nothing more.
 */
export async function searchPractitioners(query: string): Promise<PractitionerMatch[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const { data, error } = await supabase.rpc('sehat_search_practitioners', { p_query: q })
  if (error) return []
  return (data ?? []) as PractitionerMatch[]
}

/** The roster: everyone attached to this business. */
export async function loadRoster(businessId: string) {
  const { data, error } = await supabase
    .from('business_practitioners')
    .select('*, practitioners(id, full_name, speciality, qualification, reg_number, status)')
    .eq('business_id', businessId)
    .order('sort_order')
  if (error) throw new Error(error.message)
  return data ?? []
}

/** The other direction: everywhere this doctor works, primary first. */
export async function loadPosts(practitionerId: string) {
  const { data, error } = await supabase
    .from('business_practitioners')
    .select('*, businesses(id, name, vertical, address, status)')
    .eq('practitioner_id', practitionerId)
    .order('is_primary', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// ── What this login may see ─────────────────────────────────────────────────
//
// business_practitioners.role has existed since the schema was split, but until
// 0057 nothing read it for access — every signed-in member of staff could open
// every patient's record. It decides something now, and the UI has to agree
// with the database or reception gets a screen full of panes that quietly
// return nothing.
//
// The database is still the authority. This only decides what to draw.

export type ClinicRole = 'owner' | 'doctor' | 'nurse' | 'receptionist' | 'manager'

export interface RoleLookup {
  role: ClinicRole | null
  /**
   * Whether this database HAS a role system at all.
   *
   * False means sehat_caller_role does not exist yet — the database predates
   * 0057. That is not "no access"; before 0057 there were no role checks in the
   * schema and every signed-in member of staff could reach everything. So the
   * honest fallback is the behaviour that was actually in force, not a lockout.
   *
   * This matters because the code ships ahead of the migration. Treating a
   * missing function as null would take Clinic, Bills and Reports away from
   * every real owner the moment this deploys — a worse outage than the one it
   * is being deployed to fix, and one that would look like a permissions bug
   * nobody could explain.
   */
  enforced: boolean
}

/** PostgREST's code for "no such function", and Postgres's for "no such table". */
const MISSING_FUNCTION = 'PGRST202'
const MISSING_TABLE = ['PGRST205', '42P01']

/**
 * The caller's role at this business.
 *
 * Never throws. A failure that is not a missing function is still reported as
 * enforced-with-no-role, which fails closed — an unexpected error should not
 * hand out access.
 */
export async function getMyRole(businessId: string): Promise<RoleLookup> {
  const { data, error } = await supabase.rpc('sehat_caller_role', {
    p_business: businessId,
  })
  if (error) {
    if (error.code === MISSING_FUNCTION) return { role: null, enforced: false }
    return { role: null, enforced: true }
  }
  return { role: (data as ClinicRole) ?? null, enforced: true }
}

/**
 * May this login see medical records, as opposed to the queue, the beds and
 * the money?
 *
 * Fails CLOSED where the rule exists: a moment of a doctor seeing a missing tab
 * is a smaller problem than a moment of a receptionist seeing a consultation
 * recording. Falls back to OPEN only where the database has no rule to enforce,
 * which is the pre-0057 behaviour rather than a hole being punched.
 */
export const isClinicalRole = (r: RoleLookup): boolean =>
  !r.enforced || r.role === 'owner' || r.role === 'doctor' || r.role === 'nurse'

/**
 * May this login WRITE a drug order, a prescription or a discharge summary,
 * and read the business's money? Owner and doctor only.
 *
 * The narrower half of the pair, and it has to exist separately. 0067 added the
 * nurse role and widened sehat_caller_is_clinical to include it — a nurse sees
 * the record and charts a dose — then repointed everything that meant
 * "prescriber" at sehat_caller_may_prescribe, precisely because widening a
 * predicate silently widens everything downstream of it.
 *
 * The frontend never got that second half, so isClinicalRole was left standing
 * in for both and simply omitted nurses. Mirrors sehat_caller_may_prescribe.
 */
export const mayPrescribe = (r: RoleLookup): boolean =>
  !r.enforced || r.role === 'owner' || r.role === 'doctor'

/** May this login act on the business itself — its listing, plan and invoices? */
export const isBusinessRole = (r: RoleLookup): boolean =>
  !r.enforced || r.role === 'owner' || r.role === 'manager'

export interface ModuleAccess {
  /** Bought OPD AND the term has not lapsed. */
  opd: boolean
  /** Bought IPD AND the term has not lapsed. */
  ipd: boolean
}

/**
 * Which clinical systems this business has actually paid for.
 *
 * Reads business_modules, which folds the flag together with the term: a
 * business that stopped paying is not entitled to admit patients this month
 * however its flags read. Defaults to nothing on any failure — a screen a
 * paying customer briefly cannot see is a support call, a screen an unpaying
 * one can see is revenue quietly leaking.
 */
export async function getModuleAccess(businessId: string): Promise<ModuleAccess> {
  const { data, error } = await supabase
    .from('business_modules')
    .select('opd_live, ipd_live')
    .eq('business_id', businessId)
    .maybeSingle()
  if (error || !data) return { opd: false, ipd: false }
  return { opd: Boolean(data.opd_live), ipd: Boolean(data.ipd_live) }
}

/**
 * Does this database have the patient-records schema (0047 onward)?
 *
 * The dashboard ships with Patients, Queue and Beds built, and production may
 * not have the tables under them yet. A tab that opens onto a PostgREST 404
 * looks like a broken product; not drawing it looks like a product that does
 * not have that feature, which is the truth until the migrations run.
 *
 * One probe for the whole stack rather than one per tab: 0047 through 0054
 * apply together, and three round trips to answer one question is worse than
 * the precision is worth. `head` fetches no rows — it is a existence check, not
 * a read.
 */
export async function hasPatientRecords(): Promise<boolean> {
  const { error } = await supabase
    .from('patient_members')
    .select('id', { count: 'exact', head: true })
    .limit(1)
  if (error && MISSING_TABLE.includes(error.code ?? '')) return false
  // Anything else — RLS returning nothing, a network blip — means the table is
  // there. Absence of rows is not absence of schema.
  return true
}
