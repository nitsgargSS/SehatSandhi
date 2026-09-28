import { useState } from 'react'
import { confirmDisable, requestDisable, type ActionRequested } from '../../lib/adminBusinessApi'

// 0144: disable a business. Step 1 takes the reason and emails a code to the
// admin; step 2 takes the code and disables. The server decides everything —
// whether the caller is an admin, whether the code is right — so this only
// collects input and shows what came back. There is no delete, on purpose.

interface Props {
  business: { id: string; name: string; status: string }
  onClose: () => void
  /** Called once the business is disabled, with a line for the panel's message bar. */
  onDone: (message: string) => void
}

export default function DisableBusinessModal({ business, onClose, onDone }: Props) {
  const [reason, setReason] = useState('')
  const [sent, setSent] = useState<ActionRequested | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    setBusy(true); setError('')
    try {
      setSent(await requestDisable(business.id, reason.trim()))
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
      await confirmDisable(sent!.requestId, code)
      onDone(`✓ ${business.name} disabled. A receipt was emailed.`)
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
        <h3 className="font-bold text-navy-700 mb-1">Disable business</h3>
        <p className="text-sm text-gray-500 mb-4">{business.name} · currently {business.status}</p>

        {!sent ? <>
          <p className="text-sm mb-3 rounded-lg p-3 bg-amber-50 text-amber-800">
            Hides the business from patients and the WhatsApp bot. Nothing is deleted, and you can reactivate it later.
          </p>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Reason (goes in the email and the record)</label>
          <textarea className="input-field text-sm mb-1" rows={3} autoFocus maxLength={1000}
            placeholder="e.g. Registration number does not match the IMR"
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
                {busy ? 'Working…' : 'Disable'}
              </button>}
        </div>
      </div>
    </div>
  )
}
