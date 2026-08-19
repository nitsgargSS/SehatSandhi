import { useEffect, useState, useCallback } from 'react'
import { Search, Plus, BellRing, Check, X, UserPlus } from 'lucide-react'
import { BIZ } from '../business/shared'
import { Spinner } from '../../components/Loading'
import {
  getBoard, issueToken, callNext, setTokenStatus,
  stillWaiting, inProgress, finished,
  QueueEntry,
} from '../../lib/queueApi'
import { searchPatients, PatientSearchResult } from '../../lib/patientsApi'

// Today's OPD line — the screen reception has open all day.
//
// Built for the front desk first, not the doctor: the primary action is Give a
// token, the primary reading is who is still waiting, and both are reachable
// without scrolling. The doctor's use is one button, Call next.
//
// Refreshed on a timer as well as on every action, because two people work this
// screen at once — reception issuing numbers while the doctor calls them — and
// a board that only updates when you touch it is a board that lies to whoever
// is not touching it.

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: 16,
}
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: BIZ.mutedWarm,
}
const input: React.CSSProperties = {
  padding: '9px 11px', borderRadius: 9, fontFamily: 'inherit', fontSize: 14,
  border: `1px solid ${BIZ.inputBorder}`, background: '#fff', color: BIZ.ink,
}
const btn = (primary = false): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  padding: '8px 13px', borderRadius: 9,
  border: primary ? 'none' : `1px solid ${BIZ.inputBorder}`,
  background: primary ? BIZ.green : '#fff', color: primary ? '#fff' : BIZ.ink,
})

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''

