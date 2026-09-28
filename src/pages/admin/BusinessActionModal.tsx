import { useState } from 'react'
import { confirmBusinessAction, requestBusinessAction, type BusinessAction, type ActionRequested } from '../../lib/adminBusinessApi'

// 0144: disable or delete a business. Step 1 takes the reason and emails a
// code to the admin; step 2 takes the code and does it. The server decides
// everything — whether a delete is allowed, what it removes, whether the code
// is right — so this only collects input and shows what came back.

interface Props {
  action: BusinessAction
  business: { id: string; name: string; status: string }
  onClose: () => void
  /** Called once the action has happened, with a line for the panel's message bar. */
  onDone: (message: string) => void
}

export default function BusinessActionModal({ action, business, onClose, onDone }: Props) {
  const [reason, setReason] = useState('')
  const [sent, setSent] = useState<ActionRequested | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isDelete = action === 'delete'
  const title = isDelete ? 'Delete business' : 'Disable business'

  const send = async () => {
    setBusy(true); setError('')
    try {
      setSent(await requestBusinessAction(business.id, action, reason.trim()))
      setCode('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setBusy(true); setError('')
    try {
      const done = await confirmBusinessAction(sent!.requestId, code)
      const r = done.result
      onDone(isDelete
        ? `✓ ${business.name} deleted${r.doctors_removed ? ` · ${r.doctors_removed} doctor(s)` : ''}${r.logins_removed ? ` · ${r.logins_removed} login(s)` : ''} removed. A receipt was emailed.`
        : `✓ ${business.name} disabled. A receipt was emailed.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const expires = sent ? new Date(sent.expiresAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-navy-700 mb-1">{title}</h3>
        <p className="text-sm text-gray-500 mb-4">{business.name} · currently {business.status}</p>

        {!sent ? <>
          <p className={`text-sm mb-3 rounded-lg p-3 ${isDelete ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
            {isDelete
              ? 'Removes the business and all its records for good, with its doctors and logins that nothing else uses. Not allowed once it has paid or has patients — disable it instead.'
              : 'Hides the business from patients and the WhatsApp bot. You can reactivate it later.'}
          </p>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Reason (goes in the email and the record)</label>
          <textarea className="input-field text-sm mb-1" rows={3} autoFocus maxLength={1000}
            placeholder={isDelete ? 'e.g. Test registration, not a real business' : 'e.g. Registration number does not match the IMR'}
            value={reason} onChange={e => setReason(e.target.value)} />
          <p className="text-xs text-gray-400 mb-4">At least 10 characters. A code will be emailed to your admin address.</p>
        </> : <>
          <p className="text-sm text-gray-600 mb-3">
            We emailed a 6-digit code to <b>{sent.sentTo}</b>. It expires at {expires}.
          </p>
          <input className="input-field text-center text-2xl tracking-[0.5em] font-mono mb-2" inputMode="numeric" autoFocus
            maxLength={6} placeholder="••••••" value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => { if (e.key === 'Enter' && code.length === 6 && !busy) confirm() }} />
          <button onClick={send} disabled={busy} className="text-xs text-navy-600 underline mb-4 disabled:opacity-50">
            Send a new code
          </button>
        </>}

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={busy} className="btn-outline text-sm px-4 disabled:opacity-50">Cancel</button>
          {!sent
            ? <button onClick={send} disabled={busy || reason.trim().length < 10}
                className="bg-navy-700 hover:bg-navy-800 text-white text-sm font-medium px-4 py-2 rounded-full disabled:opacity-50 transition">
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            : <button onClick={confirm} disabled={busy || code.length !== 6}
                className="bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-full disabled:opacity-50 transition">
                {busy ? 'Working…' : isDelete ? 'Delete for good' : 'Disable'}
              </button>}
        </div>
      </div>
    </div>
  )
}
