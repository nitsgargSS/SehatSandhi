import { useCallback, useState, type ComponentType } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { supabase } from '../lib/supabase'
import { registerPush } from '../lib/push'
import { me, requestCode, verifyCode } from '../lib/patient'
import { Btn, Card, Err, Field, Note } from './kit'
import { C } from './theme'

// The patient's own screens (orders, ambulance, insurance, records, messages,
// ratings) act on the signed-in number. Reached from anywhere — the start
// screen, the booking chat, a notification — they first make sure someone is
// signed in as a patient, asking for the WhatsApp code right there if not.
export function withPatient<P extends object>(Screen: ComponentType<P>, why: string) {
  return function Gated(props: P) {
    const [ok, setOk] = useState<boolean | undefined>(undefined)
    useFocusEffect(useCallback(() => { me().then(m => setOk(!!m)).catch(() => setOk(false)) }, []))
    if (ok === undefined) return <View style={st.center}><ActivityIndicator color={C.green} /></View>
    if (!ok) return <SignIn why={why} onDone={() => setOk(true)} />
    return <Screen {...props} />
  }
}

export function SignIn({ why, onDone }: { why: string; onDone: () => void }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [dev, setDev] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={st.h}>अपने नंबर से साइन इन करें / Sign in with your number</Text>
        <Note>{why} We send a 6-digit code to your WhatsApp — only once on this phone.</Note>
        <Field label="Mobile number" keyboardType="phone-pad" placeholder="98765 43210" value={phone} onChangeText={setPhone} editable={!sent} />
        {!sent ? (
          <Btn label="Send code on WhatsApp" busy={busy} disabled={phone.replace(/\D/g, '').length < 10}
            onPress={() => run(async () => { const r = await requestCode(phone); setSent(true); setDev(r.devCode ?? '') })} />
        ) : (
          <>
            <Field label="6-digit code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
            {!!dev && <Note>Test mode: your code is {dev}</Note>}
            <Btn label="Sign in" busy={busy} disabled={code.length !== 6} onPress={() => run(async () => {
              // A business session on this phone gives way to the patient's.
              await supabase.auth.signOut().catch(() => {})
              await verifyCode(phone, code)
              registerPush().catch(() => {})
              onDone()
            })} />
            <Btn kind="ghost" small label="Change number" onPress={() => { setSent(false); setCode('') }} />
          </>
        )}
        <Err msg={err} />
      </Card>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h: { fontSize: 18, fontWeight: '800', color: C.ink },
})
