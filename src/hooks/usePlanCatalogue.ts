import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// The plans by number of doctors, and the paid add-ons (0272), for the public
// pages.
//
// Read from the same rows sehat_plan_quote prices from, and shown only while
// plan_settings.tiered_live is on — the switch that makes checkout charge them.
// So the website and the checkout change together: flip the switch in admin and
// /business shows the new plans; flip it back and it shows the old listing fee.

export interface PlanSettings {
  tiered_live: boolean
  months6_factor: number
  months12_factor: number
  staff_pack_size: number
  staff_pack_price: number
  bundle2_pct: number
  bundle3_pct: number
  ipd_beds_included: number
  ipd_bed_price: number
}

export interface PlanTier {
  code: string
  family: 'core' | 'lab_pathology' | 'lab_diagnostic' | 'lab_both' | 'pharmacy'
  label: string
  max_doctors: number
  staff_included: number
  monthly_price: number
  extra_doctor_price: number
}

export interface PlanAddon {
  code: string
  label: string
  description: string | null
  monthly_price: number
  logins_included: number
}

export interface PlanCatalogue {
  settings: PlanSettings
  tiers: PlanTier[]
  addons: PlanAddon[]
}

/**
 * The catalogue, or null while loading — and null for good if it cannot be
 * read, so a page falls back to what it showed before rather than inventing
 * prices.
 */
export function usePlanCatalogue(): PlanCatalogue | null {
  const [cat, setCat] = useState<PlanCatalogue | null>(null)
  useEffect(() => {
    let live = true
    Promise.all([
      supabase.from('plan_settings').select('*').maybeSingle(),
      supabase.from('plan_tiers').select('*').eq('is_enabled', true).order('sort_order'),
      supabase.from('plan_addons').select('*').eq('is_enabled', true).order('sort_order'),
    ]).then(([s, t, a]) => {
      if (!live || s.error || t.error || a.error || !s.data) return
      setCat({ settings: s.data as PlanSettings, tiers: (t.data ?? []) as PlanTier[], addons: (a.data ?? []) as PlanAddon[] })
    }, () => {})
    return () => { live = false }
  }, [])
  return cat
}
