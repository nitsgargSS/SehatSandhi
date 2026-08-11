// Businesses, practitioners, and who works where.
//
// The three RPCs the registration flows call, plus the reads that back the
// "attach someone who is already here" box. All of them go through SECURITY
// DEFINER functions rather than table writes, because a just-created row is
// 'pending' and therefore invisible to its own creator under the public read
// policy — a plain insert cannot even read back the id it just made.

import { supabase } from './supabase'

export type Vertical = 'clinic' | 'hospital' | 'pharmacy' | 'lab' | 'insurance' | 'ambulance'
export type AffiliationRole = 'owner' | 'doctor' | 'receptionist' | 'manager'

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
