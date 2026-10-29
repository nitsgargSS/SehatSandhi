import { useEffect, useState, useCallback } from 'react'
import { BedDouble, Plus, X, LogOut as DischargeIcon } from 'lucide-react'
import { BIZ } from '../business/shared'
import { supabase } from '../../lib/supabase'
import { Spinner } from '../../components/Loading'
import {
  getOccupancy, getWards, addWard, addBed, dischargePatient, moveToBed,
  OccupancyRow, Ward, changeWard, getDepositBoard, setDepositLowAt, decideWardChange, listWardChanges, type WardChangeKind, type WardChangeRequest,
} from '../../lib/admissionsApi'

// The bed board — every bed and who is in it.
//
// Its own tab rather than a pane in a patient's record, and that is the one
// design decision here worth defending. Everything else about inpatients
// belongs on the chart, because the chart is one patient's story. This is the
// opposite question: not "what happened to this person" but "where is
// everyone, and what is free". A ward sister asks it forty times a day and
// never from inside somebody's file.
//
// Empty beds are rendered, not omitted. A board that only shows occupied beds
// answers the question nobody needs to ask.

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: 16,
}
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: BIZ.mutedWarm,
}
const input: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 9, fontFamily: 'inherit', fontSize: 14,
  border: `1px solid ${BIZ.inputBorder}`, background: '#fff', color: BIZ.ink,
}
const btn = (primary = false): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  padding: '8px 13px', borderRadius: 9,
  border: primary ? 'none' : `1px solid ${BIZ.inputBorder}`,
  background: primary ? BIZ.green : '#fff', color: primary ? '#fff' : BIZ.ink,
})

const WARD_KINDS = ['general', 'icu', 'hdu', 'private', 'semi_private', 'maternity', 'paediatric', 'isolation', 'emergency']

const daysSince = (iso: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))

