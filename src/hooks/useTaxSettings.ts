import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TaxBreakdown } from '../lib/businessApi'

// GST settings for display. The server recomputes tax for anything charged, so
// this only decides what the wizard and pricing pages SHOW — but it reads the
// same tax_settings row, so the two agree.
//
// Fails closed: if the table is missing or GST is switched off, tax is zero and
// the UI shows a plain price rather than inventing 18%.

export interface TaxSettingsState {
  enabled: boolean
  rate: number
  supplierStateCode: string | null
  sacCode: string
  loading: boolean
}

export function useTaxSettings(): TaxSettingsState {
  const [state, setState] = useState<TaxSettingsState>({
    enabled: false, rate: 18, supplierStateCode: null, sacCode: '998365', loading: true,
  })

  useEffect(() => {
    let cancelled = false
    supabase
      .from('tax_settings')
      .select('gst_enabled, gstin, state_code, gst_rate, sac_code')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const t = data as Record<string, unknown> | null
        setState({
          // An invoice with no supplier GSTIN is not a tax invoice, so a blank
          // gstin disables GST regardless of the switch.
          enabled: Boolean(t?.gst_enabled) && Boolean(t?.gstin),
          rate: Number(t?.gst_rate ?? 18),
          supplierStateCode: (t?.state_code as string) ?? null,
          sacCode: String(t?.sac_code ?? '998365'),
          loading: false,
        })
      })
    return () => { cancelled = true }
  }, [])

  return state
}

/**
 * Client-side GST for the live quote, mirroring _shared/tax.ts.
 *
 * Paise integers, same as the server, so the number on screen matches the amount
 * Razorpay is asked for rather than drifting a paisa.
 *
 * The recipient's state comes from the GSTIN being typed, so the CGST/SGST vs
 * IGST split updates as they enter it.
 */
export function localTax(
  taxableValue: number,
  settings: TaxSettingsState,
  recipientGstin?: string | null,
): TaxBreakdown {
  const off: TaxBreakdown = {
    applied: false, rate: 0, taxableValue, cgst: 0, sgst: 0, igst: 0,
    taxTotal: 0, grandTotal: taxableValue, placeOfSupply: null, interState: false,
  }
  if (!settings.enabled || taxableValue <= 0 || settings.rate <= 0) return off

  const taxablePaise = Math.round(taxableValue * 100)
  const taxPaise = Math.round((taxablePaise * settings.rate) / 100)

  const gstin = (recipientGstin ?? '').trim().toUpperCase()
  const place = gstin.length === 15 ? gstin.slice(0, 2) : settings.supplierStateCode
  const interState = Boolean(place && settings.supplierStateCode && place !== settings.supplierStateCode)

  const r = (p: number) => Math.round(p) / 100
  return {
    applied: true,
    rate: settings.rate,
    taxableValue: r(taxablePaise),
    cgst: interState ? 0 : r(Math.floor(taxPaise / 2)),
    sgst: interState ? 0 : r(taxPaise - Math.floor(taxPaise / 2)),
    igst: interState ? r(taxPaise) : 0,
    taxTotal: r(taxPaise),
    grandTotal: r(taxablePaise + taxPaise),
    placeOfSupply: place,
    interState,
  }
}

/** 15 chars: 2 state digits + 10-char PAN + entity code + Z + checksum. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

/**
 * The GSTIN's own check digit, computed over the first 14 characters.
 *
 * The shape regex alone accepts a mistyped state code — '01AELPG4279G1ZD' looks
 * perfectly well-formed but is a Jammu & Kashmir prefix on a Haryana PAN, and no
 * such registration exists. The 15th character is a checksum over everything
 * before it, so a single wrong digit anywhere fails here.
 *
 * Worth catching on both sides: our GSTIN is printed on every invoice we issue,
 * and a customer's wrong GSTIN costs them the input credit and puts an invalid
 * counterparty in our GSTR-1.
 *
 * Weights alternate 1,2 from the left; each product is folded as
 * quotient + remainder over 36, and the check digit completes the sum to a
 * multiple of 36.
 */
const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function gstinCheckDigit(first14: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARSET.indexOf(first14[i])
    if (value < 0) return ''
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36]
}

export const isValidGstin = (v: string) => {
  const g = v.trim().toUpperCase()
  return GSTIN_RE.test(g) && gstinCheckDigit(g.slice(0, 14)) === g[14]
}
