import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { passwordProblem, checkPassword } from '../lib/credentials'
import {
  fetchPasswordState, markPasswordChanged, mustChangeNow, shouldWarn, PasswordState,
} from '../lib/passwordState'
import { Spinner } from './Loading'

// Stands between a signed-in person and the dashboard when their password has
// expired, or when somebody has required them to change it.
//
// Three states, and the middle one is the point:
//
//   still fine        → children, unchanged
//   expiring soon     → children, with a strip along the top saying so
//   expired or forced → this screen and nothing else
//
// The warning strip matters more than the block does. Being told on the day it
// expires, mid-clinic, with patients waiting, is how people end up choosing
// Passw0rd2 — so it starts asking ten days out, while there is time to think.
//
// This is the screen, not the lock. 0081 is the lock: it gates
// sehat_caller_role(), sehat_caller_business_ids() and sehat_is_admin() on
// password age, so an expired session reads zero rows from every table whether
// or not it ever loads this component. What that leaves this to do is explain
// why, and offer the way out — because with 0081 in place, an expired login
// without this screen would just look like a clinic whose data had vanished.

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PasswordState | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchPasswordState()
      .then(s => { if (!cancelled) setState(s) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const problem = passwordProblem(next, confirm)
    if (problem) { setError(problem); return }
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password: next })
      if (err) { setError(err.message); return }
      // Supabase Auth will not tell us when a password was set, so if this is
      // missed the clock never restarts and they are asked again next time.
      await markPasswordChanged()
      // A full reload rather than re-rendering: the guards around this — the
      // admin one especially — were told to let an expired person through, and
      // they have to run again now the password is good. Re-rendering in place
      // would show the dashboard without anybody having re-checked who this is.
      window.location.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  // A failed check returns null and lets them through: locking a clinic out of
  // its own dashboard because a status query timed out is the worse outcome.
  if (loading || !mustChangeNow(state)) {
    return (
      <>
        {shouldWarn(state) && !dismissed && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800 flex items-center justify-between gap-3">
            <span>
              Your password expires in {state!.daysLeft} day{state!.daysLeft === 1 ? '' : 's'}.
              Change it under Settings before it locks you out mid-clinic.
            </span>
            <button onClick={() => setDismissed(true)}
              className="text-amber-700 font-semibold shrink-0">Dismiss</button>
          </div>
        )}
        {children}
      </>
    )
  }

  const rules = checkPassword(next)

  return (
    <div className="min-h-screen bg-navy-700 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <img src="/logo.png" alt="Sehatsandhi" className="h-12 mx-auto mb-6" />
        <h2 className="text-xl font-bold text-navy-700 text-center mb-2">
          Choose a new password
        </h2>
        <p className="text-sm text-gray-500 text-center mb-6">
          {state!.mustChange
            ? (state!.mustChangeReason || 'Your password was reset for you, so it needs changing before you carry on.')
            : 'Your password has expired. You can carry on as soon as it is changed.'}
        </p>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-4">{error}</p>
        )}

        <form onSubmit={submit} className="space-y-3">
          <input className="input-field" type="password" autoComplete="new-password"
            placeholder="New password" value={next} onChange={e => setNext(e.target.value)} required />
          <input className="input-field" type="password" autoComplete="new-password"
            placeholder="Repeat it" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          <ul className="text-xs space-y-1">
            {rules.rules.map(r => (
              <li key={r.label} className={r.met ? 'text-teal-700' : 'text-gray-400'}>
                {r.met ? '✓' : '○'} {r.label}
              </li>
            ))}
          </ul>
          <button className="btn-teal w-full disabled:opacity-60" disabled={busy || !rules.ok}>
            {busy ? <Spinner /> : 'Save it and carry on'}
          </button>
        </form>

        {/* No way past this screen except changing it or leaving — an "I'll do
            it later" button is how a policy becomes a suggestion. */}
        <button onClick={() => supabase.auth.signOut().then(() => { window.location.href = '/' })}
          className="w-full text-sm text-gray-500 mt-4 hover:underline">
          Sign out instead
        </button>
      </div>
    </div>
  )
}
