import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  counterInvoice, getCharges, listPriceItems, methodLabel, HEAD_LABELS, INVOICE_GST_RATES, PAYMENT_METHOD_OPTIONS,
  type Charge, type ChargeCategory, type PaymentMethod, type PriceItem,
} from '@web/lib/billingApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from './kit'
import PaySplit from './PaySplit'
import { type PayRow, payRow, payProblem, payTotal, toPayments } from '@web/lib/splitPayments'
import SendSheet from './SendSheet'
import { C } from './theme'

// An invoice at the counter, on the phone — the website's "New invoice"
// (src/pages/doctor/CounterInvoice.tsx): the tests done and things sold today,
// from the clinic's price list or typed, with GST on a line if the biller
// charges it, a discount, and the money taken, in one step. It makes the same
// charges, numbered bill and payment, so Collections counts it like the rest.
// The price list itself is kept on the computer (owner or manager).

// What a line can be. Bed days are posted from the stay, so they are not offered.
const KINDS: ChargeCategory[] = ['lab', 'procedure', 'product', 'consultation', 'medicine', 'consumable', 'other']

interface Line { key: number; category: ChargeCategory; description: string; quantity: string; unitPrice: string; gst: number }
const blank = (key: number): Line => ({ key, category: 'lab', description: '', quantity: '1', unitPrice: '', gst: 0 })
const num = (s: string) => Number(s) || 0
const paise = (n: number) => Math.round(n * 100) / 100
const rs = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** A line before tax, its tax, and what the patient pays for it. */
const lineOf = (l: Line) => {
  const base = paise(num(l.quantity || '1') * num(l.unitPrice))
  const total = paise(base * (1 + l.gst / 100))
  return { base, tax: paise(total - base), total }
}

