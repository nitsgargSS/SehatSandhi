import { useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { me, whereAmI, askAmbulance, type Place, type Reply } from '../../lib/patient'
import { Btn, Card, Chip, Err, Field, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// Ambulance from the app (0196 → 0191). 108 comes first; the request carries
// where the phone is, so the crew gets a map pin.
export default function AmbulanceScreen() {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'emergency' | 'scheduled'>('emergency')
  const [place, setPlace] = useState<Place | null>(null)
  const [pin, setPin] = useState('')
  const [address, setAddress] = useState('')
  const [need, setNeed] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Reply | null>(null)

  useEffect(() => {
    me().then(m => { if (m) { setName(m.name ?? ''); setPin(m.pin_code ?? '') } })
    whereAmI().then(p => { setPlace(p); if (p.pin) setPin(p.pin); if (p.area) setAddress(a => a || p.area!) }).catch(e => setErr((e as Error).message))
  }, [])
  const send = async () => {
    setBusy(true); setErr('')
    try { setDone(await askAmbulance(pin, name, kind, address, need, place?.lat ?? null, place?.lng ?? null)) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Btn kind="danger" label="📞 Call 108 now — free, 24×7" onPress={() => Linking.openURL('tel:108')} />
      <Note>In an emergency call 108 first. You can also alert private ambulances near you — the first to accept calls you.</Note>
      {done ? (
        <Card><Text style={st.body}>{done.text}</Text></Card>
      ) : (
        <>
          <Card>
            <View style={st.row}>
              <Chip label="🚨 Emergency now" on={kind === 'emergency'} onPress={() => setKind('emergency')} />
              <Chip label="📅 Booking (transfer / discharge)" on={kind === 'scheduled'} onPress={() => setKind('scheduled')} />
            </View>
            <Note>{place ? `📍 Your location will be sent to the ambulance${place.area ? ` (near ${place.area})` : ''}.` : 'Finding your location…'}</Note>
            <Field label="Pickup address or landmark" multiline value={address} onChangeText={setAddress} />
            <Field label="PIN code" keyboardType="number-pad" maxLength={6} value={pin} onChangeText={v => setPin(v.replace(/\D/g, ''))} />
            <Field label="What happened / what is needed" value={need} onChangeText={setNeed} placeholder={kind === 'emergency' ? 'e.g. accident, chest pain, needs oxygen' : 'date and time, from where to where'} />
            <Field label="Patient's name" value={name} onChangeText={setName} />
          </Card>
          <Err msg={err} />
          <Btn label="Alert ambulances near me" busy={busy} disabled={pin.length !== 6} onPress={send} />
        </>
      )}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  body: { color: C.ink, fontSize: 15 },
})
