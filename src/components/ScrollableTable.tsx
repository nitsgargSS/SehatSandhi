import { useEffect, useRef, useState } from 'react'

// A wide table on a narrow screen, with the sideways scroll made visible.
//
// Every admin table already sat in an `overflow-x-auto`, so nothing was ever
// truly unreachable — but a plain overflow container gives no sign that more
// exists to the right. On a 360px phone the doctors table cut off at "Reg no."
// and looked complete, which is why Approve appeared to be missing rather than
// off-screen.
//
// Two affordances, both shown only when the content actually overflows:
// a fade at the edge that still has content behind it, and a one-line hint. The
// fade tracks scroll position, so reaching the end clears it and the table stops
// claiming there is more.
//
// This is the right treatment for a dense table that is mostly read. Where the
// row carries an action that must not be missed — approving a doctor — a card
// layout is better and that table has one; see the Doctors list.
export default function ScrollableTable({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      // 2px of slack: sub-pixel widths otherwise leave the fade on forever at
      // the end of a scroll.
      const maxScroll = el.scrollWidth - el.clientWidth
      setMore({
        left: el.scrollLeft > 2,
        right: maxScroll > 2 && el.scrollLeft < maxScroll - 2,
      })
    }

    measure()
    el.addEventListener('scroll', measure, { passive: true })
    // Column widths settle after data loads and after a viewport change, so
    // measuring once on mount would leave the hint wrong on both.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)

    return () => { el.removeEventListener('scroll', measure); ro.disconnect() }
  }, [children])

  return (
    <div className={className}>
      <div className="relative">
        <div ref={ref} className="overflow-x-auto">
          {children}
        </div>

        {/* Pointer-events off so the fades never swallow a tap on a row. */}
        {more.left && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent" />
        )}
        {more.right && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" />
        )}
      </div>

      {/* Only while there is genuinely more to the right, and only on the
          screens where it is not obvious. */}
      {more.right && (
        <p className="md:hidden text-[11px] text-gray-400 mt-1.5 text-right">
          Swipe the table sideways for more →
        </p>
      )}
    </div>
  )
}
