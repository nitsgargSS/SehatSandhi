import { isSandbox, switchEnv, SANDBOX_AVAILABLE } from '../lib/env'

// A permanent, non-dismissible marker that this session is NOT production.
//
// The whole point of running sandbox on the production URL is convenience —
// which is also the risk: the page looks exactly like the real site. Someone
// demoing to a customer, or debugging a support ticket, must never mistake one
// for the other. So this cannot be closed, sits above everything, and stays put
// while scrolling.
//
// Renders nothing in production, so the prod bundle carries an unused component
// and no layout shift.

export default function EnvBanner() {
  if (!SANDBOX_AVAILABLE) return null

  // On a dev server, offer a way INTO sandbox. Without this the only entry
  // point is typing ?env=sandbox by hand, which is friction every single time
  // you want to test. Deliberately dev-only (import.meta.env.DEV is false in
  // any built bundle) so a deployed site never shows a control that points at
  // the test database — there, ?env=sandbox remains the deliberate way in.
  if (!isSandbox()) {
    if (!import.meta.env.DEV) return null
    return (
      <button
        onClick={() => switchEnv('sandbox')}
        title="Point this tab at the sandbox database"
        style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 60,
          background: '#fff', color: '#a21caf',
          border: '2px solid #a21caf', borderRadius: 999,
          padding: '9px 16px', fontSize: 13, fontWeight: 800,
          fontFamily: "'Manrope',system-ui,sans-serif", cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0,0,0,.16)',
        }}
      >
        ⚗ Switch to sandbox
      </button>
    )
  }

  return (
    <div
      role="status"
      style={{
        // Deliberately NOT sticky/fixed. The site navbar is `fixed top-0`, and
        // a banner also claiming top:0 does not push it down — the navbar sits
        // underneath, and its top ~40px is hidden behind this bar on every page
        // of a sandbox session. In normal flow the banner occupies real height,
        // and the spacer in WithLayout keeps the navbar clear of it.
        position: 'relative',
        zIndex: 100,
        background: '#a21caf',
        color: '#fff',
        fontFamily: "'Manrope','Noto Sans Devanagari',system-ui,sans-serif",
        fontSize: 13,
        fontWeight: 700,
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        flexWrap: 'wrap',
        textAlign: 'center',
        lineHeight: 1.4,
      }}
    >
      <span>
        ⚠ SANDBOX — test database, Razorpay test mode. Nothing here is real.
      </span>
      <button
        onClick={() => switchEnv('prod')}
        style={{
          background: 'rgba(255,255,255,.18)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,.4)',
          borderRadius: 999,
          padding: '3px 12px',
          fontSize: 12,
          fontWeight: 800,
          cursor: 'pointer',
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        Switch to production
      </button>
    </div>
  )
}
