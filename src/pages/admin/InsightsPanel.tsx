import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Send, MapPin, AlertTriangle, Pencil } from 'lucide-react'
import { StatTile } from '../../components/Charts'
import ScrollableTable from '../../components/ScrollableTable'
import { money, num, shortDate } from '../../lib/format'
import {
  getAreaReport, getVerticalMatrix, getRenewals, getVisitorGeo, queueReminder,
  pivotMatrix, downloadAreas, downloadRenewals, downloadGeo,
  listAllServiceAreas, listTiers, addServiceArea, updateServiceArea,
  tierForPopulation, downloadServiceAreas, setBusinessLocation,
  AreaScope, AreaRow, MatrixRow, RenewalRow, VisitorGeoRow, ServiceAreaRow, TierRow, toCsv,
} from '../../lib/adminInsightsApi'
import { downloadCsv } from '../../lib/billingApi'
import { getAreaGaps, AreaGapRow, GapScope } from '../../lib/areaReportsApi'
import { SPECIALITIES } from '../../types'

// Where the listings are, where they are not, what kind they are, who is due,
// and which towns notice us.
//
// ── THE NUMBER THAT IS EASY TO GET WRONG ────────────────────────────────────
// "Registered here" counts primary practice locations — one business, one
// place. "Advertising here" counts the coverage array, where one listing can
// appear in twenty pincodes. They are shown side by side and labelled, because
// a reader who conflates them will conclude the network is three times larger
// than it is.
//
// ── THE REMINDER BUTTON QUEUES; IT DOES NOT SEND ────────────────────────────
// Nothing drains billing_notifications yet — the sender is unbuilt and its
// MSG91 and AiSensy credentials are unset. The button writes a real row that
// will go out the moment that exists, and the screen says exactly that. A
// button that claims to have sent a message it did not send is worse than no
// button, because the clinic is then not chased by anyone.

type Section = 'gaps' | 'areas' | 'matrix' | 'renewals' | 'geo' | 'manage'

