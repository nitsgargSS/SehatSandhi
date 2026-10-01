import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  getPatientSummary, getVisits, getVitals, staffNames, logAccess, type PatientSummary, type Visit, type Vital,
} from '@web/lib/patientsApi'
import { getPrescriptions, type Prescription } from '@web/lib/prescriptionsApi'
import { Card, Err, Label, Note, toDmy } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// A patient's history: visits (doctor, diagnosis), recent vitals, prescriptions.
// Read-only here; the record is edited from a consultation or on the computer.
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
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 40 },
  name: { fontSize: 20, fontWeight: '800', color: C.ink },
  meta: { fontSize: 13.5, color: C.muted },
  allergy: { fontSize: 14, color: C.danger, fontWeight: '700' },
  item: { fontSize: 14, color: C.ink, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 6 },
})
