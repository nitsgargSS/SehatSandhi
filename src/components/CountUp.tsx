import { useEffect, useRef, useState } from 'react'

// A number that counts up to its value once, when it first becomes real.
//
// Written by hand rather than pulled from an animation library: this is the
// only counter in the product, and the whole behaviour is twenty lines against
// requestAnimationFrame. Framer Motion would be ~15kb gzipped on a page whose
// audience is on a rural connection, to animate one figure.
//
// Only animates upward changes from a settled value. A correction (the number
// arriving late and being lower than a placeholder) should not be dressed up as
// a count — the fix for that is to not render the placeholder, which is the
// caller's job.

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3)

export default function CountUp(
  { value, format, durationMs = 900 }:
  { value: number; format: (n: number) => string; durationMs?: number },
) {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number>()

  useEffect(() => {
    // Someone who has asked for less motion gets the number, not the journey.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || value === fromRef.current) {
      setShown(value)
      fromRef.current = value
      return
    }

    const from = fromRef.current
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      setShown(Math.round(from + (value - from) * EASE_OUT(t)))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [value, durationMs])

  // tabular-nums so the width does not jitter as the digits change.
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format(shown)}</span>
}
