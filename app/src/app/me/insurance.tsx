import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { me, whereAmI, askInsurance, type Reply } from '../../lib/patient'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'
import { withPatient } from '../../ui/PatientGate'

// Health insurance from the app (0196 → 0192): a licensed advisor near them
// calls back; only the one who takes it gets the number.
const COVERS = ['Family floater', 'Just me', 'Parents / senior citizen', 'Top-up of existing policy']
const TIMES = ['Morning', 'Afternoon', 'After 6 pm']

function InsuranceScreen() {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [cover, setCover] = useState('')
  const [members, setMembers] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Reply | null>(null)

  useEffect(() => { me().then(m => { if (m) { setName(m.name ?? ''); setPin(m.pin_code ?? '') } }) }, [])
  const locate = async () => { setErr(''); try { const p = await whereAmI(); if (p.pin) setPin(p.pin) } catch (e) { setErr((e as Error).message) } }
  const send = async () => {
    setBusy(true); setErr('')
    try { setDone(await askInsurance(pin, name, cover, members, time)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (done) return <ScrollView contentContainerStyle={st.wrap}><Card><Text style={st.body}>{done.text}</Text></Card></ScrollView>

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Label>What cover?</Label>
        <View style={st.row}>{COVERS.map(c => <Chip key={c} label={c} on={cover === c} onPress={() => setCover(c)} />)}</View>
        <Field label="Who should be covered, with ages" value={members} onChangeText={setMembers} placeholder="e.g. me 34, wife 31, 2 kids" />
        <Label>When should the advisor call?</Label>
        <View style={st.row}>{TIMES.map(c => <Chip key={c} label={c} on={time === c} onPress={() => setTime(c)} />)}</View>
        <Field label="Your name" value={name} onChangeText={setName} />
        <View style={st.row}>
          <Field label="PIN code" keyboardType="number-pad" maxLength={6} value={pin} onChangeText={v => setPin(v.replace(/\D/g, ''))} />
          <View style={{ justifyContent: 'flex-end' }}><Btn small kind="ghost" label="📍 Use my location" onPress={locate} /></View>
        </View>
      </Card>
      <Note>Only the licensed advisor who takes your request gets your number, and you can see their IRDAI licence. Sehatsandhi takes nothing from any policy.</Note>
      <Err msg={err} />
      <Btn label="Ask an advisor to call me" busy={busy} disabled={pin.length !== 6 || !cover} onPress={send} />
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' },
  body: { color: C.ink, fontSize: 15 },
})

export default withPatient(InsuranceScreen, 'The advisor calls you on this number.')
