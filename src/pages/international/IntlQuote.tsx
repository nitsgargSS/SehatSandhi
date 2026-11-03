import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MessageCircle, Lock, Circle } from 'lucide-react'
import IntlLayout, { C, Wrap, PageHead, Card, useTitle } from './IntlLayout'
import { useCatalogue, useShortlist } from './intlHooks'
import { sendEnquiry, trackEnquiry, type Tracked } from '../../lib/intlApi'
import { ESTIMATE_CLAUSES, STEPS, intlWaLink } from '../../lib/intlContent'

const field = 'mt-1 w-full rounded-xl border px-4 py-3 bg-white'

export function IntlQuote() {
  useTitle('Get a free quote')
  const { cat } = useCatalogue()
  const [sp] = useSearchParams()
  const short = useShortlist()
  const [f, setF] = useState({
    name: '', country: '', phone: '', email: '', procedure_code: sp.get('t') ?? '', problem: '',
    urgency: 'planned', travel_when: '', companions: '1', budget: '', language: 'English', food: '', room: '', website: '',
  })
  const [consent, setConsent] = useState(false)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<string | null | undefined>(undefined)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(v => ({ ...v, [k]: e.target.value }))

  const fromUrl = (sp.get('h') ?? '').split(',').filter(Boolean)
  const shortIds = fromUrl.length ? fromUrl : short.list.filter(i => i.t === f.procedure_code).map(i => i.h)
  const shortNames = cat ? shortIds.map(id => cat.hospitals.find(h => h.id === id)?.name).filter(Boolean) as string[] : []

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!consent || !ack) { setErr('Please tick both boxes at the end of the form.'); return }
    setBusy(true)
    const r = await sendEnquiry({
      name: f.name, country: f.country, phone: f.phone, email: f.email, procedure_code: f.procedure_code || null,
      problem: f.problem, urgency: f.urgency, travel_when: f.travel_when, companions: f.companions, budget: f.budget,
      prefs: { language: f.language, food: f.food, room: f.room }, shortlist: shortIds,
      consent_share: consent, ack_estimate: ack, website: f.website, page: typeof window !== 'undefined' ? window.location.pathname + window.location.search : null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error || 'Something went wrong. Please try again or message us on WhatsApp.'); return }
    if (f.procedure_code) shortIds.forEach(h => short.has(h, f.procedure_code) && short.toggle(h, f.procedure_code))
    setDone(r.token ?? null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }

  if (done !== undefined) {
    const track = done ? `${typeof window !== 'undefined' ? window.location.origin : ''}/international/track/${done}` : ''
    const wa = intlWaLink(`Hello, I sent a request on Sehatsandhi International (${f.name}). I am sending my reports here.${done ? ` Ref ${done.slice(0, 8)}` : ''}`)
    return (
      <IntlLayout>
        <Wrap narrow className="py-14">
          <Card className="text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: C.green }} />
            <h1 className="text-2xl sm:text-3xl font-bold">Thank you, {f.name.split(' ')[0]}. We have your request.</h1>
            <p className="mt-3 text-lg" style={{ color: C.muted }}>Your coordinator will reply on WhatsApp within 24 hours.</p>
            <div className="mt-6 rounded-2xl p-5 text-left" style={{ background: C.soft }}>
              <p className="font-semibold">Next: send your reports</p>
              <p className="mt-1">Send a clear phone photo of each report on WhatsApp. We share them only with the hospitals you chose.</p>
              <a href={wa} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 font-semibold text-white" style={{ background: '#25D366' }}>
                <MessageCircle className="w-5 h-5" /> Send reports on WhatsApp
              </a>
            </div>
            {done && <p className="mt-6">Follow your request any time: <Link to={`/international/track/${done}`} className="font-semibold underline break-all" style={{ color: C.green }}>{track}</Link></p>}
            <p className="mt-2 text-sm" style={{ color: C.muted }}>Save this link — it is private to you.</p>
          </Card>
        </Wrap>
      </IntlLayout>
    )
  }

  return (
    <IntlLayout>
      <PageHead kicker="Free quote" title="Tell us what you need" lead="Two minutes. No payment. Your coordinator replies on WhatsApp within 24 hours and asks anything else later." />
      <Wrap narrow className="py-8">
        <form onSubmit={submit} className="flex flex-col gap-6">
          <Card>
            <p className="font-semibold text-lg mb-3">About you</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>Your name<input required value={f.name} onChange={set('name')} className={field} style={{ borderColor: C.border }} autoComplete="name" /></label>
              <label>Country you live in<input value={f.country} onChange={set('country')} className={field} style={{ borderColor: C.border }} autoComplete="country-name" /></label>
              <label>WhatsApp number (with country code)<input value={f.phone} onChange={set('phone')} placeholder="+44 7700 900123" className={field} style={{ borderColor: C.border }} inputMode="tel" autoComplete="tel" /></label>
              <label>Email (optional)<input type="email" value={f.email} onChange={set('email')} className={field} style={{ borderColor: C.border }} autoComplete="email" /></label>
            </div>
          </Card>

          <Card>
            <p className="font-semibold text-lg mb-3">Your treatment</p>
            <label>Treatment
              <select value={f.procedure_code} onChange={set('procedure_code')} className={field} style={{ borderColor: C.border }}>
                <option value="">Not sure — I will describe my problem</option>
                {cat?.procedures.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <label className="block mt-4">{f.procedure_code ? 'Anything the doctor should know (optional)' : 'What is troubling you?'}
              <textarea value={f.problem} onChange={set('problem')} rows={4} className={field} style={{ borderColor: C.border }}
                placeholder="For example: pain in my right knee for two years, my doctor says I need a replacement." /></label>
            {shortNames.length > 0 && (
              <div className="mt-4 rounded-xl p-4" style={{ background: C.soft }}>
                <p className="font-semibold">Your shortlist</p>
                <ul className="mt-1 list-disc pl-5">{shortNames.map(n => <li key={n}>{n}</li>)}</ul>
                <p className="text-sm mt-1" style={{ color: C.muted }}>We will ask these hospitals for written quotes. <Link to={`/international/compare?t=${f.procedure_code}`} className="underline">Change</Link></p>
              </div>
            )}
            {shortNames.length === 0 && f.procedure_code && (
              <p className="text-sm mt-3" style={{ color: C.muted }}>No shortlist yet — your coordinator will suggest checked hospitals. Or <Link to={`/international/compare?t=${f.procedure_code}`} className="underline" style={{ color: C.green }}>compare and pick up to 3</Link>.</p>
            )}
          </Card>

          <Card>
            <p className="font-semibold text-lg mb-3">Your trip</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>How soon
                <select value={f.urgency} onChange={set('urgency')} className={field} style={{ borderColor: C.border }}>
                  <option value="planned">Planned — within a few months</option><option value="soon">Soon — within a month</option><option value="urgent">Urgent</option>
                </select></label>
              <label>When can you travel (optional)<input value={f.travel_when} onChange={set('travel_when')} placeholder="e.g. February 2027" className={field} style={{ borderColor: C.border }} /></label>
              <label>Coming with
                <select value={f.companions} onChange={set('companions')} className={field} style={{ borderColor: C.border }}>
                  <option value="0">Just me</option><option value="1">1 companion</option><option value="2">2 companions</option>
                </select></label>
              <label>Budget (optional)<input value={f.budget} onChange={set('budget')} placeholder="e.g. up to US$5,000" className={field} style={{ borderColor: C.border }} /></label>
              <label>Language you prefer<input value={f.language} onChange={set('language')} className={field} style={{ borderColor: C.border }} /></label>
              <label>Food
                <select value={f.food} onChange={set('food')} className={field} style={{ borderColor: C.border }}>
                  <option value="">No preference</option><option>Vegetarian</option><option>Halal</option><option>Jain</option><option>Continental</option>
                </select></label>
            </div>
          </Card>

          <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} name="website" aria-hidden className="hidden" />

          <Card>
            <p className="font-semibold text-lg mb-2">About prices</p>
            <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-[15px]" style={{ color: C.muted }}>
              {ESTIMATE_CLAUSES.map(c => <li key={c}>{c}</li>)}
            </ol>
            <label className="mt-4 flex gap-3 items-start"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-1.5 w-5 h-5" />
              <span>I understand prices on this site are estimates, and that they include Sehatsandhi’s service fee.</span></label>
            <label className="mt-3 flex gap-3 items-start"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1.5 w-5 h-5" />
              <span>I agree that Sehatsandhi may share my details and reports with the hospitals I choose, to get quotes. See our <Link to="/privacy" className="underline">privacy policy</Link>.</span></label>
          </Card>

          {err && <p className="rounded-xl bg-red-50 text-red-800 px-4 py-3">{err}</p>}
          <button disabled={busy} className="rounded-full px-6 py-4 text-lg font-semibold text-white disabled:opacity-60" style={{ background: C.green }}>
            {busy ? 'Sending…' : 'Send my request'}
          </button>
          <p className="text-sm flex items-center gap-2" style={{ color: C.muted }}><Lock className="w-4 h-4" /> Your details are private. We never sell them or send marketing without asking.</p>
        </form>
      </Wrap>
    </IntlLayout>
  )
}

