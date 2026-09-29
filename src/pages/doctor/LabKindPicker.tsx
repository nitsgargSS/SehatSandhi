import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { IN_CLINIC_TESTS, LAB_KIND_OPTIONS, labKindOf, setLabTests } from '../../lib/labApi'

// 0177: which kinds of tests this business does.
//   A lab: one kind (pathology lab, or radiology & imaging centre). A lab that
//   does both registers two listings.
//   A clinic or hospital: tick what it does in-house — a cardiologist's echo,
//   an orthopaedic clinic's X-ray. Ticking anything switches the Lab tab on.
export default function LabKindPicker({ businessId, vertical, current, canChange, onSaved }: {
  businessId: string
  vertical: string
  current: string[] | null | undefined
  canChange: boolean
  onSaved: (r: { lab_categories: string[]; lab_module: boolean }) => void
}) {
  const isLab = vertical === 'lab'
  const [kind, setKind] = useState<string>(labKindOf(current) ?? '')
  const [ticks, setTicks] = useState<string[]>(current ?? [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async () => {
    const cats = isLab ? (LAB_KIND_OPTIONS.find(o => o.value === kind)?.cats ?? []) : ticks
    if (isLab && !cats.length) { setMsg('Choose what kind of lab this is.'); return }
    setBusy(true); setMsg('')
    try {
      const r = await setLabTests(businessId, cats)
      onSaved(r)
      setMsg(isLab ? '✓ Saved. Your test list and reports follow this.'
        : r.lab_module ? '✓ Saved. Open the Lab tab to add these tests and start taking orders.' : '✓ Saved. In-clinic tests are off.')
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card shadow-sm">
      <h3 className="font-bold text-navy-700 mb-1 flex items-center gap-2"><FlaskConical className="w-4 h-4" />
        {isLab ? 'What kind of lab is this?' : 'Tests you do here'}</h3>
      <p className="text-sm text-gray-500 mb-3">
        {isLab
          ? 'Your test list, the standard tests you import and your reports follow this. If you run both a pathology lab and an imaging centre, register the second one as its own listing.'
          : 'If you do tests in your own clinic — an ECG or echo, an X-ray, blood samples — tick them. A Lab tab appears for orders, results and reports sent to patients on WhatsApp. No separate lab registration needed.'}
      </p>
      {isLab ? (
        <select className="input-field" value={kind} disabled={!canChange} onChange={e => setKind(e.target.value)}>
          <option value="">Choose…</option>
          {LAB_KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <div className="space-y-2">
          {IN_CLINIC_TESTS.map(o => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={!canChange} checked={ticks.includes(o.value)}
                onChange={e => setTicks(t => e.target.checked ? [...t, o.value] : t.filter(x => x !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      )}
      {canChange && <button disabled={busy} onClick={save} className="btn-teal text-sm py-2 px-4 mt-3">{busy ? 'Saving…' : 'Save'}</button>}
      {!canChange && <p className="text-xs text-gray-400 mt-2">Only the owner or a manager can change this.</p>}
      {msg && <p className={`text-sm mt-2 ${msg.startsWith('✓') ? 'text-teal-700' : 'text-red-600'}`}>{msg}</p>}
    </div>
  )
}
