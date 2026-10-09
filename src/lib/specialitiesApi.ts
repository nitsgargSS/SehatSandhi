import { supabase } from './supabase'
import { SPECIALITIES } from '../types'

// A doctor's specialities and what they treat (0221).
//
// One main speciality, up to two more, and any number of sub-specialities —
// the problems themselves: diabetes, thyroid, piles. Patients search by
// problem, and a doctor who has ticked one is found for it beside the
// specialist. Nobody approves these: a doctor says what they practise.

export interface SubSpeciality {
  code: string
  /** The speciality it belongs to. */
  speciality: string
  /** Other specialities whose doctors commonly treat it. */
  also_under: string[]
  name_en: string
  name_hi: string
  sort_order: number
}

/** Two more beside the main one. */
export const MAX_OTHER_SPECIALITIES = 2

/** The specialities a doctor can practise — not the lab, pharmacy or report-signing ones. */
export const DOCTOR_SPECIALITIES = SPECIALITIES.filter(s =>
  !('staffOnly' in s && s.staffOnly) && s.id !== 'LAB' && s.id !== 'PHARMACY')

let cache: Promise<SubSpeciality[]> | null = null

/** The list, read once. Empty where the database does not have it yet (before 0221). */
export function listSubSpecialities(): Promise<SubSpeciality[]> {
  cache ??= Promise.resolve(
    supabase.from('sub_specialities')
      .select('code, speciality, also_under, name_en, name_hi, sort_order')
      .eq('is_active', true).order('sort_order'),
  ).then(({ data, error }) => (error ? [] : (data ?? []) as SubSpeciality[]), () => [])
  return cache
}

/** The sub-specialities a doctor of these specialities would usually treat. */
export function subsFor(all: SubSpeciality[], specialities: string[]): SubSpeciality[] {
  return all.filter(s => specialities.includes(s.speciality) || s.also_under.some(a => specialities.includes(a)))
}

/** "Diabetes (sugar), Thyroid" — for a profile or a card. */
export function subNames(all: SubSpeciality[], codes: string[] | null | undefined, lang: 'en' | 'hi' = 'en'): string[] {
  return (codes ?? []).map(c => all.find(s => s.code === c)).filter((s): s is SubSpeciality => !!s)
    .map(s => (lang === 'hi' ? s.name_hi : s.name_en))
}

/**
 * Registration only: the lists for a doctor just created with a business, sent
 * straight after (0222) because nobody is logged in yet. Never throws — the
 * doctor can set them from the profile screen if this does not take.
 */
export async function setNewDoctorSpecialities(businessId: string, regNumber: string, other: string[], subs: string[]) {
  if (!regNumber.trim() || (!other.length && !subs.length)) return
  await Promise.resolve(supabase.rpc('sehat_set_new_doctor_specialities', {
    p_business: businessId, p_reg_number: regNumber, p_other: other, p_subs: subs,
  })).then(() => undefined, () => undefined)
}
