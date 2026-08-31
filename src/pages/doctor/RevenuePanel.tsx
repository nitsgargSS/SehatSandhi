import { useCallback, useEffect, useState } from 'react'
import { Download, IndianRupee } from 'lucide-react'
import { StatTile } from '../../components/Charts'
import { moneyExact, shortDate } from '../../lib/format'
import {
  getRevenueReport, revenueCsv, downloadCsv,
  REVENUE_GRAINS, REVENUE_COLUMNS, RevenueGrain, RevenueRow,
} from '../../lib/billingApi'

// What the clinic earned, by period and by revenue stream.
//
// Sits under the listing report because both answer "how is this doing", but it
// is a different kind of money: the listing report counts what Sehatsandhi
// brought, this counts what the clinic billed its own patients. Nothing here
// touches `invoices` or `payments`, which are what the business pays US.
//
// ── BILLED IS NOT COLLECTED, AND THE SCREEN SAYS SO ─────────────────────────
// The two tiles are deliberately side by side and deliberately labelled with
// the question each answers. A clinic looking at one number called "income"
// cannot tell whether it is owed the money or has it, and those lead to
// opposite decisions. Only billed is split by stream — a payment settles a bill
// rather than a line, so splitting collections would be a guess presented as a
// figure. Said in the footnote rather than left to be discovered.
//
// The table is the export. REVENUE_COLUMNS drives both the header row here and
// the CSV, so the sheet a clinic downloads cannot disagree with the screen it
// was looking at when it clicked.

export default function RevenuePanel({ businessId }: { businessId: string }) {
  const [grain, setGrain] = useState<RevenueGrain>('month')
  const [rows, setRows] = useState<RevenueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getRevenueReport(businessId, grain)
      .then(r => { if (!cancelled) { setRows(r); setError('') } })
      .catch(e => { if (!cancelled) { setRows([]); setError((e as Error).message) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [businessId, grain])

  const total = (k: keyof RevenueRow) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)

  const onDownload = useCallback(() => {
    const label = REVENUE_GRAINS.find(([g]) => g === grain)?.[1].toLowerCase() ?? grain
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`revenue-${label}-${stamp}.csv`, revenueCsv(rows, grain))
  }, [rows, grain])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-700">What you earned</h2>
          <p className="text-sm text-gray-500">
            Your own billing — consultations, beds, medicines and the rest.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Six grains, as tabs rather than a select: on a phone a select is a
              modal and this is the control people change most. */}
          <div className="flex gap-1 flex-wrap">
            {REVENUE_GRAINS.map(([g, label]) => (
              <button
                key={g}
                onClick={() => setGrain(g)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  grain === g
                    ? 'bg-teal-50 border-teal-500 text-teal-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={onDownload}
            disabled={!rows.length}
            className="btn-teal text-xs disabled:opacity-50"
            title={rows.length ? 'Download this table as a CSV' : 'Nothing to download yet'}>
            <Download className="w-3.5 h-3.5 inline mr-1.5" />
            Download sheet
          </button>
        </div>
      </div>

      {error && (
        <div className="card shadow-sm text-sm text-amber-700 bg-amber-50 border-amber-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
      ) : !rows.length ? (
        <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">
          <IndianRupee className="w-5 h-5 mx-auto mb-2 text-gray-300" />
          Nothing billed yet. Charges you record against a patient show up here.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Billed" value={moneyExact(total('billed_total'))} sub="what you charged" />
            <StatTile label="Collected" value={moneyExact(total('collected'))} sub="what you received" />
            <StatTile label="OPD fees" value={moneyExact(total('consultation'))} />
            <StatTile label="Admission & bed" value={moneyExact(total('bed'))} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Medicines" value={moneyExact(total('medicine'))} />
            <StatTile label="Procedures" value={moneyExact(total('procedure_'))} />
            <StatTile label="Lab" value={moneyExact(total('lab'))} />
            <StatTile label="Consumables & other"
              value={moneyExact(total('consumable') + total('other'))} />
          </div>

          {/* Wide on purpose, so it scrolls inside its own box rather than
              pushing the whole dashboard sideways on a phone. */}
          <div className="card shadow-sm p-0 overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 860 }}>
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  {REVENUE_COLUMNS.map(([k, label]) => (
                    <th key={String(k)} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${
                      k === 'period_start' || k === 'period_end' ? '' : 'text-right'
                    }`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.period_start} className="border-b border-gray-50 last:border-0">
                    {REVENUE_COLUMNS.map(([k]) => {
                      const dateCol = k === 'period_start' || k === 'period_end'
                      const countCol = k === 'bills_issued' || k === 'patients_seen'
                      return (
                        <td key={String(k)} className={`px-3 py-2.5 whitespace-nowrap ${
                          dateCol ? 'text-gray-600' : 'text-right'
                        } ${k === 'billed_total' ? 'font-bold text-navy-700' : ''}`}>
                          {dateCol ? shortDate(r[k] as string)
                            : countCol ? Number(r[k]).toLocaleString('en-IN')
                            : moneyExact(Number(r[k]))}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 leading-relaxed">
            <strong>Billed</strong> is what you charged, counted on the day you charged it.
            {' '}<strong>Collected</strong> is what you were paid, counted on the day it came in —
            a bill raised one month and paid the next belongs to both, in different columns.
            Only billed is split by stream: a payment settles a bill rather than a single line,
            so there is no honest way to say which part of it was for medicines.
            Cancelled and superseded bills are excluded.
          </p>
        </>
      )}
    </div>
  )
}
