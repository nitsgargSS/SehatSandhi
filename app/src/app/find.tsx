import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '../lib/supabase'
import { understand, asPlace } from '../lib/assistant'
import { whereAmI, me, requestCode, verifyCode, bookAppointment, type Me, type Booked } from '../lib/patient'
import { registerPush } from '../lib/push'
import { SPECIALITIES, WA_NUMBER } from '@web/types'
import { C } from '../ui/theme'

// "Find a doctor" — what the WhatsApp bot does (speciality → area → doctor →
// time) but in conversation: say it any way, in English or Hindi, and it asks
// only for what is missing. Searching needs no login. Booking happens right
// here (0198): the patient proves their number once with a WhatsApp code, and
// the app books on it — the same open slots the bot and the clinic desk use.
// Medicines, ambulance and insurance go to the app's own screens, not WhatsApp.

type Doc = {
  practitioner_id: string; full_name: string; qualification: string | null; business_id: string
  business_name: string; address: string | null; consultation_fee: number | null; nearby: boolean; area: string | null
  slots: string[]; slotDay: number; code: string | null; phone: string | null
}
type Msg =
  | { id: number; from: 'me' | 'bot'; text: string; chips?: { label: string; say: string }[] }
  | { id: number; from: 'bot'; doctors: Doc[]; dayLabel: string }
  | { id: number; from: 'bot'; book: { doc: Doc; slot: string } }

// Omit that keeps each kind of message separate (plain Omit merges the union).
type NewMsg = Msg extends infer M ? M extends unknown ? Omit<M, 'id'> : never : never

// Every kind of doctor we list (the tests, labs and pharmacy have their own paths).
const NOT_DOCTORS = ['LAB', 'PATH', 'RAD', 'PHARMACY']
const DOCTORS = SPECIALITIES.filter(s => !NOT_DOCTORS.includes(s.id)).map(s => s.id)
const spName = (id?: string) => SPECIALITIES.find(s => s.id === id)
const spChip = (id: string) => ({ label: spName(id)!.en.split(' (')[0], say: spName(id)!.en })
const istDate = (plusDays: number) => new Date(Date.now() + 5.5 * 3_600_000 + plusDays * 86_400_000).toISOString().slice(0, 10)
const DAY_WORD = ['today', 'tomorrow', 'day after tomorrow']
const slotText = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const timeText = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const KEY = 'sehat:lastArea'
const remember = (v: { pin: string; label: string }) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* fine */ } }
const recall = (): { pin: string; label: string } | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } }

