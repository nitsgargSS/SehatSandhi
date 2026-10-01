import { useCallback, useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  getOrder, acceptOrder, declineOrder, quoteOrder, dropOrder, packOrder, sendOut, markDelivered, deliveryPeople,
  ORDER_STATUS, EVENT_WORD, rupees, type MedicineOrder, type DeliveryPerson, type PayMode,
} from '@web/lib/medicineOrdersApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// One medicine order (0189): accept → price (medicines + delivery fee) →
// the patient approves → pack → send out → delivered. Every step is recorded
// against whoever is signed in.
const when = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : ''
const num = (v: string) => v.replace(/[^\d.]/g, '')

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { s } = useSession()
  const biz = s?.clinic?.id
  const delivery = s?.role.role === 'delivery'
  const [o, setO] = useState<MedicineOrder | null>(null)
  const [people, setPeople] = useState<DeliveryPerson[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [med, setMed] = useState('')
  const [fee, setFee] = useState('0')
  const [note, setNote] = useState('')
  const [rx, setRx] = useState(false)
  const [who, setWho] = useState<string>('')
  const [paid, setPaid] = useState('')
  const [mode, setMode] = useState<PayMode>('cash')
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState<'decline' | 'drop' | null>(null)

  const fill = (x: MedicineOrder) => {
    setO(x)
    if (x.quote_amount != null) setMed(String(x.quote_amount))
    if (x.delivery_fee != null) setFee(String(x.delivery_fee))
    if (x.quote_note) setNote(x.quote_note)
    setRx(x.rx_checked)
    if (x.total != null) setPaid(String(x.total))
    if (x.delivery_practitioner_id) setWho(x.delivery_practitioner_id)
  }
  const load = useCallback(async () => {
    if (!biz || !id) return
    try { fill(await getOrder(biz, id)); setErr('') } catch (e) { setErr((e as Error).message) }
  }, [biz, id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (biz && !delivery) deliveryPeople(biz).then(p => { setPeople(p); setWho(w => w || p.find(x => x.role === 'delivery')?.practitioner_id || '') }).catch(() => {})
  }, [biz, delivery])

  const run = async (fn: () => Promise<MedicineOrder>, after?: () => void) => {
    setBusy(true); setErr('')
    try { fill(await fn()); setAsking(null); after?.() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!o) return <View style={st.center}>{err ? <Err msg={err} /> : <Note>Loading…</Note>}</View>
  const total = (Number(med) || 0) + (Number(fee) || 0)

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={st.row}><Text style={st.code}>{o.code}</Text><Text style={st.pill}>{ORDER_STATUS[o.status]}</Text></View>
        <Note>PIN {o.pin_code} · {when(o.created_at)}</Note>
        <Label>Medicines</Label>
        <Text style={st.body}>{o.medicines || 'See the prescription photo.'}</Text>
        {o.has_prescription && (o.prescription_url
          ? <Btn small kind="ghost" label="Open prescription photo" onPress={() => Linking.openURL(o.prescription_url!)} />
          : <Note>Prescription photo attached — shown once you accept.</Note>)}
      </Card>

      {(o.patient_phone || o.address) && (
        <Card>
          <Text style={st.bold}>{o.patient_name}</Text>
          {o.address && <Text style={st.body}>{o.address}, {o.pin_code}</Text>}
          <View style={st.row2}>
            {o.patient_phone && <Btn small label={`Call +${o.patient_phone}`} onPress={() => Linking.openURL(`tel:+${o.patient_phone}`)} />}
            {o.address && <Btn small kind="ghost" label="Map" onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.address}, ${o.pin_code}`)}`)} />}
          </View>
        </Card>
      )}

      {o.quote_amount != null && (
        <Card>
          <View style={st.row}><Text style={st.body}>Medicines</Text><Text style={st.body}>{rupees(o.quote_amount)}</Text></View>
          <View style={st.row}><Text style={st.body}>Delivery</Text><Text style={st.body}>{o.delivery_fee ? rupees(o.delivery_fee) : 'Free'}</Text></View>
          <View style={st.row}><Text style={st.bold}>Total</Text><Text style={st.bold}>{rupees(o.total)}</Text></View>
          {o.quote_note && <Note>Note to patient: {o.quote_note}</Note>}
          {o.status === 'quoted' && <Note>Waiting for the patient to approve on their order link.</Note>}
        </Card>
      )}

      <Err msg={err} />

      {/* ── New ── */}
      {o.status === 'open' && !delivery && (asking === 'decline' ? (
        <Card>
          <Field label="Why? (optional)" placeholder="e.g. not in stock" value={reason} onChangeText={setReason} />
          <View style={st.row2}>
            <Btn kind="danger" label="Decline" busy={busy} onPress={() => run(() => declineOrder(biz!, o.id, reason), () => router.back())} />
            <Btn kind="ghost" label="Back" onPress={() => setAsking(null)} />
          </View>
        </Card>
      ) : (
        <View style={st.row2}>
          <Btn label="Accept order" busy={busy} onPress={() => run(() => acceptOrder(biz!, o.id))} />
          <Btn kind="ghost" label="Not for us" onPress={() => setAsking('decline')} />
        </View>
      ))}

      {/* ── Price ── */}
      {(o.status === 'accepted' || o.status === 'quoted') && !delivery && (
        <Card>
          <Text style={st.bold}>{o.status === 'quoted' ? 'Change the price' : 'Price this order'}</Text>
          <View style={st.row2}>
            <Field label="Medicines ₹" keyboardType="decimal-pad" value={med} onChangeText={v => setMed(num(v))} />
            <Field label="Delivery fee ₹" keyboardType="decimal-pad" value={fee} onChangeText={v => setFee(num(v))} />
          </View>
          <Note>Patient sees {rupees(Number(med) || 0)} + {Number(fee) ? rupees(Number(fee)) : 'free delivery'} = {rupees(total)}</Note>
          <Field label="Note to the patient (optional)" placeholder="e.g. substitute brand, 1 item short" value={note} onChangeText={setNote} />
          <Chip on={rx} onPress={() => setRx(v => !v)}
            label={`${rx ? '☑' : '☐'} Prescription-only (Schedule H/H1) medicines are backed by a valid prescription I have seen. No Schedule X.`} />
          <Btn label="Send price to patient" busy={busy} disabled={!(Number(med) > 0) || !rx}
            onPress={() => run(() => quoteOrder(biz!, o.id, Number(med), Number(fee) || 0, note, rx))} />
          <Btn kind="ghost" label="Give up order" onPress={() => setAsking('drop')} />
        </Card>
      )}

      {/* ── Approved: pack, send out ── */}
      {o.status === 'confirmed' && !delivery && (
        <View style={st.row2}>
          <Btn label="Mark packed" busy={busy} onPress={() => run(() => packOrder(biz!, o.id))} />
          <Btn kind="ghost" label="Give up order" onPress={() => setAsking('drop')} />
        </View>
      )}
      {(o.status === 'confirmed' || o.status === 'packed') && !delivery && (
        <Card>
          <Text style={st.bold}>Who takes it?</Text>
          <View style={st.chips}>
            <Chip label="Me" on={who === ''} onPress={() => setWho('')} />
            {people.map(p => <Chip key={p.practitioner_id} label={`${p.name}${p.role === 'delivery' ? '' : ' (helper)'}`} on={who === p.practitioner_id} onPress={() => setWho(p.practitioner_id)} />)}
          </View>
          <Btn label="Send out for delivery" busy={busy} onPress={() => run(() => sendOut(biz!, o.id, who || null))} />
        </Card>
      )}

      {asking === 'drop' && (
        <Card>
          <Field label="Why are you giving it up?" placeholder="e.g. medicine not available" value={reason} onChangeText={setReason} />
          <View style={st.row2}>
            <Btn kind="danger" label="Pass to another pharmacy" busy={busy} disabled={!reason.trim()} onPress={() => run(() => dropOrder(biz!, o.id, reason.trim()), () => router.back())} />
            <Btn kind="ghost" label="Back" onPress={() => setAsking(null)} />
          </View>
        </Card>
      )}

      {/* ── Delivered ── */}
      {(o.status === 'out_for_delivery' || (o.status === 'packed' && !delivery)) && (
        <Card>
          <Text style={st.bold}>Delivered?{o.delivery_name ? ` (with ${o.delivery_name})` : ''}</Text>
          <Field label="Collected ₹" keyboardType="decimal-pad" value={paid} onChangeText={v => setPaid(num(v))} />
          <View style={st.chips}>
            {(['cash', 'upi', 'card', 'other'] as PayMode[]).map(m => <Chip key={m} label={m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)} on={mode === m} onPress={() => setMode(m)} />)}
          </View>
          <Btn label="Mark delivered" busy={busy} disabled={paid === ''} onPress={() => run(() => markDelivered(biz!, o.id, Number(paid), mode))} />
        </Card>
      )}

      {o.status === 'delivered' && (
        <Card>
          <Text style={st.body}>Delivered {when(o.delivered_at)} by {o.delivered_by_name} · {rupees(o.collected_amount)} {o.collected_mode?.toUpperCase()}</Text>
          {!!o.rating && <Text style={st.body}>Patient: {'★'.repeat(o.rating)}{'☆'.repeat(5 - o.rating)}{o.review ? ` “${o.review}”` : ''}</Text>}
        </Card>
      )}
      {(o.status === 'cancelled' || o.status === 'expired') && <Note>{o.ended_reason}</Note>}

      {!!o.events?.length && (
        <Card>
          <Label>Who did what</Label>
          {o.events.map((e, i) => <Text key={i} style={st.ev}>{when(e.at)} — {EVENT_WORD[e.event] ?? e.event}{e.by ? ` · ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</Text>)}
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
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  code: { fontSize: 20, fontWeight: '800', color: C.ink },
  pill: { fontSize: 12, fontWeight: '700', color: C.muted, backgroundColor: '#f1efe9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  body: { color: C.ink, fontSize: 15 },
  bold: { fontWeight: '700', color: C.ink, fontSize: 15 },
  ev: { color: C.muted, fontSize: 12 },
})
