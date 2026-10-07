import { useEffect, useState } from 'react'
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useSession } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { requestDisable, confirmDisable, type ActionRequested } from '@web/lib/adminBusinessApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// Businesses on the phone, for Sehatsandhi admin — the website's admin
// business list (src/pages/admin/Dashboard.tsx), same calls: find one by
// name, phone, PIN or clinic code; see its status, plan and contact; disable
// it (0144: reason → a code emailed to the admin → confirm; nothing deleted),
// reactivate a disabled one, mark its phone verified.
type Biz = {
  id: string; name: string; vertical: string; status: string; phone: string | null; email: string | null
  own_city: string | null; own_district: string | null; own_pin_code: string | null; qr_code: string | null
  term_end: string | null; created_at: string; phone_verified_at: string | null
}
const COLS = 'id, name, vertical, status, phone, email, own_city, own_district, own_pin_code, qr_code, term_end, created_at, phone_verified_at'
const STATUS: Record<string, string> = { active: 'Live', pending: 'Waiting for approval', suspended: 'Disabled', rejected: 'Rejected' }
const dmy = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export default function Businesses() {
  const { s } = useSession()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [rows, setRows] = useState<Biz[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const search = async () => {
    const w = q.trim().replace(/[%,()]/g, ' ')
    let query = supabase.from('businesses').select(COLS).order('created_at', { ascending: false }).limit(40)
    if (status) query = query.eq('status', status)
    if (w) {
      const digits = w.replace(/\D/g, '')
      query = /^ss-?/i.test(w) ? query.ilike('qr_code', `%${w.replace(/^ss-?/i, '')}%`)
        : digits.length === 6 && digits === w ? query.eq('own_pin_code', digits)
        : digits.length >= 6 ? query.ilike('phone', `%${digits.slice(-10)}%`)
        : query.ilike('name', `%${w}%`)
    }
    const { data, error } = await query
    if (error) setErr(error.message); else { setErr(''); setRows((data ?? []) as Biz[]) }
  }
  useEffect(() => { const t = setTimeout(search, 300); return () => clearTimeout(t) }, [q, status]) // eslint-disable-line react-hooks/exhaustive-deps
  if (s && !s.isAdmin) return <Redirect href="/" />

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Field placeholder="Name, phone, PIN code or clinic code (SS-…)" value={q} onChangeText={setQ} autoCorrect={false} />
      <View style={st.row}>
        <Chip label="All" on={!status} onPress={() => setStatus(null)} />
        {Object.entries(STATUS).map(([k, l]) => <Chip key={k} label={l} on={status === k} onPress={() => setStatus(status === k ? null : k)} />)}
      </View>
      <Err msg={err} />
      {!!msg && <Text style={st.ok}>{msg}</Text>}
      {rows.map(b => (
        <Card key={b.id}>
          <Pressable onPress={() => setOpenId(openId === b.id ? null : b.id)} style={{ gap: 2 }}>
            <View style={st.between}>
              <Text style={st.name}>{b.name}</Text>
              <Text style={[st.meta, { color: b.status === 'active' ? C.green : b.status === 'suspended' ? C.danger : C.muted, fontWeight: '700' }]}>{STATUS[b.status] ?? b.status}</Text>
            </View>
            <Text style={st.meta}>{[b.vertical, b.own_city ?? b.own_district, b.own_pin_code, b.qr_code].filter(Boolean).join(' · ')}</Text>
          </Pressable>
          {openId === b.id && <Detail b={b} onChanged={m => { setMsg(m); setOpenId(null); search() }} />}
        </Card>
      ))}
      {!rows.length && <Note>Nothing found.</Note>}
    </ScrollView>
  )
}

function Detail({ b, onChanged }: { b: Biz; onChanged: (msg: string) => void }) {
  const [reason, setReason] = useState('')
  const [disabling, setDisabling] = useState(false)
  const [sent, setSent] = useState<ActionRequested | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setErr('')
    try { onChanged(await fn()) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const lastDay = b.term_end ? new Date(new Date(`${b.term_end.slice(0, 10)}T00:00:00+05:30`).getTime() - 86_400_000).toISOString() : null

  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      {!!b.phone && <Text style={st.link} onPress={() => Linking.openURL(`tel:${b.phone}`)}>📞 {b.phone}{b.phone_verified_at ? ' ✓' : ' (not verified)'}</Text>}
      {!!b.email && <Text style={st.body}>✉ {b.email}</Text>}
      <Text style={st.meta}>Joined {dmy(b.created_at)}{lastDay ? ` · plan until ${dmy(lastDay)}` : ' · no payment yet'}</Text>
      <View style={st.row}>
        {b.status === 'active' && !disabling && <Btn small kind="danger" label="Disable…" onPress={() => setDisabling(true)} />}
        {b.status === 'suspended' && <Btn small label="Reactivate" busy={busy} onPress={() => Alert.alert('Reactivate?', `${b.name} will show to patients and the WhatsApp bot again.`, [
          { text: 'Back', style: 'cancel' },
          { text: 'Reactivate', onPress: () => run(async () => {
            const { error } = await supabase.from('businesses').update({ status: 'active' }).eq('id', b.id)
            if (error) throw new Error(error.message)
            return `✓ ${b.name} is live again.`
          }) }])} />}
        {!!b.phone && !b.phone_verified_at && <Btn small kind="ghost" label="Mark phone verified" busy={busy} onPress={() => run(async () => {
          const { error } = await supabase.from('businesses').update({ phone_verified_at: new Date().toISOString() }).eq('id', b.id)
          if (error) throw new Error(error.message)
          return `✓ ${b.name}: phone marked verified`
        })} />}
      </View>
      {disabling && !sent && (
        <View style={{ gap: 6 }}>
          <Text style={st.warn}>Hides {b.name} from patients and the WhatsApp bot. Nothing is deleted; it can be reactivated later.</Text>
          <Field label="Reason (goes in the email and the record)" value={reason} onChangeText={setReason} multiline maxLength={1000} />
          <View style={st.row}>
            <Btn small kind="danger" label="Email me a code" busy={busy} disabled={reason.trim().length < 10}
              onPress={async () => { setBusy(true); setErr(''); try { setSent(await requestDisable(b.id, reason.trim())) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }} />
            <Btn small kind="ghost" label="Back" onPress={() => setDisabling(false)} />
          </View>
        </View>
      )}
      {sent && (
        <View style={{ gap: 6 }}>
          <Label>Code sent to {sent.sentTo}</Label>
          <Note>Valid until {new Date(sent.expiresAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.</Note>
          <Field placeholder="Code from the email" value={code} onChangeText={t => setCode(t.trim())} autoCapitalize="none" keyboardType="number-pad" />
          <Btn small kind="danger" label={`Disable ${b.name}`} busy={busy} disabled={!code}
            onPress={() => run(async () => { await confirmDisable(sent.requestId, code); return `✓ ${b.name} disabled. A receipt was emailed.` })} />
        </View>
      )}
      <Err msg={err} />
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 48 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 15.5, fontWeight: '800', color: C.ink, flexShrink: 1 },
  body: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  ok: { color: C.green, fontWeight: '700' },
  warn: { color: '#92400e', fontSize: 13 },
  link: { color: C.green, fontWeight: '700' },
})
