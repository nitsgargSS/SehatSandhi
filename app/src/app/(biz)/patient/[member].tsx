import { useCallback, useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  getPatientSummary, getVisits, getVitals, staffNames, logAccess, updatePatientDetails, type PatientSummary, type Visit, type Vital,
} from '@web/lib/patientsApi'
import { getBoard, tokenVisit, setTokenStatus, type QueueEntry } from '@web/lib/queueApi'
import { getPrescriptions, getDocuments, documentUrl, type Prescription, type PatientDocument } from '@web/lib/prescriptionsApi'
import { takePhoto, pickPhoto, pickFile, type Picked } from '../../../lib/patient'
import { uploadPatientFile, DOC_KINDS } from '../../../lib/staffUpload'
import BillCard from '../../../ui/BillCard'
import SendSheet from '../../../ui/SendSheet'
import { Btn, Card, Chip, Err, Field, Label, Note, toDmy } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// A patient's history: visits (doctor, diagnosis), recent vitals, prescriptions.
// Clinical staff edit from here too: start today's consultation when the
// patient is in the queue, or open any past visit to correct its diagnosis and
// notes (the same Consultation screen, without a token to finish). Anyone at
// the clinic may correct name / age / gender (0193; logged with who did it).

/** 918570889188 → +91 85708 89188; anything else as stored. */
const showPhone = (ph?: string | null) => {
  const d = (ph ?? '').replace(/\D/g, '')
  return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : (ph ?? '')
}
const GENDERS: [string, string][] = [['male', 'Male'], ['female', 'Female'], ['other', 'Other']]
// 0196: any staff member can add a photo or file (report, scan, prescription)
// from the phone's camera, gallery or files, and open the ones already there.
export default function PatientScreen() {
  const { member } = useLocalSearchParams<{ member: string }>()
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const [p, setP] = useState<PatientSummary | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [vitals, setVitals] = useState<Vital[]>([])
  const [rx, setRx] = useState<Prescription[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const [sentNote, setSentNote] = useState('')
  const [docs, setDocs] = useState<PatientDocument[]>([])
  const [picked, setPicked] = useState<Picked | null>(null)
  const [kind, setKind] = useState('lab_report')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<QueueEntry | null>(null)
  const [editing, setEditing] = useState(false)
  const [det, setDet] = useState({ name: '', age: '', gender: '' })
  const [detMsg, setDetMsg] = useState('')
  const loadDocs = () => { if (biz && member) getDocuments(member, biz).then(setDocs).catch(() => {}) }
  const choose = async (f: () => Promise<Picked | null>) => { setErr(''); try { const x = await f(); if (x) setPicked(x) } catch (e) { setErr((e as Error).message) } }
  const save = async () => {
    if (!picked) return
    setBusy(true); setErr('')
    try { await uploadPatientFile(picked, { businessId: biz, memberId: member, kind, title, uploadedBy: s?.practitionerId ?? null }); setPicked(null); setTitle(''); loadDocs() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!biz || !member) return
    logAccess(biz, member, 'view')
    staffNames(biz).then(setNames).catch(() => {})
    loadDocs()
  }, [biz, member])
  const reloadRx = useCallback(() => {
    getPrescriptions(member, biz).then(r => setRx(r.filter(x => x.status === 'issued').slice(0, 10))).catch(() => {})
  }, [biz, member])
  // Reloaded on return from a consultation, so a corrected diagnosis shows at once.
  const load = useCallback(() => {
    if (!biz || !member) return
    getPatientSummary(member, biz).then(setP).catch(e => setErr((e as Error).message))
    getBoard(biz).then(b => setLive(b.find(e => e.patient_member_id === member
      && ['waiting', 'called', 'in_consultation'].includes(e.status)) ?? null)).catch(() => {})
    if (s?.clinical) {
      getVisits(member, biz).then(setVisits).catch(() => {})
      getVitals(member, biz).then(v => setVitals(v.slice(0, 5))).catch(() => {})
      reloadRx()
    }
  }, [biz, member, s?.clinical, reloadRx])
  useFocusEffect(load)

  const consultNow = async () => {
    if (!live) return
    setBusy(true); setErr('')
    try {
      const v = await tokenVisit(live.id)
      if (live.status === 'waiting' || live.status === 'called') await setTokenStatus(live.id, 'in_consultation', v.visit_id)
      router.push({ pathname: '/consult/[token]', params: { token: live.id, visit: v.visit_id, member, doctor: v.practitioner_id ?? '' } })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const openVisit = (v: Visit) => router.push({ pathname: '/consult/[token]', params: { token: 'none', visit: v.id, member, doctor: v.practitioner_id ?? '' } })
  const startEdit = () => {
    setDet({ name: p?.full_name ?? '', age: p?.age_years != null ? String(p.age_years) : '', gender: p?.gender ?? '' })
    setDetMsg(''); setEditing(true)
  }
  const saveDetails = async () => {
    const age = det.age.trim() ? Number(det.age) : null
    if (!det.name.trim()) { setDetMsg('A patient needs a name.'); return }
    if (age != null && (!Number.isInteger(age) || age < 0 || age > 120)) { setDetMsg('Age in whole years, 0–120.'); return }
    setBusy(true); setDetMsg('')
    try {
      await updatePatientDetails(biz, member, { fullName: det.name.trim(), ageYears: age, gender: det.gender || undefined })
      setEditing(false); load()
    } catch (e) { setDetMsg((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Card>
        <Text style={st.name}>{p?.full_name ?? '…'}</Text>
        <Text style={st.meta}>{[showPhone(p?.phone), p?.age_years != null ? `${p.age_years}y` : null, p?.gender, p?.blood_group, p?.mrn ? `file ${p.mrn}` : null].filter(Boolean).join(' · ')}</Text>
        {!!p?.allergies?.length && <Text style={st.allergy}>⚠ Allergies: {p.allergies.join(', ')}</Text>}
        {!!p?.conditions?.length && <Text style={st.meta}>Conditions: {p.conditions.join(', ')}</Text>}
        {!!p?.next_follow_up && <Text style={st.meta}>Next follow-up: {toDmy(p.next_follow_up)}</Text>}
        {!editing ? (
          <View style={st.rowWrap}><Btn small kind="ghost" label="Edit details" onPress={startEdit} /></View>
        ) : (
          <View style={{ gap: 8 }}>
            <Field label="Name" value={det.name} onChangeText={t => setDet(d => ({ ...d, name: t }))} />
            <Field label="Age (years)" value={det.age} onChangeText={t => setDet(d => ({ ...d, age: t.replace(/\D/g, '').slice(0, 3) }))} keyboardType="number-pad" />
            <View style={st.rowWrap}>{GENDERS.map(([k, l]) => <Chip key={k} label={l} on={det.gender === k} onPress={() => setDet(d => ({ ...d, gender: k }))} />)}</View>
            <Note>The mobile number cannot be changed here — add another number on the computer.</Note>
            <View style={st.rowWrap}>
              <Btn small label="Save details" busy={busy} onPress={saveDetails} />
              <Btn small kind="ghost" label="Cancel" onPress={() => setEditing(false)} />
            </View>
            {!!detMsg && <Text style={{ color: C.danger }}>{detMsg}</Text>}
          </View>
        )}
      </Card>
      {s?.clinical && live && (
        <Btn label={live.status === 'in_consultation' ? `Continue consultation (#${live.token_number})` : `Start consultation (#${live.token_number})`}
          busy={busy} onPress={consultNow} />
      )}
      <Err msg={err} />
      {!!biz && !!member && <BillCard biz={biz} member={member} recordedBy={s?.practitionerId ?? null} />}
      {!s?.clinical ? <Note>Your role does not open the medical record.</Note> : (
        <>
          <Card>
            <Label>Visits</Label>
            {visits.length === 0 ? <Note>{live ? 'No visits yet — start the consultation above.' : 'No visits recorded here.'}</Note> : visits.map(v => (
              <View key={v.id} style={st.visit}>
                <Text style={st.body}>
                  <Text style={{ fontWeight: '700' }}>{toDmy(v.visit_date ?? v.created_at.slice(0, 10))}</Text>
                  {v.practitioner_id ? ` · ${names[v.practitioner_id] ?? ''}` : ''}{'\n'}
                  {v.diagnosis ? `Diagnosis: ${v.diagnosis}` : v.chief_complaint ? `Complaint: ${v.chief_complaint}` : v.notes ?? 'No diagnosis'}
                  {v.follow_up_due ? `\nFollow-up ${toDmy(v.follow_up_due)}` : ''}
                </Text>
                <Btn small kind="ghost" label="Edit" onPress={() => openVisit(v)} />
              </View>
            ))}
          </Card>
          <Card>
            <Label>Recent vitals</Label>
            {vitals.length === 0 ? <Note>None recorded.</Note> : vitals.map(v => (
              <Text key={v.id} style={st.item}>{toDmy(v.recorded_at.slice(0, 10))}: {[
                v.bp_systolic && v.bp_diastolic ? `BP ${v.bp_systolic}/${v.bp_diastolic}` : null, v.pulse ? `Pulse ${v.pulse}` : null,
                v.spo2 ? `SpO₂ ${v.spo2}%` : null, v.weight_kg ? `${v.weight_kg} kg` : null, v.blood_sugar_mg_dl ? `Sugar ${v.blood_sugar_mg_dl}` : null,
              ].filter(Boolean).join(' · ')}</Text>
            ))}
          </Card>
          <Card>
            <Label>Prescriptions</Label>
            {rx.length === 0 ? <Note>None issued.</Note> : rx.map(r => (
              <View key={r.id} style={{ gap: 6 }}>
                <Text style={st.item}>
                  <Text style={{ fontWeight: '700' }}>{toDmy(r.issued_at.slice(0, 10))} · {r.prescriber_name}{r.sent_at ? ' · sent' : ''}</Text>{'\n'}
                  {r.items.map(i => [i.drug_name, i.dosage, i.duration].filter(Boolean).join(' ')).join('\n')}
                </Text>
                <View style={{ flexDirection: 'row' }}>
                  <SendSheet kind="prescription" id={r.id} biz={biz} label={r.sent_at ? 'Send again' : 'Send to the patient'}
                    onSent={note => { setErr(''); setSentNote(note); reloadRx() }} />
                </View>
              </View>
            ))}
            {!!sentNote && <Text style={{ color: C.green, fontWeight: '700' }}>{sentNote}</Text>}
          </Card>
        </>
      )}
      <Card>
        <Label>Photos and files</Label>
        {docs.slice(0, 15).map(d => (
          <Text key={d.id} style={st.link} onPress={() => documentUrl(d.storage_path).then(u => Linking.openURL(u)).catch(e => setErr((e as Error).message))}>
            📎 {d.title}{d.document_date ? ` · ${toDmy(d.document_date)}` : ''}
          </Text>
        ))}
        {!docs.length && <Note>Nothing added yet.</Note>}
        {!picked ? (
          <View style={st.rowWrap}>
            <Btn small label="📷 Camera" onPress={() => choose(takePhoto)} />
            <Btn small kind="ghost" label="🖼️ Gallery" onPress={() => choose(pickPhoto)} />
            <Btn small kind="ghost" label="📄 File / PDF" onPress={() => choose(pickFile)} />
          </View>
        ) : (
          <>
            <Note>Ready: {picked.name}</Note>
            <View style={st.rowWrap}>{DOC_KINDS.map(([k, l]) => <Chip key={k} label={l} on={kind === k} onPress={() => setKind(k)} />)}</View>
            <Field label="Title (optional)" value={title} onChangeText={setTitle} placeholder="e.g. CBC report" />
            <View style={st.rowWrap}>
              <Btn small label="Save to record" busy={busy} onPress={save} />
              <Btn small kind="ghost" label="Cancel" onPress={() => setPicked(null)} />
            </View>
          </>
        )}
      </Card>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  link: { color: C.green, fontWeight: '600', paddingVertical: 3 },
  rowWrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  wrap: { padding: 14, gap: 12, paddingBottom: 40 },
  name: { fontSize: 20, fontWeight: '800', color: C.ink },
  meta: { fontSize: 13.5, color: C.muted },
  allergy: { fontSize: 14, color: C.danger, fontWeight: '700' },
  item: { fontSize: 14, color: C.ink, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 6 },
  body: { fontSize: 14, color: C.ink, flex: 1 },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 6 },
})
