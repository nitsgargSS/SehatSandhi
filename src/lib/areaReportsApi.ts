import { supabase } from './supabase'

// Where patients come from, and where the platform has gaps (0111, 0112).
//
// Two readers of the same record. A business sees its own patients by pincode
// beside anonymous search demand for its own specialities; the admin sees every
// area's supply, patients and demand, to decide where to market.

/** One pincode, from a business's point of view. pin_code null = area unknown. */
export interface PatientAreaRow {
  pin_code: string | null
  area_name: string | null
  district: string | null
  state: string | null
  population: number | null
  /** In the business's own district. */
  in_district: boolean | null
  /** Among the pincodes the listing is sold into. */
  covered: boolean | null
  patients: number
  bookings: number
  /** Searches for this business's specialities or vertical, website + bot. */
  searches: number
  /** Of those, searches that found nobody. */
  unmet: number
}

export async function getPatientAreas(businessId: string, days: number): Promise<PatientAreaRow[]> {
  const { data, error } = await supabase.rpc('sehat_business_patient_areas', {
    p_business_id: businessId,
    p_days: days,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as PatientAreaRow[]
}

/** "Jagadhri · 135003", or just the pincode where we have no name for it. */
export function areaLabel(r: { pin_code: string | null; area_name: string | null; district?: string | null }): string {
  if (!r.pin_code) return 'Area not known'
  return r.area_name ? `${r.area_name} · ${r.pin_code}` : r.pin_code
}

/** An area to focus on: people there search for what you offer, few come to you. */
export function isFocusArea(r: PatientAreaRow): boolean {
  return !!r.pin_code && r.searches > 0 && r.patients < r.searches
}

// ── Admin ───────────────────────────────────────────────────────────────────

export type GapScope = 'pincode' | 'district'

export interface AreaGapFilters {
  days: number
  scope: GapScope
  state?: string
  district?: string
  speciality?: string
  vertical?: string
  query?: string
}

export interface AreaGapRow {
  pin_code: string | null
  area_name: string | null
  district: string
  state: string
  pincodes: number
  population: number | null
  /** Covering or located in the area. Covering is inflated by the flat plan. */
  businesses: number
  /** Physically located there — where supply really is. */
  located: number
  clinics: number
  hospitals: number
  labs: number
  pharmacies: number
  ambulances: number
  insurance: number
  doctors: number
  patients: number
  bookings: number
  searches: number
  unmet: number
  gap: string | null
}

export async function getAreaGaps(f: AreaGapFilters): Promise<AreaGapRow[]> {
  const { data, error } = await supabase.rpc('sehat_admin_area_gaps', {
    p_days: f.days,
    p_scope: f.scope,
    p_state: f.state || null,
    p_district: f.district || null,
    p_speciality: f.speciality || null,
    p_vertical: f.vertical || null,
    p_query: f.query || null,
  })
  if (error) throw new Error(error.message)
  // bigint population arrives as a string.
  return ((data ?? []) as AreaGapRow[]).map(r => ({
    ...r,
    population: r.population == null ? null : Number(r.population),
  }))
}
