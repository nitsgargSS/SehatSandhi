import { useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// 0308: daily social posts (0292) for a business — the Social posts tab, the
// 7 PM preview and, once the owner connects their Page, posting to Facebook
// and Instagram. Switched here by an admin; a manager sees it but cannot
// change it (the RPC refuses them too).
export default function SocialSwitch({ businessId, canChange }: { businessId: string; canChange: boolean }) {
  const [on, setOn] = useState<boolean | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('social_settings').select('enabled').eq('business_id', businessId).maybeSingle()
      .then(({ data, error }) => { if (error) setErr(error.message); setOn(!!data?.enabled) })
  }, [businessId])
  const flip = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('sehat_social_set_enabled', { p_business: businessId, p_on: !on })
    setBusy(false)
    if (error) setErr(error.message); else setOn(!on)
  }
  if (on === undefined) return null
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <p className="font-bold text-navy-700 text-sm mb-1 flex items-center gap-1"><Megaphone className="w-4 h-4" /> Social posts</p>
      <p className="text-xs text-gray-600 mb-2">
        {on ? 'On — the owner has a Social posts tab: a daily post, a 7 PM preview, and posting to their Facebook Page and Instagram once connected.'
            : 'Off. Turn on for a business on the marketing add-on.'}
      </p>
      {canChange && (
        <button disabled={busy} onClick={flip}
          className={`text-xs py-1.5 px-3 rounded-lg border ${on ? 'border-red-300 text-red-600' : 'border-teal-500 text-teal-700'} disabled:opacity-50`}>
          {busy ? 'Saving…' : on ? 'Turn off' : 'Turn on'}
        </button>
      )}
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
