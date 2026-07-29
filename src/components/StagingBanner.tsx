import { IS_STAGING } from '../lib/env'

// A permanent marker that this is NOT production.
//
// The point of it survives the switcher's removal: staging looks exactly like
// the real site, and someone demoing to a customer or debugging a support
// ticket must never mistake one for the other. What changed is what it reads —
// a build-time flag rather than a value in sessionStorage — so it cannot say
// "sandbox" while the client talks to production, which the old one could.
//
// Renders nothing in a production build, and because IS_STAGING is a literal
// after Vite substitutes it, this whole component is dropped from that bundle.

/** Magenta: nowhere in the brand palette, so it cannot be mistaken for chrome. */
const STAGING_COLOR = '#a21caf'

export default function StagingBanner() {
  if (!IS_STAGING) return null

  return (
    <>
      {/* A frame around the whole viewport, fixed so it survives scrolling.
          The banner alone only tells you where you are while you are at the top
          of the page — which is not when a mistake gets made. This stays.
          pointer-events:none so it never swallows a click. */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none',
        border: `3px solid ${STAGING_COLOR}`,
      }} />

      {/* A corner tag, for when the frame alone is ambiguous — a screenshot
          cropped to the content, say. */}
      <div aria-hidden style={{
        position: 'fixed', bottom: 0, left: 0, zIndex: 9999, pointerEvents: 'none',
        background: STAGING_COLOR, color: '#fff',
        fontFamily: "'Manrope',system-ui,sans-serif", fontSize: 11, fontWeight: 800,
        letterSpacing: '.08em', padding: '4px 10px', borderTopRightRadius: 8,
      }}>
        STAGING
      </div>

    <div
      role="status"
      style={{
        // In flow, not sticky: the site header is sticky and pins to top:0, and
        // two elements claiming that spot means one covers the other.
        position: 'relative',
        zIndex: 100,
        background: STAGING_COLOR,
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
      <span>⚠ STAGING — test database, Razorpay test mode. Nothing here is real.</span>
    </div>
    </>
  )
}
