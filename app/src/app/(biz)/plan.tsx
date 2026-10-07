import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSession } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { Btn, Card, Chip, Err, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// The clinic's plan on the phone — what the website's Plan & billing
// (src/pages/doctor/PayListingPanel.tsx) shows: active or not, the term, the
// last day covered, days left; and the renewal choice (term, WhatsApp add-on,
// automatic renewal — sehat_set_renewal_preference, which decides who may).
// Paying is on the website only: the app takes no payments and does not send
// people to pay elsewhere (store rules).
const TERM_NAME: Record<number, string> = { 1: 'Monthly', 3: 'Quarterly', 6: 'Half-yearly', 12: 'Yearly' }
type Biz = {
  id: string; status: string; term_start: string | null; term_end: string | null; auto_renew: boolean | null
  renewal_term_months: number | null; renewal_whatsapp: boolean | null; months_paid: number | null
}
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00+05:30`)
const dmy = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

export default function Plan() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const manages = !s?.role.enforced || ['owner', 'manager'].includes(s?.role.role ?? '')
  const [b, setB] = useState<Biz | null>(null)
  const [months, setMonths] = useState(1)
  const [whatsapp, setWhatsapp] = useState(true)
  const [autoRenew, setAutoRenew] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!biz) return
    supabase.from('businesses').select('id, status, term_start, term_end, auto_renew, renewal_term_months, renewal_whatsapp, months_paid')
      .eq('id', biz).maybeSingle().then(({ data, error }) => {
        if (error) { setErr(error.message); return }
        const x = data as Biz | null
        setB(x)
        if (x) {
          setMonths([1, 6, 12].includes(Number(x.renewal_term_months)) ? Number(x.renewal_term_months) : [1, 6, 12].includes(Number(x.months_paid)) ? Number(x.months_paid) : 1)
          setWhatsapp(x.renewal_whatsapp !== false); setAutoRenew(x.auto_renew !== false)
        }
      })
  }, [biz])

  if (!b) return <View style={{ padding: 20 }}><Note>{err || 'Loading…'}</Note></View>
  // term_end is the first day NOT covered: active until the day before.
  const end = b.term_end ? day(b.term_end) : null
  const lastDay = end ? new Date(end.getTime() - 86_400_000) : null
  const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86_400_000) : null
  const paidUp = b.status === 'active' && daysLeft != null && daysLeft > 0

  const save = async () => {
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.rpc('sehat_set_renewal_preference', { p_business: b.id, p_months: months, p_whatsapp: whatsapp, p_auto_renew: autoRenew })
    setBusy(false)
    if (error) setErr(error.message)
    else setMsg(`Saved. Next renewal: ${months === 1 ? '1 month' : `${months} months`}${whatsapp ? ' with WhatsApp' : ''}${autoRenew ? ', renewed automatically' : ''}.`)
  }

  return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Card style={{ borderColor: paidUp ? C.green : C.danger }}>
        <Text style={[st.big, { color: paidUp ? C.green : C.danger }]}>{paidUp ? '✓ Plan active' : b.status === 'active' ? 'Plan ended' : 'Not live yet'}</Text>
        {!!b.months_paid && <Text style={st.body}>{TERM_NAME[b.months_paid] ?? `${b.months_paid} months`}{b.term_start ? ` · from ${dmy(day(b.term_start))}` : ''}</Text>}
        {lastDay && <Text style={st.body}>Active until <Text style={st.b}>{dmy(lastDay)}</Text>{daysLeft != null && daysLeft > 0 ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}</Text>}
        {!lastDay && <Text style={st.body}>No payment recorded yet.</Text>}
        <Note>Payments and invoices are on the Sehatsandhi website (Plan & billing), signed in as the owner. The app does not take payments.</Note>
      </Card>

      <Card>
        <Label>Next renewal</Label>
        <View style={st.row}>{[1, 6, 12].map(m => <Chip key={m} label={TERM_NAME[m]} on={months === m} onPress={() => manages && setMonths(m)} />)}</View>
        <View style={st.row}>
          <Chip label="WhatsApp messages to patients" on={whatsapp} onPress={() => manages && setWhatsapp(!whatsapp)} />
          <Chip label="Renew automatically" on={autoRenew} onPress={() => manages && setAutoRenew(!autoRenew)} />
        </View>
        {manages ? <Btn label="Save renewal choice" busy={busy} onPress={save} /> : <Note>The owner or a manager sets this.</Note>}
        <Err msg={err} />
        {!!msg && <Text style={st.ok}>{msg}</Text>}
      </Card>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  big: { fontSize: 18, fontWeight: '800' },
  body: { fontSize: 14.5, color: C.ink },
  b: { fontWeight: '800' },
  ok: { color: C.green, fontWeight: '700' },
})
