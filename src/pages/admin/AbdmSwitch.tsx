import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// 0287: ABDM screens for one clinic — the patient's ABHA, the HFR and HPR IDs.
// Off until an admin switches it on; a trigger keeps the owner from doing it.
export default function AbdmSwitch({ businessId, canChange }: { businessId: string; canChange: boolean }) {
  const [on, setOn] = useState<boolean | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('businesses').select('abdm_enabled').eq('id', businessId).maybeSingle()
      .then(({ data, error }) => { if (error) setErr(error.message); setOn(!!(data as { abdm_enabled?: boolean } | null)?.abdm_enabled) })
  }, [businessId])
  const flip = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('businesses').update({ abdm_enabled: !on }).eq('id', businessId).select('abdm_enabled').maybeSingle()
    setBusy(false)
    if (error) setErr(error.message); else setOn(!!(data as { abdm_enabled?: boolean } | null)?.abdm_enabled)
  }
  if (on === undefined) return null
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <p className="font-bold text-navy-700 text-sm mb-1 flex items-center gap-1"><ShieldCheck className="w-4 h-4" /> ABDM</p>
      <p className="text-xs text-gray-600 mb-2">
        {on ? 'On — staff can add patients\' ABHA, and the owner the HFR and HPR IDs (Clinic tab).' : 'Off — no ABHA or ABDM screens for this clinic.'}
      </p>
      {canChange && (
        <button disabled={busy} onClick={flip}
          className={`text-xs py-1.5 px-3 rounded-lg border ${on ? 'border-red-300 text-red-600' : 'border-teal-500 text-teal-700'} disabled:opacity-50`}>
          {busy ? 'Saving…' : on ? 'Switch ABDM off' : 'Switch ABDM on'}
        </button>
      )}
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
