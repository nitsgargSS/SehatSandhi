import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { activeConfig } from './env'

// Care Partner Program (0331, Phase 1). Partners sign in with a WhatsApp code
// (partner-otp) and everything they do goes through checked functions; their
// phone number comes from their partner login, never from the browser.
// Brief: https://claude.ai/artifact/Wc4MJ5dGZBzQeATsbtyJKj · plan: docs/2026-11-partner-program-plan.md

export type PartnerStatus = 'registered' | 'learning' | 'quiz_passed' | 'fee_paid' | 'active' | 'paused' | 'suspended' | 'terminated'

export interface NextStep { key: string; path: string; en: string; hi: string; done?: number; total?: number }
export interface CareMe {
  signed_in: boolean; phone?: string; registered?: boolean; program_enabled?: boolean
  partner?: { id: string; full_name: string; city: string; state: string; language: 'hi' | 'en'; status: PartnerStatus
              status_reason: string | null; level: string; partner_code: string | null; created_at: string } | null
  next?: NextStep
}
export interface CareModule {
  id: string; sort_order: number; slug: string; title_hi: string; title_en: string; desc_hi: string | null; desc_en: string | null
  youtube_id_hi: string | null; youtube_id_en: string | null; video_seconds: number | null
  pdf_path_hi: string | null; pdf_path_en: string | null; est_minutes: number | null; is_published: boolean; updated_at: string
}
export interface CareProgress {
  module_id: string; video_max_pct: number; video_completed_at: string | null
  doc_opened_at: string | null; doc_read_at: string | null; quiz_passed_at: string | null
}
export interface CareContract {
  id: string; kind: string; version: string; title_hi: string; title_en: string
  pdf_path_hi: string | null; pdf_path_en: string | null; effective_from: string | null; is_current: boolean; created_at: string
}
export interface CareFaq {
  id: string; category: string; sort_order: number; is_active: boolean; keywords_en: string[]; keywords_hi: string[]
  question_en: string; question_hi: string; answer_en: string; answer_hi: string; link_path: string | null
  helpful_yes: number; helpful_no: number
}
export interface AdminPartnerRow {
  id: string; full_name: string; phone: string; email: string | null; city: string; state: string; language: string
  occupation: string | null; status: PartnerStatus; status_reason: string | null; level: string; partner_code: string | null
  created_at: string; modules_done: number; modules_total: number
}

export const STATUS_LABEL: Record<PartnerStatus, { en: string; hi: string }> = {
  registered: { en: 'Registered', hi: 'रजिस्टर्ड' }, learning: { en: 'Learning', hi: 'सीख रहे हैं' },
  quiz_passed: { en: 'Exam passed', hi: 'परीक्षा पास' }, fee_paid: { en: 'Partner ID issued', hi: 'Partner ID जारी' },
  active: { en: 'Active', hi: 'सक्रिय' }, paused: { en: 'Paused', hi: 'रोका गया' },
  suspended: { en: 'Suspended', hi: 'निलंबित' }, terminated: { en: 'Ended', hi: 'समाप्त' },
}

export const CATEGORY_HI: Record<string, string> = {
  'Training & Quiz': 'ट्रेनिंग और क्विज़', 'Fee & ID': 'फ़ीस और ID', 'Rewards & Payouts': 'रिवॉर्ड और भुगतान',
  'Doctors & Leads': 'डॉक्टर और लीड', 'Rules': 'नियम', 'Account & Support': 'खाता और सहायता',
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

// ── Switch and public settings ──────────────────────────────────────────────
let enabledP: Promise<boolean> | null = null
export const partnerProgramEnabled = () => {
  enabledP ??= Promise.resolve(supabase.rpc('sehat_partner_program_enabled')).then(({ data }) => data === true, () => false)
  return enabledP
}
export function usePartnerProgramEnabled(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => { let live = true; partnerProgramEnabled().then(v => { if (live) setOn(v) }); return () => { live = false } }, [])
  return on
}

