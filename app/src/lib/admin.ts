import { supabase } from './supabase'
import { listBroadcastsForReview, reviewBroadcast, type BroadcastForReview } from '@web/lib/marketingApi'
import { adminLeads, resolveLead, type AdminLeadRow } from '@web/lib/insuranceApi'
import { adminOrders } from '@web/lib/medicineOrdersApi'
import { adminTrips } from '@web/lib/ambulanceApi'

// The admin's phone view: what needs a decision, and how today went. Every
// call is one the website's admin dashboard (src/pages/admin/*) already makes,
// and every one is refused by RLS / sehat_is_admin() for anyone else — the
// app only decides whether to show the tab.

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

/** On the admin list (admin_users; its one SELECT policy is sehat_is_admin()). */
export async function amAdmin(uid: string): Promise<boolean> {
  const { data } = await supabase.from('admin_users').select('role').eq('auth_uid', uid).maybeSingle()
  return !!data
}

// ── Approvals ───────────────────────────────────────────────────────────────

export interface PendingBusiness {
  id: string; name: string; vertical: string; phone: string | null; email: string | null
  reg_number: string | null; address: string | null; own_city: string | null; own_pin_code: string | null
  created_at: string; verification_notes: string | null; phone_verified_at: string | null
}
export async function pendingBusinesses(): Promise<PendingBusiness[]> {
  const { data, error } = await supabase.rpc('sehat_admin_find_businesses', {
    p_query: null, p_status: 'pending', p_vertical: null, p_limit: 50, p_offset: 0,
  })
  oops(error)
  return ((data as { rows: PendingBusiness[] } | null)?.rows ?? [])
}
export async function approveBusiness(id: string) {
  const { error } = await supabase.from('businesses').update({ status: 'active' }).eq('id', id)
  oops(error)
}
/** As the website: suspended, with the reason dated on top of the verification notes. */
export async function rejectBusiness(b: PendingBusiness, reason: string) {
  const day = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const line = `Suspended ${day}: ${reason.trim()}`
  const prev = b.verification_notes?.trim()
  const { error } = await supabase.from('businesses')
    .update({ status: 'suspended', verification_notes: prev ? `${line}\n\n${prev}` : line }).eq('id', b.id)
  oops(error)
}

export interface PendingCamp {
  id: string; title: string; camp_type: string; date_from: string; date_to: string
  pin_codes: string[] | null; description: string | null; businesses: { name: string } | null
}
export async function pendingCamps(): Promise<PendingCamp[]> {
  const { data, error } = await supabase.from('camps_offers').select('*, businesses(name)')
    .eq('status', 'pending_approval').order('created_at', { ascending: false })
  oops(error)
  return (data ?? []) as PendingCamp[]
}
export async function reviewCamp(id: string, approve: boolean, note?: string) {
  const { error } = await supabase.from('camps_offers').update({
    status: approve ? 'approved' : 'rejected', ...(approve ? {} : { admin_notes: note }),
    reviewed_by: 'admin', reviewed_at: new Date().toISOString(),
  }).eq('id', id)
  oops(error)
}

export const pendingBroadcasts = () => listBroadcastsForReview('pending_approval')
export { reviewBroadcast, resolveLead, type BroadcastForReview, type AdminLeadRow }

/** Insurance leads waiting on an admin: an open report, or a flag (0195). */
export async function openLeadReports(): Promise<AdminLeadRow[]> {
  const rows = await adminLeads(90)
  return rows.filter(r => (r.status === 'disputed' && !r.dispute_resolution) || r.patient_not_called || r.outcome_mismatch)
}

// ── Today ───────────────────────────────────────────────────────────────────

export interface Today {
  visitors: number; searches: number; bookings: number; newListings: number; businessLeads: number; whatsappClicks: number
  orders: number; trips: number; leads: number
  app: number; whatsapp: number; website: number; frontDesk: number
  privacyOpen: number
}
const num = (v: unknown) => Number(v ?? 0) || 0

export async function today(): Promise<Today> {
  const [plat, chan, orders, trips, leads, privacy] = await Promise.all([
    supabase.rpc('sehat_platform_report', { p_days: 1 }),
    supabase.rpc('sehat_admin_channel_report', { p_days: 1 }),
    adminOrders(1).catch(() => []),
    adminTrips(1).catch(() => []),
    adminLeads(1).catch(() => []),
    supabase.from('privacy_requests').select('id', { count: 'exact', head: true }).not('status', 'in', '(done,rejected)'),
  ])
  oops(plat.error)
  // p_days = 1 returns yesterday and today; the card is today's.
  const all = (plat.data ?? []) as Record<string, unknown>[]
  const last = all.reduce((m, r) => String(r.day) > m ? String(r.day) : m, '')
  const p = all.filter(r => String(r.day) === last)
  const sum = (k: string) => p.reduce((a, r) => a + num(r[k]), 0)
  // The channel report's rows are (what, channel, n); new app sign-ins are not activity.
  const c = ((chan.data ?? []) as { what: string; channel: string; n: number }[]).filter(r => r.what !== 'App sign-ins (new)')
  const by = (ch: string) => c.filter(r => r.channel === ch).reduce((a, r) => a + num(r.n), 0)
  return {
    visitors: sum('visitors'), searches: sum('searches'), bookings: sum('bookings'),
    newListings: sum('new_listings'), businessLeads: sum('business_leads'), whatsappClicks: sum('whatsapp_clicks'),
    orders: orders.length, trips: trips.length, leads: leads.length,
    app: by('app'), whatsapp: by('whatsapp'), website: by('website'), frontDesk: by('front_desk'),
    privacyOpen: privacy.count ?? 0,
  }
}
