// admin-pricing — the ONLY write path for pricing. Called by the admin Billing tab.
//
// WHY THIS EXISTS INSTEAD OF WRITING FROM THE BROWSER
// The admin login compares against VITE_ADMIN_PASS, which Vite compiles into the
// public JS bundle — so that password is readable by anyone who opens the site's
// source, and the anon key is public by design. An RLS policy letting the anon
// role write pricing_plans would therefore let anyone on the internet re-price
// the platform. So writes happen here, behind a key that only ever exists
// server-side, and every change is written to pricing_plan_events.
//
// Set the key once (never as a VITE_ var):
//   supabase secrets set ADMIN_PRICING_KEY='<a long random string>'
//
// Request:  { key, action, ...args }
//   list                    → every plan with seat usage, tiers, vertical billing
//   activate   { planCode }  → set the manual override (null hands back to the queue)
//   updatePlan { planCode, patch:{monthly_price,default_months,min_months,
//                                 max_months,max_signups,is_enabled,sequence,
//                                 suspend_commission,label,description} }
//   updateTier { tierNumber, monthlyPrice }
//   updateVerticalBilling { vertical, patch:{monthly_enabled,commission_enabled,
//                                            commission_percent,commission_basis} }
//
// Env: ADMIN_PRICING_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

// Constant-time compare so a wrong key cannot be found byte by byte.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Only these columns may be set, so a crafted request cannot touch `code` or
// invent columns. Numbers are coerced; nulls are allowed where meaningful.
const PLAN_FIELDS = new Set([
  'label', 'description', 'sequence', 'mode', 'monthly_price',
  'default_months', 'min_months', 'max_months', 'max_signups',
  'suspend_commission', 'is_enabled', 'starts_at', 'ends_at', 'notes',
  'doctor_billing', 'included_doctors', 'extra_doctor_price',
])
const VERTICAL_FIELDS = new Set([
  'monthly_enabled', 'commission_enabled', 'commission_percent', 'commission_basis',
])
const TAX_FIELDS = new Set([
  'legal_name', 'trade_name', 'gstin', 'state_code', 'state_name', 'registered_address',
  'city', 'pin_code', 'email', 'phone', 'sac_code', 'service_description', 'gst_rate',
  'gst_enabled', 'invoice_prefix', 'invoice_terms',
])

function pick(patch: Record<string, unknown>, allowed: Set<string>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch ?? {})) if (allowed.has(k)) out[k] = v
  return out
}

/**
 * The GSTIN's own check digit, over the first 14 characters.
 *
 * Weights alternate 1,2 from the left; each product is folded as
 * quotient + remainder over 36, and the check digit completes the sum to a
 * multiple of 36. Mirrors gstinCheckDigit in src/hooks/useTaxSettings.ts.
 */
function gstinCheckDigit(first14: string): string {
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = charset.indexOf(first14[i])
    if (value < 0) return ''
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return charset[(36 - (sum % 36)) % 36]
}

/**
 * Reject a price written into plan copy.
 *
 * The site renders the amount from monthly_price and the name from label. A
 * label of "Launch offer — ₹1,000/month" therefore keeps promising ₹1,000 after
 * the rate is changed to ₹2,500 — two prices on one screen, the stale one in the
 * bigger type. pricing_plans_copy_has_no_price (migration 0010) enforces this in
 * the database too; this is here to give a sentence instead of a constraint name.
 */
