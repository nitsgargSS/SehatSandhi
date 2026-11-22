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
              status_reason: string | null; level: string; partner_code: string | null; created_at: string
              email?: string | null; certified_at?: string | null; valid_until?: string | null; agreement_signed_at?: string | null } | null
  pending_contracts?: number
  renewal?: Renewal
  next?: NextStep
}
/** Yearly renewal (0337): opens renew_window_days before valid_until, closes id_grace_days after it. */
export interface Renewal { open: boolean; opens_on?: string; valid_until?: string; expired?: boolean; last_day?: string; refresher_passed?: boolean }
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
/** 0339: add or correct the partner's email (required; receipts and updates go there). */
export async function setPartnerEmail(email: string): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_care_set_email', { p_email: email })
  oops(error)
  return data as string
}
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
export interface QuizAttempt { attempt_id: string; kind: 'module' | 'final' | 'refresher'; module_id: string | null; expires_at: string; questions: QuizQuestion[] }
export interface QuizResult {
  passed: boolean; score_pct: number; correct: number; total: number; pass_mark: number; next_allowed_at: string | null; kind: string; reactivated?: boolean
  /** 0341: final exam — rules questions answered wrong (the exam needs all of them right). */
  rules_missed?: number | null
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
export async function refresherStart(): Promise<QuizAttempt> {
  const { data, error } = await supabase.rpc('sehat_care_refresher_start')
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

// ── Certification, agreement, verify, tickets (0333) ────────────────────────

export interface FeeOrder { orderId: string; amount: number; currency: string; keyId: string; paymentRowId: string; name: string; phone: string; email: string | null }
export async function partnerFeeOrder(): Promise<FeeOrder> {
  const { url, anon } = activeConfig()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in first.')
  const r = await fetch(`${url}/functions/v1/partner-fee-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${session.access_token}` },
    body: '{}',
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? 'Could not start the payment. Please try again.')
  return j as FeeOrder
}
export interface FeeInvoice { invoice_number: string; invoice_token: string; total: number; date: string; renewal: boolean }
/** Every fee invoice the partner has: the first certification and each yearly renewal, newest first. */
export async function myFeeInvoices(): Promise<FeeInvoice[]> {
  const { data } = await supabase.rpc('sehat_care_my_fee_invoices')
  return (data ?? []) as FeeInvoice[]
}
export async function pendingContracts(): Promise<CareContract[]> {
  const { data, error } = await supabase.rpc('sehat_care_pending_contracts')
  oops(error)
  return (data ?? []) as CareContract[]
}
export async function acceptContracts(code: string) {
  const { data, error } = await supabase.rpc('sehat_care_accept', { p_code: code, p_user_agent: navigator.userAgent })
  oops(error)
  return data as { accepted: number; status: PartnerStatus }
}
export interface VerifiedPartner { partner_code: string; full_name: string; city: string; state: string; status: string; certified_at: string; valid_until: string }
export async function verifyPartner(code: string): Promise<VerifiedPartner | null> {
  const { data, error } = await supabase.rpc('sehat_care_verify', { p_code: code })
  oops(error)
  return (data ?? null) as VerifiedPartner | null
}

export type TicketCategory = 'training' | 'payment' | 'technical' | 'complaint' | 'other'
export const TICKET_CATEGORY: Record<TicketCategory, { en: string; hi: string }> = {
  training: { en: 'Training & quiz', hi: 'ट्रेनिंग और क्विज़' }, payment: { en: 'Payment', hi: 'भुगतान' },
  technical: { en: 'Technical problem', hi: 'तकनीकी समस्या' }, complaint: { en: 'Complaint', hi: 'शिकायत' }, other: { en: 'Something else', hi: 'कुछ और' },
}
export interface CareTicket { id: string; ticket_no: string; category: TicketCategory; subject: string; status: 'open' | 'answered' | 'closed'; priority: string; created_at: string; updated_at: string }
export interface TicketMessage { id: number; ticket_id: string; author: 'partner' | 'admin'; author_name: string | null; body: string; created_at: string }
export interface AdminTicketRow extends CareTicket { partner_id: string; partner_name: string; partner_code: string | null; partner_phone: string; last_author: string; messages: number }

export async function myTickets(): Promise<CareTicket[]> {
  const { data, error } = await supabase.from('care_partner_tickets').select('*').order('updated_at', { ascending: false })
  oops(error)
  return (data ?? []) as CareTicket[]
}
export async function ticketMessages(ticketId: string): Promise<TicketMessage[]> {
  const { data, error } = await supabase.from('care_partner_ticket_messages').select('*').eq('ticket_id', ticketId).order('created_at')
  oops(error)
  return (data ?? []) as TicketMessage[]
}
export async function createTicket(category: TicketCategory, subject: string, body: string) {
  const { data, error } = await supabase.rpc('sehat_care_ticket_create', { p_category: category, p_subject: subject, p_body: body })
  oops(error)
  return data as string
}
export async function replyTicket(ticketId: string, body: string, close = false) {
  const { error } = await supabase.rpc('sehat_care_ticket_reply', { p_ticket: ticketId, p_body: body, p_close: close })
  oops(error)
}
export async function adminTickets(status?: string): Promise<AdminTicketRow[]> {
  const { data, error } = await supabase.rpc('sehat_admin_care_tickets', { p_status: status || null })
  oops(error)
  return (data ?? []) as AdminTicketRow[]
}

// ── Attribution (0334) ──────────────────────────────────────────────────────

export interface CareLead { id: string; doctor_name: string | null; phone_last2: string | null; locked_until: string; status: 'locked' | 'matched' | 'confirmed' | 'declined' | 'expired' | 'released'; business_name: string | null; created_at: string }
export interface CareLeads { cap: number; open: number; leads: CareLead[]; businesses: { name: string; city: string | null; since: string | null; paying: boolean
  /** 0340: where the business's plan stands, so the partner knows whom to follow up. */
  plan?: 'not_paid' | 'trial' | 'yearly' | 'ended'; until?: string | null; months?: number | null }[] }
export type Referral = { state: 'none' } | { state: 'pending' | 'confirmed'; first_name: string; city: string; partner_code: string }

export async function myLeads(): Promise<CareLeads> {
  const { data, error } = await supabase.rpc('sehat_care_leads')
  oops(error)
  return data as CareLeads
}
export async function addLead(name: string, phone: string) {
  const { data, error } = await supabase.rpc('sehat_care_lead_add', { p_name: name, p_phone: phone })
  oops(error)
  return data as { id: string; open: number; cap: number }
}
export async function releaseLead(id: string) {
  const { error } = await supabase.rpc('sehat_care_lead_release', { p_lead: id })
  oops(error)
}
/** First name and city of an active partner, for the sign-up field. null if not valid. */
export async function lookupPartner(code: string): Promise<{ first_name: string; city: string; partner_code: string } | null> {
  const { data } = await supabase.rpc('sehat_care_partner_lookup', { p_code: code })
  return (data ?? null) as { first_name: string; city: string; partner_code: string } | null
}
/** The business's referral state. Never throws: a database without 0334 answers 'none'. */
export async function businessReferral(businessId: string): Promise<Referral> {
  const { data, error } = await supabase.rpc('sehat_care_referral', { p_business: businessId })
  return error || !data ? { state: 'none' } : (data as Referral)
}
export async function answerReferral(businessId: string, yes: boolean): Promise<Referral> {
  const { data, error } = await supabase.rpc('sehat_care_referral_answer', { p_business: businessId, p_yes: yes })
  oops(error)
  return data as Referral
}
export async function attributeByCode(businessId: string, code: string): Promise<Referral> {
  const { data, error } = await supabase.rpc('sehat_care_attribute_by_code', { p_business: businessId, p_code: code })
  oops(error)
  return data as Referral
}
export async function reportPartner(businessId: string, reason: string) {
  const { error } = await supabase.rpc('sehat_care_report_partner', { p_business: businessId, p_reason: reason })
  oops(error)
}
export interface AdminReport { id: string; business_name: string; business_phone: string; partner_name: string; partner_code: string; partner_status: string; reason: string; status: string; admin_note: string | null; created_at: string }
export async function adminReports(status = 'open'): Promise<AdminReport[]> {
  const { data, error } = await supabase.rpc('sehat_admin_care_reports', { p_status: status === 'all' ? null : status })
  oops(error)
  return (data ?? []) as AdminReport[]
}
export async function adminCloseReport(id: string, note: string) {
  const { error } = await supabase.rpc('sehat_admin_care_report_close', { p_report: id, p_note: note })
  oops(error)
}
export async function adminClaim(businessId: string, partnerCode: string) {
  const { error } = await supabase.rpc('sehat_admin_care_claim', { p_business: businessId, p_partner_code: partnerCode })
  oops(error)
}

// ── Rewards, KYC and payouts (0335) ─────────────────────────────────────────

export interface MyMoney {
  level: 'associate' | 'senior' | 'elite'; kyc_status: 'not_started' | 'submitted' | 'verified' | 'rejected'
  pan_last4: string | null; bank_last4: string | null; status_reason: string | null; min_payout: number
  totals: { pending: number; approved: number; paid: number }
  rewards: { id: string; business: string | null; type: 'start' | 'renewal' | 'clawback'; base: number; rate: number; amount: number; status: string; approve_after: string; created_at: string; note: string | null; payout_month: string | null }[]
  statements: { month: string; gross: number; tds: number | null; net: number | null; status: string; paid_on: string | null; reference: string | null }[]
}
export async function myMoney(): Promise<MyMoney | null> {
  const { data, error } = await supabase.rpc('sehat_care_my_money')
  oops(error)
  return (data ?? null) as MyMoney | null
}
export async function submitKyc(pan: string, account: string, ifsc: string, holder: string) {
  const { error } = await supabase.rpc('sehat_care_kyc_submit', { p_pan: pan, p_account: account, p_ifsc: ifsc, p_holder: holder })
  oops(error)
}
export interface AdminMoney {
  pending: number; approved_unpaid: number; paid: number
  kyc_queue: { id: string; full_name: string; partner_code: string; pan_last4: string; bank_last4: string; updated_at: string }[]
  statements: { partner_code: string; full_name: string; month: string; gross: number; tds: number | null; net: number | null; status: string; paid_on: string | null; reference: string | null }[]
  partners_with_rewards: { partner_code: string; full_name: string; level: string; kyc_status: string; approved: number | null; pending: number | null }[]
}
export async function adminMoney(): Promise<AdminMoney> {
  const { data, error } = await supabase.rpc('sehat_admin_care_money')
  oops(error)
  return data as AdminMoney
}
export async function adminKycDetails(partnerId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('sehat_admin_care_kyc_details', { p_partner: partnerId })
  oops(error)
  return data as Record<string, string>
}
export async function adminKycSet(partnerId: string, verified: boolean, note: string) {
  const { error } = await supabase.rpc('sehat_admin_care_kyc_set', { p_partner: partnerId, p_verified: verified, p_note: note || null })
  oops(error)
}
export async function adminPayoutExport(month: string) {
  const { data, error } = await supabase.rpc('sehat_admin_care_payout_export', { p_month: month })
  oops(error)
  return (data ?? []) as { partner_code: string; full_name: string; month: string; gross: number; tds: number; net: number; holder: string; account: string; ifsc: string; pan: string }[]
}
/** Record a refund made in the Razorpay dashboard, by its pay_… id (when the webhook did not). */
export async function adminRecordRefund(razorpayPaymentId: string, amount: number, note: string) {
  const { data: pay } = await supabase.from('payments').select('id').eq('razorpay_payment_id', razorpayPaymentId.trim()).maybeSingle()
  if (!pay) throw new Error('No payment with that Razorpay payment id.')
  const { error } = await supabase.rpc('sehat_admin_payment_refund', { p_payment: (pay as { id: string }).id, p_amount: amount, p_note: note || null })
  oops(error)
}
