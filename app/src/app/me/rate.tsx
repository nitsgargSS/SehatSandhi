import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { rate, type RateKind } from '../../lib/patient'
import { supabase } from '../../lib/supabase'
import { Btn, Card, Chip, Err, Field, Note } from '../../ui/kit'
import { C } from '../../ui/theme'
import { withPatient } from '../../ui/PatientGate'

// One rating (0196): a visit, a medicine order, an ambulance trip or an
// insurance advisor — opened from "Waiting for your rating" or the reminder
// notification.
function RateScreen() {
  const { kind, id, title } = useLocalSearchParams<{ kind: RateKind; id: string; title?: string }>()
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')
  const [paid, setPaid] = useState('')
  const [bought, setBought] = useState<boolean | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const send = async () => {
    setBusy(true); setErr('')
    try {
      await rate(kind, id, stars, review, paid === '' ? null : Number(paid), bought)
      // 0214: the optional savings answer — never blocks the rating.
      if (saved) await supabase.rpc('sehat_my_saved', { p_kind: kind, p_id: id, p_answer: saved, p_channel: 'app' }).then(() => undefined, () => undefined)
      setDone(true)
    }
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
        <Text style={st.body}>Sehatsandhi से आपका कितना समय/खर्च बचा? (optional)</Text>
        <View style={st.row}>{([['time_and_money', 'समय और पैसा दोनों / Both'], ['time', 'समय / Time'], ['money', 'पैसा / Money'], ['none', 'कोई फ़र्क नहीं / No difference']] as [string, string][]).map(([k, l]) =>
          <Chip key={k} label={l} on={saved === k} onPress={() => setSaved(saved === k ? null : k)} />)}</View>
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

export default withPatient(RateScreen, 'Ratings come only from real visits on your number.')
