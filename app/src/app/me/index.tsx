import { useCallback, useState } from 'react'
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { registerPush, unregisterPush } from '../../lib/push'
import { me, requestCode, verifyCode, myActivity, type Me, type Activity } from '../../lib/patient'
import { RateList, RequestList, requests, toRate } from '../../ui/MyLists'
import { Btn, Card, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'
import WhereHeard from '../../ui/WhereHeard'

// The patient's home in the app (0196): sign in once with a WhatsApp code,
// then everything on their number — and what is waiting for a rating.

export default function MyHome() {
  const [who, setWho] = useState<Me | null | undefined>(undefined)
  const [act, setAct] = useState<Activity | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [dev, setDev] = useState('')

  const load = useCallback(async () => {
    const m = await me().catch(() => null)
    setWho(m)
    if (m) myActivity().then(setAct).catch(e => setErr((e as Error).message))
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const send = async () => {
    setBusy(true); setErr('')
    try { const r = await requestCode(phone); setSent(true); setDev(r.devCode ?? '') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const verify = async () => {
    setBusy(true); setErr('')
    try {
      // A business session on this phone gives way to the patient's.
      await supabase.auth.signOut().catch(() => {})
      await verifyCode(phone, code)
      registerPush().catch(() => {})
      await load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const signOut = async () => { await unregisterPush(); await supabase.auth.signOut(); setWho(null); setAct(null); setSent(false); setCode('') }

  if (who === undefined) return <View style={st.center}><Note>Loading…</Note></View>

  if (!who) return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={st.h}>अपने नंबर से साइन इन करें / Sign in with your number</Text>
        <Note>We send a 6-digit code to your WhatsApp. Then you can book doctors, order medicines, ask for an ambulance or an insurance advisor, see your health records, and rate them.</Note>
        <Field label="Mobile number" keyboardType="phone-pad" placeholder="98765 43210" value={phone} onChangeText={setPhone} editable={!sent} />
        {!sent ? <Btn label="Send code on WhatsApp" busy={busy} disabled={phone.replace(/\D/g, '').length < 10} onPress={send} /> : (
          <>
            <Field label="6-digit code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
            {!!dev && <Note>Test mode: your code is {dev}</Note>}
            <Btn label="Sign in" busy={busy} disabled={code.length !== 6} onPress={verify} />
            <Btn kind="ghost" small label="Change number" onPress={() => { setSent(false); setCode('') }} />
          </>
        )}
        <Err msg={err} />
      </Card>
      <Card>
        <Text style={st.bold}>Emergency?</Text>
        <Btn kind="danger" label="📞 Call 108 (free ambulance)" onPress={() => Linking.openURL('tel:108')} />
      </Card>
    </ScrollView>
  )

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Text style={st.h}>नमस्ते{who.name ? `, ${who.name.split(' ')[0]}` : ''} 🙏</Text>
      <Note>+{who.phone}</Note>
      <WhereHeard />


      <View style={st.grid}>
        <Pressable style={[st.tile, { borderColor: '#f3c2d6' }]} onPress={() => router.push('/me/order')}><Text style={st.tileIcon}>💊</Text><Text style={st.tileT}>दवाई घर पर{'\n'}Medicines</Text></Pressable>
        <Pressable style={[st.tile, { borderColor: '#f5b5ae' }]} onPress={() => router.push('/me/ambulance')}><Text style={st.tileIcon}>🚑</Text><Text style={st.tileT}>एम्बुलेंस{'\n'}Ambulance</Text></Pressable>
        <Pressable style={[st.tile, { borderColor: '#b3dce6' }]} onPress={() => router.push('/me/insurance')}><Text style={st.tileIcon}>🛡️</Text><Text style={st.tileT}>बीमा{'\n'}Insurance</Text></Pressable>
        <Pressable style={[st.tile, { borderColor: '#b7e2cf' }]} onPress={() => router.push('/find')}><Text style={st.tileIcon}>🩺</Text><Text style={st.tileT}>अपॉइंटमेंट{'\n'}Appointment</Text></Pressable>
        <Pressable style={[st.tile, { borderColor: '#f3d9a4' }]} onPress={() => router.push('/camps')}><Text style={st.tileIcon}>🎁</Text><Text style={st.tileT}>कैंप और ऑफर{'\n'}Camps &amp; offers</Text></Pressable>
        <Pressable style={[st.tile, { borderColor: '#d6d0f0' }]} onPress={() => router.push('/me/records')}><Text style={st.tileIcon}>📋</Text><Text style={st.tileT}>रिकॉर्ड और मैसेज{'\n'}Records &amp; messages</Text></Pressable>
      </View>

      {/* Kept short: the latest 3 of each; the rest behind 'See all'. */}
      <Err msg={err} />
      <RateList items={toRate(act)} limit={3} onAll={() => router.push('/me/requests')} />
      <RequestList items={requests(act)} limit={3} onAll={() => router.push('/me/requests')} onChanged={load} />
      <Btn kind="ghost" small label="Sign out" onPress={signOut} />
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h: { fontSize: 20, fontWeight: '800', color: C.ink },
  bold: { fontWeight: '700', color: C.ink, fontSize: 15 },
  body: { color: C.ink, fontSize: 14, flex: 1 },
  stars: { color: C.green, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '47%', backgroundColor: C.card, borderWidth: 1.5, borderRadius: 16, paddingVertical: 16, alignItems: 'center', gap: 4 },
  tileIcon: { fontSize: 28 },
  tileT: { textAlign: 'center', fontWeight: '700', color: C.ink },
  health: { backgroundColor: C.green, borderRadius: 16, padding: 16, gap: 4 },
  healthT: { color: '#fff', fontWeight: '800', fontSize: 16 },
  healthS: { color: '#d6efe4', fontSize: 13 },
})
