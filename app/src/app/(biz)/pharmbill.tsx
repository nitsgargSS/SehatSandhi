import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useSession } from '../../lib/session'
import { searchPatients, type PatientSearchResult } from '@web/lib/patientsApi'
import {
  getStock, issueBill, getBill, getWaitingPrescriptions, markPrescription, getPrescriptionsForDispensing, matchItem, itemLabel, PAY_METHODS,
  type StockRow, type RxForDispensing, type WaitingRx, type PharmacyPayMethod,
} from '@web/lib/pharmacyApi'
import { type PayRow, payRow, toPayments } from '@web/lib/splitPayments'
import PaySplit from '../../ui/PaySplit'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// A medicine bill on the phone — the website's Pharmacy → New bill
// (src/pages/doctor/PharmacyPanel.tsx SellSection), same functions: OPD
// prescriptions waiting at the pharmacy (0288), a clinic patient (name, phone
// or file number) or a walk-in, medicines from stock, a discount with a
// reason, and the payment — one, or several (0301: half UPI, half cash), or
// nothing now. sehat_pharmacy_issue_bill_split takes the batches nearest
// expiry, so the total here is "about" until the bill is issued.
const rs = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const countedInStrips = (s: StockRow) => s.pack_size <= 1 && (/tab|cap/i.test(s.form ?? '') || /tab|cap|strip/i.test(s.unit ?? ''))

interface Line { key: string; item: StockRow; qty: string }
type Who = { id: string; name: string; phone: string | null; mrn: string | null }

