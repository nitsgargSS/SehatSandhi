import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, AlertTriangle } from 'lucide-react'
import { StatTile } from '../../components/Charts'
import ScrollableTable from '../../components/ScrollableTable'
import { moneyExact } from '../../lib/format'
import {
  getGstRegister, getGstSummary, downloadGstRegister, downloadGstSummary,
  resolvePeriod, recentFinancialYears, financialYear,
  GstPeriodKind, GstPeriod, GstRegisterRow, GstSummaryRow,
  REGISTER_COLUMNS, SUMMARY_COLUMNS,
} from '../../lib/gstApi'

// Our own invoices, in the shape a GST return is filed from.
//
// NG Technologies billing businesses under our GSTIN. Nothing here is a clinic
// billing a patient — that is the revenue panel on the business dashboard, and
// keeping the two apart is the whole reason they are separate screens.
//
// ── PERIODS ARE FINANCIAL ───────────────────────────────────────────────────
// Q1 is April to June. The picker is built from resolvePeriod(), which is a
// pure function with its own tests, precisely because filing January under the
// wrong quarter is a wrong return rather than a cosmetic slip.
//
// ── CANCELLED INVOICES ARE SHOWN, NOT COUNTED ───────────────────────────────
// The register lists them because GSTR-1 must declare the whole number series —
// an unexplained gap is what an assessment asks about. The summary and the
// tiles exclude them, because a cancelled invoice carries no liability. The
// screen says which is which rather than leaving it to be discovered.

const MONTHS: [number, string][] = [
  [4, 'Apr'], [5, 'May'], [6, 'Jun'], [7, 'Jul'], [8, 'Aug'], [9, 'Sep'],
  [10, 'Oct'], [11, 'Nov'], [12, 'Dec'], [1, 'Jan'], [2, 'Feb'], [3, 'Mar'],
]

