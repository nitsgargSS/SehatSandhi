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
  /** 0317: approved photos and videos; the first photo is the cover. */
  cover_path?: string | null
  media?: { kind: 'photo' | 'video' | 'youtube'; path: string | null; youtube_id: string | null; category: string; caption: string | null }[]
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
/** Upload a document: the file goes to the private bucket, then the database
 *  records it (0313) — which checks the path, the expiry and the item. */
export async function uploadDoc(businessId: string, itemKey: string, file: File, expires: string | null): Promise<string> {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf'
  const path = `${businessId}/${itemKey}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('intl-docs').upload(path, file, { upsert: false, contentType: file.type || undefined })
  fail(error)
  const { data, error: e2 } = await supabase.rpc('sehat_intl_doc_add', {
    p_business: businessId, p_item: itemKey, p_path: path, p_expires: expires || null, p_name: file.name.slice(0, 200), p_size: file.size,
  })
  fail(e2)
  return data as string
}
export interface IntlDoc {
  id: string; business_id: string; item_key: string; path: string; file_name: string | null; size_bytes: number | null
  expires: string | null; status: 'pending' | 'verified' | 'rejected' | 'replaced'; reason: string | null
  uploaded_by_name: string | null; uploaded_at: string; reviewed_by_name: string | null; reviewed_at: string | null
}
export interface Missing { key: string; label: string; why: string }
export interface DocEvent { id: number; business_id: string; document_id: string | null; item_key: string | null; action: string; note: string | null; actor_name: string | null; at: string }
export async function loadDocs(businessId: string) {
  const [d, sub, list, ev] = await Promise.all([
    supabase.from('intl_documents').select('*').eq('business_id', businessId).order('uploaded_at', { ascending: false }),
    supabase.rpc('sehat_intl_readiness', { p_business: businessId, p_level: 'submit' }),
    supabase.rpc('sehat_intl_readiness', { p_business: businessId, p_level: 'list' }),
    supabase.from('intl_doc_events').select('*').eq('business_id', businessId).order('at', { ascending: false }).limit(200),
  ])
  if (d.error) throw d.error
  return {
    docs: (d.data ?? []) as IntlDoc[], forSubmit: (sub.data ?? []) as Missing[], forList: (list.data ?? []) as Missing[],
    events: (ev.data ?? []) as DocEvent[],
  }
}
export async function reviewDoc(id: string, ok: boolean, reason?: string) {
  const { error } = await supabase.rpc('sehat_intl_doc_review', { p_doc: id, p_ok: ok, p_reason: reason ?? null }); fail(error)
}

// ── Audit links (admin) ─────────────────────────────────────────────────────
export interface AuditLink {
  id: string; token: string; label: string; business_ids: string[]; expires_at: string; passcode_hash: string | null
  created_by_name: string | null; created_at: string; revoked_at: string | null; last_used_at: string | null
}
export interface AuditLogRow { id: number; link_id: string; action: string; business_id: string | null; document_id: string | null; ip: string | null; user_agent: string | null; at: string }
export async function loadAudit() {
  const [l, g, b] = await Promise.all([
    supabase.from('intl_audit_links').select('*').order('created_at', { ascending: false }),
    supabase.from('intl_audit_log').select('*').order('at', { ascending: false }).limit(500),
    supabase.from('intl_backup_runs').select('*').order('started_at', { ascending: false }).limit(10),
  ])
  if (l.error) throw l.error
  return { links: (l.data ?? []) as AuditLink[], log: (g.data ?? []) as AuditLogRow[], backups: (b.data ?? []) as BackupRun[] }
}
export interface BackupRun { id: number; started_at: string; finished_at: string | null; target: string | null; copied: number; already: number; failed: number; error: string | null }
export async function createAuditLink(label: string, businesses: string[], days: number, passcode: string) {
  const { data, error } = await supabase.rpc('sehat_intl_audit_create', { p_label: label, p_businesses: businesses, p_days: days, p_passcode: passcode || null })
  fail(error); return data as string
}
export async function revokeAuditLink(id: string) {
  const { error } = await supabase.rpc('sehat_intl_audit_revoke', { p_id: id }); fail(error)
}
export async function backupNow(): Promise<{ target: string; copied: number; already: number; failed: number; errors?: string[] }> {
  const { data, error } = await supabase.functions.invoke('intl-docs-backup', { body: {} })
  fail(error); return data
}

// ── The public audit page ───────────────────────────────────────────────────
export async function openAudit(token: string, passcode: string | null) {
  const { data, error } = await supabase.rpc('sehat_intl_audit_open', { p_token: token, p_passcode: passcode })
  fail(error); return data as Record<string, unknown>
}
export async function auditFiles(token: string, passcode: string | null, ids: string[], action: 'view' | 'zip') {
  const { data, error } = await supabase.functions.invoke('intl-audit-file', { body: { token, passcode, ids, action } })
  if (error) throw new Error('This link has expired or been withdrawn, or the passcode is wrong.')
  return (data?.files ?? []) as { id: string; url: string; file_name: string; item_key: string; business_name: string; ext: string }[]
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

// ── Savings: prices abroad vs India (0314) ──────────────────────────────────
export interface PriceRef {
  country: string; level: string | null; procedure_code: string; low: number; high: number
  currency: string; year: number; source: string; note: string | null
}
export interface Savings {
  fx: Record<string, number>; fx_date: string | null
  countries: { code: string; name: string; currency: string }[]
  procedures: { code: string; name: string }[]
  refs: PriceRef[]
}
export async function loadSavings(): Promise<Savings> {
  const { data, error } = await supabase.rpc('sehat_intl_savings')
  if (error) throw error
  return data as Savings
}

// ── Articles (0315) ─────────────────────────────────────────────────────────
export interface ArticleCard {
  slug: string; title: string; summary: string; category: 'planning' | 'treatment' | 'health'
  procedure_code: string | null; read_minutes: number; reviewed_by: string | null; reviewed_at: string | null
  published_at: string | null; featured: boolean; image_url: string | null; updated_at: string
}
export interface Article extends ArticleCard { body: string }
let articlesCache: Promise<ArticleCard[]> | null = null
export function loadArticles(): Promise<ArticleCard[]> {
  if (!articlesCache) {
    articlesCache = Promise.resolve(supabase.rpc('sehat_intl_articles')).then(({ data, error }) => {
      if (error) { articlesCache = null; throw error }
      return (data ?? []) as ArticleCard[]
    })
  }
  return articlesCache
}
export async function loadArticle(slug: string): Promise<Article | null> {
  const { data, error } = await supabase.rpc('sehat_intl_article', { p_slug: slug })
  if (error) throw error
  return (data as Article) ?? null
}

// ── Hospital photos and videos (0317) ───────────────────────────────────────
export const MEDIA_CATEGORIES: Record<string, string> = {
  building: 'Building', rooms: 'Rooms', icu: 'ICU', ot: 'Operation theatre', equipment: 'Equipment',
  food: 'Food', lounge: 'Family lounge', tour: 'Video tour', other: 'Other',
}
export const mediaUrl = (path: string) => supabase.storage.from('intl-media').getPublicUrl(path).data.publicUrl
export interface MediaItem {
  id: string; business_id: string; kind: 'photo' | 'video' | 'youtube'; path: string | null; youtube_id: string | null
  category: string; caption: string | null; sort: number; status: 'pending' | 'approved' | 'rejected'; reason: string | null
  uploaded_at: string; reviewed_by_name: string | null
}
export async function loadMedia(businessId: string): Promise<MediaItem[]> {
  const { data, error } = await supabase.from('intl_media').select('*').eq('business_id', businessId).order('sort').order('uploaded_at')
  if (error) throw error
  return (data ?? []) as MediaItem[]
}
/** Photos are shrunk to at most 1920 px and saved as JPEG, so pages stay
 *  quick on a phone abroad. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That photo could not be opened. Try a JPG or PNG.')); i.src = url })
    if (Math.max(img.width, img.height) < 800) throw new Error(`This photo is too small (${img.width}×${img.height}). Use one at least 800 pixels wide, so it looks sharp.`)
    const k = Math.min(1, 1920 / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const out = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.82))
    return out && out.size < file.size ? out : file
  } finally { URL.revokeObjectURL(url) }
}
export async function uploadMedia(businessId: string, file: File, category: string, caption: string) {
  const video = file.type.startsWith('video/')
  if (!video && !file.type.startsWith('image/')) throw new Error('Choose a photo (JPG, PNG) or a video (MP4).')
  const mb = (file.size / 1024 / 1024).toFixed(1)
  if (video && file.size > 50 * 1024 * 1024) throw new Error(`This video is ${mb} MB; the limit is 50 MB. For a longer tour, put it on YouTube and paste the link.`)
  if (!video && file.size > 15 * 1024 * 1024) throw new Error(`This photo is ${mb} MB; the limit is 15 MB.`)
  const body = video ? file : await shrink(file)
  const ext = video ? (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : (body.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase())
  const path = `${businessId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('intl-media').upload(path, body, { upsert: false, contentType: body.type || file.type })
  fail(error)
  const { error: e2 } = await supabase.rpc('sehat_intl_media_add', { p_business: businessId, p_kind: video ? 'video' : 'photo', p_path: path, p_youtube: null, p_category: category, p_caption: caption })
  if (e2) { await supabase.storage.from('intl-media').remove([path]); fail(e2) }
}
export async function addYoutube(businessId: string, link: string, category: string, caption: string) {
  const { error } = await supabase.rpc('sehat_intl_media_add', { p_business: businessId, p_kind: 'youtube', p_path: null, p_youtube: link, p_category: category, p_caption: caption }); fail(error)
}
export async function editMedia(businessId: string, id: string, category: string, caption: string, sort: number | null) {
  const { error } = await supabase.rpc('sehat_intl_media_edit', { p_business: businessId, p_id: id, p_category: category, p_caption: caption, p_sort: sort }); fail(error)
}
export async function deleteMedia(businessId: string, id: string) {
  const { data, error } = await supabase.rpc('sehat_intl_media_delete', { p_business: businessId, p_id: id }); fail(error)
  if (data) await supabase.storage.from('intl-media').remove([data as string])
}
export async function reviewMedia(id: string, ok: boolean, reason?: string) {
  const { error } = await supabase.rpc('sehat_intl_media_review', { p_id: id, p_ok: ok, p_reason: reason ?? null }); fail(error)
}
