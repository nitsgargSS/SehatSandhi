import { useCallback, useEffect, useState } from 'react'
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useSession } from '../../../lib/session'
import { supabase } from '../../../lib/supabase'
import { getOrders, markCollected, assignCollector, cancelOrder, STATUS_LABEL, type LabOrder, type OrderStatus } from '@web/lib/labApi'
import { Btn, Card, Chip, Err, Field, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// The lab's work on a phone — the website's Lab queue (src/pages/doctor/
// LabPanel.tsx), same functions: orders by stage; at home, who goes and when;
// sample collected; then results, approval and the report (on the order's own
// screen). The database decides who may do each step (sehat_lab_check):
// anyone at the lab collects, a doctor / technician (nurse) / owner enters
// results, a doctor or owner approves, the owner / manager / doctor cancels.
type Stage = 'collect' | 'work' | 'approve' | 'done'
const STAGES: [Stage, string, OrderStatus[]][] = [
  ['collect', 'To collect', ['ordered']],
  ['work', 'Results to enter', ['collected', 'in_progress']],
  ['approve', 'To approve', ['ready']],
  ['done', 'Reported', ['reported']],
]
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

export default function LabOrders() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const manages = !s?.role.enforced || ['owner', 'manager', 'doctor'].includes(s?.role.role ?? '')
  const [stage, setStage] = useState<Stage>('collect')
  const [rows, setRows] = useState<LabOrder[]>([])
  const [counts, setCounts] = useState<Record<Stage, number>>({ collect: 0, work: 0, approve: 0, done: 0 })
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string; kind: 'assign' | 'cancel'; reason: string } | null>(null)

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true); setErr('')
    try {
      const since = new Date(Date.now() - 14 * 86400000).toISOString()
      const all = await getOrders(biz, { statuses: ['ordered', 'collected', 'in_progress', 'ready', 'reported'], since })
      const c = { collect: 0, work: 0, approve: 0, done: 0 } as Record<Stage, number>
      for (const [k, , st] of STAGES) c[k] = all.filter(o => st.includes(o.status)).length
      setCounts(c)
      const st = STAGES.find(x => x[0] === stage)![2]
      // Home collections by time, everything else newest first.
      setRows(all.filter(o => st.includes(o.status)).sort((a, b) => stage === 'collect'
        ? (a.collection_slot ?? a.created_at).localeCompare(b.collection_slot ?? b.created_at)
        : b.created_at.localeCompare(a.created_at)))
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [biz, stage])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => {
    if (!biz) return
    supabase.from('business_practitioners').select('practitioner_id, practitioners(full_name)').eq('business_id', biz).neq('status', 'suspended')
      .then(({ data }) => setStaff(((data ?? []) as unknown as { practitioner_id: string; practitioners: { full_name: string } | null }[])
        .filter(r => r.practitioners).map(r => ({ id: r.practitioner_id, name: r.practitioners!.full_name }))))
  }, [biz])

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setErr('')
    try { await fn(); setOpen(null); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const Order = (o: LabOrder) => {
    const tests = o.items.map(i => i.name).join(', ')
    const isOpen = open?.id === o.id ? open : null
    return (
      <Card key={o.id}>
        <Pressable onPress={() => router.push({ pathname: '/laborder/[id]', params: { id: o.id } })}>
          <View style={st.between}>
            <Text style={st.name}>{o.patient_name}{o.patient_age != null ? `, ${o.patient_age}` : ''}{o.patient_gender ? ` ${o.patient_gender[0].toUpperCase()}` : ''}</Text>
            <Text style={st.meta}>{o.order_no}</Text>
          </View>
          <Text style={st.body} numberOfLines={3}>{tests || '—'}</Text>
          <Text style={st.meta}>
            {[STATUS_LABEL[o.status], o.priority === 'urgent' ? '⚡ urgent' : null, o.source === 'app' ? 'booked in the app' : null,
              o.status !== 'ordered' && o.items.length ? `${o.items.length - o.pending_count}/${o.items.length} results` : null].filter(Boolean).join(' · ')}
          </Text>
        </Pressable>
        {o.collection === 'home' ? (
          <View style={st.home}>
            <Text style={st.body}>🏠 {o.collection_address}</Text>
            <Text style={st.meta}>{o.collection_slot ? when(o.collection_slot) : 'time not set'} · {o.collector_name ? `collector: ${o.collector_name}` : 'nobody assigned'}</Text>
            {!!o.collection_address && <Text style={st.link} onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(o.collection_address!)}`)}>📍 Open in Maps</Text>}
          </View>
        ) : o.collection_slot ? <Text style={st.meta}>🏥 At the lab · {when(o.collection_slot)}</Text> : null}
        {!!o.notes && <Text style={st.note}>{o.notes}</Text>}
        {!!o.patient_phone && <Text style={st.link} onPress={() => Linking.openURL(`tel:${o.patient_phone}`)}>📞 {o.patient_phone}</Text>}

        {!isOpen && (
          <View style={st.row}>
            {o.status === 'ordered' && <Btn small label="Sample collected" busy={busy === o.id}
              onPress={() => Alert.alert('Sample collected?', `${o.patient_name} — ${tests}`, [{ text: 'Back', style: 'cancel' }, { text: 'Collected', onPress: () => act(o.id, () => markCollected(o.id)) }])} />}
            {o.status === 'ordered' && o.collection === 'home' && <Btn small kind="ghost" label="Assign collector" onPress={() => setOpen({ id: o.id, kind: 'assign', reason: '' })} />}
            {o.status !== 'ordered' && <Btn small label={o.status === 'ready' ? 'Check & approve' : o.status === 'reported' ? 'Report' : 'Enter results'}
              onPress={() => router.push({ pathname: '/laborder/[id]', params: { id: o.id } })} />}
            {manages && o.status !== 'reported' && <Btn small kind="danger" label="Cancel" onPress={() => setOpen({ id: o.id, kind: 'cancel', reason: '' })} />}
          </View>
        )}
        {isOpen?.kind === 'assign' && (
          <View style={{ gap: 6 }}>
            <Text style={st.meta}>Who goes to collect it?</Text>
            <View style={st.row}>{staff.map(p => <Chip key={p.id} label={p.name} on={o.collector_id === p.id}
              onPress={() => act(o.id, () => assignCollector(o.id, p.id, o.collection_slot))} />)}</View>
            <Btn small kind="ghost" label="Back" onPress={() => setOpen(null)} />
          </View>
        )}
        {isOpen?.kind === 'cancel' && (
          <View style={{ gap: 6 }}>
            <Field placeholder="Why is it cancelled?" value={isOpen.reason} onChangeText={t => setOpen({ ...isOpen, reason: t })} autoFocus />
            <View style={st.row}>
              <Btn small kind="danger" label="Cancel order" busy={busy === o.id} disabled={!isOpen.reason.trim()} onPress={() => act(o.id, () => cancelOrder(o.id, isOpen.reason.trim()))} />
              <Btn small kind="ghost" label="Back" onPress={() => setOpen(null)} />
            </View>
          </View>
        )}
      </Card>
    )
  }

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
      <Btn label="+ New order" onPress={() => router.push('/labnew')} />
      <View style={st.row}>{STAGES.map(([k, l]) => <Chip key={k} label={`${l}${counts[k] ? ` (${counts[k]})` : ''}`} on={stage === k} onPress={() => setStage(k)} />)}</View>
      <Err msg={err} />
      {rows.map(Order)}
      {!rows.length && <Note>{loading ? 'Loading…' : 'Nothing here. Pull down to refresh.'}</Note>}
      <Note>Patients' own bookings from the app appear here too. A report PDF or photo is uploaded on the order's screen.</Note>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 15.5, fontWeight: '800', color: C.ink, flexShrink: 1 },
  body: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  link: { color: C.green, fontWeight: '700' },
  home: { backgroundColor: '#eef8f3', borderRadius: 10, padding: 8, gap: 2 },
  note: { fontSize: 13, color: C.ink, backgroundColor: '#f7f4ec', borderRadius: 8, padding: 6 },
})
