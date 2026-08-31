import { supabase } from './supabase'
import { downloadCsv } from './billingApi'

// The GST filing export: our own invoices, in the shape a return is filed from.
//
// These are NG Technologies' invoices to businesses, under our GSTIN. Nothing
// here touches patient_bills — that is a clinic billing a patient, reported by
// the revenue panel. Different payer, different payee.
//
// ── THE PERIOD MATHS LIVES HERE, AND ONLY HERE ──────────────────────────────
// A GST period is FINANCIAL, not calendar:
//
//     Q1 Apr–Jun   Q2 Jul–Sep   Q3 Oct–Dec   Q4 Jan–Mar     year: 1 Apr – 31 Mar
//
// Filing January under Q1 of the wrong year is a wrong return, not a display
// bug. The SQL deliberately takes two plain dates and does no calendar
// reasoning at all, so this file is the single place that decides what "Q3
// 2026-27" means — and it is a pure function, which is what makes it testable.

export type GstPeriodKind = 'month' | 'quarter' | 'year' | 'custom'

export interface GstPeriod {
  from: string          // yyyy-mm-dd inclusive
  to: string            // yyyy-mm-dd inclusive
  label: string         // 'Oct 2026', 'Q3 2026-27', 'FY 2026-27'
  fy: string            // '2026-27'
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Last day of month m (1-12) in year y. Handles February in a leap year. */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** The financial year a date falls in, as '2026-27'. Mirrors sehat_financial_year. */
export function financialYear(d: Date): string {
  const y = d.getUTCFullYear()
  const start = d.getUTCMonth() + 1 >= 4 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** The April in which a financial year labelled '2026-27' begins. */
const fyStartYear = (fy: string) => Number(fy.slice(0, 4))

/**
 * Resolve a period to the two dates the RPC filters between.
 *
 * `index` is the month (1-12, calendar) for 'month' and the FINANCIAL quarter
 * (1-4, where 1 is Apr-Jun) for 'quarter'. It is ignored for 'year'.
 */
export function resolvePeriod(kind: GstPeriodKind, fy: string, index = 1): GstPeriod {
  const startY = fyStartYear(fy)

  if (kind === 'year') {
    return { from: iso(startY, 4, 1), to: iso(startY + 1, 3, 31), label: `FY ${fy}`, fy }
  }

  if (kind === 'quarter') {
    const q = Math.min(4, Math.max(1, index))
    const firstMonth = 4 + (q - 1) * 3           // 4, 7, 10, 13
    // A financial quarter can straddle the new calendar year: Q4 is Jan-Mar of
    // the FOLLOWING calendar year, which is why this is not startY throughout.
    const sY = startY + (firstMonth > 12 ? 1 : 0)
    const sM = firstMonth > 12 ? firstMonth - 12 : firstMonth
    const eMonthAbs = firstMonth + 2
    const eY = startY + (eMonthAbs > 12 ? 1 : 0)
    const eM = eMonthAbs > 12 ? eMonthAbs - 12 : eMonthAbs
    return {
      from: iso(sY, sM, 1),
      to: iso(eY, eM, lastDay(eY, eM)),
      label: `Q${q} ${fy}`,
      fy,
    }
  }

  // Month: index is a calendar month, and Jan-Mar belong to the LATER calendar
  // year of the financial year.
  const m = Math.min(12, Math.max(1, index))
  const y = m >= 4 ? startY : startY + 1
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })
  return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)), label: `${name} ${y}`, fy }
}

/** The financial years worth offering, newest first. */
export function recentFinancialYears(count = 4, today = new Date()): string[] {
  const current = fyStartYear(financialYear(today))
  return Array.from({ length: count }, (_, i) => {
    const s = current - i
    return `${s}-${String((s + 1) % 100).padStart(2, '0')}`
  })
}

export interface GstRegisterRow {
  invoice_number: string
  invoice_date: string
  fy: string
  recipient_name: string | null
  recipient_gstin: string | null
  supply_type: 'B2B' | 'B2C'
  place_of_supply: string | null
  supply_nature: string
  sac_code: string | null
  taxable_value: number
  gst_rate: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  tax_total: number
  total_amount: number
  reverse_charge: boolean
  status: string
}

export interface GstSummaryRow {
  supply_type: 'B2B' | 'B2C'
  supply_nature: string
  place_of_supply: string | null
  sac_code: string | null
  gst_rate: number
  invoices: number
  taxable_value: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  tax_total: number
  total_amount: number
}

