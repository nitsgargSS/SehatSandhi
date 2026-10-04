import { useCallback, useEffect, useState } from 'react'
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, router, useFocusEffect } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  getBoard, callNext, setTokenStatus, tokenVisit, reopenToken, visitHasDiagnosis, type QueueEntry,
} from '@web/lib/queueApi'
import { Btn, Card, Chip, Err, Label, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// Today's line — the website's Queue (src/pages/doctor/Queue.tsx), same calls.
// A doctor opens on their own patients; everyone else on the whole clinic.
const time = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : ''

export default function QueueScreen() {
  const { s, loading: sLoading, error: sErr } = useSession()
  const [board, setBoard] = useState<QueueEntry[]>([])
  const [mine, setMine] = useState(true)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const biz = s?.clinic?.id
  const onlyMine = mine && !!s?.doctorId

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true)
    try { setBoard(await getBoard(biz)); setErr('') } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [biz])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t) }, [load])

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setErr('')
    try { await fn(); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const confirm = (title: string, msg: string, yes: string) =>
    new Promise<boolean>(res => Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: yes, onPress: () => res(true) }]))

  const consult = (e: QueueEntry) => act(e.id, async () => {
    const v = await tokenVisit(e.id)
    if (e.status === 'waiting' || e.status === 'called') await setTokenStatus(e.id, 'in_consultation', v.visit_id)
    router.push({ pathname: '/consult/[token]', params: { token: e.id, visit: v.visit_id, member: v.patient_member_id, doctor: v.practitioner_id ?? '' } })
  })
  const finish = (e: QueueEntry) => act(e.id, async () => {
    const ok = e.visit_id ? await visitHasDiagnosis(e.visit_id) : false
    if (!ok && !(await confirm('No diagnosis yet', e.visit_id
      ? `No diagnosis is recorded for ${e.patient_name}. Mark done anyway?`
      : `The consultation for ${e.patient_name} was never opened. Mark done anyway?`, 'Mark done'))) return
    await setTokenStatus(e.id, 'completed')
  })

  if (sLoading && !s) return <View style={st.center}><Note>Loading…</Note></View>
  if (sErr) return <View style={st.center}><Err msg={sErr} /></View>
  if (!biz) return <View style={st.center}><Note>No clinic is linked to this login.</Note></View>
  // 0189: sign-in lands here; a pharmacy's home is its orders.
  if (s?.clinic?.vertical === 'pharmacy') return <Redirect href="/orders" />
  if (s?.clinic?.vertical === 'ambulance') return <Redirect href="/trips" />
  if (s?.clinic?.vertical === 'insurance') return <Redirect href="/leads" />

  const shown = board.filter(e => !onlyMine || e.practitioner_id === s?.doctorId)
  const now = shown.filter(e => e.status === 'called' || e.status === 'in_consultation')
  const waiting = shown.filter(e => e.status === 'waiting')
  const done = shown.filter(e => e.status === 'completed' || e.status === 'left' || e.status === 'skipped')

  const Row = ({ e }: { e: QueueEntry }) => (
    <View style={st.row}>
      <Text style={st.name}>
        <Text style={st.tok}>#{e.token_number} </Text>{e.patient_name}
        {e.priority > 0 ? <Text style={st.flag}>  out of turn</Text> : null}
      </Text>
      <Text style={st.meta}>
        {[e.age_years != null ? `${e.age_years}y` : null, e.gender, !onlyMine ? e.practitioner_name : null,
          e.status === 'waiting' && e.approx_wait_minutes ? `~${e.approx_wait_minutes} min` : null,
          e.status === 'called' ? `called ${time(e.called_at)}` : null, e.status === 'in_consultation' ? 'with doctor' : null].filter(Boolean).join(' · ')}
      </Text>
      {!!e.reason && <Text style={st.reason}>{e.reason}</Text>}
      <View style={st.btns}>
        {s?.clinical && <Btn small label="Consult" onPress={() => consult(e)} busy={busy === e.id} />}
        {e.status === 'called' && <Btn small kind="ghost" label="No answer" onPress={() => act(e.id, () => setTokenStatus(e.id, 'waiting'))} />}
        {e.status === 'in_consultation' && <Btn small kind="ghost" label="Done" onPress={() => finish(e)} />}
        {e.status === 'waiting' && <Btn small kind="danger" label="Left" onPress={async () => {
          if (await confirm('Patient left?', `Mark ${e.patient_name} as left without being seen? You can bring them back from Finished.`, 'Mark left'))
            act(e.id, () => setTokenStatus(e.id, 'left'))
        }} />}
      </View>
    </View>
  )

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={st.top}>
        {!!s?.doctorId && (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Chip label="My patients" on={mine} onPress={() => setMine(true)} />
            <Chip label="Everyone" on={!mine} onPress={() => setMine(false)} />
          </View>
        )}
        <Btn small label="Call next" busy={busy === 'next'} onPress={() => act('next', () => callNext(biz, onlyMine ? s?.doctorId : null))} />
      </View>
      <Err msg={err} />

      {now.length > 0 && <Card><Label>Now</Label>{now.map(e => <Row key={e.id} e={e} />)}</Card>}
      <Card>
        <Label>Waiting {waiting.length ? `(${waiting.length})` : ''}</Label>
        {waiting.length === 0 ? <Note>Nobody is waiting. Pull down to refresh.</Note> : waiting.map(e => <Row key={e.id} e={e} />)}
      </Card>
      {done.length > 0 && (
        <Card>
          <Label>Finished ({done.length})</Label>
          {done.map(e => (
            <View key={e.id} style={st.doneRow}>
              <Text style={{ color: C.muted, flex: 1 }}>
                <Text style={{ color: C.ink, fontWeight: '700' }}>#{e.token_number}</Text> {e.patient_name} · {e.status === 'completed' ? `seen ${time(e.completed_at)}` : e.status === 'skipped' ? 'did not answer' : 'left'}
              </Text>
              {s?.clinical && <Btn small kind="ghost" label="Open" onPress={() => consult(e)} />}
              <Btn small kind="ghost" label="Bring back" busy={busy === e.id} onPress={() => act(e.id, () => reopenToken(e.id))} />
            </View>
          ))}
        </Card>
      )}
      <Note>Give tokens and register new patients from the computer — Patients → Register.</Note>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  row: { borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 10, gap: 3 },
  name: { fontSize: 16, fontWeight: '700', color: C.ink },
  tok: { color: C.green, fontWeight: '800' },
  flag: { color: C.danger, fontSize: 12, fontWeight: '700' },
  meta: { fontSize: 13, color: C.muted },
  reason: { fontSize: 13.5, color: C.ink },
  btns: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 8 },
})
