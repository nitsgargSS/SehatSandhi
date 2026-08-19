import { useEffect, useState, useCallback } from 'react'
import { Search, AlertTriangle, Plus, X, Mic, MicOff, Calendar, Activity } from 'lucide-react'
import { BIZ } from '../business/shared'
import { Spinner } from '../../components/Loading'
import {
  searchPatients, getPatientSummary, getVisits, getVitals, getAllergies,
  getConditions, getMedications, addVisit, addVital, addAllergy, addCondition,
  addMedication, stopMedication, grantRecordingConsent, withdrawRecordingConsent,
  logAccess,
  PatientSearchResult, PatientSummary, Visit, Vital, Allergy, Condition, Medication,
} from '../../lib/patientsApi'

// The clinic's patient records — search, history, and the clinical detail a
// doctor needs on screen before they prescribe anything.
//
// Its own component rather than another section of Dashboard.tsx, which is
// already 1,800 lines. The dashboard renders it as a tab and passes the
// business whose records these are.
//
// Two things here are load-bearing rather than decorative:
//
//   Allergies are rendered first, in red, above everything else. A prescribing
//   screen that makes an allergy something you scroll to find is unsafe, so it
//   sits in the header where it cannot be missed.
//
//   The recording toggle refuses to turn on until the patient has agreed, and
//   asks what the agreement WAS. That is not a formality: consent to be
//   recorded belongs to the patient, the doctor is only the person entering it,
//   and the database rejects a recording that cannot cite a live consent.

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${BIZ.border}`, borderRadius: 14, padding: 16,
}
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: .4, textTransform: 'uppercase', color: BIZ.mutedWarm,
}
const input: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, fontFamily: 'inherit', fontSize: 14,
  border: `1px solid ${BIZ.inputBorder}`, background: '#fff', color: BIZ.ink,
}
const btn = (primary = false): React.CSSProperties => ({
  fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  padding: '8px 14px', borderRadius: 9,
  border: primary ? 'none' : `1px solid ${BIZ.inputBorder}`,
  background: primary ? BIZ.green : '#fff', color: primary ? '#fff' : BIZ.ink,
})

const age = (p: { age_years: number | null; date_of_birth: string | null }) => {
  if (p.date_of_birth) {
    const d = new Date(p.date_of_birth)
    return Math.floor((Date.now() - d.getTime()) / 31557600000)
  }
  return p.age_years
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function Patients({ businessId, practitionerId }: {
  businessId: string
  practitionerId?: string | null
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Debounced so a doctor typing a ten-digit phone number does not fire ten
  // queries, each returning a wider result set than the last.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const rows = await searchPatients(q, businessId)
        if (!cancelled) { setResults(rows); setError('') }
        logAccess(businessId, null, 'search', q.length > 40 ? q.slice(0, 40) : q)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, businessId])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Search className="w-4 h-4" style={{ color: BIZ.muted, flex: '0 0 auto' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, phone number or file number…"
            aria-label="Search patients"
            style={{ ...input, border: 'none', padding: '4px 0', fontSize: 15 }}
          />
          {searching && <Spinner />}
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#f0c9c9', background: '#fdf4f4', color: '#8a2b2b', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!selected && results.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {results.map((r, i) => (
            <button
              key={r.patient_member_id}
              onClick={() => { setSelected(r.patient_member_id); logAccess(businessId, r.patient_member_id, 'view') }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                fontFamily: 'inherit', background: '#fff', border: 'none',
                borderTop: i === 0 ? 'none' : `1px solid ${BIZ.border}`, padding: '12px 16px',
              }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: BIZ.ink }}>
                {r.full_name}
                {r.relation !== 'self' && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: BIZ.mutedWarm, marginLeft: 8 }}>
                    {r.relation}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: BIZ.muted, marginTop: 2 }}>
                {r.phone}
                {r.age_years != null && ` · ${r.age_years}y`}
                {r.gender && ` · ${r.gender}`}
                {r.mrn && ` · file ${r.mrn}`}
                {' · '}{r.visit_count} visit{r.visit_count === 1 ? '' : 's'}
                {r.last_seen_at && ` · last ${when(r.last_seen_at)}`}
              </div>
            </button>
          ))}
        </div>
      )}

      {!selected && query.trim().length >= 2 && !searching && results.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: BIZ.muted, fontSize: 13.5 }}>
          Nobody on your list matches that. A patient appears here once they book,
          scan your reception QR, or are added at the front desk.
        </div>
      )}

      {selected && (
        <PatientRecord
          memberId={selected}
          businessId={businessId}
          practitionerId={practitionerId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ── One patient ─────────────────────────────────────────────────────────────

function PatientRecord({ memberId, businessId, practitionerId, onClose }: {
  memberId: string
  businessId: string
  practitionerId?: string | null
  onClose: () => void
}) {
  const [summary, setSummary] = useState<PatientSummary | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [vitals, setVitals] = useState<Vital[]>([])
  const [allergies, setAllergies] = useState<Allergy[]>([])
  const [conditions, setConditions] = useState<Condition[]>([])
  const [meds, setMeds] = useState<Medication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pane, setPane] = useState<'history' | 'clinical' | 'vitals'>('history')

  const reload = useCallback(async () => {
    try {
      const [s, v, vt, a, c, m] = await Promise.all([
        getPatientSummary(memberId, businessId),
        getVisits(memberId, businessId),
        getVitals(memberId, businessId),
        getAllergies(memberId, businessId),
        getConditions(memberId, businessId),
        getMedications(memberId, businessId),
      ])
      setSummary(s); setVisits(v); setVitals(vt)
      setAllergies(a); setConditions(c); setMeds(m)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [memberId, businessId])

  useEffect(() => { setLoading(true); reload() }, [reload])

  if (loading) return <div style={{ ...card, textAlign: 'center' }}><Spinner /></div>
  if (error) return <div style={{ ...card, color: '#8a2b2b' }}>{error}</div>
  if (!summary) return <div style={{ ...card }}>That patient is not on this clinic's list.</div>

  const live = allergies.filter(a => a.is_active)

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* header */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: BIZ.ink }}>{summary.full_name}</div>
            <div style={{ fontSize: 13, color: BIZ.muted, marginTop: 3 }}>
              {summary.phone}
              {age(summary) != null && ` · ${age(summary)}y`}
              {summary.gender && ` · ${summary.gender}`}
              {summary.blood_group && ` · ${summary.blood_group}`}
              {summary.mrn && ` · file ${summary.mrn}`}
            </div>
            <div style={{ fontSize: 12.5, color: BIZ.mutedWarm, marginTop: 3 }}>
              {summary.visits_here} visit{summary.visits_here === 1 ? '' : 's'} here
              {summary.last_seen_at && ` · last seen ${when(summary.last_seen_at)}`}
              {' · added via '}{summary.source.replace('_', ' ')}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close record" style={{ ...btn(), padding: 7 }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Allergies come first and in red. A prescribing screen that makes this
            something you scroll to find is unsafe. */}
        {live.length > 0 && (
          <div style={{
            marginTop: 13, padding: '10px 12px', borderRadius: 10,
            background: '#fdf1f1', border: '1px solid #f0c9c9',
            display: 'flex', gap: 9, alignItems: 'flex-start',
          }}>
            <AlertTriangle className="w-4 h-4" style={{ color: '#b3261e', flex: '0 0 auto', marginTop: 1 }} />
            <div style={{ fontSize: 13.5, color: '#8a2b2b', fontWeight: 700 }}>
              Allergic to {live.map(a => a.substance + (a.severity ? ` (${a.severity})` : '')).join(', ')}
            </div>
          </div>
        )}

        {(summary.conditions?.length || summary.next_follow_up) && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {(summary.conditions ?? []).map(c => (
              <span key={c} style={{
                fontSize: 12, fontWeight: 700, padding: '4px 9px', borderRadius: 999,
                background: BIZ.chipBg, color: BIZ.chipText,
              }}>{c}</span>
            ))}
            {summary.next_follow_up && (
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '4px 9px', borderRadius: 999,
                background: '#fff5e5', color: '#8a5a00',
              }}>
                <Calendar className="w-3 h-3" style={{ display: 'inline', marginRight: 4 }} />
                Follow-up due {when(summary.next_follow_up)}
              </span>
            )}
          </div>
        )}
      </div>

      <RecordingConsent
        summary={summary}
        businessId={businessId}
        onChange={reload}
      />

      {/* panes */}
      <div style={{ display: 'flex', gap: 6 }}>
        {([['history', 'Visits'], ['clinical', 'Allergies & medicines'], ['vitals', 'Vitals']] as const).map(([id, lbl]) => (
          <button key={id} onClick={() => setPane(id)}
            style={{ ...btn(pane === id), fontSize: 12.5 }}>{lbl}</button>
        ))}
      </div>

      {pane === 'history' && (
        <VisitHistory
          visits={visits} memberId={memberId} businessId={businessId}
          practitionerId={practitionerId} onAdded={reload}
        />
      )}
      {pane === 'clinical' && (
        <ClinicalPane
          memberId={memberId} businessId={businessId}
          allergies={allergies} conditions={conditions} meds={meds} onChange={reload}
        />
      )}
      {pane === 'vitals' && (
        <VitalsPane memberId={memberId} businessId={businessId} vitals={vitals} onChange={reload} />
      )}
    </div>
  )
}

// ── Consent, and the toggle that depends on it ──────────────────────────────

function RecordingConsent({ summary, businessId, onChange }: {
  summary: PatientSummary
  businessId: string
  onChange: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [basis, setBasis] = useState('Asked in the consulting room and agreed')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const on = summary.recording_consent

  const grant = async () => {
    if (!basis.trim()) { setErr('Say how the patient agreed — it is the evidence.'); return }
    setBusy(true); setErr('')
    try {
      await grantRecordingConsent(summary.patient_member_id, businessId, basis.trim())
      setAsking(false); onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const withdraw = async () => {
    setBusy(true); setErr('')
    try {
      await withdrawRecordingConsent(summary.patient_member_id, businessId)
      onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ ...card, background: on ? '#f3faf6' : '#fff', borderColor: on ? '#bfe3d0' : BIZ.border }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          {on ? <Mic className="w-4 h-4" style={{ color: BIZ.green }} />
              : <MicOff className="w-4 h-4" style={{ color: BIZ.mutedWarm }} />}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: BIZ.ink }}>
              Consultation recording {on ? 'allowed' : 'not allowed'}
            </div>
            <div style={{ fontSize: 12.5, color: BIZ.muted, marginTop: 2, maxWidth: 560 }}>
              {on
                ? 'This patient has agreed. Recordings are transcribed for you to check and correct; the audio is deleted once you confirm the note.'
                : 'The patient has to agree before a consultation can be recorded. Ask them, then record what they said here.'}
            </div>
          </div>
        </div>
        {on
          ? <button onClick={withdraw} disabled={busy} style={btn()}>Withdraw</button>
          : <button onClick={() => setAsking(a => !a)} style={btn(true)}>Patient agreed…</button>}
      </div>

      {asking && !on && (
        <div style={{ marginTop: 13, display: 'grid', gap: 8 }}>
          <div style={label}>How did they agree?</div>
          <input value={basis} onChange={e => setBasis(e.target.value)} style={input}
            placeholder="e.g. asked verbally and agreed, or signed form no. 412" />
          <div style={{ fontSize: 12, color: BIZ.mutedWarm }}>
            Stored as the evidence for this consent, alongside the date. Consent you
            cannot evidence is consent you cannot defend.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={grant} disabled={busy} style={btn(true)}>Save consent</button>
            <button onClick={() => setAsking(false)} style={btn()}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div style={{ marginTop: 9, fontSize: 12.5, color: '#8a2b2b' }}>{err}</div>}
    </div>
  )
}

// ── Visits ──────────────────────────────────────────────────────────────────

function VisitHistory({ visits, memberId, businessId, practitionerId, onAdded }: {
  visits: Visit[]
  memberId: string
  businessId: string
  practitionerId?: string | null
  onAdded: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ chiefComplaint: '', diagnosis: '', advice: '', followUpDue: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true); setErr('')
    try {
      await addVisit(memberId, businessId, { ...f, followUpDue: f.followUpDue || null, practitionerId })
      setF({ chiefComplaint: '', diagnosis: '', advice: '', followUpDue: '', notes: '' })
      setAdding(false); onAdded()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!adding && (
        <button onClick={() => setAdding(true)} style={{ ...btn(true), justifySelf: 'start' }}>
          <Plus className="w-4 h-4" style={{ display: 'inline', marginRight: 5 }} /> Record a visit
        </button>
      )}

      {adding && (
        <div style={card}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div><div style={label}>Complaint</div>
              <input style={input} value={f.chiefComplaint}
                onChange={e => setF({ ...f, chiefComplaint: e.target.value })}
                placeholder="What brought them in" /></div>
            <div><div style={label}>Diagnosis</div>
              <input style={input} value={f.diagnosis}
                onChange={e => setF({ ...f, diagnosis: e.target.value })} /></div>
            <div><div style={label}>Advice</div>
              <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={f.advice}
                onChange={e => setF({ ...f, advice: e.target.value })} /></div>
            <div><div style={label}>Follow-up due</div>
              <input type="date" style={input} value={f.followUpDue}
                onChange={e => setF({ ...f, followUpDue: e.target.value })} />
              <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 4 }}>
                A date here is what a reminder can be sent from later.
              </div></div>
            {err && <div style={{ fontSize: 12.5, color: '#8a2b2b' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={save} disabled={busy} style={btn(true)}>Save visit</button>
              <button onClick={() => setAdding(false)} style={btn()}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {visits.length === 0 && !adding && (
        <div style={{ ...card, color: BIZ.muted, fontSize: 13.5 }}>
          No visits recorded here yet.
        </div>
      )}

      {visits.map(v => (
        <div key={v.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: BIZ.ink }}>
              {when(v.visit_date ?? v.created_at)}
              <span style={{
                fontSize: 11, fontWeight: 700, marginLeft: 8, padding: '2px 7px', borderRadius: 999,
                background: BIZ.creamAlt, color: BIZ.muted, textTransform: 'uppercase',
              }}>{v.visit_type}</span>
            </div>
            {v.follow_up_due && (
              <div style={{ fontSize: 12, color: '#8a5a00', fontWeight: 700 }}>
                follow-up {when(v.follow_up_due)}
              </div>
            )}
          </div>
          {v.chief_complaint && <Row k="Complaint" v={v.chief_complaint} />}
          {v.diagnosis && <Row k="Diagnosis" v={v.diagnosis} />}
          {v.advice && <Row k="Advice" v={v.advice} />}
          {/* Imported register lines carry notes and nothing else. */}
          {v.notes && <Row k="Notes" v={v.notes} />}
        </div>
      ))}
    </div>
  )
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div style={{ marginTop: 8 }}>
    <div style={label}>{k}</div>
    <div style={{ fontSize: 13.5, color: BIZ.ink, whiteSpace: 'pre-wrap' }}>{v}</div>
  </div>
)

// ── Allergies, conditions, medicines ────────────────────────────────────────

function ClinicalPane({ memberId, businessId, allergies, conditions, meds, onChange }: {
  memberId: string
  businessId: string
  allergies: Allergy[]
  conditions: Condition[]
  meds: Medication[]
  onChange: () => void
}) {
  const [allergy, setAllergy] = useState({ substance: '', reaction: '', severity: '' })
  const [cond, setCond] = useState('')
  const [med, setMed] = useState({ drug_name: '', strength: '', dosage: '', duration: '' })
  const [err, setErr] = useState('')

  const guard = async (fn: () => Promise<void>) => {
    try { await fn(); setErr(''); onChange() } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <div style={{ ...card, color: '#8a2b2b', fontSize: 13 }}>{err}</div>}

      <div style={card}>
        <div style={{ ...label, marginBottom: 9 }}>Allergies</div>
        {allergies.filter(a => a.is_active).map(a => (
          <div key={a.id} style={{ fontSize: 13.5, color: BIZ.ink, marginBottom: 4 }}>
            <strong>{a.substance}</strong>
            {a.reaction && ` — ${a.reaction}`}
            {a.severity && <span style={{ color: '#b3261e', fontWeight: 700 }}> ({a.severity})</span>}
          </div>
        ))}
        {allergies.filter(a => a.is_active).length === 0 && (
          <div style={{ fontSize: 13, color: BIZ.muted }}>
            None recorded. That is not the same as none — ask.
          </div>
        )}
        <div style={{ display: 'flex', gap: 7, marginTop: 11, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: '1 1 140px' }} placeholder="Substance"
            value={allergy.substance} onChange={e => setAllergy({ ...allergy, substance: e.target.value })} />
          <input style={{ ...input, flex: '1 1 140px' }} placeholder="Reaction"
            value={allergy.reaction} onChange={e => setAllergy({ ...allergy, reaction: e.target.value })} />
          <select style={{ ...input, flex: '0 1 130px' }} value={allergy.severity}
            onChange={e => setAllergy({ ...allergy, severity: e.target.value })}>
            <option value="">Severity…</option>
            <option value="mild">mild</option>
            <option value="moderate">moderate</option>
            <option value="severe">severe</option>
          </select>
          <button style={btn(true)} disabled={!allergy.substance.trim()}
            onClick={() => guard(async () => {
              await addAllergy(memberId, businessId, allergy)
              setAllergy({ substance: '', reaction: '', severity: '' })
            })}>Add</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 9 }}>Ongoing conditions</div>
        {conditions.filter(c => c.status === 'active').map(c => (
          <div key={c.id} style={{ fontSize: 13.5, color: BIZ.ink, marginBottom: 4 }}>{c.condition}</div>
        ))}
        {conditions.filter(c => c.status === 'active').length === 0 && (
          <div style={{ fontSize: 13, color: BIZ.muted }}>None recorded.</div>
        )}
        <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
          <input style={{ ...input, flex: 1 }} placeholder="e.g. Type 2 Diabetes"
            value={cond} onChange={e => setCond(e.target.value)} />
          <button style={btn(true)} disabled={!cond.trim()}
            onClick={() => guard(async () => {
              await addCondition(memberId, businessId, { condition: cond })
              setCond('')
            })}>Add</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 9 }}>Current medicines</div>
        {meds.filter(m => m.is_current).map(m => (
          <div key={m.id} style={{
            display: 'flex', justifyContent: 'space-between', gap: 10,
            fontSize: 13.5, color: BIZ.ink, marginBottom: 5, alignItems: 'center',
          }}>
            <span>
              <strong>{m.drug_name}</strong>
              {m.strength && ` ${m.strength}`}
              {m.dosage && ` · ${m.dosage}`}
              {m.duration && ` · ${m.duration}`}
            </span>
            <button style={{ ...btn(), fontSize: 11.5, padding: '4px 9px' }}
              onClick={() => guard(() => stopMedication(m.id))}>Stop</button>
          </div>
        ))}
        {meds.filter(m => m.is_current).length === 0 && (
          <div style={{ fontSize: 13, color: BIZ.muted }}>Nothing recorded as current.</div>
        )}
        <div style={{ display: 'flex', gap: 7, marginTop: 11, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: '1 1 150px' }} placeholder="Medicine"
            value={med.drug_name} onChange={e => setMed({ ...med, drug_name: e.target.value })} />
          <input style={{ ...input, flex: '0 1 100px' }} placeholder="500 mg"
            value={med.strength} onChange={e => setMed({ ...med, strength: e.target.value })} />
          <input style={{ ...input, flex: '0 1 100px' }} placeholder="1-0-1"
            value={med.dosage} onChange={e => setMed({ ...med, dosage: e.target.value })} />
          <input style={{ ...input, flex: '0 1 100px' }} placeholder="5 days"
            value={med.duration} onChange={e => setMed({ ...med, duration: e.target.value })} />
          <button style={btn(true)} disabled={!med.drug_name.trim()}
            onClick={() => guard(async () => {
              await addMedication(memberId, businessId, med)
              setMed({ drug_name: '', strength: '', dosage: '', duration: '' })
            })}>Add</button>
        </div>
      </div>
    </div>
  )
}

// ── Vitals ──────────────────────────────────────────────────────────────────

function VitalsPane({ memberId, businessId, vitals, onChange }: {
  memberId: string
  businessId: string
  vitals: Vital[]
  onChange: () => void
}) {
  const [v, setV] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  const num = (k: string) => (v[k] ?? '').trim() === '' ? null : Number(v[k])

  const save = async () => {
    try {
      await addVital(memberId, businessId, {
        bp_systolic: num('bp_systolic'), bp_diastolic: num('bp_diastolic'),
        pulse: num('pulse'), temperature_c: num('temperature_c'),
        weight_kg: num('weight_kg'), spo2: num('spo2'),
        blood_sugar_mg_dl: num('blood_sugar_mg_dl'),
      } as Partial<Vital>)
      setV({}); setErr(''); onChange()
    } catch (e) { setErr((e as Error).message) }
  }

  const fields: [string, string, string][] = [
    ['bp_systolic', 'BP systolic', '120'],
    ['bp_diastolic', 'BP diastolic', '80'],
    ['pulse', 'Pulse', '72'],
    ['spo2', 'SpO₂ %', '98'],
    ['temperature_c', 'Temp °C', '37'],
    ['weight_kg', 'Weight kg', '68'],
    ['blood_sugar_mg_dl', 'Sugar mg/dL', '110'],
  ]

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={card}>
        <div style={{ ...label, marginBottom: 9 }}>Record today's readings</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {fields.map(([k, lbl, ph]) => (
            <div key={k} style={{ flex: '0 1 108px' }}>
              <div style={{ ...label, fontSize: 10 }}>{lbl}</div>
              <input style={input} inputMode="decimal" placeholder={ph}
                value={v[k] ?? ''} onChange={e => setV({ ...v, [k]: e.target.value })} />
            </div>
          ))}
        </div>
        {err && <div style={{ fontSize: 12.5, color: '#8a2b2b', marginTop: 8 }}>{err}</div>}
        <button style={{ ...btn(true), marginTop: 11 }}
          disabled={Object.values(v).every(x => !x?.trim())} onClick={save}>Save readings</button>
      </div>

      {vitals.length === 0 ? (
        <div style={{ ...card, color: BIZ.muted, fontSize: 13.5 }}>
          <Activity className="w-4 h-4" style={{ display: 'inline', marginRight: 6 }} />
          Nothing recorded yet. Readings build a trend, which is the part worth reading.
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: BIZ.cream }}>
                {['Date', 'BP', 'Pulse', 'SpO₂', 'Temp', 'Weight', 'Sugar'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 12px', ...label }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vitals.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${BIZ.border}` }}>
                  <td style={{ padding: '9px 12px' }}>{when(r.recorded_at)}</td>
                  <td style={{ padding: '9px 12px' }}>
                    {r.bp_systolic && r.bp_diastolic ? `${r.bp_systolic}/${r.bp_diastolic}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px' }}>{r.pulse ?? '—'}</td>
                  <td style={{ padding: '9px 12px' }}>{r.spo2 ?? '—'}</td>
                  <td style={{ padding: '9px 12px' }}>{r.temperature_c ?? '—'}</td>
                  <td style={{ padding: '9px 12px' }}>{r.weight_kg ?? '—'}</td>
                  <td style={{ padding: '9px 12px' }}>{r.blood_sugar_mg_dl ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
