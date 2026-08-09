// Looking a business up in what we already know, so signup is confirming rather
// than typing.
//
// Two registries, and they fill in different halves of the form:
//
//   imr_doctors  — the Indian Medical Register. Name, registration number,
//                  council, year of registration. No address, ever.
//   seed_clinics — clinics from open government data. Name, address, pincode.
//                  No registration number, and no phone number either.
//
// So a doctor searching their own name gets their credentials filled in, and a
// clinic searching its name gets its address. Neither source can do both, which
// is why these are two separate searches rather than one.
//
// Read straight from Postgres with the anon key, not through an edge function:
// the query takes under a millisecond and the function hop around it cost about
// 200ms, which is most of what a person would feel. imr_doctors is public data
// (NMC Act 2019 s.31) and readable by policy; see migration 0030.

import { supabase } from './supabase'

export interface DoctorMatch {
  regNo: string
  name: string
  year: number | null
  council: string
  smcId: number
}

export interface ClinicMatch {
  id: string
  name: string
  address: string | null
  pincode: string | null
  district: string | null
}

/** Below this a search matches thousands of people and helps nobody choose. */
const MIN_CHARS = 3
const LIMIT = 8

/**
 * Split a typed name into terms every result must contain.
 *
 * The register writes names both ways round — registration 27776 is
 * 'Goyal, Swati' and 13-47707 is 'Swati Goyal', two different doctors — and
 * nobody knows which way their own council recorded them. Matching the phrase
 * would find one and tell the other they are not registered. Punctuation is
 * dropped for the same reason: the comma in 'Goyal, Swati' is the register's
 * habit, not part of anyone's name.
 */
function terms(query: string): string[] {
  return query.trim().split(/[\s,.]+/).map(t => t.trim()).filter(t => t.length >= 2).slice(0, 4)
}

/** Digits only, unpadded — councils prefix registration numbers inconsistently. */
export function regCore(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.replace(/^0+/, '') || d
}

/**
 * Find a doctor in the medical register by name.
 *
 * A council narrows it usefully — there are 20,601 Sharmas nationally — but it
 * stays optional, because someone who cannot remember which council registered
 * them should still get an answer.
 */
export async function searchDoctorsByName(
  query: string,
  smcId?: number | null,
): Promise<DoctorMatch[]> {
  const parts = terms(query)
  if (!parts.length || query.trim().length < MIN_CHARS) return []

  let q = supabase
    .from('imr_doctors')
    .select('reg_no, name, year, council, smc_id')
    .limit(LIMIT)
  for (const t of parts) q = q.ilike('name', `%${t}%`)
  if (smcId) q = q.eq('smc_id', smcId)

  const { data, error } = await q
  if (error) return []
  return (data ?? []).map(r => ({
    regNo: r.reg_no, name: r.name, year: r.year,
    council: r.council, smcId: r.smc_id,
  }))
}

/** Find a doctor by registration number. Needs a council to mean anything. */
export async function searchDoctorsByReg(
  regNo: string,
  smcId: number,
): Promise<DoctorMatch[]> {
  const core = regCore(regNo)
  if (!core || !smcId) return []

  const { data, error } = await supabase
    .from('imr_doctors')
    .select('reg_no, name, year, council, smc_id')
    .eq('reg_core', core).eq('smc_id', smcId)
    .limit(LIMIT)
  if (error) return []
  return (data ?? []).map(r => ({
    regNo: r.reg_no, name: r.name, year: r.year,
    council: r.council, smcId: r.smc_id,
  }))
}

/**
 * Find a clinic we already know about, for its address.
 *
 * These come from open government data and nobody has confirmed them, so a match
 * is a suggestion the business corrects, never something we save behind their
 * back. Rejected rows are excluded: a clinic that asked not to be listed should
 * not reappear as a suggestion.
 */
export async function searchClinicsByName(query: string): Promise<ClinicMatch[]> {
  const parts = terms(query)
  if (!parts.length || query.trim().length < MIN_CHARS) return []

  // findable_clinics, not seed_clinics: the table also carries our pipeline
  // status and our notes about businesses that have not agreed to anything, and
  // RLS cannot hide a column. See migration 0035.
  let q = supabase
    .from('findable_clinics')
    .select('id, name, address, pincode, district')
    .limit(LIMIT)
  for (const t of parts) q = q.ilike('name', `%${t}%`)

  const { data, error } = await q
  if (error) return []
  return (data ?? []).map(r => ({
    id: r.id, name: r.name, address: r.address,
    pincode: r.pincode, district: r.district,
  }))
}
