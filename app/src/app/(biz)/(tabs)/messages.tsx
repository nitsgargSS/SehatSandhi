import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router'
import { useSession } from '../../../lib/session'
import { listThreads, openThread, sendToPatient, type Thread, type Message } from '@web/lib/messagesApi'
import { Card, Err, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// Patients' messages (0197): their questions from the Sehatsandhi app, and
// the clinic's answers. Every reply carries the name of whoever wrote it.
const t = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })

export default function MessagesScreen() {
  const { s } = useSession()
  const { phone: opened } = useLocalSearchParams<{ phone?: string }>()
  const biz = s?.clinic?.id
  const [threads, setThreads] = useState<Thread[]>([])
  const [phone, setPhone] = useState<string | null>(opened ?? null)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [onApp, setOnApp] = useState(true)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const scroll = useRef<ScrollView>(null)

  useEffect(() => { if (opened) setPhone(opened) }, [opened])
  const load = useCallback(async () => {
    if (!biz) return
    try {
      setThreads(await listThreads(biz))
      if (phone) { const r = await openThread(biz, phone); setMsgs(r.messages); setOnApp(r.on_app) }
      setErr('')
    } catch (e) { setErr((e as Error).message) }
  }, [biz, phone])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { const i = setInterval(load, 20_000); return () => clearInterval(i) }, [load])

  const send = async () => {
    if (!biz || !phone || !text.trim()) return
    setBusy(true); setErr('')
    try { const m = await sendToPatient(biz, phone, text); setMsgs(x => [...x, m]); setText('') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (phone) {
    const th = threads.find(x => x.phone === phone)
    return (
      <View style={{ flex: 1 }}>
        <Pressable onPress={() => { setPhone(null); router.setParams({ phone: undefined }) }} style={st.back}><Text style={st.link}>‹ All messages</Text></Pressable>
        <ScrollView ref={scroll} contentContainerStyle={st.wrap} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
          <Text style={st.bold}>{th?.names ?? `+${phone}`}</Text>
          <Pressable onPress={() => Linking.openURL(`tel:+${phone}`)}><Text style={st.link}>📞 +{phone}</Text></Pressable>
          {!onApp && <Note>Not on the Sehatsandhi app — they will see your reply when they sign in.</Note>}
          {msgs.map(m => (
            <View key={m.id} style={[st.bubble, m.from === 'clinic' ? st.mine : st.theirs]}>
              {m.from === 'clinic' && !!m.by && <Text style={st.by}>{m.by}</Text>}
              {!!m.photo_url && <Pressable onPress={() => Linking.openURL(m.photo_url!)}><Image source={{ uri: m.photo_url }} style={st.img} /></Pressable>}
              <Text style={st.body}>{m.body}</Text>
              <Text style={st.time}>{t(m.at)}</Text>
            </View>
          ))}
        </ScrollView>
        <Err msg={err} />
        <View style={st.bar}>
          <TextInput style={st.input} value={text} onChangeText={setText} placeholder="Reply" multiline />
          <Pressable style={[st.send, (busy || !text.trim()) && { opacity: 0.5 }]} disabled={busy || !text.trim()} onPress={send}><Text style={st.sendT}>Send</Text></Pressable>
        </View>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Err msg={err} />
      {!threads.length && <Note>No messages yet. Patients can write to you from the Sehatsandhi app once they have visited.</Note>}
      {threads.map(th => (
        <Pressable key={th.phone} onPress={() => setPhone(th.phone)}>
          <Card style={th.unread ? { borderColor: C.green, borderWidth: 2 } : undefined}>
            <View style={st.row}><Text style={st.bold}>{th.names ?? `+${th.phone}`}</Text>{th.unread > 0 && <Text style={st.badge}>{th.unread}</Text>}</View>
            <Note>{th.last_from === 'clinic' ? 'You: ' : ''}{th.last_body} · {t(th.last_at)}</Note>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 8, paddingBottom: 20 },
  back: { paddingHorizontal: 14, paddingTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bold: { fontWeight: '700', color: C.ink, fontSize: 15 },
  badge: { backgroundColor: C.green, color: '#fff', fontWeight: '800', borderRadius: 10, paddingHorizontal: 8, overflow: 'hidden' },
  bubble: { maxWidth: '82%', borderRadius: 14, padding: 10, gap: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#dcf8c6' },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  by: { fontSize: 12, fontWeight: '700', color: C.green },
  body: { color: C.ink, fontSize: 15 },
  time: { fontSize: 11, color: C.muted, alignSelf: 'flex-end' },
  img: { width: 200, height: 200, borderRadius: 10, backgroundColor: '#eee' },
  link: { color: C.green, fontWeight: '700' },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 8, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.card },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, color: C.ink, backgroundColor: '#fff' },
  send: { backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  sendT: { color: '#fff', fontWeight: '800' },
})
