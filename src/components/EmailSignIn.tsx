import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { isValidEmail, normEmail, passwordProblem, checkPassword } from '../lib/credentials'
import { markPasswordChanged } from '../lib/passwordState'
import { Spinner } from './Loading'

// One sign-in, used by every surface: business owner, doctor, staff and admin.
//
// Email and password is the default. A code by email is the alternative, and it
// is also the whole of the forgotten-password path — verify the address, then
// set a new password on the session that verification produced. There is no
// second mechanism to keep working.
//
// What this deliberately does NOT do is decide whether the person is allowed in.
// It proves they hold the address; the page that uses it decides what that
// entitles them to — admin_users membership for the control panel, a business
// affiliation for the dashboard — and signs them straight back out if the
// answer is no. Keeping those apart is why the same component can serve both.
//
// ── Before this works ───────────────────────────────────────────────────────
// Codes are sent by Supabase Auth, which needs SMTP configured in the project
// (Authentication > Providers > Email, and a real provider under Project
// Settings > Auth > SMTP). The built-in sender allows a handful of messages an
// hour and is not for real traffic. Password composition is likewise a project
// setting — Authentication > Policies — and until it matches lib/credentials,
// this form is the only thing asking for a special character.

type Mode = 'password' | 'code' | 'reset'
type Step = 'enter' | 'code' | 'newPassword'

export interface EmailSignInProps {
  /**
   * Called once Supabase has a session. Return an error message to reject the
   * person — the component signs them out and shows it — or null to let them
   * through. This is where "are they an admin" and "do they run a clinic" live.
   */
  onSignedIn: (userId: string, email: string) => Promise<string | null>
  /** Shown under the heading. */
  intro?: string
  /** Sign-in button label; the surfaces word it differently. */
  submitLabel?: string
}

