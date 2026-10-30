import { Pressable, StyleSheet, Text, View } from 'react-native'
import { type PayRow, payRow, payTotal, payLeft, nextPayMethod } from '@web/lib/splitPayments'
import { Btn, Chip, Field } from './kit'
import { C } from './theme'

// How a bill or fee is being paid, on the phone — the website's PaymentSplit
// (src/pages/doctor/PaymentSplit.tsx): one payment, or several (half UPI,
// half cash). Once what is entered is less than what is due, the next line
// offers itself for the rest; left empty, the rest stays due.

const rs = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export default function PaySplit<M extends string>({ due, rows, onChange, methods, credit = true }: {
  due: number
  rows: PayRow<M>[]
  onChange: (rows: PayRow<M>[]) => void
  methods: readonly (readonly [M, string])[]
  /** Offer "Nothing now". */
  credit?: boolean
}) {
  const received = payTotal(rows)
  const left = payLeft(rows, due)
  const next = nextPayMethod(rows, due, methods)
  const set = (key: number, patch: Partial<PayRow<M>>) => onChange(rows.map(r => r.key === key ? { ...r, ...patch } : r))
  const label = (m: M) => methods.find(([v]) => v === m)?.[1] ?? m

  return (
    <View style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <View key={r.key} style={[st.line, rows.length > 1 && st.boxed]}>
          <View style={st.row}>
            <View style={{ flex: 1 }}>
              <Field placeholder={i === 0 ? 'Amount received ₹' : 'Amount ₹'} keyboardType="decimal-pad" value={r.amount}
                onChangeText={t => set(r.key, { amount: t.replace(/[^0-9.]/g, '') })} />
            </View>
            {rows.length > 1 && (
              <Pressable onPress={() => onChange(rows.filter(x => x.key !== r.key))} hitSlop={10} accessibilityLabel="Remove this payment">
                <Text style={st.remove}>✕</Text>
              </Pressable>
            )}
          </View>
          <View style={st.row}>{methods.map(([m, l]) => <Chip key={m} label={l} on={r.method === m} onPress={() => set(r.key, { method: m })} />)}</View>
          {r.method !== 'cash' && <Field placeholder="Reference — UPI / card slip / cheque no. (optional)" value={r.reference}
            onChangeText={t => set(r.key, { reference: t })} />}
        </View>
      ))}

      {next !== null && (
        <View style={st.offer}>
          <Text style={st.offerText}>{rs(left)} left — paid another way? Leave it and the rest stays due.</Text>
          <View style={st.row}>
            <Btn small label={`Rest ${rs(left)} by ${label(next)}`} onPress={() => onChange([...rows, payRow(next, String(left))])} />
            <Btn small kind="ghost" label="Another amount" onPress={() => onChange([...rows, payRow(next)])} />
          </View>
        </View>
      )}

      <View style={st.row}>
        <Chip label="Paid in full" on={rows.length === 1 && received >= due && due > 0}
          onPress={() => onChange([payRow(rows[0]?.method ?? methods[0][0], due > 0 ? String(due) : '')])} />
        {credit && <Chip label="Nothing now" on={!received} onPress={() => onChange([payRow(rows[0]?.method ?? methods[0][0])])} />}
      </View>
      {rows.length > 1 && received > 0 && <Text style={st.meta}>Received {rs(received)} in {rows.filter(r => Number(r.amount) > 0).length} payments</Text>}
      {received > 0 && left > 0 && next === null && <Text style={st.due}>{rs(left)} will be due</Text>}
      {left < 0 && <Text style={st.over}>{rs(-left)} more than what is due</Text>}
    </View>
  )
}

const st = StyleSheet.create({
  line: { gap: 8 },
  boxed: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  remove: { fontSize: 18, color: C.muted, paddingHorizontal: 6 },
  offer: { borderWidth: 1, borderStyle: 'dashed', borderColor: C.green, borderRadius: 10, padding: 10, gap: 8, backgroundColor: '#f3faf6' },
  offerText: { fontSize: 13, color: '#0b6b4b', fontWeight: '700' },
  meta: { fontSize: 13, color: C.muted },
  due: { fontSize: 13, color: '#8a5a00', fontWeight: '600' },
  over: { fontSize: 13, color: C.danger, fontWeight: '600' },
})
