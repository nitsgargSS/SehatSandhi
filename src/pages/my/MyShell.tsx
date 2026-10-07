import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, LogOut } from 'lucide-react'
import SiteHeader, { HeaderLink } from '../../components/SiteHeader'
import SiteFooter from '../../components/SiteFooter'
import { me, requestCode, signOut, verifyCode, type Me } from '../../lib/patientApi'
import { recordFirstTouch } from '../../lib/firstTouch'

// The frame of every /my page: the site header, a back link, and — for pages
// that act on the patient's own number — the WhatsApp-code sign-in in place of
// the page until someone is signed in as a patient.

const MeContext = createContext<{ who: Me; reload: () => void } | null>(null)
export const useMe = () => useContext(MeContext)!

export function MyShell({ title, back = '/my', needsLogin = true, children }: {
  title: string; back?: string | null; needsLogin?: boolean; children: React.ReactNode
}) {
  const [who, setWho] = useState<Me | null | undefined>(undefined)
  const navigate = useNavigate()
  const reload = useCallback(() => { me().then(setWho).catch(() => setWho(null)) }, [])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { document.title = `${title} · Sehatsandhi` }, [title])

  return (
    <div className="min-h-screen bg-[#FBF7F0] flex flex-col">
      <SiteHeader>
        <HeaderLink to="/my">My Sehatsandhi</HeaderLink>
        {who && (
          <button onClick={async () => { await signOut(); setWho(null); navigate('/my') }}
            className="text-sm font-bold text-gray-500 inline-flex items-center gap-1 hover:text-gray-700">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        )}
      </SiteHeader>
      <main className="w-full max-w-3xl mx-auto px-4 py-6 flex-1 flex flex-col gap-4">
        {back && <Link to={back} className="text-sm text-teal-700 font-semibold inline-flex items-center gap-1 w-fit"><ChevronLeft className="w-4 h-4" /> Back</Link>}
        <h1 className="text-2xl font-bold text-navy-700">{title}</h1>
        {!needsLogin ? children
          : who === undefined ? <p className="text-gray-400">Loading…</p>
          : !who ? <SignIn onDone={reload} />
          : <MeContext.Provider value={{ who, reload }}>{children}</MeContext.Provider>}
      </main>
      <SiteFooter />
    </div>
  )
}

export function SignIn({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [dev, setDev] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const digits = phone.replace(/\D/g, '')

  return (
    <div className="card max-w-md">
      <h2 className="text-lg font-bold text-navy-700">अपने नंबर से साइन इन करें / Sign in with your number</h2>
      <p className="text-sm text-gray-500 mt-1 mb-4">
        We send a 6-digit code to your WhatsApp. Then you see your visits, prescriptions, reports and bills,
        book doctors, message your clinic, and order medicines — the same as in the Sehatsandhi app.
      </p>
      <form onSubmit={e => { e.preventDefault(); if (!sent) { if (digits.length >= 10) run(async () => { const r = await requestCode(phone); setSent(true); setDev(r.devCode ?? '') }) } else if (code.length === 6) run(async () => { await verifyCode(phone, code); await recordFirstTouch(); onDone() }) }}
        className="flex flex-col gap-3">
        <label className="text-sm font-semibold text-gray-700">Mobile number
          <input className="input-field mt-1" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} disabled={sent} onChange={e => setPhone(e.target.value)} />
        </label>
        {sent && (
          <label className="text-sm font-semibold text-gray-700">6-digit code
            <input className="input-field mt-1 tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          </label>
        )}
        {!!dev && <p className="text-sm text-amber-700">Test mode: your code is {dev}</p>}
        {!!err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn-teal justify-center disabled:opacity-50" disabled={busy || (!sent ? digits.length < 10 : code.length !== 6)}>
          {busy ? '…' : !sent ? 'Send code on WhatsApp' : 'Sign in'}
        </button>
        {sent && <button type="button" className="text-sm text-teal-700" onClick={() => { setSent(false); setCode(''); setDev('') }}>Change number</button>}
      </form>
    </div>
  )
}

export const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
export const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
export const Err = ({ msg }: { msg: string }) => msg ? <p className="text-sm text-red-600">{msg}</p> : null
