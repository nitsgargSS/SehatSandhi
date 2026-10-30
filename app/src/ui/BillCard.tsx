import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  getAccount, getCharges, getBills, addPayments, issueBill, methodLabel, PAYMENT_METHOD_OPTIONS,
  type Account, type Bill, type Charge, type PaymentMethod,
} from '@web/lib/billingApi'
import { Btn, Card, Err, Label, Note, toDmy } from './kit'
import PaySplit from './PaySplit'
import { type PayRow, payRow, payTotal, toPayments } from '@web/lib/splitPayments'
import SendSheet from './SendSheet'
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
  // 0301: one payment or several (half UPI, half cash); null while not taking one.
  const [pay, setPay] = useState<PayRow<PaymentMethod>[] | null>(null)
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
          <Btn small label="Take payment" onPress={() => { setMsg(''); setPay([payRow<PaymentMethod>('cash', balance > 0 ? String(balance) : '')]) }} />
          {unbilled.length > 0 && (
            <Btn small kind="ghost" label={`Make bill (${rs(unbilledSum)})`} busy={busy === 'bill'}
              onPress={() => run('bill', () => issueBill({ patientMemberId: member, businessId: biz, issuedBy: recordedBy, supersedes: liveBill?.id ?? null }),
                liveBill ? `✓ New bill made — it replaces ${liveBill.bill_no}` : '✓ Bill made')} />
          )}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <PaySplit due={Math.max(balance, 0)} rows={pay} onChange={setPay} methods={PAYMENT_METHOD_OPTIONS} credit={false} />
          {payTotal(pay) > Math.max(balance, 0) && <Note>Anything above what is owed is kept as an advance.</Note>}
          <View style={st.row}>
            <Btn small busy={busy === 'pay'} disabled={!toPayments(pay).length}
              label={toPayments(pay).length > 1 ? `Record ${rs(payTotal(pay))} in ${toPayments(pay).length} payments`
                : `Record ${payTotal(pay) > 0 ? rs(payTotal(pay)) : ''} ${methodLabel(pay.find(p => Number(p.amount) > 0)?.method ?? pay[0].method)}`}
              onPress={() => run('pay', async () => {
                const parts = toPayments(pay)
                await addPayments(member, biz, parts, recordedBy)
                setPay(null)
              }, toPayments(pay).length > 1 ? `✓ ${toPayments(pay).length} payments recorded` : '✓ Payment recorded')} />
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
          <SendSheet kind="bill" id={b.id} biz={biz} label={b.sent_at ? 'Send again' : 'Send'}
            onSent={note => { setErr(''); setMsg(`${b.bill_no}: ${note}`); load() }} />
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
