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
    // public_tax_display, not tax_settings: the underlying row carries the legal
    // name, GSTIN, registered address and phone, and used to be readable by
    // anyone holding the public key. The view exposes only what is needed to
    // render a price — the rate, whether it applies, and the supplier state for
    // the CGST/SGST vs IGST split. See migration 0012.
    //
    // Falls back to tax_settings when the view is absent, which is only true on
    // a deployment that has not run 0012 yet. Without the fallback there is a
    // window during a deploy where this returns nothing, GST silently reads as
    // off, and the page quotes ₹1,000 while the server still charges ₹1,180 —
    // the exact surprise the GST work existed to remove. Dead weight once every
    // environment is migrated, and cheap to keep until then.
    const load = async () => {
      const view = await supabase
        .from('public_tax_display')
        .select('gst_enabled, has_gstin, state_code, gst_rate, sac_code')
        .maybeSingle()

      let t = view.data as Record<string, unknown> | null
      if (view.error) {
        const legacy = await supabase
          .from('tax_settings')
          .select('gst_enabled, gstin, state_code, gst_rate, sac_code')
          .maybeSingle()
        const l = legacy.data as Record<string, unknown> | null
        t = l && { ...l, has_gstin: Boolean(l.gstin) }
      }

      if (cancelled) return
      setState({
        // An invoice with no supplier GSTIN is not a tax invoice, so a missing
        // gstin disables GST regardless of the switch.
        enabled: Boolean(t?.gst_enabled) && Boolean(t?.has_gstin),
        rate: Number(t?.gst_rate ?? 18),
        supplierStateCode: (t?.state_code as string) ?? null,
        sacCode: String(t?.sac_code ?? '998365'),
        loading: false,
      })
    }
    load()
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
 * GST state codes — the first two digits of every GSTIN.
 *
 * Shown back to whoever is typing, because a wrong state code is the commonest
 * GSTIN typo and it silently flips the invoice between CGST+SGST and IGST.
 * "Registered in Jammu & Kashmir" is obviously wrong to a business in Jagadhri
 * in a way that "01" is not.
 */
export const GST_STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
}

/**
 * The GSTIN's own check digit, computed over the first 14 characters.
 *
 * The shape regex alone accepts a mistyped state code: a Jammu & Kashmir '01'
 * prefix on a Haryana PAN looks perfectly well-formed, and we very nearly filed
 * under one. The 15th character is a checksum over everything before it, so a
 * single wrong digit anywhere fails here.
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
