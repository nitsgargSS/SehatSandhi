import { supabase } from './supabase'
import type { CityLevel, Grp } from './intlContent'
import { GROUPS } from './intlContent'

// Sehatsandhi International (0312). Public reads come from one call,
// sehat_intl_catalogue(), which only returns listed hospitals and only the
// price the patient pays (hospital price + our fee).

export interface Procedure {
  code: string; name: string; speciality: string; grp: Grp
  hospital_days: number | null; india_days: number | null; summary: string | null; reports: string | null
}
export interface Package {
  procedure_code: string; price_min: number; price_max: number
  room_type: string | null; included: string | null; excluded: string | null
  hospital_days: number | null; india_days: number | null; fly_after_days: number | null
  doctor_name: string | null; valid_until: string
}
export interface Hospital {
  id: string; name: string; city: string | null; state: string | null; city_level: CityLevel
  star: '4' | '5' | null; nabh: 'full' | 'entry' | 'applied' | 'none'; jci: boolean
  beds: number | null; icu_beds: number | null; panels: string[]; languages: string[]; specialities: string[]
  about: string | null; photo_url: string | null; nearest_airport: string | null; airport_hours: number | null
  packages: Package[]
}
export interface Catalogue { fee_pct: number; fx: Record<string, number>; procedures: Procedure[]; hospitals: Hospital[] }

let cache: Promise<Catalogue> | null = null
export function loadCatalogue(): Promise<Catalogue> {
  if (!cache) {
    cache = Promise.resolve(supabase.rpc('sehat_intl_catalogue')).then(({ data, error }) => {
      if (error) { cache = null; throw error }
      return data as Catalogue
    })
  }
  return cache
}

export const NABH_LABEL: Record<Hospital['nabh'], string> = {
  full: 'NABH accredited', entry: 'NABH entry-level', applied: 'NABH applied', none: 'No NABH',
}

/** One option on the compare page: a hospital's package for a procedure. */
export interface Option { hospital: Hospital; pkg: Package }

export function optionsFor(cat: Catalogue, code: string): Option[] {
  const out: Option[] = []
  for (const h of cat.hospitals) for (const p of h.packages) if (p.procedure_code === code) out.push({ hospital: h, pkg: p })
  return out
}

/** Does this option sit in a city level suggested for the procedure's group? */
export function isSuggested(proc: Procedure, o: Option) {
  return GROUPS[proc.grp].levels.includes(o.hospital.city_level)
}

/** Treatment + the patient's own stay estimate (nights × per-night budget). */
export function tripTotal(o: Option, proc: Procedure, perNight: number, companions: number) {
  const days = o.pkg.india_days ?? proc.india_days ?? 0
  const hosp = o.pkg.hospital_days ?? proc.hospital_days ?? 0
  // Nights outside hospital for the patient; companions need every night.
  const nights = Math.max(days - hosp, 0) + (companions > 0 ? hosp : 0)
  const stay = nights * Math.max(perNight, 0)
  return { min: o.pkg.price_min + stay, max: o.pkg.price_max + stay, stay, nights, days }
}

export type SortKey = 'price' | 'stay' | 'airport' | 'beds' | 'name'
export function sortOptions(list: Option[], key: SortKey): Option[] {
  const v = (o: Option) => {
    switch (key) {
      case 'price': return o.pkg.price_min
      case 'stay': return o.pkg.india_days ?? 999
      case 'airport': return o.hospital.airport_hours ?? 99
      case 'beds': return -(o.hospital.beds ?? 0)
      default: return 0
    }
  }
  return [...list].sort((a, b) => (key === 'name' ? a.hospital.name.localeCompare(b.hospital.name) : v(a) - v(b)))
}

