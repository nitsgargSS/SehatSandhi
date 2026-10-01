import { useCallback, useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  getCurrentAdmissions, getDueDoses, recordDose, getAdmissionNotes, addAdmissionNote, dischargePatient,
  type Admission, type DueDose, type AdmissionNote, type AdmissionStatus,
} from '@web/lib/admissionsApi'
import { getPatientSummary, staffNames, type PatientSummary } from '@web/lib/patientsApi'
import { Btn, Card, Chip, Err, Field, Label, Note, toDmy, toIso } from '../../../ui/kit'
import VitalsCard from '../../../ui/VitalsCard'
import { C } from '../../../ui/theme'

// One in-patient's stay — the website's admission view (Patients → Admissions),
// same calls: vitals, today's drug chart, rounds notes, discharge. Ordering
// medicines and the printed discharge summary stay on the computer.
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10)
const todayIst = () => istDay(new Date().toISOString())
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
const stayDay = (iso: string) => Math.max(1, Math.ceil((Date.now() - new Date(iso).getTime()) / 86_400_000))

export default function Stay() {
  const { admission } = useLocalSearchParams<{ admission: string }>()
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const [a, setA] = useState<Admission | null>(null)
  const [p, setP] = useState<PatientSummary | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!biz) return
    getCurrentAdmissions(biz).then(list => {
      const x = list.find(r => r.id === admission) ?? null
      setA(x)
      if (!x) setErr('This patient is no longer admitted.')
      else getPatientSummary(x.patient_member_id, biz).then(setP).catch(() => {})
    }).catch(e => setErr((e as Error).message))
  }, [biz, admission])

  if (!a) return <View style={{ padding: 20 }}>{err ? <Err msg={err} /> : <Note>Loading…</Note>}</View>

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={st.name}>{a.patient_name}</Text>
          <Text style={st.meta}>{[a.age_years != null ? `${a.age_years}y` : null, a.gender, a.patient_phone].filter(Boolean).join(' · ')}</Text>
          <Text style={st.meta}>{a.ward_name} · bed {a.bed_label ?? '—'} · day {stayDay(a.admitted_at)} (since {toDmy(istDay(a.admitted_at))})</Text>
          {!!a.attending_name && <Text style={st.meta}>Doctor: {a.attending_name}</Text>}
          {!!(a.admitting_diagnosis || a.reason) && <Text style={st.body}>{a.admitting_diagnosis || a.reason}</Text>}
          {!!p?.allergies?.length && <Text style={st.allergy}>⚠ Allergies: {p.allergies.join(', ')}</Text>}
        </Card>
        {s?.clinical ? (
          <>
            <VitalsCard biz={biz} member={a.patient_member_id} admissionId={a.id} />
            <DrugChart admission={a.id} by={s.practitionerId} />
            <Notes admission={a.id} biz={biz} by={s.practitionerId} />
            <Discharge admission={a} by={s.doctorId ?? s.practitionerId} />
          </>
        ) : <Note>Your role does not open the medical record.</Note>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── Today's medicines ───────────────────────────────────────────────────────
const NOT_GIVEN: ['refused' | 'withheld' | 'omitted', string][] = [['refused', 'Refused'], ['withheld', 'Held'], ['omitted', 'Omitted']]
const STATUS_WORD: Record<string, string> = { given: 'Given', refused: 'Refused', withheld: 'Held', omitted: 'Omitted', missed: 'Missed', self_administered: 'Self', due: 'Due' }

function DrugChart({ admission, by }: { admission: string; by: string | null }) {
  const [doses, setDoses] = useState<DueDose[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    getDueDoses(admission).then(d => setDoses(d.filter(x => istDay(x.due_at) === todayIst()))).catch(e => setErr((e as Error).message))
  }, [admission])
  useEffect(load, [load])
  const key = (d: DueDose) => `${d.order_id}|${d.due_at}`
  const mark = async (d: DueDose, status: 'given' | 'refused' | 'withheld' | 'omitted') => {
    if (status !== 'given' && !why.trim()) { setErr('Give a reason when a dose is not given.'); return }
    setBusy(key(d)); setErr('')
    try {
      await recordDose({ orderId: d.order_id, status, dueAt: d.due_at, givenBy: by, reason: status === 'given' ? undefined : why.trim() })
      setOpen(null); setWhy(''); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  return (
    <Card>
      <Label>Medicines today</Label>
      {doses.length === 0 ? <Note>No doses due today. Medicines are ordered on the computer.</Note> : doses.map(d => {
        const k = key(d)
        const pending = d.slot_status === 'due' || d.slot_status === 'missed'
        return (
          <View key={k} style={st.dose}>
            <Text style={st.body}>
              <Text style={{ fontWeight: '800' }}>{time(d.due_at)}</Text>  {d.drug_name}{d.strength ? ` ${d.strength}` : ''} — {d.dose_text} {d.route}
            </Text>
            {!!d.instructions && <Text style={st.meta}>{d.instructions}</Text>}
            {pending ? (
              open === k ? (
                <View style={{ gap: 6 }}>
                  <Field placeholder="Why not given?" value={why} onChangeText={setWhy} />
                  <View style={st.row}>
                    {NOT_GIVEN.map(([v, l]) => <Btn key={v} small kind="ghost" label={l} busy={busy === k} onPress={() => mark(d, v)} />)}
                    <Btn small kind="ghost" label="Back" onPress={() => { setOpen(null); setWhy('') }} />
                  </View>
                </View>
              ) : (
                <View style={st.row}>
                  <Btn small label="Given" busy={busy === k} onPress={() => mark(d, 'given')} />
                  <Btn small kind="ghost" label="Not given" onPress={() => { setOpen(k); setWhy('') }} />
                  {d.slot_status === 'missed' && <Text style={{ color: C.danger, fontWeight: '700' }}>Overdue</Text>}
                </View>
              )
            ) : (
              <Text style={{ color: d.slot_status === 'given' ? C.green : C.danger, fontWeight: '700' }}>
                {STATUS_WORD[d.slot_status] ?? d.slot_status}{d.given_at ? ` at ${time(d.given_at)}` : ''}{d.reason ? ` — ${d.reason}` : ''}
              </Text>
            )}
          </View>
        )
      })}
      <Err msg={err} />
    </Card>
  )
}

// ── Rounds notes ────────────────────────────────────────────────────────────
function Notes({ admission, biz, by }: { admission: string; biz: string; by: string | null }) {
  const [notes, setNotes] = useState<AdmissionNote[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(() => { getAdmissionNotes(admission).then(setNotes).catch(() => {}) }, [admission])
  useEffect(() => { load(); staffNames(biz).then(setNames).catch(() => {}) }, [load, biz])
  const add = async () => {
    if (!body.trim()) return
    setBusy(true); setErr('')
    try { await addAdmissionNote(admission, biz, body.trim(), 'progress', by); setBody(''); load() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card>
      <Label>Rounds notes</Label>
      <Field multiline placeholder="Today's round: condition, plan…" value={body} onChangeText={setBody} />
      <View style={st.row}><Btn small label="Add note" busy={busy} disabled={!body.trim()} onPress={add} /></View>
      <Err msg={err} />
      {notes.slice(0, 15).map(n => (
        <View key={n.id} style={st.note}>
          <Text style={st.meta}>{toDmy(istDay(n.recorded_at))} {time(n.recorded_at)}{n.recorded_by && names[n.recorded_by] ? ` · ${names[n.recorded_by]}` : ''}{n.note_type !== 'progress' ? ` · ${n.note_type.replace('_', ' ')}` : ''}</Text>
          <Text style={st.body}>{n.body}</Text>
        </View>
      ))}
    </Card>
  )
}

// ── Discharge ───────────────────────────────────────────────────────────────
const OUTCOMES: [AdmissionStatus, string][] = [['discharged', 'Discharged'], ['lama', 'Left against advice'], ['transferred_out', 'Referred out'], ['deceased', 'Deceased']]

function Discharge({ admission, by }: { admission: Admission; by: string | null }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ status: 'discharged' as AdmissionStatus, diagnosis: admission.admitting_diagnosis ?? '', summary: '', condition: '', follow: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!open) return <Btn kind="ghost" label="Discharge…" onPress={() => setOpen(true)} />
  const go = () => {
    if (f.follow.trim() && !toIso(f.follow)) { setErr('Follow-up date as dd/mm/yyyy.'); return }
    Alert.alert('Discharge?', `${admission.patient_name} — ${OUTCOMES.find(o => o[0] === f.status)?.[1]}. The bed becomes free.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discharge', style: 'destructive', onPress: async () => {
        setBusy(true); setErr('')
        try {
          await dischargePatient(admission.id, { status: f.status, dischargeDiagnosis: f.diagnosis, dischargeSummary: f.summary, condition: f.condition, followUp: toIso(f.follow), practitionerId: by })
          router.back()
        } catch (e) { setErr((e as Error).message); setBusy(false) }
      } },
    ])
  }
  return (
    <Card>
      <Label>Discharge</Label>
      <View style={st.row}>{OUTCOMES.map(([v, l]) => <Chip key={v} label={l} on={f.status === v} onPress={() => setF({ ...f, status: v })} />)}</View>
      <Field label="Discharge diagnosis" value={f.diagnosis} onChangeText={t => setF({ ...f, diagnosis: t })} />
      <Field label="Summary / treatment given" multiline value={f.summary} onChangeText={t => setF({ ...f, summary: t })} />
      <Field label="Condition at discharge" value={f.condition} onChangeText={t => setF({ ...f, condition: t })} placeholder="Stable" />
      <Field label="Follow-up (dd/mm/yyyy)" value={f.follow} onChangeText={t => setF({ ...f, follow: t })} keyboardType="numbers-and-punctuation" />
      <Err msg={err} />
      <View style={st.row}>
        <Btn small label="Discharge" busy={busy} onPress={go} />
        <Btn small kind="ghost" label="Cancel" onPress={() => setOpen(false)} />
      </View>
      <Note>The printed discharge summary for the patient is issued on the computer.</Note>
    </Card>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 60 },
  name: { fontSize: 20, fontWeight: '800', color: C.ink },
  meta: { fontSize: 13.5, color: C.muted },
  body: { fontSize: 14.5, color: C.ink },
  allergy: { fontSize: 14, color: C.danger, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  dose: { borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 8, gap: 4 },
  note: { borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 6, gap: 2 },
})
