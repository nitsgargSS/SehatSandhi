import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { myThread, sendToClinic, takePhoto, pickPhoto, uploadPrescription, type ChatMessage } from '../../lib/patient'
import { Err, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// A conversation with one clinic (0197). The clinic's staff answer from their
// dashboard or app; their name shows on each reply.
const t = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })

export default function ChatScreen() {
  const { business, name } = useLocalSearchParams<{ business: string; name?: string }>()
  const [msgs, setMsgs] = useState<ChatMessage[]>([])
  const [clinic, setClinic] = useState<{ name: string; phone: string | null } | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const scroll = useRef<ScrollView>(null)

  const load = useCallback(() => {
    myThread(business).then(r => { setMsgs(r.messages); setClinic(r.clinic); setErr('') }).catch(e => setErr((e as Error).message))
  }, [business])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { const i = setInterval(load, 20_000); return () => clearInterval(i) }, [load])

  const send = async (photoUrl: string | null = null) => {
    if (!text.trim() && !photoUrl) return
    setBusy(true); setErr('')
    try { const m = await sendToClinic(business, text, photoUrl); setMsgs(x => [...x, m]); setText('') }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const photo = async (camera: boolean) => {
    setErr('')
    try { const p = await (camera ? takePhoto() : pickPhoto()); if (p) { setBusy(true); await send(await uploadPrescription(p)) } }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
      <Stack.Screen options={{ title: clinic?.name ?? name ?? 'Clinic' }} />
      <ScrollView ref={scroll} contentContainerStyle={st.wrap} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <Note>Ask the clinic anything about your visit, medicines or reports. For an emergency, call 108.{clinic?.phone ? '' : ''}</Note>
        {!!clinic?.phone && <Pressable onPress={() => Linking.openURL(`tel:${clinic.phone}`)}><Text style={st.link}>📞 Call the clinic: {clinic.phone}</Text></Pressable>}
        {msgs.map(m => (
          <View key={m.id} style={[st.bubble, m.from === 'patient' ? st.mine : st.theirs]}>
            {m.from === 'clinic' && !!m.by && <Text style={st.by}>{m.by}</Text>}
            {!!m.photo_url && <Pressable onPress={() => Linking.openURL(m.photo_url!)}><Image source={{ uri: m.photo_url }} style={st.img} /></Pressable>}
            <Text style={st.body}>{m.body}</Text>
            <Text style={st.time}>{t(m.at)}{m.from === 'patient' ? (m.read ? ' · seen' : ' · sent') : ''}</Text>
          </View>
        ))}
        {!msgs.length && <Note>No messages yet. Write the first one below.</Note>}
      </ScrollView>
      <Err msg={err} />
      <View style={st.bar}>
        <Pressable style={st.icon} onPress={() => photo(true)} accessibilityLabel="Take a photo"><Text>📷</Text></Pressable>
        <Pressable style={st.icon} onPress={() => photo(false)} accessibilityLabel="Send a photo"><Text>🖼️</Text></Pressable>
        <TextInput style={st.input} value={text} onChangeText={setText} placeholder="Type a message" multiline />
        <Pressable style={[st.send, (busy || !text.trim()) && { opacity: 0.5 }]} disabled={busy || !text.trim()} onPress={() => send()}><Text style={st.sendT}>Send</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 8, paddingBottom: 20 },
  bubble: { maxWidth: '82%', borderRadius: 14, padding: 10, gap: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#dcf8c6' },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  by: { fontSize: 12, fontWeight: '700', color: C.green },
  body: { color: C.ink, fontSize: 15 },
  time: { fontSize: 11, color: C.muted, alignSelf: 'flex-end' },
  img: { width: 200, height: 200, borderRadius: 10, backgroundColor: '#eee' },
  link: { color: C.green, fontWeight: '700' },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 8, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.card },
  icon: { padding: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, color: C.ink, backgroundColor: '#fff' },
  send: { backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  sendT: { color: '#fff', fontWeight: '800' },
})