let settingsP: Promise<Record<string, string>> | null = null
export const careSettings = () => {
  settingsP ??= Promise.resolve(supabase.rpc('sehat_care_settings')).then(({ data }) => (data ?? {}) as Record<string, string>, () => ({}))
  return settingsP
}
/** Fill {{variables}} in FAQ answers and page text from the live settings. */
export const fillVars = (text: string, vars: Record<string, string>) =>
  text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)

// ── Login ───────────────────────────────────────────────────────────────────
const otp = async (body: Record<string, unknown>) => {
  const { url, anon } = activeConfig()
  const r = await fetch(`${url}/functions/v1/partner-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.message ?? j.error ?? 'Something went wrong. Please try again.')
  return j as { ok?: boolean; devCode?: string; retryInSeconds?: number; tokenHash?: string }
}
export const requestPartnerCode = (phone: string) => otp({ action: 'request', phone })
export async function verifyPartnerCode(phone: string, code: string) {
  const r = await otp({ action: 'verify', phone, code })
  // Any other login in this browser (clinic, patient) gives way to the partner's.
  await supabase.auth.signOut().catch(() => {})
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash!, type: 'email' })
  if (error) throw new Error('Could not start your session. Please try again.')
}
export const partnerSignOut = () => supabase.auth.signOut()

export async function careMe(): Promise<CareMe> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { signed_in: false }
  const { data, error } = await supabase.rpc('sehat_care_me')
  return error ? { signed_in: false } : (data as CareMe)
}

export async function registerPartner(p: {
  full_name: string; email?: string; city: string; state: string; date_of_birth: string; occupation?: string
  language: 'hi' | 'en'; is_doctor: boolean; employer_ok: boolean; consent: boolean
}): Promise<CareMe> {
  const { data, error } = await supabase.rpc('sehat_care_register', { p })
  oops(error)
  return data as CareMe
}

// ── Learning ────────────────────────────────────────────────────────────────
export async function careModules(): Promise<CareModule[]> {
  const { data, error } = await supabase.from('care_partner_modules').select('*').order('sort_order')
  oops(error)
  return (data ?? []) as CareModule[]
}
export async function careProgress(): Promise<CareProgress[]> {
  const { data, error } = await supabase.from('care_partner_progress')
    .select('module_id, video_max_pct, video_completed_at, doc_opened_at, doc_read_at, quiz_passed_at')
  oops(error)
  return (data ?? []) as CareProgress[]
}
export async function careStep(moduleId: string, event: 'video' | 'doc_open' | 'doc_read', pct?: number): Promise<CareProgress> {
  const { data, error } = await supabase.rpc('sehat_care_progress', { p_module: moduleId, p_event: event, p_pct: pct ?? null })
  oops(error)
  return data as CareProgress
}
export async function careContracts(): Promise<CareContract[]> {
  const { data, error } = await supabase.from('care_partner_contracts').select('*').order('kind').order('created_at', { ascending: false })
  oops(error)
  return (data ?? []) as CareContract[]
}
/** A short-lived link to a PDF in the private partner-content bucket. */
export async function careFileUrl(path: string, download = false): Promise<string> {
  const { data, error } = await supabase.storage.from('partner-content').createSignedUrl(path, 600, download ? { download: true } : undefined)
  if (error || !data?.signedUrl) throw new Error('Could not open the file. Please try again.')
  return data.signedUrl
}

// ── Help Center ─────────────────────────────────────────────────────────────
export async function careFaq(): Promise<CareFaq[]> {
  const { data, error } = await supabase.from('care_partner_faq').select('*').order('category').order('sort_order')
  oops(error)
  return (data ?? []) as CareFaq[]
}
export async function careFaqSynonyms(): Promise<{ term: string; canonical: string }[]> {
  const { data } = await supabase.from('care_partner_faq_synonyms').select('term, canonical')
  return (data ?? []) as { term: string; canonical: string }[]
}
export const faqHelpful = (id: string, yes: boolean) =>
  supabase.rpc('sehat_care_faq_helpful', { p_id: id, p_yes: yes }).then(() => undefined, () => undefined)

/** Lowercase, strip punctuation, fold Devanagari nukta/chandrabindu, collapse spaces. */
export function normaliseQuery(s: string): string {
  return s.toLowerCase()
    .replace(/़/g, '').replace(/ँ/g, 'ं')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

// Words that carry no meaning in a question, in English, Hindi and Roman Hindi.
const STOP = new Set(('what is the a an to i my me do does how can will of for in on it and or be are you your when why where who which ' +
  'this that with get there today please tell about am was were has have if its any so not no yes ' +
  'क्या है हैं का की के में मैं मेरा मेरी मेरे को से कब कैसे और तो ही ये यह वह था थी हो कोई भी ' +
  'kya hai hain ka ki ke mein mai main mera meri mere ko se kab kaise aur to hi ye yeh woh tha thi ho koi bhi').split(' '))

/** Edit distance, capped: enough to forgive "quize" for "quiz" and "retak" for "retake". */
function closeEnough(a: string, b: string): boolean {
  if (a === b) return true
  const n = Math.min(a.length, b.length)
  if (n < 4) return false
  const allowed = n >= 7 ? 2 : 1
  if (Math.abs(a.length - b.length) > allowed) return false
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length] <= allowed
}

/**
 * Score FAQ entries for a typed question. A keyword (or a synonym of one) must
 * match — exactly, as a phrase, or within a small typo — before anything
 * counts; words of the question text then add a little. Stop words never count,
 * so an unrelated question falls through to the email fallback.
 */
export function searchFaq(query: string, faqs: CareFaq[], synonyms: { term: string; canonical: string }[]): CareFaq[] {
  const q = normaliseQuery(query)
  if (!q) return []
  const words = q.split(' ').filter(w => w && !STOP.has(w))
  const terms = new Set(words)
  for (const s of synonyms) {
    const t = normaliseQuery(s.term)
    if (words.includes(t)) terms.add(normaliseQuery(s.canonical))   // synonyms match exactly; typos are forgiven on keywords
  }
  const list = [...terms]
  return faqs.map(f => {
    let kw = 0
    for (const k of [...f.keywords_en, ...f.keywords_hi, f.id.replace(/_/g, ' ')]) {
      const kn = normaliseQuery(k)
      if (!kn || STOP.has(kn)) continue
      const hit = kn.includes(' ') ? q.includes(kn) : list.some(w => closeEnough(w, kn))
      if (hit) kw += 2 + Math.min(kn.length, 12) / 4
    }
    if (kw === 0) return { f, score: 0 }
    const text = normaliseQuery(`${f.question_en} ${f.question_hi}`).split(' ')
    const extra = list.filter(w => w.length >= 4 && text.some(t => closeEnough(w, t))).length * 0.5
    return { f, score: kw + extra }
  }).filter(x => x.score >= 2).sort((a, b) => b.score - a.score)
    // Only answers close to the best one; a weak second guess is noise.
    .filter((x, _, all) => x.score >= all[0].score * 0.6).slice(0, 3).map(x => x.f)
}

// ── Admin ───────────────────────────────────────────────────────────────────
export async function adminCarePartners(status?: string): Promise<AdminPartnerRow[]> {
  const { data, error } = await supabase.rpc('sehat_admin_care_partners', { p_status: status || null })
  oops(error)
  return (data ?? []) as AdminPartnerRow[]
}
export async function adminCarePartnerStatus(id: string, action: 'paused' | 'suspended' | 'terminated' | 'restore', reason: string) {
  const { error } = await supabase.rpc('sehat_admin_care_partner_status', { p_partner: id, p_action: action, p_reason: reason || null })
  oops(error)
}
export async function adminSaveModule(m: Partial<CareModule>) {
  const { data, error } = await supabase.rpc('sehat_admin_care_module_save', { p: m })
  oops(error)
  return data as string
}
export async function adminSaveFaq(f: Partial<CareFaq>) {
  const { error } = await supabase.rpc('sehat_admin_care_faq_save', { p: f })
  oops(error)
}
export async function adminSaveContract(c: Partial<CareContract>) {
  const { error } = await supabase.rpc('sehat_admin_care_contract_save', { p: c })
  oops(error)
}
export async function adminSaveSettings(s: Record<string, string>) {
  const { error } = await supabase.rpc('sehat_admin_care_settings_save', { p: s })
  oops(error)
  settingsP = null; enabledP = null
}
export async function adminCareSettings(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('sehat_care_settings')
  oops(error)
  return (data ?? {}) as Record<string, string>
}
/** Upload a PDF to the private bucket; returns its path. */
export async function adminUploadPdf(folder: 'modules' | 'contracts', name: string, file: File): Promise<string> {
  if (file.type !== 'application/pdf') throw new Error('Choose a PDF file.')
  if (file.size > 20 * 1024 * 1024) throw new Error('The PDF must be 20 MB or smaller.')
  const path = `${folder}/${name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${Date.now()}.pdf`
  const { error } = await supabase.storage.from('partner-content').upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(error.message)
  return path
}

/** A small CSV reader for the FAQ import: quoted fields, commas and newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', inQ = false
  const t = text.replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inQ) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') inQ = false
      else cell += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some(c => c !== '')) rows.push(row)
  const [head, ...rest] = rows
  return rest.map(r => Object.fromEntries((head ?? []).map((h, i) => [h.trim(), r[i] ?? ''])))
}

// ── Quizzes and the final exam (0332) ───────────────────────────────────────

export interface QuizOption { id: string; text_en: string; text_hi: string }
export interface QuizQuestion { id: string; qtype: 'single' | 'multi' | 'truefalse'; text_en: string; text_hi: string; options: QuizOption[] }
export interface QuizAttempt { attempt_id: string; kind: 'module' | 'final'; module_id: string | null; expires_at: string; questions: QuizQuestion[] }
export interface QuizResult {
  passed: boolean; score_pct: number; correct: number; total: number; pass_mark: number; next_allowed_at: string | null; kind: string
  review: { id: string; text_en: string; text_hi: string; options: QuizOption[]; correct: string[]; chosen: string[]; explain_en: string | null; explain_hi: string | null }[] | null
  revise: { slug: string; title_en: string; title_hi: string }[] | null
}
export type QuizState = Record<string, { wait_until: string | null; open: boolean; passed?: boolean }>
export interface AdminQuestion {
  id: string; module_id: string | null; qtype: 'single' | 'multi' | 'truefalse'; text_en: string; text_hi: string
  options: QuizOption[]; correct: string[]; explain_en: string | null; explain_hi: string | null; is_active: boolean
}

export async function quizStart(moduleId: string | null): Promise<QuizAttempt> {
  const { data, error } = await supabase.rpc('sehat_care_quiz_start', { p_module: moduleId })
  oops(error)
  return data as QuizAttempt
}
export async function quizSubmit(attemptId: string, answers: Record<string, string[]>): Promise<QuizResult> {
  const { data, error } = await supabase.rpc('sehat_care_quiz_submit', { p_attempt: attemptId, p_answers: answers })
  oops(error)
  return data as QuizResult
}
export async function quizState(): Promise<QuizState> {
  const { data, error } = await supabase.rpc('sehat_care_quiz_state')
  oops(error)
  return (data ?? {}) as QuizState
}
export async function adminQuestions(): Promise<AdminQuestion[]> {
  const { data, error } = await supabase.from('care_partner_questions').select('*').order('created_at')
  oops(error)
  return (data ?? []) as AdminQuestion[]
}
export async function adminSaveQuestion(q: Partial<AdminQuestion>) {
  const { data, error } = await supabase.rpc('sehat_admin_care_question_save', { p: q })
  oops(error)
  return data as string
}
export const whenIST = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
