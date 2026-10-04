import { useCallback, useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  leadSummary, listLeads, acceptLead, declineLead, markContacted, markWon, markLost, reportLead,
  LEAD_STATUS, LEAD_EVENT, type Lead,
} from '@web/lib/insuranceApi'
import { Btn, Card, Err, Field, Label, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// One insurance lead (0192): accept for the flat fee → call → bought / not
// bought, or report a problem within 7 days.
const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : ''

export default function LeadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { s } = useSession()
  const biz = s?.clinic?.id
  const [l, setL] = useState<Lead | null>(null)
  const [fee, setFee] = useState(0)
  const [note, setNote] = useState('')
  const [insurer, setInsurer] = useState('')
  const [plan, setPlan] = useState('')
  const [step, setStep] = useState<'won' | 'lost' | 'report' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!biz || !id) return
    try {
      const [sum, a, b, c] = await Promise.all([leadSummary(biz), listLeads(biz, 'new'), listLeads(biz, 'active'), listLeads(biz, 'done')])
      setFee(sum.lead_fee)
      setL([...a, ...b, ...c].find(x => x.id === id) ?? null)
      setErr('')
    } catch (e) { setErr((e as Error).message) }
  }, [biz, id])
  useEffect(() => { load() }, [load])

  const run = async (fn: () => Promise<Lead>) => {
    setBusy(true); setErr('')
    try { setL(await fn()); setStep(null) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!l) return <View style={st.center}>{err ? <Err msg={err} /> : <Note>Loading… (or this lead was taken by another advisor)</Note>}</View>

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={st.row}><Text style={st.code}>{l.code}</Text><Text style={st.pill}>{LEAD_STATUS[l.status]}</Text></View>
        <Note>PIN {l.pin_code} · {when(l.created_at)}</Note>
        <Label>Looking for</Label><Text style={st.body}>{l.cover || 'Health cover'}</Text>
        <Label>Who</Label><Text style={st.body}>{l.members || '—'}</Text>
        <Label>Call</Label><Text style={st.body}>{l.call_time || 'Any time'}</Text>
      </Card>

      {!!l.patient_phone && (
        <Card>
          <Text style={st.bold}>{l.patient_name}</Text>
          <Btn label={`Call +${l.patient_phone}`} onPress={() => Linking.openURL(`tel:+${l.patient_phone}`)} />
        </Card>
      )}
      {!!l.patient_not_called_at && <Note>⚠ They told us you haven't called yet.</Note>}
      <Err msg={err} />

      {l.status === 'open' && (
        <View style={st.row2}>
          <Btn label={`Accept for ₹${fee}`} busy={busy} onPress={() => run(() => acceptLead(biz!, l.id))} />
          <Btn kind="ghost" label="Not for me" busy={busy} onPress={() => run(() => declineLead(biz!, l.id))} />
        </View>
      )}

      {(l.status === 'accepted' || l.status === 'contacted') && (
        <Card>
          <Field label="Note (optional)" placeholder="e.g. called, sending quotes" value={note} onChangeText={setNote} />
          <Btn kind="ghost" label="Spoke to them" busy={busy} onPress={() => run(() => markContacted(biz!, l.id, note))} />
          <View style={st.row2}>
            <Btn small label="Policy bought" onPress={() => setStep('won')} />
            <Btn small kind="ghost" label="Not bought" onPress={() => setStep('lost')} />
            <Btn small kind="danger" label="Report a problem" onPress={() => setStep('report')} />
          </View>
          {step === 'won' && (
            <>
              <Field label="Insurer" placeholder="e.g. Star Health" value={insurer} onChangeText={setInsurer} />
              <Field label="Plan (optional)" value={plan} onChangeText={setPlan} />
              <Btn label="Save" busy={busy} disabled={!insurer.trim()} onPress={() => run(() => markWon(biz!, l.id, insurer.trim(), plan))} />
            </>
          )}
          {step === 'lost' && <Btn kind="ghost" label="Save as not bought (uses the note above)" busy={busy} onPress={() => run(() => markLost(biz!, l.id, note))} />}
          {step === 'report' && (
            <>
              <Note>Within 7 days of accepting. Put what's wrong in the note above — e.g. wrong number. If the lead was not genuine, ₹{fee} goes back to your wallet.</Note>
              <Btn kind="danger" label="Send report" busy={busy} disabled={!note.trim()} onPress={() => run(() => reportLead(biz!, l.id, note.trim()))} />
            </>
          )}
        </Card>
      )}

      {l.status === 'won' && <Note>Policy bought: {l.insurer}{l.plan_name ? ` · ${l.plan_name}` : ''}</Note>}
      {l.status === 'lost' && <Note>Not bought{l.lost_reason ? ` — ${l.lost_reason}` : ''}</Note>}
      {l.status === 'disputed' && <Note>Reported: {l.dispute_reason}. Sehatsandhi will review it.</Note>}
      {!!l.dispute_resolution && <Note>Report {l.dispute_resolution}</Note>}

      {!!l.events?.length && (
        <Card>
          <Label>History</Label>
          {l.events.map((e, i) => <Text key={i} style={st.ev}>{when(e.at)} — {LEAD_EVENT[e.event] ?? e.event}{e.by ? ` · ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</Text>)}
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
  code: { fontSize: 20, fontWeight: '800', color: C.ink },
  pill: { fontSize: 12, fontWeight: '700', color: C.muted, backgroundColor: '#f1efe9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  body: { color: C.ink, fontSize: 15 },
  bold: { fontWeight: '700', color: C.ink, fontSize: 15 },
  ev: { color: C.muted, fontSize: 12 },
})
