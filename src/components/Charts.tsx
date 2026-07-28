// Small charts for the reporting screens, in plain HTML — no chart library.
//
// A library would add well over 100 kB to a bundle that is already 800 kB, for
// three shapes. These are divs with widths and heights.
//
// Colours: one series colour per chart, so no legend is needed and identity is
// never carried by colour alone. #0d9488 (the site's teal) and #d97706 for the
// "needs attention" case were checked with the palette validator — ΔE 12.5 under
// protanopia and 24.3 in normal vision, both above the floor, and every bar that
// uses the amber also carries a written label.
//
// Mark specs followed: 4px rounded ends anchored to the baseline, a 2px gap
// between bars, recessive axes, values as text tokens rather than in the series
// colour, and a hover tooltip on every mark.

const SERIES = '#0d9488'
const ALERT = '#d97706'

/** A single headline number. Not a chart — a number is clearer than a plot of one. */
export function StatTile({ label, value, sub, tone = 'normal' }: {
  label: string
  value: string | number
  sub?: string
  tone?: 'normal' | 'alert'
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="text-xs font-medium text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color: tone === 'alert' ? ALERT : '#1e3a5f' }}>
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

export interface Point { label: string; value: number; hint?: string }

/**
 * Daily counts over time.
 *
 * Columns rather than a line: these are discrete daily totals, often small
 * integers, and a line between them implies a continuity that days do not have.
 */
export function ColumnChart({ data, height = 140, title }: {
  data: Point[]
  height?: number
  title?: string
}) {
  const max = Math.max(1, ...data.map(d => d.value))
  const allZero = data.every(d => d.value === 0)

  return (
    <div>
      {title && <div className="text-sm font-semibold text-navy-700 mb-3">{title}</div>}
      {allZero ? (
        <div className="text-sm text-gray-400 py-8 text-center">
          Nothing recorded yet in this period.
        </div>
      ) : (
        <>
          <div className="flex items-end gap-[2px]" style={{ height }}>
            {data.map((d, i) => (
              <div key={i}
                title={`${d.label}: ${d.value.toLocaleString('en-IN')}${d.hint ? ` · ${d.hint}` : ''}`}
                className="flex-1 min-w-0 rounded-t transition-opacity hover:opacity-70"
                style={{
                  // A zero day keeps a 2px stub so the axis reads as continuous
                  // rather than looking like missing data.
                  height: `${Math.max(d.value === 0 ? 2 : 6, (d.value / max) * height)}px`,
                  background: d.value === 0 ? '#e5e7eb' : SERIES,
                  borderTopLeftRadius: 4, borderTopRightRadius: 4,
                }} />
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-gray-400 mt-2">
            <span>{data[0]?.label}</span>
            <span>peak {max.toLocaleString('en-IN')}</span>
            <span>{data[data.length - 1]?.label}</span>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Ranked magnitudes with long labels — areas, funnel stages.
 *
 * Horizontal, because "Cardiology in Chhachhrauli" does not fit under a column.
 * Every bar is directly labelled, so the value never depends on reading a gridline.
 */
export function BarList({ data, title, alertWhen }: {
  data: Point[]
  title?: string
  /** Marks a row as needing attention — always paired with its own written hint. */
  alertWhen?: (d: Point) => boolean
}) {
  const max = Math.max(1, ...data.map(d => d.value))
  if (!data.length) {
    return (
      <div>
        {title && <div className="text-sm font-semibold text-navy-700 mb-3">{title}</div>}
        <div className="text-sm text-gray-400 py-6 text-center">Nothing recorded yet.</div>
      </div>
    )
  }
  return (
    <div>
      {title && <div className="text-sm font-semibold text-navy-700 mb-3">{title}</div>}
      <div className="space-y-2">
        {data.map((d, i) => {
          const alert = alertWhen?.(d) ?? false
          return (
            <div key={i} title={`${d.label}: ${d.value.toLocaleString('en-IN')}`}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-xs text-gray-600 truncate">{d.label}</span>
                <span className="text-xs font-semibold text-navy-700 shrink-0">
                  {d.value.toLocaleString('en-IN')}
                  {d.hint && <span className="font-normal text-gray-400"> · {d.hint}</span>}
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: alert ? ALERT : SERIES }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 7 / 30 / 90 day selector. One row, above the charts it filters. */
export function RangePicker({ value, onChange }: {
  value: number
  onChange: (days: number) => void
}) {
  return (
    <div className="flex gap-2">
      {[7, 30, 90].map(d => (
        <button key={d} onClick={() => onChange(d)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
            value === d ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          {d} days
        </button>
      ))}
    </div>
  )
}
