import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { LanguageProvider } from './i18n/LanguageContext'
import { supabase } from './lib/supabase'
import { track } from './lib/analytics'
import { gaPageView } from './lib/ga'
import { startLocationTracking } from './lib/location'
import PatientHome from './pages/PatientHome'
import StagingBanner from './components/StagingBanner'
import { WA_NUMBER } from './types'

// Loaded on demand. Everything used to ship in one 865 kB chunk, so a patient
// opening the homepage from a WhatsApp link downloaded the admin dashboard, the
// billing screens and the signup wizard before seeing anything. PatientHome
// stays eager — it is the first paint for almost everyone who arrives.
const Browse = lazy(() => import('./pages/Browse'))
const SpecialityLanding = lazy(() => import('./pages/SpecialityLanding'))
const DoctorLogin = lazy(() => import('./pages/doctor/Login'))
const DoctorDashboard = lazy(() => import('./pages/doctor/Dashboard'))
const DoctorProfile = lazy(() => import('./pages/doctor/Profile'))
const BusinessLanding = lazy(() => import('./pages/business/BusinessLanding'))
const BusinessRegister = lazy(() => import('./pages/business/BusinessRegister'))
const InvoicePage = lazy(() => import('./pages/InvoicePage'))
const AdminLogin = lazy(() => import('./pages/admin/Login'))
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'))
// Legal/company pages. Linked from SiteFooter on every public page, and
// submitted directly to Meta and Razorpay, so each needs a stable public URL.
const About = lazy(() => import('./pages/About'))
const Contact = lazy(() => import('./pages/Contact'))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const Terms = lazy(() => import('./pages/Terms'))
const RefundPolicy = lazy(() => import('./pages/RefundPolicy'))

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
  const excluded = TRACK_EXCLUDED.some(p => pathname.startsWith(p))

  useEffect(() => {
    if (excluded) return
    track('page_view', { path: pathname })
    // GA4's snippet in index.html fires one page_view on load and never again,
    // so every client navigation after the first would be missing from GA
    // without this. Sent as a manual event with the path we resolved, not the
    // one gtag would read off the URL, so the two systems agree on what a page
    // view is and the admin/invoice exclusions above hold on both.
    gaPageView(pathname)
  }, [pathname, excluded])

  // Location is per visit, not per page, so this runs once and the module keeps
  // its own heartbeat afterwards. Not started at all if the visitor's first
  // landing is an excluded path — an admin session is not a visitor to map.
  useEffect(() => {
    if (excluded) return
    startLocationTracking()
  }, [excluded])

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

export default function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        {/* Outside <Routes> so the staging warning is present on every page. */}
        <StagingBanner />
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">
            Loading…
          </div>
        }>
        <Routes>
          {/* ── Customer flow ───────────────────────────────────────────────
              A patient arrives from a WhatsApp or SMS link, finds a clinic and
              taps through to it. One clean full-screen page, then the listing
              pages the search leads to — no site nav or footer anywhere in it. */}
          <Route path="/" element={<PatientHome />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/speciality/:specId/:areaSlug" element={<SpecialityLanding />} />
          <Route path="/doctor/:slug" element={<DoctorProfile />} />

          {/* ── Business flow ───────────────────────────────────────────────
              /business is the whole pitch on one page — how it works, pricing
              and who can list are anchors within it, not separate routes. The
              only places to go from there are register and log in. */}
          <Route path="/business" element={<BusinessLanding />} />
          <Route path="/business/register" element={<BusinessRegister />} />
          <Route path="/business/login" element={<DoctorLogin />} />
          <Route path="/business/dashboard" element={<DoctorDashboard />} />

          {/* Tax invoice, opened by unguessable token from a WhatsApp or email
              link — so deliberately no login and no site nav. */}
          <Route path="/invoice/:token" element={<InvoicePage />} />

          {/* ── Legal ──────────────────────────────────────────────────────
              Reachable from SiteFooter on every public page. Meta's business
              verification and Razorpay's merchant checks both open these
              directly, so the paths are stable and each page stands alone. */}
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/refund" element={<RefundPolicy />} />
          {/* Aliases. The catch-all below sends an unknown path to the homepage,
              so a reviewer typing the long form of one of these would land on a
              landing page and conclude the policy does not exist. */}
          <Route path="/contact-us" element={<Navigate to="/contact" replace />} />
          <Route path="/privacy-policy" element={<Navigate to="/privacy" replace />} />
          <Route path="/terms-and-conditions" element={<Navigate to="/terms" replace />} />
          <Route path="/terms-of-service" element={<Navigate to="/terms" replace />} />
          <Route path="/refund-policy" element={<Navigate to="/refund" replace />} />
          <Route path="/cancellation-policy" element={<Navigate to="/refund" replace />} />

          {/* Old paths, kept as redirects: they are in customers' WhatsApp
              history and on anything already printed. */}
          <Route path="/doctor/login" element={<Navigate to="/business/login" replace />} />
          <Route path="/doctor/dashboard" element={<Navigate to="/business/dashboard" replace />} />

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
