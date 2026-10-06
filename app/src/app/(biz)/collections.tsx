import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useSession } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { getOutstanding, methodLabel, type Account } from '@web/lib/billingApi'
import { Card, Chip, Err, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// The day's tally (0159) — the website's Collections: every rupee taken (OPD,
// IPD, account, the pharmacy counter), by how and by whom, to count against the
// cash drawer, the UPI app and the card slips. sehat_collections decides who
// sees what: owner and manager everybody, anyone else only their own. Below it,
// who still owes the clinic money; tap to open them and take it.
type Range = 'today' | 'yesterday' | 'week'
const RANGE: [Range, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days']]
const METHOD_ORDER = ['cash', 'upi', 'credit_card', 'debit_card', 'card', 'netbanking', 'cheque', 'insurance', 'other']
interface Row {
  source: 'clinic' | 'pharmacy'; taken_at: string; amount: number; method: string; reference: string | null
  taken_by_name: string; customer_name: string | null; bill_no: string | null
}
const day = (o: number) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString('en-CA') }
const rs = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export default function Collections() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const everyone = !s?.role.enforced || s?.role.role === 'owner' || s?.role.role === 'manager'
  const [range, setRange] = useState<Range>('today')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [owed, setOwed] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true); setErr('')
    const from = range === 'today' ? day(0) : range === 'yesterday' ? day(-1) : day(-6)
    const to = range === 'yesterday' ? day(-1) : day(0)
    const { data, error } = await supabase.rpc('sehat_collections', { p_business: biz, p_from: from, p_to: to })
    if (error) { setErr(error.message); setRows([]) } else setRows(((data ?? []) as Row[]).map(r => ({ ...r, amount: Number(r.amount) })))
    getOutstanding(biz).then(a => setOwed(a.filter(x => Number(x.balance) > 0))).catch(() => setOwed([]))
    setLoading(false)
  }, [biz, range])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const all = rows ?? []
  const total = all.reduce((a, r) => a + r.amount, 0)
  const byMethod = METHOD_ORDER.map(m => [m, all.filter(r => r.method === m).reduce((a, r) => a + r.amount, 0)] as const).filter(([, v]) => v !== 0)
  const people = Array.from(new Set(all.map(r => r.taken_by_name)))
  const byPerson = people.map(p => [p, all.filter(r => r.taken_by_name === p).reduce((a, r) => a + r.amount, 0)] as const).sort((a, b) => b[1] - a[1])
  const owedTotal = owed.reduce((a, x) => a + Number(x.balance), 0)

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={st.row}>{RANGE.map(([k, l]) => <Chip key={k} label={l} on={range === k} onPress={() => setRange(k)} />)}</View>
      <Err msg={err} />
      <Card>
        <Label>{everyone ? 'Taken' : 'Taken by you'}</Label>
        <Text style={st.big}>{rows ? rs(total) : '…'}</Text>
        {byMethod.map(([m, v]) => <View key={m} style={st.line}><Text style={st.body}>{methodLabel(m)}</Text><Text style={st.num}>{rs(v)}</Text></View>)}
        {rows && !all.length && <Note>Nothing taken in this period.</Note>}
      </Card>
      {everyone && byPerson.length > 1 && (
        <Card>
          <Label>By person — for handing over cash</Label>
          {byPerson.map(([p, v]) => <View key={p} style={st.line}><Text style={st.body}>{p}</Text><Text style={st.num}>{rs(v)}</Text></View>)}
        </Card>
      )}
      {all.length > 0 && (
        <Card>
          <Label>Every payment ({all.length})</Label>
          {all.slice(0, 100).map((r, i) => (
            <View key={i} style={st.item}>
              <View style={{ flex: 1 }}>
                <Text style={st.body}>{r.customer_name ?? '—'}{r.source === 'pharmacy' ? ' · pharmacy' : ''}</Text>
                <Text style={st.meta}>{[new Date(r.taken_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }),
                  methodLabel(r.method), r.reference, everyone ? r.taken_by_name : null, r.bill_no].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={[st.num, r.amount < 0 && { color: C.danger }]}>{rs(r.amount)}</Text>
            </View>
          ))}
        </Card>
      )}
      <Card>
        <Label>Still owed {owed.length ? `— ${rs(owedTotal)}` : ''}</Label>
        {owed.length === 0 ? <Note>Nobody owes anything.</Note> : owed.slice(0, 50).map(a => (
          <Pressable key={a.patient_member_id} style={st.item} onPress={() => router.push({ pathname: '/patient/[member]', params: { member: a.patient_member_id } })}>
            <View style={{ flex: 1 }}>
              <Text style={st.body}>{a.patient_name}</Text>
              {!!a.last_charged && <Text style={st.meta}>last charged {new Date(a.last_charged).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Text>}
            </View>
            <Text style={[st.num, { color: C.danger }]}>{rs(Number(a.balance))}</Text>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  big: { fontSize: 26, fontWeight: '800', color: C.ink },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 6 },
  body: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  num: { fontSize: 14.5, fontWeight: '700', color: C.ink },
})
