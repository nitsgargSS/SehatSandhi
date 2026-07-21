import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface ServiceArea {
  pin_code: string
  area_name: string
  district: string
  state: string
  tier_number: number
  tier_name: string
  monthly_price: number
  premium_slot_1_weekly: number
  premium_slot_2_weekly: number
  premium_slot_3_weekly: number
}

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
      const { data, error: err } = await supabase
        .from('service_areas')
        .select(`
          pin_code, area_name, district, state, tier_number,
          pricing_tiers ( tier_name, monthly_price, premium_slot_1_weekly, premium_slot_2_weekly, premium_slot_3_weekly )
        `)
        .eq('is_active', true)
        .order('tier_number', { ascending: false })
        .order('area_name', { ascending: true })

      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      const flattened: ServiceArea[] = (data || []).map((row: any) => ({
        pin_code: row.pin_code,
        area_name: row.area_name,
        district: row.district,
        state: row.state,
        tier_number: row.tier_number,
        tier_name: row.pricing_tiers?.tier_name || '',
        monthly_price: row.pricing_tiers?.monthly_price || 0,
        premium_slot_1_weekly: row.pricing_tiers?.premium_slot_1_weekly || 0,
        premium_slot_2_weekly: row.pricing_tiers?.premium_slot_2_weekly || 0,
        premium_slot_3_weekly: row.pricing_tiers?.premium_slot_3_weekly || 0,
      }))

      setAreas(flattened)
      setLoading(false)
    }
    fetchAreas()
  }, [])

  return { areas, loading, error }
}