export default function Queue({ businessId, practitionerId }: {
  businessId: string
  practitionerId?: string | null
}) {
  const [board, setBoard] = useState<QueueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const reload = useCallback(async () => {
    try { setBoard(await getBoard(businessId)); setErr('') }
    catch (e) { setErr((e as Error).message) }
    finally { setLoading(false) }
  }, [businessId])

  useEffect(() => { setLoading(true); reload() }, [reload])

  // Two people work this screen at once. 15 seconds is often enough to keep
  // reception and the consulting room agreeing without hammering the database.
  useEffect(() => {
    const t = setInterval(reload, 15000)
    return () => clearInterval(t)
  }, [reload])

  if (loading) return <div style={{ ...card, textAlign: 'center' }}><Spinner /></div>

  const waiting = stillWaiting(board)
  const active = inProgress(board)
  const done = finished(board)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); await reload() }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <div>
            <div style={label}>Waiting</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: BIZ.ink }}>{waiting.length}</div>
          </div>
          <div>
            <div style={label}>With the doctor</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: BIZ.ink }}>{active.length}</div>
          </div>
          <div>
            <div style={label}>Seen today</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: BIZ.ink }}>
              {done.filter(e => e.status === 'completed').length}
            </div>
          </div>
          {waiting[0]?.approx_wait_minutes != null && waiting.length > 1 && (
            <div>
              <div style={label}>Last in line waits about</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#8a5a00' }}>
                {waiting[waiting.length - 1]?.approx_wait_minutes} min
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <button style={btn()} disabled={busy || waiting.length === 0}
            onClick={() => act(async () => {
              const next = await callNext(businessId, practitionerId ?? null)
              if (!next) setErr('Nobody is waiting.')
            })}>
            <BellRing className="w-4 h-4" style={{ display: 'inline', marginRight: 5 }} />
            Call next
          </button>
          <button style={btn(true)} onClick={() => setAdding(a => !a)}>
            <Plus className="w-4 h-4" style={{ display: 'inline', marginRight: 4 }} />
            Give a token
          </button>
        </div>
      </div>

      {err && <div style={{ ...card, color: '#8a2b2b', fontSize: 13 }}>{err}</div>}

      {adding && (
        <IssueToken
          businessId={businessId} practitionerId={practitionerId}
          onIssued={() => { setAdding(false); reload() }}
          onError={setErr}
        />
      )}

      {active.length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>Now</div>
          <div style={{ display: 'grid', gap: 9 }}>
            {active.map(e => (
              <Row key={e.id} e={e} busy={busy} act={act} emphasis />
            ))}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>
          Waiting {waiting.length > 0 && `(${waiting.length})`}
        </div>
        {waiting.length === 0 ? (
          <div style={{ fontSize: 13.5, color: BIZ.muted }}>Nobody is waiting.</div>
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            {waiting.map(e => <Row key={e.id} e={e} busy={busy} act={act} />)}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>Finished ({done.length})</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {done.map(e => (
              <div key={e.id} style={{ fontSize: 13, color: BIZ.muted }}>
                <strong style={{ color: BIZ.ink }}>#{e.token_number}</strong> {e.patient_name}
                {' · '}{e.status === 'completed' ? `seen ${clock(e.completed_at)}`
                  : e.status === 'skipped' ? 'did not answer' : 'left'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ e, busy, act, emphasis }: {
  e: QueueEntry
  busy: boolean
  act: (fn: () => Promise<unknown>) => Promise<void>
  emphasis?: boolean
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
      flexWrap: 'wrap',
      padding: '10px 12px', borderRadius: 11,
      border: `1px solid ${emphasis ? '#bfe3d0' : BIZ.border}`,
      background: emphasis ? '#f6fbf8' : '#fcfbf8',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
        <div style={{
          fontSize: 17, fontWeight: 800, color: BIZ.ink,
          minWidth: 44, textAlign: 'center',
        }}>#{e.token_number}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: BIZ.ink }}>
            {e.patient_name}
            {e.priority > 0 && (
              <span title={e.priority_reason ?? undefined} style={{
                fontSize: 11, fontWeight: 800, marginLeft: 8, padding: '2px 7px',
                borderRadius: 999, background: '#fdf1f1', color: '#8a2b2b',
              }}>out of turn</span>
            )}
            {e.had_appointment && (
              <span style={{
                fontSize: 11, fontWeight: 700, marginLeft: 6, padding: '2px 7px',
                borderRadius: 999, background: BIZ.chipBg, color: BIZ.chipText,
              }}>booked</span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: BIZ.muted }}>
            {[
              e.age_years != null ? `${e.age_years}y` : null,
              e.gender,
              e.mrn ? `file ${e.mrn}` : null,
              e.practitioner_name,
              `arrived ${clock(e.arrived_at)}`,
              e.status === 'waiting' && e.approx_wait_minutes != null && e.approx_wait_minutes > 0
                ? `~${e.approx_wait_minutes} min` : null,
              e.status === 'called' ? `called ${clock(e.called_at)}` : null,
            ].filter(Boolean).join(' · ')}
          </div>
          {e.reason && (
            <div style={{ fontSize: 12.5, color: BIZ.ink, marginTop: 2 }}>{e.reason}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
        {e.status === 'waiting' && (
          <button style={{ ...btn(), fontSize: 12 }} disabled={busy}
            onClick={() => act(() => setTokenStatus(e.id, 'left'))}>Left</button>
        )}
        {e.status === 'called' && (
          <>
            <button style={{ ...btn(true), fontSize: 12 }} disabled={busy}
              onClick={() => act(() => setTokenStatus(e.id, 'in_consultation'))}>Start</button>
            {/* Back to waiting rather than a new token: they missed the call,
                they did not stop being here. */}
            <button style={{ ...btn(), fontSize: 12 }} disabled={busy}
              onClick={() => act(() => setTokenStatus(e.id, 'waiting'))}>No answer</button>
          </>
        )}
        {e.status === 'in_consultation' && (
          <button style={{ ...btn(true), fontSize: 12 }} disabled={busy}
            onClick={() => act(() => setTokenStatus(e.id, 'completed'))}>
            <Check className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 4 }} />Done
          </button>
        )}
      </div>
    </div>
  )
}

// ── Giving a token ──────────────────────────────────────────────────────────

function IssueToken({ businessId, practitionerId, onIssued, onError }: {
  businessId: string
  practitionerId?: string | null
  onIssued: () => void
  onError: (m: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientSearchResult[]>([])
  const [picked, setPicked] = useState<PatientSearchResult | null>(null)
  const [reason, setReason] = useState('')
  const [priority, setPriority] = useState(false)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const rows = await searchPatients(q, businessId)
        if (!cancelled) setResults(rows)
      } catch { /* the field below still works without matches */ }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, businessId])

  const give = async () => {
    if (!picked) return
    if (priority && !why.trim()) { onError('Say why this token goes out of turn.'); return }
    setBusy(true)
    try {
      await issueToken({
        patientMemberId: picked.patient_member_id,
        businessId,
        practitionerId: practitionerId ?? null,
        reason,
        priority: priority ? 10 : 0,
        priorityReason: priority ? why.trim() : undefined,
        createdBy: practitionerId ?? null,
      })
      onIssued()
    } catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ ...card, borderColor: BIZ.green }}>
      <div style={{ ...label, marginBottom: 9 }}>Who is it for?</div>

      {picked ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 11 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: BIZ.ink }}>
            {picked.full_name}
            <span style={{ fontSize: 12.5, fontWeight: 400, color: BIZ.muted, marginLeft: 8 }}>
              {picked.phone}
            </span>
          </div>
          <button style={{ ...btn(), padding: 6 }} onClick={() => { setPicked(null); setQuery('') }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Search className="w-4 h-4" style={{ color: BIZ.muted, flex: '0 0 auto' }} />
            <input style={{ ...input, flex: 1 }} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Name, phone or file number…" autoFocus />
          </div>
          {results.length > 0 && (
            <div style={{ marginTop: 9, display: 'grid', gap: 5 }}>
              {results.slice(0, 6).map(r => (
                <button key={r.patient_member_id} onClick={() => setPicked(r)}
                  style={{
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                    background: '#fcfbf8', border: `1px solid ${BIZ.border}`,
                    borderRadius: 9, padding: '8px 11px',
                  }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: BIZ.ink }}>{r.full_name}</span>
                  <span style={{ fontSize: 12.5, color: BIZ.muted }}>
                    {' · '}{r.phone}{r.age_years != null && ` · ${r.age_years}y`}
                  </span>
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            <div style={{ marginTop: 9, fontSize: 12.5, color: BIZ.mutedWarm }}>
              <UserPlus className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 5 }} />
              Nobody matches. A new patient has to be added first — book them, or
              scan them in at reception.
            </div>
          )}
        </>
      )}

      {picked && (
        <div style={{ display: 'grid', gap: 9 }}>
          <input style={input} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="What have they come for? (optional)" />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: BIZ.ink }}>
            <input type="checkbox" checked={priority} onChange={e => setPriority(e.target.checked)} />
            See out of turn
          </label>
          {priority && (
            <input style={input} value={why} onChange={e => setWhy(e.target.value)}
              placeholder="Why — emergency, elderly, unwell in the waiting room…" />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn(true)} disabled={busy} onClick={give}>Give token</button>
          </div>
        </div>
      )}
    </div>
  )
}
