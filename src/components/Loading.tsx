// Loading states, from the design doc's "Turn 5".
//
// The rule they encode: show the SHAPE of what is coming, not a spinner, wherever
// the shape is known. A patient waiting on a list of doctors should already see
// three doctor-shaped rows; only an action with no shape — a button mid-submit,
// a bot composing a reply — gets a spinner or dots.
//
// Keyframes are in index.css so the timings stay shared: .8s ring, 1.2s dots,
// 1.3s shimmer. Reduced motion is handled there too.

const GREEN = '#0E9F6E'
const TRACK = '#e3ded1'

/** Spinning ring. `onDark` for use inside a filled button. */
export function Spinner(
  { size = 28, onDark = false, label = 'Loading' }:
  { size?: 18 | 28 | 40; onDark?: boolean; label?: string },
) {
  const border = size === 18 ? 2 : size === 28 ? 3 : 4
  return (
    <span
      role="status"
      aria-label={label}
      style={{
        width: size, height: size, borderRadius: '50%', display: 'inline-block',
        border: `${border}px solid ${onDark ? 'rgba(255,255,255,.4)' : TRACK}`,
        borderTopColor: onDark ? '#fff' : GREEN,
        animation: 'ss-spin .8s linear infinite',
      }}
    />
  )
}

/**
 * The three dots the WhatsApp bot shows while composing.
 *
 * Not a spinner on purpose: a spinner says "the system is busy", these say
 * "someone is replying to you", which is the more honest read of what is
 * happening in a chat.
 */
export function TypingDots({ label = 'Replying' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      {[0, 0.15, 0.3].map(delay => (
        <span key={delay} style={{
          width: 8, height: 8, borderRadius: '50%', background: GREEN, display: 'block',
          animation: `ss-dot 1.2s ease-in-out ${delay}s infinite`,
        }} />
      ))}
    </span>
  )
}

/**
 * A shimmering block standing in for content that has not arrived.
 *
 * `delay` staggers a stack so it reads as one surface filling in rather than
 * several unrelated things flickering. The doc staggers by 0.08s per row.
 */
export function Skeleton(
  { width = '100%', height = 12, radius = 6, delay = 0 }:
  { width?: number | string; height?: number; radius?: number; delay?: number },
) {
  return (
    <span aria-hidden className="ss-skeleton"
      style={{ width, height, borderRadius: radius, animationDelay: delay ? `${delay}s` : undefined }} />
  )
}

/** One doctor-shaped placeholder row. */
export function DoctorCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 200 }}>
        <Skeleton width="45%" height={16} delay={delay} />
        <Skeleton width="65%" height={12} delay={delay + 0.08} />
        <Skeleton width="80%" height={10} delay={delay + 0.16} />
      </div>
      <Skeleton width={148} height={40} radius={999} delay={delay + 0.24} />
    </div>
  )
}

/** A list of them. The count should match what usually comes back. */
export function DoctorListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading doctors" style={{ display: 'grid', gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => <DoctorCardSkeleton key={i} delay={i * 0.08} />)}
    </div>
  )
}

/**
 * An indeterminate bar for a whole-page load.
 *
 * Fixed to the very top, above everything, because it describes the page rather
 * than any element in it.
 */
export function TopProgressBar({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div role="status" aria-label="Loading" style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 3,
      background: 'rgba(14,159,110,.15)', overflow: 'hidden', zIndex: 10000,
    }}>
      <span style={{
        position: 'absolute', top: 0, height: '100%', width: '38%',
        background: GREEN, borderRadius: 999,
        animation: 'ss-bar 1.1s ease-in-out infinite',
      }} />
    </div>
  )
}