function copyPriceError(patch: Record<string, unknown>): string | null {
  const hasPrice = (s: unknown) =>
    typeof s === 'string' && (/₹/.test(s) || /\brs\.?\s*[0-9]/i.test(s))
  for (const field of ['label', 'description']) {
    if (hasPrice(patch[field])) {
      return `Leave the amount out of the plan ${field} — the site prints it from the monthly price, `
        + `so a figure here would contradict the real rate the next time you change it.`
    }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const adminKey = Deno.env.get('ADMIN_PRICING_KEY')
  if (!adminKey) return json({ error: 'ADMIN_PRICING_KEY not configured' }, 500)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Two ways in, in this order:
  //
  //  1. The admin's own Supabase session — the normal path. The dashboard sends
  //     the JWT it already holds, so there is no key to paste and every change
  //     is attributed to a named person in pricing_plan_events.
  //  2. ADMIN_PRICING_KEY — break glass. Kept for scripts and for the case where
  //     a pricing mistake has locked someone out of the dashboard itself.
  //
  // A valid JWT is not sufficient on its own: every clinic owner has one. It has
  // to belong to a row in admin_users.
  let actor = typeof body.actor === 'string' && body.actor ? body.actor : 'admin'

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const suppliedKey = typeof body.key === 'string' ? body.key : ''
  let authorised = false

  if (bearer) {
    const { data: { user } } = await supabase.auth.getUser(bearer)
    if (user) {
      const { data: admin } = await supabase
        .from('admin_users').select('email, is_active').eq('auth_uid', user.id).maybeSingle()
      if (admin && admin.is_active !== false) {
        authorised = true
        actor = (admin.email as string) || user.email || user.id
      }
    }
  }

  if (!authorised && suppliedKey) {
    authorised = safeEqual(suppliedKey, adminKey)
    if (authorised) actor = `${actor} (pricing key)`
  }

  if (!authorised) return json({ error: 'unauthorised' }, 401)

  const action = typeof body.action === 'string' ? body.action : ''

  const logEvent = (planCode: string | null, act: string, detail: unknown) =>
    supabase.from('pricing_plan_events').insert({
      plan_code: planCode, action: act, actor, detail: detail ?? {},
    })

  try {
    if (action === 'list') {
      const [plans, tiers, verticals, events] = await Promise.all([
        supabase.from('pricing_plan_status').select('*'),
        supabase.from('pricing_tiers').select('*').order('tier_number'),
        supabase.from('vertical_billing').select('*').order('vertical'),
        supabase.from('pricing_plan_events').select('*').order('created_at', { ascending: false }).limit(25),
      ])
      if (plans.error) return json({ error: plans.error.message }, 500)
      return json({
        plans: plans.data ?? [],
        tiers: tiers.data ?? [],
        verticals: verticals.data ?? [],
        events: events.data ?? [],
      })
    }

    if (action === 'createPlan') {
      const b = body as Record<string, unknown>
      const code = String(b.code ?? '').trim().toLowerCase()
      // The code ends up in doctors.pricing_plan_code and on payment rows, so it
      // has to be stable and safe to put in a URL or a report.
      if (!/^[a-z0-9_]{3,40}$/.test(code)) {
        return json({ error: 'code must be 3-40 characters: lowercase letters, numbers and underscores' }, 400)
      }
      const { data: clash } = await supabase
        .from('pricing_plans').select('code').eq('code', code).maybeSingle()
      if (clash) return json({ error: `a plan called ${code} already exists` }, 400)

      const mode = String(b.mode ?? 'pincode_tiers')
      if (!['flat_all_pincodes', 'flat_per_pincode', 'pincode_tiers'].includes(mode)) {
        return json({ error: `unknown mode: ${mode}` }, 400)
      }

      const newCopyErr = copyPriceError({ label: b.label, description: b.description })
      if (newCopyErr) return json({ error: newCopyErr }, 400)

      const monthlyPrice = b.monthly_price === null || b.monthly_price === undefined || b.monthly_price === ''
        ? null : Number(b.monthly_price)
      // A flat plan with no price would quietly charge nothing.
      if (mode !== 'pincode_tiers' && (monthlyPrice === null || !Number.isFinite(monthlyPrice) || monthlyPrice < 0)) {
        return json({ error: 'a flat plan needs a monthly price of 0 or more' }, 400)
      }

      const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)
      const minMonths = Math.max(1, num(b.min_months, 1))
      const maxMonths = Math.max(minMonths, num(b.max_months, 12))
      const defMonths = Math.min(maxMonths, Math.max(minMonths, num(b.default_months, minMonths)))

      const row = {
        code,
        label: String(b.label ?? code),
        description: b.description ? String(b.description) : null,
        // Default to the end of the queue: a new plan should never silently
        // take over from whatever is live.
        sequence: num(b.sequence, 900),
        mode,
        monthly_price: mode === 'pincode_tiers' ? null : Math.round(monthlyPrice as number),
        default_months: defMonths,
        min_months: minMonths,
        max_months: maxMonths,
        max_signups: b.max_signups === null || b.max_signups === undefined || b.max_signups === ''
          ? null : Math.max(0, num(b.max_signups, 0)),
        suspend_commission: Boolean(b.suspend_commission),
        price_includes_gst: Boolean(b.price_includes_gst),
        // Created disabled unless asked otherwise, so it cannot be live by
        // accident before it has been checked.
        is_enabled: b.is_enabled === undefined ? false : Boolean(b.is_enabled),
        notes: b.notes ? String(b.notes) : null,
      }

      const { error } = await supabase.from('pricing_plans').insert(row)
      if (error) return json({ error: error.message }, 500)

      await logEvent(code, 'created', row)
      return json({ ok: true, code })
    }

    if (action === 'deletePlan') {
      const planCode = typeof body.planCode === 'string' ? body.planCode : ''
      if (!planCode) return json({ error: 'planCode required' }, 400)

      // Refuse rather than let a foreign-key violation surface as a bug. A plan
      // anyone has ever been on should be disabled, so its history stays
      // readable on their listing and payments.
      const { count } = await supabase
        .from('businesses').select('id', { count: 'exact', head: true }).eq('pricing_plan_code', planCode)
      if ((count ?? 0) > 0) {
        return json({
          error: `${count} listing(s) are on ${planCode}. Disable it instead — deleting would break their billing history.`,
        }, 400)
      }

      // A live plan must not vanish underneath a signup in progress. Ask what is
      // ACTUALLY live rather than only what is pinned: a plan is usually live by
      // being first in the queue, with no override set at all. Checking the
      // override alone let the live plan be deleted.
      const { data: active } = await supabase
        .from('active_pricing_plan').select('code').maybeSingle()
      if ((active as { code?: string } | null)?.code === planCode) {
        return json({
          error: `${planCode} is the plan new signups are being quoted right now. Make another plan live first, or disable this one.`,
        }, 400)
      }

      const { error } = await supabase.from('pricing_plans').delete().eq('code', planCode)
      if (error) return json({ error: error.message }, 500)

      await logEvent(planCode, 'deleted', { planCode })
      return json({ ok: true })
    }

    if (action === 'planEnrolment') {
      const planCode = typeof body.planCode === 'string' ? body.planCode : ''
      if (!planCode) return json({ error: 'planCode required' }, 400)
      const { data, error } = await supabase
        .from('plan_enrolment').select('*').eq('plan_code', planCode).limit(200)
      if (error) return json({ error: error.message }, 500)
      return json({ enrolment: data ?? [] })
    }

    if (action === 'taxSettings') {
      const { data, error } = await supabase.from('tax_settings').select('*').maybeSingle()
      if (error) return json({ error: error.message }, 500)
      return json({ taxSettings: data })
    }

    if (action === 'updateTaxSettings') {
      const patch = pick(body.patch as Record<string, unknown>, TAX_FIELDS)
      if (!Object.keys(patch).length) return json({ error: 'nothing to update' }, 400)

      // A GSTIN is on every invoice we issue and cannot be a typo. Validate the
      // shape here rather than discovering it on a filed return.
      if ('gstin' in patch && patch.gstin) {
        const g = String(patch.gstin).trim().toUpperCase()
        if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(g)) {
          return json({ error: 'that is not a valid 15-character GSTIN' }, 400)
        }
        // The shape check passes a mistyped state code — the checksum does not.
        // This GSTIN goes on every invoice and decides CGST+SGST vs IGST, so a
        // wrong digit here misstates the tax on every sale.
        const expected = gstinCheckDigit(g.slice(0, 14))
        if (expected !== g[14]) {
          return json({
            error: `${g} fails its own check digit (expected '${expected}' at the end, got '${g[14]}'). `
              + `Check it against your GST certificate — the first two digits are the state code, `
              + `06 for Haryana.`,
          }, 400)
        }
        patch.gstin = g
        patch.state_code = g.slice(0, 2)
      }
      if ('gst_rate' in patch) {
        const r = Number(patch.gst_rate)
        if (!Number.isFinite(r) || r < 0 || r > 100) {
          return json({ error: 'gst_rate must be between 0 and 100' }, 400)
        }
        patch.gst_rate = r
      }
      // Turning GST on without a GSTIN would issue invalid tax invoices.
      if (patch.gst_enabled === true) {
        const { data: cur } = await supabase.from('tax_settings').select('gstin, legal_name').maybeSingle()
        const gstin = (patch.gstin as string) ?? (cur as { gstin?: string } | null)?.gstin
        const legal = (patch.legal_name as string) ?? (cur as { legal_name?: string } | null)?.legal_name
        if (!gstin || !legal) {
          return json({ error: 'set your GSTIN and legal name before enabling GST' }, 400)
        }
      }

      patch.updated_by = actor
      patch.updated_at = new Date().toISOString()
      const { error } = await supabase.from('tax_settings').update(patch).eq('id', true)
      if (error) return json({ error: error.message }, 500)

      await logEvent(null, 'tax_settings_changed', patch)
      return json({ ok: true })
    }

    if (action === 'invoices') {
      const limit = Number.isFinite(body.limit) ? Math.min(Number(body.limit), 500) : 100
      const [rows, summary] = await Promise.all([
        supabase.from('invoices')
          .select('id, invoice_number, invoice_date, fy, recipient_name, recipient_gstin, place_of_supply, taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, tax_total, total_amount, status, public_token, sent_whatsapp_at, sent_email_at')
          .order('invoice_date', { ascending: false }).order('invoice_number', { ascending: false })
          .limit(limit),
        supabase.from('invoice_monthly_summary').select('*').limit(24),
      ])
      if (rows.error) return json({ error: rows.error.message }, 500)
      return json({ invoices: rows.data ?? [], summary: summary.data ?? [] })
    }

    if (action === 'activate') {
      // null / empty means "stop overriding, follow the queue again"
      const planCode = typeof body.planCode === 'string' && body.planCode ? body.planCode : null

      if (planCode) {
        const { data: exists } = await supabase
          .from('pricing_plans').select('code').eq('code', planCode).maybeSingle()
        if (!exists) return json({ error: `unknown plan: ${planCode}` }, 400)
      }

      const { error } = await supabase.from('pricing_settings')
        .update({ override_plan_code: planCode, updated_by: actor, updated_at: new Date().toISOString() })
        .eq('id', true)
      if (error) return json({ error: error.message }, 500)

      await logEvent(planCode, planCode ? 'override_set' : 'override_cleared', { planCode })
      return json({ ok: true, override: planCode })
    }

    if (action === 'updatePlan') {
      const planCode = typeof body.planCode === 'string' ? body.planCode : ''
      if (!planCode) return json({ error: 'planCode required' }, 400)

      const patch = pick(body.patch as Record<string, unknown>, PLAN_FIELDS)
      if (!Object.keys(patch).length) return json({ error: 'nothing to update' }, 400)

      const copyErr = copyPriceError(patch)
      if (copyErr) return json({ error: copyErr }, 400)

      if ('doctor_billing' in patch
          && !['none', 'per_doctor', 'base_plus_extra'].includes(String(patch.doctor_billing))) {
        return json({ error: 'doctor_billing must be none, per_doctor or base_plus_extra' }, 400)
      }

      // A flat plan with no price would silently charge ₹0. The DB constraint
      // also catches this; failing here gives a readable message.
      if ('monthly_price' in patch && (patch.monthly_price === null || Number(patch.monthly_price) < 0)) {
        const { data: cur } = await supabase
          .from('pricing_plans').select('mode').eq('code', planCode).maybeSingle()
        if ((cur as { mode?: string } | null)?.mode !== 'pincode_tiers') {
          return json({ error: 'a flat plan needs a monthly price of 0 or more' }, 400)
        }
      }

      const { error } = await supabase.from('pricing_plans').update(patch).eq('code', planCode)
      if (error) return json({ error: error.message }, 500)

      await logEvent(planCode, 'edited', patch)
      return json({ ok: true })
    }

    if (action === 'updateTier') {
      const tierNumber = Number(body.tierNumber)
      const monthlyPrice = Number(body.monthlyPrice)
      if (!Number.isInteger(tierNumber)) return json({ error: 'tierNumber required' }, 400)
      if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
        return json({ error: 'monthlyPrice must be 0 or more' }, 400)
      }

      const { error } = await supabase.from('pricing_tiers')
        .update({ monthly_price: Math.round(monthlyPrice) })
        .eq('tier_number', tierNumber)
      if (error) return json({ error: error.message }, 500)

      await logEvent(null, 'tier_price_changed', { tierNumber, monthlyPrice })
      return json({ ok: true })
    }

    if (action === 'updateVerticalBilling') {
      const vertical = typeof body.vertical === 'string' ? body.vertical : ''
      if (!vertical) return json({ error: 'vertical required' }, 400)

      const patch = pick(body.patch as Record<string, unknown>, VERTICAL_FIELDS)
      if (!Object.keys(patch).length) return json({ error: 'nothing to update' }, 400)

      if ('commission_percent' in patch) {
        const pct = Number(patch.commission_percent)
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return json({ error: 'commission_percent must be between 0 and 100' }, 400)
        }
        patch.commission_percent = pct
      }

      const { error } = await supabase.from('vertical_billing').update(patch).eq('vertical', vertical)
      if (error) return json({ error: error.message }, 500)

      await logEvent(null, 'vertical_billing_changed', { vertical, ...patch })
      return json({ ok: true })
    }

    return json({ error: `unknown action: ${action}` }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
