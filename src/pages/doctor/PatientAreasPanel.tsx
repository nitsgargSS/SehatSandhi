import { useEffect, useState } from 'react'
import { Download, MapPin } from 'lucide-react'
import { StatTile, BarList, Point } from '../../components/Charts'
import { getPatientAreas, areaLabel, isFocusArea, PatientAreaRow } from '../../lib/areaReportsApi'
import { toCsv } from '../../lib/adminInsightsApi'
import { downloadCsv } from '../../lib/billingApi'

// Where this business's patients come from, pincode by pincode, beside how many
// people in each pincode searched for what it offers.
//
// The finding is the mismatch: "14 searches for cardiology in Radaur, none of
// your patients from there" is somewhere to put up a poster or run a camp.
// Search counts are anonymous platform demand for the business's OWN
// specialities — nothing here says anything about another clinic.
//
// Where a patient lives is recorded from 0111 on: the bot keeps the pincode
// they booked from, and the front desk can type one in. Earlier patients sit in
// one "area not known" row, which shrinks as the record builds.

const COLUMNS: [keyof PatientAreaRow, string][] = [
  ['area_name', 'Area'], ['pin_code', 'PIN code'], ['district', 'District'],
  ['patients', 'Your patients'], ['bookings', 'Bookings'],
  ['searches', 'Searches for you'], ['unmet', 'Found nobody'],
]

export default function PatientAreasPanel({ businessId, days }: { businessId: string; days: number }) {
  const [rows, setRows] = useState<PatientAreaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getPatientAreas(businessId, days)
      .then(r => { if (!cancelled) { setRows(r); setError('') } })
      .catch(e => { if (!cancelled) { setRows([]); setError((e as Error).message) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [businessId, days])

  const known = rows.filter(r => r.pin_code)
  const unknown = rows.find(r => !r.pin_code)?.patients ?? 0
  const knownPatients = known.reduce((s, r) => s + r.patients, 0)
  const focus = known.filter(isFocusArea)
    .sort((a, b) => (b.searches - b.patients) - (a.searches - a.patients))
  const top = [...known].filter(r => r.patients > 0).sort((a, b) => b.patients - a.patients)

  // The district table: every pincode of the district, plus anywhere a patient
  // came from. Busy areas first, then the silent ones.
  const table = [...known]
    .filter(r => showAll || r.patients > 0 || r.searches > 0 || r.unmet > 0)
    .sort((a, b) => b.patients - a.patients || b.searches - a.searches || (a.pin_code ?? '').localeCompare(b.pin_code ?? ''))
  const hidden = known.length - table.length

  const onDownload = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`patients-by-area-${days}d-${stamp}.csv`, toCsv(rows, COLUMNS))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-700">Where your patients come from</h2>
          <p className="text-sm text-gray-500">
            Your patients by PIN code, beside how many people there searched for what you offer.
          </p>
        </div>
        <button onClick={onDownload} disabled={!rows.length} className="btn-teal text-xs disabled:opacity-50"
          title={rows.length ? 'Download this table as a CSV' : 'Nothing to download yet'}>
          <Download className="w-3.5 h-3.5 inline mr-1.5" />
          Download sheet
        </button>
      </div>

      {error && (
        <div className="card shadow-sm text-sm text-amber-700 bg-amber-50 border-amber-200">{error}</div>
      )}

      {loading ? (
        <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Patients with a known area" value={knownPatients} sub={`in the last ${days} days`} />
            <StatTile label="Areas they came from" value={top.length} />
            <StatTile label="Areas to focus on" value={focus.length} tone={focus.length ? 'alert' : 'normal'}
              sub="people searching, few coming to you" />
            <StatTile label="Area not known" value={unknown} sub="booked before areas were recorded" />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card shadow-sm">
              <BarList title="Where your patients live"
                data={top.slice(0, 8).map(r => ({ label: areaLabel(r), value: r.patients,
                  hint: r.in_district === false ? 'outside your district' : undefined })) as Point[]} />
            </div>
            <div className="card shadow-sm">
              <BarList title="Searches for you, where few patients come from"
                data={focus.slice(0, 8).map(r => ({ label: areaLabel(r), value: r.searches,
                  hint: `${r.patients} patient${r.patients === 1 ? '' : 's'} from here` })) as Point[]}
                alertWhen={d => d.value > 0} />
              {focus.length > 0 && (
                <p className="text-xs text-gray-500 mt-4">
                  People in these areas are looking for what you offer, and few of them are coming to you.
                  A health camp, a poster at the local chemist, or an offer on your listing is the usual start.
                </p>
              )}
            </div>
          </div>

          {/* Wide on purpose, so it scrolls inside its own box on a phone. */}
          <div className="card shadow-sm p-0 overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 640 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2.5 font-semibold">Area</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Your patients</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Bookings</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Searches for you</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Found nobody</th>
                  <th className="px-3 py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {table.map(r => (
                  <tr key={r.pin_code!} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <MapPin className="w-3.5 h-3.5 inline mr-1 text-gray-400" />
                      {areaLabel(r)}
                      {r.in_district === false && r.district && (
                        <span className="text-xs text-gray-400"> · {r.district}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-navy-700">{r.patients}</td>
                    <td className="px-3 py-2.5 text-right">{r.bookings}</td>
                    <td className="px-3 py-2.5 text-right">{r.searches}</td>
                    <td className="px-3 py-2.5 text-right">{r.unmet}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {isFocusArea(r) && (
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          Focus here
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!table.length && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                    No patients or searches with a known area in this period yet.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {hidden > 0 && (
            <button onClick={() => setShowAll(true)} className="text-xs font-semibold text-teal-700">
              Show the other {hidden} PIN codes in your district
            </button>
          )}

          <p className="text-xs text-gray-500 leading-relaxed">
            <strong>Your patients</strong> are counted by where they live — the PIN code entered at your front
            desk, or the one they booked from on WhatsApp. <strong>Searches for you</strong> counts searches on
            Sehatsandhi and its WhatsApp bot for your specialities in that area; they are anonymous, and nothing
            here shows another clinic. Areas are recorded from 19 September 2026, so earlier patients show as
            "area not known".
          </p>
        </>
      )}
    </div>
  )
}
