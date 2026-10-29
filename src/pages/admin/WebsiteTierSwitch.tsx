import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// 0283: a business's website is the free page or the full site. Only an admin
// moves it — a trigger keeps the owner from setting the tier themselves.
export default function WebsiteTierSwitch({ businessId, canChange }: { businessId: string; canChange: boolean }) {
  const [site, setSite] = useState<{ slug: string; tier: 'free' | 'full' } | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('business_sites').select('slug, tier').eq('business_id', businessId).maybeSingle()
      .then(({ data, error }) => { if (error) setErr(error.message); setSite((data as typeof site) ?? null) })
  }, [businessId])
  const flip = async () => {
    if (!site) return
    const tier = site.tier === 'full' ? 'free' : 'full'
    setBusy(true); setErr('')
    const { error } = await supabase.from('business_sites').update({ tier }).eq('business_id', businessId)
    setBusy(false)
    if (error) setErr(error.message); else setSite({ ...site, tier })
  }
  if (site === undefined) return null
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <p className="font-bold text-navy-700 text-sm mb-1 flex items-center gap-1"><Globe className="w-4 h-4" /> Website</p>
      <p className="text-xs text-gray-600 mb-2">
        {!site ? 'No website yet — the owner creates it from the Website tab.'
          : site.tier === 'full' ? <>Full site (own name plan) — <a className="underline" href={`/s/${site.slug}`} target="_blank" rel="noreferrer">/s/{site.slug}</a></>
          : <>Free page — <a className="underline" href={`/s/${site.slug}`} target="_blank" rel="noreferrer">/s/{site.slug}</a></>}
      </p>
      {canChange && site && (
        <button disabled={busy} onClick={flip}
          className={`text-xs py-1.5 px-3 rounded-lg border ${site.tier === 'full' ? 'border-red-300 text-red-600' : 'border-teal-500 text-teal-700'} disabled:opacity-50`}>
          {busy ? 'Saving…' : site.tier === 'full' ? 'Back to the free page' : 'Give the full site'}
        </button>
      )}
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
