// The parts of a tab: the everyday ones as buttons, the rest under "More"
// (26 Oct 2026 — seven or eight buttons in a row was too many to read).

export default function SectionPills<K extends string>({ sections, primary, value, onChange }: {
  sections: [K, string][]
  /** The ones shown as buttons; every other one is under More. */
  primary: K[]
  value: K
  onChange: (k: K) => void
}) {
  const main = sections.filter(([k]) => primary.includes(k))
  const more = sections.filter(([k]) => !primary.includes(k))
  const pill = (on: boolean) => `text-xs font-semibold px-3 py-1.5 rounded-full border ${on
    ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`
  const inMore = more.some(([k]) => k === value)
  return (
    <div className="flex gap-1 flex-wrap items-center">
      {main.map(([k, label]) => <button key={k} onClick={() => onChange(k)} className={pill(value === k)}>{label}</button>)}
      {more.length > 0 && (
        <select value={inMore ? value : ''} onChange={e => e.target.value && onChange(e.target.value as K)}
          className={`${pill(inMore)} pr-6 cursor-pointer`} aria-label="More">
          <option value="">More…</option>
          {more.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      )}
    </div>
  )
}
