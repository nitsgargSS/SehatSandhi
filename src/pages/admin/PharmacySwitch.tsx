import { useState } from 'react'
import { Pill } from 'lucide-react'
import { adminSetPharmacy } from '../../lib/pharmacyApi'

// 0158: in-house dispensing for a clinic — its own medicine counter, stock and
// pharmacy bills. Free for now and switched on here, by an admin; a manager
// sees whether it is on but cannot change it (the RPC refuses them too).

export default function PharmacySwitch({ businessId, on, canChange, onChanged }: {
  businessId: string
  on: boolean
  canChange: boolean
  onChanged: (on: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const flip = async () => {
    setBusy(true); setErr('')
    try { await adminSetPharmacy(businessId, !on); onChanged(!on) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <p className="font-bold text-navy-700 text-sm mb-1 flex items-center gap-1"><Pill className="w-4 h-4" /> In-house dispensing</p>
      <p className="text-xs text-gray-600 mb-2">
        {on ? 'On — the clinic has a Pharmacy tab: medicines, stock, purchases and pharmacy bills.'
            : 'Off. Turn on for a clinic that hands out medicines from its own stock.'}
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
