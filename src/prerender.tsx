import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { LanguageProvider } from './i18n/LanguageContext'
import About from './pages/About'
import Contact from './pages/Contact'
import PrivacyPolicy from './pages/PrivacyPolicy'
import Terms from './pages/Terms'
import RefundPolicy from './pages/RefundPolicy'
import DataDeletion from './pages/DataDeletion'
import { IntlHome, IntlPlanTrip, IntlHowWeCheck, IntlChecklists, IntlFaq } from './pages/international/IntlStatic'

// Renders the legal pages to static HTML at build time.
//
// Everything the site serves is one 1.9 kB shell — `<div id="root"></div>` and
// a script tag — because the app is client-rendered and vercel.json rewrites
// every path to it. A person with a browser sees the real page, but anything
// that does not run JavaScript sees nothing at all at /privacy. That is the
// most likely way a verification reviewer concludes a policy page is missing
// while we can plainly see it ourselves.
//
// Only these six routes are prerendered, and they are the ones that can be:
// their import graph is lucide, react-router, LanguageContext, types and the
// header/footer — no Supabase client, no analytics, no env resolution, nothing
// that needs a browser or a network call. The rest of the app stays a normal
// SPA.
//
// This is deliberately NOT hydration. main.tsx uses createRoot, not
// hydrateRoot, so React discards this markup and re-renders on boot — which is
// what makes it safe to render in English here while a Hindi-preferring
// visitor still gets Hindi a moment later. Switching main.tsx to hydrateRoot
// would turn that into a mismatch.

type Page = { path: string; title: string; description: string }

/** The routes to write, with the per-page metadata the shell cannot carry. */
export const PAGES: Page[] = [
  {
    path: '/about',
    title: 'About Sehatsandhi — operated by NG Technologies',
    description: 'Who we are: Sehatsandhi connects patients with verified doctors and healthcare partners over WhatsApp, and is operated by NG Technologies.',
  },
  {
    path: '/contact',
    title: 'Contact Sehatsandhi',
    description: 'Reach Sehatsandhi on WhatsApp or by email, with our registered office, GSTIN and business details.',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy — Sehatsandhi',
    description: 'What Sehatsandhi collects, how it is used, how long it is kept, and your rights under India’s Digital Personal Data Protection Act, 2023.',
  },
  {
    path: '/terms',
    title: 'Terms of Service — Sehatsandhi',
    description: 'The terms governing use of Sehatsandhi, operated by NG Technologies, for patients and for listed doctors and partners.',
  },
  {
    path: '/refund',
    title: 'Refund & Cancellation Policy — Sehatsandhi',
    description: 'Refund and cancellation terms for doctors and partners who pay a listing fee. Sehatsandhi is free for patients.',
  },
  {
    path: '/data-deletion',
    title: 'Data deletion — Sehatsandhi',
    description: 'How a business that connected its Facebook Page and Instagram to Sehatsandhi can delete that connection, and how to ask us to delete data.',
  },
  // 0312: the International portal's information pages (no data calls).
  {
    path: '/international',
    title: 'Treatment in India for international patients — Sehatsandhi International',
    description: 'Compare checked hospitals and costs across India — big metros, regional cities and smaller towns. Free quotes, visa letter, airport pickup and stay arranged.',
  },
  {
    path: '/international/plan-your-trip',
    title: 'Plan your medical trip to India — Sehatsandhi International',
    description: 'e-Medical visa steps, airports, travel by country, what to bring and when to come for treatment in India.',
  },
  {
    path: '/international/how-we-check',
    title: 'How we check hospitals — Sehatsandhi International',
    description: 'Only hospitals with in-patient beds, an ICU, valid licences, NABH accreditation and an international desk are listed, after documents, a video walkthrough and a signed agreement.',
  },
  {
    path: '/international/checklists',
    title: 'Patient checklists for treatment in India — Sehatsandhi International',
    description: 'What to do before you travel, on arrival, at discharge and back home.',
  },
  {
    path: '/international/faq',
    title: 'Questions about treatment in India — Sehatsandhi International',
    description: 'Prices, choosing a hospital, visas, payments, companions and complaints, answered.',
  },
]

const COMPONENTS: Record<string, () => JSX.Element> = {
  '/about': About,
  '/contact': Contact,
  '/privacy': PrivacyPolicy,
  '/terms': Terms,
  '/refund': RefundPolicy,
  '/data-deletion': DataDeletion,
  '/international': IntlHome,
  '/international/plan-your-trip': IntlPlanTrip,
  '/international/how-we-check': IntlHowWeCheck,
  '/international/checklists': IntlChecklists,
  '/international/faq': IntlFaq,
}

/** Render one route's body markup. Throws rather than emitting an empty page. */
export function render(path: string): string {
  const Page = COMPONENTS[path]
  if (!Page) throw new Error(`prerender: no component registered for ${path}`)

  // StaticRouter supplies the router context the shared header and footer need
  // for their <Link>s; LanguageProvider returns 'en' server-side by its own
  // typeof-window guard, so nothing here touches localStorage.
  return renderToStaticMarkup(
    <LanguageProvider>
      <StaticRouter location={path}>
        <Page />
      </StaticRouter>
    </LanguageProvider>,
  )
}
