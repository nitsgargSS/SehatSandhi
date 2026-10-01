import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { getVitals, addVital, type Vital } from '@web/lib/patientsApi'
import { Btn, Card, Err, Field, Label, Note } from './kit'
import { C } from './theme'

// Today's vitals and a form to record more — on a consultation (visitId) or a
// ward stay (admissionId). Who recorded it is stamped by the database (0182).
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)

export const vitalsLine = (v: Vital) => [
  v.bp_systolic && v.bp_diastolic ? `BP ${v.bp_systolic}/${v.bp_diastolic}` : null, v.pulse ? `Pulse ${v.pulse}` : null,
  v.temperature_c ? `${v.temperature_c}°C` : null, v.spo2 ? `SpO₂ ${v.spo2}%` : null, v.weight_kg ? `${v.weight_kg} kg` : null,
  v.blood_sugar_mg_dl ? `Sugar ${v.blood_sugar_mg_dl}` : null].filter(Boolean).join(' · ')

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })

export default function VitalsCard({ biz, member, visitId, admissionId }: { biz: string; member: string; visitId?: string; admissionId?: string }) {
  const [list, setList] = useState<Vital[]>([])
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ sys: '', dia: '', pulse: '', temp: '', spo2: '', weight: '', sugar: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(() => { getVitals(member, biz).then(setList).catch(() => setList([])) }, [biz, member])
  useEffect(load, [load])
  const todays = list.filter(v => v.recorded_at.slice(0, 10) === today())
  const n = (x: string) => (x.trim() ? Number(x) : null)
  const save = async () => {
    setBusy(true); setErr('')
    try {
      await addVital(member, biz, {
        bp_systolic: n(f.sys), bp_diastolic: n(f.dia), pulse: n(f.pulse), temperature_c: n(f.temp),
        spo2: n(f.spo2), weight_kg: n(f.weight), blood_sugar_mg_dl: n(f.sugar),
        ...(visitId ? { visit_id: visitId } : {}),
        ...(admissionId ? { admission_id: admissionId } : {}),
      } as Parameters<typeof addVital>[2])
      setF({ sys: '', dia: '', pulse: '', temp: '', spo2: '', weight: '', sugar: '' }); setOpen(false); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const set = (k: keyof typeof f) => (t: string) => setF({ ...f, [k]: t })
  return (
    <Card>
      <Label>Vitals today</Label>
      {todays.length === 0 ? <Note>None recorded yet.</Note>
        : todays.map(v => <Text key={v.id} style={s.body}>{time(v.recorded_at)} — {vitalsLine(v)}</Text>)}
      {open ? (
        <>
          <View style={s.grid}>
            <Field label="BP systolic" keyboardType="number-pad" value={f.sys} onChangeText={set('sys')} style={s.cell} />
            <Field label="diastolic" keyboardType="number-pad" value={f.dia} onChangeText={set('dia')} style={s.cell} />
            <Field label="Pulse" keyboardType="number-pad" value={f.pulse} onChangeText={set('pulse')} style={s.cell} />
            <Field label="Temp °C" keyboardType="decimal-pad" value={f.temp} onChangeText={set('temp')} style={s.cell} />
            <Field label="SpO₂ %" keyboardType="number-pad" value={f.spo2} onChangeText={set('spo2')} style={s.cell} />
            <Field label="Weight kg" keyboardType="decimal-pad" value={f.weight} onChangeText={set('weight')} style={s.cell} />
            <Field label="Sugar mg/dl" keyboardType="number-pad" value={f.sugar} onChangeText={set('sugar')} style={s.cell} />
          </View>
          <Err msg={err} />
          <View style={s.row}><Btn small label="Save vitals" busy={busy} onPress={save} /><Btn small kind="ghost" label="Cancel" onPress={() => setOpen(false)} /></View>
        </>
      ) : <View style={s.row}><Btn small kind="ghost" label="Record vitals" onPress={() => setOpen(true)} /></View>}
    </Card>
  )
}

const s = StyleSheet.create({
  body: { fontSize: 14.5, color: C.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { minWidth: 120 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
})
