import { activeConfig } from './env'

// Reading an invoice. The invoices table is service-role only, so this goes
// through the invoice-view edge function, which returns exactly one row for a
// valid token — the same reason the /invoice/:token page needs no login.

export interface Invoice {
  invoice_number: string
  invoice_date: string
  fy: string
  status: string
  cancelled_reason?: string | null

  supplier_legal_name: string | null
  supplier_trade_name: string | null
  supplier_gstin: string | null
  supplier_state_code: string | null
  supplier_address: string | null

  recipient_name: string | null
  recipient_gstin: string | null
  recipient_state_code: string | null
  recipient_address: string | null
  recipient_phone: string | null

  sac_code: string | null
  description: string | null
  period_start: string | null
  period_end: string | null
  months: number | null
  pin_codes: string[] | null

  taxable_value: number
  gst_rate: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  tax_total: number
  total_amount: number

  place_of_supply: string | null
  reverse_charge: boolean
  currency: string | null
}

export async function fetchInvoice(token: string): Promise<Invoice> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Invoices unavailable: Supabase is not configured')

  const res = await fetch(`${url}/functions/v1/invoice-view`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
    body: JSON.stringify({ token }),
  })
  if (res.status === 404) throw new Error('invoice-view failed: 404')
  if (!res.ok) throw new Error(`invoice-view failed: ${res.status}`)

  const body = await res.json()
  return body.invoice as Invoice
}
