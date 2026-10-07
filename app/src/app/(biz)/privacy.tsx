import { useCallback, useEffect, useState } from 'react'
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, useFocusEffect } from 'expo-router'
import { useSession } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// Privacy requests on the phone — the website's admin Privacy tab
// (src/pages/admin/PrivacyRequestsPanel.tsx, 0174), same calls: acknowledge
// (with a ready WhatsApp reply) → verify identity → look up what we hold →
// mark forwarded to clinics that hold records → schedule erasure (04:00 IST,
// cancellable until then) → resolve or refuse with the reply on record. Every
// step is logged with who did it. Clinic records are never erased from here.
type Kind = 'access' | 'correct' | 'erase' | 'withdraw' | 'nominate' | 'grievance' | 'other'
type Status = 'received' | 'acknowledged' | 'verified' | 'erase_scheduled' | 'erased' | 'done' | 'rejected'
interface Req {
  id: string; ref: string; created_at: string; kind: Kind; name: string; phone: string | null; email: string | null
  on_behalf: string; details: string | null; channel: string; status: Status
  ack_due_at: string; resolve_due_at: string; acknowledged_at: string | null; verified_at: string | null
  verification_method: string | null; forwarded: { business_id: string; name: string; at: string; by: string }[]
  erase_scheduled_at: string | null; erased_at: string | null; erase_result: Record<string, unknown> | null
  resolved_at: string | null; resolution: string | null
}
interface Ev { id: number; at: string; actor: string; action: string; note: string | null }
interface Lookup {
  patient: { name: string | null; since: string; area: string | null } | null
  members: { name: string; relation: string }[]
  clinics: { business_id: string; name: string; phone: string | null; forwarded: boolean; visits: number; prescriptions: number; bills: number; appointments: number }[]
  platform: Record<string, number | boolean>
}
const KIND_LABEL: Record<Kind, string> = {
  access: 'See my data', correct: 'Correct my data', erase: 'Delete my data', withdraw: 'Withdraw consent / stop messages',
  nominate: 'Nominate someone', grievance: 'Grievance', other: 'Not classified yet',
}
const STATUS_LABEL: Record<Status, string> = {
  received: 'New', acknowledged: 'Acknowledged', verified: 'Identity verified', erase_scheduled: 'Erasure tonight',
  erased: 'Erased — send the reply', done: 'Resolved', rejected: 'Refused',
}
const PLATFORM_LABEL: Record<string, string> = {
  contact_messages: 'Contact-page messages', messages_sent: 'Messages we sent', notifications: 'Queued notifications',
  whatsapp_contact: 'WhatsApp contact record', whatsapp_sessions: 'WhatsApp conversations', typed_messages: 'Typed messages',
  ratings: 'Ratings given', insurance_leads: 'Insurance leads', doctor_leads: 'Doctor leads',
  marketing_consents: 'Clinics allowed to send promotions', opted_out: 'On the STOP list', business_owner: 'Owns a listed business',
}
const METHODS = ['Called back on the same number', 'Code sent on WhatsApp and read back', 'Email from the same address', 'ID document seen', 'In person']
const isOpen = (r: Req) => !['done', 'rejected'].includes(r.status)
const hoursLeft = (iso: string) => (new Date(iso).getTime() - Date.now()) / 3.6e6
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

function due(r: Req): { text: string; bad: boolean } | null {
  if (!isOpen(r)) return null
  if (!r.acknowledged_at) { const h = hoursLeft(r.ack_due_at); return { text: h < 0 ? `Acknowledgement overdue ${Math.ceil(-h)}h` : `Acknowledge within ${Math.ceil(h)}h`, bad: h < 6 } }
  const d = hoursLeft(r.resolve_due_at) / 24
  return { text: d < 0 ? `Overdue by ${Math.ceil(-d)} days` : `Resolve within ${Math.ceil(d)} days`, bad: d < 3 }
}
const ackText = (r: Req) =>
  `Namaste ${r.name.split(' ')[0]}, we have received your privacy request (${r.ref}) and will complete it by `
  + `${new Date(r.resolve_due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}. `
  + `We may call this number to confirm it is you. — Sehatsandhi\n\n`
  + `नमस्ते, आपका प्राइवेसी अनुरोध (${r.ref}) हमें मिल गया है। हम इसे ${new Date(r.resolve_due_at).toLocaleDateString('hi-IN', { day: 'numeric', month: 'long' })} तक पूरा करेंगे। पहचान की पुष्टि के लिए हम इस नंबर पर कॉल कर सकते हैं। — Sehatsandhi`

