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
// one tab keeps the others signed in. A minute before the end a box asks
// "Still there?"; nothing pressed, and the session is signed out everywhere
// and the login page says why.

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
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="idle-title"
      className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center">
        <h2 id="idle-title" className="text-lg font-bold text-navy-700 mb-2">Still there?</h2>
        <p className="text-sm text-gray-600 mb-4">
          No activity for a while. For safety you will be signed out in <b>{secondsLeft}s</b>.
        </p>
        <div className="flex gap-2 justify-center">
          <button autoFocus onClick={() => { lastWrite.current = 0; touch() }} className="btn-teal py-2 px-4 text-sm">Stay signed in</button>
          <button onClick={signOut} className="btn-outline py-2 px-4 text-sm">Log out now</button>
        </div>
      </div>
    </div>
  )
}