export default function InvoiceCard({ biz, member, recordedBy, onDone }: {
  biz: string; member: string; recordedBy: string | null
  /** An invoice was made: the bill card above should read the account again. */
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PriceItem[]>([])
  const [charges, setCharges] = useState<Charge[]>([])
  const [lines, setLines] = useState<Line[]>([blank(1)])
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [discount, setDiscount] = useState('')
  const [reason, setReason] = useState('')
  // 0301: one payment or several. Until the biller touches it, it is one payment of the whole total.
  const [pays, setPays] = useState<PayRow<PaymentMethod>[]>(() => [payRow<PaymentMethod>('cash')])
  const [follow, setFollow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ id: string; billNo: string; net: number; paid: number } | null>(null)
  const [sent, setSent] = useState('')

  const load = useCallback(() => {
    listPriceItems(biz).then(setItems).catch(() => setItems([]))
    getCharges(member, biz).then(setCharges).catch(() => setCharges([]))
  }, [biz, member])
  useEffect(() => { if (open) load() }, [open, load])

  // Already on the account and not yet on a bill — today's OPD fee, usually.
  const unbilled = charges.filter(c => !c.bill_id && !c.admission_id)
  const carried = unbilled.filter(c => !skip.has(c.id))
  const filled = lines.filter(l => l.description.trim() && l.unitPrice.trim() !== '')
  const subtotal = paise(filled.reduce((s, l) => s + lineOf(l).total, 0) + carried.reduce((s, c) => s + Number(c.amount), 0))
  const gstTotal = paise(filled.reduce((s, l) => s + lineOf(l).tax, 0))
  const net = paise(subtotal - num(discount))
  useEffect(() => { if (follow) setPays(ps => [{ ...ps[0], amount: net > 0 ? String(net) : '' }]) }, [follow, net])
  const paying = paise(payTotal(pays))
  const payErr = payProblem(pays, net)
  const valid = (filled.length > 0 || carried.length > 0) && net >= 0 && !payErr
    && (num(discount) === 0 || reason.trim().length > 2)

  const set = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l))
  const pick = (key: number, it: PriceItem) => set(key, { category: it.category, description: it.name, unitPrice: String(it.price), gst: it.gst_rate })
  const reset = () => { setLines([blank(Date.now())]); setSkip(new Set()); setDiscount(''); setReason(''); setPays([payRow<PaymentMethod>('cash')]); setFollow(true) }

  const create = async () => {
    setBusy(true); setErr(''); setSent('')
    try {
      const r = await counterInvoice({
        businessId: biz, memberId: member,
        lines: filled.map(l => ({ category: l.category, description: l.description.trim(), quantity: num(l.quantity || '1') || 1, unitPrice: num(l.unitPrice), gstRate: l.gst })),
        chargeIds: carried.map(c => c.id),
        discount: num(discount), discountReason: reason.trim(),
        payments: toPayments(pays), recordedBy,
      })
      setDone({ id: r.bill_id, billNo: r.bill_no, net: Number(r.net), paid: Number(r.paid) })
      reset(); load(); onDone()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <Card>
        <Label>New invoice</Label>
        <Note>Tests, procedures and things sold — with the payment, in one step.</Note>
        <View style={st.row}><Btn small label="New invoice" onPress={() => { setOpen(true); setDone(null); setSent('') }} /></View>
      </Card>
    )
  }

  return (
    <Card>
      <View style={st.head}>
        <Label>New invoice</Label>
        <Text style={st.link} onPress={() => setOpen(false)}>Close</Text>
      </View>

      {done && (
        <View style={st.done}>
          <Text style={st.ok}>✓ {done.billNo} made — {rs(done.net)}{done.paid > 0 ? `, ${rs(done.paid)} received` : ', nothing received yet'}</Text>
          <View style={st.row}>
            <SendSheet kind="bill" id={done.id} biz={biz} label="Send to the patient" onSent={note => setSent(`${done.billNo}: ${note}`)} />
          </View>
          {!!sent && <Text style={st.ok}>{sent}</Text>}
        </View>
      )}

      {unbilled.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={st.sub}>Already on the account — tap to leave off this invoice</Text>
          <View style={st.row}>
            {unbilled.map(c => (
              <Chip key={c.id} on={!skip.has(c.id)} label={`${c.description} · ${rs(Number(c.amount))}`}
                onPress={() => setSkip(s => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })} />
            ))}
          </View>
        </View>
      )}

      {lines.map((l, idx) => {
        const q = l.description.trim().toLowerCase()
        // The price list, narrowed by what is typed; hidden once a line matches an item exactly.
        const matches = items.filter(i => !q || i.name.toLowerCase().includes(q)).slice(0, 6)
        const exact = items.some(i => i.name.toLowerCase() === q)
        const t = lineOf(l)
        return (
          <View key={l.key} style={st.line}>
            <View style={st.head}>
              <Text style={st.sub}>Item {idx + 1}</Text>
              {lines.length > 1 && <Text style={[st.link, { color: C.danger }]} onPress={() => setLines(ls => ls.filter(x => x.key !== l.key))}>Remove</Text>}
            </View>
            <Field placeholder="Test, procedure or item — type to search your price list" value={l.description}
              onChangeText={v => set(l.key, { description: v })} />
            {!exact && matches.length > 0 && (
              <View style={st.row}>
                {matches.map(i => <Chip key={i.id} label={`${i.name} · ${rs(i.price)}`} onPress={() => pick(l.key, i)} />)}
              </View>
            )}
            <View style={st.row}>
              {KINDS.map(k => <Chip key={k} label={HEAD_LABELS[k]} on={l.category === k} onPress={() => set(l.key, { category: k })} />)}
            </View>
            <View style={st.two}>
              <View style={{ flex: 1 }}><Field label="Qty" keyboardType="number-pad" value={l.quantity} onChangeText={v => set(l.key, { quantity: v.replace(/[^0-9.]/g, '') })} /></View>
              <View style={{ flex: 2 }}><Field label="Rate (₹, before GST)" keyboardType="decimal-pad" value={l.unitPrice} onChangeText={v => set(l.key, { unitPrice: v.replace(/[^0-9.]/g, '') })} /></View>
            </View>
            <View style={st.row}>
              <Text style={st.meta}>GST</Text>
              {INVOICE_GST_RATES.map(g => <Chip key={g} label={`${g}%`} on={l.gst === g} onPress={() => set(l.key, { gst: g })} />)}
            </View>
            {t.total > 0 && <Text style={st.meta}>{rs(t.base)}{t.tax > 0 ? ` + GST ${rs(t.tax)}` : ''} = <Text style={{ fontWeight: '800', color: C.ink }}>{rs(t.total)}</Text></Text>}
          </View>
        )
      })}
      <View style={st.row}><Btn small kind="ghost" label="+ Add another item" onPress={() => setLines(ls => [...ls, blank(Date.now())])} /></View>
      {items.length === 0 && <Note>No price list yet — type each item and its rate. The owner or manager can add a price list on the computer.</Note>}

      <View style={st.two}>
        <View style={{ flex: 1 }}><Field label="Discount (₹)" keyboardType="decimal-pad" value={discount} onChangeText={v => setDiscount(v.replace(/[^0-9.]/g, ''))} /></View>
        {num(discount) > 0 && <View style={{ flex: 2 }}><Field label="Why the discount" value={reason} onChangeText={setReason} /></View>}
      </View>

      <View style={st.total}>
        <Text style={st.meta}>Total{gstTotal > 0 ? ` (includes GST ${rs(gstTotal)})` : ''}</Text>
        <Text style={st.big}>{rs(Math.max(net, 0))}</Text>
      </View>

      <Label>Received now</Label>
      <PaySplit due={net} rows={pays} onChange={r => { setFollow(false); setPays(r) }} methods={PAYMENT_METHOD_OPTIONS} />
      {payErr && <Text style={{ color: C.danger }}>{payErr}</Text>}
      <Err msg={err} />
      <Btn label={paying <= 0 ? 'Make invoice · to pay later'
        : toPayments(pays).length > 1 ? `Make invoice · ${rs(paying)} in ${toPayments(pays).length} payments`
        : `Make invoice · ${rs(paying)} ${methodLabel(pays.find(p => Number(p.amount) > 0)?.method ?? 'cash')}`}
        busy={busy} disabled={!valid} onPress={create} />
    </Card>
  )
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  two: { flexDirection: 'row', gap: 8 },
  line: { gap: 8, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 10 },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 10 },
  done: { gap: 6, backgroundColor: '#f3faf6', borderRadius: 10, padding: 10 },
  big: { fontSize: 20, fontWeight: '800', color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  sub: { fontSize: 13, fontWeight: '800', color: C.muted },
  ok: { color: C.green, fontWeight: '700' },
  link: { color: C.green, fontWeight: '700' },
})
