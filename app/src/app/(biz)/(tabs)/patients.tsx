import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useSession } from '../../../lib/session'
import { searchPatients, type PatientSearchResult } from '@web/lib/patientsApi'
import { Card, Err, Field, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// Find a patient by name or phone — the website's patient search.
export default function Patients() {
  const { s } = useSession()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<PatientSearchResult[]>([])
  const [err, setErr] = useState('')
  const biz = s?.clinic?.id

  useEffect(() => {
    if (!biz || q.trim().length < 2) { setRows([]); return }
    const t = setTimeout(() => {
      searchPatients(q.trim(), biz).then(r => { setRows(r); setErr('') }).catch(e => setErr((e as Error).message))
    }, 300)
    return () => clearTimeout(t)
  }, [q, biz])

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Field placeholder="Name or mobile number" value={q} onChangeText={setQ} autoCorrect={false} autoFocus />
      <Err msg={err} />
      {q.trim().length >= 2 && rows.length === 0 && !err && <Note>No patient found. To register someone new, use Queue → + New token.</Note>}
      {rows.map(r => (
        <Pressable key={r.patient_member_id} onPress={() => router.push({ pathname: '/patient/[member]', params: { member: r.patient_member_id } })}>
          <Card>
            <Text style={st.name}>{r.full_name}</Text>
            <Text style={st.meta}>{[r.phone, r.age_years != null ? `${r.age_years}y` : null, r.gender, r.mrn ? `file ${r.mrn}` : null,
              `${r.visit_count} visit${r.visit_count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</Text>
          </Card>
        </Pressable>
      ))}
      {q.trim().length < 2 && <View style={{ padding: 8 }}><Note>Type at least 2 letters or digits.</Note></View>}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 40 },
  name: { fontSize: 16, fontWeight: '700', color: C.ink },
  meta: { fontSize: 13, color: C.muted },
})
