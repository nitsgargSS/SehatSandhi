import { supabase } from './supabase'
import { activeConfig } from './env'
import { loadRazorpayCheckout, verifyRazorpayPayment } from './businessApi'

// WhatsApp marketing for clinics (0116): prices, the clinic's wallet, the
// template library, the audience and broadcasts. Phase 1 — sending itself is
// switched off until AiSensy's Partner API is connected, and until then a
// broadcast cannot be created (so nobody is charged).

export interface MarketingSettings {
  monthly_subscription_paise: number
  onboarding_fee_paise: number
  onboarding_fee_label: string
  per_message_paise: number
  grace_days: number
  sending_enabled: boolean
  updated_at: string
}

export interface WaAccount {
  business_id: string
  waba_id: string | null
  whatsapp_number: string | null
  status: 'pending' | 'live' | 'suspended'
  subscription_status: 'inactive' | 'active' | 'past_due' | 'paused'
  past_due_since: string | null
  onboarded_at: string | null
  next_billing_date: string | null
  notes: string | null
}

export interface WalletTx {
  id: string
  type: 'recharge' | 'message_send' | 'refund' | 'adjustment'
  amount_paise: number
  balance_after_paise: number
  note: string | null
  created_at: string
}

export interface WaTemplate {
  id: string
  code: string
  name: string
  category: 'utility' | 'marketing'
  body: string
  placeholders: string[]
  approved: boolean
  is_active: boolean
  sort_order: number
}

export interface AudienceMember {
  patient_member_id: string
  full_name: string
  phone: string
  pin_code: string | null
}

export interface Broadcast {
  id: string
  template_id: string
  params: string[]
  pin_codes: string[]
  recipient_count: number
  total_cost_paise: number
  status: string
  created_at: string
}

export interface MarketingReportRow {
  business_id: string
  business_name: string
  wa_status: string | null
  subscription_status: string | null
  onboarded_at: string | null
  opted_in: number
  sent_this_month: number
  sent_all_time: number
  last_sent_at: string | null
  balance_paise: number
  recharged_paise: number
  spent_paise: number
  last_recharge_at: string | null
}

const oops = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

/** ₹ from paise, always two decimals: ₹392.73. */
export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The template with {{1}} = clinic name and the rest from `params`. */
export const renderTemplate = (body: string, clinicName: string, params: string[]) =>
  body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const i = Number(n)
    if (i === 1) return clinicName
    return params[i - 2]?.trim() || `[${n}]`
  })

// ── Settings and templates ─────────────────────────────────────────────────

export async function getMarketingSettings(): Promise<MarketingSettings> {
  const { data, error } = await supabase.from('whatsapp_marketing_settings').select('*').single()
  oops(error)
  return data as MarketingSettings
}

export async function updateMarketingSettings(patch: Partial<Omit<MarketingSettings, 'updated_at'>>) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('whatsapp_marketing_settings')
    .update({ ...patch, updated_by: user?.email ?? null }).eq('id', true).select('*').single()
  oops(error)
  return data as MarketingSettings
}

export async function listTemplates(): Promise<WaTemplate[]> {
  const { data, error } = await supabase.from('wa_message_templates').select('*').order('sort_order')
  oops(error)
  return (data ?? []) as WaTemplate[]
}

export async function updateTemplate(id: string, patch: Partial<Pick<WaTemplate, 'approved' | 'is_active' | 'body' | 'name'>>) {
  const { error } = await supabase.from('wa_message_templates').update(patch).eq('id', id)
  oops(error)
}

// ── The clinic side ────────────────────────────────────────────────────────

export async function getWaAccount(businessId: string): Promise<WaAccount | null> {
  const { data, error } = await supabase.from('business_wa_accounts').select('*')
    .eq('business_id', businessId).maybeSingle()
  oops(error)
  return data as WaAccount | null
}

export async function getWallet(businessId: string): Promise<{ balance: number; txs: WalletTx[] }> {
  const [w, t] = await Promise.all([
    supabase.from('business_wallets').select('balance_paise').eq('business_id', businessId).maybeSingle(),
    supabase.from('business_wallet_transactions').select('*').eq('business_id', businessId)
      .order('created_at', { ascending: false }).limit(50),
  ])
  oops(w.error); oops(t.error)
  return { balance: (w.data as { balance_paise: number } | null)?.balance_paise ?? 0, txs: (t.data ?? []) as WalletTx[] }
}

export async function getBroadcastBlocker(businessId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('sehat_wa_broadcast_blocker', { p_business: businessId })
  oops(error)
  return data as string | null
}

export async function getAudiencePins(businessId: string): Promise<{ pin_code: string; patients: number }[]> {
  const { data, error } = await supabase.rpc('sehat_marketing_audience_pins', { p_business: businessId })
  oops(error)
  return ((data ?? []) as { pin_code: string; patients: number }[]).map(r => ({ ...r, patients: Number(r.patients) }))
}

export async function getAudience(businessId: string, pins: string[]): Promise<AudienceMember[]> {
  const { data, error } = await supabase.rpc('sehat_marketing_audience', { p_business: businessId, p_pins: pins })
  oops(error)
  return (data ?? []) as AudienceMember[]
}

export async function listBroadcasts(businessId: string): Promise<Broadcast[]> {
  const { data, error } = await supabase.from('wa_broadcasts').select('*')
    .eq('business_id', businessId).order('created_at', { ascending: false }).limit(30)
  oops(error)
  return (data ?? []) as Broadcast[]
}

