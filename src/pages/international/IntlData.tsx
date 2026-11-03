import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  MapPin, BedDouble, Activity, Plane, Languages, Star, Check, Plus, Info, ChevronDown, Building2, Search, Lightbulb, X, ChevronLeft, ChevronRight, Play,
} from 'lucide-react'
import IntlLayout, { C, Wrap, PageHead, Card, CtaButton, EstimateNote, useTitle } from './IntlLayout'
import { BottomCta } from './IntlStatic'
import { LegalGate, LegalNotes, hasLegal, legalAccepted } from './IntlLegal'
import { useCatalogue, useCurrency, useShortlist, priceText, money, rateOf } from './intlHooks'
import {
  LEVELS, GROUPS, FEE_LINE, ESTIMATE_LINE, CURRENCIES, type CityLevel,
} from '../../lib/intlContent'
import {
  NABH_LABEL, mediaUrl, MEDIA_CATEGORIES, optionsFor, isSuggested, sortOptions, factLabels, tripTotal,
  type Catalogue, type Hospital, type Option, type Procedure, type SortKey,
} from '../../lib/intlApi'

function Loading({ err }: { err: string }) {
  return <Wrap className="py-16 text-center" >{err ? <p className="text-red-700">{err}</p> : <p style={{ color: C.muted }}>Loading…</p>}</Wrap>
}

/** The hospital's cover picture: its first approved photo, else its profile photo. */
const coverOf = (h: Hospital) => (h.cover_path ? mediaUrl(h.cover_path) : h.photo_url) || null

function LevelBadge({ level }: { level: CityLevel }) {
  return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium" style={{ background: C.soft, color: C.greenDark }}>{LEVELS[level].name}</span>
}

function CurrencyPicker({ cur, setCur, fx }: { cur: string; setCur: (c: string) => void; fx: Record<string, number> }) {
  const avail = CURRENCIES.filter(c => c === 'INR' || Number(fx?.[c]) > 0)
  if (avail.length < 2) return null
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span style={{ color: C.muted }}>Prices in</span>
      <select value={avail.includes(cur as typeof avail[number]) ? cur : 'INR'} onChange={e => setCur(e.target.value)} className="rounded-lg border px-2 py-1 bg-white font-semibold">
        {avail.map(c => <option key={c} value={c}>{CUR_NAME[c] ?? c}</option>)}
      </select>
    </label>
  )
}

const CUR_NAME: Record<string, string> = {
  USD: 'US dollars ($)', GBP: 'British pounds (£)', EUR: 'Euros (€)', CAD: 'Canadian dollars', AUD: 'Australian dollars',
  AED: 'UAE dirhams', SAR: 'Saudi riyals', NPR: 'Nepali rupees', BDT: 'Bangladeshi taka', INR: 'Indian rupees (₹)',
}

function ProcedureSelect({ procs, value, onChange }: { procs: Procedure[]; value: string; onChange: (v: string) => void }) {
  const bySpec = useMemo(() => {
    const m = new Map<string, Procedure[]>()
    for (const p of procs) m.set(p.speciality, [...(m.get(p.speciality) ?? []), p])
    return [...m.entries()]
  }, [procs])
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl border px-4 py-3 text-lg bg-white" style={{ borderColor: C.border }}>
      <option value="">Choose a treatment…</option>
      {bySpec.map(([s, ps]) => (
        <optgroup key={s} label={s}>{ps.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</optgroup>
      ))}
    </select>
  )
}

