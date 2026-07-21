import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../i18n/LanguageContext'

export default function DoctorLogin() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError(err.message); setLoading(false) }
    else navigate('/doctor/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 pt-16">
      <div className="card max-w-md w-full shadow-xl">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Sehatsandhi" className="h-14 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-navy-700">{t('loginPage.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">{t('loginPage.subtitle')}</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
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
          <button type="submit" disabled={loading} className="btn-teal w-full justify-center py-3 text-base mt-2 disabled:opacity-60">
            {loading ? t('loginPage.btnSigningIn') : t('loginPage.btnLogin')}
          </button>
        </form>
        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-gray-500">
            {t('loginPage.newDoctor')} <Link to="/doctor" className="text-teal-600 hover:underline font-medium">{t('loginPage.registerHere')}</Link>
          </p>
          <button className="text-xs text-gray-400 hover:text-gray-600">{t('loginPage.forgotPassword')}</button>
        </div>
      </div>
    </div>
  )
}
