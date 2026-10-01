import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useSession } from '../../../lib/session'
import { listOrders, deliveryArea, ORDER_STATUS, rupees, type MedicineOrder, type OrderScope } from '@web/lib/medicineOrdersApi'
import { Card, Chip, Err, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// A pharmacy's medicine orders (0189) — the website's Orders tab, same calls.
// A delivery person sees only what was handed to them.
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function OrdersScreen() {
  const { s, loading: sLoading, error: sErr } = useSession()
  const delivery = s?.role.role === 'delivery'
  const [scope, setScope] = useState<OrderScope>(delivery ? 'active' : 'new')
  const [orders, setOrders] = useState<MedicineOrder[]>([])
  const [counts, setCounts] = useState<Partial<Record<OrderScope, number>>>({})
  const [areas, setAreas] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const biz = s?.clinic?.id

  useEffect(() => { setScope(delivery ? 'active' : 'new') }, [delivery])

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true)
    try {
      const scopes: OrderScope[] = delivery ? ['active', 'done'] : ['new', 'active', 'done']
      const all = await Promise.all(scopes.map(x => listOrders(biz, x)))
      setCounts(Object.fromEntries(scopes.map((x, i) => [x, all[i].length])))
      setOrders(all[scopes.indexOf(scope)] ?? [])
      if (!delivery) deliveryArea(biz).then(a => setAreas(a.filter(x => x.chosen).length)).catch(() => {})
      setErr('')
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [biz, scope, delivery])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t) }, [load])

  if (sLoading && !s) return <View style={st.center}><Note>Loading…</Note></View>
  if (sErr) return <View style={st.center}><Err msg={sErr} /></View>
  if (!biz) return <View style={st.center}><Note>No pharmacy is linked to this login.</Note></View>

  const tabs: [OrderScope, string][] = delivery ? [['active', 'To deliver'], ['done', 'Delivered']] : [['new', 'New'], ['active', 'In progress'], ['done', 'Done']]

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={st.chips}>
        {tabs.map(([k, l]) => <Chip key={k} label={`${l}${counts[k] ? ` · ${counts[k]}` : ''}`} on={scope === k} onPress={() => setScope(k)} />)}
      </View>
      {areas === 0 && !delivery && (
        <Card style={{ borderColor: '#f5c26b', borderWidth: 2 }}>
          <Text style={st.bold}>No delivery areas chosen yet</Text>
          <Note>Orders only reach you for the PIN codes you deliver to. The owner or a manager sets them on the website: Orders → Where you deliver.</Note>
        </Card>
      )}
      <Err msg={err} />
      {!loading && orders.length === 0 && (
        <Note>{scope === 'new' ? 'No new orders in your area right now. You get an alert on this phone when one comes in.'
          : scope === 'active' ? (delivery ? 'Nothing to deliver right now.' : 'No orders in progress.') : 'No finished orders in the last 30 days.'}</Note>
      )}
      {orders.map(o => (
        <Pressable key={o.id} onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}>
          <Card>
            <View style={st.row}>
              <Text style={st.code}>{o.code}</Text>
              <Text style={[st.pill, o.status === 'open' || o.status === 'accepted' || o.status === 'confirmed' ? st.pillHot : null]}>{ORDER_STATUS[o.status]}</Text>
            </View>
            <Text style={st.meta}>PIN {o.pin_code} · {ago(o.created_at)}{o.patient_name ?? o.patient_first_name ? ` · ${o.patient_name ?? o.patient_first_name}` : ''}</Text>
            <Text style={st.meds} numberOfLines={2}>{o.medicines || 'Prescription photo'}</Text>
            {o.total != null && <Text style={st.bold}>{rupees(o.total)}{o.delivery_fee ? ` (incl. ${rupees(o.delivery_fee)} delivery)` : ''}</Text>}
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
  pill: { fontSize: 12, fontWeight: '700', color: C.muted, backgroundColor: '#f1efe9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  pillHot: { color: '#8a5a00', backgroundColor: '#fbf1dc' },
  meta: { color: C.muted, fontSize: 13 },
  meds: { color: C.ink },
  bold: { fontWeight: '700', color: C.ink },
})
