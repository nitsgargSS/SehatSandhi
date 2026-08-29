import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../../i18n/LanguageContext'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import EmailSignIn from '../../components/EmailSignIn'
import { supabase } from '../../lib/supabase'

// Authentication happens in Supabase Auth, against a hashed password, server
// side. The previous version compared against VITE_ADMIN_EMAIL/VITE_ADMIN_PASS —
// which Vite compiles into the public bundle, so the credentials shipped to
// every visitor and anyone could set sessionStorage.admin_auth and walk in.
//
// Being a valid user is not enough: every business owner with a clinic login is
// also a Supabase Auth user. Authorisation is membership of admin_users, which
// is checked in onSignedIn for a clear error and enforced by RLS on every table
// besides.
//
// The form itself is EmailSignIn, the same component the clinic side uses — so
// password rules, the emailed code and the forgotten-password path are one
// implementation rather than two that drift.

export default function AdminLogin() {
  const { t } = useLanguage()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-navy-700 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm relative">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <img src="/logo.png" alt="Sehatsandhi" className="h-12 mx-auto mb-6" />
        <h2 className="text-xl font-bold text-navy-700 text-center mb-6">{t('adminLoginPage.title')}</h2>

        <EmailSignIn
          submitLabel={t('adminLoginPage.btnLogin')}
          onSignedIn={async (userId) => {
            const { data: admin } = await supabase
              .from('admin_users').select('role').eq('auth_uid', userId).maybeSingle()
            // A real user who is not an admin. EmailSignIn drops the session on
            // a non-null answer, so no half-privileged session is left in this
            // tab — and the wording does not confirm that the account exists.
            if (!admin) return t('adminLoginPage.errorInvalid')
            navigate('/ng-ctrl-2026/dashboard')
            return null
          }}
        />

        <p className="text-xs text-gray-400 text-center mt-4">{t('adminLoginPage.footerNote')}</p>
      </div>
    </div>
  )
}
