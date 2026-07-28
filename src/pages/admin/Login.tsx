import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageContext'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { supabase } from '../../lib/supabase'

// Authentication happens in Supabase Auth, against a hashed password, server
// side. The previous version compared against VITE_ADMIN_EMAIL/VITE_ADMIN_PASS —
// which Vite compiles into the public bundle, so the credentials shipped to
// every visitor and anyone could set sessionStorage.admin_auth and walk in.
//
// Being a valid user is not enough: every business owner with a clinic login is
// also a Supabase Auth user. Authorisation is membership of admin_users, which
// is checked here for a clear error and enforced by RLS on every table besides.

export default function AdminLogin() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim(), password,
      })
      if (authErr || !data.session) {
        setError(t('adminLoginPage.errorInvalid'))
        return
      }

      const { data: admin } = await supabase
        .from('admin_users').select('role').eq('auth_uid', data.user.id).maybeSingle()

      if (!admin) {
        // Signed in as a real user, but not an admin. Drop the session rather
        // than leave a half-privileged one lying around in this tab.
        await supabase.auth.signOut()
        setError(t('adminLoginPage.errorInvalid'))
        return
      }

      navigate('/ng-ctrl-2026/dashboard')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-navy-700 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm relative">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <img src="/logo.png" alt="Sehatsandhi" className="h-12 mx-auto mb-6" />
        <h2 className="text-xl font-bold text-navy-700 text-center mb-6">{t('adminLoginPage.title')}</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminLoginPage.labelEmail')}</label>
            <input className="input-field" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">{t('adminLoginPage.labelPassword')}</label>
            <input className="input-field" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button type="submit" disabled={busy}
            className="btn-teal w-full justify-center py-3 disabled:opacity-60">
            {busy ? '…' : t('adminLoginPage.btnLogin')}
          </button>
        </form>
        <p className="text-xs text-gray-400 text-center mt-4">{t('adminLoginPage.footerNote')}</p>
      </div>
    </div>
  )
}