/** Factual labels only — never "best". */
export function factLabels(list: Option[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  if (list.length < 2) return m
  const add = (o: Option | undefined, l: string) => { if (!o) return; const k = o.hospital.id; m.set(k, [...(m.get(k) ?? []), l]) }
  const by = (f: (o: Option) => number | null) => {
    const withV = list.filter(o => f(o) != null)
    return withV.length ? withV.reduce((a, b) => (f(b)! < f(a)! ? b : a)) : undefined
  }
  add(by(o => o.pkg.price_min), 'Lowest estimate')
  add(by(o => o.pkg.india_days), 'Shortest stay in India')
  add(by(o => o.hospital.airport_hours), 'Closest to an airport')
  return m
}

// ── Patient requests ────────────────────────────────────────────────────────
export async function sendEnquiry(p: Record<string, unknown>): Promise<{ ok: boolean; token?: string | null; error?: string }> {
  const { data, error } = await supabase.rpc('sehat_intl_enquire', { p })
  if (error) return { ok: false, error: error.message }
  return data as { ok: boolean; token?: string | null; error?: string }
}

export interface Tracked {
  name: string; status: string; procedure: string | null; problem: string | null; coordinator: string | null
  created_at: string; updated_at: string; hospitals: string[]; chosen: string | null
}
export async function trackEnquiry(token: string): Promise<Tracked | null> {
  const { data, error } = await supabase.rpc('sehat_intl_track', { p_token: token })
  if (error) throw error
  return (data as Tracked) ?? null
}

// ── Hospital side ───────────────────────────────────────────────────────────
export interface CheckState { ok?: boolean; doc?: string; expires?: string; note?: string }
export interface MyHospital {
  business_id: string; status: 'draft' | 'submitted' | 'reviewing' | 'listed' | 'paused' | 'rejected'
  city_level: CityLevel | null; star: '4' | '5' | null; nabh: Hospital['nabh']; jci: boolean
  beds: number | null; icu_beds: number | null; panels: string[]; languages: string[]; specialities: string[]
  about: string | null; coordinator_name: string | null; coordinator_phone: string | null; coordinator_email: string | null
  nearest_airport: string | null; airport_hours: number | null; checklist: Record<string, CheckState>
  agreement_version: string | null; agreement_signatory: string | null; agreement_accepted_at: string | null
  submitted_at: string | null; docs_checked_at: string | null; video_checked_at: string | null; listed_at: string | null
  admin_note: string | null; updated_at: string
}
export interface MyPackage {
  id: string; procedure_code: string; price_min: number; price_max: number; room_type: string | null
  included: string | null; excluded: string | null; hospital_days: number | null; india_days: number | null
  fly_after_days: number | null; doctor_name: string | null; notes: string | null; valid_until: string; active: boolean; updated_at: string
}

export async function canApply(businessId: string): Promise<boolean> {
  const { data } = await supabase.rpc('sehat_intl_can_apply', { p_business: businessId })
  return !!data
}
export async function loadMine(businessId: string) {
  const [h, k, p] = await Promise.all([
    supabase.from('intl_hospitals').select('*').eq('business_id', businessId).maybeSingle(),
    supabase.from('intl_packages').select('*').eq('business_id', businessId).order('updated_at', { ascending: false }),
    supabase.from('intl_procedures').select('code, name, speciality, grp, hospital_days, india_days, summary, reports').eq('active', true).order('sort'),
  ])
  if (h.error) throw h.error
  if (k.error) throw k.error
  if (p.error) throw p.error
  return { hospital: (h.data as MyHospital | null), packages: (k.data ?? []) as MyPackage[], procedures: (p.data ?? []) as Procedure[] }
}
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }
export async function saveProfile(businessId: string, p: Record<string, unknown>) {
  const { error } = await supabase.rpc('sehat_intl_profile_save', { p_business: businessId, p }); fail(error)
}
export async function submitApplication(businessId: string, signatory: string, version: string) {
  const { error } = await supabase.rpc('sehat_intl_submit', { p_business: businessId, p_signatory: signatory, p_version: version }); fail(error)
}
export async function savePackage(businessId: string, p: Record<string, unknown>) {
  const { error } = await supabase.rpc('sehat_intl_package_save', { p_business: businessId, p }); fail(error)
}
export async function deletePackage(businessId: string, id: string) {
  const { error } = await supabase.rpc('sehat_intl_package_delete', { p_business: businessId, p_id: id }); fail(error)
}
export async function uploadDoc(businessId: string, itemKey: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf'
  const path = `${businessId}/${itemKey}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('intl-docs').upload(path, file, { upsert: false, contentType: file.type || undefined })
  fail(error)
  return path
}
export async function docUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('intl-docs').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}

// ── Admin side ──────────────────────────────────────────────────────────────
export interface AdminEnquiry {
  id: string; token: string; name: string; country: string | null; phone: string | null; email: string | null
  procedure_code: string | null; problem: string | null; urgency: string | null; travel_when: string | null
  companions: number | null; budget: string | null; prefs: Record<string, unknown>; shortlist: string[]
  chosen_hospital: string | null; status: string; coordinator: string | null; admin_note: string | null
  created_at: string; updated_at: string
}
export async function adminLoad() {
  const [h, e, k] = await Promise.all([
    supabase.from('intl_hospitals').select('*, businesses(name, own_city, own_district, own_state, phone, vertical)').order('updated_at', { ascending: false }),
    supabase.from('intl_enquiries').select('*').order('created_at', { ascending: false }).limit(300),
    supabase.from('intl_packages').select('business_id, procedure_code, price_min, price_max, valid_until, active'),
  ])
  if (h.error) throw h.error
  if (e.error) throw e.error
  if (k.error) throw k.error
  return {
    hospitals: (h.data ?? []) as (MyHospital & { businesses: { name: string; own_city: string | null; own_district: string | null; own_state: string | null; phone: string | null; vertical: string } | null })[],
    enquiries: (e.data ?? []) as AdminEnquiry[],
    packages: (k.data ?? []) as (Pick<MyPackage, 'procedure_code' | 'price_min' | 'price_max' | 'valid_until' | 'active'> & { business_id: string })[],
  }
}
export async function adminReview(businessId: string, a: { status: string; star?: string | null; city_level?: string | null; note?: string | null; docs?: boolean | null; video?: boolean | null }) {
  const { error } = await supabase.rpc('sehat_intl_admin_review', {
    p_business: businessId, p_status: a.status, p_star: a.star ?? null, p_city_level: a.city_level ?? null,
    p_note: a.note ?? null, p_docs_checked: a.docs ?? null, p_video_checked: a.video ?? null,
  }); fail(error)
}
export async function adminEnquiry(id: string, status: string, coordinator?: string | null, note?: string | null, chosen?: string | null) {
  const { error } = await supabase.rpc('sehat_intl_admin_enquiry', {
    p_id: id, p_status: status, p_coordinator: coordinator ?? null, p_note: note ?? null, p_chosen: chosen ?? null,
  }); fail(error)
}
export async function adminSettings(fee: number, fx: Record<string, number>) {
  const { error } = await supabase.rpc('sehat_intl_admin_settings', { p_fee: fee, p_fx: fx }); fail(error)
}
