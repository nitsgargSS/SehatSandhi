import { useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  getPatientSummary, getVisits, getVitals, staffNames, logAccess, type PatientSummary, type Visit, type Vital,
} from '@web/lib/patientsApi'
import { getPrescriptions, getDocuments, documentUrl, type Prescription, type PatientDocument } from '@web/lib/prescriptionsApi'
import { takePhoto, pickPhoto, pickFile, type Picked } from '../../../lib/patient'
import { uploadPatientFile, DOC_KINDS } from '../../../lib/staffUpload'
import { Btn, Card, Chip, Err, Field, Label, Note, toDmy } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// A patient's history: visits (doctor, diagnosis), recent vitals, prescriptions.
// Read-only here; the record is edited from a consultation or on the computer.
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
  const [docs, setDocs] = useState<PatientDocument[]>([])
  const [picked, setPicked] = useState<Picked | null>(null)
  const [kind, setKind] = useState('lab_report')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
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
    getPatientSummary(member, biz).then(setP).catch(e => setErr((e as Error).message))
    staffNames(biz).then(setNames).catch(() => {})
    if (s?.clinical) {
      getVisits(member, biz).then(setVisits).catch(() => {})
      getVitals(member, biz).then(v => setVitals(v.slice(0, 5))).catch(() => {})
      getPrescriptions(member, biz).then(r => setRx(r.filter(x => x.status === 'issued').slice(0, 10))).catch(() => {})
    }
    loadDocs()
  }, [biz, member, s?.clinical])

  return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Card>
        <Text style={st.name}>{p?.full_name ?? '…'}</Text>
        <Text style={st.meta}>{[p?.phone, p?.age_years != null ? `${p.age_years}y` : null, p?.gender, p?.blood_group, p?.mrn ? `file ${p.mrn}` : null].filter(Boolean).join(' · ')}</Text>
        {!!p?.allergies?.length && <Text style={st.allergy}>⚠ Allergies: {p.allergies.join(', ')}</Text>}
        {!!p?.conditions?.length && <Text style={st.meta}>Conditions: {p.conditions.join(', ')}</Text>}
        {!!p?.next_follow_up && <Text style={st.meta}>Next follow-up: {toDmy(p.next_follow_up)}</Text>}
      </Card>
      <Err msg={err} />
      {!s?.clinical ? <Note>Your role does not open the medical record.</Note> : (
        <>
          <Card>
            <Label>Visits</Label>
            {visits.length === 0 ? <Note>No visits recorded here.</Note> : visits.map(v => (
              <Text key={v.id} style={st.item}>
                <Text style={{ fontWeight: '700' }}>{toDmy(v.visit_date ?? v.created_at.slice(0, 10))}</Text>
                {v.practitioner_id ? ` · ${names[v.practitioner_id] ?? ''}` : ''}{'\n'}
                {v.diagnosis ? `Diagnosis: ${v.diagnosis}` : v.chief_complaint ? `Complaint: ${v.chief_complaint}` : v.notes ?? 'No diagnosis'}
                {v.follow_up_due ? `\nFollow-up ${toDmy(v.follow_up_due)}` : ''}
              </Text>
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
              <Text key={r.id} style={st.item}>
                <Text style={{ fontWeight: '700' }}>{toDmy(r.issued_at.slice(0, 10))} · {r.prescriber_name}</Text>{'\n'}
                {r.items.map(i => [i.drug_name, i.dosage, i.duration].filter(Boolean).join(' ')).join('\n')}
              </Text>
            ))}
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
})
