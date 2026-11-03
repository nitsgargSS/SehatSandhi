import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, X, MessageCircle, ShieldCheck, HeartHandshake } from 'lucide-react'
import { intlWaLink, INTL_EMAIL } from '../../lib/intlContent'

// The frame of every International page: calm, warm, one clear next step.
// No Supabase import — the static pages under it are prerendered.

export const C = {
  ink: '#14201c', green: '#0E9F6E', greenDark: '#0b7f58', cream: '#FBF7F0', sand: '#F3EADB',
  border: '#ece5d7', muted: '#5f6b64', soft: '#E7F4EC',
} as const

const NAV = [
  { to: '/international/compare', label: 'Compare & choose' },
  { to: '/international/treatments', label: 'Treatments' },
  { to: '/international/hospitals', label: 'Hospitals' },
  { to: '/international/savings', label: 'Savings' },
  { to: '/international/articles', label: 'Articles' },
  { to: '/international/plan-your-trip', label: 'Plan your trip' },
  { to: '/international/how-we-check', label: 'How we check' },
  { to: '/international/faq', label: 'FAQ' },
]

export function useTitle(title: string) {
  useEffect(() => { document.title = `${title} · Sehatsandhi International` }, [title])
}

export function Wrap({ children, narrow = false, className = '' }: { children: React.ReactNode; narrow?: boolean; className?: string }) {
  return <div className={`mx-auto w-full ${narrow ? 'max-w-3xl' : 'max-w-6xl'} px-4 sm:px-6 ${className}`}>{children}</div>
}

export function PageHead({ kicker, title, lead }: { kicker?: string; title: string; lead?: string }) {
  return (
    <div style={{ background: C.sand }} className="border-b" >
      <Wrap className="py-10 sm:py-14">
        {kicker && <p className="text-sm font-semibold uppercase tracking-wide mb-2" style={{ color: C.green }}>{kicker}</p>}
        <h1 className="text-3xl sm:text-4xl font-bold leading-tight" style={{ color: C.ink }}>{title}</h1>
        {lead && <p className="mt-3 text-lg max-w-2xl leading-relaxed" style={{ color: C.muted }}>{lead}</p>}
      </Wrap>
    </div>
  )
}

export function CtaButton({ to, children, light = false }: { to: string; children: React.ReactNode; light?: boolean }) {
  return (
    <Link to={to}
      className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-semibold transition-colors text-center"
      style={light ? { background: '#fff', color: C.green, border: `1.5px solid ${C.green}` } : { background: C.green, color: '#fff' }}>
      {children}
    </Link>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 sm:p-6 ${className}`} style={{ border: `1px solid ${C.border}` }}>{children}</div>
}

export default function IntlLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return (
    <div className="min-h-screen flex flex-col" style={{ background: C.cream, color: C.ink }}>
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur" style={{ borderBottom: `1px solid ${C.border}` }}>
        <Wrap className="flex items-center justify-between gap-3 h-16">
          <Link to="/international" className="flex items-center gap-2 shrink-0" onClick={() => setOpen(false)}>
            <img src="/logo-only-symbol.png" alt="" aria-hidden className="h-9 w-auto" />
            <span className="leading-tight min-w-0">
              <img src="/logo-title.png" alt="Sehatsandhi" className="h-6 w-auto block" />
              <span className="block text-xs font-semibold tracking-wide" style={{ color: C.green }}>INTERNATIONAL</span>
            </span>
          </Link>
          <nav className="hidden min-[1360px]:flex items-center gap-0.5 text-[15px] whitespace-nowrap">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to}
                className={({ isActive }) => `px-2.5 py-2 rounded-full ${isActive ? 'font-semibold' : ''}`}
                style={({ isActive }) => ({ color: isActive ? C.green : C.ink, background: isActive ? C.soft : 'transparent' })}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/international/quote" className="hidden sm:inline-flex whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: C.green }}>
              Get a free quote
            </Link>
            <button className="min-[1360px]:hidden p-2 rounded-lg" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(o => !o)}>
              {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </Wrap>
        {open && (
          <div className="min-[1360px]:hidden bg-white" style={{ borderTop: `1px solid ${C.border}` }}>
            <Wrap className="py-3 flex flex-col">
              {NAV.map(n => (
                <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)} className="py-3 text-lg" style={{ borderBottom: `1px solid ${C.border}` }}>
                  {n.label}
                </NavLink>
              ))}
              <Link to="/international/quote" onClick={() => setOpen(false)} className="mt-4 mb-2 rounded-full px-4 py-3 text-center font-semibold text-white" style={{ background: C.green }}>
                Get a free quote
              </Link>
            </Wrap>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-16" style={{ background: C.ink, color: '#d8e0db' }}>
        <Wrap className="py-10 grid gap-8 sm:grid-cols-3 text-[15px]">
          <div>
            <p className="font-semibold text-white mb-2 flex items-center gap-2"><HeartHandshake className="w-5 h-5" /> Sehatsandhi International</p>
            <p className="leading-relaxed">We help patients from abroad compare checked hospitals across India and look after their whole trip. You always choose; no hospital pays to appear higher.</p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-semibold text-white">Explore</p>
            {NAV.map(n => <Link key={n.to} to={n.to} className="hover:underline">{n.label}</Link>)}
            <Link to="/international/costs" className="hover:underline">Stay costs</Link>
            <Link to="/international/checklists" className="hover:underline">Patient checklists</Link>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-semibold text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Help and complaints</p>
            <p>WhatsApp: <a className="underline" href={intlWaLink()} target="_blank" rel="noreferrer">+91 87087 18705</a></p>
            <p>Grievance Officer: <a className="underline" href={`mailto:${INTL_EMAIL}`}>{INTL_EMAIL}</a></p>
            <p className="text-sm opacity-80">We acknowledge complaints within 24 hours and resolve them within 15 days.</p>
            <div className="flex gap-3 text-sm mt-2">
              <Link to="/privacy" className="underline">Privacy</Link>
              <Link to="/terms" className="underline">Terms</Link>
              <Link to="/" className="underline">Sehatsandhi home</Link>
            </div>
          </div>
        </Wrap>
        <Wrap className="pb-8 text-sm opacity-70">
          Sehatsandhi is operated by NG Technologies, 1743 Vishnu Garden, Jagadhri – 135003, Haryana, India. Medical care is given by the hospitals; prices are estimates until the hospital’s written quote.
        </Wrap>
      </footer>

      <a href={intlWaLink()} target="_blank" rel="noreferrer" aria-label="Chat with us on WhatsApp"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-white shadow-lg"
        style={{ background: '#25D366' }}>
        <MessageCircle className="w-5 h-5" /> <span className="font-semibold hidden sm:inline">Chat with us</span>
      </a>
    </div>
  )
}
