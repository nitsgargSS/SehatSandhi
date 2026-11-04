import { useEffect, useState } from 'react'
import { Globe2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { canApply } from '../../lib/intlApi'

// 0324: on a hospital's Today page — an invitation to Sehatsandhi
// International for hospitals with in-patient beds that have not applied, the
// application's progress while it is being checked, or a link to the public
// page once listed. Owner and manager only (the caller decides). The invitation
// can be put away for 30 days.

type St = 'none' | 'draft' | 'submitted' | 'reviewing' | 'listed' | 'paused' | 'rejected'
const KEY = (id: string) => `intl-invite-hidden-${id}`

export default function IntlInvite({ businessId, onOpen }: { businessId: string; onOpen: () => void }) {
  const [st, setSt] = useState<St | null>(null)
  const [hidden, setHidden] = useState(() => {
    try { const t = Number(localStorage.getItem(KEY(businessId)) || 0); return t > Date.now() } catch { return false }
  })
  useEffect(() => {
    let live = true
    canApply(businessId).then(async ok => {
      if (!ok || !live) return
      const { data } = await supabase.from('intl_hospitals').select('status').eq('business_id', businessId).maybeSingle()
      if (live) setSt(((data as { status: St } | null)?.status) ?? 'none')
    })
    return () => { live = false }
  }, [businessId])
  if (!st) return null

  if (st === 'listed') return (
    <div className="rounded-2xl bg-teal-50 border border-teal-100 px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
      <Globe2 className="w-5 h-5 text-teal-700" />
      <span className="flex-1 min-w-[200px] text-teal-900"><b>Listed on Sehatsandhi International.</b> Patients from abroad can see your hospital, photos and estimates.</span>
      <a href={`/international/hospitals/${businessId}`} target="_blank" rel="noreferrer" className="font-semibold text-teal-700 underline">See your page</a>
      <button onClick={onOpen} className="font-semibold text-teal-700 underline">Manage</button>
    </div>
  )
  if (st === 'submitted' || st === 'reviewing' || st === 'paused' || st === 'rejected') return (
    <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
      <Globe2 className="w-5 h-5 text-amber-700" />
      <span className="flex-1 min-w-[200px] text-amber-900">
        {st === 'paused' ? <><b>Your International listing is paused.</b> See what needs fixing.</>
          : st === 'rejected' ? <><b>Your International application needs changes.</b> See the note from Sehatsandhi.</>
          : <><b>Your International application is being checked.</b> We will contact your coordinator for the video walkthrough.</>}
      </span>
      <button onClick={onOpen} className="font-semibold text-amber-800 underline">Open</button>
    </div>
  )
  if (hidden) return null
  return (
    <div className="rounded-2xl p-5 text-white relative" style={{ background: 'linear-gradient(120deg, #0E9F6E 0%, #0b6e8a 100%)' }}>
      <button aria-label="Not now" onClick={() => { try { localStorage.setItem(KEY(businessId), String(Date.now() + 30 * 864e5)) } catch { /* fine */ } setHidden(true) }}
        className="absolute right-3 top-3 p-1 opacity-80 hover:opacity-100"><X className="w-5 h-5" /></button>
      <p className="font-bold text-lg flex items-center gap-2"><Globe2 className="w-5 h-5" /> Get patients from abroad</p>
      <p className="mt-1 text-sm opacity-95 max-w-2xl">
        {st === 'draft' ? 'You have started your Sehatsandhi International application. Finish it to be listed for patients from the Gulf, Nepal, Africa, the UK, USA and NRIs.'
          : 'List your hospital on Sehatsandhi International. Patients from the Gulf, Nepal, Africa, the UK, USA and NRIs compare hospitals and choose. Free to join — a service fee only when a patient comes.'}
      </p>
      <button onClick={onOpen} className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-semibold text-teal-700">
        {st === 'draft' ? 'Continue application' : 'See how to join'}
      </button>
    </div>
  )
}