export function IntlTrack() {
  useTitle('Your request')
  const { token = '' } = useParams()
  const [t, setT] = useState<Tracked | null | undefined>(undefined)
  const [err, setErr] = useState('')
  useEffect(() => { trackEnquiry(token).then(setT, e => setErr(e?.message || 'Could not load.')) }, [token])
  const closed = t && (t.status === 'closed' || t.status === 'cancelled')
  const at = t ? STEPS.findIndex(s => s.key === t.status) : -1
  return (
    <IntlLayout>
      <Wrap narrow className="py-12">
        {err && <p className="text-red-700">{err}</p>}
        {t === undefined && !err && <p style={{ color: C.muted }}>Loading…</p>}
        {t === null && <Card><p className="font-semibold">We could not find this request.</p><p className="mt-1" style={{ color: C.muted }}>Check the link, or message us on WhatsApp.</p></Card>}
        {t && (
          <>
            <h1 className="text-3xl font-bold">Hello {t.name}</h1>
            <p className="mt-2 text-lg" style={{ color: C.muted }}>{t.procedure ?? 'Your request'}{t.coordinator ? ` · Coordinator: ${t.coordinator}` : ''}</p>
            {t.hospitals.length > 0 && <p className="mt-1" style={{ color: C.muted }}>Shortlist: {t.hospitals.join(', ')}{t.chosen ? ` · Chosen: ${t.chosen}` : ''}</p>}
            {closed ? (
              <Card className="mt-6"><p className="font-semibold">This request is {t.status === 'closed' ? 'complete' : 'cancelled'}.</p>
                <p className="mt-1" style={{ color: C.muted }}>Thank you for trusting us. Message us any time if you need help again.</p></Card>
            ) : (
              <ol className="mt-8 flex flex-col">
                {STEPS.map((s, i) => {
                  const state = i < at ? 'done' : i === at ? 'now' : 'next'
                  return (
                    <li key={s.key} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        {state === 'next' ? <Circle className="w-6 h-6" style={{ color: C.border }} /> : <CheckCircle2 className="w-6 h-6" style={{ color: state === 'now' ? C.green : '#8fbfa7' }} />}
                        {i < STEPS.length - 1 && <span className="w-0.5 flex-1 my-1" style={{ background: i < at ? '#8fbfa7' : C.border }} />}
                      </div>
                      <div className="pb-6">
                        <p className={`font-semibold ${state === 'next' ? 'opacity-50' : ''}`}>{s.label}{state === 'now' && <span className="ml-2 text-sm rounded-full px-2 py-0.5 text-white" style={{ background: C.green }}>Now</span>}</p>
                        {state === 'now' && <p className="mt-1" style={{ color: C.muted }}>{s.hint}</p>}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            <a href={intlWaLink(`Hello, I have a question about my request (${t.name}). Ref ${token.slice(0, 8)}`)} target="_blank" rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 font-semibold text-white" style={{ background: '#25D366' }}>
              <MessageCircle className="w-5 h-5" /> Message your coordinator
            </a>
          </>
        )}
      </Wrap>
    </IntlLayout>
  )
}
