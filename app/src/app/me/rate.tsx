import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { rate, type RateKind } from '../../lib/patient'
import { Btn, Card, Chip, Err, Field, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// One rating (0196): a visit, a medicine order, an ambulance trip or an
// insurance advisor — opened from "Waiting for your rating" or the reminder
// notification.
export default function RateScreen() {
  const { kind, id, title } = useLocalSearchParams<{ kind: RateKind; id: string; title?: string }>()
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')
  const [paid, setPaid] = useState('')
  const [bought, setBought] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const send = async () => {
    setBusy(true); setErr('')
    try { await rate(kind, id, stars, review, paid === '' ? null : Number(paid), bought); setDone(true) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (done) return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Card><Text style={st.h}>धन्यवाद! / Thank you!</Text><Note>Your rating helps other families choose.</Note></Card>
      <Btn label="Back" onPress={() => router.replace('/me')} />
    </ScrollView>
  )
  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={st.h}>{title || 'कैसा रहा? / How was it?'}</Text>
        <View style={st.stars}>
          {[1, 2, 3, 4, 5].map(n => (
            <Pressable key={n} onPress={() => setStars(n)} accessibilityLabel={`${n} stars`}>
              <Text style={[st.star, n <= stars && { color: '#f5a623' }]}>★</Text>
            </Pressable>
          ))}
        </View>
        {(kind === 'order' || kind === 'trip') && (
          <Field label="How much did you pay? (₹)" keyboardType="decimal-pad" value={paid} onChangeText={v => setPaid(v.replace(/[^\d.]/g, ''))} />
        )}
        {kind === 'insurance' && (
          <View style={st.row}>
            <Text style={st.body}>Did you buy a policy?</Text>
            <Chip label="Yes" on={bought === true} onPress={() => setBought(true)} />
            <Chip label="No" on={bought === false} onPress={() => setBought(false)} />
          </View>
        )}
        <Field label="Anything to add? (optional)" multiline value={review} onChangeText={setReview} />
      </Card>
      <Err msg={err} />
      <Btn label="Send rating" busy={busy} disabled={stars === 0} onPress={send} />
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  h: { fontSize: 18, fontWeight: '800', color: C.ink },
  stars: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: 6 },
  star: { fontSize: 40, color: '#d8d8d8' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  body: { color: C.ink, fontSize: 15 },
})
