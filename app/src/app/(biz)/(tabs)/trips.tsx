import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useSession } from '../../../lib/session'
import { listTrips, TRIP_STATUS, type Trip, type TripScope } from '@web/lib/ambulanceApi'
import { deliveryArea } from '@web/lib/medicineOrdersApi'
import { Card, Chip, Err, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// An ambulance service's requests (0191) — the website's Trips tab, same calls.
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function TripsScreen() {
  const { s, loading: sLoading, error: sErr } = useSession()
  const driver = s?.role.role === 'driver'
  const [scope, setScope] = useState<TripScope>('new')
  const [trips, setTrips] = useState<Trip[]>([])
  const [counts, setCounts] = useState<Partial<Record<TripScope, number>>>({})
  const [areas, setAreas] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const biz = s?.clinic?.id

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true)
    try {
      const scopes: TripScope[] = ['new', 'active', 'done']
      const all = await Promise.all(scopes.map(x => listTrips(biz, x)))
      setCounts({ new: all[0].length, active: all[1].length, done: all[2].length })
      setTrips(all[scopes.indexOf(scope)])
      if (!driver) deliveryArea(biz).then(a => setAreas(a.filter(x => x.chosen).length)).catch(() => {})
      setErr('')
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [biz, scope, driver])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { const t = setInterval(load, 15_000); return () => clearInterval(t) }, [load])

  if (sLoading && !s) return <View style={st.center}><Note>Loading…</Note></View>
  if (sErr) return <View style={st.center}><Err msg={sErr} /></View>
  if (!biz) return <View style={st.center}><Note>No ambulance service is linked to this login.</Note></View>

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={st.chips}>
        {([['new', 'New'], ['active', driver ? 'My trips' : 'Under way'], ['done', 'Done']] as [TripScope, string][]).map(([k, l]) =>
          <Chip key={k} label={`${l}${counts[k] ? ` · ${counts[k]}` : ''}`} on={scope === k} onPress={() => setScope(k)} />)}
      </View>
      {areas === 0 && !driver && (
        <Card style={{ borderColor: '#f5c26b', borderWidth: 2 }}>
          <Text style={st.bold}>No service areas chosen yet</Text>
          <Note>Requests only reach you for the PIN codes you serve. The owner or a manager sets them on the website: Trips → Where you serve.</Note>
        </Card>
      )}
      <Err msg={err} />
      {!loading && trips.length === 0 && <Note>{scope === 'new' ? 'No requests right now. You get an alert on this phone the moment one comes in.' : scope === 'active' ? 'No trips under way.' : 'No finished trips in the last 30 days.'}</Note>}
      {trips.map(t => (
        <Pressable key={t.id} onPress={() => router.push({ pathname: '/trip/[id]', params: { id: t.id } })}>
          <Card style={t.kind === 'emergency' && t.status === 'open' ? { borderColor: C.danger, borderWidth: 2 } : undefined}>
            <View style={st.row}>
              <Text style={st.code}>{t.code}</Text>
              <Text style={[st.pill, t.kind === 'emergency' ? st.pillRed : null]}>{t.kind === 'emergency' ? 'EMERGENCY' : 'Scheduled'}</Text>
            </View>
            <Text style={st.meta}>{TRIP_STATUS[t.status]} · PIN {t.pin_code} · {ago(t.created_at)}{t.patient_name ? ` · ${t.patient_name}` : ''}</Text>
            {!!t.need && <Text style={st.body} numberOfLines={2}>{t.need}</Text>}
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  code: { fontSize: 17, fontWeight: '800', color: C.ink },
  pill: { fontSize: 12, fontWeight: '800', color: '#0b5f8a', backgroundColor: '#e3f1fa', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  pillRed: { color: C.danger, backgroundColor: '#fdecea' },
  meta: { color: C.muted, fontSize: 13 },
  body: { color: C.ink },
  bold: { fontWeight: '700', color: C.ink },
})