// ── Compare & choose ────────────────────────────────────────────────────────
export function IntlCompare() {
  useTitle('Compare & choose')
  const { cat, err } = useCatalogue()
  const [sp, setSp] = useSearchParams()
  const code = sp.get('t') ?? ''
  const setCode = (v: string) => { const n = new URLSearchParams(sp); if (v) n.set('t', v); else n.delete('t'); setSp(n, { replace: true }) }
  const { cur, setCur } = useCurrency()
  const short = useShortlist()
  const [sort, setSort] = useState<SortKey>('price')
  const [levels, setLevels] = useState<CityLevel[]>([])
  const [nabhFull, setNabhFull] = useState(false)
  const [perNight, setPerNight] = useState('')
  const [companions, setCompanions] = useState(1)
  const [msg, setMsg] = useState('')
  const [, setLegalTick] = useState(0)
  const nav = useNavigate()

  if (!cat) return <IntlLayout><PageHead kicker="Compare & choose" title="Find the right hospital for you" /><Loading err={err} /></IntlLayout>
  const proc = cat.procedures.find(p => p.code === code)
  const all = proc ? optionsFor(cat, proc.code) : []
  const filtered = all.filter(o => (levels.length === 0 || levels.includes(o.hospital.city_level)) && (!nabhFull || o.hospital.nabh === 'full'))
  const sorted = sortOptions(filtered, sort)
  const suggested = proc ? sorted.filter(o => isSuggested(proc, o)) : []
  const others = proc ? sorted.filter(o => !isSuggested(proc, o)) : []
  const labels = factLabels(filtered)
  const picked = short.list.filter(i => i.t === code)

  const toggle = (h: string) => { const e = short.toggle(h, code); setMsg(e ?? '') }
  // 0319: a treatment with legal conditions opens with them; nothing below shows until accepted.
  const gate = proc && hasLegal(proc) && !legalAccepted(proc)

  return (
    <IntlLayout>
      <PageHead kicker="Compare & choose" title="Find the right hospital for you"
        lead="Choose your treatment. We suggest which size of city usually suits it and show every checked hospital that offers it. The choice is yours." />
      <Wrap className="py-8">
        <Card className="mb-6">
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr_1fr]">
            <div>
              <label className="block font-semibold mb-2">1. Your treatment</label>
              <ProcedureSelect procs={cat.procedures} value={code} onChange={setCode} />
              <p className="text-sm mt-2" style={{ color: C.muted }}>Not sure? <Link to="/international/quote" className="underline" style={{ color: C.green }}>Tell us your problem</Link> and a doctor will advise.</p>
            </div>
            <div>
              <label className="block font-semibold mb-2">2. Coming with</label>
              <select value={companions} onChange={e => setCompanions(Number(e.target.value))} className="w-full rounded-xl border px-4 py-3 bg-white" style={{ borderColor: C.border }}>
                <option value={0}>Just me</option><option value={1}>1 companion</option><option value={2}>2 companions</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-2">3. Hotel budget a night ({cur === 'INR' || !rateOf(cur, cat.fx) ? '₹' : cur})</label>
              <input inputMode="numeric" value={perNight} onChange={e => setPerNight(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={cur === 'USD' ? 'Optional, e.g. 40' : 'Optional'} className="w-full rounded-xl border px-4 py-3" style={{ borderColor: C.border }} />
            </div>
          </div>
        </Card>

        {!proc && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map(g => (
              <Card key={g}><p className="font-semibold">{GROUPS[g].name}</p><p className="text-sm mt-1" style={{ color: C.muted }}>{GROUPS[g].examples}</p>
                <p className="text-sm mt-2">Usually suits: <b>{GROUPS[g].levels.map(l => LEVELS[l].name).join(' or ')}</b></p></Card>
            ))}
          </div>
        )}

        {gate && <LegalGate p={proc!} onAccept={() => setLegalTick(t => t + 1)} onCancel={() => setCode('')} />}
        {proc && hasLegal(proc) && !gate && <div className="mb-6"><LegalNotes p={proc} compact /></div>}
        {proc && !gate && (
          <>
            <div className="rounded-2xl p-5 mb-6 flex gap-4" style={{ background: C.soft }}>
              <Lightbulb className="w-6 h-6 shrink-0 mt-0.5" style={{ color: C.green }} />
              <div>
                <p className="font-semibold text-lg">Our suggestion for {proc.name.toLowerCase()}: {GROUPS[proc.grp].levels.map(l => LEVELS[l].name.toLowerCase()).join(' or ')}</p>
                <p className="mt-1 leading-relaxed">{GROUPS[proc.grp].why}</p>
                <p className="mt-2 text-sm" style={{ color: C.muted }}>
                  Typical stay: {proc.hospital_days ? `${proc.hospital_days} ${proc.hospital_days === 1 ? 'day' : 'days'} in hospital, ` : 'no overnight stay, '}about {proc.india_days} days in India. A suggestion only — every option is shown below, and your doctor’s opinion comes first.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-5">
              <span className="text-sm font-semibold">Show:</span>
              {(Object.keys(LEVELS) as CityLevel[]).map(l => {
                const on = levels.includes(l)
                return <button key={l} onClick={() => setLevels(v => on ? v.filter(x => x !== l) : [...v, l])}
                  className="rounded-full px-3 py-1.5 text-sm" style={{ border: `1px solid ${on ? C.green : C.border}`, background: on ? C.soft : '#fff', color: on ? C.greenDark : C.ink }}>{LEVELS[l].name}</button>
              })}
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={nabhFull} onChange={e => setNabhFull(e.target.checked)} /> Full NABH only</label>
              <span className="flex-1" />
              <label className="inline-flex items-center gap-2 text-sm">Sort by
                <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="rounded-lg border px-2 py-1 bg-white">
                  <option value="price">Lowest estimate</option><option value="stay">Shortest stay</option>
                  <option value="airport">Closest to airport</option><option value="beds">Most beds</option><option value="name">Name</option>
                </select>
              </label>
              <CurrencyPicker cur={cur} setCur={setCur} fx={cat.fx} />
            </div>
            {msg && <p className="mb-4 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">{msg}</p>}
            {all.length > 0 && <EstimateNote className="mb-5" />}

            {all.length === 0 && (
              <Card className="text-center">
                <p className="text-lg font-semibold">Hospitals for this treatment are joining now.</p>
                <p className="mt-2" style={{ color: C.muted }}>Send us your request and your coordinator will find checked options for you within 24 hours.</p>
                <div className="mt-4"><CtaButton to={`/international/quote?t=${proc.code}`}>Ask for options</CtaButton></div>
              </Card>
            )}
            {all.length > 0 && filtered.length === 0 && <p style={{ color: C.muted }}>No hospitals match these filters. Try showing more cities.</p>}

            {suggested.length > 0 && <h2 className="text-xl font-bold mb-3">In the suggested cities ({suggested.length})</h2>}
            <div className="grid gap-4 mb-8">
              {suggested.map(o => <OptionCard key={o.hospital.id} o={o} proc={proc} cat={cat} cur={cur} labels={labels.get(o.hospital.id) ?? []}
                picked={short.has(o.hospital.id, code)} onPick={() => toggle(o.hospital.id)} perNight={(Number(perNight) || 0) * rateOf(cur, cat.fx)} companions={companions} />)}
            </div>
            {others.length > 0 && <h2 className="text-xl font-bold mb-3">In other cities ({others.length})</h2>}
            <div className="grid gap-4">
              {others.map(o => <OptionCard key={o.hospital.id} o={o} proc={proc} cat={cat} cur={cur} labels={labels.get(o.hospital.id) ?? []}
                picked={short.has(o.hospital.id, code)} onPick={() => toggle(o.hospital.id)} perNight={(Number(perNight) || 0) * rateOf(cur, cat.fx)} companions={companions} />)}
            </div>
          </>
        )}
      </Wrap>

      {proc && !gate && picked.length > 0 && (
        <div className="sticky bottom-0 z-30 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.08)]" style={{ borderTop: `1px solid ${C.border}` }}>
          <Wrap className="py-3 flex items-center gap-3 flex-wrap pr-20 sm:pr-40">
            <p className="font-semibold">{picked.length} of 3 shortlisted</p>
            <button onClick={() => short.list.filter(i => i.t === code).forEach(i => short.toggle(i.h, i.t))} className="text-sm underline" style={{ color: C.muted }}>Clear</button>
            <span className="flex-1" />
            <button onClick={() => nav(`/international/quote?t=${code}&h=${picked.map(i => i.h).join(',')}`)}
              className="rounded-full px-5 py-2.5 font-semibold text-white" style={{ background: C.green }}>Request quotes</button>
          </Wrap>
        </div>
      )}
      {!proc && <BottomCta />}
    </IntlLayout>
  )
}

