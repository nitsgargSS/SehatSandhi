import { useState } from 'react'
import { confirmStaffCode, requestStaffCode, type StaffAction, type StaffChangeDone, type StaffCodeSent } from '../../lib/staffApi'

// 0147: confirm a staff change with a code emailed to whoever is making it.
// Step 1 takes the reason (required to remove someone) and sends the code;
// step 2 takes the code and makes the change. The server decides whether the
// caller may, whether the code is right, and whether a new doctor waits for
// the extra-doctor fee — this only collects input and reports back.

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', doctor: 'Doctor', nurse: 'Nurse', receptionist: 'Receptionist', manager: 'Manager',
}

interface Props {
  businessId: string
  person: { id: string; name: string; currentRole?: string | null }
  action: StaffAction
  /** For add and role: the role being given. */
  role?: string | null
  onClose: () => void
  onDone: (done: StaffChangeDone) => void
}

export default function StaffCodeModal({ businessId, person, action, role, onClose, onDone }: Props) {
  const [reason, setReason] = useState('')
  const [sent, setSent] = useState<StaffCodeSent | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const needsReason = action === 'remove'
  const title = {
    add: `Add ${person.name} as ${ROLE_LABEL[role ?? 'doctor']}`,
    remove: `Remove ${person.name}`,
    restore: `Bring back ${person.name}${person.currentRole ? ` as ${ROLE_LABEL[person.currentRole] ?? person.currentRole}` : ''}`,
    role: `Make ${person.name} ${ROLE_LABEL[role ?? 'doctor']}`,
  }[action]
  const explain = {
    add: 'They will get an email inviting them to set up their login.',
    remove: 'They lose access to this clinic at once. Their records here stay, and they can be brought back later.',
    restore: 'They get their access back with the role they had.',
    role: role === 'doctor'
      ? 'Doctors can prescribe and are counted in your plan. If your included doctors are in use, they go live once the pro-rata fee is paid.'
      : 'An owner can do everything, including managing staff and billing.',
  }[action]

  const send = async () => {
    setBusy(true); setError('')
    try {
      setSent(await requestStaffCode({ businessId, practitionerId: person.id, action, role, reason: reason.trim() || undefined }))
      setCode('')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const confirm = async () => {
    setBusy(true); setError('')
    try { onDone(await confirmStaffCode(sent!.requestId, code)) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const expires = sent ? new Date(sent.expiresAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''
  const danger = action === 'remove'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-navy-700 mb-2">{title}</h3>

        {!sent ? <>
          <p className={`text-sm mb-3 rounded-lg p-3 ${danger ? 'bg-red-50 text-red-700' : 'bg-teal-50 text-teal-800'}`}>{explain}</p>
          <label className="text-xs font-medium text-gray-600 mb-1 block">
            {needsReason ? 'Reason (required)' : 'Note (optional)'}
          </label>
          <textarea className="input-field text-sm mb-1" rows={3} autoFocus maxLength={1000}
            placeholder={needsReason ? 'e.g. Left the hospital on 30 Sep' : ''}
            value={reason} onChange={e => setReason(e.target.value)} />
          <p className="text-xs text-gray-400 mb-4">
            {needsReason ? 'At least 10 characters. ' : ''}We will email you a code to confirm. The staff member is told by email too.
          </p>
        </> : <>
          <p className="text-sm text-gray-600 mb-3">We emailed a 6-digit code to <b>{sent.sentTo}</b>. It expires at {expires}.</p>
          <input className="input-field text-center text-2xl tracking-[0.5em] font-mono mb-2" inputMode="numeric" autoFocus
            maxLength={6} placeholder="••••••" value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter' && code.length === 6 && !busy) confirm() }} />
          <button onClick={send} disabled={busy} className="text-xs text-teal-700 underline mb-4 disabled:opacity-50">Send a new code</button>
        </>}

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy} className="btn-outline text-sm px-4 disabled:opacity-50">Cancel</button>
          {!sent
            ? <button onClick={send} disabled={busy || (needsReason && reason.trim().length < 10)}
                className="btn-teal text-sm px-4 py-2 disabled:opacity-50">
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            : <button onClick={confirm} disabled={busy || code.length !== 6}
                className={`text-sm font-medium px-4 py-2 rounded-full text-white disabled:opacity-50 transition ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-teal-600 hover:bg-teal-700'}`}>
                {busy ? 'Working…' : 'Confirm'}
              </button>}
        </div>
      </div>
    </div>
  )
}
