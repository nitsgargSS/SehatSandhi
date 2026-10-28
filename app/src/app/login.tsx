import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { clinicOtp, linkMyLogin, prepareEmailLogin, WHATSAPP_CODE_ERRORS } from '@web/lib/businessApi'
import { fetchPasswordState, mustChangeNow } from '@web/lib/passwordState'
import NewPassword from '../ui/NewPassword'
import { C } from '../ui/theme'

// The same login as sehatsandhi.com/business/login: a 6-digit code by email
// (the everyday one), or email + password — and, as there, "Set a password":
// an emailed code proves the address, then they choose one. Many staff have
// only a phone, so setting, forgetting and expiry are all handled here.
// A WhatsApp code is the fourth way in, to the number registered on the clinic
// or doctor (clinic-otp) — and the way in when email delivery is down.
type Mode = 'code' | 'whatsapp' | 'password' | 'reset'
const TAB: Record<Mode, string> = { code: 'Email me a code', whatsapp: 'WhatsApp code', password: 'Password', reset: 'Set / forgot password' }

export default function Login() {
  const [mode, setMode] = useState<Mode>('code')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Signed in, but a new password is needed first: chosen ('reset'), or the
  // old one expired (0080/0081 — an expired login reads nothing, so the clinic
  // would look empty).
  const [choose, setChoose] = useState<null | 'reset' | 'expired'>(null)
  const addr = email.trim().toLowerCase()
  const digits = phone.replace(/\D/g, '')

  const enter = async () => { await linkMyLogin(); router.replace('/queue') }
  const done = async () => {
    if (mode === 'reset') { setChoose('reset'); setBusy(false); return }
    // Asked before anything else, as the website's guards do.
    if (mustChangeNow(await fetchPasswordState())) { setChoose('expired'); setBusy(false); return }
    await enter()
  }

  const sendCode = async () => {
    setBusy(true); setErr('')
    // Creates the login for a registered address first, as the website does.
    await prepareEmailLogin(addr)
    const { error } = await supabase.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: false } })
    setBusy(false)
    if (error && !/signups not allowed/i.test(error.message)) { setErr(error.message); return }
    // Same words whether or not the address is known, as on the website.
    setSent(true)
  }
  const sendWhatsApp = async () => {
    setBusy(true); setErr('')
    try { await clinicOtp({ action: 'request', phone: digits }); setSent(true) }
    catch (e) { const m = (e as Error).message; setErr(WHATSAPP_CODE_ERRORS[m] ?? m) }
    setBusy(false)
  }
  const verifyWhatsApp = async () => {
    setBusy(true); setErr('')
    try {
      // clinic-otp checks the code and returns a one-time token for the
      // number's login; exchanging it is what makes the session.
      const { tokenHash } = await clinicOtp({ action: 'verify', phone: digits, code })
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: 'email' })
      if (error) throw new Error('Could not start your session. Please try again.')
    } catch (e) { setErr((e as Error).message); setBusy(false); return }
    await done()
  }
  const verify = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.auth.verifyOtp({ email: addr, token: code, type: 'email' })
    if (error) { setErr('That code did not work. Check it, or send a new one.'); setBusy(false); return }
    await done()
  }
  const signIn = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: addr, password })
    if (error) { setErr(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message); setBusy(false); return }
    await done()
  }

  if (choose) return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{choose === 'expired' ? 'Your password has expired' : 'Choose a password'}</Text>
        <Text style={s.h}>{choose === 'expired'
          ? `Choose a new one${addr ? ` for ${addr}` : ''} to carry on.`
          : `For ${addr}. Next time, sign in with this password or with an emailed code.`}</Text>
        <NewPassword onDone={enter} label="Save and continue" />
        {choose === 'reset' && <Pressable onPress={enter}><Text style={s.link}>Skip for now</Text></Pressable>}
      </ScrollView>
    </KeyboardAvoidingView>
  )

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
      <View style={s.tabs}>
        {(['code', 'whatsapp', 'password', 'reset'] as Mode[]).map(m => (
          <Pressable key={m} onPress={() => { setMode(m); setErr(''); setSent(false); setCode('') }} style={[s.tab, mode === m && s.tabOn]}>
            <Text style={[s.tabText, mode === m && { color: '#fff' }]}>{TAB[m]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.h}>{mode === 'reset'
        ? 'Forgot your password, or never set one? We email you a code to prove it is you, then you choose a password.'
        : mode === 'whatsapp'
          ? 'Use the WhatsApp number registered on your clinic or doctor profile.'
          : 'Use the email you sign in with on Sehatsandhi.'}</Text>
      {mode === 'whatsapp' ? (
        <TextInput style={s.input} placeholder="WhatsApp number" keyboardType="phone-pad"
          autoComplete="tel" value={phone} onChangeText={t => { setPhone(t); setSent(false) }} editable={!sent} />
      ) : (
        <TextInput style={s.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address"
          autoComplete="email" value={email} onChangeText={t => { setEmail(t); setSent(false) }} editable={!sent} />
      )}

      {mode === 'password' && (
        <TextInput style={s.input} placeholder="Password" secureTextEntry autoComplete="password"
          value={password} onChangeText={setPassword} onSubmitEditing={signIn} />
      )}
      {mode !== 'password' && sent && (
        <>
          <Text style={s.note}>{mode === 'whatsapp'
            ? `If ${phone.trim()} is registered, a 6-digit code is on its way on WhatsApp.`
            : `If ${addr} is registered, a 6-digit code is on its way. Check Spam too.`}</Text>
          <TextInput style={[s.input, s.code]} placeholder="000000" keyboardType="number-pad" maxLength={6}
            autoComplete="one-time-code" value={code} onChangeText={t => setCode(t.replace(/\D/g, ''))} />
        </>
      )}

      {!!err && <Text style={s.err}>{err}</Text>}

      {mode === 'password' ? (
        <Btn busy={busy} disabled={!addr || !password} onPress={signIn} label="Sign in" />
      ) : sent ? (
        <>
          <Btn busy={busy} disabled={code.length < 6} onPress={mode === 'whatsapp' ? verifyWhatsApp : verify}
            label={mode === 'reset' ? 'Confirm and choose a password' : 'Confirm'} />
          <Pressable onPress={() => { setSent(false); setCode('') }}>
            <Text style={s.link}>{mode === 'whatsapp' ? 'Use a different number' : 'Use a different email'}</Text>
          </Pressable>
        </>
      ) : mode === 'whatsapp' ? (
        <Btn busy={busy} disabled={digits.length < 10} onPress={sendWhatsApp} label="Send me a code on WhatsApp" />
      ) : (
        <Btn busy={busy} disabled={!addr.includes('@')} onPress={sendCode} label="Send me a code" />
      )}

      {mode === 'password' && (
        <Pressable onPress={() => { setMode('reset'); setErr(''); setSent(false) }}>
          <Text style={s.link}>Forgot it, or never set one? Set a password</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  )
}

function Btn({ busy, disabled, onPress, label }: { busy: boolean; disabled: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable style={[s.btn, (busy || disabled) && { opacity: 0.6 }]} disabled={busy || disabled} onPress={onPress}>
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{label}</Text>}
    </Pressable>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 12 },
  tabs: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 20, fontWeight: '800', color: C.ink },
  tab: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#ece7dc' },
  tabOn: { backgroundColor: C.green },
  tabText: { fontWeight: '700', color: C.muted },
  h: { fontSize: 14, color: C.muted, marginTop: 4 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, fontSize: 16 },
  code: { textAlign: 'center', fontSize: 24, letterSpacing: 8 },
  err: { color: C.danger },
  btn: { backgroundColor: C.green, paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  link: { color: C.green, fontWeight: '700', textAlign: 'center', padding: 6 },
  note: { fontSize: 12.5, color: C.muted },
})
