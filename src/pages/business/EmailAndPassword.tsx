import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isValidEmail, normEmail, checkPassword } from '../../lib/credentials'
import { BIZ } from './shared'

// Step 2's email and password (26 Sep 2026): the business signs in with its own
// password from the start, and resets it with an emailed code if forgotten.
//
// The address is verified with a code BEFORE a password is accepted. A
// password on an unverified address would let anyone register with a doctor's
// email and then sign in as them. Verifying signs the browser in, so the
// password is set on that session (updateUser) and registration, payment and
// the dashboard all run as this person from here on.

export interface EmailPasswordState {
  verifiedEmail: string | null
  password: string
  confirm: string
}

const box: React.CSSProperties = {
  width: '100%', padding: '12px 14px', border: `1px solid ${BIZ.inputBorder}`, borderRadius: 12,
  fontSize: 16, fontFamily: 'inherit', outline: 'none', background: '#fdfbf6',
}
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#3f4a44', display: 'block', marginBottom: 7 }

export default function EmailAndPassword({ email, onEmail, state, onState, locked }: {
  email: string
  onEmail: (v: string) => void
  state: EmailPasswordState
  onState: (s: EmailPasswordState) => void
  /** The password is already saved: show the verified address, nothing to edit. */
  locked?: boolean
}) {
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const addr = normEmail(email)
  const verified = !!addr && state.verifiedEmail === addr

  const send = async () => {
    setErr(''); setMsg('')
    if (!isValidEmail(email)) { setErr('Enter a valid email address first.'); return }
    setBusy(true)
    try {
      // An address that already has a listing is told so here, not after a code.
      const { data } = await supabase.rpc('sehat_signup_check', { p_email: addr, p_phone: '' })
        .then(r => r, () => ({ data: null }))
      if ((data as { email_taken?: boolean } | null)?.email_taken) {
        setErr('A business is already registered with this email. Sign in at sehatsandhi.com/business/login instead.')
        return
      }
      const { error } = await supabase.auth.signInWithOtp({ email: addr!, options: { shouldCreateUser: true } })
      if (error) {
        setErr(/rate|limit/i.test(error.message)
          ? 'Too many codes asked for. Please wait a minute and try again.'
          : 'We could not send a code just now. Please try again, or call us.')
        return
      }
      setCodeSent(true)
      setMsg(`A six-digit code is on its way to ${addr}. It expires in 10 minutes — check spam if it is not in your inbox.`)
    } finally { setBusy(false) }
  }

  const verify = async () => {
    setErr(''); setMsg('')
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: addr!, token: code.trim(), type: 'email' })
      if (error || !data.session) { setErr('That code is not right, or it has expired. Ask for another.'); return }
      onState({ ...state, verifiedEmail: addr })
      setCodeSent(false); setCode('')
      setMsg('')
    } finally { setBusy(false) }
  }

  const rules = checkPassword(state.password).rules

  return (
    <div className="sm:col-span-2 xl:col-span-3" style={{ display: 'grid', gap: 12 }}>
      <div>
        <label style={labelStyle}>Email *</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={email} disabled={locked}
            onChange={e => { onEmail(e.target.value); setCodeSent(false); setCode(''); setErr(''); setMsg('') }}
            placeholder="you@example.com" type="email" inputMode="email" autoComplete="email"
            style={{ ...box, flex: '1 1 240px', minWidth: 0 }} />
          {verified ? (
            <span style={{ alignSelf: 'center', fontSize: 14, fontWeight: 800, color: BIZ.green }}>✓ Verified</span>
          ) : (
            <button type="button" onClick={send} disabled={busy || !isValidEmail(email)}
              style={{ padding: '0 18px', minHeight: 46, borderRadius: 12, border: 'none', background: BIZ.green, color: '#fff', fontWeight: 800, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', opacity: busy || !isValidEmail(email) ? 0.6 : 1 }}>
              {codeSent ? 'Send again' : 'Verify email'}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1.5">
          This is your sign-in. We send a code to check it is yours. One account per address.
        </p>
      </div>

      {codeSent && !verified && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code"
            style={{ ...box, flex: '0 1 180px', letterSpacing: 4 }} />
          <button type="button" onClick={verify} disabled={busy || code.length !== 6}
            style={{ padding: '0 18px', minHeight: 46, borderRadius: 12, border: `2px solid ${BIZ.green}`, background: '#fff', color: BIZ.green, fontWeight: 800, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer', opacity: busy || code.length !== 6 ? 0.6 : 1 }}>
            Confirm code
          </button>
        </div>
      )}
      {msg && <p style={{ fontSize: 13, color: BIZ.muted, margin: 0 }}>{msg}</p>}
      {err && <p style={{ fontSize: 13, color: '#c0392b', margin: 0 }}>{err}</p>}

      {verified && !locked && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label style={{ display: 'block' }}>
            <span style={labelStyle}>Create a password *</span>
            <input type="password" autoComplete="new-password" value={state.password}
              onChange={e => onState({ ...state, password: e.target.value })} style={box} />
          </label>
          <label style={{ display: 'block' }}>
            <span style={labelStyle}>Confirm password *</span>
            <input type="password" autoComplete="new-password" value={state.confirm}
              onChange={e => onState({ ...state, confirm: e.target.value })} style={box} />
          </label>
          <ul className="sm:col-span-2" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: BIZ.mutedWarm, lineHeight: 1.7 }}>
            {rules.map(r => (
              <li key={r.label} style={{ color: r.met ? BIZ.green : undefined }}>{r.met ? '✓ ' : ''}{r.label}</li>
            ))}
            <li style={{ color: state.confirm && state.confirm === state.password ? BIZ.green : undefined }}>
              {state.confirm && state.confirm === state.password ? '✓ ' : ''}Both passwords match
            </li>
          </ul>
          <p className="sm:col-span-2" style={{ fontSize: 12.5, color: BIZ.mutedWarm, margin: 0 }}>
            Forgot it later? Use “Forgot your password?” on the login page — we email a code, then you choose a new one.
          </p>
        </div>
      )}
    </div>
  )
}