const num = (v: unknown) => Number(v ?? 0)

export async function getGstRegister(p: GstPeriod): Promise<GstRegisterRow[]> {
  const { data, error } = await supabase.rpc('sehat_gst_register', { p_from: p.from, p_to: p.to })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as GstRegisterRow),
    taxable_value: num(r.taxable_value), gst_rate: num(r.gst_rate),
    cgst_amount: num(r.cgst_amount), sgst_amount: num(r.sgst_amount),
    igst_amount: num(r.igst_amount), tax_total: num(r.tax_total),
    total_amount: num(r.total_amount),
  }))
}

export async function getGstSummary(p: GstPeriod): Promise<GstSummaryRow[]> {
  const { data, error } = await supabase.rpc('sehat_gst_summary', { p_from: p.from, p_to: p.to })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => ({
    ...(r as unknown as GstSummaryRow),
    invoices: num(r.invoices), gst_rate: num(r.gst_rate),
    taxable_value: num(r.taxable_value), cgst_amount: num(r.cgst_amount),
    sgst_amount: num(r.sgst_amount), igst_amount: num(r.igst_amount),
    tax_total: num(r.tax_total), total_amount: num(r.total_amount),
  }))
}

export const REGISTER_COLUMNS: [keyof GstRegisterRow, string][] = [
  ['invoice_number', 'Invoice no'],
  ['invoice_date', 'Invoice date'],
  ['recipient_name', 'Recipient'],
  ['recipient_gstin', 'Recipient GSTIN'],
  ['supply_type', 'B2B/B2C'],
  ['place_of_supply', 'Place of supply'],
  ['supply_nature', 'Nature'],
  ['sac_code', 'SAC'],
  ['taxable_value', 'Taxable value'],
  ['gst_rate', 'Rate %'],
  ['cgst_amount', 'CGST'],
  ['sgst_amount', 'SGST'],
  ['igst_amount', 'IGST'],
  ['tax_total', 'Total tax'],
  ['total_amount', 'Invoice total'],
  ['reverse_charge', 'Reverse charge'],
  ['status', 'Status'],
]

export const SUMMARY_COLUMNS: [keyof GstSummaryRow, string][] = [
  ['supply_type', 'B2B/B2C'],
  ['supply_nature', 'Nature'],
  ['place_of_supply', 'Place of supply'],
  ['sac_code', 'SAC'],
  ['gst_rate', 'Rate %'],
  ['invoices', 'Invoices'],
  ['taxable_value', 'Taxable value'],
  ['cgst_amount', 'CGST'],
  ['sgst_amount', 'SGST'],
  ['igst_amount', 'IGST'],
  ['tax_total', 'Total tax'],
  ['total_amount', 'Invoice total'],
]

/**
 * A CSV, quoted and BOM-prefixed for Excel — same reasoning as the revenue
 * sheet. `moneyCols` are summed into a trailing total row; a filing sheet whose
 * columns do not add up is worse than one with no total at all.
 */
function toCsv<T>(rows: T[], cols: [keyof T, string][], totalLabel: string, moneyCols: (keyof T)[]): string {
  const q = (v: unknown) =>
    `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`
  const head = cols.map(([, l]) => q(l)).join(',')
  const body = rows.map(r => cols.map(([k]) => q(r[k])).join(',')).join('\r\n')
  const totals = cols.map(([k], i) => {
    if (i === 0) return q(totalLabel)
    if (!moneyCols.includes(k)) return q('')
    return q(rows.reduce((s, r) => s + Number(r[k] ?? 0), 0).toFixed(2))
  }).join(',')
  return '﻿' + [head, body, totals].filter(Boolean).join('\r\n') + '\r\n'
}

export function downloadGstRegister(rows: GstRegisterRow[], p: GstPeriod): void {
  const csv = toCsv(rows, REGISTER_COLUMNS, `${p.label} total`,
    ['taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount', 'tax_total', 'total_amount'])
  downloadCsv(`gst-register-${p.label.replace(/\s+/g, '-')}.csv`, csv)
}

export function downloadGstSummary(rows: GstSummaryRow[], p: GstPeriod): void {
  const csv = toCsv(rows, SUMMARY_COLUMNS, `${p.label} total`,
    ['invoices', 'taxable_value', 'cgst_amount', 'sgst_amount', 'igst_amount', 'tax_total', 'total_amount'])
  downloadCsv(`gst-summary-${p.label.replace(/\s+/g, '-')}.csv`, csv)
}
