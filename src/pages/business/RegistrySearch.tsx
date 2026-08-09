// Finding a business in what we already know, rather than making them type it.
//
// Two registries sit behind this, and they fill in different halves of the form:
// the clinic directory has names and addresses, and the medical register has
// names, registration numbers and councils. So a clinic searches for its address
// and a doctor searches for their credentials, and neither search can do the
// other's job.
//
// Search runs on Enter or on the button, not per keystroke. It is a database
// query away and takes a moment; firing one on every letter would be a lot of
// queries to throw away, and this is a form people fill in once.
//
// Everything found here is a suggestion. The fields stay editable afterwards,
// because the clinic directory is government data of unknown freshness and the
// business in front of us knows better than it does.

import { useState } from 'react'
import { Search, Check, X } from 'lucide-react'
import { BIZ } from './shared'
import { Spinner } from '../../components/Loading'

type State = 'idle' | 'searching' | 'results' | 'empty'

export interface SearchResult {
  /** What to show as the headline of a result — a clinic or a doctor's name. */
  title: string
  /** The line under it: an address, or a council and year. */
  subtitle: string
}

export function RegistrySearch<T extends SearchResult>({
  label, hint, placeholder, value, onChange, onSearch, onPick, emptyNote,
}: {
  label: string
  hint?: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSearch: (q: string) => Promise<T[]>
  onPick: (r: T) => void
  /** Shown when a search finds nothing. Never an error: typing it out is fine. */
  emptyNote: string
}) {
  const [state, setState] = useState<State>('idle')
  const [results, setResults] = useState<T[]>([])
  const [picked, setPicked] = useState<T | null>(null)

  const run = async () => {
    const q = value.trim()
    if (q.length < 3) return
    setState('searching')
    const found = await onSearch(q)
    setResults(found)
    setState(found.length ? 'results' : 'empty')
  }

  const choose = (r: T) => {
    setPicked(r)
    setResults([])
    setState('idle')
    onPick(r)
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: BIZ.ink, marginBottom: 7 }}>
        {label}
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setPicked(null); setState('idle') }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); run() } }}
          placeholder={placeholder}
          style={{
            flex: 1, padding: '12px 14px', border: `1px solid ${BIZ.inputBorder}`,
            borderRadius: 12, fontSize: 16, fontFamily: 'inherit', outline: 'none',
            background: '#fdfbf6', minWidth: 0,
          }} />
        <button type="button" onClick={run} disabled={value.trim().length < 3}
          title="Search"
          style={{
            flex: '0 0 auto', padding: '0 16px', borderRadius: 12, border: 'none',
            background: value.trim().length < 3 ? '#e6e0d4' : BIZ.green,
            color: '#fff', cursor: value.trim().length < 3 ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14,
          }}>
          {state === 'searching' ? <Spinner size={18} onDark label="Searching" /> : <Search size={16} />}
          <span className="hidden sm:inline">Find</span>
        </button>
      </div>

      {hint && state === 'idle' && !picked && (
        <p style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 6 }}>{hint}</p>
      )}

      {/* What we filled in, and how to undo it. Without the second part this is
          a form that changed itself and gave no way back. */}
      {picked && (
        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 10,
          background: BIZ.chipBg, border: `1px solid ${BIZ.green}33`,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <Check size={16} style={{ color: BIZ.chipText, flex: '0 0 auto', marginTop: 2 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.chipText }}>{picked.title}</div>
            <div style={{ fontSize: 12, color: BIZ.muted, overflowWrap: 'anywhere' }}>{picked.subtitle}</div>
          </div>
          <button type="button" onClick={() => setPicked(null)}
            title="Not this one"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: BIZ.muted, padding: 2 }}>
            <X size={15} />
          </button>
        </div>
      )}

      {state === 'results' && results.length > 0 && (
        <div style={{
          marginTop: 8, border: `1px solid ${BIZ.inputBorder}`, borderRadius: 12,
          overflow: 'hidden', background: '#fff',
        }}>
          {results.map((r, i) => (
            <button key={i} type="button" onClick={() => choose(r)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 13px',
                border: 'none', borderTop: i ? `1px solid ${BIZ.border}` : 'none',
                background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: BIZ.ink }}>{r.title}</div>
              <div style={{ fontSize: 12.5, color: BIZ.muted, overflowWrap: 'anywhere' }}>{r.subtitle}</div>
            </button>
          ))}
        </div>
      )}

      {/* Not finding yourself is ordinary — the directory is a few years old and
          covers hospitals better than small clinics. So this is a note, not an
          error, and nothing about it blocks the form. */}
      {state === 'empty' && (
        <p style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 6 }}>{emptyNote}</p>
      )}
    </div>
  )
}