export default function Wards({ businessId, practitionerId, role, onOpenPatient }: {
  businessId: string
  practitionerId?: string | null
  /** 0284: open the patient on their stay — orders, medicines, deposit, details. */
  onOpenPatient?: (memberId: string) => void
  /** 0269: the owner and a manager set wards and beds up; others only use them. */
  role?: string | null
}) {
  const canSetUp = role === 'owner' || role === 'manager'
  const isOwner = role === 'owner'
  const [changed, setChanged] = useState(0)
  const [deposits, setDeposits] = useState<Record<string, { left: number; low: boolean }>>({})
  const [rows, setRows] = useState<OccupancyRow[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [setup, setSetup] = useState(false)
  const [moving, setMoving] = useState<OccupancyRow | null>(null)

  const reload = useCallback(async () => {
    try {
      const [o, w] = await Promise.all([getOccupancy(businessId), getWards(businessId)])
      setRows(o); setWards(w); setErr(''); setChanged(n => n + 1)
      getDepositBoard(businessId).then(setDeposits).catch(() => setDeposits({}))
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [businessId])

  useEffect(() => { setLoading(true); reload() }, [reload])

  if (loading) return <div style={{ ...card, textAlign: 'center' }}><Spinner /></div>

  const occupied = rows.filter(r => r.occupied).length
  const byWard = rows.reduce<Record<string, OccupancyRow[]>>((acc, r) => {
    ;(acc[r.ward_name] ||= []).push(r); return acc
  }, {})

  const discharge = async (r: OccupancyRow) => {
    if (!r.admission_id) return
    const summary = window.prompt(`Discharge ${r.patient_name}. Summary / condition (optional):`)
    if (summary === null) return
    try {
      await dischargePatient(r.admission_id, {
        dischargeSummary: summary || undefined,
        practitionerId: practitionerId ?? null,
      })
      reload()
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: BIZ.ink }}>
            {occupied} of {rows.length} beds occupied
          </div>
          <div style={{ fontSize: 13, color: BIZ.muted, marginTop: 2 }}>
            {rows.length - occupied} free across {Object.keys(byWard).length} ward{Object.keys(byWard).length === 1 ? '' : 's'}
          </div>
        </div>
        {canSetUp && (
          <button style={btn()} onClick={() => setSetup(s => !s)}>
            {setup ? 'Done' : 'Wards & beds'}
          </button>
        )}
      </div>

      {err && <div style={{ ...card, color: '#8a2b2b', fontSize: 13 }}>{err}</div>}

      {canSetUp && <PendingChanges businessId={businessId} isOwner={isOwner} refresh={changed} onDecided={reload} />}

      {setup && canSetUp && <WardSetup businessId={businessId} wards={wards} beds={rows} isOwner={isOwner} onChange={reload} />}

      {rows.length === 0 && !setup && (
        <div style={{ ...card, textAlign: 'center', color: BIZ.muted, fontSize: 13.5 }}>
          <BedDouble className="w-5 h-5" style={{ display: 'inline', marginRight: 6 }} />
          {canSetUp ? 'No beds set up yet. Add a ward and its beds, then patients can be admitted from their record.'
            : 'No beds set up yet. The owner or a manager adds the wards and beds.'}
        </div>
      )}

      {Object.entries(byWard).map(([wardName, beds]) => (
        <div key={wardName} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 11 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: BIZ.ink }}>{wardName}</div>
            <div style={{ fontSize: 12.5, color: BIZ.muted }}>
              {beds.filter(b => b.occupied).length}/{beds.length} occupied
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 9 }}>
            {beds.map(b => (
              <div key={b.bed_id} style={{
                border: `1px solid ${b.occupied ? '#cfe3d8' : BIZ.border}`,
                background: b.occupied ? '#f4faf7' : '#fcfbf8',
                borderRadius: 11, padding: 11, minHeight: 92,
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: BIZ.ink }}>Bed {b.bed_label}</span>
                    {!b.occupied && <span style={{ fontSize: 11, fontWeight: 700, color: BIZ.green }}>free</span>}
                  </div>
                  {b.occupied ? (
                    <div style={{ marginTop: 5 }}>
                      {onOpenPatient && b.patient_member_id
                        ? <button onClick={() => onOpenPatient(b.patient_member_id!)} title="Open the stay: orders, medicines, deposit, details"
                            style={{ fontSize: 14, fontWeight: 700, color: BIZ.ink, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: 3 }}>{b.patient_name}</button>
                        : <div style={{ fontSize: 14, fontWeight: 700, color: BIZ.ink }}>{b.patient_name}</div>}
                      <div style={{ fontSize: 12, color: BIZ.muted }}>
                        {[b.age_years != null ? `${b.age_years}y` : null, b.gender].filter(Boolean).join(' · ')}
                        {b.admitted_at && ` · day ${daysSince(b.admitted_at) + 1}`}
                      </div>
                      {b.attending_name && (
                        <div style={{ fontSize: 11.5, color: BIZ.mutedWarm }}>{b.attending_name}</div>
                      )}
                      {/* 0270: the deposit left on this stay. */}
                      {b.admission_id && deposits[b.admission_id] && (
                        <div style={{ fontSize: 11.5, fontWeight: deposits[b.admission_id].low ? 800 : 500, color: deposits[b.admission_id].low ? '#8a2b2b' : BIZ.muted }}>
                          {deposits[b.admission_id].low ? 'Deposit low · ' : 'Deposit '}
                          {deposits[b.admission_id].left >= 0 ? `₹${Math.round(deposits[b.admission_id].left).toLocaleString('en-IN')} left` : `₹${Math.round(-deposits[b.admission_id].left).toLocaleString('en-IN')} short`}
                        </div>
                      )}
                      {b.expected_discharge && (
                        <div style={{ fontSize: 11.5, color: '#8a5a00' }}>
                          out {new Date(b.expected_discharge).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 5 }}>Available</div>
                  )}
                </div>

                {b.occupied && (
                  <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                    {onOpenPatient && b.patient_member_id && (
                      <button style={{ ...btn(true), fontSize: 11.5, padding: '5px 9px' }}
                        onClick={() => onOpenPatient(b.patient_member_id!)}>Open</button>
                    )}
                    <button style={{ ...btn(), fontSize: 11.5, padding: '5px 9px' }}
                      onClick={() => setMoving(b)}>Move</button>
                    <button style={{ ...btn(), fontSize: 11.5, padding: '5px 9px' }}
                      onClick={() => discharge(b)}>
                      <DischargeIcon className="w-3 h-3" style={{ display: 'inline', marginRight: 3 }} />
                      Discharge
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {moving && (
        <MoveBed
          row={moving} free={rows.filter(r => !r.occupied)}
          onClose={() => setMoving(null)}
          onMoved={() => { setMoving(null); reload() }}
          onError={setErr}
        />
      )}
    </div>
  )
}

function MoveBed({ row, free, onClose, onMoved, onError }: {
  row: OccupancyRow
  free: OccupancyRow[]
  onClose: () => void
  onMoved: () => void
  onError: (m: string) => void
}) {
  const [target, setTarget] = useState('')
  return (
    <div style={{ ...card, borderColor: BIZ.green }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: BIZ.ink }}>
          Move {row.patient_name} from {row.ward_name} / {row.bed_label}
        </div>
        <button style={{ ...btn(), padding: 6 }} onClick={onClose}><X className="w-3.5 h-3.5" /></button>
      </div>
      {free.length === 0 ? (
        <div style={{ fontSize: 13, color: BIZ.muted, marginTop: 9 }}>Every other bed is occupied.</div>
      ) : (
        <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
          <select style={{ ...input, flex: '1 1 220px' }} value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">Choose a free bed…</option>
            {free.map(f => (
              <option key={f.bed_id} value={f.bed_id}>{f.ward_name} / bed {f.bed_label}</option>
            ))}
          </select>
          <button style={btn(true)} disabled={!target}
            onClick={async () => {
              try { await moveToBed(row.admission_id!, target); onMoved() }
              catch (e) { onError((e as Error).message); onClose() }
            }}>Move</button>
        </div>
      )}
    </div>
  )
}

function WardSetup({ businessId, wards, beds, isOwner, onChange }: {
  businessId: string
  wards: Ward[]
  /** The board's rows: every bed, its charge, and whether someone is in it. */
  beds: OccupancyRow[]
  isOwner: boolean
  onChange: () => void
}) {
  const [charge, setCharge] = useState('')
  const [msg, setMsg] = useState('')
  const [wardName, setWardName] = useState('')
  const [kind, setKind] = useState('general')
  const [bedWard, setBedWard] = useState('')
  const [bedLabels, setBedLabels] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const createBeds = async () => {
    if (!bedWard || !bedLabels.trim()) return
    setBusy(true); setErr('')
    try {
      // "1-6" or "1,2,3" or "7A, 7B" — a ward is set up once and typing every
      // bed number individually is the sort of chore that stops it happening.
      const raw = bedLabels.split(',').map(s => s.trim()).filter(Boolean)
      const labels: string[] = []
      for (const part of raw) {
        const range = part.match(/^(\d+)\s*-\s*(\d+)$/)
        if (range) {
          const [a, b] = [Number(range[1]), Number(range[2])]
          for (let n = Math.min(a, b); n <= Math.max(a, b); n++) labels.push(String(n))
        } else labels.push(part)
      }
      // 0269: each new bed's daily charge, typed once for all of them.
      const perDay = charge.trim() === '' ? null : Number(charge)
      if (perDay != null && (!Number.isFinite(perDay) || perDay < 0)) throw new Error('Enter the daily charge in rupees, or leave it empty.')
      for (const l of labels) await addBed(businessId, bedWard, l, perDay)
      setBedLabels(''); setCharge(''); onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ ...card, display: 'grid', gap: 14 }}>
      <div>
        <div style={{ ...label, marginBottom: 7 }}>Add a ward</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: '1 1 180px' }} placeholder="Ward name"
            value={wardName} onChange={e => setWardName(e.target.value)} />
          <select style={{ ...input, flex: '0 1 160px' }} value={kind} onChange={e => setKind(e.target.value)}>
            {WARD_KINDS.map(k => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
          </select>
          <button style={btn(true)} disabled={!wardName.trim() || busy}
            onClick={async () => {
              setBusy(true)
              try { await addWard(businessId, wardName.trim(), kind); setWardName(''); onChange() }
              catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
            }}>
            <Plus className="w-4 h-4" style={{ display: 'inline', marginRight: 4 }} />Add
          </button>
        </div>
      </div>

      {wards.length > 0 && (
        <div>
          <div style={{ ...label, marginBottom: 7 }}>Add beds</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <select style={{ ...input, flex: '0 1 180px' }} value={bedWard} onChange={e => setBedWard(e.target.value)}>
              <option value="">Which ward…</option>
              {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <input style={{ ...input, flex: '1 1 200px' }} placeholder="1-12, or 7A, 7B"
              value={bedLabels} onChange={e => setBedLabels(e.target.value)} />
            <input style={{ ...input, flex: '0 1 150px' }} placeholder="Daily charge ₹" inputMode="decimal"
              value={charge} onChange={e => setCharge(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Daily charge in rupees" />
            <button style={btn(true)} disabled={!bedWard || !bedLabels.trim() || busy}
              onClick={createBeds}>Add beds</button>
          </div>
          <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 5 }}>
            A range like <strong>1-12</strong> creates twelve beds. Commas work too. The daily charge applies to each bed added.
          </div>
        </div>
      )}

      {isOwner && <DepositLevel businessId={businessId} />}

      {wards.length > 0 && (
        <ChangeWards businessId={businessId} wards={wards} beds={beds} isOwner={isOwner}
          onDone={(t) => { setMsg(t); onChange() }} onError={setErr} />
      )}

      {msg && <div style={{ fontSize: 12.5, color: BIZ.green }}>{msg}</div>}
      {err && <div style={{ fontSize: 12.5, color: '#8a2b2b' }}>{err}</div>}
    </div>
  )
}

// 0269: change what is already set up. The owner's change applies at once; a
// manager's goes to the owner, who approves it on this screen.
function ChangeWards({ businessId, wards, beds, isOwner, onDone, onError }: {
  businessId: string; wards: Ward[]; beds: OccupancyRow[]; isOwner: boolean
  onDone: (text: string) => void; onError: (text: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [val, setVal] = useState({ charge: '', text: '' })
  const [busy, setBusy] = useState(false)
  const run = async (kind: WardChangeKind, target: string, what: string, value: { charge?: number; text?: string } = {}) => {
    if ((kind === 'bed_remove' || kind === 'ward_remove') && !window.confirm(`Take ${what} out of service?`)) return
    setBusy(true); onError('')
    try {
      const r = await changeWard(businessId, kind, target, value)
      onDone(r.applied ? `Done: ${what}.` : (r.text ?? 'Sent to the owner for approval.'))
      setOpen(null); setVal({ charge: '', text: '' })
    } catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }
  const money = (n: number | null) => n == null ? 'no charge' : `₹${Number(n).toLocaleString('en-IN')}/day`
  const charge = () => Number(val.charge)
  const okCharge = val.charge.trim() !== '' && Number.isFinite(charge()) && charge() >= 0

  const editor = (key: string, kindCharge: WardChangeKind, kindText: WardChangeKind, kindRemove: WardChangeKind, target: string, name: string, removeBlocked: string | null) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      <input style={{ ...input, width: 130 }} placeholder="New charge ₹" inputMode="decimal" value={val.charge}
        onChange={e => setVal({ ...val, charge: e.target.value.replace(/[^0-9.]/g, '') })} />
      <button style={btn()} disabled={busy || !okCharge}
        onClick={() => run(kindCharge, target, `${name} — ₹${charge()}/day`, { charge: charge() })}>Set charge</button>
      <input style={{ ...input, width: 140 }} placeholder="New name" value={val.text} maxLength={60}
        onChange={e => setVal({ ...val, text: e.target.value })} />
      <button style={btn()} disabled={busy || !val.text.trim()}
        onClick={() => run(kindText, target, `${name} renamed to ${val.text.trim()}`, { text: val.text.trim() })}>Rename</button>
      <button style={{ ...btn(), color: '#8a2b2b' }} disabled={busy || !!removeBlocked} title={removeBlocked ?? undefined}
        onClick={() => run(kindRemove, target, name)}>Take out of service</button>
      <button style={{ ...btn(), border: 'none' }} onClick={() => setOpen(null)}>Close</button>
      {key && null}
    </div>
  )

  return (
    <div>
      <div style={{ ...label, marginBottom: 4 }}>Change wards &amp; beds</div>
      <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginBottom: 8 }}>
        {isOwner ? 'Your changes apply at once.' : 'Your changes go to the owner for approval before they apply.'}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {wards.map(w => {
          const wb = beds.filter(b => b.ward_id === w.id)
          const busyBeds = wb.filter(b => b.occupied).length
          return (
            <div key={w.id} style={{ border: `1px solid ${BIZ.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: BIZ.ink, fontSize: 13.5 }}>{w.name}
                  <span style={{ fontWeight: 400, color: BIZ.muted, fontSize: 12 }}> · {wb.length} beds · {[...new Set(wb.map(b => money(b.daily_charge)))].join(', ') || 'no beds'}</span></span>
                <button style={{ ...btn(), padding: '5px 10px', fontSize: 12 }} onClick={() => { setOpen(open === `w:${w.id}` ? null : `w:${w.id}`); setVal({ charge: '', text: '' }) }}>
                  Change ward
                </button>
              </div>
              {open === `w:${w.id}` && editor(`w:${w.id}`, 'ward_charge', 'ward_name', 'ward_remove', w.id, w.name,
                busyBeds ? `${busyBeds} patient${busyBeds === 1 ? ' is' : 's are'} in this ward` : null)}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
                {wb.map(b => (
                  <button key={b.bed_id} onClick={() => { setOpen(open === `b:${b.bed_id}` ? null : `b:${b.bed_id}`); setVal({ charge: '', text: '' }) }}
                    style={{ fontSize: 12, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${open === `b:${b.bed_id}` ? BIZ.green : BIZ.border}`, background: '#fff', color: BIZ.ink }}>
                    Bed {b.bed_label} · {money(b.daily_charge)}
                  </button>
                ))}
              </div>
              {wb.filter(b => open === `b:${b.bed_id}`).map(b =>
                <div key={b.bed_id}>{editor(`b:${b.bed_id}`, 'bed_charge', 'bed_label', 'bed_remove', b.bed_id, `${w.name} bed ${b.bed_label}`,
                  b.occupied ? 'Someone is in this bed' : null)}</div>)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CHANGE_WHAT: Record<WardChangeKind, string> = {
  bed_charge: 'Bed charge', ward_charge: 'Charge for the whole ward', bed_label: 'Bed renamed', ward_name: 'Ward renamed',
  bed_remove: 'Bed taken out', ward_remove: 'Ward taken out',
}

// 0269: changes waiting for the owner — the owner approves or rejects; a manager sees theirs waiting.
function PendingChanges({ businessId, isOwner, refresh, onDecided }: {
  businessId: string; isOwner: boolean; refresh: number; onDecided: () => void
}) {
  const [rows, setRows] = useState<WardChangeRequest[]>([])
  const [err, setErr] = useState('')
  useEffect(() => { listWardChanges(businessId).then(r => setRows(r.filter(x => x.status === 'pending'))).catch(() => setRows([])) }, [businessId, refresh])
  if (!rows.length) return null
  const decide = async (id: string, ok: boolean) => {
    const note = ok ? undefined : (window.prompt('Why not? (optional — the manager sees this)') ?? undefined)
    try { await decideWardChange(id, ok, note); setErr(''); onDecided() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div style={{ ...card, background: '#fffaf0', borderColor: '#f0dcb0' }}>
      <div style={{ ...label, marginBottom: 8, color: '#8a5a00' }}>
        {isOwner ? `Waiting for your approval (${rows.length})` : `Waiting for the owner's approval (${rows.length})`}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map(r => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
            <span>
              <b>{CHANGE_WHAT[r.kind]}</b> — {r.target_label}: {r.before_text} → <b>{r.after_text}</b>
              <span style={{ color: BIZ.muted, fontSize: 12 }}> · asked by {r.requested_by_name ?? 'manager'}, {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            </span>
            {isOwner && (
              <span style={{ display: 'flex', gap: 6 }}>
                <button style={btn(true)} onClick={() => decide(r.id, true)}>Approve</button>
                <button style={btn()} onClick={() => decide(r.id, false)}>Reject</button>
              </span>
            )}
          </div>
        ))}
      </div>
      {err && <div style={{ fontSize: 12.5, color: '#8a2b2b', marginTop: 6 }}>{err}</div>}
    </div>
  )
}

// 0270: below this, a stay's deposit shows as running low — the owner sets it.
function DepositLevel({ businessId }: { businessId: string }) {
  const [v, setV] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => {
    supabase.from('businesses').select('deposit_low_at').eq('id', businessId).maybeSingle()
      .then(({ data }) => setV(String((data as { deposit_low_at?: number } | null)?.deposit_low_at ?? 2000)))
  }, [businessId])
  return (
    <div>
      <div style={{ ...label, marginBottom: 7 }}>Deposit running low</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
        Warn when a patient's deposit left falls below ₹
        <input style={{ ...input, width: 110 }} inputMode="numeric" value={v} onChange={e => { setV(e.target.value.replace(/\D/g, '')); setSaved('') }} />
        <button style={btn()} disabled={v === ''} onClick={async () => {
          try { await setDepositLowAt(businessId, Number(v)); setSaved('Saved.') } catch (e) { setSaved((e as Error).message) }
        }}>Save</button>
        {saved && <span style={{ color: BIZ.green }}>{saved}</span>}
      </div>
    </div>
  )
}
