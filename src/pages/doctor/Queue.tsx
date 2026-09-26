import { useEffect, useState, useCallback } from 'react'
import { Search, Plus, BellRing, Check, X, UserPlus, Printer } from 'lucide-react'
import { BIZ } from '../business/shared'
import { Spinner } from '../../components/Loading'
import {
  getBoard, callNext, setTokenStatus, opdVisit, patientHistory, opdSlipUrl, HistoryRow,
  stillWaiting, inProgress, finished,
  QueueEntry,
} from '../../lib/queueApi'
import { searchPatients, PatientSearchResult, registerPatient } from '../../lib/patientsApi'
import FeeChooser, { FeeChoice, emptyFee, feeToCharge, feeValid } from './FeeChooser'
import { listBusinessDoctors, BusinessDoctor } from '../../lib/doctorsApi'
import DoctorSelect from '../../components/DoctorSelect'

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
  // One line per doctor (0121). A doctor opens on their own line; reception
  // and the owner on everyone's, and either can switch.
  const [doctors, setDoctors] = useState<BusinessDoctor[]>([])
  const [view, setView] = useState<string | null>(practitionerId ?? null)
  useEffect(() => { listBusinessDoctors(businessId).then(setDoctors).catch(() => setDoctors([])) }, [businessId])

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

  // Filtered to the chosen doctor's line; tokens with no doctor show in every
  // line, so none are missed while reception still gives some without one.
  const shown = view ? board.filter(e => e.practitioner_id === view || !e.practitioner_id) : board
  const waiting = stillWaiting(shown)
  const active = inProgress(shown)
  const done = finished(shown)

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); await reload() }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {doctors.length > 1 && (
        <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={label}>Line</span>
          <DoctorSelect doctors={doctors} value={view} onChange={setView} allLabel="All doctors" style={{ ...input, width: 'auto' }} />
        </div>
      )}

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
              const next = await callNext(businessId, view ?? practitionerId ?? null)
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
          businessId={businessId} practitionerId={practitionerId} doctors={doctors} defaultDoctor={view}
          onIssued={() => reload()}
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
        <a href={opdSlipUrl(e.id)} target="_blank" rel="noreferrer" title="Print OPD slip"
          style={{ ...btn(), fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
          <Printer className="w-3.5 h-3.5" /> Slip
        </a>
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

function IssueToken({ businessId, practitionerId, doctors, defaultDoctor, onIssued, onError }: {
  businessId: string
  practitionerId?: string | null
  doctors: BusinessDoctor[]
  defaultDoctor: string | null
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
  // Which doctor's line. Reception picks; a doctor defaults to themselves; a
  // single-doctor clinic has nothing to pick.
  const [forDoctor, setForDoctor] = useState<string | null>(
    defaultDoctor ?? practitionerId ?? (doctors.length === 1 ? doctors[0].practitioner_id : null))
  // 0135: the doctor's fee (or a discount, or free), the patient's history
  // here, and a new patient registered in place when the search finds nobody.
  const [fee, setFee] = useState<FeeChoice>(emptyFee)
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [np, setNp] = useState({ name: '', phone: '', age: '', gender: '' })
  const [issued, setIssued] = useState<{ id: string; token: number } | null>(null)

  useEffect(() => {
    if (!picked) { setHistory(null); return }
    patientHistory(businessId, picked.patient_member_id).then(h => {
      setHistory(h)
      // A returning patient goes back to the doctor they last saw, unless the
      // desk has a reason to pick someone else.
      const last = h.find(r => r.doctor_id && doctors.some(d => d.practitioner_id === r.doctor_id))
      if (last && !defaultDoctor && doctors.length > 1) setForDoctor(last.doctor_id)
    }).catch(() => setHistory([]))
  }, [picked, businessId]) // eslint-disable-line react-hooks/exhaustive-deps

  const chosenDoctor = doctors.find(d => d.practitioner_id === (forDoctor ?? practitionerId ?? null)) ?? null

  const registerNew = async () => {
    setBusy(true)
    try {
      const id = await registerPatient(businessId, {
        fullName: np.name.trim(), phone: np.phone.trim(), relation: 'self',
        gender: np.gender || undefined, ageYears: np.age ? Number(np.age) : null,
      })
      setPicked({ patient_member_id: id, full_name: np.name.trim(), phone: np.phone.trim(), age_years: np.age ? Number(np.age) : null } as PatientSearchResult)
      setAdding(false); setNp({ name: '', phone: '', age: '', gender: '' })
    } catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }

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
    if (doctors.length > 1 && !forDoctor) { onError('Choose which doctor this token is for.'); return }
    if (!feeValid(fee, chosenDoctor)) { onError('For a discount or free visit, enter the amount and say why.'); return }
    setBusy(true)
    try {
      const r = await opdVisit({
        patientMemberId: picked.patient_member_id,
        businessId,
        practitionerId: forDoctor ?? practitionerId ?? null,
        reason,
        fee: feeToCharge(fee),
        discountReason: fee.mode === 'full' ? null : fee.reason.trim(),
        priority: priority ? 10 : 0,
        priorityReason: priority ? why.trim() : undefined,
      })
      setIssued({ id: r.queue_id, token: r.token_number })
      setPicked(null); setQuery(''); setFee(emptyFee); setReason(''); setPriority(false); setWhy('')
      onIssued()
    } catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ ...card, borderColor: BIZ.green }}>
      <div style={{ ...label, marginBottom: 9 }}>Who is it for?</div>
      {issued && (
        <div style={{ fontSize: 13, marginBottom: 10, padding: '8px 10px', borderRadius: 9, background: '#f3faf6', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          ✓ Token {issued.token} issued.
          <a href={opdSlipUrl(issued.id)} target="_blank" rel="noreferrer" style={{ color: BIZ.green, fontWeight: 700 }}>
            Print OPD slip
          </a>
          <button onClick={() => setIssued(null)} style={{ ...btn(), padding: 4 }}><X className="w-3 h-3" /></button>
        </div>
      )}

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
          {query.trim().length >= 2 && results.length === 0 && !adding && (
            <div style={{ marginTop: 9, fontSize: 12.5, color: BIZ.mutedWarm, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              Nobody matches — a new patient.
              <button style={{ ...btn(), fontSize: 12.5 }} onClick={() => {
                const d = query.replace(/\D/g, '')
                setNp({ name: d.length >= 10 ? '' : query.trim(), phone: d.length >= 10 ? d.slice(-10) : '', age: '', gender: '' })
                setAdding(true)
              }}>
                <UserPlus className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 5 }} />Register new patient
              </button>
            </div>
          )}
          {adding && (
            <div style={{ marginTop: 9, display: 'grid', gap: 7 }}>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <input style={{ ...input, flex: '2 1 180px' }} placeholder="Full name" value={np.name} onChange={e => setNp({ ...np, name: e.target.value })} />
                <input style={{ ...input, flex: '1 1 130px' }} placeholder="Mobile (10 digits)" inputMode="numeric" value={np.phone} onChange={e => setNp({ ...np, phone: e.target.value })} />
                <input style={{ ...input, flex: '0 1 80px' }} placeholder="Age" inputMode="numeric" value={np.age} onChange={e => setNp({ ...np, age: e.target.value })} />
                <select style={{ ...input, flex: '0 1 110px' }} value={np.gender} onChange={e => setNp({ ...np, gender: e.target.value })}>
                  <option value="">Gender</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btn(true)} disabled={busy || np.name.trim().length < 2 || np.phone.replace(/\D/g, '').length < 10} onClick={registerNew}>Register</button>
                <button style={btn()} onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {picked && (
        <div style={{ display: 'grid', gap: 9 }}>
          {history && history.length > 0 && (
            <div style={{ fontSize: 12.5, color: BIZ.muted, background: '#fcfbf8', border: `1px solid ${BIZ.border}`, borderRadius: 9, padding: '7px 10px' }}>
              <b style={{ color: BIZ.ink }}>Seen here before ({history.length}):</b>
              {history.slice(0, 4).map((h, i) => (
                <div key={i}>{new Date(h.seen_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {h.doctor_name ?? 'no doctor'} · {h.kind}{h.detail ? ` — ${h.detail}` : ''}</div>
              ))}
            </div>
          )}
          {history && history.length === 0 && (
            <div style={{ fontSize: 12.5, color: BIZ.mutedWarm }}>First visit here.</div>
          )}
          {doctors.length > 1 && (
            <DoctorSelect doctors={doctors} value={forDoctor} onChange={v => { setForDoctor(v); setFee(emptyFee) }} allLabel="Which doctor did they come for?" style={input} />
          )}
          <FeeChooser doctor={chosenDoctor} value={fee} onChange={setFee} input={input} />
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
            <button style={btn(true)} disabled={busy} onClick={give}>Give token{chosenDoctor && ((chosenDoctor.discounted_fee ?? chosenDoctor.consultation_fee ?? 0) > 0) ? ' & add fee' : ''}</button>
          </div>
        </div>
      )}
    </div>
  )
}
