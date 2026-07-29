import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { LanguageProvider } from './i18n/LanguageContext'
import { supabase } from './lib/supabase'
import { track } from './lib/analytics'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import PatientHome from './pages/PatientHome'
import EnvBanner from './components/EnvBanner'
import { WA_NUMBER } from './types'

// Loaded on demand. Everything used to ship in one 865 kB chunk, so a patient
// opening the homepage from a WhatsApp link downloaded the admin dashboard, the
// billing screens and the signup wizard before seeing anything. PatientHome
// stays eager — it is the first paint for almost everyone who arrives.
const Landing = lazy(() => import('./pages/Landing'))
const HowItWorks = lazy(() => import('./pages/HowItWorks'))
const Partners = lazy(() => import('./pages/Partners'))
const ForDoctors = lazy(() => import('./pages/ForDoctors'))
const ForPharmacy = lazy(() => import('./pages/ForPharmacy'))
const ForLabs = lazy(() => import('./pages/ForLabs'))
const ForAmbulance = lazy(() => import('./pages/ForAmbulance'))
const ForInsurance = lazy(() => import('./pages/ForInsurance'))
const ForHospitals = lazy(() => import('./pages/ForHospitals'))
const SpecialityLanding = lazy(() => import('./pages/SpecialityLanding'))
const Register = lazy(() => import('./pages/doctor/Register'))
const DoctorLogin = lazy(() => import('./pages/doctor/Login'))
const DoctorDashboard = lazy(() => import('./pages/doctor/Dashboard'))
const DoctorProfile = lazy(() => import('./pages/doctor/Profile'))
const Points = lazy(() => import('./pages/Points'))
const PartnerRegister = lazy(() => import('./pages/Partner'))
const BusinessLanding = lazy(() => import('./pages/business/BusinessLanding'))
const BusinessRegister = lazy(() => import('./pages/business/BusinessRegister'))
const InvoicePage = lazy(() => import('./pages/InvoicePage'))
const AdminLogin = lazy(() => import('./pages/admin/Login'))
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'))

// ── SECURITY: Admin URL is intentionally non-obvious ──
// Never link this path from Navbar, Footer, sitemap,
// or any public page. Bookmark it privately.
const ADMIN_PATH = 'ng-ctrl-2026'

// Gate on a real Supabase session plus admin_users membership, not on a
// sessionStorage flag anyone could set from the console. Both checks are
// asynchronous, so the guard renders nothing until it knows — bouncing to the
// login page while the session is still loading would sign the admin out on
// every refresh.
//
// This is defence in depth, not the defence itself: RLS is what actually stops
// a non-admin reading anything (migration 0012). Editing this component in
// devtools gets you an empty dashboard.
const AdminGuard = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking')

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (!session) { setState('out'); return }
      const { data } = await supabase
        .from('admin_users').select('role').eq('auth_uid', session.user.id).maybeSingle()
      if (!cancelled) setState(data ? 'in' : 'out')
    }
    check()
    // Signing out in another tab should close this one too.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) setState('out')
    })
    return () => { cancelled = true; sub.subscription.unsubscribe() }
  }, [])

  if (state === 'checking') {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">…</div>
  }
  return state === 'in' ? <>{children}</> : <Navigate to={`/${ADMIN_PATH}`} replace />
}

// Global floating WhatsApp button. Hidden on the business onboarding wizard:
// that flow has its own "Activate on WhatsApp" action, and the floater sits on
// top of the step footer's buttons.
const FLOAT_HIDDEN_PATHS = ['/business/register']

// One page_view per route change. Placed inside the router so it sees client
// navigations, which never reload the page and would otherwise go uncounted.
// Admin and invoice paths are skipped: those are our own screens and a customer's
// private link, neither of which belongs in product analytics.
const TRACK_EXCLUDED = [`/${ADMIN_PATH}`, '/invoice/']

const PageViewTracker = () => {
  const { pathname } = useLocation()
  useEffect(() => {
    if (TRACK_EXCLUDED.some(p => pathname.startsWith(p))) return
    track('page_view', { path: pathname })
  }, [pathname])
  return null
}

