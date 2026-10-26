import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

// One line until it is wanted (26 Oct 2026: "too much on one screen confuses
// anybody"). A title, a short summary of what is inside — a number, a status —
// and the rest one click away. Things set once (a fee, a banner, a profile) and
// things looked at now and then (a full table, a history) sit in one of these.
//
// `open` opens it from outside — a number elsewhere on the page that points
// here — and it can still be closed again.

export default function Fold({ title, summary, children, open: openFrom, defaultOpen = false, id, tone = 'card', ownCard = false }: {
  title: ReactNode
  /** Shown beside the title while closed, e.g. "₹600 · ₹450 offer" or "3 nurses". */
  summary?: ReactNode
  children: ReactNode
  /** Set (and changed) to open it from outside. */
  open?: boolean | number
  defaultOpen?: boolean
  id?: string
  /** 'card' is a card of its own; 'plain' sits inside another card. */
  tone?: 'card' | 'plain'
  /** The content draws its own card and heading: once open, it is shown as it is, with a small Hide above. */
  ownCard?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => { if (openFrom) setOpen(true) }, [openFrom])
  if (open && ownCard) return (
    <div id={id} className="scroll-mt-4 space-y-1">
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-teal-700 flex items-center gap-1">
        <ChevronDown className="w-4 h-4 rotate-180" /> Hide {typeof title === 'string' ? title.toLowerCase() : ''}
      </button>
      {children}
    </div>
  )
  return (
    <div id={id} className={tone === 'card' ? 'card shadow-sm scroll-mt-4' : 'scroll-mt-4'}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="font-bold text-navy-700">{title}</span>
          {summary != null && summary !== '' && <span className="text-sm text-gray-500"> · {summary}</span>}
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-teal-700 whitespace-nowrap">
          {open ? 'Hide' : 'Show'} <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
