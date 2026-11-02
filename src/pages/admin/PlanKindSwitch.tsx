import { useEffect, useState } from 'react'
import { Stethoscope } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// 0309: a clinic or hospital on the OPD plan (the clinic software) or on the
// marketing plan (listing, WhatsApp Pro, website — no software). Moved here by
// an admin, for businesses signed up by hand; owners move up themselves from
// Plan → Add the clinic software. What it pays follows at its next renewal.
// A manager sees it but cannot change it (the RPC refuses them too).
export default function PlanKindSwitch({ businessId, canChange }: { businessId: string; canChange: boolean }) {
  const [kind, setKind] = useState<'software' | 'marketing' | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('businesses').select('plan_kind').eq('id', businessId).maybeSingle()
      .then(({ data, error }) => { if (error) setErr(error.message); setKind(data?.plan_kind === 'marketing' ? 'marketing' : 'software') })
  }, [businessId])
  const flip = async () => {
    const next = kind === 'marketing' ? 'software' : 'marketing'
    if (next === 'marketing' && !window.confirm('Move to marketing only? The OPD and IPD software switch off (records are kept). The price changes at the next renewal.')) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('sehat_admin_set_plan_kind', { p_business: businessId, p_kind: next })
    setBusy(false)
    if (error) setErr(error.message); else setKind(next)
  }
  if (kind === undefined) return null
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <p className="font-bold text-navy-700 text-sm mb-1 flex items-center gap-1"><Stethoscope className="w-4 h-4" /> Plan</p>
      <p className="text-xs text-gray-600 mb-2">
        {kind === 'marketing'
          ? 'Marketing only — listed and bookable, WhatsApp Pro and website; no OPD software.'
          : 'Clinic software — OPD (and any IPD, lab or pharmacy add-ons), with the listing.'}
      </p>
      {canChange && (
        <button disabled={busy} onClick={flip}
          className="text-xs py-1.5 px-3 rounded-lg border border-teal-500 text-teal-700 disabled:opacity-50">
          {busy ? 'Saving…' : kind === 'marketing' ? 'Move to clinic software' : 'Move to marketing only'}
        </button>
      )}
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
