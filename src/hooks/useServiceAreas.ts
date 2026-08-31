import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface ServiceArea {
  pin_code: string
  area_name: string
  district: string
  state: string
  population: number
  tier_number: number
  tier_name: string
  monthly_price: number
  premium_slot_1_weekly: number
  premium_slot_2_weekly: number
  premium_slot_3_weekly: number
}

// Per-tier residents estimate, used only when a service_areas row has no
// population value yet (pre-migration DBs).
const TIER_POP: Record<number, number> = { 1: 150000, 2: 70000, 3: 25000, 4: 12000 }

const TIER_COLORS: Record<number, string> = {
  1: 'bg-gray-100 text-gray-600',
  2: 'bg-gray-100 text-gray-700',
  3: 'bg-amber-100 text-amber-700',
  4: 'bg-yellow-100 text-yellow-700',
  5: 'bg-green-100 text-green-700',
  6: 'bg-teal-100 text-teal-700',
  7: 'bg-blue-100 text-blue-700',
  8: 'bg-indigo-100 text-indigo-700',
  9: 'bg-purple-100 text-purple-700',
  10: 'bg-pink-100 text-pink-700',
  11: 'bg-rose-100 text-rose-700',
  12: 'bg-red-100 text-red-700',
  13: 'bg-red-200 text-red-800',
}

export function tierColor(tierNumber: number): string {
  return TIER_COLORS[tierNumber] || 'bg-gray-100 text-gray-600'
}

export function useServiceAreas() {
  const [areas, setAreas] = useState<ServiceArea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchAreas = async () => {
      // Two independent queries, merged in JS — avoids relying on
      // PostgREST's embedded-join schema cache, which can lag
      // behind when tables are created via raw SQL rather than
      // Supabase's dashboard UI (exactly what happened here).
      //
      // `population` was added later; if this DB hasn't run that migration yet,
      // the select 400s on the missing column, so we retry without it and fall
      // back to a per-tier estimate. Keeps the wizard working pre-migration.
      const fetchAreasRes = async () => {
        const withPop = await supabase
          .from('service_areas')
          .select('pin_code, area_name, district, state, population, tier_number')
          .eq('is_active', true)
          .order('area_name', { ascending: true })
        if (!withPop.error) return withPop
        return supabase
          .from('service_areas')
          .select('pin_code, area_name, district, state, tier_number')
          .eq('is_active', true)
          .order('area_name', { ascending: true })
      }

      const [areasRes, tiersRes] = await Promise.all([
        fetchAreasRes(),
        supabase
          .from('pricing_tiers')
          .select('tier_number, tier_name, monthly_price, premium_slot_1_weekly, premium_slot_2_weekly, premium_slot_3_weekly')
          .eq('is_active', true),
      ])

      if (areasRes.error) {
        setError(`service_areas: ${areasRes.error.message}`)
        setLoading(false)
        return
      }
      if (tiersRes.error) {
        setError(`pricing_tiers: ${tiersRes.error.message}`)
        setLoading(false)
        return
      }

      const tiersByNumber = new Map(
        (tiersRes.data || []).map(t => [t.tier_number, t])
      )

      const merged: ServiceArea[] = (areasRes.data || [])
        .map((a: { pin_code: string; area_name: string; district: string; state: string; tier_number: number; population?: number }) => {
          const tier = tiersByNumber.get(a.tier_number)
          return {
            pin_code: a.pin_code,
            area_name: a.area_name,
            district: a.district,
            state: a.state,
            population: a.population ?? TIER_POP[a.tier_number] ?? 20000,
            tier_number: a.tier_number,
            tier_name: tier?.tier_name || '',
            monthly_price: tier?.monthly_price || 0,
            premium_slot_1_weekly: tier?.premium_slot_1_weekly || 0,
            premium_slot_2_weekly: tier?.premium_slot_2_weekly || 0,
            premium_slot_3_weekly: tier?.premium_slot_3_weekly || 0,
          }
        })
        // highest tier first, matching the original sort order
        .sort((a, b) => b.tier_number - a.tier_number || a.area_name.localeCompare(b.area_name))

      setAreas(merged)
      setLoading(false)
    }
    fetchAreas()
  }, [])

  return { areas, loading, error }
}

// ── The public area list ────────────────────────────────────────────────────
//
// Browse and the speciality landing pages used to render PIN_CODES, a
// twenty-entry Yamuna Nagar array compiled into the bundle. That made the
// patient side structurally incapable of showing anywhere else: a clinic could
// register in Jaipur (migration 0094) and no patient page would ever list
// Jaipur, because the list of places was a constant.
//
// This is the same table, minus the pricing columns those pages have no
// business knowing. Anonymous visitors can read it — service_areas carries a
// `public_read_areas` policy for exactly this — so it needs no session.
//
// It returns [] rather than a fallback constant while loading or on failure.
// An area picker that is briefly empty is honest; one that silently offers a
// hardcoded town nobody operates in is not.

export interface PublicArea {
  pin_code: string
  area_name: string
  district: string | null
  state: string | null
}

export function usePublicAreas() {
  const [areas, setAreas] = useState<PublicArea[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('service_areas')
      .select('pin_code, area_name, district, state')
      .eq('is_active', true)
      .order('area_name', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        setAreas(error ? [] : ((data ?? []) as PublicArea[]))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { areas, loading }
}
