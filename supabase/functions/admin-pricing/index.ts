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
])
const VERTICAL_FIELDS = new Set([
  'monthly_enabled', 'commission_enabled', 'commission_percent', 'commission_basis',
])

function pick(patch: Record<string, unknown>, allowed: Set<string>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch ?? {})) if (allowed.has(k)) out[k] = v
  return out
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

  const key = typeof body.key === 'string' ? body.key : ''
  if (!safeEqual(key, adminKey)) return json({ error: 'unauthorised' }, 401)

  const actor = typeof body.actor === 'string' && body.actor ? body.actor : 'admin'
  const action = typeof body.action === 'string' ? body.action : ''

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

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
