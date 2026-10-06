import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  getAccount, getCharges, getBills, addPayment, issueBill, sendBill, methodLabel, PAYMENT_METHOD_OPTIONS,
  type Account, type Bill, type Charge, type PaymentMethod,
} from '@web/lib/billingApi'
import { Btn, Card, Chip, Err, Field, Label, Note, toDmy } from './kit'
import { C } from './theme'

// What a patient owes here, taking their money, and their bills — the website's
// Billing section (src/pages/doctor/Patients.tsx) for the desk on a phone.
// Payments are stamped with whoever is signed in (0159), so Collections can
// say who took what. A bill copies every unbilled OPD/account charge and, if
// one is already out, replaces it (as the website does); a stay's final bill
// stays with Beds / the computer.
const rs = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export default function BillCard({ biz, member, recordedBy }: { biz: string; member: string; recordedBy: string | null }) {
  const [acct, setAcct] = useState<Account | null>(null)
  const [charges, setCharges] = useState<Charge[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [pay, setPay] = useState<{ amount: string; method: PaymentMethod; reference: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(() => {
    getAccount(member, biz).then(setAcct).catch(e => setErr((e as Error).message))
    getCharges(member, biz).then(setCharges).catch(() => {})
    getBills(member, biz).then(setBills).catch(() => {})
  }, [member, biz])
  useEffect(load, [load])

  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(k); setErr(''); setMsg('')
    try { await fn(); setMsg(ok); load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const balance = Number(acct?.balance ?? 0)
  const unbilled = charges.filter(c => !c.bill_id && !c.admission_id)
  const unbilledSum = unbilled.reduce((a, c) => a + Number(c.amount), 0)
  const liveBill = bills.find(b => b.status === 'issued' && !b.admission_id)
  const issued = bills.filter(b => b.status === 'issued').slice(0, 5)

  return (
    <Card>
      <Label>Bill & payment</Label>
      <Text style={[st.big, { color: balance > 0 ? C.danger : C.green }]}>
        {balance > 0 ? `Owes ${rs(balance)}` : balance < 0 ? `Advance ${rs(-balance)}` : 'Nothing due'}
      </Text>
      {!!acct && <Text style={st.meta}>Charged {rs(acct.charged)} · paid {rs(acct.paid)}</Text>}

      {!pay ? (
        <View style={st.row}>
          <Btn small label="Take payment" onPress={() => { setMsg(''); setPay({ amount: balance > 0 ? String(balance) : '', method: 'cash', reference: '' }) }} />
          {unbilled.length > 0 && (
            <Btn small kind="ghost" label={`Make bill (${rs(unbilledSum)})`} busy={busy === 'bill'}
              onPress={() => run('bill', () => issueBill({ patientMemberId: member, businessId: biz, issuedBy: recordedBy, supersedes: liveBill?.id ?? null }),
                liveBill ? `✓ New bill made — it replaces ${liveBill.bill_no}` : '✓ Bill made')} />
          )}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Field label="Amount (₹)" keyboardType="decimal-pad" value={pay.amount} onChangeText={t => setPay({ ...pay, amount: t.replace(/[^0-9.]/g, '') })} autoFocus />
          <View style={st.row}>{PAYMENT_METHOD_OPTIONS.map(([m, l]) => <Chip key={m} label={l} on={pay.method === m} onPress={() => setPay({ ...pay, method: m })} />)}</View>
          {pay.method !== 'cash' && <Field placeholder="Reference — UPI / card slip / cheque no. (optional)" value={pay.reference} onChangeText={t => setPay({ ...pay, reference: t })} />}
          <View style={st.row}>
            <Btn small label={`Record ${pay.amount ? rs(Number(pay.amount)) : ''} ${methodLabel(pay.method)}`} busy={busy === 'pay'} disabled={!(Number(pay.amount) > 0)}
              onPress={() => run('pay', async () => {
                await addPayment(member, biz, { amount: Number(pay.amount), method: pay.method, reference: pay.reference.trim() }, recordedBy)
                setPay(null)
              }, '✓ Payment recorded')} />
            <Btn small kind="ghost" label="Cancel" onPress={() => setPay(null)} />
          </View>
        </View>
      )}
      <Err msg={err} />
      {!!msg && <Text style={st.ok}>{msg}</Text>}

      {issued.length > 0 && <Text style={st.sub}>Bills</Text>}
      {issued.map(b => (
        <View key={b.id} style={st.bill}>
          <View style={{ flex: 1 }}>
            <Text style={st.body}>{b.bill_no} · {rs(b.net_payable)}{Number(b.balance_due) > 0 ? ` · ${rs(b.balance_due)} due` : ' · paid'}</Text>
            <Text style={st.meta}>{toDmy(b.issued_at.slice(0, 10))}{b.sent_at ? ' · sent' : ''}</Text>
          </View>
          <Btn small kind="ghost" label={b.sent_at ? 'Send again' : 'Send'} busy={busy === b.id}
            onPress={() => run(b.id, async () => {
              const r = await sendBill(b.id)
              if (!r.whatsapp && !r.email) throw new Error('No WhatsApp or email could be sent — give the patient a printed copy.')
            }, `✓ ${b.bill_no} sent to the patient`)} />
        </View>
      ))}
      {!issued.length && !unbilled.length && <Note>No bills yet.</Note>}
    </Card>
  )
}

const st = StyleSheet.create({
  big: { fontSize: 18, fontWeight: '800' },
  meta: { fontSize: 12.5, color: C.muted },
  body: { fontSize: 14, color: C.ink },
  sub: { fontSize: 13, fontWeight: '800', color: C.muted, marginTop: 4 },
  ok: { color: C.green, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  bill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 6 },
})
