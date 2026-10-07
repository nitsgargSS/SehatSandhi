import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { cancelBooking, type Activity, type RateKind } from '../lib/patient'
import { Btn, Card, Err, Label, Note } from './kit'
import { C } from './theme'

// The patient's requests and what waits for a rating — on My Sehatsandhi the
// latest few, on My requests all of them. One list, newest first, whatever kind.
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
const STATUS: Record<string, string> = {
  open: 'Waiting for a reply', accepted: 'Accepted', quoted: 'Price ready — approve it', confirmed: 'Approved', packed: 'Packed',
  out_for_delivery: 'On the way', delivered: 'Delivered', on_the_way: 'On the way', picked_up: 'Picked up', completed: 'Completed',
  contacted: 'Advisor spoke to you', won: 'Policy bought', lost: 'Closed', cancelled: 'Cancelled', expired: 'Expired',
  no_pharmacy: 'No pharmacy delivers here yet', disputed: 'Under review',
}

export type ToRate = { kind: RateKind; id: string; title: string }
export type Req = { key: string; icon: string; title: string; sub: string; at: number; url?: string; cancelId?: string }

export function toRate(act: Activity | null): ToRate[] {
  if (!act) return []
  return [
    ...act.bookings.filter(b => b.rateable).map(b => ({ kind: 'booking' as const, id: b.id, title: `Visit — ${b.place ?? 'clinic'}${b.doctor ? ` (${b.doctor})` : ''}` })),
    ...act.orders.filter(o => o.rateable).map(o => ({ kind: 'order' as const, id: o.id, title: `Medicines ${o.code} — ${o.pharmacy ?? ''}` })),
    ...act.trips.filter(t => t.rateable).map(t => ({ kind: 'trip' as const, id: t.id, title: `Ambulance ${t.code} — ${t.service ?? ''}` })),
    ...act.insurance.filter(l => l.rateable).map(l => ({ kind: 'insurance' as const, id: l.id, title: `Insurance advisor — ${l.advisor ?? ''}` })),
  ]
}

export function requests(act: Activity | null): Req[] {
  if (!act) return []
  const site = act.site ?? 'https://sehatsandhi.com'
  const now = Date.now()
  const out: Req[] = [
    ...act.orders.map(o => ({ key: `o${o.id}`, icon: '💊', title: `Medicines ${o.code}`, at: +new Date(o.created_at), url: `${site}/o/${o.token}`,
      sub: [STATUS[o.status] ?? o.status, o.pharmacy, o.total ? `₹${o.total}` : null].filter(Boolean).join(' · ') })),
    ...act.trips.map(t => ({ key: `t${t.id}`, icon: '🚑', title: `Ambulance ${t.code}`, at: +new Date(t.created_at), url: `${site}/a/${t.token}`,
      sub: [STATUS[t.status] ?? t.status, t.service].filter(Boolean).join(' · ') })),
    ...act.insurance.map(l => ({ key: `i${l.id}`, icon: '🛡️', title: `Insurance ${l.code}`, at: +new Date(l.created_at), url: `${site}/i/${l.token}`,
      sub: [STATUS[l.status] ?? l.status, l.advisor].filter(Boolean).join(' · ') })),
    ...act.bookings.map(b => {
      const at = +new Date(b.when)
      const upcoming = at > now && ['booked', 'confirmed'].includes(b.status)
      // A past booking still reads 'booked' in the clinic's book; to the patient it is a visit.
      const word = upcoming ? 'Upcoming' : b.status === 'cancelled' ? 'Cancelled' : b.status === 'completed' ? 'Visited' : 'Past'
      // 0207: a lab booking says what it is for (tests, at the lab or at home).
      const lab = !!b.purpose?.startsWith('Lab')
      return { key: `b${b.id}`, icon: lab ? '🧪' : '🩺', title: `${b.place ?? 'Clinic'}${b.doctor ? ` · ${b.doctor}` : ''}`, at,
        sub: [word, b.name, b.purpose?.replace(/^Lab tests: /, '')].filter(Boolean).join(' · '), cancelId: upcoming ? b.id : undefined }
    }),
  ]
  // Upcoming visits first (soonest first), then everything else newest first.
  return out.sort((a, b) => {
    const ua = a.cancelId ? 1 : 0, ub = b.cancelId ? 1 : 0
    if (ua !== ub) return ub - ua
    return ua ? a.at - b.at : b.at - a.at
  })
}