export default function PharmacyBill() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const [stock, setStock] = useState<StockRow[]>([])
  const [waiting, setWaiting] = useState<WaitingRx[]>([])
  const [mode, setMode] = useState<'patient' | 'walkin'>('patient')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PatientSearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [patient, setPatient] = useState<Who | null>(null)
  const [rxs, setRxs] = useState<RxForDispensing[]>([])
  const [rxId, setRxId] = useState<string | null>(null)
  const [pendingRx, setPendingRx] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState<string[]>([])
  const [walk, setWalk] = useState({ name: '', phone: '' })
  const [mq, setMq] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [disc, setDisc] = useState<{ on: boolean; pct: string; reason: string }>({ on: false, pct: '', reason: '' })
  const [pays, setPays] = useState<PayRow<PharmacyPayMethod>[]>(() => [payRow<PharmacyPayMethod>('cash')])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ billNo: string; net: number; due: number } | null>(null)

  const load = useCallback(() => {
    if (!biz) return
    getStock(biz).then(setStock).catch(e => setErr((e as Error).message))
    getWaitingPrescriptions(biz).then(setWaiting).catch(() => setWaiting([]))
  }, [biz])
  useFocusEffect(load)

  useEffect(() => {
    if (!biz || mode !== 'patient' || patient || q.trim().length < 2) { setFound([]); setSearched(false); return }
    const t = setTimeout(() => {
      searchPatients(q.trim(), biz).then(setFound).catch(() => setFound([])).finally(() => setSearched(true))
    }, 250)
    return () => clearTimeout(t)
  }, [q, biz, mode, patient])

  useEffect(() => {
    setRxs([]); setRxId(null); setUnmatched([])
    if (patient && biz) getPrescriptionsForDispensing(biz, patient.id).then(setRxs).catch(() => setRxs([]))
  }, [patient, biz])

  const fromRx = (rx: RxForDispensing) => {
    setRxId(rx.prescription_id)
    const missing: string[] = []
    const next: Line[] = []
    for (const it of rx.items) {
      const m = matchItem(stock, it.drug_name, it.strength)
      // "10 tablets" → 10; anything unreadable starts at 1 for the counter to fix.
      const n = parseInt(String(it.quantity ?? '').match(/\d+/)?.[0] ?? '', 10)
      if (m) next.push({ key: `${m.id}-${next.length}`, item: m, qty: String(n > 0 ? n : 1) })
      else missing.push([it.drug_name, it.strength].filter(Boolean).join(' '))
    }
    setLines(next); setUnmatched(missing)
  }
  // A waiting prescription opens its patient; their prescriptions load, then this one fills the bill.
  useEffect(() => {
    if (!pendingRx) return
    const rx = rxs.find(r => r.prescription_id === pendingRx)
    if (rx) { fromRx(rx); setPendingRx(null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rxs, pendingRx])

  const hits = useMemo(() => {
    const t = mq.trim().toLowerCase()
    if (t.length < 2) return []
    return stock.filter(x => x.is_active && (x.name.toLowerCase().includes(t) || (x.generic_name ?? '').toLowerCase().includes(t)
      || (x.manufacturer ?? '').toLowerCase().includes(t))).slice(0, 8)
  }, [mq, stock])
  const add = (it: StockRow) => {
    setLines(ls => {
      const at = ls.findIndex(l => l.item.id === it.id)
      if (at >= 0) return ls.map((l, i) => i === at ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l)
      return [...ls, { key: `${it.id}-${Date.now()}`, item: it, qty: '1' }]
    })
    setMq('')
  }

  const pct = Math.min(Math.max(Number(disc.pct) || 0, 0), 100)
  const gross = lines.reduce((t, l) => t + (Number(l.qty) || 0) * (l.item.unit_mrp ?? 0), 0)
  const estimate = Math.round(gross * (100 - pct) / 100)
  // While it is one payment it follows the total; once split, the counter has set the parts.
  useEffect(() => { setPays(ps => ps.length === 1 ? [{ ...ps[0], amount: estimate ? String(estimate) : '' }] : ps) }, [estimate])

  const reset = () => {
    setLines([]); setDisc({ on: false, pct: '', reason: '' }); setPays([payRow<PharmacyPayMethod>('cash')])
    setPatient(null); setQ(''); setWalk({ name: '', phone: '' }); setRxId(null); setUnmatched([])
  }

  const submit = async () => {
    setErr('')
    if (!lines.length) { setErr('Add at least one medicine.'); return }
    if (lines.some(l => !(Number(l.qty) >= 1))) { setErr('Every medicine needs a quantity of 1 or more.'); return }
    if (mode === 'patient' && !patient) { setErr('Choose the patient, or switch to walk-in.'); return }
    if (mode === 'walkin' && !walk.name.trim()) { setErr('Give the customer\'s name.'); return }
    if (pct > 0 && !disc.reason.trim()) { setErr('Say why there is a discount.'); return }
    if (pays.some(p => Number(p.amount) < 0)) { setErr('A payment cannot be below zero.'); return }
    setBusy(true)
    try {
      const id = await issueBill(biz, {
        lines: lines.map(l => ({ item_id: l.item.id, qty: Math.floor(Number(l.qty)) })),
        patientMemberId: mode === 'patient' ? patient!.id : null,
        customerName: mode === 'walkin' ? walk.name.trim() : undefined,
        customerPhone: mode === 'walkin' ? walk.phone.trim() : undefined,
        prescriptionId: rxId,
        discountPct: pct, discountReason: disc.reason.trim(),
        payments: toPayments(pays),
      })
      const b = await getBill(id).catch(() => null)
      setDone({ billNo: b?.bill_no ?? '', net: b?.net_payable ?? estimate, due: b?.balance_due ?? 0 })
      reset(); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (done) {
    return (
      <ScrollView contentContainerStyle={st.wrap}>
        <Card style={{ borderColor: C.green }}>
          <Text style={st.big}>✓ Bill {done.billNo}</Text>
          <Text style={st.body}>{rs(done.net)}{done.due > 0 ? ` · ${rs(done.due)} still due` : ' · paid in full'}</Text>
          <Note>Print it, take the rest or return medicines from the computer: Pharmacy → Bills.</Note>
          <Btn label="New bill" onPress={() => setDone(null)} />
        </Card>
      </ScrollView>
    )
  }

  if (!stock.length) return <View style={{ padding: 20 }}><Note>{err || 'No medicines yet — add them in Pharmacy stock first.'}</Note></View>

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        {!patient && waiting.length > 0 && (
          <Card>
            <Label>Prescriptions waiting ({waiting.length})</Label>
            {waiting.map(w => (
              <View key={w.prescription_id} style={st.hit}>
                <Text style={st.body}><Text style={st.b}>{w.patient_name}</Text>{w.mrn ? ` · file ${w.mrn}` : ''} · {shortDate(w.issued_at)} · {w.prescriber_name}</Text>
                <Text style={st.meta}>{w.items.map(i => [i.drug_name, i.strength].filter(Boolean).join(' ')).join(', ')}</Text>
                <View style={st.row}>
                  <Btn small label="Dispense" onPress={() => {
                    setMode('patient'); setPatient({ id: w.patient_member_id, name: w.patient_name, phone: w.phone, mrn: w.mrn }); setPendingRx(w.prescription_id)
                  }} />
                  <Btn small kind="ghost" label="Not needed" onPress={() => { markPrescription(w.prescription_id, 'not_needed').then(load, e => setErr((e as Error).message)) }} />
                </View>
              </View>
            ))}
          </Card>
        )}

        <Card>
          <View style={st.row}>
            <Chip label="Clinic patient" on={mode === 'patient'} onPress={() => { setMode('patient'); setRxId(null) }} />
            <Chip label="Walk-in customer" on={mode === 'walkin'} onPress={() => { setMode('walkin'); setRxId(null) }} />
          </View>
          {mode === 'patient' ? (patient ? (
            <View style={{ gap: 6 }}>
              <View style={st.between}>
                <Text style={st.body}><Text style={st.b}>{patient.name}</Text>{patient.mrn ? ` · file ${patient.mrn}` : ''}{patient.phone ? ` · ${patient.phone}` : ''}</Text>
                <Text style={st.link} onPress={() => setPatient(null)}>Change</Text>
              </View>
              {rxs.length > 0 && <Text style={st.meta}>Dispense from a prescription:</Text>}
              {rxs.map(rx => (
                <Pressable key={rx.prescription_id} style={[st.pick, rxId === rx.prescription_id && st.picked]} onPress={() => fromRx(rx)}>
                  <Text style={st.body}><Text style={st.b}>{rx.prescription_no}</Text> · {shortDate(rx.issued_at)} · {rx.prescriber_name}</Text>
                  <Text style={st.meta}>{rx.items.map(i => i.drug_name).join(', ')}{rx.dispensed_bill_no ? ` · already dispensed (${rx.dispensed_bill_no})` : ''}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <Field placeholder="Name, mobile or file (UID) number" value={q} onChangeText={setQ} autoCorrect={false} />
              {found.slice(0, 8).map(p => (
                <Pressable key={p.patient_member_id} style={st.pick}
                  onPress={() => { setPatient({ id: p.patient_member_id, name: p.full_name, phone: p.phone, mrn: p.mrn }); setFound([]) }}>
                  <Text style={st.body}><Text style={st.b}>{p.full_name}</Text>{p.age_years != null ? ` · ${p.age_years}y` : ''}</Text>
                  <Text style={st.meta}>{p.mrn ? `File ${p.mrn} · ` : ''}{p.phone}</Text>
                </Pressable>
              ))}
              {searched && !found.length && <Note>No patient here matches "{q.trim()}". Check the spelling, or bill them as a walk-in customer.</Note>}
            </View>
          )) : (
            <View style={{ gap: 6 }}>
              <Field placeholder="Customer name" value={walk.name} onChangeText={t => setWalk({ ...walk, name: t })} />
              <Field placeholder="Mobile (optional)" keyboardType="phone-pad" value={walk.phone} onChangeText={t => setWalk({ ...walk, phone: t.replace(/[^\d+ ]/g, '') })} />
            </View>
          )}
        </Card>

        <Card>
          <Label>Medicines</Label>
          {unmatched.length > 0 && <Note>Not on your medicine list, so not added: {unmatched.join(', ')}. Add a substitute if you have one.</Note>}
          <Field placeholder="Add a medicine — type its name, brand or company" value={mq} onChangeText={setMq} autoCorrect={false} />
          {hits.map(x => (
            <Pressable key={x.id} style={st.pick} onPress={() => add(x)}>
              <Text style={st.body}>{itemLabel(x)}{x.manufacturer ? <Text style={st.meta}> · {x.manufacturer}</Text> : null}</Text>
              <Text style={[st.meta, x.qty_available <= 0 && { color: C.danger }]}>{x.qty_available} {x.unit}{x.unit_mrp ? ` · ${rs(x.unit_mrp)} each` : ''}</Text>
            </Pressable>
          ))}
          {lines.map(l => {
            const n = Number(l.qty) || 0
            return (
              <View key={l.key} style={st.line}>
                <View style={st.between}>
                  <Text style={[st.body, { flex: 1 }]}>{itemLabel(l.item)}</Text>
                  <Pressable onPress={() => setLines(ls => ls.filter(x => x.key !== l.key))} hitSlop={10}><Text style={st.remove}>✕</Text></Pressable>
                </View>
                <View style={st.row}>
                  <View style={{ width: 90 }}>
                    <Field keyboardType="number-pad" value={l.qty} onChangeText={t => setLines(ls => ls.map(x => x.key === l.key ? { ...x, qty: t.replace(/\D/g, '') } : x))} />
                  </View>
                  <Text style={st.meta}>{l.item.unit}s × {l.item.unit_mrp ? rs(l.item.unit_mrp) : '—'} = <Text style={st.b}>{rs(n * (l.item.unit_mrp ?? 0))}</Text></Text>
                  {l.item.pack_size > 1 && <Chip label={`Full strip (${l.item.pack_size})`} onPress={() => setLines(ls => ls.map(x => x.key === l.key ? { ...x, qty: String(l.item.pack_size) } : x))} />}
                </View>
                {n > l.item.qty_available && <Text style={st.warn}>Only {l.item.qty_available} {l.item.unit} in stock.</Text>}
                {countedInStrips(l.item) && <Text style={st.warn}>Counted in whole strips — to sell single tablets, set it on the computer: Pharmacy → Stock → Sell by tablet.</Text>}
              </View>
            )
          })}
        </Card>

        {lines.length > 0 && (
          <Card>
            {!disc.on ? <Text style={st.link} onPress={() => setDisc({ ...disc, on: true })}>+ Discount</Text> : (
              <View style={{ gap: 6 }}>
                <Field label="Discount %" keyboardType="decimal-pad" value={disc.pct} onChangeText={t => setDisc({ ...disc, pct: t.replace(/[^0-9.]/g, '') })} />
                {pct > 0 && <Field label="Why" placeholder="Staff, senior citizen, regular patient…" value={disc.reason} onChangeText={t => setDisc({ ...disc, reason: t })} />}
              </View>
            )}
            <View style={st.between}>
              <Text style={st.meta}>About — each batch has its own MRP</Text>
              <Text style={st.big}>{rs(estimate)}</Text>
            </View>
            <Label>Payment</Label>
            <PaySplit due={estimate} rows={pays} onChange={setPays} methods={PAY_METHODS} />
          </Card>
        )}

        <Err msg={err} />
        {lines.length > 0 && <Btn label="Issue bill" busy={busy} onPress={submit} />}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  body: { fontSize: 14.5, color: C.ink },
  b: { fontWeight: '700' },
  meta: { fontSize: 13, color: C.muted },
  link: { color: C.green, fontWeight: '700', fontSize: 14 },
  pick: { paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: C.border, borderRadius: 9, gap: 2 },
  picked: { borderColor: C.green, backgroundColor: '#f3faf6' },
  hit: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0ebe1', gap: 4 },
  line: { borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 8, gap: 6 },
  remove: { fontSize: 18, color: C.muted, paddingHorizontal: 6 },
  warn: { fontSize: 12.5, color: '#8a5a00' },
  big: { fontSize: 22, fontWeight: '800', color: C.green },
})
