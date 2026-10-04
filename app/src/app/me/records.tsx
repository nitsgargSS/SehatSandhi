import { useCallback, useState } from 'react'
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { myRecords, openRecord, type Records } from '../../lib/patient'
import { Btn, Card, Chip, Err, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// My health (0197): everyone on this number — visits, prescriptions, lab
// reports, bills, discharge summaries — and the clinics they have been to.
const d = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

export default function RecordsScreen() {
  const [r, setR] = useState<Records | null>(null)
  const [who, setWho] = useState<string>('')
  const [err, setErr] = useState('')
  const load = useCallback(() => { myRecords().then(x => { setR(x); setErr('') }).catch(e => setErr((e as Error).message)) }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))
  const open = (kind: 'rx' | 'lab' | 'bill' | 'ds', id: string) => openRecord(kind, id).then(u => Linking.openURL(u)).catch(e => setErr((e as Error).message))
  const mine = <T extends { member_id: string }>(xs: T[]) => xs.filter(x => !who || x.member_id === who)
  const name = (id: string) => r?.members.find(m => m.id === id)?.name ?? ''
  const many = (r?.members.length ?? 0) > 1

  if (!r) return <View style={st.center}>{err ? <Err msg={err} /> : <Note>Loading…</Note>}</View>
  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      {many && (
        <View style={st.row}>
          <Chip label="Everyone" on={!who} onPress={() => setWho('')} />
          {r.members.map(m => <Chip key={m.id} label={m.name.split(' ')[0]} on={who === m.id} onPress={() => setWho(m.id)} />)}
        </View>
      )}
      <Err msg={err} />

      <Label>My clinics</Label>
      {!r.clinics.length && <Note>Clinics you visit through Sehatsandhi show here.</Note>}
      {r.clinics.map(c => (
        <Card key={c.business_id}>
          <Text style={st.bold}>{c.name}</Text>
          {!!c.address && <Note>{c.address}</Note>}
          <View style={st.row}>
            <Btn small label={`💬 Message${c.unread ? ` (${c.unread} new)` : ''}`} onPress={() => router.push({ pathname: '/me/chat', params: { business: c.business_id, name: c.name } })} />
            {!!c.phone && <Btn small kind="ghost" label="📞 Call" onPress={() => Linking.openURL(`tel:${c.phone}`)} />}
            {!!c.phone && <Btn small kind="ghost" label="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${String(c.phone).replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}`)} />}
          </View>
        </Card>
      ))}

      <Label>Prescriptions</Label>
      {!mine(r.prescriptions).length && <Note>None yet.</Note>}
      {mine(r.prescriptions).map(x => (
        <Pressable key={x.id} onPress={() => open('rx', x.id)}><Card>
          <Text style={st.bold}>💊 {d(x.date)} · {x.doctor}</Text>
          <Note>{x.clinic}{x.diagnosis ? ` · ${x.diagnosis}` : ''}{many ? ` · ${name(x.member_id)}` : ''} · open ›</Note>
        </Card></Pressable>
      ))}

      <Label>Visits</Label>
      {!mine(r.visits).length && <Note>None yet.</Note>}
      {mine(r.visits).map(v => (
        <Card key={v.id}>
          <Text style={st.bold}>🩺 {d(v.date)} · {v.clinic}</Text>
          <Note>{[v.doctor, v.diagnosis && `Diagnosis: ${v.diagnosis}`, v.advice && `Advice: ${v.advice}`, v.follow_up && `Follow-up ${d(v.follow_up)}`, many && name(v.member_id)].filter(Boolean).join(' · ')}</Note>
        </Card>
      ))}

      {!!mine(r.lab_reports).length && <Label>Lab reports</Label>}
      {mine(r.lab_reports).map(x => (
        <Pressable key={x.id} onPress={() => open('lab', x.id)}><Card>
          <Text style={st.bold}>🧪 {d(x.date)} · {x.clinic}</Text>
          <Note>Report {x.no}{x.by ? ` · ${x.by}` : ''}{many ? ` · ${name(x.member_id)}` : ''} · open ›</Note>
        </Card></Pressable>
      ))}

      {!!mine(r.discharges).length && <Label>Discharge summaries</Label>}
      {mine(r.discharges).map(x => (
        <Pressable key={x.id} onPress={() => open('ds', x.id)}><Card>
          <Text style={st.bold}>🏥 {d(x.date)} · {x.clinic}</Text>
          <Note>{x.diagnosis ?? ''}{x.doctor ? ` · ${x.doctor}` : ''}{many ? ` · ${name(x.member_id)}` : ''} · open ›</Note>
        </Card></Pressable>
      ))}

      {!!mine(r.bills).length && <Label>Bills</Label>}
      {mine(r.bills).map(x => (
        <Pressable key={x.id} onPress={() => open('bill', x.id)}><Card>
          <Text style={st.bold}>🧾 {d(x.date)} · ₹{x.amount}</Text>
          <Note>{x.clinic} · bill {x.no}{many ? ` · ${name(x.member_id)}` : ''} · open ›</Note>
        </Card></Pressable>
      ))}
      <Note>This is what clinics on Sehatsandhi have recorded for the people on your number. To correct something, message the clinic.</Note>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 10, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  bold: { fontWeight: '700', color: C.ink, fontSize: 15 },
})
