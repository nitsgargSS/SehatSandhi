import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { addCondition, getConditions, resolveCondition, HISTORY_SUGGESTIONS, type Condition } from '@web/lib/patientsApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from './kit'
import { C } from './theme'

// A patient's medical history on the phone — the website's "Medical history":
// long-term illnesses and past procedures (blood pressure, diabetes, a stent,
// an operation), tapped from the usual ones or typed, with "since when".
// Clinical staff only; the screen that shows this card decides that.
export default function HistoryCard({ biz, member, onChange }: { biz: string; member: string; onChange?: () => void }) {
  const [rows, setRows] = useState<Condition[]>([])
  const [adding, setAdding] = useState(false)
  const [what, setWhat] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => { getConditions(member, biz).then(r => setRows(r.filter(c => c.status === 'active'))).catch(e => setErr((e as Error).message)) }, [member, biz])
  useEffect(load, [load])
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); load(); onChange?.() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const left = HISTORY_SUGGESTIONS.filter(s => !rows.some(r => r.condition.toLowerCase() === s.toLowerCase()))

  return (
    <Card>
      <Label>Medical history</Label>
      {rows.length === 0 ? <Note>None recorded. That is not the same as none — ask.</Note> : rows.map(r => (
        <View key={r.id} style={st.row}>
          <Text style={st.body}><Text style={{ fontWeight: '700' }}>{r.condition}</Text>{r.notes ? ` · ${r.notes}` : ''}</Text>
          <Text style={st.remove} onPress={() => run(() => resolveCondition(r.id))}>Remove</Text>
        </View>
      ))}
      {!adding ? (
        <View style={st.wrap}><Btn small kind="ghost" label="+ Add to history" onPress={() => setAdding(true)} /></View>
      ) : (
        <View style={{ gap: 8 }}>
          <View style={st.wrap}>{left.map(s => <Chip key={s} label={s} on={what === s} onPress={() => setWhat(s)} />)}</View>
          <Field placeholder="Illness or procedure — tap one above or type" value={what} onChangeText={setWhat} />
          <Field placeholder="Since when / details (optional) — e.g. 10 years, stent 2021" value={note} onChangeText={setNote} maxLength={200} />
          <View style={st.wrap}>
            <Btn small label="Add" busy={busy} disabled={!what.trim()}
              onPress={() => run(async () => { await addCondition(member, biz, { condition: what.trim(), notes: note.trim() || undefined }); setWhat(''); setNote('') })} />
            <Btn small kind="ghost" label="Done" onPress={() => setAdding(false)} />
          </View>
        </View>
      )}
      <Err msg={err} />
    </Card>
  )
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 6 },
  body: { fontSize: 14, color: C.ink, flex: 1 },
  remove: { color: C.danger, fontWeight: '600', fontSize: 13 },
  wrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
})
