import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useSession } from '../../../lib/session'
import { getOccupancy, type OccupancyRow } from '@web/lib/admissionsApi'
import { Card, Err, Label, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// The ward board — the website's Beds (src/pages/doctor/Wards.tsx). Tap an
// occupied bed for the stay: rounds notes, vitals, drug chart, discharge.
// Admitting is done on the computer (Patients → Admissions).
const days = (iso: string | null) => iso ? Math.max(1, Math.ceil((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0

export default function Beds() {
  const { s } = useSession()
  const [rows, setRows] = useState<OccupancyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const biz = s?.clinic?.id

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true)
    try { setRows(await getOccupancy(biz)); setErr('') } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [biz])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const wards: [string, OccupancyRow[]][] = []
  for (const r of rows) { const h = wards.find(w => w[0] === r.ward_name); if (h) h[1].push(r); else wards.push([r.ward_name, [r]]) }
  const occupied = rows.filter(r => r.occupied).length

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Text style={st.sum}>{occupied} of {rows.length} beds occupied</Text>
      <Err msg={err} />
      {wards.map(([name, beds]) => (
        <Card key={name}>
          <Label>{name}</Label>
          {beds.filter(b => b.occupied).map(b => (
            <Pressable key={b.bed_id} style={st.bed}
              onPress={() => b.admission_id && router.push({ pathname: '/stay/[admission]', params: { admission: b.admission_id } })}>
              <Text style={st.bedLabel}>{b.bed_label}</Text>
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{b.patient_name}</Text>
                <Text style={st.meta}>{[b.age_years != null ? `${b.age_years}y` : null, b.gender, `day ${days(b.admitted_at)}`, b.attending_name].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={st.chev}>›</Text>
            </Pressable>
          ))}
          {beds.some(b => !b.occupied) && (
            <Text style={st.free}>Free: {beds.filter(b => !b.occupied).map(b => b.bed_label).join(', ')}</Text>
          )}
        </Card>
      ))}
      {rows.length === 0 && !loading && <Note>No wards set up. Add wards and beds on the computer (Beds).</Note>}
      <Note>Admit a patient on the computer: Patients → the patient → Admissions.</Note>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 40 },
  sum: { fontSize: 16, fontWeight: '800', color: C.ink },
  bed: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 10 },
  bedLabel: { minWidth: 44, fontSize: 15, fontWeight: '800', color: C.green },
  name: { fontSize: 16, fontWeight: '700', color: C.ink },
  meta: { fontSize: 13, color: C.muted },
  chev: { fontSize: 24, color: C.muted },
  free: { fontSize: 13, color: C.muted, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 8 },
})