export default function EmailSignIn({ onSignedIn, intro, submitLabel = 'Sign in' }: EmailSignInProps) {
  const [mode, setMode] = useState<Mode>('password')
  const [step, setStep] = useState<Step>('enter')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reset = (m: Mode) => {
    setMode(m); setStep('enter'); setError(''); setNotice('')
    setPassword(''); setCode(''); setNext(''); setConfirm('')
  }

  /** Hand the session to the caller, and undo it if they say no. */
  const finish = async (userId: string, addr: string) => {
    const problem = await onSignedIn(userId, addr)
    if (problem) {
      await supabase.auth.signOut()
      setError(problem)
      return false
    }
    return true
  }

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setNotice('')
    if (!isValidEmail(email)) { setError('Enter the email address you registered with.'); return }
    setBusy(true)
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: normEmail(email)!, password,
      })
      // One message for a wrong address and a wrong password alike. Telling
      // them apart tells a stranger which addresses are registered here.
      if (err || !data.session) { setError('That email and password do not match an account.'); return }
      await finish(data.user.id, data.user.email ?? normEmail(email)!)
    } finally { setBusy(false) }
  }

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setNotice('')
    if (!isValidEmail(email)) { setError('Enter the email address you registered with.'); return }
    setBusy(true)
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: normEmail(email)!,
        // Without this, asking for a code for an unknown address CREATES the
        // account — anybody could sign themselves up by typing an address into
        // a login box.
        options: { shouldCreateUser: false },
      })
      // Deliberately the same words whether or not the address is known, for
      // the same reason as above. A real delivery failure still surfaces,
      // because that one is our problem and they can do nothing about it.
      if (err && /smtp|rate|limit|sending/i.test(err.message)) {
        setError('We cannot send codes right now. This is a problem at our end — please call us and we will get you in.')
        return
      }
      setStep('code')
      setNotice(`If ${normEmail(email)} is registered, a six-digit code is on its way. It expires in an hour.`)
    } finally { setBusy(false) }
  }

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setNotice('')
    setBusy(true)
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({
        email: normEmail(email)!, token: code.trim(), type: 'email',
      })
      if (err || !data.session) { setError('That code is not right, or it has expired. Ask for another.'); return }
      // A code is proof of the address, which is all a password reset needs.
      if (mode === 'reset') { setStep('newPassword'); setNotice('Address confirmed. Choose a new password.'); return }
      await finish(data.user!.id, data.user!.email ?? normEmail(email)!)
    } finally { setBusy(false) }
  }

  const setNewPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setNotice('')
    const problem = passwordProblem(next, confirm)
    if (problem) { setError(problem); return }
    setBusy(true)
    try {
      const { data, error: err } = await supabase.auth.updateUser({ password: next })
      if (err) { setError(err.message); return }
      // Restart the expiry clock. Supabase Auth does not record when a password
      // was set, so a missed call here means they are asked to change it again
      // on their next sign-in.
      await markPasswordChanged().catch(() => {})
      const u = data.user ?? (await supabase.auth.getUser()).data.user
      if (!u) { setError('Your password was changed. Please sign in again.'); return }
      await finish(u.id, u.email ?? normEmail(email)!)
    } finally { setBusy(false) }
  }

  const rules = checkPassword(next)

  return (
    <div className="space-y-4">
      {intro && <p className="text-sm text-gray-500">{intro}</p>}

      {/* Password first, because it is the everyday route. */}
      {step === 'enter' && (
        <div className="flex gap-2">
          {([['password', 'Password'], ['code', 'Email me a code']] as [Mode, string][]).map(([m, label]) => (
            <button key={m} type="button" onClick={() => reset(m)}
              className={`text-sm font-semibold px-4 py-2 rounded-xl transition ${
                mode === m ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
      )}
      {notice && !error && (
        <p className="text-sm text-teal-700 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">{notice}</p>
      )}

      {step === 'enter' && mode === 'password' && (
        <form onSubmit={signInWithPassword} className="space-y-3">
          <input className="input-field" type="email" inputMode="email" autoComplete="email"
            placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="input-field" type="password" autoComplete="current-password"
            placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
          <button className="btn-teal w-full disabled:opacity-60" disabled={busy}>
            {busy ? <Spinner /> : submitLabel}
          </button>
          <button type="button" onClick={() => reset('reset')}
            className="text-sm text-teal-700 hover:underline">
            Forgot your password?
          </button>
        </form>
      )}

      {step === 'enter' && (mode === 'code' || mode === 'reset') && (
        <form onSubmit={sendCode} className="space-y-3">
          <input className="input-field" type="email" inputMode="email" autoComplete="email"
            placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
          <button className="btn-teal w-full disabled:opacity-60" disabled={busy}>
            {busy ? <Spinner /> : mode === 'reset' ? 'Send a code to reset it' : 'Send me a code'}
          </button>
          {mode === 'reset' && (
            <button type="button" onClick={() => reset('password')}
              className="text-sm text-gray-500 hover:underline">
              Back to signing in
            </button>
          )}
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verifyCode} className="space-y-3">
          <input className="input-field text-center text-2xl tracking-[0.4em] font-mono"
            inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            placeholder="000000" value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />
          <button className="btn-teal w-full disabled:opacity-60" disabled={busy || code.length < 6}>
            {busy ? <Spinner /> : 'Confirm'}
          </button>
          <button type="button" onClick={() => { setStep('enter'); setCode(''); setError(''); setNotice('') }}
            className="text-sm text-gray-500 hover:underline">
            Use a different address
          </button>
        </form>
      )}

      {step === 'newPassword' && (
        <form onSubmit={setNewPassword} className="space-y-3">
          <input className="input-field" type="password" autoComplete="new-password"
            placeholder="New password" value={next} onChange={e => setNext(e.target.value)} required />
          <input className="input-field" type="password" autoComplete="new-password"
            placeholder="Repeat it" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          {/* Ticked off as they type, rather than refused after they submit. */}
          <ul className="text-xs space-y-1">
            {rules.rules.map(r => (
              <li key={r.label} className={r.met ? 'text-teal-700' : 'text-gray-400'}>
                {r.met ? '✓' : '○'} {r.label}
              </li>
            ))}
          </ul>
          <button className="btn-teal w-full disabled:opacity-60" disabled={busy || !rules.ok}>
            {busy ? <Spinner /> : 'Save it and sign in'}
          </button>
        </form>
      )}
    </div>
  )
}
