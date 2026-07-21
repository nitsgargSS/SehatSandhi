import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageContext'
import LanguageSwitcher from '../../components/LanguageSwitcher'

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'admin@sehatsandhi.com'
const ADMIN_PASS  = import.meta.env.VITE_ADMIN_PASS  || 'admin@SS2026'

export default function AdminLogin() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
      sessionStorage.setItem('admin_auth', 'true')
      navigate('/ng-ctrl-2026/dashboard')
    } else {
      setError(t('adminLoginPage.errorInvalid'))
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
          <button type="submit" className="btn-teal w-full justify-center py-3">{t('adminLoginPage.btnLogin')}</button>
        </form>
        <p className="text-xs text-gray-400 text-center mt-4">{t('adminLoginPage.footerNote')}</p>
      </div>
    </div>
  )
}
