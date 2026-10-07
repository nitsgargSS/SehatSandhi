import { useCallback, useEffect, useState } from 'react'
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useSession } from '../../../lib/session'
import { supabase } from '../../../lib/supabase'
import { cancelAppointment, rescheduleAppointment, setAppointmentStatus } from '@web/lib/appointmentApi'
import { listBusinessDoctors, type BusinessDoctor } from '@web/lib/doctorsApi'
import type { Appointment } from '@web/types'
import { Btn, Card, Chip, Err, Field, Label, Note, toIso } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// Bookings from the website, WhatsApp and the app — the website's Today and
// Appointments tabs on a phone. Confirm, move, completed, no-show, cancel with a
// reason: the same database functions, which check slot clashes and notify the
// patient (by trigger). "Arrived" opens New token with the patient filled in,
// so the fee and the queue work exactly as for a walk-in.
type Range = 'today' | 'tomorrow' | 'week'
const RANGE: [Range, string][] = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days']]
const STATUS: Record<string, string> = { booked: 'Booked', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'Did not come' }
const VIA: Record<string, string> = { website: 'website', whatsapp: 'WhatsApp', app: 'app', desk: 'desk', phone: 'phone' }
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA') }
const when = (iso: string, withDay: boolean) => new Date(iso).toLocaleString('en-IN', withDay
  ? { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }
  : { hour: 'numeric', minute: '2-digit', hour12: true })