export default function Privacy() {
  const { s } = useSession()
  const [rows, setRows] = useState<Req[]>([])
  const [all, setAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('privacy_requests').select('*').order('created_at', { ascending: false }).limit(300)
    setLoading(false)
    if (error) setErr(error.message); else { setErr(''); setRows((data ?? []) as Req[]) }
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))
  if (s && !s.isAdmin) return <Redirect href="/" />

  const shown = all ? rows : rows.filter(isOpen)
  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
      <View style={st.row}>
        <Chip label={`Open (${rows.filter(isOpen).length})`} on={!all} onPress={() => setAll(false)} />
        <Chip label={`All (${rows.length})`} on={all} onPress={() => setAll(true)} />
        <Chip label="+ Log a request" on={adding} onPress={() => setAdding(!adding)} />
      </View>
      <Err msg={err} />
      {adding && <NewRequest onDone={id => { setAdding(false); setOpenId(id); load() }} />}
      {shown.map(r => {
        const d = due(r)
        return (
          <Card key={r.id}>
            <Pressable onPress={() => setOpenId(openId === r.id ? null : r.id)} style={{ gap: 3 }}>
              <View style={st.between}>
                <Text style={st.name}>{r.name}</Text>
                <Text style={st.meta}>{r.ref}</Text>
              </View>
              <Text style={st.body}>{KIND_LABEL[r.kind]} · {STATUS_LABEL[r.status]}</Text>
              <Text style={st.meta}>{when(r.created_at)} · via {r.channel}</Text>
              {d && <Text style={[st.due, d.bad && { color: C.danger }]}>{d.text}</Text>}
            </Pressable>
            {openId === r.id && <Detail r={r} onChanged={load} />}
          </Card>
        )
      })}
      {!shown.length && <Note>{loading ? 'Loading…' : 'No open privacy requests.'}</Note>}
    </ScrollView>
  )
}

