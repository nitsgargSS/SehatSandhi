import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useSession } from '../../../lib/session'
import { leadSummary, listLeads, LEAD_STATUS, type Lead, type LeadScope, type LeadSummary } from '@web/lib/insuranceApi'
import { Card, Chip, Err, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// An insurance advisor's leads (0192) — the website's Leads tab, same calls.
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

export default function LeadsScreen() {
  const { s, loading: sLoading, error: sErr } = useSession()
  const [sum, setSum] = useState<LeadSummary | null>(null)
  const [scope, setScope] = useState<LeadScope>('new')
  const [leads, setLeads] = useState<Lead[]>([])
  const [counts, setCounts] = useState<Partial<Record<LeadScope, number>>>({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const biz = s?.clinic?.id

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true)
    try {
      const scopes: LeadScope[] = ['new', 'active', 'done']
      const [x, ...all] = await Promise.all([leadSummary(biz), ...scopes.map(k => listLeads(biz, k))])
      setSum(x as LeadSummary)
      const lists = all as Lead[][]
      setCounts({ new: lists[0].length, active: lists[1].length, done: lists[2].length })
      setLeads(lists[scopes.indexOf(scope)])
      setErr('')
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [biz, scope])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

  if (sLoading && !s) return <View style={st.center}><Note>Loading…</Note></View>
  if (sErr) return <View style={st.center}><Err msg={sErr} /></View>
  if (!biz) return <View style={st.center}><Note>No listing is linked to this login.</Note></View>

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      {sum && (
        <Card>
          <Text style={st.bold}>Wallet ₹{(sum.balance_paise / 100).toLocaleString('en-IN')} · ₹{sum.lead_fee} per lead</Text>
          <Note>{sum.licence ? `IRDAI / POSP: ${sum.licence}` : 'Add your IRDAI licence or POSP code on the website (Business tab) to accept leads.'}</Note>
          {sum.areas === 0 && <Note>No areas chosen yet — set them on the website: Leads → Where you serve.</Note>}
          <Note>Top up the wallet on the website, Leads tab.</Note>
        </Card>
      )}
      <View style={st.chips}>
        {([['new', 'New'], ['active', 'In hand'], ['done', 'Closed']] as [LeadScope, string][]).map(([k, l]) =>
          <Chip key={k} label={`${l}${counts[k] ? ` · ${counts[k]}` : ''}`} on={scope === k} onPress={() => setScope(k)} />)}
      </View>
      <Err msg={err} />
      {!loading && leads.length === 0 && <Note>{scope === 'new' ? 'No new leads right now. You get an alert on this phone when one comes in.' : scope === 'active' ? 'No leads in hand.' : 'No closed leads in the last 90 days.'}</Note>}
      {leads.map(l => (
        <Pressable key={l.id} onPress={() => router.push({ pathname: '/lead/[id]', params: { id: l.id } })}>
          <Card>
            <View style={st.row}><Text style={st.code}>{l.code}</Text><Text style={st.pill}>{LEAD_STATUS[l.status]}</Text></View>
            <Text style={st.meta}>PIN {l.pin_code} · {ago(l.created_at)}{l.patient_name ? ` · ${l.patient_name}` : ''}</Text>
            <Text style={st.body} numberOfLines={2}>{l.cover || 'Health cover'}{l.members ? ` — ${l.members}` : ''}</Text>
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
  meta: { color: C.muted, fontSize: 13 },
  body: { color: C.ink },
  bold: { fontWeight: '700', color: C.ink, fontSize: 15 },
})