export default function Find() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ctx = useRef<{ speciality?: string; pin?: string; area?: string; day: number }>({ day: 0 })
  const scroll = useRef<ScrollView>(null)
  const n = useRef(0)
  const push = (m: NewMsg) => setMsgs(x => [...x, { ...m, id: ++n.current } as Msg])
  const bot = (t: string, chips?: { label: string; say: string }[]) => push({ from: 'bot', text: t, chips })

  useEffect(() => {
    const last = recall()
    if (last) { ctx.current.pin = last.pin; ctx.current.area = last.label }
    bot('Namaste! Tell me what you need — for example "aankh ka doctor", "bachche ko bukhar", or "dentist in Delhi kal". Or pick a doctor:',
      DOCTORS.map(spChip))
  }, [])

  const placeToPin = async (place: string): Promise<{ pin: string; label: string } | null> => {
    const { data } = await supabase.rpc('sehat_area_search', { p_q: place, p_state: null })
    const r = data as { found?: boolean; label?: string; pin_code?: string | null; districts?: { district: string; pincodes: { pin: string; live: boolean }[] }[] } | null
    if (!r?.found) return null
    const pin = r.pin_code ?? r.districts?.[0]?.pincodes?.find(p => p.live)?.pin ?? r.districts?.[0]?.pincodes?.[0]?.pin
    return pin ? { pin, label: r.label ?? place } : null
  }

  const search = async () => {
    const { speciality, pin, area } = ctx.current
    if (!speciality || !pin) return
    const { data, error } = await supabase.rpc('sehat_find_doctors', { p_speciality: speciality, p_pin_code: pin })
    if (error) { bot('Sorry, the search did not work just now. Please try again.'); return }
    // One card per doctor per clinic (the search can return a doctor once per branch).
    const seen = new Set<string>()
    const found = ((data ?? []) as Omit<Doc, 'slots' | 'slotDay' | 'code' | 'phone'>[])
      .filter(d => { const k = `${d.practitioner_id}|${d.business_id}`; if (seen.has(k)) return false; seen.add(k); return true })
      .slice(0, 6)
    if (!found.length) {
      bot(`No ${spName(speciality)?.en ?? 'doctor'} is listed near ${area ?? pin} yet. Try a nearby town, or another kind of doctor.`,
        DOCTORS.filter(c => c !== speciality).slice(0, 6).map(spChip))
      return
    }
    const ids = [...new Set(found.map(d => d.business_id))]
    const { data: biz } = await supabase.from('businesses').select('id, qr_code, phone').in('id', ids)
    const bmap = new Map(((biz ?? []) as { id: string; qr_code: string | null; phone: string | null }[]).map(b => [b.id, b]))
    // Open slots on the asked day; with none, the next day that has some (up to 3 days on).
    const docs: Doc[] = await Promise.all(found.map(async d => {
      for (let k = ctx.current.day; k <= Math.max(ctx.current.day, 2); k++) {
        const { data: w } = await supabase.rpc('sehat_open_windows', { p_business_id: d.business_id, p_date: istDate(k), p_practitioner_id: d.practitioner_id })
        const now = Date.now()
        const slots = ((w ?? []) as { window_start: string; seats_left: number }[])
          .filter(x => x.seats_left > 0 && new Date(x.window_start).getTime() > now + 15 * 60_000).map(x => x.window_start).slice(0, 6)
        if (slots.length) return { ...d, slots, slotDay: k, code: bmap.get(d.business_id)?.qr_code ?? null, phone: bmap.get(d.business_id)?.phone ?? null }
      }
      return { ...d, slots: [], slotDay: ctx.current.day, code: bmap.get(d.business_id)?.qr_code ?? null, phone: bmap.get(d.business_id)?.phone ?? null }
    }))
    push({ from: 'bot', doctors: docs, dayLabel: DAY_WORD[ctx.current.day] })
    bot('Tap a time to book it. Want another day?', [
      { label: 'Today', say: 'today' }, { label: 'Tomorrow', say: 'tomorrow' }, { label: 'Day after', say: 'parso' },
    ])
  }

  const handle = async (said: string) => {
    if (!said.trim()) return
    push({ from: 'me', text: said })
    setBusy(true)
    try {
      const u = understand(said)
      // Medicines, ambulance and insurance have their own screens in the app.
      if (u.other === 'pharmacy') {
        bot('Medicines can be delivered home from a pharmacy near you. Send a photo of the prescription or type the medicine names — a pharmacy tells you the total, and nothing is sent until you approve it.',
          [{ label: '💊 Order medicines', say: '__go__/me/order' }])
        return
      }
      if (u.other === 'ambulance') {
        bot('In an emergency call 108 now — it is free. You can also alert private ambulances near you: the first to accept calls you.',
          [{ label: '📞 Call 108', say: '__tel__108' }, { label: '🚑 Ambulance near me', say: '__go__/me/ambulance' }])
        return
      }
      if (u.other === 'insurance') {
        bot('A licensed health insurance advisor near you can call you back. Only the advisor who takes your request gets your number.',
          [{ label: '🛡️ Ask for an advisor', say: '__go__/me/insurance' }])
        return
      }
      if (u.other) {
        // Lab tests are not bookable in the app yet; the WhatsApp assistant finds labs.
        bot('For a lab test, our WhatsApp assistant finds the nearest lab for you right away.',
          [{ label: 'Find a lab on WhatsApp', say: `__wa__Hi, I need a lab test${ctx.current.area ? ` near ${ctx.current.area}` : ''}` }])
        return
      }
      if (u.speciality) ctx.current.speciality = u.speciality
      if (u.day !== undefined) ctx.current.day = u.day
      if (u.pin) { ctx.current.pin = u.pin; ctx.current.area = u.pin }
      const placeWord = u.place ?? u.guess ?? (!u.speciality && !u.pin && u.day === undefined ? asPlace(said).place : undefined)
      if (placeWord) {
        const hit = await placeToPin(placeWord)
        if (hit) { ctx.current.pin = hit.pin; ctx.current.area = hit.label }
        else if (u.place || (!u.speciality && !u.guess)) { bot(`I could not find "${placeWord}". Type the PIN code (6 digits) or a nearby town.`); return }
      }
      if (u.pin || ctx.current.pin) remember({ pin: ctx.current.pin!, label: ctx.current.area ?? ctx.current.pin! })
      if (!ctx.current.speciality) {
        bot('Which kind of doctor? You can also just describe the problem.', DOCTORS.map(spChip))
        return
      }
      if (!ctx.current.pin) {
        bot(`${spName(ctx.current.speciality)?.en} — got it. Which area? Type your PIN code or town.`)
        return
      }
      bot(`Looking for ${spName(ctx.current.speciality)?.en} near ${ctx.current.area ?? ctx.current.pin}, ${DAY_WORD[ctx.current.day]}…`)
      await search()
    } finally {
      setBusy(false)
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 200)
    }
  }

  const tapChip = (say: string) => {
    if (say.startsWith('__tel__')) { Linking.openURL(`tel:${say.slice(7)}`); return }
    if (say.startsWith('__go__')) { router.push(say.slice(6) as '/me/order'); return }
    if (say.startsWith('__wa__')) { Linking.openURL(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(say.slice(6))}`); return }
    handle(say)
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroll} contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {msgs.map(m => {
          if ('doctors' in m) return (
            <View key={m.id} style={{ gap: 10 }}>
              {m.doctors.map(d => (
                <View key={`${d.practitioner_id}-${d.business_id}`} style={st.doc}>
                  <Text style={st.docName}>{d.full_name}</Text>
                  {!!d.qualification && <Text style={st.meta}>{d.qualification}</Text>}
                  <Text style={st.clinic}>{d.business_name}{d.area ? ` · ${d.area}` : ''}{d.nearby ? '' : ' · in your district'}</Text>
                  {!!d.address && <Text style={st.meta} numberOfLines={2}>{d.address}</Text>}
                  {d.consultation_fee != null && d.consultation_fee > 0 && <Text style={st.meta}>Fee ₹{d.consultation_fee}</Text>}
                  {d.slots.length ? (
                    <>
                      <Text style={st.slotHead}>Open {d.slotDay === m.doctors[0].slotDay && d.slotDay === ctx.current.day ? DAY_WORD[d.slotDay] : DAY_WORD[d.slotDay]}:</Text>
                      <View style={st.chips}>
                        {d.slots.map(sl => (
                          <Pressable key={sl} style={st.slot} onPress={() => push({ from: 'bot', book: { doc: d, slot: sl } })}>
                            <Text style={st.slotText}>{timeText(sl)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : (
                    <Text style={st.meta}>No open times in the next 3 days.{d.phone ? ' ' : ''}{!!d.phone && <Text style={st.link} onPress={() => Linking.openURL(`tel:${d.phone}`)}>Call the clinic</Text>}</Text>
                  )}
                </View>
              ))}
            </View>
          )
          if ('book' in m) return <BookCard key={m.id} doc={m.book.doc} slot={m.book.slot} />
          return (
            <View key={m.id} style={{ gap: 6, alignItems: m.from === 'me' ? 'flex-end' : 'flex-start' }}>
              <View style={[st.bubble, m.from === 'me' ? st.meB : st.botB]}>
                <Text style={m.from === 'me' ? st.meT : st.botT}>{m.text}</Text>
              </View>
              {!!m.chips?.length && (
                <View style={st.chips}>
                  {m.chips.map(c => (
                    <Pressable key={c.label} style={st.chip} onPress={() => tapChip(c.say)}><Text style={st.chipT}>{c.label}</Text></Pressable>
                  ))}
                </View>
              )}
            </View>
          )
        })}
        {busy && <Text style={st.meta}>…</Text>}
      </ScrollView>
      <View style={st.bar}>
        {/* 0196: the PIN from where the phone is, instead of typing it */}
        <Pressable style={st.send} accessibilityLabel="Use my location"
          onPress={() => whereAmI().then(p => p.pin ? handle(p.pin) : bot('I could not find your PIN code from your location. Please type it.')).catch(e => bot((e as Error).message))}>
          <Text style={st.sendT}>📍</Text></Pressable>
        <TextInput style={st.input} placeholder="Type here — any language" value={text} onChangeText={setText}
          onSubmitEditing={() => { const t = text; setText(''); handle(t) }} returnKeyType="send" />
        <Pressable style={st.send} onPress={() => { const t = text; setText(''); handle(t) }}><Text style={st.sendT}>Send</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

// Confirm a time: who it is for, then book. Signs the patient in first if needed.
function BookCard({ doc, slot }: { doc: Doc; slot: string }) {
  const [who, setWho] = useState<Me | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [dev, setDev] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Booked | null>(null)

  useEffect(() => { me().then(m => { setWho(m); if (m?.name) setName(m.name) }).catch(() => setWho(null)) }, [])

  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const send = () => run(async () => { const r = await requestCode(phone); setSent(true); setDev(r.devCode ?? '') })
  const verify = () => run(async () => {
    await supabase.auth.signOut().catch(() => {})
    await verifyCode(phone, code)
    registerPush().catch(() => {})
    const m = await me(); setWho(m); if (m?.name && !name) setName(m.name)
  })
  const book = () => run(async () => {
    const a = age.trim() ? Number(age.replace(/\D/g, '')) : null
    setDone(await bookAppointment(doc.business_id, doc.practitioner_id, slot, name, a))
  })

  if (done) return (
    <View style={[st.bubble, st.botB, { borderColor: C.green, borderWidth: 2 }]}>
      <Text style={st.okT}>✅ Booked</Text>
      <Text style={st.botT}>{done.name} · {done.doctor ?? doc.full_name}{'\n'}{done.clinic}{'\n'}{slotText(done.at)}</Text>
      {!!done.address && <Text style={st.meta}>{done.address}</Text>}
      <Text style={st.small}>Please arrive 10 minutes early. The clinic has your booking.</Text>
      <Pressable style={st.primary} onPress={() => router.push('/me')}><Text style={st.primaryT}>See my bookings</Text></Pressable>
      {!!done.phone && <Pressable onPress={() => Linking.openURL(`tel:${done.phone}`)}><Text style={st.link}>Call the clinic</Text></Pressable>}
    </View>
  )

  return (
    <View style={[st.bubble, st.botB]}>
      <Text style={st.botT}>{doc.full_name}, {doc.business_name}{'\n'}<Text style={{ fontWeight: '800' }}>{slotText(slot)}</Text></Text>
      {who === undefined ? <ActivityIndicator color={C.green} /> : !who ? (
        <>
          <Text style={st.small}>To book, confirm your mobile number once — we send a code on WhatsApp.</Text>
          <TextInput style={st.field} placeholder="Mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={!sent} />
          {!sent ? (
            <Pressable style={[st.primary, (busy || phone.replace(/\D/g, '').length < 10) && st.off]} disabled={busy || phone.replace(/\D/g, '').length < 10} onPress={send}>
              <Text style={st.primaryT}>{busy ? '…' : 'Send code'}</Text></Pressable>
          ) : (
            <>
              <TextInput style={st.field} placeholder="6-digit code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
              {!!dev && <Text style={st.small}>Test mode: your code is {dev}</Text>}
              <Pressable style={[st.primary, (busy || code.length !== 6) && st.off]} disabled={busy || code.length !== 6} onPress={verify}>
                <Text style={st.primaryT}>{busy ? '…' : 'Confirm number'}</Text></Pressable>
              <Pressable onPress={() => { setSent(false); setCode('') }}><Text style={st.link}>Change number</Text></Pressable>
            </>
          )}
        </>
      ) : (
        <>
          <Text style={st.small}>Booking on +{who.phone}. Who is the patient?</Text>
          <TextInput style={st.field} placeholder="Patient's name" value={name} onChangeText={setName} />
          <TextInput style={st.field} placeholder="Age (optional)" keyboardType="number-pad" maxLength={3} value={age} onChangeText={setAge} />
          <Pressable style={[st.primary, (busy || !name.trim()) && st.off]} disabled={busy || !name.trim()} onPress={book}>
            <Text style={st.primaryT}>{busy ? 'Booking…' : 'Confirm booking'}</Text></Pressable>
        </>
      )}
      {!!err && <Text style={st.err}>{err}</Text>}
      {!!doc.phone && <Pressable onPress={() => Linking.openURL(`tel:${doc.phone}`)}><Text style={st.link}>Call the clinic</Text></Pressable>}
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 20 },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  botB: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignSelf: 'flex-start', gap: 8 },
  meB: { backgroundColor: C.green },
  botT: { color: C.ink, fontSize: 15 },
  meT: { color: '#fff', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: C.green, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipT: { color: C.green, fontWeight: '700', fontSize: 13 },
  doc: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 3 },
  docName: { fontSize: 16.5, fontWeight: '800', color: C.ink },
  clinic: { fontSize: 14, color: C.ink, fontWeight: '600' },
  meta: { fontSize: 13, color: C.muted },
  slotHead: { fontSize: 12.5, fontWeight: '700', color: C.muted, marginTop: 6 },
  slot: { backgroundColor: '#eaf7f0', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  slotText: { color: C.green, fontWeight: '800' },
  primary: { backgroundColor: C.green, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  off: { opacity: 0.5 },
  field: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, minWidth: 240 },
  okT: { fontSize: 17, fontWeight: '800', color: C.green },
  err: { color: '#b42318', fontSize: 13 },
  link: { color: C.green, fontWeight: '700', textAlign: 'center' },
  small: { fontSize: 12, color: C.muted },
  bar: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card },
  input: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  send: { backgroundColor: C.green, borderRadius: 20, paddingHorizontal: 16, justifyContent: 'center' },
  sendT: { color: '#fff', fontWeight: '800' },
})