export default function Bookings() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const [range, setRange] = useState<Range>('today')
  const [doctors, setDoctors] = useState<BusinessDoctor[]>([])
  const [doctor, setDoctor] = useState<string>('all')
  const [rows, setRows] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // The one booking being cancelled or moved, and what has been typed.
  const [open, setOpen] = useState<{ id: string; kind: 'cancel' | 'move'; reason: string; date: string; time: string } | null>(null)

  useEffect(() => {
    if (!biz) return
    listBusinessDoctors(biz).then(d => {
      setDoctors(d)
      // A doctor opens on their own bookings.
      if (s?.doctorId && d.some(x => x.practitioner_id === s.doctorId)) setDoctor(s.doctorId)
    }).catch(() => {})
  }, [biz])

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true); setErr('')
    const from = range === 'tomorrow' ? day(1) : day(0)
    const to = range === 'today' ? day(0) : range === 'tomorrow' ? day(1) : day(7)
    let q = supabase.from('appointments').select('*').eq('business_id', biz)
      .gte('slot_datetime', `${from}T00:00:00`).lte('slot_datetime', `${to}T23:59:59`)
      .order('slot_datetime').limit(300)
    if (doctor !== 'all') q = q.eq('practitioner_id', doctor)
    const { data, error } = await q
    if (error) setErr(error.message); else setRows((data ?? []) as Appointment[])
    setLoading(false)
  }, [biz, range, doctor])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setErr('')
    try { await fn(); setOpen(null); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const sure = (title: string, body: string, yes: string, go: () => void) =>
    Alert.alert(title, body, [{ text: 'Back', style: 'cancel' }, { text: yes, onPress: go }])
  const docName = (id?: string | null) => doctors.find(d => d.practitioner_id === id)?.full_name

  const live = rows.filter(a => a.status === 'booked' || a.status === 'confirmed')
  const closed = rows.filter(a => !(a.status === 'booked' || a.status === 'confirmed'))

  const Row = (a: Appointment) => {
    const isOpen = a.status === 'booked' || a.status === 'confirmed'
    const o = open?.id === a.id ? open : null
    return (
      <View key={a.id} style={st.row}>
        <Text style={st.name}>{when(a.slot_datetime, range !== 'today')} · {a.patient_name}</Text>
        <Text style={st.meta}>{[a.patient_age ? `${a.patient_age}y` : null, docName(a.practitioner_id), STATUS[a.status] ?? a.status,
          VIA[a.booked_via] ? `via ${VIA[a.booked_via]}` : null].filter(Boolean).join(' · ')}</Text>
        {/* 0207: what a lab booking is for — the tests, at the lab or at home (with the address). */}
        {!!(a as Appointment & { purpose?: string | null }).purpose && <Text style={st.purpose}>🧪 {(a as Appointment & { purpose?: string | null }).purpose}</Text>}
        {!!a.patient_phone && <Text style={st.link} onPress={() => Linking.openURL(`tel:${a.patient_phone}`)}>📞 {a.patient_phone}</Text>}
        {!!a.previous_slot_datetime && <Text style={st.warn}>Moved from {when(a.previous_slot_datetime, true)}</Text>}
        {a.status === 'cancelled' && !!a.cancelled_by && <Text style={st.meta}>Cancelled by {a.cancelled_by === 'patient' ? 'the patient' : a.cancelled_by}{a.cancel_reason ? ` — ${a.cancel_reason}` : ''}</Text>}

        {isOpen && !o && (
          <View style={st.btns}>
            <Btn small label="Arrived → token" onPress={() => router.push({ pathname: '/token', params: {
              name: a.patient_name, phone: a.patient_phone ?? '', age: a.patient_age ? String(a.patient_age) : '', doctor: a.practitioner_id ?? '', appointment: a.id,
            } })} />
            {a.status === 'booked' && <Btn small kind="ghost" label="Confirm" busy={busy === a.id} onPress={() => act(a.id, () => setAppointmentStatus(a.id, 'confirmed'))} />}
            <Btn small kind="ghost" label="Move" onPress={() => setOpen({ id: a.id, kind: 'move', reason: '', date: '', time: '' })} />
            <Btn small kind="ghost" label="Completed" busy={busy === a.id} onPress={() => act(a.id, () => setAppointmentStatus(a.id, 'completed'))} />
            <Btn small kind="ghost" label="No show" onPress={() => sure('Did not come?', `Mark ${a.patient_name} as a no-show?`, 'No show',
              () => act(a.id, () => setAppointmentStatus(a.id, 'no_show')))} />
            <Btn small kind="danger" label="Cancel" onPress={() => setOpen({ id: a.id, kind: 'cancel', reason: '', date: '', time: '' })} />
          </View>
        )}
        {o?.kind === 'cancel' && (
          <View style={{ gap: 6 }}>
            <Field placeholder="Why? The patient is told." value={o.reason} onChangeText={t => setOpen({ ...o, reason: t })} autoFocus />
            <View style={st.btns}>
              <Btn small kind="danger" label="Cancel booking" busy={busy === a.id} disabled={!o.reason.trim()}
                onPress={() => act(a.id, () => cancelAppointment(a.id, o.reason.trim(), 'clinic', s?.email))} />
              <Btn small kind="ghost" label="Back" onPress={() => setOpen(null)} />
            </View>
          </View>
        )}
        {o?.kind === 'move' && (
          <View style={{ gap: 6 }}>
            <View style={st.btns}>
              <View style={{ flex: 1 }}><Field label="New date" placeholder="dd/mm/yyyy" value={o.date} keyboardType="numbers-and-punctuation" onChangeText={t => setOpen({ ...o, date: t })} /></View>
              <View style={{ flex: 1 }}><Field label="Time (24 h)" placeholder="17:30" value={o.time} keyboardType="numbers-and-punctuation" onChangeText={t => setOpen({ ...o, time: t })} /></View>
            </View>
            <Field placeholder="Reason (optional) — the patient is told" value={o.reason} onChangeText={t => setOpen({ ...o, reason: t })} />
            <View style={st.btns}>
              <Btn small label="Move booking" busy={busy === a.id} onPress={() => {
                const d = toIso(o.date)
                const tm = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/.exec(o.time.trim())
                if (!d || !tm) { setErr('Enter the date as dd/mm/yyyy and the time as 17:30.'); return }
                // Local time on the phone (India), sent with its offset.
                const slot = new Date(`${d}T${tm[1].padStart(2, '0')}:${tm[2]}:00`).toISOString()
                act(a.id, () => rescheduleAppointment(a.id, slot, o.reason.trim() || undefined, 'clinic', s?.email))
              }} />
              <Btn small kind="ghost" label="Back" onPress={() => setOpen(null)} />
            </View>
          </View>
        )}
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
      <View style={st.btns}>{RANGE.map(([k, l]) => <Chip key={k} label={l} on={range === k} onPress={() => setRange(k)} />)}</View>
      {doctors.length > 1 && (
        <View style={st.btns}>
          <Chip label="All doctors" on={doctor === 'all'} onPress={() => setDoctor('all')} />
          {doctors.map(d => <Chip key={d.practitioner_id} label={d.full_name} on={doctor === d.practitioner_id} onPress={() => setDoctor(d.practitioner_id)} />)}
        </View>
      )}
      <Err msg={err} />
      <Card>
        <Label>To come {live.length ? `(${live.length})` : ''}</Label>
        {live.length === 0 ? <Note>{loading ? 'Loading…' : 'No bookings. Pull down to refresh.'}</Note> : live.map(Row)}
      </Card>
      {closed.length > 0 && <Card><Label>Done, cancelled, did not come ({closed.length})</Label>{closed.map(Row)}</Card>}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 48 },
  row: { borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 10, gap: 3 },
  name: { fontSize: 15.5, fontWeight: '700', color: C.ink },
  meta: { fontSize: 13, color: C.muted },
  warn: { fontSize: 12.5, color: '#b7791f' },
  purpose: { fontSize: 13.5, color: C.ink, backgroundColor: '#eef8f3', borderRadius: 8, padding: 6 },
  link: { color: C.green, fontWeight: '600' },
  btns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
})
