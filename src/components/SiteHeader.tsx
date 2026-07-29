import { Link } from 'react-router-dom'

// One header for every public page.
//
// There used to be a different one per page: the patient home drew a 59px
// lockup with a pill CTA, /business a 50px lockup with a square one, and the
// login and wizard pages a stacked logo of their own. Same brand, four sizes,
// three button shapes — the kind of drift nobody decides on, it just
// accumulates. This is the single definition; pages supply what goes on the
// right and nothing else.
//
// Deliberately not a router-aware navbar: the pages that use it have almost
// nothing in common besides the logo, so the links belong to them, not here.

export const HEADER = {
  green: '#0E9F6E',
  ink: '#14201c',
  muted: '#5f6b64',
  cream: '#FBF7F0',
  border: '#ece5d7',
  logoHeight: 50,
} as const

/**
 * The page gutter, shared by the header and whatever a page puts under it.
 *
 * Every page used to pick its own: the patient home 1120px, /business
 * max-w-7xl (1280), the speciality results max-w-4xl (896), a doctor's profile
 * max-w-3xl (768) — while the header stayed 1280 on all of them. So on three
 * pages out of four the logo sat some 250px to the left of the content it was
 * supposed to be sitting above.
 *
 * One width, applied in both places, so the left edge is a straight line down
 * the page. Reading measures still differ where they should — a profile keeps
 * its narrow column — but by capping the content INSIDE this shell, not by
 * moving the shell.
 */
export const PAGE = {
  maxWidth: 1120,
  padX: 'clamp(16px,4vw,40px)',
} as const

/** The shell every page's own sections should sit in, so edges line up. */
export function PageShell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ maxWidth: PAGE.maxWidth, margin: '0 auto', paddingLeft: PAGE.padX, paddingRight: PAGE.padX, ...style }}>
      {children}
    </div>
  )
}

/** The brand lockup: symbol + wordmark at one matched height. */
export function BrandMark({ height = HEADER.logoHeight, to = '/' }: { height?: number; to?: string }) {
  return (
    <Link to={to} style={{ display: 'flex', alignItems: 'center', gap: height * 0.24, flex: '0 0 auto' }}>
      <img src="/logo-only-symbol.png" alt="" aria-hidden
        style={{ height, width: 'auto', objectFit: 'contain' }} />
      <img src="/logo-title.png" alt="Sehatsandhi"
        style={{ height, width: 'auto', objectFit: 'contain' }} />
    </Link>
  )
}

/** A text link in the header row. */
export function HeaderLink({ href, to, children }: { href?: string; to?: string; children: React.ReactNode }) {
  const style = { fontSize: 14, fontWeight: 700, color: HEADER.muted, whiteSpace: 'nowrap' as const }
  return to ? <Link to={to} style={style}>{children}</Link> : <a href={href} style={style}>{children}</a>
}

/** The filled action at the end of the row. One shape everywhere: pill, 14/800. */
export function HeaderCta({ to, children, icon }: { to: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Link to={to} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      background: HEADER.green, color: '#fff', fontWeight: 800, fontSize: 14,
      padding: '10px 18px', borderRadius: 999, whiteSpace: 'nowrap',
      boxShadow: '0 8px 18px -8px rgba(14,159,110,.7)',
    }}>
      {icon}
      {children}
    </Link>
  )
}

/** The shop icon used by the business CTA, so both sides of the site show it. */
export const shopIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
    strokeLinecap="round" strokeLinejoin="round"
    style={{ width: 16, height: 16, flex: '0 0 auto' }}>
    <path d="M3 9.5 5 4h14l2 5.5" /><path d="M4 9.5h16V20H4z" /><path d="M9.5 20v-5h5v5" />
  </svg>
)

/**
 * The header row itself. `sticky` for pages whose nav links are anchors into
 * the same page — scrolling to Pricing and then wanting Partners should not
 * mean scrolling back up.
 */
export default function SiteHeader(
  { children, sticky, logoTo = '/' }:
  { children?: React.ReactNode; sticky?: boolean; logoTo?: string },
) {
  return (
    <div style={{
      ...(sticky ? { position: 'sticky' as const, top: 0, zIndex: 40 } : null),
      background: HEADER.cream, borderBottom: `1px solid ${HEADER.border}`,
    }}>
      <div className="flex-wrap"
        style={{
          maxWidth: PAGE.maxWidth, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, paddingLeft: PAGE.padX, paddingRight: PAGE.padX,
          paddingTop: 'clamp(12px,3vw,16px)', paddingBottom: 'clamp(12px,3vw,16px)',
        }}>
        <BrandMark to={logoTo} />
        <div className="flex-wrap" style={{ display: 'flex', alignItems: 'center', gap: 'clamp(12px,3vw,22px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
