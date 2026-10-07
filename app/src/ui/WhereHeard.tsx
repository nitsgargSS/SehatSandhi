import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { Card, Chip, Note } from './kit'
import { C } from './theme'

// "Where did you hear about Sehatsandhi?" — asked once, in the app only
// (business metrics, 0210), and only while the patient's first source is
// unknown (a campaign code, clinic QR or website visit already tells us
// otherwise). Optional: Skip is remembered on this phone. Records the
// patient's first source through sehat_my_first_touch, never overwriting.
const KEY = 'sehat:whereHeard'
const OPTIONS: [string, string][] = [
  ['instagram_reel', 'Instagram / Facebook'], ['google', 'Google'], ['doctor_referral', 'डॉक्टर / क्लिनिक ने बताया'],
  ['patient_referral', 'दोस्त / परिवार'], ['qr_poster', 'पोस्टर / QR कोड'], ['camp', 'हेल्थ कैंप'],
  ['sms_campaign', 'SMS / WhatsApp मैसेज'], ['other', 'कहीं और'],
]

export default function WhereHeard() {
  const [ask, setAsk] = useState(false)
  const [thanks, setThanks] = useState(false)
  useEffect(() => {
    let skipped = false
    try { skipped = !!localStorage.getItem(KEY) } catch { /* fine */ }
    // Records that this patient uses the app (first channel, if new) and says whether we know their source.
    supabase.rpc('sehat_my_first_touch', { p_type: null, p_detail: null, p_channel: 'app' }).then(({ data }) => {
      const src = (data as { source?: string | null } | null)?.source
      if (!skipped && (!src || src === 'unknown')) setAsk(true)
    })
  }, [])
  const done = () => { try { localStorage.setItem(KEY, '1') } catch { /* fine */ } }
  const answer = (t: string) => {
    done(); setAsk(false); setThanks(true)
    supabase.rpc('sehat_my_first_touch', { p_type: t, p_detail: 'asked in the app', p_channel: 'app' }).then(() => undefined, () => undefined)
  }
  if (thanks) return <Note>धन्यवाद! 🙏</Note>
  if (!ask) return null
  return (
    <Card>
      <Text style={st.q}>आपने Sehatsandhi के बारे में कहाँ सुना?</Text>
      <Text style={st.sub}>Where did you hear about us? (optional)</Text>
      <View style={st.row}>
        {OPTIONS.map(([k, l]) => <Chip key={k} label={l} onPress={() => answer(k)} />)}
        <Chip label="Skip" onPress={() => { done(); setAsk(false) }} />
      </View>
    </Card>
  )
}

const st = StyleSheet.create({
  q: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  sub: { fontSize: 12.5, color: C.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
})
