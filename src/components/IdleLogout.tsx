import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Signs a dashboard out when nobody has used it for a while (29 Sep 2026), so a
// clinic PC left open at the desk cannot be used to change records.
//
//   Clinic / lab / staff dashboards: 30 minutes   (IDLE_MINUTES.business)
//   Sehatsandhi admin:               15 minutes   (IDLE_MINUTES.admin)
//
// "Used" = a click, key, scroll, touch or mouse movement in ANY open tab of the
// site: the last activity time is shared through localStorage, so reading in
// one tab keeps the others signed in. A minute before the end a bar asks
// "Still there?" and tells them to save — the page stays usable, so they can.
// Nothing pressed, and the session is signed out everywhere and the login
// page says why.

export const IDLE_MINUTES = { business: 30, admin: 15 } as const
const WARN_SECONDS = 60
const KEY = 'sehat:lastActivity'
const EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove', 'wheel'] as const

const readLast = (): number => {
  try { return Number(localStorage.getItem(KEY)) || Date.now() } catch { return Date.now() }
}

export default function IdleLogout({ minutes, loginPath }: { minutes: number; loginPath: string }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastWrite = useRef(0)
  const signingOut = useRef(false)

  const touch = useCallback(() => {
    const now = Date.now()
    // Mouse movement fires constantly; once every few seconds is plenty.
    if (now - lastWrite.current < 5000) return
    lastWrite.current = now
    try { localStorage.setItem(KEY, String(now)) } catch { /* private mode: this tab alone counts */ }
    setSecondsLeft(null)
  }, [])

  const signOut = useCallback(async () => {
    if (signingOut.current) return
    signingOut.current = true
    await supabase.auth.signOut().catch(() => undefined)
    window.location.href = `${loginPath}?reason=idle&m=${minutes}`
  }, [loginPath, minutes])

  useEffect(() => {
    lastWrite.current = 0
    touch()
    EVENTS.forEach(e => window.addEventListener(e, touch, { passive: true }))
    const tick = window.setInterval(() => {
      const idleMs = Date.now() - readLast()
      const left = Math.ceil((minutes * 60_000 - idleMs) / 1000)
      if (left <= 0) signOut()
      else setSecondsLeft(left <= WARN_SECONDS ? left : null)
    }, 1000)
    // Signed out in another tab (by hand or by this timer): follow it.
    const { data: sub } = supabase.auth.onAuthStateChange(ev => {
      if (ev === 'SIGNED_OUT' && !signingOut.current) window.location.href = loginPath
    })
    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, touch))
      window.clearInterval(tick)
      sub.subscription.unsubscribe()
    }
  }, [minutes, touch, signOut, loginPath])

  if (secondsLeft === null) return null
  // A bar, not a modal: the page underneath stays usable, so there is a full
  // minute to press Save on whatever is open. Any click — Save included —
  // counts as activity and keeps the session.
  return (
    <div role="alert" aria-live="assertive"
      className="fixed bottom-0 inset-x-0 z-[1000] bg-amber-50 border-t-2 border-amber-400 shadow-2xl px-4 py-3">
      <div className="max-w-4xl mx-auto flex flex-wrap items-center gap-3 justify-between">
        <div className="text-sm text-amber-900 min-w-0">
          <b>Still there?</b> No activity for a while — you will be signed out in <b>{secondsLeft}s</b> to keep records safe.
          {' '}<b>Save anything you are working on now.</b>
        </div>
        <div className="flex gap-2 shrink-0">
          <button autoFocus onClick={() => { lastWrite.current = 0; touch() }} className="btn-teal py-2 px-4 text-sm">I'm still working</button>
          <button onClick={signOut} className="btn-outline py-2 px-4 text-sm bg-white">Log out now</button>
        </div>
      </div>
    </div>
  )
}
