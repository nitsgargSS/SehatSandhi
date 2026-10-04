import { useEffect, useState } from 'react'
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { me, whereAmI, takePhoto, pickPhoto, uploadPrescription, orderMedicines, type Picked, type Reply } from '../../lib/patient'
import { Btn, Card, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// Order medicines from the app (0196 → 0189): the same order as WhatsApp,
// with a photo of the prescription from the camera or gallery.
export default function OrderScreen() {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [address, setAddress] = useState('')
  const [meds, setMeds] = useState('')
  const [photo, setPhoto] = useState<Picked | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Reply | null>(null)

  useEffect(() => { me().then(m => { if (m) { setName(m.name ?? ''); setPin(m.pin_code ?? '') } }) }, [])
  const locate = async () => {
    setErr('')
    try { const p = await whereAmI(); if (p.pin) setPin(p.pin); if (p.area && !address) setAddress(p.area) } catch (e) { setErr((e as Error).message) }
  }
  const choose = async (f: () => Promise<Picked | null>) => { setErr(''); try { const p = await f(); if (p) setPhoto(p) } catch (e) { setErr((e as Error).message) } }
  const send = async () => {
    setBusy(true); setErr('')
    try {
      const rx = photo ? await uploadPrescription(photo) : ''
      setDone(await orderMedicines(pin, name, address, meds, rx))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (done) return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Card><Text style={st.body}>{done.text}</Text></Card>
      {!!done.token && <Btn label="See the price and approve" onPress={() => { const u = (done.text ?? '').match(/https:\/\/\S+\/o\/[0-9a-f]{24}/)?.[0]; if (u) Linking.openURL(u) }} />}
    </ScrollView>
  )

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Field label="Name" value={name} onChangeText={setName} />
        <View style={st.row}>
          <Field label="PIN code" keyboardType="number-pad" maxLength={6} value={pin} onChangeText={v => setPin(v.replace(/\D/g, ''))} />
          <View style={{ justifyContent: 'flex-end' }}><Btn small kind="ghost" label="📍 Use my location" onPress={locate} /></View>
        </View>
        <Field label="Full delivery address" multiline value={address} onChangeText={setAddress} placeholder="House no., street, landmark" />
      </Card>
      <Card>
        <Label>Prescription photo (optional)</Label>
        {photo ? <Image source={{ uri: photo.uri }} style={st.photo} /> : <Note>A photo helps the pharmacy get it right.</Note>}
        <View style={st.row}>
          <Btn small label="📷 Take photo" onPress={() => choose(takePhoto)} />
          <Btn small kind="ghost" label="🖼️ From gallery" onPress={() => choose(pickPhoto)} />
          {!!photo && <Btn small kind="danger" label="Remove" onPress={() => setPhoto(null)} />}
        </View>
        <Field label="Medicine names and how many" multiline value={meds} onChangeText={setMeds} placeholder="e.g. Paracetamol 650 – 10 tablets" />
      </Card>
      <Note>A pharmacy near you sends the total, with any delivery fee. Nothing is delivered until you approve it. You pay the pharmacy when the medicines arrive.</Note>
      <Err msg={err} />
      <Btn label="Send order" busy={busy} disabled={!name.trim() || pin.length !== 6 || !address.trim() || (!meds.trim() && !photo)} onPress={send} />
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' },
  photo: { width: '100%', height: 220, borderRadius: 12, backgroundColor: '#eee' },
  body: { color: C.ink, fontSize: 15 },
})
