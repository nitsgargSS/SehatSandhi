import { useEffect, useState, useCallback } from 'react'
import { BedDouble, Plus, X, LogOut as DischargeIcon } from 'lucide-react'
import { BIZ } from '../business/shared'
import { Spinner } from '../../components/Loading'
import {
  getOccupancy, getWards, addWard, addBed, dischargePatient, moveToBed,
  OccupancyRow, Ward,
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

export default function Wards({ businessId, practitionerId }: {
  businessId: string
  practitionerId?: string | null
}) {
  const [rows, setRows] = useState<OccupancyRow[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [setup, setSetup] = useState(false)
  const [moving, setMoving] = useState<OccupancyRow | null>(null)

  const reload = useCallback(async () => {
    try {
      const [o, w] = await Promise.all([getOccupancy(businessId), getWards(businessId)])
      setRows(o); setWards(w); setErr('')
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
        <button style={btn()} onClick={() => setSetup(s => !s)}>
          {setup ? 'Done' : 'Wards & beds'}
        </button>
      </div>

      {err && <div style={{ ...card, color: '#8a2b2b', fontSize: 13 }}>{err}</div>}

      {setup && <WardSetup businessId={businessId} wards={wards} onChange={reload} />}

      {rows.length === 0 && !setup && (
        <div style={{ ...card, textAlign: 'center', color: BIZ.muted, fontSize: 13.5 }}>
          <BedDouble className="w-5 h-5" style={{ display: 'inline', marginRight: 6 }} />
          No beds set up yet. Add a ward and its beds, then patients can be admitted from their record.
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
                      <div style={{ fontSize: 14, fontWeight: 700, color: BIZ.ink }}>{b.patient_name}</div>
                      <div style={{ fontSize: 12, color: BIZ.muted }}>
                        {[b.age_years != null ? `${b.age_years}y` : null, b.gender].filter(Boolean).join(' · ')}
                        {b.admitted_at && ` · day ${daysSince(b.admitted_at) + 1}`}
                      </div>
                      {b.attending_name && (
                        <div style={{ fontSize: 11.5, color: BIZ.mutedWarm }}>{b.attending_name}</div>
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
                  <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
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

function WardSetup({ businessId, wards, onChange }: {
  businessId: string
  wards: Ward[]
  onChange: () => void
}) {
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
      for (const l of labels) await addBed(businessId, bedWard, l)
      setBedLabels(''); onChange()
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
            <button style={btn(true)} disabled={!bedWard || !bedLabels.trim() || busy}
              onClick={createBeds}>Add beds</button>
          </div>
          <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 5 }}>
            A range like <strong>1-12</strong> creates twelve beds. Commas work too.
          </div>
        </div>
      )}

      {err && <div style={{ fontSize: 12.5, color: '#8a2b2b' }}>{err}</div>}
    </div>
  )
}