export default function InsightsPanel() {
  const [section, setSection] = useState<Section>('gaps')

  const chip = (active: boolean) =>
    `text-xs font-semibold px-3 py-1.5 rounded-full border ${
      active ? 'bg-teal-50 border-teal-500 text-teal-700'
             : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-navy-700">Business intelligence</h2>
        <p className="text-sm text-gray-500">
          Where the listings are, where they are not, and who is due to renew.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {([['gaps', 'Gaps to market'], ['areas', 'By area'], ['matrix', 'Type × region'], ['renewals', 'Renewals'],
           ['geo', 'Where we are noticed'], ['manage', 'Service areas']] as [Section, string][]).map(([s, label]) => (
          <button key={s} onClick={() => setSection(s)} className={chip(section === s)}>{label}</button>
        ))}
      </div>

      {section === 'gaps' && <GapsSection chip={chip} />}
      {section === 'areas' && <AreasSection chip={chip} />}
      {section === 'matrix' && <MatrixSection chip={chip} />}
      {section === 'renewals' && <RenewalsSection chip={chip} />}
      {section === 'geo' && <GeoSection chip={chip} />}
      {section === 'manage' && <ManageAreasSection chip={chip} />}
    </div>
  )
}

type ChipFn = (active: boolean) => string

function useAsync<T>(fn: () => Promise<T>, deps: unknown[], empty: T) {
  const [data, setData] = useState<T>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fn().then(d => { if (!cancelled) { setData(d); setError('') } })
      .catch(e => { if (!cancelled) { setData(empty); setError((e as Error).message) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, loading, error, setData }
}

function Msg({ loading, error, empty, children }: {
  loading: boolean; error: string; empty: boolean; children: React.ReactNode
}) {
  if (error) return <div className="card shadow-sm text-sm text-amber-700 bg-amber-50 border-amber-200">{error}</div>
  if (loading) return <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
  if (empty) return <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">Nothing to show yet.</div>
  return <>{children}</>
}

// ── Gaps to market ──────────────────────────────────────────────────────────
//
// Two questions for two kinds of marketing, from one table (0112):
//
//   Recruit businesses — where people search and nothing is based there.
//   Find patients      — where businesses are, and patients are not coming.
//
// With a state or district filter every pincode in it is listed, the silent
// ones included, because a pincode with nothing at all is the gap.

const VERTICALS = ['clinic', 'hospital', 'lab', 'pharmacy', 'ambulance', 'insurance']

const GAP_COLUMNS: [keyof AreaGapRow, string][] = [
  ['state', 'State'], ['district', 'District'], ['pin_code', 'PIN code'], ['area_name', 'Area'],
  ['pincodes', 'PIN codes'], ['population', 'Population'],
  ['located', 'Businesses based here'], ['businesses', 'Businesses serving'],
  ['clinics', 'Clinics'], ['hospitals', 'Hospitals'], ['labs', 'Labs'], ['pharmacies', 'Pharmacies'],
  ['ambulances', 'Ambulances'], ['insurance', 'Insurance'], ['doctors', 'Doctors'],
  ['patients', 'Patients living here'], ['bookings', 'Bookings'],
  ['searches', 'Searches'], ['unmet', 'Found nobody'], ['gap', 'Gap'],
]

type GapView = 'recruit' | 'patients' | 'all'

function GapsSection({ chip }: { chip: ChipFn }) {
  const [days, setDays] = useState(30)
  const [scope, setScope] = useState<GapScope>('district')
  const [view, setView] = useState<GapView>('recruit')
  const [speciality, setSpeciality] = useState('')
  const [vertical, setVertical] = useState('')
  // Typed filters apply on Search, not on every keystroke.
  const [draft, setDraft] = useState({ state: '', district: '', query: '' })
  const [applied, setApplied] = useState(draft)

  const { data: rows, loading, error } = useAsync<AreaGapRow[]>(
    () => getAreaGaps({ days, scope, speciality, vertical, ...applied }),
    [days, scope, speciality, vertical, applied], [])

  const shown = useMemo(() => {
    if (view === 'recruit') {
      // Demand with little supply based there: most unmet, then most searched,
      // then the biggest population.
      return rows.filter(r => r.located === 0 || r.unmet > 0 || (speciality && r.doctors === 0))
        .sort((a, b) => b.unmet - a.unmet || b.searches - a.searches || (b.population ?? 0) - (a.population ?? 0))
    }
    if (view === 'patients') {
      // Supply that patients are not reaching: fewest patients per business first.
      return rows.filter(r => r.located > 0)
        .sort((a, b) => a.patients / a.located - b.patients / b.located || (b.population ?? 0) - (a.population ?? 0))
    }
    return rows
  }, [rows, view, speciality])

  const t = {
    searches: rows.reduce((s, r) => s + r.searches, 0),
    unmet: rows.reduce((s, r) => s + r.unmet, 0),
    noBiz: rows.filter(r => r.located === 0).length,
    noPatients: rows.filter(r => r.located > 0 && r.patients === 0).length,
  }
  const place = scope === 'district' ? 'district' : 'PIN code'
  const label = (r: AreaGapRow) => scope === 'district'
    ? r.district : r.area_name ? `${r.area_name} · ${r.pin_code}` : r.pin_code ?? '—'

  const onDownload = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`area-gaps-${scope}-${view}-${days}d-${stamp}.csv`, toCsv(shown, GAP_COLUMNS))
  }

  const select = 'text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white'

  return (
    <div className="space-y-4">
      <div className="card shadow-sm space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 w-16">Show</span>
          {([['recruit', 'Where to recruit businesses'], ['patients', 'Where patients are missing'],
             ['all', 'Everything']] as [GapView, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} className={chip(view === v)}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 w-16">Group by</span>
          {(['district', 'pincode'] as GapScope[]).map(s => (
            <button key={s} onClick={() => setScope(s)} className={chip(scope === s)}>
              {s === 'district' ? 'District' : 'PIN code'}
            </button>
          ))}
          <span className="text-xs font-semibold text-gray-500 ml-3">Period</span>
          {[7, 30, 90, 365].map(d => (
            <button key={d} onClick={() => setDays(d)} className={chip(days === d)}>
              {d === 365 ? '1 year' : `${d} days`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 w-16">Filter</span>
          <select className={select} value={speciality} onChange={e => setSpeciality(e.target.value)}>
            <option value="">Any speciality</option>
            {SPECIALITIES.map(s => <option key={s.id} value={s.id}>{s.en}</option>)}
          </select>
          <select className={select} value={vertical} onChange={e => setVertical(e.target.value)}>
            <option value="">Any business type</option>
            {VERTICALS.map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
          </select>
        </div>
        <form className="flex items-center gap-2 flex-wrap"
          onSubmit={e => { e.preventDefault(); setApplied(draft) }}>
          <span className="text-xs font-semibold text-gray-500 w-16">Place</span>
          <input className={select} placeholder="State, e.g. Haryana" value={draft.state}
            onChange={e => setDraft({ ...draft, state: e.target.value })} />
          <input className={select} placeholder="District, e.g. Yamunanagar" value={draft.district}
            onChange={e => setDraft({ ...draft, district: e.target.value })} />
          <input className={select} placeholder="Search PIN, area, district…" value={draft.query}
            onChange={e => setDraft({ ...draft, query: e.target.value })} />
          <button type="submit" className="btn-teal text-xs">Search</button>
          {(applied.state || applied.district || applied.query) && (
            <button type="button" className="text-xs font-semibold text-gray-500"
              onClick={() => { const blank = { state: '', district: '', query: '' }; setDraft(blank); setApplied(blank) }}>
              Clear
            </button>
          )}
        </form>
        <div className="flex justify-end pt-1 border-t border-gray-100">
          <button onClick={onDownload} disabled={!shown.length} className="btn-teal text-xs disabled:opacity-50">
            <Download className="w-3.5 h-3.5 inline mr-1.5" /> Download sheet
          </button>
        </div>
      </div>

      <Msg loading={loading} error={error} empty={!rows.length}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Searches" value={num(t.searches)} sub={`website + WhatsApp, ${days} days`} />
          <StatTile label="Found nobody" value={num(t.unmet)} tone={t.unmet ? 'alert' : 'normal'}
            sub="searches with no result" />
          <StatTile label={`${place[0].toUpperCase() + place.slice(1)}s with no business based there`}
            value={num(t.noBiz)} tone={t.noBiz ? 'alert' : 'normal'} sub="recruit businesses" />
          <StatTile label={`${place[0].toUpperCase() + place.slice(1)}s with businesses, no patients`}
            value={num(t.noPatients)} sub="market to patients" />
        </div>

        <div className="card shadow-sm">
          <p className="text-xs text-gray-500 mb-3">
            <strong>Based here</strong> is where a business actually is. <strong>Serving</strong> also counts
            every business that sells into the area, which is most of them on the flat plan — use "based here"
            to judge supply. <strong>Patients</strong> are counted by where they live, recorded from
            19 September 2026. <strong>Searches</strong> are anonymous, from the website and the WhatsApp bot.
          </p>
          <ScrollableTable>
            <table className="w-full text-sm" style={{ minWidth: 980 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2.5 font-semibold">State</th>
                  <th className="px-3 py-2.5 font-semibold">{scope === 'district' ? 'District' : 'PIN code'}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Population</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Based here</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Serving</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Doctors</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Patients</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Bookings</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Searches</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Found nobody</th>
                  <th className="px-3 py-2.5 font-semibold">Gap</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-50 last:border-0 ${r.gap ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.state}</td>
                    <td className="px-3 py-2.5 font-semibold text-navy-700 whitespace-nowrap">
                      {label(r)}
                      {scope === 'pincode' && <span className="font-normal text-xs text-gray-400"> · {r.district}</span>}
                      {scope === 'district' && <span className="font-normal text-xs text-gray-400"> · {r.pincodes} PINs</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">{r.population ? num(r.population) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-bold">
                      {r.located === 0 ? <span className="text-amber-700">none</span> : num(r.located)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500"
                      title={`Clinics ${r.clinics}, hospitals ${r.hospitals}, labs ${r.labs}, pharmacies ${r.pharmacies}, ambulances ${r.ambulances}, insurance ${r.insurance}`}>
                      {num(r.businesses)}
                    </td>
                    <td className="px-3 py-2.5 text-right">{num(r.doctors)}</td>
                    <td className="px-3 py-2.5 text-right">{num(r.patients)}</td>
                    <td className="px-3 py-2.5 text-right">{num(r.bookings)}</td>
                    <td className="px-3 py-2.5 text-right">{num(r.searches)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.unmet > 0 ? <span className="font-semibold text-amber-700">{num(r.unmet)}</span> : 0}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-amber-800 whitespace-nowrap">{r.gap ?? ''}</td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">
                    No {place}s match this view.
                  </td></tr>
                )}
              </tbody>
            </table>
          </ScrollableTable>
          {rows.length >= 2000 && (
            <p className="text-xs text-gray-500 mt-3">Showing the first 2,000 — narrow by state or district to see the rest.</p>
          )}
        </div>
      </Msg>
    </div>
  )
}

// ── By area ─────────────────────────────────────────────────────────────────

function AreasSection({ chip }: { chip: ChipFn }) {
  const [scope, setScope] = useState<AreaScope>('district')
  const [state, setState] = useState<string | null>(null)
  const [district, setDistrict] = useState<string | null>(null)

  const { data: rows, loading, error } = useAsync<AreaRow[]>(
    () => getAreaReport(scope, { state, district }), [scope, state, district], [])

  // The filter lists come from the data itself, so a new state appears without
  // a code change and a state with no areas never appears at all.
  const { data: all } = useAsync<AreaRow[]>(() => getAreaReport('pincode'), [], [])
  const states = useMemo(() => [...new Set(all.map(r => r.state).filter(Boolean))] as string[], [all])
  const districts = useMemo(() => [...new Set(all
    .filter(r => !state || r.state === state).map(r => r.district).filter(Boolean))] as string[], [all, state])

  const empty = rows.filter(r => r.businesses === 0)
  const totals = {
    businesses: rows.reduce((s, r) => s + r.businesses, 0),
    population: rows.reduce((s, r) => s + r.population, 0),
    areas: rows.reduce((s, r) => s + r.areas, 0),
  }
  const busiest = [...rows].sort((a, b) => b.businesses - a.businesses)[0]

  return (
    <div className="space-y-4">
      <div className="card shadow-sm space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 w-16">Group by</span>
          {(['state', 'district', 'pincode'] as AreaScope[]).map(s => (
            <button key={s} onClick={() => setScope(s)} className={chip(scope === s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        {states.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 w-16">State</span>
            <button onClick={() => { setState(null); setDistrict(null) }} className={chip(!state)}>All</button>
            {states.map(s => (
              <button key={s} onClick={() => { setState(s); setDistrict(null) }} className={chip(state === s)}>{s}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 w-16">District</span>
          <button onClick={() => setDistrict(null)} className={chip(!district)}>All</button>
          {districts.map(d => (
            <button key={d} onClick={() => setDistrict(d)} className={chip(district === d)}>{d}</button>
          ))}
        </div>
        <div className="flex justify-end pt-1 border-t border-gray-100">
          <button onClick={() => downloadAreas(rows, scope)} disabled={!rows.length}
            className="btn-teal text-xs disabled:opacity-50">
            <Download className="w-3.5 h-3.5 inline mr-1.5" /> Download sheet
          </button>
        </div>
      </div>

      <Msg loading={loading} error={error} empty={!rows.length}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Businesses" value={num(totals.businesses)} sub="by primary location" />
          <StatTile label="Areas covered" value={num(totals.areas)} />
          <StatTile label="Areas with none" value={num(empty.length)}
            tone={empty.length ? 'alert' : 'normal'} sub="scope for growth" />
          <StatTile label="Population reached" value={num(totals.population)} />
        </div>

        {busiest && busiest.businesses > 0 && (
          <div className="card shadow-sm text-sm text-gray-600">
            <strong className="text-navy-700">Most registrations:</strong>{' '}
            {busiest.pin_code ?? busiest.district ?? busiest.state} — {busiest.businesses} business
            {busiest.businesses === 1 ? '' : 'es'}
            {busiest.residents_per_business
              ? `, one per ${num(busiest.residents_per_business)} residents.` : '.'}
          </div>
        )}

        <div className="card shadow-sm">
          <p className="text-xs text-gray-500 mb-3">
            <strong>Registered here</strong> is where a business is based — one listing, one place.
            <strong> Advertising here</strong> counts every pincode it sells into, so one listing can
            appear in twenty rows. They answer different questions and are never added together.
          </p>
          <ScrollableTable>
            <table className="w-full text-sm" style={{ minWidth: 820 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  {scope !== 'state' && <th className="px-3 py-2.5 font-semibold">State</th>}
                  <th className="px-3 py-2.5 font-semibold">
                    {scope === 'pincode' ? 'Pincode' : scope === 'district' ? 'District' : 'State'}
                  </th>
                  {scope === 'pincode' && <th className="px-3 py-2.5 font-semibold">Area</th>}
                  <th className="px-3 py-2.5 font-semibold text-right">Population</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Registered here</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Active</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Advertising here</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Residents / business</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-50 last:border-0 ${
                    r.businesses === 0 ? 'bg-amber-50/40' : ''}`}>
                    {scope !== 'state' && <td className="px-3 py-2.5 text-gray-500">{r.state ?? '—'}</td>}
                    <td className="px-3 py-2.5 font-semibold text-navy-700">
                      {r.pin_code ?? r.district ?? r.state ?? '—'}
                    </td>
                    {scope === 'pincode' && <td className="px-3 py-2.5 text-gray-600">{r.area_name ?? '—'}</td>}
                    <td className="px-3 py-2.5 text-right">{num(r.population)}</td>
                    <td className="px-3 py-2.5 text-right font-bold">
                      {r.businesses === 0
                        ? <span className="text-amber-700">none yet</span>
                        : num(r.businesses)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{num(r.active)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-500">{num(r.covering)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">
                      {r.residents_per_business ? num(r.residents_per_business) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      </Msg>
    </div>
  )
}

// ── Type × region ───────────────────────────────────────────────────────────

function MatrixSection({ chip }: { chip: ChipFn }) {
  const [scope, setScope] = useState<'district' | 'state'>('district')
  const { data: rows, loading, error } = useAsync<MatrixRow[]>(
    () => getVerticalMatrix(scope), [scope], [])
  const { verticals, regions } = useMemo(() => pivotMatrix(rows), [rows])

  return (
    <div className="space-y-4">
      <div className="card shadow-sm flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 w-16">Group by</span>
        {(['district', 'state'] as const).map(s => (
          <button key={s} onClick={() => setScope(s)} className={chip(scope === s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <Msg loading={loading} error={error} empty={!rows.length}>
        <div className="card shadow-sm">
          <h3 className="font-bold text-navy-700 mb-1">What kind of business, and where</h3>
          <p className="text-sm text-gray-500 mb-3">
            Counted by primary location, so each business appears exactly once.
          </p>
          <ScrollableTable>
            <table className="w-full text-sm" style={{ minWidth: 620 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2.5 font-semibold">{scope === 'state' ? 'State' : 'District'}</th>
                  {verticals.map(v => (
                    <th key={v} className="px-3 py-2.5 font-semibold text-right capitalize">{v}</th>
                  ))}
                  <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {regions.map(r => (
                  <tr key={r.region} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2.5 font-semibold text-navy-700">{r.region}</td>
                    {verticals.map(v => (
                      <td key={v} className={`px-3 py-2.5 text-right ${
                        r.byVertical[v] ? '' : 'text-gray-300'}`}>
                        {r.byVertical[v] ?? '·'}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right font-bold">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      </Msg>
    </div>
  )
}

// ── Renewals ────────────────────────────────────────────────────────────────

function RenewalsSection({ chip }: { chip: ChipFn }) {
  const [window, setWindow] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const { data: rows, loading, error } = useAsync<RenewalRow[]>(
    () => getRenewals(window), [window, reloadKey], [])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  // Editing a location expands the row rather than opening a dialog: the admin
  // is comparing it against the district column two cells to the left, and a
  // modal would cover exactly that.
  const [editing, setEditing] = useState<string | null>(null)
  const [loc, setLoc] = useState({ pinCode: '', city: '', district: '', state: '' })

  const startEdit = (r: RenewalRow) => {
    setEditing(r.business_id)
    setLoc({ pinCode: r.pin_code ?? '', city: '', district: r.district ?? '', state: r.state ?? '' })
    setNotice('')
  }

  const saveLoc = useCallback(async (r: RenewalRow) => {
    setBusy(r.business_id)
    try {
      setNotice(await setBusinessLocation(r.business_id, loc))
      setEditing(null)
      setReloadKey(k => k + 1)
    } catch (e) { setNotice(`${r.name}: ${(e as Error).message}`) }
    finally { setBusy(null) }
  }, [loc])

  const onRemind = useCallback(async (r: RenewalRow) => {
    setBusy(r.business_id)
    try { setNotice(`${r.name}: ${await queueReminder(r.business_id)}`) }
    catch (e) { setNotice(`${r.name}: ${(e as Error).message}`) }
    finally { setBusy(null) }
  }, [])

  const lapsed = rows.filter(r => r.days_to_expiry !== null && r.days_to_expiry < 0)
  const soon = rows.filter(r => r.days_to_expiry !== null && r.days_to_expiry >= 0 && r.days_to_expiry <= 30)

  return (
    <div className="space-y-4">
      <div className="card shadow-sm space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 w-16">Due within</span>
          {([[null, 'All'], [15, '15 days'], [30, '30 days'], [90, '90 days']] as [number | null, string][])
            .map(([d, label]) => (
              <button key={label} onClick={() => setWindow(d)} className={chip(window === d)}>{label}</button>
            ))}
          <div className="ml-auto">
            <button onClick={() => downloadRenewals(rows)} disabled={!rows.length}
              className="btn-teal text-xs disabled:opacity-50">
              <Download className="w-3.5 h-3.5 inline mr-1.5" /> Download sheet
            </button>
          </div>
        </div>
      </div>

      {/* Said once, plainly, above the buttons rather than beside each one. */}
      <div className="card shadow-sm bg-amber-50 border-amber-200 text-sm text-amber-800 flex gap-2">
        <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
        <span>
          <strong>Reminders queue but do not send yet.</strong> The row is written and will go out the
          moment the sender is built and its email and WhatsApp credentials are set. Until then treat
          a queued reminder as a to-do, not as a clinic that has been contacted.
        </span>
      </div>

      {notice && <div className="card shadow-sm text-sm text-navy-700">{notice}</div>}

      <Msg loading={loading} error={error} empty={!rows.length}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Businesses" value={num(rows.length)} />
          <StatTile label="Lapsed" value={num(lapsed.length)} tone={lapsed.length ? 'alert' : 'normal'} />
          <StatTile label="Due in 30 days" value={num(soon.length)} />
          <StatTile label="On auto-renew" value={num(rows.filter(r => r.auto_renew).length)} />
        </div>

        <div className="card shadow-sm">
          <ScrollableTable>
            <table className="w-full text-sm" style={{ minWidth: 1100 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  {['Business', 'Type', 'District', 'Months', 'Term start', 'Term end',
                    'Days left', 'Auto', 'Renewal', 'Last reminded', '', ''].map((h, i) => (
                    <th key={`${h}-${i}`} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.business_id}>
                  <tr className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2.5 font-semibold text-navy-700 whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-2.5 text-gray-600 capitalize">{r.vertical}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                      {r.district ?? <span className="text-amber-600">not set</span>}
                      {r.pin_code && <span className="text-gray-400"> · {r.pin_code}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">{r.months_paid ?? '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                      {r.term_start ? shortDate(r.term_start) : '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                      {r.term_end ? shortDate(r.term_end) : '—'}</td>
                    <td className={`px-3 py-2.5 text-right font-semibold whitespace-nowrap ${
                      r.days_to_expiry === null ? 'text-gray-400'
                        : r.days_to_expiry < 0 ? 'text-red-600'
                        : r.days_to_expiry <= 15 ? 'text-amber-600' : 'text-gray-600'}`}>
                      {r.days_to_expiry === null ? '—'
                        : r.days_to_expiry < 0 ? `lapsed ${-r.days_to_expiry}d`
                        : `${r.days_to_expiry}d`}
                    </td>
                    <td className="px-3 py-2.5">{r.auto_renew ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                      {r.renewal_price != null ? money(r.renewal_price) : '—'}
                      {r.renewal_term_months ? ` / ${r.renewal_term_months}m` : ''}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">
                      {r.last_reminder_at ? shortDate(r.last_reminder_at) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => onRemind(r)}
                        disabled={busy === r.business_id || !r.term_end}
                        title={r.term_end ? 'Queue a renewal reminder' : 'No term to renew'}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-teal-400 hover:text-teal-700 disabled:opacity-40 whitespace-nowrap">
                        <Send className="w-3 h-3 inline mr-1" />
                        {busy === r.business_id ? 'Queueing…' : 'Remind'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => editing === r.business_id ? setEditing(null) : startEdit(r)}
                        title="Correct where this business is"
                        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-teal-400 hover:text-teal-700 whitespace-nowrap">
                        <Pencil className="w-3 h-3 inline mr-1" />
                        {editing === r.business_id ? 'Close' : 'Location'}
                      </button>
                    </td>
                  </tr>
                  {editing === r.business_id && (
                    <tr className="border-b border-gray-50 bg-gray-50/60">
                      <td colSpan={12} className="px-3 py-3">
                        <div className="flex items-end gap-3 flex-wrap">
                          <LocField label="Pincode" value={loc.pinCode} width={110}
                            onChange={v => setLoc(l => ({ ...l, pinCode: v.replace(/\D/g, '').slice(0, 6) }))} />
                          <LocField label="Town" value={loc.city} width={150}
                            onChange={v => setLoc(l => ({ ...l, city: v }))} />
                          <LocField label="District" value={loc.district} width={150}
                            onChange={v => setLoc(l => ({ ...l, district: v }))} />
                          <LocField label="State" value={loc.state} width={150}
                            onChange={v => setLoc(l => ({ ...l, state: v }))} />
                          <button onClick={() => saveLoc(r)}
                            disabled={loc.pinCode.length !== 6 || busy === r.business_id}
                            className="btn-teal text-xs disabled:opacity-50">
                            {busy === r.business_id ? 'Saving…' : 'Save location'}
                          </button>
                          <span className="text-xs text-gray-500 max-w-md leading-relaxed">
                            Where the business <strong>is</strong>. Leave town, district or state blank
                            and they are filled from the service area if we have launched that pincode.
                            This does not change the areas its listing is sold into.
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      </Msg>
    </div>
  )
}

// ── Where we are noticed ────────────────────────────────────────────────────

function GeoSection({ chip }: { chip: ChipFn }) {
  const [days, setDays] = useState(30)
  const { data: rows, loading, error } = useAsync<VisitorGeoRow[]>(
    () => getVisitorGeo(days), [days], [])

  const sessions = rows.reduce((s, r) => s + r.sessions, 0)
  const inIndia = rows.filter(r => r.country === 'IN')

  return (
    <div className="space-y-4">
      <div className="card shadow-sm flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 w-16">Last</span>
        {[7, 30, 90, 365].map(d => (
          <button key={d} onClick={() => setDays(d)} className={chip(days === d)}>{d} days</button>
        ))}
        <div className="ml-auto">
          <button onClick={() => downloadGeo(rows)} disabled={!rows.length}
            className="btn-teal text-xs disabled:opacity-50">
            <Download className="w-3.5 h-3.5 inline mr-1.5" /> Download sheet
          </button>
        </div>
      </div>

      <Msg loading={loading} error={error} empty={!rows.length}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Sessions" value={num(sessions)} />
          <StatTile label="Towns" value={num(rows.length)} />
          <StatTile label="From India" value={num(inIndia.reduce((s, r) => s + r.sessions, 0))} />
          <StatTile label="Business leads" value={num(rows.reduce((s, r) => s + r.business_leads, 0))} />
        </div>

        <div className="card shadow-sm">
          <h3 className="font-bold text-navy-700 mb-1 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-teal-600" /> Where we are being noticed
          </h3>
          <p className="text-sm text-gray-500 mb-3">
            Town-level, worked out from the network the visitor arrived on. No coordinate is ever
            tied to a person.
          </p>
          <ScrollableTable>
            <table className="w-full text-sm" style={{ minWidth: 760 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  {['Country', 'Region', 'City', 'Sessions', 'Page views', 'Searches',
                    'Profile views', 'Leads', 'Last seen'].map(h => (
                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2.5">{r.country ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.region ?? '—'}</td>
                    <td className="px-3 py-2.5 font-semibold text-navy-700">{r.city ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">{num(r.sessions)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{num(r.page_views)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{num(r.searches)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{num(r.profile_views)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{num(r.business_leads)}</td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                      {r.last_seen ? shortDate(r.last_seen) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      </Msg>
    </div>
  )
}

// ── Managing the areas we have launched ─────────────────────────────────────
//
// This is the screen that stops "which places exist" being a code question.
// Adding Jaipur used to mean writing a migration; now it is a form, and the
// public picker, the signup wizard's coverage and the tier pricing all follow
// from the same rows.
//
// Deactivate, never delete — see 0098. A business's coverage is a plain text
// array of pincodes with no foreign key, so removing a row would leave listings
// selling somewhere that no longer exists, in the rows that decide what they
// are paying for. Switching an area off takes it out of the public picker and
// out of new signups and is reversible, which is what this offers.

function ManageAreasSection({ chip }: { chip: ChipFn }) {
  const [reload, setReload] = useState(0)
  const { data: areas, loading, error } = useAsync<ServiceAreaRow[]>(
    () => listAllServiceAreas(), [reload], [])
  const { data: tiers } = useAsync<TierRow[]>(() => listTiers(), [], [])
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [q, setQ] = useState('')

  const blank = { pin_code: '', area_name: '', district: '', state: '', population: '', tier_number: '' }
  const [form, setForm] = useState<Record<string, string>>(blank)
  const upd = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Population decides the tier, so filling one fills the other. Advisory: the
  // admin can override, because a district headquarters with a modest resident
  // count can still be worth a city tier.
  const onPopulation = (v: string) => {
    const n = Number(v.replace(/\D/g, ''))
    setForm(f => {
      const suggested = Number.isFinite(n) && n > 0 ? tierForPopulation(tiers, n) : null
      return { ...f, population: v.replace(/\D/g, ''), tier_number: suggested ? String(suggested) : f.tier_number }
    })
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return areas
    return areas.filter(a => [a.pin_code, a.area_name, a.district, a.state]
      .some(v => (v ?? '').toLowerCase().includes(s)))
  }, [areas, q])

  const onAdd = async () => {
    setBusy('add')
    try {
      await addServiceArea({
        pin_code: form.pin_code.trim(),
        area_name: form.area_name.trim(),
        district: form.district.trim(),
        state: form.state.trim(),
        tier_number: Number(form.tier_number),
        population: Number(form.population || 0),
      })
      setNotice(`${form.area_name.trim()} is live.`)
      setForm(blank); setShowAdd(false); setReload(r => r + 1)
    } catch (e) { setNotice((e as Error).message) } finally { setBusy(null) }
  }

  const onToggle = async (a: ServiceAreaRow) => {
    setBusy(a.id)
    try {
      await updateServiceArea(a.id, { is_active: !a.is_active })
      setNotice(`${a.area_name} is now ${a.is_active ? 'switched off' : 'live'}.`)
      setReload(r => r + 1)
    } catch (e) { setNotice((e as Error).message) } finally { setBusy(null) }
  }

  const canAdd = form.pin_code.length === 6 && form.area_name.trim()
    && form.state.trim() && form.tier_number

  const live = areas.filter(a => a.is_active).length

  return (
    <div className="space-y-4">
      <div className="card shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-bold text-navy-700">Areas we have launched</h3>
            <p className="text-sm text-gray-500">
              These decide what patients can pick, what a signup is sold, and what a pincode costs.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => downloadServiceAreas(areas)} disabled={!areas.length}
              className="btn-teal text-xs disabled:opacity-50">
              <Download className="w-3.5 h-3.5 inline mr-1.5" /> Download
            </button>
            <button onClick={() => setShowAdd(v => !v)} className={chip(showAdd)}>
              {showAdd ? 'Cancel' : '+ Add an area'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="border-t border-gray-100 pt-3 space-y-3">
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
              <AreaField label="Pincode" value={form.pin_code}
                onChange={v => upd('pin_code', v.replace(/\D/g, '').slice(0, 6))} placeholder="302001" />
              <AreaField label="Area name" value={form.area_name}
                onChange={v => upd('area_name', v)} placeholder="MI Road" />
              <AreaField label="District" value={form.district}
                onChange={v => upd('district', v)} placeholder="Jaipur" />
              <AreaField label="State" value={form.state}
                onChange={v => upd('state', v)} placeholder="Rajasthan" />
              <AreaField label="Population" value={form.population}
                onChange={onPopulation} placeholder="3000000" />
              <label className="block">
                <span className="text-xs font-semibold text-gray-600 block mb-1.5">
                  Tier {form.population && <span className="font-normal text-gray-400">· suggested</span>}
                </span>
                <select value={form.tier_number} onChange={e => upd('tier_number', e.target.value)}
                  className="input-field text-sm py-2 w-full">
                  <option value="">Choose…</option>
                  {tiers.map(t => (
                    <option key={t.tier_number} value={t.tier_number}>
                      {t.tier_number} · {t.tier_name} · {money(t.monthly_price)}/mo
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onAdd} disabled={!canAdd || busy === 'add'}
                className="btn-teal text-sm disabled:opacity-50">
                {busy === 'add' ? 'Adding…' : 'Add area'}
              </button>
              <span className="text-xs text-gray-500">
                Live immediately — patients can pick it and new signups are sold coverage of it.
              </span>
            </div>
          </div>
        )}
      </div>

      {notice && <div className="card shadow-sm text-sm text-navy-700">{notice}</div>}

      <Msg loading={loading} error={error} empty={!areas.length}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Areas live" value={num(live)} />
          <StatTile label="Switched off" value={num(areas.length - live)} />
          <StatTile label="Districts" value={num(new Set(areas.map(a => a.district)).size)} />
          <StatTile label="States" value={num(new Set(areas.map(a => a.state)).size)} />
        </div>

        <div className="card shadow-sm">
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Filter by pincode, area, district or state…"
            className="input-field text-sm py-2 mb-3 w-full" aria-label="Filter areas" />
          <ScrollableTable>
            <table className="w-full text-sm" style={{ minWidth: 760 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  {['Pincode', 'Area', 'District', 'State', 'Tier', 'Population', 'Live', ''].map(h => (
                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} className={`border-b border-gray-50 last:border-0 ${
                    a.is_active ? '' : 'text-gray-400'}`}>
                    <td className="px-3 py-2.5 font-semibold text-navy-700">{a.pin_code}</td>
                    <td className="px-3 py-2.5">{a.area_name}</td>
                    <td className="px-3 py-2.5">{a.district ?? '—'}</td>
                    <td className="px-3 py-2.5">{a.state ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      {tiers.find(t => t.tier_number === a.tier_number)?.tier_name ?? a.tier_number}
                    </td>
                    <td className="px-3 py-2.5 text-right">{a.population ? num(a.population) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        a.is_active ? 'bg-teal-50 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>
                        {a.is_active ? 'Live' : 'Off'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => onToggle(a)} disabled={busy === a.id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:border-teal-400 hover:text-teal-700 disabled:opacity-40 whitespace-nowrap">
                        {busy === a.id ? '…' : a.is_active ? 'Switch off' : 'Switch on'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">
            Switching an area off removes it from the patient picker and from new signups. Listings
            already selling coverage of it keep it — their pincodes are stored as plain text, so
            deleting an area would leave them pointing at nothing. There is deliberately no delete.
          </p>
        </div>
      </Msg>
    </div>
  )
}

function AreaField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600 block mb-1.5">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="input-field text-sm py-2 w-full" />
    </label>
  )
}

function LocField({ label, value, onChange, width }: {
  label: string; value: string; onChange: (v: string) => void; width: number
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600 block mb-1">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} style={{ width }}
        className="input-field text-sm py-1.5" />
    </label>
  )
}