function Detail({ r, onChanged }: { r: Req; onChanged: () => void }) {
  const [events, setEvents] = useState<Ev[]>([])
  const [look, setLook] = useState<Lookup | null>(null)
  const [note, setNote] = useState('')
  const [method, setMethod] = useState(METHODS[0])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const loadEvents = useCallback(() => {
    supabase.from('privacy_request_events').select('*').eq('request_id', r.id).order('at').then(({ data }) => setEvents((data ?? []) as Ev[]))
  }, [r.id])
  useEffect(loadEvents, [loadEvents, r.status])
  const act = async (action: string, extra?: string | null, withNote = false) => {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('sehat_privacy_action', { p_id: r.id, p_action: action, p_note: withNote ? note : null, p_extra: extra ?? null })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (withNote) setNote('')
    onChanged(); loadEvents()
  }
  const lookup = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('sehat_privacy_lookup', { p_id: r.id })
    setBusy(false)
    if (error) setErr(error.message); else { setLook(data as Lookup); loadEvents() }
  }
  const open = isOpen(r)

  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      <Text style={st.body}>{[r.phone && `+${r.phone}`, r.email].filter(Boolean).join(' · ')} · {r.on_behalf === 'self' ? 'for themselves' : `as ${r.on_behalf}`}</Text>
      {!!r.details && <Text style={st.box}>{r.details}</Text>}
      {r.verified_at && <Text style={st.ok}>✓ Identity verified — {r.verification_method}</Text>}
      {open && <>
        <Text style={st.meta}>Type</Text>
        <View style={st.row}>{(Object.keys(KIND_LABEL) as Kind[]).map(k => <Chip key={k} label={KIND_LABEL[k]} on={r.kind === k} onPress={() => k !== r.kind && act('set_kind', k)} />)}</View>
        {!r.acknowledged_at && <View style={st.row}>
          {!!r.phone && <Btn small label="Acknowledge on WhatsApp" busy={busy}
            onPress={() => { Linking.openURL(`https://wa.me/${r.phone}?text=${encodeURIComponent(ackText(r))}`); act('acknowledge') }} />}
          <Btn small kind="ghost" label="Mark acknowledged" onPress={() => act('acknowledge')} />
        </View>}
        {!r.verified_at && <>
          <Text style={st.meta}>How was identity checked?</Text>
          <View style={st.row}>{METHODS.map(m => <Chip key={m} label={m} on={method === m} onPress={() => setMethod(m)} />)}</View>
          <Btn small kind="ghost" label="Identity verified" busy={busy} onPress={() => act('verify', method)} />
        </>}
        <View style={st.row}>
          <Btn small kind="ghost" label="Look up what we hold" busy={busy} onPress={lookup} />
          {r.status === 'erase_scheduled'
            ? <Btn small kind="danger" label="Cancel tonight's erasure" onPress={() => act('cancel_erase')} />
            : r.status !== 'erased' && <Btn small kind="danger" label="Schedule erasure" disabled={!r.verified_at}
                onPress={() => Alert.alert('Schedule erasure?', 'Erase everything Sehatsandhi holds for this person tonight at 04:00? Clinic records are not touched.',
                  [{ text: 'Back', style: 'cancel' }, { text: 'Schedule', style: 'destructive', onPress: () => act('schedule_erase') }])} />}
        </View>
        {!r.verified_at && r.status !== 'erase_scheduled' && <Note>Verify identity before scheduling erasure.</Note>}
      </>}
      {r.status === 'erase_scheduled' && <Text style={st.warn}>Erasure runs tonight at 04:00 IST and can be cancelled until then. Forward the request to the clinics below.</Text>}
      {r.erase_result && <Text style={st.box}>{'error' in r.erase_result ? 'Erasure failed — nothing was changed: ' : `Erased ${r.erased_at ? when(r.erased_at) : ''}: `}
        {Object.entries(r.erase_result).map(([k, v]) => `${PLATFORM_LABEL[k] ?? k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</Text>}

      {look && (
        <View style={st.boxV}>
          <Text style={st.body}><Text style={st.b}>Patient record: </Text>{look.patient ? `${look.patient.name ?? '—'} · since ${look.patient.since}${look.patient.area ? ` · ${look.patient.area}` : ''}` : 'none'}
            {look.members.length > 0 ? ` · family: ${look.members.map(m => `${m.name} (${m.relation})`).join(', ')}` : ''}</Text>
          <Text style={st.meta}>{Object.entries(look.platform).filter(([, v]) => v !== 0 && v !== false).map(([k, v]) => `${PLATFORM_LABEL[k] ?? k}: ${v === true ? 'yes' : v}`).join(' · ') || 'Nothing else held by Sehatsandhi.'}</Text>
          {look.clinics.length > 0 && <Text style={st.b}>Clinics that hold records (they decide on their records — forward the request)</Text>}
          {look.clinics.map(cl => {
            const done = cl.forwarded || r.forwarded.some(f => f.business_id === cl.business_id)
            return (
              <View key={cl.business_id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 4 }}>
                <Text style={st.body}><Text style={st.b}>{cl.name}</Text>{cl.phone ? ` · +${cl.phone}` : ''}</Text>
                <Text style={st.meta}>{cl.visits} visits · {cl.prescriptions} prescriptions · {cl.bills} bills · {cl.appointments} appointments</Text>
                {done ? <Text style={st.ok}>✓ forwarded</Text> : open && <Text style={st.link} onPress={() => act('forward', cl.business_id)}>Mark forwarded</Text>}
              </View>
            )
          })}
        </View>
      )}

      {open ? <>
        <Field placeholder="The reply you sent (for Resolve / Refuse), or a note" value={note} onChangeText={setNote} multiline />
        <View style={st.row}>
          <Btn small label="Resolve with this reply" disabled={busy || !note.trim()} onPress={() => act('resolve', null, true)} />
          <Btn small kind="ghost" label="Refuse with this reason" disabled={busy || !note.trim()} onPress={() => act('reject', null, true)} />
          <Btn small kind="ghost" label="Add note" disabled={busy || !note.trim()} onPress={() => act('note', null, true)} />
        </View>
      </> : !!r.resolution && <Text style={st.body}><Text style={st.b}>{r.status === 'done' ? 'Reply: ' : 'Refused: '}</Text>{r.resolution}</Text>}
      <Err msg={err} />
      {events.length > 0 && <View style={{ gap: 2 }}>
        <Text style={st.meta}>History</Text>
        {events.map(e => <Text key={e.id} style={st.meta}>{when(e.at)} · {e.actor} · {e.action.replace(/_/g, ' ')}{e.note ? ` — ${e.note}` : ''}</Text>)}
      </View>}
    </View>
  )
}

function NewRequest({ onDone }: { onDone: (id: string) => void }) {
  const [f, setF] = useState({ kind: 'other' as Kind, name: '', phone: '', email: '', on_behalf: 'self', channel: 'whatsapp', details: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (f.name.trim().length < 2) { setErr('Name is needed.'); return }
    if (!f.phone.trim() && !f.email.trim()) { setErr('A phone number or an email is needed.'); return }
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('sehat_privacy_create', {
      p_kind: f.kind, p_name: f.name.trim(), p_phone: f.phone.trim() || null, p_email: f.email.trim() || null,
      p_on_behalf: f.on_behalf, p_details: f.details.trim() || null, p_channel: f.channel })
    setBusy(false)
    if (error) setErr(error.message); else onDone(data as string)
  }
  return (
    <Card>
      <Label>Log a privacy request</Label>
      <View style={st.row}>{(Object.keys(KIND_LABEL) as Kind[]).map(k => <Chip key={k} label={KIND_LABEL[k]} on={f.kind === k} onPress={() => setF({ ...f, kind: k })} />)}</View>
      <Field label="Name" value={f.name} onChangeText={t => setF({ ...f, name: t })} />
      <Field label="Mobile" value={f.phone} keyboardType="phone-pad" onChangeText={t => setF({ ...f, phone: t.replace(/[^\d+ ]/g, '') })} />
      <Field label="Email" value={f.email} keyboardType="email-address" autoCapitalize="none" onChangeText={t => setF({ ...f, email: t })} />
      <Text style={st.meta}>Asking for</Text>
      <View style={st.row}>{[['self', 'Themselves'], ['guardian', 'As parent / guardian'], ['nominee', 'As nominee']].map(([k, l]) =>
        <Chip key={k} label={l} on={f.on_behalf === k} onPress={() => setF({ ...f, on_behalf: k })} />)}</View>
      <Text style={st.meta}>Came in by</Text>
      <View style={st.row}>{['whatsapp', 'phone', 'email', 'in_person'].map(k =>
        <Chip key={k} label={k.replace('_', ' ')} on={f.channel === k} onPress={() => setF({ ...f, channel: k })} />)}</View>
      <Field label="What they asked" value={f.details} onChangeText={t => setF({ ...f, details: t })} multiline />
      <Err msg={err} />
      <Btn label="Log request" busy={busy} onPress={save} />
    </Card>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 15.5, fontWeight: '800', color: C.ink, flexShrink: 1 },
  body: { fontSize: 14, color: C.ink },
  b: { fontWeight: '800', color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  due: { fontSize: 12.5, fontWeight: '700', color: C.muted },
  ok: { color: C.green, fontWeight: '700' },
  warn: { color: '#92400e', fontSize: 13 },
  link: { color: C.green, fontWeight: '700' },
  box: { fontSize: 13.5, color: C.ink, backgroundColor: '#f7f4ec', borderRadius: 8, padding: 8 },
  boxV: { gap: 6, backgroundColor: '#f7f4ec', borderRadius: 8, padding: 8 },
})
