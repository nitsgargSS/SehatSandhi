import { useCallback, useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  getTrip, tripLocation, mapsUrl, acceptTrip, declineTrip, dropTrip, onTheWay, pickedUp, completeTrip, tripDrivers,
  TRIP_STATUS, TRIP_EVENT, type Trip, type Driver, type FareMode,
} from '@web/lib/ambulanceApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// One ambulance request (0191): accept (driver, vehicle, ETA) → on the way →
// picked up → completed with the fare. Big buttons: this is used on the road.
const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : ''

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { s } = useSession()
  const biz = s?.clinic?.id
  const isDriver = s?.role.role === 'driver'
  const [t, setT] = useState<Trip | null>(null)
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [driver, setDriver] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [eta, setEta] = useState('15')
  const [fare, setFare] = useState('')
  const [mode, setMode] = useState<FareMode>('cash')
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState<'decline' | 'drop' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null)
  useEffect(() => { if (biz && id && t?.mine) tripLocation(biz, id).then(setLoc).catch(() => setLoc(null)) }, [biz, id, t?.mine])

  const load = useCallback(async () => {
    if (!biz || !id) return
    try { setT(await getTrip(biz, id)); setErr('') } catch (e) { setErr((e as Error).message) }
  }, [biz, id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (biz && !isDriver) tripDrivers(biz).then(d => { setDrivers(d); setDriver(x => x || d.find(p => p.role === 'driver')?.practitioner_id || '') }).catch(() => {})
  }, [biz, isDriver])

  const run = async (fn: () => Promise<Trip>, after?: () => void) => {
    setBusy(true); setErr('')
    try { setT(await fn()); setAsking(null); after?.() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!t) return <View style={st.center}>{err ? <Err msg={err} /> : <Note>Loading…</Note>}</View>

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card style={t.kind === 'emergency' && t.status === 'open' ? { borderColor: C.danger, borderWidth: 2 } : undefined}>
        <View style={st.row}>
          <Text style={st.code}>{t.code}</Text>
          <Text style={[st.pill, t.kind === 'emergency' ? st.pillRed : null]}>{t.kind === 'emergency' ? 'EMERGENCY' : 'Scheduled'}</Text>
        </View>
        <Note>{TRIP_STATUS[t.status]} · PIN {t.pin_code} · {when(t.created_at)}</Note>
        {!!t.need && <><Label>Needed</Label><Text style={st.body}>{t.need}</Text></>}
      </Card>

      {(t.patient_phone || t.pickup_address) && (
        <Card>
          <Text style={st.bold}>{t.patient_name}</Text>
          {!!t.pickup_address && <Text style={st.body}>{t.pickup_address}, {t.pin_code}</Text>}
          <View style={st.row2}>
            {!!t.patient_phone && <Btn label={`Call +${t.patient_phone}`} onPress={() => Linking.openURL(`tel:+${t.patient_phone}`)} />}
            {(!!t.pickup_address || !!loc) && <Btn kind="ghost" label={loc ? '📍 Open exact location' : 'Open map'} onPress={() => Linking.openURL(mapsUrl(t, loc))} />}
          </View>
        </Card>
      )}
      {t.mine && !!t.driver_name && <Note>🚑 {t.driver_name}{t.vehicle_no ? ` · ${t.vehicle_no}` : ''}{t.eta_minutes ? ` · ETA ${t.eta_minutes} min` : ''}</Note>}

      <Err msg={err} />

      {t.status === 'open' && (asking === 'decline' ? (
        <Card>
          <Field label="Why? (optional)" placeholder="e.g. all vehicles out" value={reason} onChangeText={setReason} />
          <View style={st.row2}>
            <Btn kind="danger" label="Can't go" busy={busy} onPress={() => run(() => declineTrip(biz!, t.id, reason), () => router.back())} />
            <Btn kind="ghost" label="Back" onPress={() => setAsking(null)} />
          </View>
        </Card>
      ) : (
        <Card>
          {!isDriver && (
            <>
              <Label>Driver</Label>
              <View style={st.chips}>
                <Chip label="Me" on={driver === ''} onPress={() => setDriver('')} />
                {drivers.map(d => <Chip key={d.practitioner_id} label={d.name} on={driver === d.practitioner_id} onPress={() => setDriver(d.practitioner_id)} />)}
              </View>
            </>
          )}
          <View style={st.row2}>
            <Field label="Vehicle number" autoCapitalize="characters" placeholder="HR 02 AB 1234" value={vehicle} onChangeText={setVehicle} />
            <Field label="Reach in (min)" keyboardType="number-pad" value={eta} onChangeText={v => setEta(v.replace(/\D/g, ''))} />
          </View>
          <Btn label="Accept — we're going" busy={busy} onPress={() => run(() => acceptTrip(biz!, t.id, isDriver ? null : (driver || null), vehicle, eta ? Number(eta) : null))} />
          <Btn kind="ghost" label="Can't go" onPress={() => setAsking('decline')} />
        </Card>
      ))}

      {t.mine && t.status === 'accepted' && <Btn label="On the way" busy={busy} onPress={() => run(() => onTheWay(biz!, t.id, null))} />}
      {t.mine && (t.status === 'accepted' || t.status === 'on_the_way') && <Btn kind="ghost" label="Patient picked up" busy={busy} onPress={() => run(() => pickedUp(biz!, t.id))} />}
      {t.mine && !isDriver && (t.status === 'accepted' || t.status === 'on_the_way') && asking !== 'drop' && <Btn kind="ghost" label="Give up — pass to another ambulance" onPress={() => setAsking('drop')} />}
      {asking === 'drop' && (
        <Card>
          <Field label="Why?" placeholder="e.g. vehicle broke down" value={reason} onChangeText={setReason} />
          <View style={st.row2}>
            <Btn kind="danger" label="Give up" busy={busy} disabled={!reason.trim()} onPress={() => run(() => dropTrip(biz!, t.id, reason.trim()), () => router.back())} />
            <Btn kind="ghost" label="Back" onPress={() => setAsking(null)} />
          </View>
        </Card>
      )}

      {t.mine && ['accepted', 'on_the_way', 'picked_up'].includes(t.status) && (
        <Card>
          <Text style={st.bold}>Trip done?</Text>
          <Field label="Fare ₹ (0 if free)" keyboardType="decimal-pad" value={fare} onChangeText={v => setFare(v.replace(/[^\d.]/g, ''))} />
          <View style={st.chips}>
            {(['cash', 'upi', 'card', 'other', 'free'] as FareMode[]).map(m => <Chip key={m} label={m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)} on={mode === m} onPress={() => setMode(m)} />)}
          </View>
          <Btn label="Complete trip" busy={busy} disabled={fare === ''} onPress={() => run(() => completeTrip(biz!, t.id, Number(fare), mode))} />
        </Card>
      )}

      {t.status === 'completed' && (
        <Card>
          <Text style={st.body}>Completed {when(t.completed_at)} by {t.completed_by_name} · ₹{t.fare} {t.paid_mode?.toUpperCase()}</Text>
          {!!t.rating && <Text style={st.body}>Patient: {'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}{t.review ? ` “${t.review}”` : ''}</Text>}
        </Card>
      )}
      {(t.status === 'cancelled' || t.status === 'expired') && <Note>{t.ended_reason}</Note>}

      {!!t.events?.length && (
        <Card>
          <Label>Who did what</Label>
          {t.events.map((e, i) => <Text key={i} style={st.ev}>{when(e.at)} — {TRIP_EVENT[e.event] ?? e.event}{e.by ? ` · ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</Text>)}
        </Card>
      )}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row2: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  code: { fontSize: 20, fontWeight: '800', color: C.ink },
  pill: { fontSize: 12, fontWeight: '800', color: '#0b5f8a', backgroundColor: '#e3f1fa', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  pillRed: { color: C.danger, backgroundColor: '#fdecea' },
  body: { color: C.ink, fontSize: 15 },
  bold: { fontWeight: '700', color: C.ink, fontSize: 15 },
  ev: { color: C.muted, fontSize: 12 },
})
