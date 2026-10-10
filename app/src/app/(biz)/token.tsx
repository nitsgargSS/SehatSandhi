import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSession } from '../../lib/session'
import { searchPatients, registerPatient, type PatientSearchResult } from '@web/lib/patientsApi'
import { FEE_PAID_OPTIONS, opdVisit, patientHistory } from '@web/lib/queueApi'
import { printOpdSlip } from '../../lib/printSlip'
import { listBusinessDoctors, type BusinessDoctor } from '@web/lib/doctorsApi'
import { setAppointmentStatus } from '@web/lib/appointmentApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// The front desk on a phone — the website's "Who is it for?" (src/pages/doctor/
// Queue.tsx): find the patient or register them, choose the doctor (a returning
// patient goes back to the one they last saw), the reason, the OPD fee — full,
// discounted or free, below full needs a reason (0135) — and out of turn only
// with a reason. sehat_opd_visit issues the token and adds the fee to the bill.
// Opened from Bookings → Arrived, it comes with the booking's name, phone, age
// and doctor; the token given, the booking is marked completed.
const GENDERS: [string, string][] = [['male', 'Male'], ['female', 'Female'], ['other', 'Other']]
type Fee = { mode: 'full' | 'discount' | 'free'; price: string; reason: string }
const fullFee = (d?: BusinessDoctor | null) => d ? (d.discounted_fee ?? d.consultation_fee ?? 0) : 0
const rs = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function NewToken() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const pre = useLocalSearchParams<{ name?: string; phone?: string; age?: string; doctor?: string; appointment?: string }>()
  const [doctors, setDoctors] = useState<BusinessDoctor[]>([])
  // A booking arriving: look them up by the booked number first.
  const [q, setQ] = useState(pre.phone ? pre.phone.replace(/\D/g, '').slice(-10) : '')
  const [rows, setRows] = useState<PatientSearchResult[]>([])
  const [picked, setPicked] = useState<{ id: string; name: string; phone: string | null } | null>(null)
  const [adding, setAdding] = useState(false)
  const [np, setNp] = useState({ name: '', phone: '', age: '', gender: '', pin: '' })
  const [doctor, setDoctor] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [fee, setFee] = useState<Fee>({ mode: 'full', price: '', reason: '' })
  const [outOfTurn, setOutOfTurn] = useState(false)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [issued, setIssued] = useState<{ token: number; name: string; doctor: string; fee: number; paid: number; member: string; queue: string } | null>(null)
  // 0226: how the fee was paid — asked once, kept for the next patient.
  const [paidHow, setPaidHow] = useState('')

  useEffect(() => {
    if (!biz) return
    listBusinessDoctors(biz).then(d => {
      setDoctors(d)
      // A doctor giving a token defaults to themselves; one doctor, nothing to pick.
      setDoctor(cur => cur ?? (pre.doctor && d.some(x => x.practitioner_id === pre.doctor) ? pre.doctor : s?.doctorId && d.some(x => x.practitioner_id === s.doctorId) ? s.doctorId : d.length === 1 ? d[0].practitioner_id : null))
    }).catch(e => setErr((e as Error).message))
  }, [biz])

  useEffect(() => {
    if (!biz || picked || q.trim().length < 2) { setRows([]); return }
    const t = setTimeout(() => { searchPatients(q.trim(), biz).then(setRows).catch(() => setRows([])) }, 250)
    return () => clearTimeout(t)
  }, [q, biz, picked])

  const choose = (id: string, name: string, phone: string | null) => {
    setPicked({ id, name, phone }); setErr('')
    // A returning patient goes back to the doctor they last saw.
    if (doctors.length > 1) patientHistory(biz, id).then(h => {
      const last = h.find(r => r.doctor_id && doctors.some(d => d.practitioner_id === r.doctor_id))
      if (last) setDoctor(last.doctor_id)
    }).catch(() => {})
  }

  const register = async () => {
    setErr('')
    if (!np.name.trim()) { setErr('Enter the patient\'s name.'); return }
    if (np.pin && np.pin.length !== 6) { setErr('A PIN code is 6 digits — or leave it empty.'); return }
    setBusy(true)
    try {
      const id = await registerPatient(biz, {
        fullName: np.name.trim(), phone: np.phone.trim(), relation: 'self',
        gender: np.gender || undefined, ageYears: np.age ? Number(np.age) : null,
        pinCode: np.pin.length === 6 ? np.pin : undefined,
      })
      choose(id, np.name.trim(), np.phone.trim())
      setAdding(false); setNp({ name: '', phone: '', age: '', gender: '', pin: '' })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const doc = doctors.find(d => d.practitioner_id === doctor) ?? null
  const full = fullFee(doc)

  const give = async () => {
    setErr('')
    if (!picked) return
    if (doctors.length > 1 && !doctor) { setErr('Choose which doctor this token is for.'); return }
    if (outOfTurn && !why.trim()) { setErr('Say why this token goes out of turn.'); return }
    if (full > 0 && fee.mode !== 'full') {
      if (fee.reason.trim().length < 3) { setErr('Say why the fee is reduced — the doctor\'s report shows it.'); return }
      if (fee.mode === 'discount' && !(fee.price !== '' && Number(fee.price) >= 0 && Number(fee.price) < full)) {
        setErr(`Enter the discounted fee, below ${rs(full)}.`); return
      }
    }
    const due = full <= 0 ? 0 : fee.mode === 'full' ? full : fee.mode === 'free' ? 0 : Number(fee.price) || 0
    if (due > 0 && !paidHow) { setErr('Say how the fee was received — or choose "Not received now".'); return }
    setBusy(true)
    try {
      const charge = full <= 0 || fee.mode === 'full' ? null : fee.mode === 'free' ? 0 : Number(fee.price)
      const r = await opdVisit({
        businessId: biz, patientMemberId: picked.id, practitionerId: doctor ?? s?.doctorId ?? null,
        fee: charge, discountReason: charge == null ? null : fee.reason.trim(), reason,
        priority: outOfTurn ? 10 : 0, priorityReason: outOfTurn ? why.trim() : null,
        paidMethod: due > 0 ? paidHow : null,
      })
      if (pre.appointment) await setAppointmentStatus(pre.appointment, 'completed').catch(() => {})
      setIssued({ token: r.token_number, name: picked.name, doctor: doc?.full_name ?? '', fee: r.fee, paid: Number(r.paid ?? 0), member: picked.id, queue: r.queue_id })
      setPicked(null); setQ(''); setReason(''); setFee({ mode: 'full', price: '', reason: '' }); setOutOfTurn(false); setWhy('')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      {issued && (
        <Card style={{ borderColor: C.green }}>
          <Text style={st.big}>✓ Token {issued.token}</Text>
          <Text style={st.body}>{issued.name}{issued.doctor ? ` → ${issued.doctor}` : ''}</Text>
          <Text style={st.meta}>{issued.fee <= 0 ? 'No fee.' : issued.paid > 0 ? `${rs(issued.paid)} received.` : `${rs(issued.fee)} added to their account — not received yet.`}</Text>
          <Note>Print slip opens your phone's print window — a Wi-Fi printer, or Save as PDF to share.</Note>
          <View style={st.row}>
            {issued.fee > 0 && issued.paid <= 0 && <Btn small label={`Take ${rs(issued.fee)}`} onPress={() => router.push({ pathname: '/patient/[member]', params: { member: issued.member } })} />}
            <Btn small kind="ghost" label="🖨 Print slip" onPress={() => printOpdSlip(issued.queue).catch(e => setErr((e as Error).message))} />
            <Btn small kind={issued.fee > 0 && issued.paid <= 0 ? 'ghost' : 'primary'} label="Next patient" onPress={() => setIssued(null)} />
            <Btn small kind="ghost" label="Back to queue" onPress={() => router.back()} />
          </View>
        </Card>
      )}

      {!issued && <>
        <Card>
          <Label>Who is it for?</Label>
          {picked ? (
            <View style={st.rowBetween}>
              <Text style={st.name}>{picked.name}<Text style={st.meta}>  {picked.phone ?? ''}</Text></Text>
              <Btn small kind="ghost" label="Change" onPress={() => { setPicked(null); setQ('') }} />
            </View>
          ) : adding ? (
            <View style={{ gap: 8 }}>
              <Field label="Full name" value={np.name} onChangeText={t => setNp({ ...np, name: t })} autoFocus />
              <Field label="Mobile — 10 digits, or + country code" value={np.phone} keyboardType="phone-pad"
                onChangeText={t => setNp({ ...np, phone: t.replace(/[^\d+ ]/g, '') })} />
              <View style={st.row}>
                <View style={{ flex: 1 }}><Field label="Age" value={np.age} keyboardType="number-pad" onChangeText={t => setNp({ ...np, age: t.replace(/\D/g, '').slice(0, 3) })} /></View>
                <View style={{ flex: 1 }}><Field label="PIN (optional)" value={np.pin} keyboardType="number-pad" onChangeText={t => setNp({ ...np, pin: t.replace(/\D/g, '').slice(0, 6) })} /></View>
              </View>
              <View style={st.row}>{GENDERS.map(([k, l]) => <Chip key={k} label={l} on={np.gender === k} onPress={() => setNp({ ...np, gender: k })} />)}</View>
              <View style={st.row}>
                <Btn small label="Register" busy={busy} onPress={register} />
                <Btn small kind="ghost" label="Cancel" onPress={() => setAdding(false)} />
              </View>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <Field placeholder="Name or mobile number" value={q} onChangeText={setQ} autoCorrect={false} autoFocus />
              {rows.map(r => (
                <Pressable key={r.patient_member_id} style={st.hit} onPress={() => choose(r.patient_member_id, r.full_name, r.phone)}>
                  <Text style={st.body}>{r.full_name}</Text>
                  <Text style={st.meta}>{[r.phone, r.age_years != null ? `${r.age_years}y` : null, r.gender, `${r.visit_count} visit${r.visit_count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</Text>
                </Pressable>
              ))}
              {q.trim().length >= 2 && rows.length === 0 && <Note>No one found.</Note>}
              <Btn small kind="ghost" label="+ New patient" onPress={() => {
                const d = q.replace(/\D/g, '')
                setNp({ name: pre.name ?? (d.length >= 10 ? '' : q.trim()), phone: d.length >= 10 ? d.slice(-10) : (pre.phone ?? ''),
                  age: pre.age ?? '', gender: '', pin: '' })
                setAdding(true)
              }} />
            </View>
          )}
        </Card>

        {picked && (
          <Card>
            {doctors.length > 1 && <>
              <Label>Doctor</Label>
              <View style={st.row}>{doctors.map(d => <Chip key={d.practitioner_id} label={d.full_name} on={doctor === d.practitioner_id} onPress={() => setDoctor(d.practitioner_id)} />)}</View>
            </>}
            {doctors.length === 0 && <Note>No doctor is set up here yet — the token goes in the clinic's general line.</Note>}
            <Field label="Reason for visit (optional)" value={reason} onChangeText={setReason} placeholder="e.g. Eye check-up" />

            {doc && (full > 0 ? <>
              <Label>OPD fee</Label>
              <View style={st.row}>
                <Chip label={`Full ${rs(full)}`} on={fee.mode === 'full'} onPress={() => setFee({ ...fee, mode: 'full' })} />
                <Chip label="Discount" on={fee.mode === 'discount'} onPress={() => setFee({ ...fee, mode: 'discount' })} />
                <Chip label="Free" on={fee.mode === 'free'} onPress={() => setFee({ ...fee, mode: 'free' })} />
              </View>
              {fee.mode === 'discount' && <Field placeholder={`₹ below ${full}`} keyboardType="decimal-pad" value={fee.price}
                onChangeText={t => setFee({ ...fee, price: t.replace(/[^0-9.]/g, '') })} />}
              {fee.mode !== 'full' && <Field placeholder="Why? e.g. Doctor's advice — follow-up within 7 days" value={fee.reason}
                onChangeText={t => setFee({ ...fee, reason: t })} maxLength={300} />}
              {fee.mode !== 'free' && <>
                <Label>Fee received</Label>
                <View style={st.row}>
                  {FEE_PAID_OPTIONS.map(([v, l]) => <Chip key={v} label={l} on={paidHow === v} onPress={() => setPaidHow(v)} />)}
                </View>
              </>}
            </> : <Note>{doc.full_name} has no OPD fee set — no charge will be added.</Note>)}

            <View style={st.rowBetween}>
              <Text style={st.body}>Out of turn</Text>
              <Switch value={outOfTurn} onValueChange={setOutOfTurn} trackColor={{ true: C.green }} />
            </View>
            {outOfTurn && <Field placeholder="Why? e.g. Emergency, elderly, came back with reports" value={why} onChangeText={setWhy} />}

            <Err msg={err} />
            <Btn label={full > 0 && fee.mode !== 'free' ? 'Give token & add fee' : 'Give token'} busy={busy} onPress={give} />
          </Card>
        )}
        {!picked && <Err msg={err} />}
      </>}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  hit: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0ebe1' },
  big: { fontSize: 26, fontWeight: '800', color: C.green },
  name: { fontSize: 16, fontWeight: '800', color: C.ink, flexShrink: 1 },
  body: { fontSize: 15, color: C.ink },
  meta: { fontSize: 13, color: C.muted, fontWeight: '400' },
})