export function RateList({ items, limit, onAll }: { items: ToRate[]; limit?: number; onAll?: () => void }) {
  if (!items.length) return null
  const shown = limit ? items.slice(0, limit) : items
  return (
    <Card style={{ borderColor: C.green, borderWidth: 2 }}>
      <View style={st.head}><Label>Waiting for your rating ({items.length})</Label>
        {!!onAll && items.length > shown.length && <Pressable onPress={onAll}><Text style={st.all}>See all ›</Text></Pressable>}</View>
      {shown.map(r => (
        <Pressable key={r.kind + r.id} onPress={() => router.push({ pathname: '/me/rate', params: { kind: r.kind, id: r.id, title: r.title } })} style={st.rateRow}>
          <Text style={st.body} numberOfLines={1}>{r.title}</Text><Text style={st.stars}>☆☆☆☆☆ ›</Text>
        </Pressable>
      ))}
    </Card>
  )
}

export function RequestList({ items, limit, onAll, onChanged }: { items: Req[]; limit?: number; onAll?: () => void; onChanged: () => void }) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const shown = limit ? items.slice(0, limit) : items
  return (
    <View style={{ gap: 8 }}>
      <View style={st.head}><Label>My requests{items.length ? ` (${items.length})` : ''}</Label>
        {!!onAll && items.length > shown.length && <Pressable onPress={onAll}><Text style={st.all}>See all ›</Text></Pressable>}</View>
      {!items.length && <Note>Nothing yet. Your bookings, orders and requests will show here.</Note>}
      <Err msg={err} />
      {shown.map(r => (
        <Pressable key={r.key} style={st.row} disabled={!r.url} onPress={() => r.url && Linking.openURL(r.url)}>
          <Text style={st.icon}>{r.icon}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={st.title} numberOfLines={1}>{r.title}</Text>
            <Text style={st.sub} numberOfLines={1}>{when(new Date(r.at).toISOString())} · {r.sub}</Text>
            {/* 0198: an upcoming booking can be cancelled here; the clinic sees it at once. */}
            {!!r.cancelId && (confirming === r.cancelId ? (
              <View style={st.btns}>
                <Btn small kind="danger" label="Yes, cancel it" onPress={async () => {
                  try { await cancelBooking(r.cancelId!); setConfirming(null); onChanged() } catch (e) { setErr((e as Error).message) }
                }} />
                <Btn small kind="ghost" label="Keep it" onPress={() => setConfirming(null)} />
              </View>
            ) : <Pressable onPress={() => setConfirming(r.cancelId!)}><Text style={st.cancel}>Cancel booking</Text></Pressable>)}
          </View>
          {!!r.url && <Text style={st.chev}>›</Text>}
        </Pressable>
      ))}
    </View>
  )
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  all: { color: C.green, fontWeight: '800' },
  body: { color: C.ink, fontSize: 14, flex: 1 },
  stars: { color: C.green, fontWeight: '800' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingVertical: 10, paddingHorizontal: 12 },
  icon: { fontSize: 20 },
  title: { fontWeight: '700', color: C.ink, fontSize: 14.5 },
  sub: { color: C.muted, fontSize: 12.5 },
  chev: { color: C.muted, fontSize: 20 },
  cancel: { color: '#b42318', fontWeight: '700', fontSize: 13, marginTop: 2 },
  btns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
})
