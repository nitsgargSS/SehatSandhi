import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { HelpCircle, LogOut } from 'lucide-react'
import SiteHeader, { HeaderLink } from '../../components/SiteHeader'
import SiteFooter from '../../components/SiteFooter'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { useLanguage } from '../../i18n/LanguageContext'
import { careMe, partnerSignOut, usePartnerProgramEnabled, type CareMe } from '../../lib/careApi'

// The frame of every /partner page (Care Partner Program, 0331): the site
// header with the language switch, the "what to do next" banner from the
// partner's status (brief §14.1), a Help button on every page (it opens the
// Help Center now and becomes the in-page chat later), and the gates:
//   needs = 'none'        public page
//   needs = 'login'       signed in with a partner login
//   needs = 'registered'  signed in and registered
// While the program is switched off the gated pages say it opens soon.

const MeCtx = createContext<{ me: CareMe; reload: () => Promise<void> } | null>(null)
export const usePartnerMe = () => useContext(MeCtx)!

/** Hindi or English, by the site language. */
export function useTx() {
  const { lang } = useLanguage()
  return { lang, tx: (en: string, hi: string) => (lang === 'hi' ? hi : en) }
}

export default function PartnerShell({ title, titleHi, needs = 'none', banner = true, children }: {
  title: string; titleHi: string; needs?: 'none' | 'login' | 'registered'; banner?: boolean; children: React.ReactNode
}) {
  const { tx } = useTx()
  const enabled = usePartnerProgramEnabled()
  const [me, setMe] = useState<CareMe | null>(null)
  const navigate = useNavigate()
  const loc = useLocation()
  const reload = useCallback(async () => { setMe(await careMe().catch(() => ({ signed_in: false }))) }, [])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { document.title = `${tx(title, titleHi)} · Sehatsandhi` }, [title, titleHi, tx])

  const gate = () => {
    // Switched off: every partner page, public ones included, only says it opens soon.
    if (enabled === false) return <ClosedNote />
    if (needs === 'none') return null
    if (enabled === null || me === null) return <p className="text-gray-400">{tx('Loading…', 'लोड हो रहा है…')}</p>
    if (!me.signed_in) return <Navigate to={`/partner/login?next=${encodeURIComponent(loc.pathname + loc.hash)}`} replace />
    if (needs === 'registered' && !me.registered) return <Navigate to="/partner/register" replace />
    return null
  }
  const blocked = gate()
  const next = me?.signed_in ? me.next : undefined

  return (
    <div className="min-h-screen bg-[#FBF7F0] flex flex-col">
      <SiteHeader>
        <HeaderLink to="/partner">{tx('Partner Program', 'पार्टनर प्रोग्राम')}</HeaderLink>
        <LanguageSwitcher />
        {me?.signed_in && (
          <button onClick={async () => { await partnerSignOut(); await reload(); navigate('/partner') }}
            className="text-sm font-bold text-gray-500 inline-flex items-center gap-1 hover:text-gray-700">
            <LogOut className="w-4 h-4" /> {tx('Sign out', 'साइन आउट')}
          </button>
        )}
      </SiteHeader>
      <main className="w-full max-w-3xl mx-auto px-4 py-6 flex-1 flex flex-col gap-4">
        {banner && next && me?.registered && !blocked && (
          <Link to={next.path} className="rounded-2xl bg-teal-700 text-white p-4 flex items-center justify-between gap-3 hover:bg-teal-800">
            <span className="text-[15px] leading-snug">
              <span className="block text-xs uppercase tracking-wide text-teal-100">{tx('What to do next', 'आगे क्या करें')}</span>
              {tx(next.en, next.hi)}
              {next.total ? <span className="block text-xs text-teal-100 mt-0.5">{tx(`${next.done} of ${next.total} modules done`, `${next.total} में से ${next.done} मॉड्यूल पूरे`)}</span> : null}
            </span>
            <span className="text-2xl" aria-hidden>›</span>
          </Link>
        )}
        <h1 className="text-2xl font-bold text-navy-700">{tx(title, titleHi)}</h1>
        {blocked ?? (needs === 'none' || !me ? children : <MeCtx.Provider value={{ me, reload }}>{children}</MeCtx.Provider>)}
      </main>
      {/* Help on every page: the Help Center now, the in-page chat later (brief §15.3). */}
      {loc.pathname !== '/partner/help' && enabled && (
        <Link to="/partner/help" className="fixed bottom-4 right-4 z-40 rounded-full bg-navy-700 text-white shadow-lg px-4 py-3 text-sm font-semibold inline-flex items-center gap-2 min-h-[48px]">
          <HelpCircle className="w-5 h-5" /> {tx('Help', 'मदद')}
        </Link>
      )}
      <SiteFooter emailOnly />
    </div>
  )
}

export function ClosedNote() {
  const { tx } = useTx()
  return (
    <div className="card text-gray-700">
      <p className="font-semibold text-navy-700">{tx('The Sehatsandhi Partner Program opens soon.', 'सेहतसंधि पार्टनर प्रोग्राम जल्द शुरू होगा।')}</p>
      <p className="text-sm mt-1">{tx('Please check back later.', 'कृपया बाद में देखें।')}</p>
    </div>
  )
}
