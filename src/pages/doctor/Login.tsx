import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { activeConfig } from '../../lib/env'
import { useLanguage } from '../../i18n/LanguageContext'
import { BIZ } from '../business/shared'
import { Spinner } from '../../components/Loading'

// Log in with a code sent to the WhatsApp number the business registered with.
//
// This replaces an email-and-password form most businesses could never have
// used. The signup wizard — the one that takes payment — collects email as
// optional and creates no account at all, so anyone who joined through it had no
// credentials and no way to reach their dashboard. The phone number is required
// at signup, and a code is what this audience already expects.
//
// The legacy email/password route still works for listings created through the
// old /doctor form: sehat_caller_listing_ids() honours both. It is kept below as
// a fallback rather than removed, so nobody who can log in today is locked out.

type Step = 'phone' | 'code'

// Sentinel from clinic-otp, not prose: the wording below belongs to the screen,
// so the function returns a code and the copy stays here.
const WHATSAPP_UNREACHABLE = 'WHATSAPP_UNREACHABLE'

export default function DoctorLogin() {
  const { t } = useLanguage()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)

  const [showLegacy, setShowLegacy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const callOtp = async (payload: Record<string, unknown>) => {
    const { url, anon } = activeConfig()
    if (!url || !anon) throw new Error('Login is unavailable right now.')
    const res = await fetch(`${url}/functions/v1/clinic-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}`, apikey: anon },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.')
    return body
  }

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await callOtp({ action: 'request', phone })
      // The same message either way, deliberately: a different one would tell
      // anyone which numbers belong to businesses on the platform.
      setNotice(r.message ?? 'If that number is registered, a code is on its way.')
      setDevCode(r.devCode ?? null)
      setStep('code')
    } catch (err) {
      const message = (err as Error).message
      // Login is WhatsApp-only and has no SMS fallback, so this is a dead end
      // rather than something retrying fixes. Name the cause: the number needs a
      // WhatsApp account, and nothing the business does on this screen will help.
      setError(message === WHATSAPP_UNREACHABLE
        ? "We couldn't reach that number on WhatsApp. Sign-in requires a WhatsApp account on this number."
        : message)
    } finally { setBusy(false) }
  }

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = await callOtp({ action: 'verify', phone, code })
      // The function hands back a one-time token; exchanging it here is what
      // creates the session, so the browser ends up holding a normal login.
      const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash, type: 'email' })
      if (vErr) throw new Error('Could not start your session. Please try again.')
      navigate('/business/dashboard')
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }

  const legacyLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError(err.message); setBusy(false) }
    else navigate('/business/dashboard')
  }

  return (
    // Same shell as the business wizard: cream page, dark rail carrying the
    // logo, and no site navbar. This page used to render inside the marketing
    // layout, whose fixed navbar overlapped the card — and a signed-out clinic
    // does not need "Book on WhatsApp" or "Register Clinic" above its own login
    // form anyway. See /business/register, which this mirrors.
    <div style={{ background: BIZ.cream }} className="grid lg:grid-cols-[300px_1fr] min-h-screen">
      <div className="hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen"
        style={{ background: BIZ.ink, padding: '36px 30px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}>
          <img src="/logo-tight.png" alt="Sehatsandhi"
            style={{ height: 132, width: 'auto', objectFit: 'contain', borderRadius: 16, background: BIZ.cream, padding: '16px 20px' }} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 10 }}>
          Your clinic dashboard
        </div>
        <div style={{ fontSize: 14, color: '#c9d6d0', lineHeight: 1.6 }}>
          Appointments, hours, staff and your bills — all on the number patients already message you on.
        </div>
        <div style={{ marginTop: 'auto', background: 'rgba(255,255,255,.06)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 12, color: '#8fa89d', fontWeight: 700, marginBottom: 6 }}>NEED HELP?</div>
          <div style={{ fontSize: 13, color: '#c9d6d0', lineHeight: 1.5 }}>
            Our team can help you get in over a call in Hindi.
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center" style={{ padding: 'clamp(22px,5.5vw,48px) clamp(18px,5vw,56px)' }}>
      <div className="card max-w-md w-full shadow-xl">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Sehatsandhi" className="h-14 mx-auto mb-4 lg:hidden" />
          <h1 className="text-2xl font-bold text-navy-700">{t('loginPage.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {step === 'phone'
              ? 'Enter the WhatsApp number you registered with'
              : `We sent a 6-digit code to ${phone}`}
          </p>
        </div>

        {showLegacy ? (
          <form onSubmit={legacyLogin} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">{t('loginPage.labelEmail')}</label>
              <input className="input-field" type="email" placeholder="doctor@clinic.com"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">{t('loginPage.labelPassword')}</label>
              <input className="input-field" type="password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-lg">{error}</p>}
            <button type="submit" disabled={busy} className="btn-teal w-full justify-center py-3 text-base disabled:opacity-60">
              {busy ? <><Spinner size={18} onDark label={t('loginPage.btnSigningIn')} /> {t('loginPage.btnSigningIn')}</> : t('loginPage.btnLogin')}
            </button>
            <button type="button" onClick={() => { setShowLegacy(false); setError('') }}
              className="w-full text-sm text-teal-600 py-1">
              Log in with my WhatsApp number instead
            </button>
          </form>
        ) : step === 'phone' ? (
          <form onSubmit={requestCode} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">WhatsApp number</label>
              <input className="input-field" type="tel" inputMode="tel" autoComplete="tel"
                placeholder="98765 43210" value={phone}
                onChange={e => setPhone(e.target.value)} required />
            </div>
            {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-lg">{error}</p>}
            <button type="submit" disabled={busy || phone.replace(/\D/g, '').length < 10}
              className="btn-teal w-full justify-center py-3 text-base disabled:opacity-60">
              {busy ? <><Spinner size={18} onDark label="Sending" /> Sending…</> : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            {notice && <p className="text-xs text-gray-500 text-center">{notice}</p>}
            {/* Sandbox only. The function returns the code when no WhatsApp or
                SMS provider is configured, so the flow is testable without one. */}
            {devCode && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 text-center">
                Test mode — your code is <strong>{devCode}</strong>
              </p>
            )}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">6-digit code</label>
              <input className="input-field text-center text-lg font-bold tracking-[0.4em]"
                inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                placeholder="000000" value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />
            </div>
            {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-lg">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6}
              className="btn-teal w-full justify-center py-3 text-base disabled:opacity-60">
              {busy ? <><Spinner size={18} onDark label="Checking" /> Checking…</> : 'Log in'}
            </button>
            <button type="button" onClick={() => { setStep('phone'); setCode(''); setError('') }}
              className="w-full text-sm text-gray-500 py-1">
              Use a different number
            </button>
          </form>
        )}

        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-gray-500">
            {t('loginPage.newDoctor')}{' '}
            <Link to="/business/register" className="text-teal-600 hover:underline font-medium">
              {t('loginPage.registerHere')}
            </Link>
          </p>
          {!showLegacy && (
            <button onClick={() => { setShowLegacy(true); setError('') }}
              className="text-xs text-gray-400 hover:text-gray-600">
              Registered before with an email and password?
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
