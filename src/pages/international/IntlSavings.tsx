import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, Table2, BarChart3 } from 'lucide-react'
import IntlLayout, { C, Wrap, PageHead, Card, CtaButton, useTitle } from './IntlLayout'
import { BottomCta } from './IntlStatic'
import { loadSavings, type Savings, type PriceRef } from '../../lib/intlApi'
import { readStore, writeStore } from '../../lib/intlContent'

// 0314: "How much could you save?" — ballpark self-pay prices abroad next to
// India, from published sources (each linked, with its year). Not quotes.
// Chart: one row per procedure, two range bars on one shared scale in the
// visitor's currency. Orange = their country, green = India (palette checked
// for colour-blind separation); every bar is also labelled in words.

const HOME = '#C2410C'
const INDIA = '#0E9F6E'

function money(n: number, cur: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0, notation: n >= 100000 ? 'compact' : 'standard' }).format(n) }
  catch { return `${cur} ${Math.round(n).toLocaleString('en')}` }
}

interface Row { code: string; name: string; home: PriceRef[]; india: PriceRef[]; hLow: number; hHigh: number; iLow: number; iHigh: number; save: number }

export default function IntlSavings() {
  useTitle('How much could you save?')
  const [d, setD] = useState<Savings | null>(null)
  const [err, setErr] = useState('')
  const [country, setCountryState] = useState<string>(() => readStore('intl-country', 'US'))
  const [asTable, setAsTable] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const setCountry = (c: string) => { setCountryState(c); writeStore('intl-country', c) }
  useEffect(() => { loadSavings().then(setD, e => setErr(e.message || 'Could not load.')) }, [])

  const ctry = d?.countries.find(c => c.code === country) ?? d?.countries[0]
  // Rupees for one unit of a currency.
  const rate = (cur: string) => cur === 'INR' ? 1 : Number(d?.fx?.[cur]) || 0

  const rows: Row[] = useMemo(() => {
    if (!d || !ctry) return []
    const toLocal = (r: PriceRef, v: number) => { const a = rate(r.currency), b = rate(ctry.currency); return a && b ? v * a / b : NaN }
    const out: Row[] = []
    for (const p of d.procedures) {
      const home = d.refs.filter(r => r.country === ctry.code && r.procedure_code === p.code)
      const india = d.refs.filter(r => r.country === 'IN' && r.procedure_code === p.code)
      if (!home.length || !india.length) continue
      const span = (rs: PriceRef[]) => {
        const lo = rs.map(r => toLocal(r, r.low)).filter(Number.isFinite), hi = rs.map(r => toLocal(r, r.high)).filter(Number.isFinite)
        return lo.length ? [Math.min(...lo), Math.max(...hi)] : [NaN, NaN]
      }
      // Several sources for one side: the typical range is their middle, so one
      // outlier does not stretch the bar — the median of lows and of highs.
      const med = (rs: PriceRef[], k: 'low' | 'high') => {
        const v = rs.map(r => toLocal(r, r[k])).filter(Number.isFinite).sort((a, b) => a - b)
        return v.length ? v[Math.floor((v.length - 1) / 2)] : NaN
      }
      const [hLow, hHigh] = home.length > 2 ? [med(home, 'low'), med(home, 'high')] : span(home)
      const [iLow, iHigh] = india.length > 2 ? [med(india, 'low'), med(india, 'high')] : span(india)
      if (![hLow, hHigh, iLow, iHigh].every(Number.isFinite)) continue
      const save = Math.round((1 - ((iLow + iHigh) / 2) / ((hLow + hHigh) / 2)) * 100)
      out.push({ code: p.code, name: p.name, home, india, hLow, hHigh, iLow, iHigh, save })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, ctry?.code])

  const max = Math.max(1, ...rows.map(r => Math.max(r.hHigh, r.iHigh)))
  const pct = (v: number) => `${Math.max(0.6, (v / max) * 100)}%`
  const cur = ctry?.currency ?? 'USD'
  const usedSources = useMemo(() => {
    const m = new Map<string, PriceRef>()
    for (const r of rows) for (const x of [...r.home, ...r.india]) if (!m.has(x.source)) m.set(x.source, x)
    return [...m.values()]
  }, [rows])

  return (
    <IntlLayout>
      <PageHead kicker="Savings" title="How much could you save?"
        lead="Typical self-pay prices in your country next to typical prices in India, for common treatments. Ballpark figures from published sources — not quotes." />
      <Wrap className="py-8">
        {err && <p className="text-red-700">{err}</p>}
        {!d && !err && <p style={{ color: C.muted }}>Loading…</p>}
        {d && ctry && (
          <>
            <Card className="mb-6">
              <div className="flex flex-wrap items-end gap-4">
                <label className="font-semibold">I live in
                  <select value={ctry.code} onChange={e => setCountry(e.target.value)} className="mt-1 block rounded-xl border px-4 py-3 text-lg bg-white min-w-[220px]" style={{ borderColor: C.border }}>
                    {d.countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-4 text-[15px]">
                  <span className="inline-flex items-center gap-2"><span className="w-4 h-3 rounded-sm" style={{ background: HOME }} /> {ctry.name}</span>
                  <span className="inline-flex items-center gap-2"><span className="w-4 h-3 rounded-sm" style={{ background: INDIA }} /> India</span>
                </div>
                <span className="flex-1" />
                <button onClick={() => setAsTable(t => !t)} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold" style={{ border: `1px solid ${C.border}` }}>
                  {asTable ? <><BarChart3 className="w-4 h-4" /> Show chart</> : <><Table2 className="w-4 h-4" /> Show table</>}
                </button>
              </div>
              <p className="mt-3 text-sm" style={{ color: C.muted }}>Prices in {cur}, converted at {d.fx_date ? `rates of ${d.fx_date}` : 'recent rates'}. Treatment only — flights, hotel and food are extra (see <Link to="/international/costs" className="underline">Costs</Link>).</p>
            </Card>

            {rows.length === 0 && <Card><p>We do not have published prices for {ctry.name} yet. <Link to="/international/quote" className="underline" style={{ color: C.green }}>Ask us</Link> for an estimate for your treatment.</p></Card>}

            {rows.length > 0 && !asTable && (
              <Card>
                <ul className="flex flex-col">
                  {rows.map(r => (
                    <li key={r.code} className="py-4 grid gap-2 md:grid-cols-[220px_1fr_120px] items-center" style={{ borderTop: `1px solid ${C.border}` }}
                      onMouseEnter={() => setHover(r.code)} onMouseLeave={() => setHover(null)}>
                      <div>
                        <Link to={`/international/treatments/${r.code}`} className="font-semibold hover:underline">{r.name}</Link>
                        {r.home.some(x => /doctors' fees extra/.test(x.note ?? '')) && <p className="text-xs" style={{ color: C.muted }}>{ctry.name}: hospital charges only, doctors’ fees extra</p>}
                      </div>
                      <div className="flex flex-col gap-1.5 relative">
                        {[{ who: ctry.name, lo: r.hLow, hi: r.hHigh, color: HOME }, { who: 'India', lo: r.iLow, hi: r.iHigh, color: INDIA }].map(b => (
                          <div key={b.who} className="flex flex-col-reverse sm:flex-row sm:items-center gap-1 sm:gap-2">
                            <div className="relative h-3.5 w-full sm:flex-1 rounded" style={{ background: '#f1ece2' }}>
                              <div className="absolute top-0 h-full rounded" style={{ left: pct(b.lo), width: `calc(${pct(b.hi)} - ${pct(b.lo)})`, minWidth: 6, background: b.color, opacity: hover && hover !== r.code ? 0.55 : 1 }} />
                            </div>
                            <span className="text-sm whitespace-nowrap sm:w-44 sm:text-right tabular-nums" style={{ color: C.ink }}>
                              <span className="sm:hidden font-semibold">{b.who}: </span><span className="sr-only">{b.who}: </span>{b.lo === b.hi ? money(b.lo, cur) : `${money(b.lo, cur)} – ${money(b.hi, cur)}`}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="md:text-right">
                        <p className="text-lg font-bold" style={{ color: C.greenDark }}>{r.save > 0 ? `≈ ${r.save}% less` : 'Similar'}</p>
                        <p className="text-xs" style={{ color: C.muted }}>typical, middle of ranges</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {rows.length > 0 && asTable && (
              <Card className="overflow-x-auto">
                <table className="w-full text-[15px] min-w-[620px]">
                  <thead><tr className="text-left" style={{ color: C.muted }}><th className="py-2">Treatment</th><th>{ctry.name}</th><th>India</th><th>Typical saving</th></tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.code} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td className="py-2 font-semibold">{r.name}</td>
                        <td className="tabular-nums">{money(r.hLow, cur)} – {money(r.hHigh, cur)}</td>
                        <td className="tabular-nums">{money(r.iLow, cur)} – {money(r.iHigh, cur)}</td>
                        <td>{r.save > 0 ? `≈ ${r.save}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}

            <div className="mt-6 rounded-2xl p-5 flex gap-3" style={{ background: C.soft }}>
              <Info className="w-5 h-5 shrink-0 mt-0.5" style={{ color: C.green }} />
              <div className="text-[15px] leading-relaxed">
                <p><b>These are ballpark figures, not quotes.</b> They come from hospital price lists, government data and published reports, each with its year (sources below). Real prices depend on the hospital, the implant or lens, your health and how long you stay.</p>
                <p className="mt-2">Saving money is only one part of the choice. Check the hospital’s accreditation, the doctor’s experience and your follow-up plan at home. Your own doctor’s advice comes first.</p>
                <p className="mt-2">For estimates from checked hospitals, with what is included, use <Link to="/international/compare" className="underline font-semibold" style={{ color: C.green }}>Compare & choose</Link>.</p>
              </div>
            </div>

            {usedSources.length > 0 && (
              <details className="mt-6">
                <summary className="cursor-pointer font-semibold">Sources ({usedSources.length})</summary>
                <ul className="mt-2 flex flex-col gap-1 text-sm" style={{ color: C.muted }}>
                  {usedSources.map(s => (
                    <li key={s.source}>{s.country === 'IN' ? 'India' : d.countries.find(c => c.code === s.country)?.name}, {s.year}: <a href={s.source} target="_blank" rel="noreferrer nofollow" className="underline break-all">{s.source}</a></li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <CtaButton to="/international/compare">Compare hospitals in India</CtaButton>
              <CtaButton to="/international/quote" light>Get a free quote</CtaButton>
            </div>
          </>
        )}
      </Wrap>
      <BottomCta />
    </IntlLayout>
  )
}
