import { supabase } from './supabase'
import { downloadCsv } from './billingApi'

// Admin business intelligence: where the listings are, where they are not, what
// kind they are, who is due to renew, and which towns notice us.
//
// ── LOCATED IN IS NOT SELLS INTO ────────────────────────────────────────────
// The distinction every number here rests on, and the one worth carrying into
// any new screen built on this file:
//
//   businesses  primary practice location — where a clinic IS. The registration.
//   covering    the pin_codes array       — where it advertises.
//
// One sandbox listing carries 20 pincodes. Counting registrations off coverage
// would report it as twenty registrations and make "most registrations" mean
// "whoever advertises widest". The two are returned separately and neither
// stands in for the other.

export type AreaScope = 'pincode' | 'district' | 'state'

export interface AreaRow {
  scope: AreaScope
  state: string | null
  district: string | null
  pin_code: string | null
  area_name: string | null
  population: number
  areas: number
  businesses: number
  active: number
  pending: number
  covering: number
  /** Null where nobody has registered — the strongest signal, not a gap. */
  residents_per_business: number | null
}

export interface MatrixRow {
  region: string
  vertical: string
  businesses: number
  active: number
}

export interface RenewalRow {
  business_id: string
  name: string
  vertical: string
  status: string
  phone: string | null
  email: string | null
  state: string | null
  district: string | null
  pin_code: string | null
  plan_code: string | null
  monthly_price: number | null
  months_paid: number | null
  term_start: string | null
  term_end: string | null
  /** Negative once the term has lapsed. */
  days_to_expiry: number | null
  auto_renew: boolean
  mandate_status: string
  renewal_price: number | null
  renewal_term_months: number | null
  last_reminder_at: string | null
}

export interface VisitorGeoRow {
  country: string | null
  region: string | null
  city: string | null
  postal_code: string | null
  sessions: number
  page_views: number
  searches: number
  profile_views: number
  business_leads: number
  last_seen: string | null
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const n0 = (v: unknown) => Number(v ?? 0)

export interface AreaFilters { state?: string | null; district?: string | null; pincode?: string | null }

export async function getAreaReport(scope: AreaScope, f: AreaFilters = {}): Promise<AreaRow[]> {
  const { data, error } = await supabase.rpc('sehat_admin_area_report', {
    p_scope: scope, p_state: f.state ?? null, p_district: f.district ?? null, p_pincode: f.pincode ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as AreaRow),
    population: n0(r.population), areas: n0(r.areas), businesses: n0(r.businesses),
    active: n0(r.active), pending: n0(r.pending), covering: n0(r.covering),
    residents_per_business: n(r.residents_per_business),
  }))
}

export async function getVerticalMatrix(scope: 'district' | 'state', state?: string | null): Promise<MatrixRow[]> {
  const { data, error } = await supabase.rpc('sehat_admin_vertical_matrix', {
    p_scope: scope, p_state: state ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    region: String(r.region), vertical: String(r.vertical),
    businesses: n0(r.businesses), active: n0(r.active),
  }))
}

export async function getRenewals(
  daysAhead?: number | null, f: AreaFilters = {},
): Promise<RenewalRow[]> {
  const { data, error } = await supabase.rpc('sehat_admin_renewals', {
    p_days_ahead: daysAhead ?? null, p_state: f.state ?? null, p_district: f.district ?? null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as RenewalRow),
    monthly_price: n(r.monthly_price), months_paid: n(r.months_paid),
    days_to_expiry: n(r.days_to_expiry), renewal_price: n(r.renewal_price),
    renewal_term_months: n(r.renewal_term_months), auto_renew: Boolean(r.auto_renew),
  }))
}

export async function getVisitorGeo(days = 30): Promise<VisitorGeoRow[]> {
  const { data, error } = await supabase.rpc('sehat_admin_visitor_geo', { p_days: days })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as VisitorGeoRow),
    sessions: n0(r.sessions), page_views: n0(r.page_views), searches: n0(r.searches),
    profile_views: n0(r.profile_views), business_leads: n0(r.business_leads),
  }))
}

