import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { supabase } from '../lib/supabase'
import {
  matchText, looksLikeEmergency, refreshEmergencyTerms, routeFor, summary, recentSearches, rememberSearch, type Match,
} from '../lib/match'
import { C } from '../ui/theme'

// Home. The main way in is the box: the patient writes what is wrong in their
// own words and the database's matcher (the same one as the WhatsApp bot)
// decides where they go — proceed (open the screen, filled in), confirm (a
// हाँ / नहीं sheet), menu (the tiles), emergency (the red 108 screen). The six
// tiles stay as the manual way. Businesses sign in at the bottom; a saved
// session skips straight in.
const TILES: { label: string; hi: string; go: { pathname: string; params?: Record<string, string> } }[] = [
  { label: '🩺 Doctor', hi: 'डॉक्टर', go: { pathname: '/find' } },
  { label: '🧪 Lab test', hi: 'जांच', go: { pathname: '/find', params: { kind: 'lab' } } },
  { label: '💊 Medicines', hi: 'दवाई', go: { pathname: '/me/order' } },
  { label: '🚑 Ambulance', hi: 'एम्बुलेंस', go: { pathname: '/me/ambulance' } },
  { label: '🛡️ Insurance', hi: 'बीमा', go: { pathname: '/me/insurance' } },
  { label: '🎁 Camps', hi: 'कैंप / ऑफ़र', go: { pathname: '/camps' } },
]

export default function Start() {
  // ?home=1 — the person chose to come back here, so stay.
  const { home } = useLocalSearchParams<{ home?: string }>()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [ask, setAsk] = useState<{ m: Match; text: string } | null>(null)

  useEffect(() => {
    setRecent(recentSearches())
    refreshEmergencyTerms()
    if (home) return
    // 0196: a saved patient session opens the patient's side; a business one the queue.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return
      const { error } = await supabase.rpc('sehat_me')
      router.replace(error ? '/queue' : '/me')
    })
  }, [home])

  const go = (m: Match, said: string) => {
    const r = routeFor(m, said)
    if (r) router.push(r as never)
  }

  const submit = async (said = text) => {
    const t = said.trim()
    if (!t || busy) return
    setNote(''); setBusy(true)
    rememberSearch(t); setRecent(recentSearches())
    const m = await matchText(t)
    setBusy(false)
    if (!m) {
      // No answer in 5 seconds, or no network: only the emergency check runs on the phone.
      if (looksLikeEmergency(t)) { router.push('/emergency'); return }
      setNote('नेटवर्क धीमा है — कृपया नीचे से चुनें। / The network is slow — please pick below.')
      return
    }
    if (m.action === 'emergency' || m.is_emergency) { router.push('/emergency'); return }
    if (m.action === 'proceed') { setText(''); go(m, t); return }
    if (m.action === 'confirm') { setAsk({ m, text: t }); return }
    setNote('हम समझ नहीं पाए, कृपया चुनें। / We did not understand — please pick one below.')
  }

  return (
    <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
      <Image source={require('../../assets/logo-full.png')} style={s.logo} resizeMode="contain" accessibilityLabel="Sehatsandhi — स्वास्थ्य की नई साझेदारी" />

      <View style={s.searchBox}>
        <TextInput style={s.input} value={text} onChangeText={setText} onSubmitEditing={() => submit()}
          placeholder="अपनी समस्या लिखें… (जैसे: बच्चे को बुखार है)" placeholderTextColor="#8a978f"
          returnKeyType="search" multiline={false} />
        <Pressable style={s.go} onPress={() => submit()} disabled={busy} accessibilityLabel="Search">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.goT}>खोजें</Text>}
        </Pressable>
      </View>
      {!!recent.length && (
        <View style={s.chips}>
          {recent.map(r => <Pressable key={r} style={s.chip} onPress={() => { setText(r); submit(r) }}><Text style={s.chipT} numberOfLines={1}>🕘 {r}</Text></Pressable>)}
        </View>
      )}
      {!!note && <Text style={s.note}>{note}</Text>}

      <View style={s.tiles}>
        {TILES.map(t => (
          <Pressable key={t.label} style={s.tile} onPress={() => router.push(t.go as never)}>
            <Text style={s.tileT}>{t.label}</Text>
            <Text style={s.tileS}>{t.hi}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[s.btn, { backgroundColor: '#0b7d57' }]} onPress={() => router.push('/me')}>
        <Text style={s.btnText}>For patients — My Sehatsandhi</Text>
        <Text style={[s.soon, { color: '#d6efe4' }]}>my requests · records · messages</Text>
      </Pressable>
      <Pressable style={s.btn} onPress={() => router.push('/login')}>
        <Text style={s.btnText}>Login</Text>
        <Text style={[s.soon, { color: '#d6efe4' }]}>doctors · clinic staff · pharmacies · labs · partners</Text>
      </Pressable>

      {/* confirm: the matcher is fairly but not fully sure. */}
      <Modal visible={!!ask} transparent animationType="slide" onRequestClose={() => setAsk(null)}>
        <Pressable style={s.backdrop} onPress={() => setAsk(null)} />
        <View style={s.sheet}>
          <Text style={s.sheetT}>{ask?.m.reply_text.replace(/\n?हाँ \/ नहीं\s*$/, '')}</Text>
          {!!ask && <Text style={s.sheetS}>आपने खोजा: {summary(ask.m)}</Text>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={[s.sheetBtn, { backgroundColor: C.green }]} onPress={() => { const a = ask!; setAsk(null); setText(''); go(a.m, a.text) }}>
              <Text style={[s.sheetBtnT, { color: '#fff' }]}>हाँ</Text>
            </Pressable>
            <Pressable style={s.sheetBtn} onPress={() => { setAsk(null); setNote('कृपया नीचे से चुनें। / Please pick one below.') }}>
              <Text style={s.sheetBtnT}>नहीं</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 },
  logo: { width: 220, height: 170 },
  searchBox: { width: '100%', flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.green, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: C.ink },
  go: { backgroundColor: C.green, borderRadius: 14, paddingHorizontal: 18, justifyContent: 'center' },
  goT: { color: '#fff', fontWeight: '800', fontSize: 16 },
  chips: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#ece7dc', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' },
  chipT: { fontSize: 13, color: C.ink },
  note: { width: '100%', fontSize: 14, color: C.danger },
  tiles: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31.5%', flexGrow: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  tileT: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  tileS: { fontSize: 12, color: C.muted, marginTop: 2 },
  btn: { width: '100%', backgroundColor: C.green, paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  soon: { fontSize: 11, color: C.muted, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: C.cream, padding: 20, paddingBottom: 34, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 12 },
  sheetT: { fontSize: 18, fontWeight: '800', color: C.ink },
  sheetS: { fontSize: 13.5, color: C.muted },
  sheetBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  sheetBtnT: { fontSize: 17, fontWeight: '800', color: C.ink },
})