function OptionCard({ o, proc, cat, cur, labels, picked, onPick, perNight, companions }: {
  o: Option; proc: Procedure; cat: Catalogue; cur: string; labels: string[]; picked: boolean; onPick: () => void; perNight: number; companions: number
}) {
  const [more, setMore] = useState(false)
  const h = o.hospital; const p = o.pkg
  const price = priceText(p.price_min, p.price_max, cur, cat.fx)
  const trip = tripTotal(o, proc, perNight, companions)
  const tripP = priceText(trip.min, trip.max, cur, cat.fx)
  return (
    <Card className={picked ? 'ring-2' : ''}>
      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <div>
          {coverOf(h) && (
            <Link to={`/international/hospitals/${h.id}`} className="block mb-3 rounded-xl overflow-hidden aspect-[16/7]">
              <img src={coverOf(h)!} alt={`${h.name}`} className="w-full h-full object-cover" loading="lazy" />
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Link to={`/international/hospitals/${h.id}`} className="text-xl font-bold hover:underline">{h.name}</Link>
            {h.star && <span className="inline-flex items-center gap-1 text-sm rounded-full px-2 py-0.5" style={{ background: C.sand }}><Star className="w-3.5 h-3.5" /> {h.star}-star</span>}
          </div>
          <p className="flex items-center gap-2 flex-wrap" style={{ color: C.muted }}>
            <MapPin className="w-4 h-4" /> {[h.city, h.state].filter(Boolean).join(', ') || 'India'} <LevelBadge level={h.city_level} />
          </p>
          {labels.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{labels.map(l => <span key={l} className="text-sm rounded-full px-2.5 py-0.5 text-white" style={{ background: C.green }}>{l}</span>)}</div>}
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[15px]">
            <li className="flex gap-2"><Check className="w-4 h-4 mt-1" style={{ color: C.green }} />{NABH_LABEL[h.nabh]}{h.jci ? ' · JCI' : ''}</li>
            {h.beds != null && <li className="flex gap-2"><BedDouble className="w-4 h-4 mt-1" style={{ color: C.green }} />{h.beds} beds{h.icu_beds ? `, ${h.icu_beds} ICU` : ''}</li>}
            {h.nearest_airport && <li className="flex gap-2"><Plane className="w-4 h-4 mt-1" style={{ color: C.green }} />{h.nearest_airport}{h.airport_hours != null ? ` · ${h.airport_hours} h by road` : ''}</li>}
            {h.languages.length > 0 && <li className="flex gap-2"><Languages className="w-4 h-4 mt-1" style={{ color: C.green }} />{h.languages.join(', ')}</li>}
            {h.site_url && <li className="flex gap-2"><Building2 className="w-4 h-4 mt-1" style={{ color: C.green }} /><a href={h.site_url} target="_blank" rel="noreferrer" className="underline">Hospital website</a></li>}
            {p.doctor_name && <li className="flex gap-2"><Activity className="w-4 h-4 mt-1" style={{ color: C.green }} />{p.doctor_name}</li>}
          </ul>
        </div>
        <div className="rounded-xl p-4" style={{ background: C.cream }}>
          <p className="text-sm" style={{ color: C.muted }}>Estimate for treatment</p>
          <p className="text-2xl font-bold">{price.main}</p>
          {price.sub && <p className="text-sm" style={{ color: C.muted }}>{price.sub}</p>}
          <p className="text-sm mt-1" style={{ color: C.muted }}>{FEE_LINE}</p>
          <p className="mt-2 text-[15px]">
            {p.hospital_days != null ? `${p.hospital_days} days in hospital · ` : ''}{trip.days ? `about ${trip.days} days in India` : ''}
            {p.fly_after_days != null ? ` · fly after ${p.fly_after_days} days` : ''}
          </p>
          {perNight > 0 && (
            <p className="mt-2 text-[15px]">Trip with your stay ({trip.nights} nights): <b>{tripP.main}</b></p>
          )}
          {p.room_type && <p className="text-sm mt-1" style={{ color: C.muted }}>Room: {p.room_type}</p>}
          <button onClick={onPick} className="mt-3 w-full rounded-full px-4 py-2.5 font-semibold inline-flex items-center justify-center gap-2"
            style={picked ? { background: C.green, color: '#fff' } : { border: `1.5px solid ${C.green}`, color: C.green, background: '#fff' }}>
            {picked ? <><Check className="w-4 h-4" /> Shortlisted</> : <><Plus className="w-4 h-4" /> Add to shortlist</>}
          </button>
        </div>
      </div>
      <button onClick={() => setMore(m => !m)} className="mt-4 text-sm font-semibold inline-flex items-center gap-1" style={{ color: C.green }}>
        What is included <ChevronDown className={`w-4 h-4 transition ${more ? 'rotate-180' : ''}`} />
      </button>
      {more && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 text-[15px]">
          <div><p className="font-semibold">Included</p><p style={{ color: C.muted }}>{p.included || 'Ask in your quote.'}</p></div>
          <div><p className="font-semibold">Not included</p><p style={{ color: C.muted }}>{p.excluded || 'Ask in your quote.'}</p></div>
          <p className="sm:col-span-2 text-sm flex gap-2" style={{ color: C.muted }}><Info className="w-4 h-4 mt-0.5 shrink-0" /> {ESTIMATE_LINE} Price valid until {new Date(p.valid_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.</p>
        </div>
      )}
    </Card>
  )
}

// ── Treatments ──────────────────────────────────────────────────────────────
function priceSpan(cat: Catalogue, code: string, level?: CityLevel) {
  const os = optionsFor(cat, code).filter(o => !level || o.hospital.city_level === level)
  if (!os.length) return null
  return { min: Math.min(...os.map(o => o.pkg.price_min)), max: Math.max(...os.map(o => o.pkg.price_max)), n: os.length }
}

export function IntlTreatments() {
  useTitle('Treatments')
  const { cat, err } = useCatalogue()
  const { cur, setCur } = useCurrency()
  const [q, setQ] = useState('')
  if (!cat) return <IntlLayout><PageHead kicker="Treatments" title="Treatments we help with" /><Loading err={err} /></IntlLayout>
  const list = cat.procedures.filter(p => !q || `${p.name} ${p.speciality}`.toLowerCase().includes(q.toLowerCase()))
  const specs = [...new Set(list.map(p => p.speciality))]
  return (
    <IntlLayout>
      <PageHead kicker="Treatments" title="Treatments we help with" lead="What each treatment involves, how long you stay, which reports to send, and estimates from checked hospitals." />
      <Wrap className="py-8">
        <div className="relative max-w-md mb-8">
          <Search className="w-5 h-5 absolute left-3 top-3.5" style={{ color: C.muted }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search, e.g. knee, eye, heart" className="w-full rounded-xl border pl-10 pr-4 py-3" style={{ borderColor: C.border }} />
        </div>
        <div className="-mt-4 mb-4"><CurrencyPicker cur={cur} setCur={setCur} fx={cat.fx} /></div>
        <EstimateNote className="mb-8" />
        {specs.map(s => (
          <section key={s} className="mb-8">
            <h2 className="text-xl font-bold mb-3">{s}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.filter(p => p.speciality === s).map(p => {
                const sp = priceSpan(cat, p.code)
                return (
                  <Link key={p.code} to={`/international/treatments/${p.code}`} className="block rounded-2xl bg-white p-5 hover:shadow-sm transition" style={{ border: `1px solid ${C.border}` }}>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm mt-1" style={{ color: C.muted }}>About {p.india_days} days in India · {GROUPS[p.grp].name.toLowerCase()}</p>
                    <p className="text-sm mt-2">{sp ? <>From <b>{money(sp.min, cur, cat.fx)}</b> · {sp.n} {sp.n === 1 ? 'hospital' : 'hospitals'}</> : <span style={{ color: C.muted }}>Hospitals joining</span>}</p>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </Wrap>
      <BottomCta />
    </IntlLayout>
  )
}

export function IntlTreatment() {
  const { code = '' } = useParams()
  const { cat, err } = useCatalogue()
  const proc = cat?.procedures.find(p => p.code === code)
  const { cur, setCur } = useCurrency()
  useTitle(proc?.name ?? 'Treatment')
  if (!cat) return <IntlLayout><Loading err={err} /></IntlLayout>
  if (!proc) return <IntlLayout><Wrap className="py-16"><p>We could not find this treatment. <Link to="/international/treatments" className="underline">See all treatments</Link></p></Wrap></IntlLayout>
  const g = GROUPS[proc.grp]
  return (
    <IntlLayout>
      <PageHead kicker={proc.speciality} title={proc.name} lead={proc.summary ?? undefined} />
      <Wrap className="py-10 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 className="text-xl font-bold">Estimates by city</h2>
              <CurrencyPicker cur={cur} setCur={setCur} fx={cat.fx} />
            </div>
            <div className="flex flex-col">
              {(Object.keys(LEVELS) as CityLevel[]).map(l => {
                const sp = priceSpan(cat, proc.code, l)
                return (
                  <div key={l} className="flex items-center justify-between gap-3 py-3" style={{ borderTop: `1px solid ${C.border}` }}>
                    <div><p className="font-semibold">{LEVELS[l].name}{g.levels.includes(l) && <span className="ml-2 text-sm rounded-full px-2 py-0.5" style={{ background: C.soft, color: C.greenDark }}>Suggested</span>}</p>
                      <p className="text-sm" style={{ color: C.muted }}>{LEVELS[l].examples}</p></div>
                    <p className="text-right">{sp ? <><b>{money(sp.min, cur, cat.fx)} – {money(sp.max, cur, cat.fx)}</b><br /><span className="text-sm" style={{ color: C.muted }}>{sp.n} {sp.n === 1 ? 'hospital' : 'hospitals'}</span></> : <span className="text-sm" style={{ color: C.muted }}>No listed hospital yet</span>}</p>
                  </div>
                )
              })}
            </div>
            <p className="text-sm mt-3" style={{ color: C.muted }}>{FEE_LINE} {ESTIMATE_LINE}</p>
            <EstimateNote className="mt-3" />
          </Card>
          {hasLegal(proc) && <LegalNotes p={proc} />}
          <Card>
            <h2 className="text-xl font-bold mb-2">Which city usually suits this</h2>
            <p className="leading-relaxed">{g.why}</p>
          </Card>
          <Card>
            <h2 className="text-xl font-bold mb-2">Reports to send</h2>
            <p className="leading-relaxed">{proc.reports}</p>
            <p className="text-sm mt-2" style={{ color: C.muted }}>A clear phone photo of each page is enough.</p>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <p className="font-semibold mb-2">Typical stay</p>
            <p>{proc.hospital_days ? `${proc.hospital_days} ${proc.hospital_days === 1 ? 'day' : 'days'} in hospital` : 'Usually no overnight stay'}</p>
            <p>About {proc.india_days} days in India in total</p>
            <p className="text-sm mt-2" style={{ color: C.muted }}>Each hospital gives its own figures. Your doctor confirms when you can fly.</p>
          </Card>
          <CtaButton to={`/international/compare?t=${proc.code}`}>Compare hospitals</CtaButton>
          <CtaButton to={`/international/quote?t=${proc.code}`} light>Get a free quote</CtaButton>
        </div>
      </Wrap>
    </IntlLayout>
  )
}

// ── Hospitals ───────────────────────────────────────────────────────────────
export function IntlHospitals() {
  useTitle('Hospitals')
  const { cat, err } = useCatalogue()
  const [level, setLevel] = useState<CityLevel | ''>('')
  const [state, setState] = useState('')
  const [q, setQ] = useState('')
  if (!cat) return <IntlLayout><PageHead kicker="Hospitals" title="Checked hospitals" /><Loading err={err} /></IntlLayout>
  const states = [...new Set(cat.hospitals.map(h => h.state).filter(Boolean) as string[])].sort()
  const list = cat.hospitals.filter(h => (!level || h.city_level === level) && (!state || h.state === state)
    && (!q || `${h.name} ${h.city} ${h.specialities.join(' ')}`.toLowerCase().includes(q.toLowerCase())))
  return (
    <IntlLayout>
      <PageHead kicker="Hospitals" title="Checked hospitals across India" lead="Facts only: accreditation, beds, ICU, languages and estimates. Listed in alphabetical order — no hospital pays to appear higher." />
      <Wrap className="py-8">
        <div className="flex flex-wrap gap-3 mb-6">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, city or speciality" className="rounded-xl border px-4 py-2.5 flex-1 min-w-[220px]" style={{ borderColor: C.border }} />
          <select value={level} onChange={e => setLevel(e.target.value as CityLevel | '')} className="rounded-xl border px-3 py-2.5 bg-white" style={{ borderColor: C.border }}>
            <option value="">All city sizes</option>{(Object.keys(LEVELS) as CityLevel[]).map(l => <option key={l} value={l}>{LEVELS[l].name}</option>)}
          </select>
          {states.length > 1 && (
            <select value={state} onChange={e => setState(e.target.value)} className="rounded-xl border px-3 py-2.5 bg-white" style={{ borderColor: C.border }}>
              <option value="">All states</option>{states.map(s => <option key={s}>{s}</option>)}
            </select>
          )}
        </div>
        {cat.hospitals.length === 0 && (
          <Card className="text-center"><Building2 className="w-8 h-8 mx-auto mb-2" style={{ color: C.green }} />
            <p className="text-lg font-semibold">Hospitals are completing our checks now.</p>
            <p className="mt-2" style={{ color: C.muted }}>Send your request and your coordinator will suggest checked options within 24 hours.</p>
            <div className="mt-4"><CtaButton to="/international/quote">Get a free quote</CtaButton></div></Card>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {list.map(h => <HospitalCard key={h.id} h={h} />)}
        </div>
      </Wrap>
      <BottomCta />
    </IntlLayout>
  )
}

function HospitalCard({ h }: { h: Hospital }) {
  return (
    <Link to={`/international/hospitals/${h.id}`} className="block rounded-2xl bg-white p-5 hover:shadow-sm transition" style={{ border: `1px solid ${C.border}` }}>
      <div className="flex gap-4">
        {coverOf(h) ? <img src={coverOf(h)!} alt="" className="w-24 h-20 rounded-xl object-cover shrink-0" loading="lazy" /> :
          <div className="w-20 h-20 rounded-xl flex items-center justify-center shrink-0" style={{ background: C.soft }}><Building2 className="w-8 h-8" style={{ color: C.green }} /></div>}
        <div className="min-w-0">
          <p className="font-bold text-lg">{h.name}</p>
          <p className="text-sm flex items-center gap-1 flex-wrap" style={{ color: C.muted }}><MapPin className="w-4 h-4" />{[h.city, h.state].filter(Boolean).join(', ')} · {LEVELS[h.city_level].name}</p>
          <p className="text-sm mt-1">{NABH_LABEL[h.nabh]}{h.star ? ` · ${h.star}-star` : ''}{h.beds ? ` · ${h.beds} beds` : ''}{h.icu_beds ? ` · ${h.icu_beds} ICU` : ''}</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>{h.packages.length} {h.packages.length === 1 ? 'treatment' : 'treatments'} with estimates</p>
        </div>
      </div>
    </Link>
  )
}

export function IntlHospital() {
  const { id = '' } = useParams()
  const { cat, err } = useCatalogue()
  const { cur, setCur } = useCurrency()
  const h = cat?.hospitals.find(x => x.id === id)
  useTitle(h?.name ?? 'Hospital')
  if (!cat) return <IntlLayout><Loading err={err} /></IntlLayout>
  if (!h) return <IntlLayout><Wrap className="py-16"><p>This hospital is not listed right now. <Link to="/international/hospitals" className="underline">See all hospitals</Link></p></Wrap></IntlLayout>
  const procName = (c: string) => cat.procedures.find(p => p.code === c)?.name ?? c
  return (
    <IntlLayout>
      <PageHead kicker={`${[h.city, h.state].filter(Boolean).join(', ')} · ${LEVELS[h.city_level].name}`} title={h.name} lead={h.about ?? undefined} />
      {(h.media?.length ?? 0) > 0 && <Gallery h={h} />}
      <Wrap className="py-10 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <Card>
          <h2 className="font-bold text-lg mb-3">Facts</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
            <dt style={{ color: C.muted }}>Accreditation</dt><dd>{NABH_LABEL[h.nabh]}{h.jci ? ', JCI' : ''}</dd>
            {h.star && <><dt style={{ color: C.muted }}>Star level</dt><dd>{h.star}-star (accreditation and panels)</dd></>}
            {h.beds != null && <><dt style={{ color: C.muted }}>Beds</dt><dd>{h.beds}</dd></>}
            {h.icu_beds != null && <><dt style={{ color: C.muted }}>ICU beds</dt><dd>{h.icu_beds}</dd></>}
            {h.panels.length > 0 && <><dt style={{ color: C.muted }}>Panels</dt><dd>{h.panels.join(', ')}</dd></>}
            {h.specialities.length > 0 && <><dt style={{ color: C.muted }}>Specialities</dt><dd>{h.specialities.join(', ')}</dd></>}
            {h.languages.length > 0 && <><dt style={{ color: C.muted }}>Languages</dt><dd>{h.languages.join(', ')}</dd></>}
            {h.nearest_airport && <><dt style={{ color: C.muted }}>Airport</dt><dd>{h.nearest_airport}{h.airport_hours != null ? `, ${h.airport_hours} h by road` : ''}</dd></>}
          </dl>
          <p className="text-sm mt-4" style={{ color: C.muted }}>Checked by Sehatsandhi: documents, video walkthrough and signed agreement.</p>
          {h.site_url && (
            <a href={h.site_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 font-semibold" style={{ border: `1.5px solid ${C.green}`, color: C.green }}>
              Visit the hospital’s website ↗</a>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="font-bold text-lg">Treatments and estimates</h2>
            <CurrencyPicker cur={cur} setCur={setCur} fx={cat.fx} />
          </div>
          {h.packages.length === 0 && <p style={{ color: C.muted }}>Ask us for a quote.</p>}
          <div className="flex flex-col">
            {h.packages.map(p => {
              const pr = priceText(p.price_min, p.price_max, cur, cat.fx)
              return (
                <div key={p.procedure_code} className="py-3 flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${C.border}` }}>
                  <div><p className="font-semibold">{procName(p.procedure_code)}</p>
                    <p className="text-sm" style={{ color: C.muted }}>{p.hospital_days != null ? `${p.hospital_days} days in hospital` : ''}{p.india_days ? ` · ${p.india_days} days in India` : ''}</p></div>
                  <div className="text-right"><p className="font-semibold">{pr.main}</p>{pr.sub && <p className="text-sm" style={{ color: C.muted }}>{pr.sub}</p>}
                    <Link to={`/international/compare?t=${p.procedure_code}`} className="text-sm font-semibold" style={{ color: C.green }}>Compare →</Link></div>
                </div>
              )
            })}
          </div>
          <p className="text-sm mt-3" style={{ color: C.muted }}>{FEE_LINE} {ESTIMATE_LINE}</p>
          <EstimateNote className="mt-3" />
        </Card>
      </Wrap>
    </IntlLayout>
  )
}

// ── Costs ───────────────────────────────────────────────────────────────────
export function IntlCosts() {
  useTitle('Costs')
  const { cat, err } = useCatalogue()
  const { cur, setCur } = useCurrency()
  const [code, setCode] = useState('')
  const [nights, setNights] = useState('')
  const [perNight, setPerNight] = useState('')
  const [food, setFood] = useState('')
  const [people, setPeople] = useState(2)
  if (!cat) return <IntlLayout><PageHead kicker="Costs" title="What your trip will cost" /><Loading err={err} /></IntlLayout>
  const proc = cat.procedures.find(p => p.code === code)
  const n = Number(nights) || (proc ? Math.max((proc.india_days ?? 0) - (proc.hospital_days ?? 0), 0) : 0)
  // The visitor types amounts in their own currency; sums are kept in rupees.
  const r = rateOf(cur, cat.fx)
  const sym = r === 1 ? '₹' : cur
  const stay = n * (Number(perNight) || 0) * r
  const meals = (proc?.india_days ?? n) * (Number(food) || 0) * people * r
  return (
    <IntlLayout>
      <PageHead kicker="Costs" title="What your trip will cost" lead="Treatment estimates by city size from checked hospitals, and a simple calculator for your stay." />
      <Wrap className="pt-8"><EstimateNote /></Wrap>
      <Wrap className="py-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <label className="font-semibold">Treatment</label>
            <CurrencyPicker cur={cur} setCur={setCur} fx={cat.fx} />
          </div>
          <ProcedureSelect procs={cat.procedures} value={code} onChange={setCode} />
          {proc && (
            <div className="mt-5 flex flex-col">
              {(Object.keys(LEVELS) as CityLevel[]).map(l => {
                const sp = priceSpan(cat, proc.code, l)
                return (
                  <div key={l} className="py-3 flex justify-between gap-3" style={{ borderTop: `1px solid ${C.border}` }}>
                    <p className="font-semibold">{LEVELS[l].name}{GROUPS[proc.grp].levels.includes(l) && <span className="ml-2 text-sm rounded-full px-2 py-0.5" style={{ background: C.soft, color: C.greenDark }}>Suggested</span>}</p>
                    <p>{sp ? <b>{money(sp.min, cur, cat.fx)} – {money(sp.max, cur, cat.fx)}</b> : <span className="text-sm" style={{ color: C.muted }}>No listed hospital yet</span>}</p>
                  </div>
                )
              })}
              <p className="text-sm mt-2" style={{ color: C.muted }}>{FEE_LINE} {ESTIMATE_LINE}</p>
              <Link to={`/international/compare?t=${proc.code}`} className="mt-3 font-semibold" style={{ color: C.green }}>Compare these hospitals →</Link>
            </div>
          )}
        </Card>
        <Card>
          <p className="font-semibold text-lg mb-3">Your stay calculator</p>
          <div className="grid gap-3">
            <label className="text-sm">Nights in a hotel
              <input inputMode="numeric" value={nights} onChange={e => setNights(e.target.value.replace(/\D/g, ''))} placeholder={proc ? String(n) : 'e.g. 10'} className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: C.border }} /></label>
            <label className="text-sm">Hotel a night ({sym})
              <input inputMode="numeric" value={perNight} onChange={e => setPerNight(e.target.value.replace(/\D/g, ''))} placeholder="your budget" className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: C.border }} /></label>
            <label className="text-sm">Food a day per person ({sym})
              <input inputMode="numeric" value={food} onChange={e => setFood(e.target.value.replace(/\D/g, ''))} placeholder="your budget" className="mt-1 w-full rounded-xl border px-3 py-2.5" style={{ borderColor: C.border }} /></label>
            <label className="text-sm">People travelling
              <select value={people} onChange={e => setPeople(Number(e.target.value))} className="mt-1 w-full rounded-xl border px-3 py-2.5 bg-white" style={{ borderColor: C.border }}>
                <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
          </div>
          <div className="mt-4 rounded-xl p-4" style={{ background: C.cream }}>
            <p className="flex justify-between"><span>Hotel</span><b>{money(stay, cur, cat.fx)}</b></p>
            <p className="flex justify-between"><span>Food</span><b>{money(meals, cur, cat.fx)}</b></p>
            <p className="flex justify-between mt-2 pt-2" style={{ borderTop: `1px solid ${C.border}` }}><span>Stay total</span><b>{money(stay + meals, cur, cat.fx)}</b></p>
          </div>
          <p className="text-sm mt-3" style={{ color: C.muted }}>Add the treatment estimate and your flights. Hotels, food and local travel usually cost less in smaller cities.</p>
        </Card>
      </Wrap>
      <Wrap className="pb-4">
        <Card>
          <p className="font-semibold text-lg mb-2">Costs people forget to ask about</p>
          <ul className="grid gap-2 sm:grid-cols-2 text-[15px]" style={{ color: C.muted }}>
            <li><b style={{ color: C.ink }}>Implants and lenses:</b> Indian or imported changes the price. Ask which is included.</li>
            <li><b style={{ color: C.ink }}>ICU days:</b> check how many are included and the price of an extra day.</li>
            <li><b style={{ color: C.ink }}>Extra days:</b> the room rate for a longer stay than planned.</li>
            <li><b style={{ color: C.ink }}>Complications:</b> how they are charged. The hospital must tell you in writing first.</li>
            <li><b style={{ color: C.ink }}>Companion:</b> bed and food for the person staying with you.</li>
            <li><b style={{ color: C.ink }}>Follow-ups:</b> how many online follow-ups are included after you go home.</li>
          </ul>
        </Card>
      </Wrap>
      <BottomCta />
    </IntlLayout>
  )
}

// 0317: the hospital's approved photos and videos, with a full-screen viewer.
function Gallery({ h }: { h: Hospital }) {
  const all = h.media ?? []
  const [cat, setCat] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const list = all.filter(m => !cat || m.category === cat)
  const cats = [...new Set(all.map(m => m.category))]
  const go = (d: number) => setOpen(i => i === null ? null : (i + d + list.length) % list.length)
  useEffect(() => {
    if (open === null) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, list.length])
  const thumb = (m: NonNullable<Hospital['media']>[number]) => m.kind === 'youtube' ? `https://img.youtube.com/vi/${m.youtube_id}/hqdefault.jpg` : m.path ? mediaUrl(m.path) : ''
  const cur = open !== null ? list[open] : null
  return (
    <Wrap className="pt-8">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-xl font-bold">Inside the hospital</h2>
        {cats.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {['', ...cats].map(c => (
              <button key={c} onClick={() => setCat(c)} className="rounded-full px-3 py-1 text-sm"
                style={cat === c ? { background: C.green, color: '#fff' } : { background: '#fff', border: `1px solid ${C.border}` }}>{c ? MEDIA_CATEGORIES[c] ?? c : 'All'}</button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {list.map((m, i) => (
          <button key={i} onClick={() => setOpen(i)} className={`relative rounded-2xl overflow-hidden bg-gray-100 group ${i === 0 && !cat ? 'col-span-2 row-span-2' : ''}`} style={{ aspectRatio: i === 0 && !cat ? '4/3' : '4/3' }}>
            {m.kind === 'video' && m.path
              ? <video src={mediaUrl(m.path)} className="w-full h-full object-cover" muted preload="metadata" />
              : <img src={thumb(m)} alt={m.caption ?? MEDIA_CATEGORIES[m.category] ?? ''} className="w-full h-full object-cover group-hover:scale-105 transition" loading="lazy" />}
            {m.kind !== 'photo' && <span className="absolute inset-0 flex items-center justify-center"><span className="w-14 h-14 rounded-full bg-black/55 flex items-center justify-center"><Play className="w-7 h-7 text-white" /></span></span>}
            <span className="absolute left-0 right-0 bottom-0 p-2 text-left text-white text-sm" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,.6))' }}>{m.caption || MEDIA_CATEGORIES[m.category]}</span>
          </button>
        ))}
      </div>
      <p className="text-xs mt-2" style={{ color: C.muted }}>Photos and videos from the hospital, checked by Sehatsandhi.</p>
      {cur && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between p-3 text-white">
            <span className="text-sm">{(open ?? 0) + 1} / {list.length} · {cur.caption || MEDIA_CATEGORIES[cur.category]}</span>
            <button aria-label="Close" className="p-2"><X className="w-6 h-6" /></button>
          </div>
          <div className="flex-1 flex items-center justify-center px-2 pb-6 relative" onClick={e => e.stopPropagation()}>
            {cur.kind === 'photo' && cur.path && <img src={mediaUrl(cur.path)} alt={cur.caption ?? ''} className="max-h-full max-w-full object-contain rounded-lg" />}
            {cur.kind === 'video' && cur.path && <video src={mediaUrl(cur.path)} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />}
            {cur.kind === 'youtube' && <iframe title={cur.caption ?? 'Video'} src={`https://www.youtube-nocookie.com/embed/${cur.youtube_id}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="w-full max-w-4xl aspect-video rounded-lg" />}
            {list.length > 1 && <>
              <button onClick={() => go(-1)} aria-label="Previous" className="absolute left-3 w-11 h-11 rounded-full bg-white/90 flex items-center justify-center"><ChevronLeft className="w-6 h-6" /></button>
              <button onClick={() => go(1)} aria-label="Next" className="absolute right-3 w-11 h-11 rounded-full bg-white/90 flex items-center justify-center"><ChevronRight className="w-6 h-6" /></button>
            </>}
          </div>
        </div>
      )}
    </Wrap>
  )
}