/**
 * Queue a renewal reminder for one business.
 *
 * QUEUES ONLY. Nothing drains billing_notifications yet, so the returned
 * message says so and the caller must show it verbatim rather than announcing
 * that anything was sent.
 */
export async function queueReminder(businessId: string): Promise<string> {
  const { data, error } = await supabase.rpc('sehat_admin_queue_reminder', { p_business: businessId })
  if (error) throw new Error(error.message)
  return String(data ?? 'Queued.')
}

/** Turn a long-form matrix into region rows × vertical columns, for display. */
export function pivotMatrix(rows: MatrixRow[]): { verticals: string[]; regions: { region: string; total: number; byVertical: Record<string, number> }[] } {
  const verticals = [...new Set(rows.map(r => r.vertical))].sort()
  const byRegion = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const cur = byRegion.get(r.region) ?? {}
    cur[r.vertical] = (cur[r.vertical] ?? 0) + r.businesses
    byRegion.set(r.region, cur)
  }
  const regions = [...byRegion.entries()]
    .map(([region, byVertical]) => ({
      region, byVertical,
      total: Object.values(byVertical).reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => b.total - a.total)
  return { verticals, regions }
}

// ── Sheets ──────────────────────────────────────────────────────────────────
//
// Same conventions as the revenue and GST exports: quoted, quote-doubled, BOM
// for Excel. One generic writer so a fourth export cannot invent its own
// escaping and get it subtly wrong.

export function toCsv<T>(rows: T[], cols: [keyof T, string][]): string {
  const q = (v: unknown) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`
  const head = cols.map(([, l]) => q(l)).join(',')
  const body = rows.map(r => cols.map(([k]) => q(r[k])).join(',')).join('\r\n')
  return '﻿' + [head, body].filter(Boolean).join('\r\n') + '\r\n'
}

export const AREA_COLUMNS: [keyof AreaRow, string][] = [
  ['state', 'State'], ['district', 'District'], ['pin_code', 'Pincode'], ['area_name', 'Area'],
  ['population', 'Population'], ['areas', 'Areas'],
  ['businesses', 'Registered here'], ['active', 'Active'], ['pending', 'Pending'],
  ['covering', 'Advertising here'], ['residents_per_business', 'Residents per business'],
]

export const RENEWAL_COLUMNS: [keyof RenewalRow, string][] = [
  ['name', 'Business'], ['vertical', 'Type'], ['status', 'Status'],
  ['state', 'State'], ['district', 'District'], ['pin_code', 'Pincode'],
  ['phone', 'Phone'], ['email', 'Email'],
  ['plan_code', 'Plan'], ['monthly_price', 'Monthly price'], ['months_paid', 'Months paid'],
  ['term_start', 'Term start'], ['term_end', 'Term end'], ['days_to_expiry', 'Days to expiry'],
  ['auto_renew', 'Auto renew'], ['mandate_status', 'Mandate'],
  ['renewal_price', 'Renewal price'], ['renewal_term_months', 'Renewal months'],
  ['last_reminder_at', 'Last reminder'],
]

export const GEO_COLUMNS: [keyof VisitorGeoRow, string][] = [
  ['country', 'Country'], ['region', 'Region'], ['city', 'City'], ['postal_code', 'Postal code'],
  ['sessions', 'Sessions'], ['page_views', 'Page views'], ['searches', 'Searches'],
  ['profile_views', 'Profile views'], ['business_leads', 'Business leads'], ['last_seen', 'Last seen'],
]

const stamp = () => new Date().toISOString().slice(0, 10)

export const downloadAreas = (rows: AreaRow[], scope: AreaScope) =>
  downloadCsv(`businesses-by-${scope}-${stamp()}.csv`, toCsv(rows, AREA_COLUMNS))
export const downloadRenewals = (rows: RenewalRow[]) =>
  downloadCsv(`renewals-${stamp()}.csv`, toCsv(rows, RENEWAL_COLUMNS))
export const downloadGeo = (rows: VisitorGeoRow[]) =>
  downloadCsv(`visitor-locations-${stamp()}.csv`, toCsv(rows, GEO_COLUMNS))
