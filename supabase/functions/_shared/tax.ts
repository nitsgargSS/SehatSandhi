// GST on listing fees. Read by compute-price (for the quote) and razorpay-order
// (for the amount actually charged), so the tax shown and the tax taken are the
// same calculation.
//
// Rate, SAC and the on/off switch live in tax_settings — a CA's answer changes a
// row, not this file.
//
// Two rules this encodes:
//
//   1. NO GSTIN, NO GST. While tax_settings.gst_enabled is false or the gstin is
//      blank, tax is zero. Collecting tax we cannot account for is worse than
//      not collecting it, so the default fails safe.
//
//   2. THE SPLIT FOLLOWS THE RECIPIENT'S STATE. Same state as ours means
//      CGST + SGST at half the rate each; a different state means IGST at the
//      full rate. The recipient's state comes from the first two digits of their
//      GSTIN when they gave one, because a GSTIN is verifiable and a typed
//      address is not.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface TaxSettings {
  enabled: boolean
  gstin: string | null
  stateCode: string | null
  rate: number
  sacCode: string
  description: string
}

export interface TaxBreakdown {
  /** Was tax actually applied? False when GST is off — every amount below is 0. */
  applied: boolean
  rate: number
  /** The pre-tax value the rate was applied to. */
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  taxTotal: number
  /** taxableValue + taxTotal — what the customer pays. */
  grandTotal: number
  /** State code the supply is treated as made to. */
  placeOfSupply: string | null
  interState: boolean
}

const OFF: Omit<TaxBreakdown, 'taxableValue' | 'grandTotal'> = {
  applied: false, rate: 0, cgst: 0, sgst: 0, igst: 0, taxTotal: 0,
  placeOfSupply: null, interState: false,
}

export async function resolveTaxSettings(supabase: SupabaseClient): Promise<TaxSettings> {
  const { data } = await supabase
    .from('tax_settings')
    .select('gst_enabled, gstin, state_code, gst_rate, sac_code, service_description')
    .maybeSingle()

  const t = data as Record<string, unknown> | null
  // An invoice without a supplier GSTIN is not a tax invoice, so a missing gstin
  // disables tax even if someone flipped the switch on.
  const gstin = (t?.gstin as string) ?? null
  return {
    enabled: Boolean(t?.gst_enabled) && Boolean(gstin),
    gstin,
    stateCode: (t?.state_code as string) ?? null,
    rate: Number(t?.gst_rate ?? 18),
    sacCode: String(t?.sac_code ?? '998365'),
    description: String(t?.service_description ?? 'Business listing services'),
  }
}

/** The recipient's state, preferred from their GSTIN. Null when we know neither. */
export async function resolveRecipientState(
  supabase: SupabaseClient,
  businessId?: string | null,
): Promise<string | null> {
  if (!businessId) return null
  const { data } = await supabase
    .from('businesses').select('gstin, state_code').eq('id', businessId).maybeSingle()
  const d = data as { gstin?: string | null; state_code?: string | null } | null
  if (d?.gstin && d.gstin.length === 15) return d.gstin.slice(0, 2)
  return d?.state_code ?? null
}

/**
 * Apply GST to a pre-tax amount.
 *
 * Arithmetic runs in paise as integers, then converts back — doing it in rupee
 * floats leaves a paisa of drift between the invoice and the amount Razorpay
 * charged, which is exactly the kind of mismatch that surfaces at audit.
 *
 * Half-rate rounding: CGST takes the floor and SGST the remainder, so the two
 * always add back to the total tax even when it is an odd number of paise.
 */
export function applyGst(
  taxableValue: number,
  settings: TaxSettings,
  recipientState: string | null,
): TaxBreakdown {
  if (!settings.enabled || taxableValue <= 0 || settings.rate <= 0) {
    return { ...OFF, taxableValue, grandTotal: taxableValue }
  }

  const taxablePaise = Math.round(taxableValue * 100)
  const taxPaise = Math.round((taxablePaise * settings.rate) / 100)

  // No recipient state known (a pre-signup quote) — assume intra-state, which is
  // the common case and gives the same total either way.
  const place = recipientState ?? settings.stateCode
  const interState = Boolean(place && settings.stateCode && place !== settings.stateCode)

  let cgstPaise = 0, sgstPaise = 0, igstPaise = 0
  if (interState) {
    igstPaise = taxPaise
  } else {
    cgstPaise = Math.floor(taxPaise / 2)
    sgstPaise = taxPaise - cgstPaise
  }

  const r = (paise: number) => Math.round(paise) / 100
  return {
    applied: true,
    rate: settings.rate,
    taxableValue: r(taxablePaise),
    cgst: r(cgstPaise),
    sgst: r(sgstPaise),
    igst: r(igstPaise),
    taxTotal: r(taxPaise),
    grandTotal: r(taxablePaise + taxPaise),
    placeOfSupply: place,
    interState,
  }
}

/**
 * Back out the tax from a GST-INCLUSIVE amount, for plans quoted all-in.
 * A ₹1,000 inclusive price at 18% is ₹847.46 taxable + ₹152.54 tax.
 */
export function extractGst(
  inclusiveAmount: number,
  settings: TaxSettings,
  recipientState: string | null,
): TaxBreakdown {
  if (!settings.enabled || inclusiveAmount <= 0 || settings.rate <= 0) {
    return { ...OFF, taxableValue: inclusiveAmount, grandTotal: inclusiveAmount }
  }
  const grossPaise = Math.round(inclusiveAmount * 100)
  const taxablePaise = Math.round((grossPaise * 100) / (100 + settings.rate))
  const b = applyGst(taxablePaise / 100, settings, recipientState)
  // Force the total back to exactly what was quoted, absorbing any rounding
  // remainder into the tax rather than changing the price the customer saw.
  const taxPaise = grossPaise - Math.round(b.taxableValue * 100)
  const r = (p: number) => Math.round(p) / 100
  return b.interState
    ? { ...b, igst: r(taxPaise), taxTotal: r(taxPaise), grandTotal: r(grossPaise) }
    : {
        ...b,
        cgst: r(Math.floor(taxPaise / 2)),
        sgst: r(taxPaise - Math.floor(taxPaise / 2)),
        taxTotal: r(taxPaise),
        grandTotal: r(grossPaise),
      }
}
