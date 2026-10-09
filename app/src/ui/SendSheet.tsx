import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { documentLink, getSendOptions, mailtoFor, sendDocument, type DocKind, type SendOptions } from '@web/lib/sendApi'
import { Btn, Err, Field, Note } from './kit'
import { C } from './theme'

// "Send to the patient", with the choice of how — the website's Send menu
// (src/components/SendMenu.tsx) as a sheet from the bottom of the phone:
//
//   WhatsApp · ₹0.50      from the clinic's wallet; needs the WhatsApp add-on
//   Email · free          sent by Sehatsandhi under the clinic's name
//   My own email app      opens the phone's mail app with the link filled in
//
// Without the add-on the sheet points to the Plan screen, where WhatsApp is
// chosen for the next renewal. It never asks for money or says where to pay:
// the app takes no payments (store rules) — a low wallet is only stated.

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`

export default function SendSheet({ kind, id, biz, label, small = true, onSent }: {
  kind: DocKind
  id: string
  /** The clinic, for the price and the wallet. */
  biz: string
  /** The button's words: "Send", "Send again". */
  label: string
  small?: boolean
  /** Called with a line to show ("✓ Sent on WhatsApp") once something went. */
  onSent?: (note: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<SendOptions | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<'' | 'whatsapp' | 'email' | 'own'>('')
  const [err, setErr] = useState('')
  const [needsPlan, setNeedsPlan] = useState(false)

  useEffect(() => {
    if (!open) return
    setErr(''); setNeedsPlan(false)
    getSendOptions(biz).then(setOptions)
  }, [open, biz])

  const done = (note: string) => { setOpen(false); onSent?.(note) }
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim())
  const blocked = needsPlan ? 'Add WhatsApp to your plan to send on WhatsApp.' : options?.whatsapp_blocker ?? null
  const short = !!options && !blocked && options.balance_paise < options.whatsapp_paise

  const viaWhatsApp = async () => {
    setBusy('whatsapp'); setErr(''); setNeedsPlan(false)
    try { await sendDocument(kind, id, 'whatsapp'); done('✓ Sent on WhatsApp') }
    catch (e) {
      const plan = !!(e as { needsPlan?: boolean }).needsPlan
      setNeedsPlan(plan)
      if (!plan) setErr((e as Error).message)
    } finally { setBusy('') }
  }
  const viaEmail = async () => {
    setBusy('email'); setErr('')
    try { await sendDocument(kind, id, 'email', email.trim()); done(`✓ Emailed to ${email.trim()}`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  const viaOwnApp = async () => {
    setBusy('own'); setErr('')
    try {
      const d = await documentLink(kind, id)
      try { await Linking.openURL(mailtoFor(d, email)) }
      catch { throw new Error('No email app is set up on this phone. Use Email above.') }
      done('Opened in your email app — press Send there')
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }

  return (
    <>
      <Btn small={small} kind="ghost" label={label} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={st.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={st.shade} onPress={() => setOpen(false)} accessibilityLabel="Close" />
          <View style={st.sheet}>
            <Text style={st.title}>Send to the patient</Text>

            <View style={st.block}>
              {blocked ? (
                <>
                  <Note>{blocked}</Note>
                  <Btn kind="ghost" label="See your plan" onPress={() => { setOpen(false); router.push('/plan') }} />
                </>
              ) : short ? (
                <Note>WhatsApp: a message costs {rupees(options!.whatsapp_paise)} and your WhatsApp wallet has {rupees(options!.balance_paise)}. Email is free.</Note>
              ) : (
                <>
                  <Btn label={`WhatsApp${options ? ` · ${rupees(options.whatsapp_paise)}` : ''}`} busy={busy === 'whatsapp'} disabled={!!busy} onPress={viaWhatsApp} />
                  <Note>To the patient's mobile number.{options ? ` From your wallet (${rupees(options.balance_paise)} left); returned if it is not delivered.` : ''}</Note>
                </>
              )}
            </View>

            <View style={st.block}>
              <Field placeholder="Patient's email address" value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              <Btn kind="ghost" label="Email · free" busy={busy === 'email'} disabled={!!busy || !validEmail} onPress={viaEmail} />
              <Note>Sent by Sehatsandhi in your clinic's name. A reply comes to your clinic's email.</Note>
              <Btn kind="ghost" label="My own email app · free" busy={busy === 'own'} disabled={!!busy} onPress={viaOwnApp} />
              <Note>Opens your email app with the message written — it goes from your own address.</Note>
            </View>

            <Err msg={err} />
            <Btn kind="ghost" label="Close" onPress={() => setOpen(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  )
}

const st = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  shade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15,42,34,0.45)' },
  sheet: { backgroundColor: C.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28, gap: 12 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  block: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
})
