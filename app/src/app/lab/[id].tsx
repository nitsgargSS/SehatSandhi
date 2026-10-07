import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { me } from '../../lib/patient'
import { SignIn } from '../../ui/PatientGate'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// Book lab tests (0207): the lab's tests and packages with prices, the sample
// taken at the lab or at home, one of the lab's open times — then the order.
// It is booked as an appointment (in the lab's Bookings) with the order linked;
// the patient pays the lab, and the report arrives in My records. A lab that
// has not listed its prices yet still takes the booking with a note of the
// tests. Signing in (WhatsApp code) is asked for only at the end.
interface Test { id: string; name: string; category: string | null; sample: string | null; price: number; hours: number | null }
interface Pack { id: string; name: string; description: string | null; price: number; tests: string[] }
interface Menu { id: string; name: string; address: string | null; phone: string | null; area: string | null; home_fee: number; tests: Test[]; packages: Pack[] }
interface Done { order_no: string | null; lab: string; address: string | null; phone: string | null; at: string; collection: 'lab' | 'home'; tests: string; total: number | null }

// What a search box should start with for the matcher's test hint (0201).
const HINT_WORDS: Record<string, string> = {
  sugar: 'sugar', thyroid: 'thyroid', cbc: 'blood count', urine: 'urine', xray: 'x-ray', ultrasound: 'ultrasound',
  mri: 'mri', ct: 'ct scan', lipid: 'lipid', lft: 'liver', kft: 'kidney', blood: '',
}
const CATS: [string, string][] = [['', 'All'], ['pathology', 'Blood & urine'], ['radiology', 'Scans & X-ray'], ['cardiology', 'Heart'], ['other', 'Other']]
const istDate = (plus: number) => new Date(Date.now() + 5.5 * 3_600_000 + plus * 86_400_000).toISOString().slice(0, 10)
const DAYS = ['Today', 'Tomorrow', 'Day after']
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const rs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function LabBooking() {
  const { id, hint } = useLocalSearchParams<{ id: string; hint?: string }>()
  const [menu, setMenu] = useState<Menu | null | undefined>(undefined)
  const [q, setQ] = useState(HINT_WORDS[hint ?? ''] ?? '')
  const [kind, setKind] = useState('')
  const [tests, setTests] = useState<string[]>([])
  const [packs, setPacks] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [where, setWhere] = useState<'lab' | 'home'>('lab')
  const [address, setAddress] = useState('')
  const [day, setDay] = useState(0)
  const [slots, setSlots] = useState<string[] | null>(null)
  const [slot, setSlot] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [signIn, setSignIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Done | null>(null)

  useEffect(() => {
    supabase.rpc('sehat_lab_menu', { p_business: id }).then(({ data }) => {
      const m = data as Menu | null
      setMenu(m ? { ...m, home_fee: Number(m.home_fee), tests: m.tests.map(t => ({ ...t, price: Number(t.price) })), packages: m.packages.map(p => ({ ...p, price: Number(p.price) })) } : null)
    })
    me().then(m => { if (m?.name) setName(m.name) }).catch(() => {})
  }, [id])

  useEffect(() => {
    setSlots(null); setSlot(null)
    supabase.rpc('sehat_open_windows', { p_business_id: id, p_date: istDate(day), p_practitioner_id: null }).then(({ data }) => {
      const soon = Date.now() + 30 * 60_000
      setSlots(((data ?? []) as { window_start: string; seats_left: number }[])
        .filter(w => w.seats_left > 0 && new Date(w.window_start).getTime() > soon).map(w => w.window_start))
    })
  }, [id, day])

  const hasMenu = !!menu && (menu.tests.length > 0 || menu.packages.length > 0)
  const shown = useMemo(() => (menu?.tests ?? []).filter(t => (!kind || t.category === kind)
    && (!q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()))), [menu, kind, q])
  const total = (menu?.packages ?? []).filter(p => packs.includes(p.id)).reduce((a, p) => a + p.price, 0)
    + (menu?.tests ?? []).filter(t => tests.includes(t.id)).reduce((a, t) => a + t.price, 0)
    + (where === 'home' ? menu?.home_fee ?? 0 : 0)

  const book = async () => {
    setErr('')
    if (hasMenu && !tests.length && !packs.length) { setErr('Choose at least one test or package.'); return }
    if (!hasMenu && !note.trim()) { setErr('Write which tests you need.'); return }
    if (where === 'home' && !address.trim()) { setErr('Give the address for the sample collection.'); return }
    if (!slot) { setErr('Choose a time.'); return }
    if (!name.trim()) { setErr('Enter the patient\'s name.'); return }
    if (!(await me())) { setSignIn(true); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('sehat_app_lab_order', {
      p_business: id, p_tests: tests, p_packages: packs, p_collection: where, p_slot: slot,
      p_name: name.trim(), p_age: age ? Number(age) : null, p_address: where === 'home' ? address.trim() : null,
      p_note: hasMenu ? null : note.trim(),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setDone(data as Done)
  }

  if (menu === undefined) return <View style={st.center}><ActivityIndicator color={C.green} /></View>
  if (menu === null) return <View style={st.center}><Note>This lab is not taking bookings in the app just now.</Note></View>
  if (signIn) return <SignIn why="Sign in with your mobile number to book — the lab will call you on it." onDone={() => { setSignIn(false); book() }} />

  if (done) return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Card style={{ borderColor: C.green }}>
        <Text style={st.big}>✓ Booked{done.order_no ? ` · ${done.order_no}` : ''}</Text>
        <Text style={st.body}>{done.tests}</Text>
        <Text style={st.body}>{done.collection === 'home' ? '🏠 Sample collected at home' : '🏥 Sample at the lab'} · {when(done.at)}</Text>
        <Text style={st.body}>{done.lab}{done.address ? `, ${done.address}` : ''}</Text>
        {done.total != null && done.total > 0 && <Text style={st.body}>Total {rs(done.total)} — pay the lab {done.collection === 'home' ? 'or the person who collects the sample' : 'at the counter'}.</Text>}
        {done.order_no == null && <Note>The lab will confirm the tests and the price.</Note>}
        <Note>Your report will appear in My Sehatsandhi → Records when it is ready. To change or cancel, use My requests.</Note>
        <View style={st.row}>
          {!!done.phone && <Btn small kind="ghost" label="📞 Call the lab" onPress={() => Linking.openURL(`tel:${done.phone}`)} />}
          <Btn small label="My requests" onPress={() => router.replace('/me/requests')} />
        </View>
      </Card>
    </ScrollView>
  )

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={st.big}>{menu.name}</Text>
        {!!(menu.address || menu.area) && <Text style={st.meta}>{menu.address ?? menu.area}</Text>}
        {!!menu.phone && <Text style={st.link} onPress={() => Linking.openURL(`tel:${menu.phone}`)}>📞 {menu.phone}</Text>}
      </Card>

      {hasMenu ? (
        <>
          {menu.packages.length > 0 && (
            <Card>
              <Label>Packages</Label>
              {menu.packages.map(p => {
                const on = packs.includes(p.id)
                return (
                  <Pressable key={p.id} style={[st.pack, on && st.packOn]} onPress={() => setPacks(x => on ? x.filter(i => i !== p.id) : [...x, p.id])}>
                    <View style={st.between}><Text style={st.name}>{on ? '✓ ' : ''}{p.name}</Text><Text style={st.price}>{rs(p.price)}</Text></View>
                    {!!p.description && <Text style={st.meta}>{p.description}</Text>}
                    <Text style={st.meta} numberOfLines={3}>{p.tests.length} tests: {p.tests.join(', ')}</Text>
                  </Pressable>
                )
              })}
            </Card>
          )}
          {menu.tests.length > 0 && (
            <Card>
              <Label>Tests</Label>
              <Field placeholder="Search — e.g. sugar, thyroid, x-ray" value={q} onChangeText={setQ} autoCorrect={false} />
              <View style={st.row}>{CATS.map(([k, l]) => <Chip key={k} label={l} on={kind === k} onPress={() => setKind(k)} />)}</View>
              {shown.slice(0, 60).map(t => {
                const on = tests.includes(t.id)
                return (
                  <Pressable key={t.id} style={st.test} onPress={() => setTests(x => on ? x.filter(i => i !== t.id) : [...x, t.id])}>
                    <Text style={[st.box, on && st.boxOn]}>{on ? '✓' : ''}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={st.body}>{t.name}</Text>
                      {!!(t.sample || t.hours) && <Text style={st.meta}>{[t.sample, t.hours ? `report in ~${t.hours} h` : null].filter(Boolean).join(' · ')}</Text>}
                    </View>
                    <Text style={st.price}>{rs(t.price)}</Text>
                  </Pressable>
                )
              })}
              {!shown.length && <Note>No test by that name here — clear the search to see all.</Note>}
            </Card>
          )}
        </>
      ) : (
        <Card>
          <Label>Which tests do you need?</Label>
          <Note>This lab has not listed its prices in the app yet — write the tests (or what the doctor wrote) and the lab confirms the price.</Note>
          <Field value={note} onChangeText={setNote} multiline placeholder="e.g. Sugar fasting, thyroid, CBC" />
        </Card>
      )}

      <Card>
        <Label>Where should the sample be taken?</Label>
        <View style={st.row}>
          <Chip label="🏥 At the lab" on={where === 'lab'} onPress={() => setWhere('lab')} />
          <Chip label={`🏠 At home${menu.home_fee > 0 ? ` (+${rs(menu.home_fee)})` : ' (free)'}`} on={where === 'home'} onPress={() => setWhere('home')} />
        </View>
        {where === 'home' && <Field label="Address for the collection" value={address} onChangeText={setAddress} multiline placeholder="House, street, landmark, area" />}
        <Label>{where === 'home' ? 'When should they come?' : 'When will you come?'}</Label>
        <View style={st.row}>{DAYS.map((d, i) => <Chip key={d} label={d} on={day === i} onPress={() => setDay(i)} />)}</View>
        {slots === null ? <Note>Loading times…</Note> : slots.length === 0 ? <Note>No open times that day — try another day, or call the lab.</Note> : (
          <View style={st.row}>{slots.slice(0, 24).map(s => <Chip key={s} label={time(s)} on={slot === s} onPress={() => setSlot(s)} />)}</View>
        )}
      </Card>

      <Card>
        <Label>Who is it for?</Label>
        <View style={st.row}>
          <View style={{ flex: 2 }}><Field label="Name" value={name} onChangeText={setName} /></View>
          <View style={{ flex: 1 }}><Field label="Age" value={age} keyboardType="number-pad" onChangeText={t => setAge(t.replace(/\D/g, '').slice(0, 3))} /></View>
        </View>
      </Card>

      <Err msg={err} />
      <Btn label={hasMenu ? `Book${total > 0 ? ` · ${rs(total)}` : ''}` : 'Book the visit'} busy={busy} onPress={book} />
      <Note>You pay the lab — at the counter, or the person who collects the sample.</Note>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  big: { fontSize: 19, fontWeight: '800', color: C.ink },
  name: { fontSize: 15, fontWeight: '800', color: C.ink, flexShrink: 1 },
  body: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  link: { color: C.green, fontWeight: '700' },
  price: { fontSize: 14.5, fontWeight: '800', color: C.ink },
  pack: { borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10, gap: 3 },
  packOn: { borderColor: C.green, backgroundColor: '#eef8f3' },
  test: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#f0ebe1' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.border, textAlign: 'center', color: '#fff', fontWeight: '900' },
  boxOn: { backgroundColor: C.green, borderColor: C.green },
})
