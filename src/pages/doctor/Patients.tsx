import { useEffect, useState, useCallback } from 'react'
import { Search, AlertTriangle, Plus, X, Mic, MicOff, Calendar, Activity, FileText, Upload, Send, Trash2, BedDouble } from 'lucide-react'
import { BIZ } from '../business/shared'
import { Spinner } from '../../components/Loading'
import {
  searchPatients, getPatientSummary, getVisits, getVitals, getAllergies,
  getConditions, getMedications, addVisit, addVital, addAllergy, addCondition,
  addMedication, stopMedication, grantRecordingConsent, withdrawRecordingConsent,
  logAccess, canRecord, startMicrophone, uploadConsultationAudio,
  requestTranscription, requestMedicineSuggestions, discardConsultationAudio,
  startRecording, stopRecording, confirmTranscript, getRecording,
  LiveRecording, Recording,
  PatientSearchResult, PatientSummary, Visit, Vital, Allergy, Condition, Medication,
} from '../../lib/patientsApi'
import {
  getAdmissions, admitPatient, dischargePatient, getOccupancy,
  getAdmissionNotes, addAdmissionNote,
  Admission, AdmissionNote, OccupancyRow,
} from '../../lib/admissionsApi'
import {
  issuePrescription, getPrescriptions, cancelPrescription, sendPrescription,
  uploadDocument, getDocuments, documentUrl, deleteDocument, setLegalHold,
  Prescription, PrescriptionItem, PatientDocument,
} from '../../lib/prescriptionsApi'
import {
  getDischargeSummaries, issueDischargeSummary, sendDischargeSummary,
  DischargeSummary,
} from '../../lib/dischargeApi'
import {
  getCharges, getPayments, getAccount, addCharge, removeCharge,
  addPayment, removePayment, postBedCharges,
  getBills, issueBill, cancelBill, sendBill,
  Charge, Payment as PatientPayment, Account, ChargeCategory, PaymentMethod, Bill,
} from '../../lib/billingApi'
import { getMyRole, isClinicalRole } from '../../lib/identityApi'
import { moneyExact } from '../../lib/format'

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