const WhatsAppFloat = () => {
  const { pathname } = useLocation()
  if (FLOAT_HIDDEN_PATHS.includes(pathname)) return null
  return (
    <a href={`https://wa.me/${WA_NUMBER}?text=Namaste!`}
       target="_blank" rel="noreferrer"
       onClick={() => track('whatsapp_click', { path: pathname })}
       className="fixed bottom-6 right-6 w-14 h-14 bg-[#25D366] rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform z-50"
       title="Book appointment on WhatsApp">
      <svg className="w-7 h-7 text-white fill-current" viewBox="0 0 24 24">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    </a>
  )
}

// The navbar is sticky rather than fixed, so it occupies real height and the
// page below simply follows it. Pages used to reserve pt-16 (64px) by hand for
// a bar that is h-20 (80px) tall — the top 16px of every page sat underneath
// it, and in a sandbox session the banner hid ~40px of the navbar itself. Both
// went away with the layout doing the spacing instead of each page guessing.
const WithLayout = ({ children }: { children: React.ReactNode }) => (
  <>
    <Navbar />
    {children}
    <Footer />
  </>
)

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        {/* Outside <Routes> so the sandbox warning is present on every page,
            including the full-bleed ones that opt out of Navbar/Footer. */}
        <EnvBanner />
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
            Loading…
          </div>
        }>
        <Routes>
          {/* Public — new Warm Care customer homepage (Sehatsandhi.dc.html).
              No site nav/footer: patients land here from a WhatsApp/SMS link
              and need one clean, full-screen mobile page. */}
          <Route path="/" element={<PatientHome />} />
          {/* Previous landing, kept and reachable (not deleted) */}
          <Route path="/landing-old" element={<WithLayout><Landing /></WithLayout>} />
          <Route path="/how-it-works" element={<WithLayout><HowItWorks /></WithLayout>} />
          <Route path="/partners" element={<WithLayout><Partners /></WithLayout>} />
          <Route path="/for-doctors" element={<WithLayout><ForDoctors /></WithLayout>} />
          <Route path="/for-pharmacy" element={<WithLayout><ForPharmacy /></WithLayout>} />
          <Route path="/for-labs" element={<WithLayout><ForLabs /></WithLayout>} />
          <Route path="/for-ambulance" element={<WithLayout><ForAmbulance /></WithLayout>} />
          <Route path="/for-insurance" element={<WithLayout><ForInsurance /></WithLayout>} />
          <Route path="/for-hospitals" element={<WithLayout><ForHospitals /></WithLayout>} />
          <Route path="/speciality/:specId/:areaSlug" element={<WithLayout><SpecialityLanding /></WithLayout>} />
          <Route path="/points" element={<WithLayout><Points /></WithLayout>} />
          <Route path="/partner" element={<WithLayout><PartnerRegister /></WithLayout>} />

          {/* New design (Sehatsandhi.dc.html) — Warm Care look, own palette. */}
          <Route path="/home-v2" element={<Navigate to="/" replace />} />
          <Route path="/business" element={<BusinessLanding />} />
          <Route path="/business/register" element={<BusinessRegister />} />

          {/* Tax invoice, opened by unguessable token from a WhatsApp or email
              link — so deliberately no login and no site nav. */}
          <Route path="/invoice/:token" element={<InvoicePage />} />

          {/* Doctor */}
          <Route path="/doctor" element={<WithLayout><Register /></WithLayout>} />
          {/* No marketing navbar: this page carries the business wizard's own
              shell, the same as /business/register. */}
          <Route path="/doctor/login" element={<DoctorLogin />} />
          <Route path="/doctor/dashboard" element={<WithLayout><DoctorDashboard /></WithLayout>} />
          <Route path="/doctor/:slug" element={<WithLayout><DoctorProfile /></WithLayout>} />

          {/* Admin — hidden, never linked publicly */}
          <Route path={`/${ADMIN_PATH}`} element={<AdminLogin />} />
          <Route path={`/${ADMIN_PATH}/dashboard`} element={<AdminGuard><AdminDashboard /></AdminGuard>} />

          {/* Legacy /admin path — redirect to home, don't reveal new path */}
          <Route path="/admin" element={<Navigate to="/" replace />} />
          <Route path="/admin/dashboard" element={<Navigate to="/" replace />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>

        <PageViewTracker />
        <WhatsAppFloat />
      </BrowserRouter>
    </LanguageProvider>
  )
}
