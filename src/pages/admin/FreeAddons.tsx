import { useEffect, useState } from 'react'
import { Gift } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// 0278: add-ons given free to this one business — decided case by case (a
// pathology lab's OPD, a hospital's pharmacy…). Free ones switch on at once,
// cost ₹0 on its quote, and are not counted in its bundle discount.

const FOR: Record<string, { code: string; label: string }[]> = {
  clinic: [{ code: 'ipd', label: 'IPD' }, { code: 'pathology', label: 'Pathology' }, { code: 'diagnostics', label: 'Diagnostics' }, { code: 'pharmacy', label: 'Pharmacy' }],
  lab: [{ code: 'opd', label: 'OPD (pathology lab)' }, { code: 'pharmacy', label: 'Pharmacy' }],
}

export default function FreeAddons({ businessId, vertical, canChange }: { businessId: string; vertical: string; canChange: boolean }) {
  const [free, setFree] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('businesses').select('free_addons').eq('id', businessId).maybeSingle()
      .then(({ data }) => setFree((data?.free_addons as string[] | null) ?? []), () => setFree([]))
  }, [businessId])
  const options = FOR[vertical === 'hospital' ? 'clinic' : vertical]
  if (!options || free === null) return null

  const flip = async (code: string) => {
    const next = free.includes(code) ? free.filter(c => c !== code) : [...free, code]
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('sehat_admin_set_free_addons', { p_business: businessId, p_addons: next })
    setBusy(false)
    if (error) setErr(error.message); else setFree((data as string[]) ?? next)
  }

  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <p className="font-bold text-navy-700 text-sm mb-1 flex items-center gap-1"><Gift className="w-4 h-4" /> Free add-ons</p>
      <p className="text-xs text-gray-600 mb-2">Ticked add-ons are on and cost this business nothing. Unticking stops them being free from the next renewal.</p>
      <div className="flex flex-wrap gap-3">
        {options.map(o => (
          <label key={o.code} className="text-xs flex items-center gap-1">
            <input type="checkbox" disabled={!canChange || busy} checked={free.includes(o.code)} onChange={() => flip(o.code)} /> {o.label}
          </label>
        ))}
      </div>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