// Panes that show the medical record rather than the logistics around it.
// Mirrors the table list gated in 0057; if one moves, both move.
const CLINICAL_PANES = new Set(['history', 'clinical', 'rx', 'docs'])

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
  const [scripts, setScripts] = useState<Prescription[]>([])
  const [docs, setDocs] = useState<PatientDocument[]>([])
  const [stays, setStays] = useState<Admission[]>([])
  const [charges, setCharges] = useState<Charge[]>([])
  const [payments, setPayments] = useState<PatientPayment[]>([])
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Starts false. RLS denies rather than errors, so without this a receptionist
  // would get the clinical panes rendering empty — which reads as "this patient
  // has no allergies" rather than "you cannot see them", and that is the more
  // dangerous of the two. Assume not-clinical until told otherwise.
  const [clinical, setClinical] = useState(false)
  const [pane, setPane] = useState<'history' | 'clinical' | 'vitals' | 'rx' | 'docs' | 'ipd' | 'money'>('history')

  useEffect(() => {
    let cancelled = false
    getMyRole(businessId)
      .then(r => { if (!cancelled) setClinical(isClinicalRole(r)) })
      .catch(() => { /* stays false — the database refuses either way */ })
    return () => { cancelled = true }
  }, [businessId])

  // Note isClinicalRole returns TRUE against a database with no role system at
  // all (pre-0057), which is deliberate — see RoleLookup.enforced. It is the
  // behaviour that was in force before roles existed, not a bypass.

  // 'history' is the default and is clinical, so reception would land on an
  // empty Visits pane whose tab is not even drawn. Fall through to Admissions
  // rather than tracking the default in two places.
  const shown = !clinical && CLINICAL_PANES.has(pane) ? 'ipd' : pane

  const reload = useCallback(async () => {
    try {
      const [s, v, vt, a, c, m, rx, dc, ad, ch, pm, acc] = await Promise.all([
        getPatientSummary(memberId, businessId),
        getVisits(memberId, businessId),
        getVitals(memberId, businessId),
        getAllergies(memberId, businessId),
        getConditions(memberId, businessId),
        getMedications(memberId, businessId),
        getPrescriptions(memberId, businessId),
        getDocuments(memberId, businessId),
        getAdmissions(memberId, businessId),
        getCharges(memberId, businessId),
        getPayments(memberId, businessId),
        getAccount(memberId, businessId),
      ])
      setSummary(s); setVisits(v); setVitals(vt)
      setAllergies(a); setConditions(c); setMeds(m)
      setScripts(rx); setDocs(dc); setStays(ad)
      setCharges(ch); setPayments(pm); setAccount(acc)
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

      {/* The consent toggle is clinical too. It is the gate on recording a
          consultation, and it is not reception's to give on a doctor's behalf —
          0057 refuses the write regardless. */}
      {clinical && (
        <RecordingConsent
          summary={summary}
          businessId={businessId}
          onChange={reload}
        />
      )}

      {clinical && summary.recording_consent && (
        <ConsultationRecorder
          memberId={memberId} businessId={businessId}
          practitionerId={practitionerId} visits={visits} onChange={reload}
        />
      )}

      {/* Panes. The clinical ones are not shown to reception — the database
          refuses them either way, but a tab that opens onto nothing looks like
          a patient with no history rather than a permission you do not have. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {([
          ['history', 'Visits', true], ['clinical', 'Allergies & medicines', true],
          ['vitals', 'Vitals', false], ['rx', 'Prescriptions', true],
          ['docs', 'Documents', true], ['ipd', 'Admissions', false],
          ['money', 'Billing', false],
        ] as const)
          .filter(([, , needsClinical]) => clinical || !needsClinical)
          .map(([id, lbl]) => (
            <button key={id} onClick={() => setPane(id)}
              style={{ ...btn(shown === id), fontSize: 12.5 }}>{lbl}</button>
          ))}
      </div>

      {!clinical && (
        <div style={{ fontSize: 12.5, color: BIZ.mutedWarm }}>
          Your account is not registered as a doctor here, so the medical record
          is not shown. Beds, the queue and billing are.
        </div>
      )}

      {shown === 'history' && (
        <VisitHistory
          visits={visits} memberId={memberId} businessId={businessId}
          practitionerId={practitionerId} onAdded={reload}
        />
      )}
      {shown === 'clinical' && (
        <ClinicalPane
          memberId={memberId} businessId={businessId}
          allergies={allergies} conditions={conditions} meds={meds} onChange={reload}
        />
      )}
      {shown === 'vitals' && (
        <VitalsPane memberId={memberId} businessId={businessId} vitals={vitals} onChange={reload} />
      )}
      {shown === 'rx' && (
        <PrescriptionsPane
          scripts={scripts} summary={summary} memberId={memberId} businessId={businessId}
          practitionerId={practitionerId} allergies={live} onChange={reload}
        />
      )}
      {shown === 'ipd' && (
        <AdmissionsPane
          stays={stays} memberId={memberId} businessId={businessId}
          practitionerId={practitionerId} onChange={reload}
        />
      )}
      {shown === 'money' && (
        <BillingPane
          charges={charges} payments={payments} account={account} stays={stays}
          memberId={memberId} businessId={businessId}
          practitionerId={practitionerId} onChange={reload}
        />
      )}
      {shown === 'docs' && (
        <DocumentsPane
          docs={docs} memberId={memberId} businessId={businessId}
          practitionerId={practitionerId} onChange={reload}
        />
      )}
    </div>
  )
}

// ── Prescriptions ───────────────────────────────────────────────────────────

const blankItem = (): PrescriptionItem => ({ drug_name: '', strength: '', dosage: '', duration: '', instructions: '' })

function PrescriptionsPane({ scripts, summary, memberId, businessId, practitionerId, allergies, onChange }: {
  scripts: Prescription[]
  summary: PatientSummary
  memberId: string
  businessId: string
  practitionerId?: string | null
  allergies: Allergy[]
  onChange: () => void
}) {
  const [writing, setWriting] = useState(false)
  const [items, setItems] = useState<PrescriptionItem[]>([blankItem()])
  const [diagnosis, setDiagnosis] = useState('')
  const [advice, setAdvice] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const setItem = (i: number, patch: Partial<PrescriptionItem>) =>
    setItems(list => list.map((it, j) => j === i ? { ...it, ...patch } : it))

  const issue = async () => {
    if (!practitionerId) {
      setErr('Only a registered doctor can issue a prescription, and this login is not one. '
        + 'Ask the doctor to sign in, or add them to the roster under Business.')
      return
    }
    setBusy(true); setErr(''); setNote('')
    try {
      await issuePrescription({
        patientMemberId: memberId, businessId, practitionerId,
        items, diagnosis, advice, followUpDate: followUp || null,
      })
      setItems([blankItem()]); setDiagnosis(''); setAdvice(''); setFollowUp('')
      setWriting(false); onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const send = async (id: string) => {
    setBusy(true); setErr(''); setNote('')
    try {
      const r = await sendPrescription(id)
      setNote(r.whatsapp ? 'Sent on WhatsApp.' : r.email ? 'Sent by email.' : 'Queued.')
      onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!writing && (
        <button onClick={() => setWriting(true)} style={{ ...btn(true), justifySelf: 'start' }}>
          <Plus className="w-4 h-4" style={{ display: 'inline', marginRight: 5 }} /> Write a prescription
        </button>
      )}

      {writing && (
        <div style={card}>
          {/* The allergy warning is repeated here on purpose. It is in the
              header too, but this is the moment it matters — a doctor typing a
              drug name should not have to scroll up to be reminded. */}
          {allergies.length > 0 && (
            <div style={{
              marginBottom: 12, padding: '9px 11px', borderRadius: 9,
              background: '#fdf1f1', border: '1px solid #f0c9c9',
              color: '#8a2b2b', fontSize: 13, fontWeight: 700,
            }}>
              <AlertTriangle className="w-4 h-4" style={{ display: 'inline', marginRight: 6 }} />
              Allergic to {allergies.map(a => a.substance).join(', ')}
            </div>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            <div><div style={label}>Diagnosis</div>
              <input style={input} value={diagnosis} onChange={e => setDiagnosis(e.target.value)} /></div>

            <div>
              <div style={label}>Medicines</div>
              {items.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                  <input style={{ ...input, flex: '2 1 160px' }} placeholder="Medicine"
                    value={it.drug_name} onChange={e => setItem(i, { drug_name: e.target.value })} />
                  <input style={{ ...input, flex: '0 1 92px' }} placeholder="500 mg"
                    value={it.strength ?? ''} onChange={e => setItem(i, { strength: e.target.value })} />
                  <input style={{ ...input, flex: '0 1 88px' }} placeholder="1-0-1"
                    value={it.dosage ?? ''} onChange={e => setItem(i, { dosage: e.target.value })} />
                  <input style={{ ...input, flex: '0 1 88px' }} placeholder="5 days"
                    value={it.duration ?? ''} onChange={e => setItem(i, { duration: e.target.value })} />
                  <input style={{ ...input, flex: '1 1 120px' }} placeholder="after food"
                    value={it.instructions ?? ''} onChange={e => setItem(i, { instructions: e.target.value })} />
                  {items.length > 1 && (
                    <button aria-label="Remove medicine" style={{ ...btn(), padding: 8 }}
                      onClick={() => setItems(l => l.filter((_, j) => j !== i))}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button style={{ ...btn(), marginTop: 8, fontSize: 12.5 }}
                onClick={() => setItems(l => [...l, blankItem()])}>
                <Plus className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 4 }} /> Another medicine
              </button>
            </div>

            <div><div style={label}>Advice</div>
              <textarea style={{ ...input, minHeight: 64, resize: 'vertical' }}
                value={advice} onChange={e => setAdvice(e.target.value)} /></div>

            <div><div style={label}>Come back on</div>
              <input type="date" style={input} value={followUp} onChange={e => setFollowUp(e.target.value)} /></div>

            <div style={{ fontSize: 12, color: BIZ.mutedWarm }}>
              Once issued a prescription cannot be edited — a correction is a new
              one that replaces it. Check the doses before you sign.
            </div>

            {err && <div style={{ fontSize: 12.5, color: '#8a2b2b' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={issue} disabled={busy || !items.some(i => i.drug_name.trim())}
                style={btn(true)}>Issue prescription</button>
              <button onClick={() => setWriting(false)} style={btn()}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {note && <div style={{ ...card, background: '#f3faf6', borderColor: '#bfe3d0', fontSize: 13 }}>{note}</div>}
      {err && !writing && <div style={{ ...card, color: '#8a2b2b', fontSize: 13 }}>{err}</div>}

      {scripts.length === 0 && !writing && (
        <div style={{ ...card, color: BIZ.muted, fontSize: 13.5 }}>
          No prescriptions issued here yet.
        </div>
      )}

      {scripts.map(rx => (
        <div key={rx.id} style={{
          ...card,
          opacity: rx.status === 'issued' ? 1 : .72,
          borderColor: rx.status === 'cancelled' ? '#f0c9c9' : BIZ.border,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: BIZ.ink }}>
              {rx.prescription_no}
              <span style={{ fontWeight: 600, color: BIZ.muted, marginLeft: 8 }}>{when(rx.issued_at)}</span>
              {rx.status !== 'issued' && (
                <span style={{
                  fontSize: 11, fontWeight: 800, marginLeft: 8, padding: '2px 7px', borderRadius: 999,
                  background: rx.status === 'cancelled' ? '#fdf1f1' : '#fff5e5',
                  color: rx.status === 'cancelled' ? '#8a2b2b' : '#8a5a00', textTransform: 'uppercase',
                }}>{rx.status}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {rx.status === 'issued' && (
                <button style={{ ...btn(), fontSize: 12 }} disabled={busy} onClick={() => send(rx.id)}>
                  <Send className="w-3.5 h-3.5" style={{ display: 'inline', marginRight: 4 }} />
                  {rx.sent_at ? 'Send again' : 'Send to patient'}
                </button>
              )}
              {rx.status === 'issued' && (
                <button style={{ ...btn(), fontSize: 12 }} disabled={busy}
                  onClick={async () => {
                    const why = window.prompt('Why is this being cancelled?')
                    if (why === null) return
                    setBusy(true)
                    try { await cancelPrescription(rx.id, why); onChange() }
                    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
                  }}>Cancel</button>
              )}
            </div>
          </div>

          <div style={{ marginTop: 9 }}>
            {rx.items.map((it, i) => (
              <div key={i} style={{ fontSize: 13.5, color: BIZ.ink }}>
                {i + 1}. <strong>{it.drug_name}</strong>
                {it.strength && ` ${it.strength}`}
                {it.dosage && ` · ${it.dosage}`}
                {it.duration && ` · ${it.duration}`}
                {it.instructions && <span style={{ color: BIZ.muted }}> — {it.instructions}</span>}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 8 }}>
            {rx.prescriber_name}
            {rx.prescriber_reg_number && ` · Reg. ${rx.prescriber_reg_number}`}
            {rx.sent_at && ` · sent ${when(rx.sent_at)}`}
            {rx.sent_channels?.length ? ` (${rx.sent_channels.join(', ')})` : ''}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 12, color: BIZ.mutedWarm }}>
        Patient {summary.full_name} is sent a link, not a file — it opens on their
        phone and expires after 90 days.
      </div>
    </div>
  )
}

// ── Uploaded documents ──────────────────────────────────────────────────────

const DOC_KINDS: [string, string][] = [
  ['prescription_scan', 'Prescription (paper)'],
  ['lab_report', 'Lab report'],
  ['discharge_summary', 'Discharge summary'],
  ['imaging', 'X-ray / scan'],
  ['consent_form', 'Consent form'],
  ['insurance', 'Insurance'],
  ['other', 'Other'],
]

function DocumentsPane({ docs, memberId, businessId, practitionerId, onChange }: {
  docs: PatientDocument[]
  memberId: string
  businessId: string
  practitionerId?: string | null
  onChange: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState('lab_report')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const upload = async () => {
    if (!file) return
    setBusy(true); setErr('')
    try {
      await uploadDocument(file, {
        businessId, patientMemberId: memberId, kind,
        title: title.trim() || file.name, uploadedBy: practitionerId ?? null,
      })
      setFile(null); setTitle(''); onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const open = async (d: PatientDocument) => {
    try {
      // A private bucket has no permanent address, so this mints a short-lived
      // one each time rather than storing a URL that would outlive the session.
      window.open(await documentUrl(d.storage_path), '_blank', 'noopener')
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={card}>
        <div style={{ ...label, marginBottom: 9 }}>Add a document</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)}
            accept="image/*,application/pdf"
            style={{ ...input, flex: '1 1 220px', padding: 7 }} />
          <select style={{ ...input, flex: '0 1 170px' }} value={kind} onChange={e => setKind(e.target.value)}>
            {DOC_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input style={{ ...input, flex: '1 1 160px' }} placeholder="Title (optional)"
            value={title} onChange={e => setTitle(e.target.value)} />
          <button style={btn(true)} disabled={!file || busy} onClick={upload}>
            <Upload className="w-4 h-4" style={{ display: 'inline', marginRight: 5 }} /> Upload
          </button>
        </div>
        {err && <div style={{ fontSize: 12.5, color: '#8a2b2b', marginTop: 8 }}>{err}</div>}
      </div>

      {docs.length === 0 ? (
        <div style={{ ...card, color: BIZ.muted, fontSize: 13.5 }}>
          <FileText className="w-4 h-4" style={{ display: 'inline', marginRight: 6 }} />
          Nothing uploaded yet. Photograph a paper prescription or a lab report and it stays on the chart.
        </div>
      ) : docs.map(d => (
        <div key={d.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: BIZ.ink }}>{d.title}</div>
            <div style={{ fontSize: 12.5, color: BIZ.muted }}>
              {DOC_KINDS.find(k => k[0] === d.kind)?.[1] ?? d.kind}
              {' · '}{when(d.created_at)}
              {d.size_bytes ? ` · ${Math.max(1, Math.round(d.size_bytes / 1024))} KB` : ''}
            </div>
            {/* When this is due to be destroyed, and whether something is
                stopping that. Shown because a clinic asked for a document in
                two years needs to know now whether it will still be here. */}
            {d.legal_hold ? (
              <div style={{ fontSize: 12, color: '#8a5a00', fontWeight: 700, marginTop: 2 }}>
                On hold — kept indefinitely
                {d.legal_hold_reason && (
                  <span style={{ fontWeight: 400 }}> · {d.legal_hold_reason}</span>
                )}
              </div>
            ) : d.retain_until ? (
              <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 2 }}>
                Kept until {when(d.retain_until)}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
            <button style={{ ...btn(), fontSize: 12 }} onClick={() => open(d)}>Open</button>
            <button style={{ ...btn(), fontSize: 12 }} disabled={busy}
              onClick={async () => {
                setBusy(true); setErr('')
                try {
                  if (d.legal_hold) {
                    if (!window.confirm(`Release the hold on "${d.title}"? It becomes eligible for destruction again.`)) return
                    await setLegalHold(d.id, false)
                  } else {
                    const why = window.prompt('Why is this being held? (complaint, medico-legal case, insurance dispute)')
                    if (!why?.trim()) return
                    await setLegalHold(d.id, true, why.trim())
                  }
                  onChange()
                } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
              }}>
              {d.legal_hold ? 'Release' : 'Hold'}
            </button>
            <button aria-label="Delete document" style={{ ...btn(), padding: 8 }}
              onClick={async () => {
                if (!window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return
                try { await deleteDocument(d); onChange() } catch (e) { setErr((e as Error).message) }
              }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
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
                ? 'This patient has agreed. The recording is transcribed into English and the audio is deleted straight away — you then check and correct the text.'
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

// ── Inpatient stays ─────────────────────────────────────────────────────────
//
// The chart side of IPD. The bed board lives in its own tab because "where is
// everyone" is a different question from "what happened to this person" — but
// a stay is part of one person's story, so it belongs here beside their visits
// and prescriptions rather than somewhere a doctor has to go looking.

function AdmissionsPane({ stays, memberId, businessId, practitionerId, onChange }: {
  stays: Admission[]
  memberId: string
  businessId: string
  practitionerId?: string | null
  onChange: () => void
}) {
  const [admitting, setAdmitting] = useState(false)
  const [free, setFree] = useState<OccupancyRow[]>([])
  const [form, setForm] = useState({ bedId: '', reason: '', diagnosis: '', expected: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openNotes, setOpenNotes] = useState<string | null>(null)

  const current = stays.find(s => s.status === 'admitted')

  useEffect(() => {
    if (!admitting) return
    getOccupancy(businessId)
      .then(rows => setFree(rows.filter(r => !r.occupied)))
      .catch(e => setErr((e as Error).message))
  }, [admitting, businessId])

  const admit = async () => {
    setBusy(true); setErr('')
    try {
      await admitPatient({
        patientMemberId: memberId, businessId,
        bedId: form.bedId || null,
        attendingPractitionerId: practitionerId ?? null,
        reason: form.reason, admittingDiagnosis: form.diagnosis,
        expectedDischarge: form.expected || null,
      })
      setForm({ bedId: '', reason: '', diagnosis: '', expected: '' })
      setAdmitting(false); onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!current && !admitting && (
        <button onClick={() => setAdmitting(true)} style={{ ...btn(true), justifySelf: 'start' }}>
          <BedDouble className="w-4 h-4" style={{ display: 'inline', marginRight: 5 }} /> Admit
        </button>
      )}

      {admitting && (
        <div style={card}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div><div style={label}>Bed</div>
              <select style={input} value={form.bedId} onChange={e => setForm({ ...form, bedId: e.target.value })}>
                <option value="">No bed yet — admit and assign later</option>
                {free.map(f => (
                  <option key={f.bed_id} value={f.bed_id}>{f.ward_name} / bed {f.bed_label}</option>
                ))}
              </select>
              {free.length === 0 && (
                <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 4 }}>
                  No free beds. You can still admit — set the bed from the Beds tab when one opens.
                </div>
              )}
            </div>
            <div><div style={label}>Reason for admission</div>
              <input style={input} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
            <div><div style={label}>Admitting diagnosis</div>
              <input style={input} value={form.diagnosis} onChange={e => setForm({ ...form, diagnosis: e.target.value })} /></div>
            <div><div style={label}>Expected discharge</div>
              <input type="date" style={input} value={form.expected}
                onChange={e => setForm({ ...form, expected: e.target.value })} /></div>
            {err && <div style={{ fontSize: 12.5, color: '#8a2b2b' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={admit} disabled={busy} style={btn(true)}>Admit</button>
              <button onClick={() => setAdmitting(false)} style={btn()}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {err && !admitting && <div style={{ ...card, color: '#8a2b2b', fontSize: 13 }}>{err}</div>}

      {stays.length === 0 && !admitting && (
        <div style={{ ...card, color: BIZ.muted, fontSize: 13.5 }}>
          Never admitted here.
        </div>
      )}

      {stays.map(a => (
        <div key={a.id} style={{
          ...card,
          borderColor: a.status === 'admitted' ? '#bfe3d0' : BIZ.border,
          background: a.status === 'admitted' ? '#f6fbf8' : '#fff',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: BIZ.ink }}>
                {a.admission_no}
                <span style={{
                  fontSize: 11, fontWeight: 800, marginLeft: 8, padding: '2px 7px', borderRadius: 999,
                  background: a.status === 'admitted' ? BIZ.chipBg : BIZ.creamAlt,
                  color: a.status === 'admitted' ? BIZ.chipText : BIZ.muted,
                  textTransform: 'uppercase',
                }}>{a.status.replace('_', ' ')}</span>
              </div>
              <div style={{ fontSize: 12.5, color: BIZ.muted, marginTop: 3 }}>
                {when(a.admitted_at)}
                {a.discharged_at ? ` → ${when(a.discharged_at)}` : ''}
                {` · ${a.days_stayed} day${a.days_stayed === 1 ? '' : 's'}`}
                {a.ward_name && ` · ${a.ward_name} / ${a.bed_label}`}
                {a.attending_name && ` · ${a.attending_name}`}
              </div>
            </div>
            {a.status === 'admitted' && (
              <button style={{ ...btn(), fontSize: 12 }} disabled={busy}
                onClick={async () => {
                  const summary = window.prompt('Discharge summary (optional):')
                  if (summary === null) return
                  setBusy(true)
                  try {
                    await dischargePatient(a.id, {
                      dischargeSummary: summary || undefined,
                      practitionerId: practitionerId ?? null,
                    })
                    onChange()
                  } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
                }}>Discharge</button>
            )}
          </div>

          {a.admitting_diagnosis && <Row k="Admitted for" v={a.admitting_diagnosis} />}
          {a.reason && !a.admitting_diagnosis && <Row k="Reason" v={a.reason} />}
          {a.discharge_diagnosis && <Row k="Discharge diagnosis" v={a.discharge_diagnosis} />}
          {a.discharge_summary && <Row k="Discharge summary" v={a.discharge_summary} />}

          <button style={{ ...btn(), fontSize: 12, marginTop: 10 }}
            onClick={() => setOpenNotes(openNotes === a.id ? null : a.id)}>
            {openNotes === a.id ? 'Hide ward notes' : 'Ward notes'}
          </button>

          {openNotes === a.id && (
            <WardNotes admissionId={a.id} businessId={businessId} practitionerId={practitionerId} />
          )}

          {/* The document they leave with. Only once the stay has ended —
              a summary of an unfinished admission is not one, and the
              database refuses it too. */}
          {a.status !== 'admitted' && (
            <DischargeSummarySection
              admission={a} memberId={memberId} businessId={businessId}
              practitionerId={practitionerId}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ── The discharge summary ───────────────────────────────────────────────────
//
// A stay usually has exactly one. It can have more, because the only way to fix
// a mistake in an issued summary is to issue a corrected one that supersedes
// it — so the list is newest first and the superseded ones stay visible.
//
// Almost every field is filled by the database from the admission: dates, ward,
// diagnoses, the consultant's registration number. What is asked for here is
// only what the doctor knows and nothing else does.

function DischargeSummarySection({ admission, memberId, businessId, practitionerId }: {
  admission: Admission
  memberId: string
  businessId: string
  practitionerId?: string | null
}) {
  const [list, setList] = useState<DischargeSummary[]>([])
  const [open, setOpen] = useState(false)
  const [scripts, setScripts] = useState<Prescription[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sentNote, setSentNote] = useState('')
  const [form, setForm] = useState({
    course: '', investigations: '', procedures: '', advice: '',
    diet: '', activity: '', warnings: '', followUpWith: '', prescriptionId: '',
  })

  const load = useCallback(() => {
    getDischargeSummaries(admission.id).then(setList).catch(e => setErr((e as Error).message))
  }, [admission.id])
  useEffect(load, [load])

  // Only fetched when the form opens: the point is to LINK the discharge
  // prescription rather than retype the drugs into a second table.
  useEffect(() => {
    if (!open) return
    getPrescriptions(memberId, businessId)
      .then(rows => setScripts(rows.filter(r => r.status !== 'cancelled')))
      .catch(() => { /* linking is optional — a failure here must not block issuing */ })
  }, [open, memberId, businessId])

  const current = list.find(s => s.status === 'issued')

  const issue = async () => {
    if (!practitionerId) { setErr('Select which doctor is signing this first.'); return }
    setBusy(true); setErr('')
    try {
      await issueDischargeSummary({
        admissionId: admission.id,
        practitionerId,
        courseInHospital: form.course,
        investigations: form.investigations,
        procedures: form.procedures,
        advice: form.advice,
        dietAdvice: form.diet,
        activityAdvice: form.activity,
        warningSigns: form.warnings,
        followUpWith: form.followUpWith,
        prescriptionId: form.prescriptionId || null,
        // Issuing while one is already live means this is a correction.
        supersedes: current?.id ?? null,
      })
      setForm({
        course: '', investigations: '', procedures: '', advice: '',
        diet: '', activity: '', warnings: '', followUpWith: '', prescriptionId: '',
      })
      setOpen(false); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const send = async (s: DischargeSummary) => {
    setBusy(true); setErr(''); setSentNote('')
    try {
      const r = await sendDischargeSummary(s.id)
      setSentNote(r.whatsapp ? 'Sent on WhatsApp.' : r.email ? 'Emailed.' : 'Sent.')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginTop: 11, borderTop: `1px solid ${BIZ.border}`, paddingTop: 11 }}>
      <div style={{ ...label, marginBottom: 7 }}>Discharge summary</div>

      {list.length === 0 && !open && (
        <div style={{ fontSize: 12.5, color: BIZ.muted, marginBottom: 8 }}>
          Not issued yet. The patient has nothing to show the next doctor.
        </div>
      )}

      {list.map(s => (
        <div key={s.id} style={{
          display: 'flex', justifyContent: 'space-between', gap: 10,
          flexWrap: 'wrap', alignItems: 'center',
          padding: '7px 0', borderBottom: `1px solid ${BIZ.border}`,
          opacity: s.status === 'issued' ? 1 : .6,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.ink }}>
              {s.summary_no}
              {s.status !== 'issued' && (
                <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 7, color: BIZ.mutedWarm }}>
                  {s.status}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: BIZ.mutedWarm }}>
              {when(s.issued_at)} · {s.doctor_name}
              {s.prescription_no && ` · medicines on ${s.prescription_no}`}
              {s.sent_at && ' · sent'}
            </div>
          </div>
          {s.status === 'issued' && (
            <div style={{ display: 'flex', gap: 7 }}>
              <a href={`/ds/${s.public_token}`} target="_blank" rel="noreferrer"
                style={{ ...btn(), fontSize: 12, textDecoration: 'none' }}>
                Open
              </a>
              <button style={{ ...btn(), fontSize: 12 }} disabled={busy} onClick={() => send(s)}>
                <Send className="w-3 h-3" style={{ display: 'inline', marginRight: 4 }} />
                {s.sent_at ? 'Resend' : 'Send to patient'}
              </button>
            </div>
          )}
        </div>
      ))}

      {sentNote && <div style={{ fontSize: 12.5, color: '#1c6b4a', marginTop: 7 }}>{sentNote}</div>}
      {err && <div style={{ fontSize: 12.5, color: '#8a2b2b', marginTop: 7 }}>{err}</div>}

      {!open && (
        <button style={{ ...btn(!current), fontSize: 12, marginTop: 9 }} onClick={() => setOpen(true)}>
          <FileText className="w-3 h-3" style={{ display: 'inline', marginRight: 4 }} />
          {current ? 'Issue a correction' : 'Issue discharge summary'}
        </button>
      )}

      {open && (
        <div style={{ display: 'grid', gap: 9, marginTop: 10 }}>
          {current && (
            <div style={{ fontSize: 12.5, color: '#8a5a00' }}>
              This will replace {current.summary_no}. The old one stays on file and
              stops opening for the patient.
            </div>
          )}

          <div style={{ fontSize: 12, color: BIZ.muted }}>
            The dates, ward, diagnoses and your registration number are filled in
            from the admission — you do not need to retype them.
          </div>

          <div><div style={label}>Course in hospital</div>
            <textarea style={{ ...input, minHeight: 66 }} value={form.course}
              placeholder="What happened between admission and discharge — the part the next doctor reads first."
              onChange={e => setForm({ ...form, course: e.target.value })} /></div>

          <div><div style={label}>Investigations</div>
            <textarea style={{ ...input, minHeight: 48 }} value={form.investigations}
              placeholder="Key results. Blood counts, imaging, cultures."
              onChange={e => setForm({ ...form, investigations: e.target.value })} /></div>

          <div><div style={label}>Procedures</div>
            <input style={input} value={form.procedures}
              onChange={e => setForm({ ...form, procedures: e.target.value })} /></div>

          <div><div style={label}>Medicines to continue at home</div>
            <select style={input} value={form.prescriptionId}
              onChange={e => setForm({ ...form, prescriptionId: e.target.value })}>
              <option value="">No discharge medication</option>
              {scripts.map(p => (
                <option key={p.id} value={p.id}>
                  {p.prescription_no} — {when(p.issued_at)}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 4 }}>
              Linked to a prescription rather than retyped, so the two can never
              disagree. Issue it from the Prescriptions tab first if it is not here.
            </div>
          </div>

          <div><div style={label}>Advice</div>
            <textarea style={{ ...input, minHeight: 48 }} value={form.advice}
              onChange={e => setForm({ ...form, advice: e.target.value })} /></div>

          <div><div style={label}>Diet</div>
            <input style={input} value={form.diet}
              onChange={e => setForm({ ...form, diet: e.target.value })} /></div>

          <div><div style={label}>Activity and rest</div>
            <input style={input} value={form.activity}
              onChange={e => setForm({ ...form, activity: e.target.value })} /></div>

          <div><div style={label}>Come back immediately if</div>
            <textarea style={{ ...input, minHeight: 48 }} value={form.warnings}
              placeholder="Fever above 101, bleeding, breathlessness — what would mean coming back before the follow-up date."
              onChange={e => setForm({ ...form, warnings: e.target.value })} />
            <div style={{ fontSize: 12, color: BIZ.mutedWarm, marginTop: 4 }}>
              Printed in red on the patient's copy. This is the part that decides
              whether they come back here or end up in a casualty ward.
            </div>
          </div>

          <div><div style={label}>Follow up with</div>
            <input style={input} value={form.followUpWith}
              placeholder="Dr Sharma, OPD, Tuesday morning"
              onChange={e => setForm({ ...form, followUpWith: e.target.value })} /></div>

          <div style={{ fontSize: 12, color: BIZ.mutedWarm }}>
            Once issued it cannot be edited — a mistake is fixed by issuing a
            correction, because the patient may already be holding a printed copy.
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={issue} disabled={busy} style={btn(true)}>
              {busy ? 'Issuing…' : 'Issue'}
            </button>
            <button onClick={() => { setOpen(false); setErr('') }} style={btn()}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function WardNotes({ admissionId, businessId, practitionerId }: {
  admissionId: string
  businessId: string
  practitionerId?: string | null
}) {
  const [notes, setNotes] = useState<AdmissionNote[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    getAdmissionNotes(admissionId).then(setNotes).catch(e => setErr((e as Error).message))
  }, [admissionId])
  useEffect(load, [load])

  return (
    <div style={{ marginTop: 11, borderTop: `1px solid ${BIZ.border}`, paddingTop: 11 }}>
      <div style={{ display: 'flex', gap: 7 }}>
        <input style={{ ...input, flex: 1 }} placeholder="Add a progress note…"
          value={body} onChange={e => setBody(e.target.value)} />
        <button style={btn(true)} disabled={!body.trim() || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await addAdmissionNote(admissionId, businessId, body.trim(), 'progress', practitionerId ?? null)
              setBody(''); load()
            } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
          }}>Add</button>
      </div>
      {err && <div style={{ fontSize: 12.5, color: '#8a2b2b', marginTop: 7 }}>{err}</div>}

      <div style={{ marginTop: 10, display: 'grid', gap: 7 }}>
        {notes.length === 0 && (
          <div style={{ fontSize: 12.5, color: BIZ.muted }}>No notes yet.</div>
        )}
        {notes.map(n => (
          <div key={n.id} style={{ fontSize: 13, color: BIZ.ink }}>
            <span style={{ color: BIZ.mutedWarm, fontSize: 11.5 }}>
              {new Date(n.recorded_at).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
              {n.note_type !== 'progress' && ` · ${n.note_type.replace('_', ' ')}`}
              {'  '}
            </span>
            {n.body}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Billing ─────────────────────────────────────────────────────────────────
//
// The money side of one patient's care: OPD fees, bed days, medicines, tests,
// and what they have actually paid against it.
//
// Deliberately the clinic's own ledger and nothing to do with the invoices
// Sehatsandhi raises for a listing. Different payer, different payee, and a
// bill that mixed them would be wrong in a way nobody could unpick later.

const CHARGE_CATEGORIES: [ChargeCategory, string][] = [
  ['consultation', 'Consultation'],
  ['bed', 'Bed / room'],
  ['procedure', 'Procedure'],
  ['medicine', 'Medicine'],
  ['lab', 'Test'],
  ['consumable', 'Consumable'],
  ['other', 'Other'],
]

const PAYMENT_METHODS: [PaymentMethod, string][] = [
  ['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'],
  ['netbanking', 'Net banking'], ['cheque', 'Cheque'],
  ['insurance', 'Insurance / TPA'], ['other', 'Other'],
]

function BillingPane({
  charges, payments, account, stays, memberId, businessId, practitionerId, onChange,
}: {
  charges: Charge[]
  payments: PatientPayment[]
  account: Account | null
  stays: Admission[]
  memberId: string
  businessId: string
  practitionerId?: string | null
  onChange: () => void
}) {
  const [c, setC] = useState({ category: 'consultation' as ChargeCategory, description: '', quantity: '1', unitPrice: '' })
  const [p, setP] = useState({ amount: '', method: 'cash' as PaymentMethod, reference: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const balance = account?.balance ?? 0
  const openStay = stays.find(s => s.status === 'admitted')

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn(); onChange() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  // Charges and payments interleaved, newest first — a statement reads as one
  // sequence, not two lists a reader has to merge in their head.
  const ledger = [
    ...charges.map(x => ({ kind: 'charge' as const, on: x.charged_on, row: x })),
    ...payments.map(x => ({ kind: 'payment' as const, on: x.received_on, row: x })),
  ].sort((a, b) => b.on.localeCompare(a.on))

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{
        ...card,
        background: balance > 0 ? '#fdf8f1' : '#f3faf6',
        borderColor: balance > 0 ? '#eddcc0' : '#bfe3d0',
      }}>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <div>
            <div style={label}>Charged</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: BIZ.ink }}>{moneyExact(account?.charged ?? 0)}</div>
          </div>
          <div>
            <div style={label}>Paid</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: BIZ.ink }}>{moneyExact(account?.paid ?? 0)}</div>
          </div>
          <div>
            <div style={label}>{balance < 0 ? 'In advance' : 'Balance due'}</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: balance > 0 ? '#8a5a00' : BIZ.green }}>
              {moneyExact(Math.abs(balance))}
            </div>
          </div>
        </div>
        {balance < 0 && (
          <div style={{ fontSize: 12.5, color: BIZ.muted, marginTop: 8 }}>
            The patient has paid more than has been charged so far — ordinary during a stay.
          </div>
        )}
      </div>

      {err && <div style={{ ...card, color: '#8a2b2b', fontSize: 13 }}>{err}</div>}
      {note && <div style={{ ...card, background: '#f3faf6', borderColor: '#bfe3d0', fontSize: 13 }}>{note}</div>}

      {openStay && (
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, color: BIZ.ink }}>
            Currently admitted — {openStay.ward_name ? `${openStay.ward_name} / ${openStay.bed_label}` : 'no bed'},
            {' '}{openStay.days_stayed} day{openStay.days_stayed === 1 ? '' : 's'}.
          </div>
          <button style={btn()} disabled={busy} onClick={() => guard(async () => {
            const posted = await postBedCharges(openStay.id)
            setNote(posted > 0
              ? `Bed charge posted: ${moneyExact(posted)}.`
              : 'That bed has no daily rate set, so nothing was posted.')
          })}>Post bed charge</button>
        </div>
      )}

      <div style={card}>
        <div style={{ ...label, marginBottom: 9 }}>Add a charge</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <select style={{ ...input, flex: '0 1 150px' }} value={c.category}
            onChange={e => setC({ ...c, category: e.target.value as ChargeCategory })}>
            {CHARGE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input style={{ ...input, flex: '2 1 180px' }} placeholder="What for"
            value={c.description} onChange={e => setC({ ...c, description: e.target.value })} />
          <input style={{ ...input, flex: '0 1 80px' }} inputMode="decimal" placeholder="Qty"
            value={c.quantity} onChange={e => setC({ ...c, quantity: e.target.value })} />
          <input style={{ ...input, flex: '0 1 110px' }} inputMode="decimal" placeholder="Rate ₹"
            value={c.unitPrice} onChange={e => setC({ ...c, unitPrice: e.target.value })} />
          <button style={btn(true)} disabled={busy || !c.description.trim() || !c.unitPrice.trim()}
            onClick={() => guard(async () => {
              await addCharge(memberId, businessId, {
                category: c.category,
                description: c.description.trim(),
                quantity: Number(c.quantity) || 1,
                unitPrice: Number(c.unitPrice) || 0,
                admissionId: openStay?.id ?? null,
              }, practitionerId)
              setC({ category: 'consultation', description: '', quantity: '1', unitPrice: '' })
            })}>Add</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 9 }}>Record a payment</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: '0 1 130px' }} inputMode="decimal" placeholder="Amount ₹"
            value={p.amount} onChange={e => setP({ ...p, amount: e.target.value })} />
          <select style={{ ...input, flex: '0 1 150px' }} value={p.method}
            onChange={e => setP({ ...p, method: e.target.value as PaymentMethod })}>
            {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input style={{ ...input, flex: '1 1 160px' }} placeholder="Reference (UPI ref, cheque no.)"
            value={p.reference} onChange={e => setP({ ...p, reference: e.target.value })} />
          <button style={btn(true)} disabled={busy || !(Number(p.amount) > 0)}
            onClick={() => guard(async () => {
              await addPayment(memberId, businessId, {
                amount: Number(p.amount), method: p.method,
                reference: p.reference, admissionId: openStay?.id ?? null,
              }, practitionerId)
              setP({ amount: '', method: 'cash', reference: '' })
            })}>Record</button>
        </div>
      </div>

      <BillsSection
        charges={charges} stays={stays} memberId={memberId} businessId={businessId}
        practitionerId={practitionerId} onChange={onChange}
      />

      {ledger.length === 0 ? (
        <div style={{ ...card, color: BIZ.muted, fontSize: 13.5 }}>
          Nothing charged or paid here yet.
        </div>
      ) : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {ledger.map((e, i) => (
            <div key={e.row.id} style={{
              display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
              padding: '11px 15px', borderTop: i === 0 ? 'none' : `1px solid ${BIZ.border}`,
              background: e.kind === 'payment' ? '#f8fcfa' : '#fff',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: BIZ.ink }}>
                  {e.kind === 'charge'
                    ? (e.row as Charge).description
                    : `Payment — ${PAYMENT_METHODS.find(m => m[0] === (e.row as PatientPayment).method)?.[1]}`}
                </div>
                <div style={{ fontSize: 11.5, color: BIZ.mutedWarm }}>
                  {when(e.on)}
                  {e.kind === 'charge' && (e.row as Charge).quantity > 1 &&
                    ` · ${(e.row as Charge).quantity} × ${moneyExact((e.row as Charge).unit_price)}`}
                  {e.kind === 'payment' && (e.row as PatientPayment).reference &&
                    ` · ${(e.row as PatientPayment).reference}`}
                  {e.row.bill_id && ' · billed'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flex: '0 0 auto' }}>
                <span style={{
                  fontSize: 14, fontWeight: 700,
                  color: e.kind === 'payment' ? BIZ.green : BIZ.ink,
                }}>
                  {e.kind === 'payment' ? '− ' : ''}{moneyExact(e.row.amount)}
                </span>
                {/* A billed line has no delete. The database refuses it too, but
                    a button that always errors is worse than no button — the
                    way to change it is to cancel the bill. */}
                {!e.row.bill_id && (
                  <button aria-label="Remove line" style={{ ...btn(), padding: 6 }} disabled={busy}
                    onClick={() => guard(async () => {
                      if (!window.confirm('Remove this line?')) return
                      if (e.kind === 'charge') await removeCharge(e.row.id)
                      else await removePayment(e.row.id)
                    })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Bills ───────────────────────────────────────────────────────────────────
//
// The ledger above is what the clinic knows; a bill is what the patient is
// handed. Numbered, itemised, and frozen once issued — because it goes to an
// insurer, who will hold a printed copy of it for months and reimburse against
// whatever it says.
//
// Issuing takes every UNBILLED charge in scope, so the count shown on the
// button is the honest answer to "what will be on this". A stay with nothing
// left unbilled offers a correction instead.

function BillsSection({ charges, stays, memberId, businessId, practitionerId, onChange }: {
  charges: Charge[]
  stays: Admission[]
  memberId: string
  businessId: string
  practitionerId?: string | null
  onChange: () => void
}) {
  const [bills, setBills] = useState<Bill[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [form, setForm] = useState({
    scope: '', discount: '', discountReason: '', roundOff: '',
  })

  const load = useCallback(() => {
    getBills(memberId, businessId).then(setBills).catch(e => setErr((e as Error).message))
  }, [memberId, businessId])
  useEffect(load, [load])

  // What this bill would actually pick up. Recomputed against the chosen scope,
  // because "bill this stay" and "bill everything" are very different numbers.
  const inScope = charges.filter(c =>
    !c.bill_id && (form.scope === '' || c.admission_id === form.scope))
  const subtotal = inScope.reduce((s, c) => s + Number(c.amount), 0)
  const discount = Number(form.discount) || 0
  const roundOff = Number(form.roundOff) || 0
  const net = subtotal - discount + roundOff

  const liveForScope = bills.find(b =>
    b.status === 'issued' && (form.scope === '' ? !b.admission_id : b.admission_id === form.scope))

  const issue = async () => {
    setBusy(true); setErr(''); setNote('')
    try {
      await issueBill({
        patientMemberId: memberId,
        businessId,
        admissionId: form.scope || null,
        discount,
        discountReason: form.discountReason,
        roundOff,
        issuedBy: practitionerId ?? null,
        supersedes: liveForScope?.id ?? null,
      })
      setForm({ scope: '', discount: '', discountReason: '', roundOff: '' })
      setOpen(false); load(); onChange()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setNote('')
    try { await fn(); load(); onChange() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <div style={label}>Bills</div>
        {!open && (
          <button style={{ ...btn(true), fontSize: 12 }} onClick={() => setOpen(true)}>
            <FileText className="w-3 h-3" style={{ display: 'inline', marginRight: 4 }} />
            Issue a bill
          </button>
        )}
      </div>

      {bills.length === 0 && !open && (
        <div style={{ fontSize: 12.5, color: BIZ.muted, marginTop: 7 }}>
          Nothing issued yet. The patient has no itemised bill to pay against or
          claim with.
        </div>
      )}

      {bills.map(b => (
        <div key={b.id} style={{
          display: 'flex', justifyContent: 'space-between', gap: 10,
          flexWrap: 'wrap', alignItems: 'center',
          padding: '8px 0', borderBottom: `1px solid ${BIZ.border}`,
          opacity: b.status === 'issued' ? 1 : .55,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: BIZ.ink }}>
              {b.bill_no}
              <span style={{ fontWeight: 500, color: BIZ.muted }}>
                {' '}· {b.bill_type === 'ipd' ? 'inpatient' : b.bill_type === 'opd' ? 'visit' : 'account'}
              </span>
              {b.status !== 'issued' && (
                <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 7, color: BIZ.mutedWarm }}>
                  {b.status}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: BIZ.mutedWarm }}>
              {when(b.issued_at)} · {moneyExact(b.net_payable)}
              {b.balance_due > 0
                ? ` · ${moneyExact(b.balance_due)} due`
                : ' · paid'}
              {b.sent_at && ' · sent'}
            </div>
          </div>
          {b.status === 'issued' && (
            <div style={{ display: 'flex', gap: 6 }}>
              <a href={`/bill/${b.public_token}`} target="_blank" rel="noreferrer"
                style={{ ...btn(), fontSize: 12, textDecoration: 'none' }}>Open</a>
              <button style={{ ...btn(), fontSize: 12 }} disabled={busy}
                onClick={() => act(async () => {
                  const r = await sendBill(b.id)
                  setNote(r.whatsapp ? 'Sent on WhatsApp.' : r.email ? 'Emailed.' : 'Sent.')
                })}>
                <Send className="w-3 h-3" style={{ display: 'inline', marginRight: 4 }} />
                {b.sent_at ? 'Resend' : 'Send'}
              </button>
              <button style={{ ...btn(), fontSize: 12 }} disabled={busy}
                onClick={() => act(async () => {
                  const reason = window.prompt('Why is this bill being cancelled?')
                  if (!reason?.trim()) return
                  await cancelBill(b.id, reason.trim())
                  setNote(`${b.bill_no} cancelled. Its charges are billable again.`)
                })}>Cancel</button>
            </div>
          )}
        </div>
      ))}

      {note && <div style={{ fontSize: 12.5, color: '#1c6b4a', marginTop: 8 }}>{note}</div>}
      {err && <div style={{ fontSize: 12.5, color: '#8a2b2b', marginTop: 8 }}>{err}</div>}

      {open && (
        <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
          <div>
            <div style={label}>What this bill covers</div>
            <select style={input} value={form.scope}
              onChange={e => setForm({ ...form, scope: e.target.value })}>
              <option value="">Everything not yet billed</option>
              {stays.map(s => (
                <option key={s.id} value={s.id}>
                  {s.admission_no} — {when(s.admitted_at)}
                  {s.status === 'admitted' ? ' (still admitted)' : ''}
                </option>
              ))}
            </select>
          </div>

          {liveForScope && (
            <div style={{ fontSize: 12.5, color: '#8a5a00' }}>
              {liveForScope.bill_no} already covers this. Issuing now replaces it —
              its lines are released back and go onto the new bill.
            </div>
          )}

          <div style={{ fontSize: 13, color: BIZ.ink }}>
            {inScope.length === 0 && !liveForScope
              ? 'Nothing unbilled here. Add a charge first.'
              : `${inScope.length} line${inScope.length === 1 ? '' : 's'} · ${moneyExact(subtotal)}`}
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <input style={{ ...input, flex: '0 1 120px' }} inputMode="decimal" placeholder="Discount ₹"
              value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} />
            <input style={{ ...input, flex: '1 1 180px' }} placeholder="Reason for the discount"
              value={form.discountReason}
              onChange={e => setForm({ ...form, discountReason: e.target.value })} />
            <input style={{ ...input, flex: '0 1 120px' }} inputMode="decimal" placeholder="Round off ₹"
              value={form.roundOff} onChange={e => setForm({ ...form, roundOff: e.target.value })} />
          </div>
          {discount > 0 && !form.discountReason.trim() && (
            <div style={{ fontSize: 12, color: BIZ.mutedWarm }}>
              A discount needs a reason — it goes on the bill, and an unexplained
              one is what an audit stops on.
            </div>
          )}

          <div style={{ fontSize: 16, fontWeight: 800, color: BIZ.ink }}>
            Net payable {moneyExact(net)}
          </div>

          <div style={{ fontSize: 12, color: BIZ.mutedWarm }}>
            Once issued the bill cannot be edited, and every line on it is locked
            against deletion. Fix a mistake by cancelling it or issuing a
            replacement.
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={issue} style={btn(true)}
              disabled={busy || net < 0 || (discount > 0 && !form.discountReason.trim())
                || (inScope.length === 0 && !liveForScope)}>
              {busy ? 'Issuing…' : liveForScope ? 'Replace bill' : 'Issue bill'}
            </button>
            <button onClick={() => { setOpen(false); setErr('') }} style={btn()}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Recording a consultation ────────────────────────────────────────────────
//
// The capture half of the toggle above. Only rendered once the patient has
// agreed — the consent panel is the gate, and the database enforces the same
// thing independently.
//
// The shape of this component IS the safety rule: record, transcribe, then a
// text box the doctor edits, and nothing leaves this pane until they press
// Confirm. The draft is labelled as a machine's hearing every time it is shown,
// because a transcript that looks like a note gets read like one.

function ConsultationRecorder({ memberId, businessId, practitionerId, visits, onChange }: {
  memberId: string
  businessId: string
  practitionerId?: string | null
  visits: Visit[]
  onChange: () => void
}) {
  const [live, setLive] = useState<LiveRecording | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [rec, setRec] = useState<Recording | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  // A visible timer, because a recording light nobody can see is how a
  // consultation gets taped for forty minutes after everyone left.
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [live])

  // Release the microphone if this pane goes away mid-recording.
  useEffect(() => () => { live?.cancel() }, [live])

  if (!canRecord()) {
    return (
      <div style={{ ...card, fontSize: 13, color: BIZ.muted }}>
        This browser cannot record — it needs microphone access over a secure (https) connection.
      </div>
    )
  }

  const begin = async () => {
    setErr(''); setNote(''); setBusy('starting')
    try {
      // A recording belongs to a visit, so there has to be one. Today's if it
      // exists, otherwise a fresh one — the consultation is happening either way.
      const today = new Date().toISOString().slice(0, 10)
      const visitId = visits.find(v => v.visit_date === today)?.id
        ?? await addVisit(memberId, businessId, { practitionerId })

      const id = await startRecording(visitId, memberId, businessId, practitionerId)
      const mic = await startMicrophone()
      setRecordingId(id); setLive(mic); setSeconds(0)
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy('') }
  }

  const finish = async () => {
    if (!live || !recordingId) return
    setBusy('transcribing'); setErr('')
    try {
      const blob = await live.stop()
      setLive(null)
      await stopRecording(recordingId, seconds)
      await uploadConsultationAudio(recordingId, businessId, blob)
      await requestTranscription(recordingId)
      const mine = await getRecording(recordingId)
      setRec(mine)
      setDraft(mine?.transcript_draft ?? '')
      if (!mine?.transcript_draft) {
        setErr('Nothing came back from transcription. Type the note yourself, or discard and try again.')
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy('') }
  }

  const abandon = () => {
    live?.cancel(); setLive(null); setRecordingId(null); setSeconds(0); setDraft(''); setRec(null)
  }

  const confirm = async () => {
    if (!recordingId || !draft.trim()) return
    setBusy('confirming'); setErr('')
    try {
      await confirmTranscript(recordingId, draft.trim(), practitionerId)
      // Belt and braces. Transcription now deletes the audio in the same
      // request that produces the text, so in the normal flow there is nothing
      // left here to remove. Kept for the cases that flow does not cover: a
      // recording made before that change, or one whose delete failed after the
      // transcript was written. It only clears audio_path and stamps
      // audio_deleted_at — it does not touch status, so it cannot undo the
      // confirmation that just happened.
      await discardConsultationAudio(recordingId, businessId)
      const s = await requestMedicineSuggestions(recordingId).catch(() => null)
      setNote(
        !s?.configured
          ? 'Note saved.'
          : s.suggestions?.medicines?.length
            ? `Note saved. ${s.suggestions.medicines.length} medicine${s.suggestions.medicines.length === 1 ? '' : 's'} read out — check them on the Prescriptions tab before issuing.`
            : 'Note saved. No medicines were read out of it.',
      )
      setRecordingId(null); setDraft(''); setRec(null); onChange()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setBusy('') }
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div style={{ ...card, borderColor: live ? '#e8b4b4' : BIZ.border }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {live
            ? <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#d23b3b', flex: '0 0 auto' }} />
            : <Mic className="w-4 h-4" style={{ color: BIZ.mutedWarm }} />}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: BIZ.ink }}>
              {live ? `Recording — ${mmss}` : busy === 'transcribing' ? 'Transcribing…' : 'Record this consultation'}
            </div>
            <div style={{ fontSize: 12.5, color: BIZ.muted, marginTop: 2, maxWidth: 560 }}>
              {live
                ? 'The patient can ask you to stop at any time.'
                : 'The audio is deleted as soon as it is transcribed. You correct the English draft, which is what gets saved.'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          {!live && !recordingId && (
            <button style={btn(true)} disabled={!!busy} onClick={begin}>Start</button>
          )}
          {live && (
            <>
              <button style={btn(true)} onClick={finish}>Stop</button>
              <button style={btn()} onClick={abandon}>Discard</button>
            </>
          )}
        </div>
      </div>

      {err && <div style={{ marginTop: 10, fontSize: 12.5, color: '#8a2b2b' }}>{err}</div>}
      {note && <div style={{ marginTop: 10, fontSize: 12.5, color: BIZ.chipText }}>{note}</div>}

      {recordingId && !live && (
        <div style={{ marginTop: 13 }}>
          <div style={{
            display: 'flex', gap: 7, alignItems: 'center', marginBottom: 7,
            fontSize: 12, fontWeight: 700, color: '#8a5a00',
          }}>
            <AlertTriangle className="w-3.5 h-3.5" />
            This is what the machine heard. Read it before you confirm — doses especially.
          </div>
          <textarea
            style={{ ...input, minHeight: 170, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55 }}
            value={draft} onChange={e => setDraft(e.target.value)}
            placeholder="The draft will appear here. You can also type the note yourself."
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btn(true)} disabled={!draft.trim() || !!busy} onClick={confirm}>
              Confirm note
            </button>
            <button style={btn()} disabled={!!busy} onClick={abandon}>Throw away</button>
            <span style={{ fontSize: 12, color: BIZ.mutedWarm }}>
              Confirming saves your version and deletes the recording.
              {rec?.transcript_engine && ` Heard by ${rec.transcript_engine}.`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
