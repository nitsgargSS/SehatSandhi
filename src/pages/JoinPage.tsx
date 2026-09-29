import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { activeConfig } from '../lib/env'
import { linkMyLogin } from '../lib/businessApi'
import { markPasswordChanged } from '../lib/passwordState'
import { checkPassword, passwordProblem } from '../lib/credentials'
import { BIZ } from './business/shared'
import { Spinner } from '../components/Loading'
import SiteFooter from '../components/SiteFooter'

// /join/<token> — a new staff member sets up their login (29 Sep 2026).
//
// The clinic adds them; they are emailed (and WhatsApped) this link. They
// choose a password and are signed in. No codes, nothing for the clinic to wait
// on. staff-join checks the link and sets the password — only ever for a login
// that has never been used, so the link is spent once they are in.

interface Check { name: string; email: string; clinics: { clinic: string; role: string }[]; alreadySetUp: boolean }

async function callJoin<T>(payload: Record<string, unknown>): Promise<T> {
  const { url, anon } = activeConfig()
  const res = await fetch(`${url}/functions/v1/staff-join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon ?? '', Authorization: `Bearer ${anon ?? ''}` },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Something went wrong (${res.status}). Try again.`)
  return body as T
}

export default function JoinPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [info, setInfo] = useState<Check | null>(null)
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    callJoin<Check>({ op: 'check', token }).then(setInfo, e => setErr((e as Error).message))
  }, [token])

  const accept = async () => {
    if (!info) return
    const problem = passwordProblem(pw, pw2)
    if (problem) { setErr(problem); return }
    setBusy(true); setErr('')
    try {
      await callJoin({ op: 'accept', token, password: pw })
      const { error } = await supabase.auth.signInWithPassword({ email: info.email, password: pw })
      if (error) throw new Error(`Your login is ready, but signing in failed: ${error.message}. Sign in from the login page.`)
      await linkMyLogin()
      await markPasswordChanged().catch(() => undefined)
      navigate('/business/dashboard', { replace: true })
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  const rules = checkPassword(pw).rules

  return (
    <div style={{ background: BIZ.cream }} className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center" style={{ padding: 'clamp(22px,5.5vw,48px) clamp(16px,5vw,56px)' }}>
        <div className="card max-w-md w-full shadow-xl">
          <div className="text-center mb-6">
            <Link to="/" aria-label="Sehatsandhi — home" className="block"><img src="/logo.png" alt="Sehatsandhi" className="h-14 mx-auto mb-4" /></Link>
            <h1 className="text-2xl font-bold text-navy-700">Set up your login</h1>
          </div>

          {!info && !err && <div className="flex justify-center py-8"><Spinner /></div>}

          {!info && err && (
            <div className="space-y-4">
              <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>
              <Link to="/business/login" className="btn-teal w-full py-3 block text-center">Go to the login page</Link>
            </div>
          )}

          {info && info.alreadySetUp && (
            <div className="space-y-4 text-sm text-gray-600">
              <p className="flex gap-2"><CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0" />
                Your login is already set up, {info.name}. Sign in with <b>{info.email}</b> and your password.</p>
              <Link to="/business/login" className="btn-teal w-full py-3 block text-center">Sign in</Link>
            </div>
          )}

          {info && !info.alreadySetUp && (
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); accept() }}>
              <div className="text-sm text-gray-600">
                Hello <b>{info.name}</b>. You have been added at{' '}
                {info.clinics.map((c, i) => (
                  <span key={i}>{i ? ', ' : ''}<b>{c.clinic}</b> as {c.role}</span>
                ))}. Choose a password and you are in.
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Your login email</label>
                <input className="input-field bg-gray-50" value={info.email} readOnly />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Choose a password</label>
                <input className="input-field" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
                <ul className="mt-2 text-xs space-y-0.5">
                  {rules.map(r => <li key={r.label} className={r.met ? 'text-teal-700' : 'text-gray-400'}>{r.met ? '✓' : '•'} {r.label}</li>)}
                </ul>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Type it again</label>
                <input className="input-field" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
              </div>
              {err && <div className="bg-red-50 text-red-600 text-sm rounded-xl p-3">{err}</div>}
              <button type="submit" disabled={busy} className="btn-teal w-full py-3 disabled:opacity-60">
                {busy ? 'Setting up…' : 'Set password and sign in'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                Next time, sign in at sehatsandhi.com/business/login with this email and password.
              </p>
            </form>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