export async function createBroadcast(args: {
  businessId: string; templateId: string; params: string[]; memberIds: string[]; pins: string[]
}): Promise<{ broadcast_id: string; recipients: number; cost_paise: number; balance_paise: number }> {
  const { data, error } = await supabase.rpc('sehat_create_wa_broadcast', {
    p_business: args.businessId, p_template: args.templateId, p_params: args.params,
    p_members: args.memberIds, p_pins: args.pins,
  })
  oops(error)
  return data as { broadcast_id: string; recipients: number; cost_paise: number; balance_paise: number }
}

/**
 * Top up through Razorpay Checkout. Resolves with the new balance once the
 * payment is verified; rejects if the patient closes Checkout or it fails.
 */
export async function topUpWallet(businessId: string, amountRupees: number, prefill: { name?: string; email?: string; contact?: string } = {}): Promise<number | null> {
  const { url, anon } = activeConfig()
  if (!url || !anon) throw new Error('Payments are not configured.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again.')

  const res = await fetch(`${url}/functions/v1/wallet-topup-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: anon },
    body: JSON.stringify({ businessId, amountRupees }),
  })
  const order = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(order.error ?? 'Could not start the payment.')

  await loadRazorpayCheckout()
  return new Promise((resolve, reject) => {
    // deno-lint-ignore no-explicit-any
    const Rzp = (window as any).Razorpay
    const rzp = new Rzp({
      key: order.keyId,
      amount: order.amount,
      currency: 'INR',
      order_id: order.orderId,
      name: 'Sehatsandhi',
      description: 'WhatsApp marketing wallet top-up',
      prefill,
      theme: { color: '#0E9F6E' },
      modal: { ondismiss: () => reject(new Error('Payment was cancelled.')) },
      handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          const v = await verifyRazorpayPayment({
            orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature, paymentRowId: order.paymentRowId,
          }) as { ok: boolean; error?: string; walletBalancePaise?: number | null }
          if (!v.ok) throw new Error(v.error ?? 'Payment could not be verified.')
          resolve(v.walletBalancePaise ?? null)
        } catch (e) {
          reject(new Error(`${(e as Error).message} If money was deducted, it will be credited automatically within a few minutes.`))
        }
      },
    })
    rzp.on('payment.failed', (r: { error?: { description?: string } }) =>
      reject(new Error(r.error?.description ?? 'Payment failed.')))
    rzp.open()
  })
}

// ── Marketing consent, per clinic ──────────────────────────────────────────

/** The latest marketing consent row for this clinic (or unscoped) — the same
 *  rule sehat_has_consent applies, read through the clinic's own RLS. */
export async function getMarketingConsent(memberId: string, businessId: string): Promise<{ granted: boolean; at: string | null }> {
  const { data, error } = await supabase.from('patient_consents').select('action, created_at, expires_at')
    .eq('patient_member_id', memberId).eq('purpose', 'marketing')
    .or(`business_id.eq.${businessId},business_id.is.null`)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  oops(error)
  const row = data as { action: string; created_at: string; expires_at: string | null } | null
  const live = !!row && row.action === 'granted' && (!row.expires_at || new Date(row.expires_at) > new Date())
  return { granted: live, at: row?.created_at ?? null }
}

/** A newer row, never an edit: the log is the evidence. */
export async function setMarketingConsent(memberId: string, businessId: string, granted: boolean, basis: string) {
  const { error } = await supabase.from('patient_consents').insert({
    patient_member_id: memberId, business_id: businessId, purpose: 'marketing',
    channel: 'whatsapp', action: granted ? 'granted' : 'withdrawn', basis,
  })
  oops(error)
}

// ── Admin ──────────────────────────────────────────────────────────────────

export async function getMarketingReport(): Promise<MarketingReportRow[]> {
  const { data, error } = await supabase.rpc('sehat_admin_wa_marketing_report')
  oops(error)
  return ((data ?? []) as MarketingReportRow[]).map(r => ({
    ...r, opted_in: Number(r.opted_in), sent_this_month: Number(r.sent_this_month),
    sent_all_time: Number(r.sent_all_time), recharged_paise: Number(r.recharged_paise), spent_paise: Number(r.spent_paise),
  }))
}

export async function adminSetWaAccount(businessId: string, patch: Partial<Pick<WaAccount, 'status' | 'subscription_status' | 'whatsapp_number' | 'notes'>>) {
  const extra: Record<string, unknown> = {}
  if (patch.status === 'live') extra.onboarded_at = new Date().toISOString()
  if (patch.subscription_status === 'past_due') extra.past_due_since = new Date().toISOString()
  if (patch.subscription_status === 'active') { extra.past_due_since = null; extra.subscription_started_at = new Date().toISOString() }
  const { error } = await supabase.from('business_wa_accounts')
    .upsert({ business_id: businessId, ...patch, ...extra }, { onConflict: 'business_id' })
  oops(error)
}

export async function adminWalletAdjust(businessId: string, amountPaise: number, note: string) {
  const { data, error } = await supabase.rpc('sehat_admin_wallet_adjust', {
    p_business: businessId, p_amount_paise: amountPaise, p_note: note,
  })
  oops(error)
  return data as { balance_paise: number }
}
