import { useState } from 'react'
import { Scale, X, ExternalLink } from 'lucide-react'
import { C } from './IntlLayout'
import { readStore, writeStore } from '../../lib/intlContent'
import type { Procedure } from '../../lib/intlApi'

// 0319: treatments that Indian law allows for patients from abroad only on
// conditions (organ transplants and the like) open with their legal notes
// first. The patient accepts them, and the general declaration below, before
// comparing or asking for a quote; the acceptance travels with the request.

export const DECLARATION = [
  'I have read the legal notes above and will follow them and all Indian laws that apply to my treatment.',
  'I will not take part in anything illegal — including paying for or selling an organ, giving false documents, or asking for a treatment the law does not allow.',
  'I understand that the hospital and the government committees decide whether the treatment can go ahead, and that Sehatsandhi only helps with information and travel.',
  'I understand that Sehatsandhi is not responsible for any wrongdoing, loss or legal consequence that comes from breaking Indian law, by me or anyone acting for me.',
]

export const hasLegal = (p?: Procedure | null) => !!p && Array.isArray(p.legal_points) && p.legal_points.length > 0
const key = (p: Procedure) => `intl-legal-${p.code}-${p.legal_version ?? 'v1'}`
export const legalAccepted = (p?: Procedure | null) => !hasLegal(p) || readStore<boolean>(key(p!), false)
export const acceptLegal = (p: Procedure) => writeStore(key(p), true)

/** The notes on their own — for treatment pages and the quote form. */
export function LegalNotes({ p, compact = false }: { p: Procedure; compact?: boolean }) {
  if (!hasLegal(p)) return null
  return (
    <div className="rounded-2xl p-5" style={{ background: '#F3F0FF', border: '1px solid #D9D0FF' }}>
      <p className="font-semibold text-lg flex items-center gap-2" style={{ color: '#3E2A8C' }}><Scale className="w-5 h-5" /> {p.legal_title || 'Legal requirements in India'}</p>
      <ul className={`mt-3 flex flex-col gap-2 leading-relaxed ${compact ? 'text-[15px]' : ''}`}>
        {p.legal_points!.map(x => <li key={x} className="flex gap-2"><span aria-hidden style={{ color: '#5B43C4' }}>•</span><span>{x}</span></li>)}
      </ul>
      {p.legal_sources && p.legal_sources.length > 0 && (
        <p className="mt-3 text-sm" style={{ color: C.muted }}>Sources:{' '}
          {p.legal_sources.map((s, i) => (
            <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noreferrer nofollow" className="underline inline-flex items-center gap-0.5">{s.label}<ExternalLink className="w-3 h-3" /></a></span>
          ))}
        </p>
      )}
      <p className="mt-2 text-xs" style={{ color: C.muted }}>General information about the law, not legal advice. Rules can change; the hospital and the authorisation committee apply them to each case.</p>
    </div>
  )
}

/** The declaration with one box per line. Returns true when all are ticked. */
export function Declaration({ value, onChange }: { value: boolean[]; onChange: (v: boolean[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {DECLARATION.map((d, i) => (
        <label key={d} className="flex gap-3 items-start text-[15px]">
          <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={!!value[i]} onChange={e => { const n = [...value]; n[i] = e.target.checked; onChange(n) }} />
          <span>{d}</span>
        </label>
      ))}
    </div>
  )
}

/** The pop-up that opens when such a treatment is chosen. */
export function LegalGate({ p, onAccept, onCancel }: { p: Procedure; onAccept: () => void; onCancel: () => void }) {
  const [ticks, setTicks] = useState<boolean[]>(DECLARATION.map(() => false))
  const all = ticks.every(Boolean)
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Legal notes">
      <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: C.green }}>Before you continue</p>
            <h2 className="text-2xl font-bold mt-1">{p.name}</h2>
          </div>
          <button onClick={onCancel} aria-label="Close" className="p-2 -mr-2"><X className="w-6 h-6" /></button>
        </div>
        <p className="mt-2" style={{ color: C.muted }}>Indian law allows this treatment for patients from abroad only on certain conditions. Please read them and confirm.</p>
        <div className="mt-4"><LegalNotes p={p} /></div>
        <p className="font-semibold mt-5 mb-2">Your declaration</p>
        <Declaration value={ticks} onChange={setTicks} />
        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button onClick={onCancel} className="rounded-full px-5 py-3 font-semibold" style={{ border: `1.5px solid ${C.border}` }}>Choose another treatment</button>
          <button onClick={() => { acceptLegal(p); onAccept() }} disabled={!all}
            className="rounded-full px-5 py-3 font-semibold text-white disabled:opacity-40" style={{ background: C.green }}>
            I accept and want to continue
          </button>
        </div>
      </div>
    </div>
  )
}
