import { useState } from 'react'
import { Loader2, Trash2, AlertTriangle } from 'lucide-react'
import { purgeSandbox } from '../../lib/businessApi'
import { SANDBOX_PURGE_TOKEN, IS_STAGING } from '../../lib/env'

// Sandbox maintenance. Rendered only while the app is pointed at the sandbox
// backend (Dashboard gates on IS_STAGING), and guarded again here so a routing
// mistake cannot put a purge button in front of production data.
//
// The purge is irreversible, so the UI asks for the phrase to be typed rather
// than offering a button that fires on one click. The server enforces the same
// phrase plus a shared token plus a per-project flag; this is the outermost of
// four layers, not the only one.

const CONFIRM_PHRASE = 'PURGE SANDBOX'

export default function SandboxPanel({ onPurged }: { onPurged: () => void }) {
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState('')
  const [authDeleted, setAuthDeleted] = useState<number | null>(null)

  // Defence in depth: the tab is already gated, but never render a purge
  // control if anything about the env resolves unexpectedly.
  if (!IS_STAGING) return null

  const armed = confirmText.trim() === CONFIRM_PHRASE && !busy

  const runPurge = async () => {
    if (!armed) return
    setBusy(true); setError(''); setResults(null); setAuthDeleted(null)
    try {
      const res = await purgeSandbox(SANDBOX_PURGE_TOKEN)
      setResults(res.results)
      setAuthDeleted(res.authUsersDeleted ?? 0)
      setConfirmText('')
      onPurged()   // refresh the dashboard lists so the effect is visible
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-navy-700">Sandbox maintenance</h2>
        <p className="text-sm text-gray-500 mt-1">
          This is the sandbox database. Nothing here affects production.
        </p>
      </div>

      {!SANDBOX_PURGE_TOKEN && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-sm text-amber-800">
          <strong>VITE_SANDBOX_PURGE_TOKEN is not set.</strong> The purge will be
          rejected by the server until it is configured in this deployment's env
          and matched by the <code>SANDBOX_PURGE_TOKEN</code> secret on the
          sandbox project.
        </div>
      )}

      <div className="border-2 border-red-200 bg-red-50/50 rounded-2xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-red-700">Purge all test data</h3>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">
              Deletes every listing, payment, appointment and patient record from
              the sandbox, plus the auth accounts created by autofill
              (<code>sandbox+…@sehatsandhi.test</code>).
            </p>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              Reference data — pricing tiers, service areas, vertical billing and
              coupons — is <strong>kept</strong>, so the sandbox still prices like
              production afterwards. The seeded <code>sandbox-doctor@</code> and{' '}
              <code>sandbox-admin@</code> logins are kept too.
            </p>
          </div>
        </div>

        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Type <code className="bg-white px-1.5 py-0.5 rounded border text-red-600 font-bold">{CONFIRM_PHRASE}</code> to enable the button
        </label>
        <input
          className="input-field text-sm mb-3 font-mono"
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          spellCheck={false}
          autoComplete="off"
        />

        <button
          onClick={runPurge}
          disabled={!armed}
          className="bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold px-5 py-2.5 rounded-full transition inline-flex items-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          {busy ? 'Purging…' : 'Purge sandbox data'}
        </button>
      </div>

      {error && (
        <div className="mt-5 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <strong>Purge failed.</strong> {error}
        </div>
      )}

      {results && (
        <div className="mt-6">
          <h4 className="font-bold text-navy-700 mb-1">Result</h4>
          <p className="text-sm text-gray-500 mb-3">
            {authDeleted !== null && `${authDeleted} generated auth account(s) removed. `}
            Tables are listed in delete order.
          </p>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {Object.entries(results).map(([table, outcome], i) => {
              const failed = outcome.startsWith('ERROR')
              const skipped = outcome.startsWith('skipped')
              return (
                <div
                  key={table}
                  className={`flex items-center justify-between px-4 py-2 text-sm ${i % 2 ? 'bg-gray-50' : 'bg-white'}`}
                >
                  <code className="text-gray-700">{table}</code>
                  <span className={failed ? 'text-red-600 font-medium' : skipped ? 'text-gray-400' : 'text-gray-500'}>
                    {outcome}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
