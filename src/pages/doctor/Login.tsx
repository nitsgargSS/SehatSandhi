import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../i18n/LanguageContext'
import { BIZ } from '../business/shared'
import SiteFooter from '../../components/SiteFooter'
import EmailSignIn from '../../components/EmailSignIn'
import IdleNotice from '../../components/IdleNotice'
import { fetchPasswordState, mustChangeNow } from '../../lib/passwordState'

// Sign in with email and password, or a code sent by email or WhatsApp.
//
// 0079 made email mandatory at registration, so this is now the default for
// everybody — doctor, business, staff — and it is the same EmailSignIn
// component the admin panel uses, so the password rules, the emailed code and
// the forgotten-password path have one implementation rather than two that
// drift apart.
//
// A code on WhatsApp is the third way in, inside the same form (its whatsapp
// prop). It used to be a separate flow on this page, kept for the accounts
// that registered before 0079 with no email; folded into EmailSignIn it also
// serves everyone else — and it is the way in when email delivery is down.
//
// The order used to be the other way round, and for a good reason at the time:
// the signup wizard collected email as optional and created no account, so
// anyone who joined through it had no credentials at all. 0079 fixed the cause,
// which is what makes email-first possible now.

export default function DoctorLogin() {
  const { t } = useLanguage()
  const navigate = useNavigate()

  return (
    // Same shell as the business wizard: cream page, dark rail carrying the
    // logo, and no site navbar. This page used to render inside the marketing
    // layout, whose fixed navbar overlapped the card — and a signed-out clinic
    // does not need "Book on WhatsApp" or "Register Clinic" above its own login
    // form anyway. See /business/register, which this mirrors.
    //
    // The rail and the form stay a two-column grid; the page around them is a
    // flex column, so the footer sits below both at full width rather than
    // inside either column.
    <div style={{ background: BIZ.cream }} className="min-h-screen flex flex-col">
      <div className="grid lg:grid-cols-[300px_1fr] flex-1">
      <div className="hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen"
        style={{ background: BIZ.ink, padding: '36px 30px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}>
          <Link to="/" aria-label="Sehatsandhi — home" className="inline-flex"><img src="/logo-tight.png" alt="Sehatsandhi"
            style={{ height: 132, width: 'auto', objectFit: 'contain', borderRadius: 16, background: BIZ.cream, padding: '16px 20px' }} /></Link>
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
          <Link to="/" aria-label="Sehatsandhi — home" className="block"><img src="/logo.png" alt="Sehatsandhi" className="h-14 mx-auto mb-4 lg:hidden" /></Link>
          <h1 className="text-2xl font-bold text-navy-700">{t('loginPage.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">
            Sign in with the email address or WhatsApp number you registered with
          </p>
        </div>

        <IdleNotice />

        <div className="space-y-4">
            {/* Nothing here decides who gets in — EmailSignIn proves the
                address, and this decides what that entitles them to. A valid
                Supabase user with no listing and no affiliation is somebody
                else's patient account, not a clinic. */}
            <EmailSignIn
              whatsapp
              submitLabel={t('loginPage.btnLogin')}
              onSignedIn={async () => {
                // Before the clinic check, not after: 0081 empties
                // sehat_caller_business_ids() for an expired password, so this
                // would otherwise say "not attached to a clinic" and sign them
                // out — turning an expired password into a lost account.
                if (mustChangeNow(await fetchPasswordState())) {
                  navigate('/business/dashboard')
                  return null
                }
                const { data: ids, error: idsErr } = await supabase.rpc('sehat_caller_business_ids')
                if (idsErr) return 'We could not check your account just now. Please try again.'
                if (!ids || (ids as unknown[]).length === 0) {
                  return 'That account is not attached to a clinic. If you have just registered, we are still reviewing it.'
                }
                navigate('/business/dashboard')
                return null
              }}
            />
        </div>

        <div className="mt-6 text-center space-y-2">
          <p className="text-sm text-gray-500">
            {t('loginPage.newDoctor')}{' '}
            <Link to="/business/register" className="text-teal-600 hover:underline font-medium">
              {t('loginPage.registerHere')}
            </Link>
          </p>
        </div>
      </div>
      </div>
      </div>

      <SiteFooter />
    </div>
  )
}
