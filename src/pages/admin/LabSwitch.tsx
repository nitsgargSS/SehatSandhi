import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { adminSetLab } from '../../lib/labApi'

// 0168: the in-house lab for a clinic or hospital — tests, packages, samples,
// results and reports. A Diagnostic Lab has it anyway; this is for the rest.
// Admin only; a manager sees it but cannot change it.

export default function LabSwitch({ businessId, on, canChange, onChanged }: {
  businessId: string
  on: boolean
  canChange: boolean
  onChanged: (on: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const flip = async () => {
    setBusy(true); setErr('')
    try { await adminSetLab(businessId, !on); onChanged(!on) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="mt-4 border-t border-gray-200 pt-3">
      <p className="font-bold text-navy-700 text-sm mb-1 flex items-center gap-1"><FlaskConical className="w-4 h-4" /> In-house lab</p>
      <p className="text-xs text-gray-600 mb-2">
        {on ? 'On — the clinic has a Lab tab: tests, packages, samples, results and reports sent to patients.'
            : 'Off. Turn on for a clinic or hospital that runs its own lab.'}
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
