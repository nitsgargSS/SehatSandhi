import { useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useSession } from '../../lib/session'
import { searchPatients, registerPatient, type PatientSearchResult } from '@web/lib/patientsApi'
import { createOrder, getLabSettings, getPackages, getTests, type LabPackage, type LabTest } from '@web/lib/labApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// A lab order made at the desk — the website's Lab → New order
// (src/pages/doctor/LabPanel.tsx NewOrder), same functions: find or register
// the patient, pick tests and packages from the lab's own list, at the lab or
// at home (address, time, fee), urgent, referred by, notes. Then the order
// opens on its own screen.
const GENDERS: [string, string][] = [['male', 'Male'], ['female', 'Female'], ['other', 'Other']]
const rs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
const hourText = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`
const dayText = (d: Date, i: number) => i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

export default function NewLabOrder() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const [tests, setTests] = useState<LabTest[]>([])
  const [packages, setPackages] = useState<LabPackage[]>([])
  const [defaultFee, setDefaultFee] = useState(0)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PatientSearchResult[]>([])
  const [patient, setPatient] = useState<{ id: string; name: string; phone: string | null } | null>(null)
  const [reg, setReg] = useState<{ name: string; phone: string; age: string; gender: string } | null>(null)
  const [tq, setTq] = useState('')
  const [testIds, setTestIds] = useState<string[]>([])
  const [packageIds, setPackageIds] = useState<string[]>([])
  const [home, setHome] = useState(false)
  const [address, setAddress] = useState('')
  const [day, setDay] = useState<number | null>(null)
  const [hour, setHour] = useState<number | null>(null)
  const [fee, setFee] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [referredBy, setReferredBy] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!biz) return
    Promise.all([getTests(biz), getPackages(biz), getLabSettings(biz)]).then(([t, p, ls]) => {
      setTests(t.filter(x => x.is_active)); setPackages(p.filter(x => x.is_active))
      setDefaultFee(ls.homeFee); setFee(ls.homeFee ? String(ls.homeFee) : '')
    }).catch(e => setErr((e as Error).message))
  }, [biz])

  useEffect(() => {
    if (!biz || patient || reg || q.trim().length < 2) { setFound([]); return }
    const t = setTimeout(() => { searchPatients(q.trim(), biz).then(setFound).catch(() => setFound([])) }, 250)
    return () => clearTimeout(t)
  }, [q, biz, patient, reg])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d }), [])
  const shown = useMemo(() => {
    const w = tq.trim().toLowerCase()
    return w.length < 2 ? [] : tests.filter(t => t.name.toLowerCase().includes(w) && !testIds.includes(t.id)).slice(0, 12)
  }, [tq, tests, testIds])
  const chosen = tests.filter(t => testIds.includes(t.id))
  const inPackages = new Set(packages.filter(p => packageIds.includes(p.id)).flatMap(p => p.test_ids))

  const submit = async () => {
    setErr('')
    if (!patient && !reg) { setErr('Choose or register the patient.'); return }
    if (!testIds.length && !packageIds.length) { setErr('Add at least one test or package.'); return }
    if (home && !address.trim()) { setErr('Give the address for home collection.'); return }
    if ((day == null) !== (hour == null)) { setErr('Pick both the day and the time — or neither.'); return }
    setBusy(true)
    try {
      let memberId = patient?.id ?? ''
      if (!memberId && reg) {
        if (!reg.name.trim()) throw new Error('Enter the patient\'s name.')
        memberId = await registerPatient(biz, { fullName: reg.name.trim(), phone: reg.phone.trim(), relation: 'self',
          gender: reg.gender || undefined, ageYears: reg.age ? Number(reg.age) : null })
      }
      let slot: string | null = null
      if (day != null && hour != null) { const d = new Date(days[day]); d.setHours(hour, 0, 0, 0); slot = d.toISOString() }
      const id = await createOrder(biz, {
        memberId, testIds, packageIds, collection: home ? 'home' : 'lab', address: home ? address.trim() : undefined, slot,
        homeFee: home ? (fee === '' ? defaultFee : Number(fee)) : null, priority: urgent ? 'urgent' : 'routine',
        notes: notes.trim() || undefined, referredBy: referredBy.trim() || undefined,
      })
      router.replace({ pathname: '/laborder/[id]', params: { id } })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!tests.length) return <View style={{ padding: 20 }}><Note>{err || 'No tests set up yet — add them in Tests & packages first.'}</Note></View>

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <Card>
          <Label>Patient</Label>
          {patient ? (
            <View style={st.between}>
              <Text style={st.body}><Text style={st.b}>{patient.name}</Text>{patient.phone ? ` · ${patient.phone}` : ''}</Text>
              <Text style={st.link} onPress={() => setPatient(null)}>Change</Text>
            </View>
          ) : reg ? (
            <View style={{ gap: 6 }}>
              <Field label="Full name" value={reg.name} onChangeText={t => setReg({ ...reg, name: t })} autoFocus />
              <Field label="Mobile — 10 digits, or + country code" value={reg.phone} keyboardType="phone-pad" onChangeText={t => setReg({ ...reg, phone: t.replace(/[^\d+ ]/g, '') })} />
              <Field label="Age" value={reg.age} keyboardType="number-pad" onChangeText={t => setReg({ ...reg, age: t.replace(/\D/g, '').slice(0, 3) })} />
              <View style={st.row}>{GENDERS.map(([k, l]) => <Chip key={k} label={l} on={reg.gender === k} onPress={() => setReg({ ...reg, gender: k })} />)}</View>
              <Text style={st.link} onPress={() => setReg(null)}>← Search instead</Text>
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <Field placeholder="Name, mobile or file number" value={q} onChangeText={setQ} autoCorrect={false} />
              {found.slice(0, 8).map(p => (
                <Pressable key={p.patient_member_id} style={st.pick} onPress={() => { setPatient({ id: p.patient_member_id, name: p.full_name, phone: p.phone }); setFound([]) }}>
                  <Text style={st.body}><Text style={st.b}>{p.full_name}</Text>{p.age_years != null ? ` · ${p.age_years}y` : ''}{p.phone ? ` · ${p.phone}` : ''}</Text>
                </Pressable>
              ))}
              <Text style={st.link} onPress={() => setReg({ name: q.replace(/\d/g, '').trim(), phone: q.replace(/\D/g, ''), age: '', gender: '' })}>+ New patient</Text>
            </View>
          )}
        </Card>

        <Card>
          <Label>Tests & packages</Label>
          {!!packages.length && <View style={st.row}>{packages.map(p => (
            <Chip key={p.id} label={`${p.name} · ${rs(p.price)}`} on={packageIds.includes(p.id)}
              onPress={() => setPackageIds(x => x.includes(p.id) ? x.filter(y => y !== p.id) : [...x, p.id])} />
          ))}</View>}
          <Field placeholder="Add a test — type its name (CBC, sugar, thyroid…)" value={tq} onChangeText={setTq} autoCorrect={false} />
          {shown.map(t => (
            <Pressable key={t.id} style={st.pick} onPress={() => { setTestIds(x => [...x, t.id]); setTq('') }}>
              <Text style={st.body}>{t.name} <Text style={st.meta}>· {rs(t.price)}</Text></Text>
            </Pressable>
          ))}
          {!!chosen.length && <View style={st.row}>{chosen.map(t => (
            <Chip key={t.id} on label={`✕ ${t.name}${inPackages.has(t.id) ? ' (in package)' : ''}`} onPress={() => setTestIds(x => x.filter(y => y !== t.id))} />
          ))}</View>}
        </Card>

        <Card>
          <View style={st.row}>
            <Chip label="🏥 At the lab" on={!home} onPress={() => setHome(false)} />
            <Chip label="🏠 At home" on={home} onPress={() => setHome(true)} />
          </View>
          {home && <Field label="Address for collection" value={address} onChangeText={setAddress} multiline />}
          <Text style={st.meta}>{home ? 'When to come' : 'Appointment time (optional)'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row}>
            {days.map((d, i) => <Chip key={i} label={dayText(d, i)} on={day === i} onPress={() => setDay(day === i ? null : i)} />)}
          </ScrollView>
          {day != null && <View style={st.row}>{HOURS.filter(h => day > 0 || h > new Date().getHours()).map(h =>
            <Chip key={h} label={hourText(h)} on={hour === h} onPress={() => setHour(hour === h ? null : h)} />)}</View>}
          {home && <Field label="Home collection fee (₹)" value={fee} keyboardType="number-pad" onChangeText={t => setFee(t.replace(/\D/g, ''))} />}
        </Card>

        <Card>
          <Field label="Referred by (doctor)" value={referredBy} onChangeText={setReferredBy} />
          <Field label="Notes (fasting, etc.)" value={notes} onChangeText={setNotes} />
          <View style={st.row}><Chip label="⚡ Urgent" on={urgent} onPress={() => setUrgent(!urgent)} /></View>
        </Card>

        <Err msg={err} />
        <Btn label="Create order" busy={busy} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  body: { fontSize: 14.5, color: C.ink },
  b: { fontWeight: '800' },
  meta: { fontSize: 12.5, color: C.muted },
  link: { color: C.green, fontWeight: '700' },
  pick: { paddingVertical: 9, paddingHorizontal: 10, backgroundColor: '#f4f8f6', borderRadius: 8 },
})
