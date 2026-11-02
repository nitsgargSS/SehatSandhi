import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// 0311: whether the health-insurance offering is shown (site_settings
// 'insurance_enabled', switched off 2 Nov 2026 until the strategy is final).
// Hidden until the answer arrives, and if it cannot be read — never shown by
// accident. One request per page load, shared by every caller.
let cached: Promise<boolean> | null = null
export const insuranceEnabled = (): Promise<boolean> => {
  cached ??= Promise.resolve(supabase.rpc('sehat_insurance_enabled'))
    .then(({ data }) => data === true, () => false)
  return cached
}

export function useInsuranceEnabled(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => { let live = true; insuranceEnabled().then(v => { if (live) setOn(v) }); return () => { live = false } }, [])
  return on
}