export default function GstFilingPanel() {
  const years = useMemo(() => recentFinancialYears(4), [])
  const [fy, setFy] = useState(() => financialYear(new Date()))
  const [kind, setKind] = useState<GstPeriodKind>('month')
  const [monthIdx, setMonthIdx] = useState(() => new Date().getMonth() + 1)
  const [quarter, setQuarter] = useState(() => {
    const m = new Date().getMonth() + 1
    return m >= 4 ? Math.ceil((m - 3) / 3) : 4
  })
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const period: GstPeriod = useMemo(() => {
    if (kind === 'custom' && customFrom && customTo) {
      const [a, b] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom]
      return { from: a, to: b, label: `${a} to ${b}`, fy }
    }
    if (kind === 'custom') return resolvePeriod('month', fy, monthIdx)
    return resolvePeriod(kind, fy, kind === 'quarter' ? quarter : monthIdx)
  }, [kind, fy, monthIdx, quarter, customFrom, customTo])

  const [register, setRegister] = useState<GstRegisterRow[]>([])
  const [summary, setSummary] = useState<GstSummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getGstRegister(period), getGstSummary(period)])
      .then(([r, s]) => { if (!cancelled) { setRegister(r); setSummary(s); setError('') } })
      .catch(e => { if (!cancelled) { setRegister([]); setSummary([]); setError((e as Error).message) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [period])

  const sum = (k: keyof GstSummaryRow) => summary.reduce((s, r) => s + Number(r[k] ?? 0), 0)
  const cancelled = register.filter(r => r.status === 'cancelled')

  const chip = (active: boolean) =>
    `text-xs font-semibold px-3 py-1.5 rounded-full border ${
      active ? 'bg-teal-50 border-teal-500 text-teal-700'
             : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`

  const onRegister = useCallback(() => downloadGstRegister(register, period), [register, period])
  const onSummary = useCallback(() => downloadGstSummary(summary, period), [summary, period])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-navy-700">GST filing</h2>
        <p className="text-sm text-gray-500">
          Our own invoices, for the return. Periods are financial — Q1 is April to June.
        </p>
      </div>

      <div className="card shadow-sm space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 w-20">Period</span>
          {([['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly'], ['custom', 'Custom dates']] as [GstPeriodKind, string][])
            .map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>{label}</button>
            ))}
        </div>

        {kind !== 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 w-20">Year</span>
            {years.map(y => (
              <button key={y} onClick={() => setFy(y)} className={chip(fy === y)}>FY {y}</button>
            ))}
          </div>
        )}

        {kind === 'month' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 w-20">Month</span>
            {MONTHS.map(([m, label]) => (
              <button key={m} onClick={() => setMonthIdx(m)} className={chip(monthIdx === m)}>{label}</button>
            ))}
          </div>
        )}

        {kind === 'quarter' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 w-20">Quarter</span>
            {[1, 2, 3, 4].map(q => (
              <button key={q} onClick={() => setQuarter(q)} className={chip(quarter === q)}>
                Q{q} <span className="font-normal opacity-70">
                  {['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'][q - 1]}
                </span>
              </button>
            ))}
          </div>
        )}

        {kind === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-500 w-20">Dates</span>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="input-field text-sm py-1.5" aria-label="From date" />
            <span className="text-sm text-gray-400">to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="input-field text-sm py-1.5" aria-label="To date" />
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-gray-100">
          <span className="text-sm text-gray-600">
            <strong className="text-navy-700">{period.label}</strong>
            <span className="text-gray-400"> · {period.from} to {period.to}</span>
          </span>
          <div className="flex gap-2">
            <button onClick={onSummary} disabled={!summary.length}
              className="btn-teal text-xs disabled:opacity-50">
              <FileSpreadsheet className="w-3.5 h-3.5 inline mr-1.5" />
              Summary sheet
            </button>
            <button onClick={onRegister} disabled={!register.length}
              className="btn-teal text-xs disabled:opacity-50">
              <Download className="w-3.5 h-3.5 inline mr-1.5" />
              Invoice register
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="card shadow-sm text-sm text-amber-700 bg-amber-50 border-amber-200">{error}</div>
      )}

      {loading ? (
        <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
      ) : !register.length ? (
        <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">
          No invoices were raised in {period.label}.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Taxable value" value={moneyExact(sum('taxable_value'))}
              sub={`${register.length - cancelled.length} invoices`} />
            <StatTile label="CGST + SGST" value={moneyExact(sum('cgst_amount') + sum('sgst_amount'))}
              sub="intra-state" />
            <StatTile label="IGST" value={moneyExact(sum('igst_amount'))} sub="inter-state" />
            <StatTile label="Invoice total" value={moneyExact(sum('total_amount'))} sub="incl. tax" />
          </div>

          {cancelled.length > 0 && (
            <div className="card shadow-sm bg-amber-50 border-amber-200 text-sm text-amber-800 flex gap-2">
              <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
              <span>
                {cancelled.length} cancelled invoice{cancelled.length === 1 ? '' : 's'} in this period
                ({cancelled.map(c => c.invoice_number).join(', ')}). They are listed in the register
                because the return must declare the whole number series, and excluded from every total
                above because they carry no liability.
              </span>
            </div>
          )}

          <div className="card shadow-sm">
            <h3 className="font-bold text-navy-700 mb-1">Summary</h3>
            <p className="text-sm text-gray-500 mb-3">
              Rate-wise and place-wise — the figures the return is typed from.
            </p>
            <ScrollableTable>
              <table className="w-full text-sm" style={{ minWidth: 880 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  {SUMMARY_COLUMNS.map(([k, label]) => (
                    <th key={String(k)} className="px-3 py-2.5 font-semibold whitespace-nowrap">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0 text-sm">
                    {SUMMARY_COLUMNS.map(([k]) => (
                      <td key={String(k)} className="px-3 py-2.5 whitespace-nowrap">
                        {typeof r[k] === 'number' && k !== 'invoices' && k !== 'gst_rate'
                          ? moneyExact(r[k] as number)
                          : String(r[k] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              </table>
            </ScrollableTable>
          </div>

          <div className="card shadow-sm">
            <h3 className="font-bold text-navy-700 mb-1">Invoice register</h3>
            <p className="text-sm text-gray-500 mb-3">
              Every invoice in the period, in numbering order so a gap in the series is visible.
            </p>
            <ScrollableTable>
              <table className="w-full text-sm" style={{ minWidth: 1400 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  {REGISTER_COLUMNS.map(([k, label]) => (
                    <th key={String(k)} className="px-3 py-2.5 font-semibold whitespace-nowrap">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {register.map(r => (
                  <tr key={r.invoice_number}
                    className={`border-b border-gray-50 last:border-0 text-sm ${
                      r.status === 'cancelled' ? 'text-gray-400 line-through' : ''}`}>
                    {REGISTER_COLUMNS.map(([k]) => (
                      <td key={String(k)} className="px-3 py-2.5 whitespace-nowrap">
                        {typeof r[k] === 'boolean' ? (r[k] ? 'Yes' : 'No')
                          : typeof r[k] === 'number' && k !== 'gst_rate'
                            ? moneyExact(r[k] as number)
                            : String(r[k] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              </table>
            </ScrollableTable>
          </div>

          <p className="text-xs text-gray-500 leading-relaxed">
            These sheets are the register and summaries a return is typed or uploaded from — they are
            not a GSTN-ready JSON. That format has its own schema and validation, and a subtly wrong
            file fails at the portal or files something incorrect. Both CSVs open in the GST offline
            utility and in Excel.
          </p>
        </>
      )}
    </div>
  )
}
