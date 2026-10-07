import { useCallback, useState } from 'react'
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, router, useFocusEffect } from 'expo-router'
import { useSession } from '../../../lib/session'
import {
  today, pendingBusinesses, approveBusiness, rejectBusiness, pendingCamps, reviewCamp,
  pendingBroadcasts, reviewBroadcast, openLeadReports, resolveLead,
  type Today, type PendingBusiness, type PendingCamp, type BroadcastForReview, type AdminLeadRow,
} from '../../../lib/admin'
import { Btn, Card, Err, Field, Label, Note, toDmy } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// Sehatsandhi admin on the phone: how today went, and everything
// waiting on a decision — new businesses, camps, WhatsApp broadcasts, insurance
// lead reports. The same calls and the same rules as the website's admin
// dashboard. Privacy requests and business lookup / disable open their own
// screens; everything else there (pricing, GST, team) stays on the computer.
const VERTICAL: Record<string, string> = {
  clinic: 'Clinic', hospital: 'Hospital', lab: 'Lab', pharmacy: 'Pharmacy', ambulance: 'Ambulance', insurance: 'Insurance',
}
const money = (paise: number | null | undefined) => `₹${((paise ?? 0) / 100).toLocaleString('en-IN')}`
const ago = (iso: string) => {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000)
  return h < 1 ? 'just now' : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

export default function Admin() {
  const { s } = useSession()
  const [t, setT] = useState<Today | null>(null)
  const [biz, setBiz] = useState<PendingBusiness[]>([])
  const [camps, setCamps] = useState<PendingCamp[]>([])
  const [casts, setCasts] = useState<BroadcastForReview[]>([])
  const [reports, setReports] = useState<AdminLeadRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // The one item whose reason box is open, and what has been typed.
  const [why, setWhy] = useState<{ id: string; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    const fail = (e: unknown) => setErr((e as Error).message)
    await Promise.all([
      today().then(setT).catch(fail),
      pendingBusinesses().then(setBiz).catch(fail),
      pendingCamps().then(setCamps).catch(fail),
      pendingBroadcasts().then(setCasts).catch(fail),
      openLeadReports().then(setReports).catch(fail),
    ])
    setLoading(false)
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  if (s && !s.isAdmin) return <Redirect href="/me" />

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id); setErr(''); setMsg('')
    try { await fn(); setWhy(null); setMsg(ok); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const sure = (title: string, body: string, yes: string, go: () => void) =>
    Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: yes, onPress: go }])
  /** Reject / refuse buttons: first tap opens the reason box, the second sends it.
   *  Called as a function, not rendered as <ReasonBox>: a component declared in
   *  here would be a new type every render, and the text box would lose focus
   *  (and the keyboard) after each letter. */
  const reasonBox = ({ id, label, need, onSend }: { id: string; label: string; need: string; onSend: (reason: string) => void }) =>
    why?.id === id ? (
      <View style={{ gap: 6 }}>
        <Field placeholder={need} value={why.text} onChangeText={x => setWhy({ id, text: x })} multiline autoFocus />
        <View style={st.row}>
          <Btn small kind="danger" label={label} busy={busy === id} disabled={!why.text.trim()} onPress={() => onSend(why.text.trim())} />
          <Btn small kind="ghost" label="Cancel" onPress={() => setWhy(null)} />
        </View>
      </View>
    ) : null

  const waiting = biz.length + camps.length + casts.length + reports.length

  return (
    <ScrollView contentContainerStyle={st.wrap} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      keyboardShouldPersistTaps="handled">
      <Err msg={err} />
      {!!msg && <Text style={st.ok}>{msg}</Text>}

      <Card>
        <Label>Today</Label>
        {!t ? <Note>{loading ? 'Loading…' : '—'}</Note> : (
          <View style={st.grid}>
            <Tile n={t.visitors} l="Visitors" />
            <Tile n={t.searches} l="Searches" />
            <Tile n={t.bookings} l="Bookings" />
            <Tile n={t.newListings} l="New listings" />
            <Tile n={t.businessLeads} l="Business enquiries" />
            <Tile n={t.whatsappClicks} l="WhatsApp clicks" />
            <Tile n={t.orders} l="Medicine orders (24 h)" />
            <Tile n={t.trips} l="Ambulance requests (24 h)" />
            <Tile n={t.leads} l="Insurance leads (24 h)" />
          </View>
        )}
        {!!t && (
          <Text style={st.meta}>
            Last 24 hours by channel — App {t.app} · WhatsApp {t.whatsapp} · Website {t.website} · Front desk {t.frontDesk}
          </Text>
        )}
        {!!t?.privacyOpen && <Text style={st.warn}>⚠ {t.privacyOpen} open privacy request{t.privacyOpen === 1 ? '' : 's'} — the 24 h / 15-day clock is running.</Text>}
        <View style={st.btnRow}>
          <Btn small kind={t?.privacyOpen ? 'primary' : 'ghost'} label={`Privacy requests${t?.privacyOpen ? ` (${t.privacyOpen})` : ''}`} onPress={() => router.push('/privacy')} />
          <Btn small kind="ghost" label="Businesses" onPress={() => router.push('/businesses')} />
        </View>
      </Card>

      <Card>
        <Label>Waiting on you</Label>
        <Text style={st.big}>{waiting === 0 ? 'Nothing — all clear ✓' : `${waiting} to decide`}</Text>
        {waiting > 0 && <Text style={st.meta}>{[
          biz.length && `${biz.length} new business${biz.length === 1 ? '' : 'es'}`,
          camps.length && `${camps.length} camp${camps.length === 1 ? '' : 's'}/offer${camps.length === 1 ? '' : 's'}`,
          casts.length && `${casts.length} WhatsApp broadcast${casts.length === 1 ? '' : 's'}`,
          reports.length && `${reports.length} insurance report${reports.length === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' · ')}</Text>}
      </Card>

      {biz.length > 0 && <Text style={st.h}>New businesses</Text>}
      {biz.map(b => (
        <Card key={b.id}>
          <Text style={st.name}>{b.name}</Text>
          <Text style={st.meta}>{[VERTICAL[b.vertical] ?? b.vertical, b.own_city, b.own_pin_code, `registered ${ago(b.created_at)}`].filter(Boolean).join(' · ')}</Text>
          {!!b.phone && <Text style={st.link} onPress={() => Linking.openURL(`tel:${b.phone}`)}>📞 {b.phone}{b.phone_verified_at ? '  ✓ verified' : '  — not verified, call to confirm'}</Text>}
          {!!b.email && <Text style={st.meta}>✉ {b.email}</Text>}
          <Text style={st.meta}>{b.reg_number ? `Registration no. ${b.reg_number}` : 'No registration number given'}</Text>
          {!!b.address && <Text style={st.meta}>{b.address}</Text>}
          {!!b.verification_notes && <Text style={st.note}>Notes: {b.verification_notes}</Text>}
          {why?.id !== b.id && (
            <View style={st.row}>
              <Btn small label="Approve" busy={busy === b.id}
                onPress={() => sure(`Approve ${b.name}?`, 'They go live on Sehatsandhi straight away.', 'Approve',
                  () => act(b.id, () => approveBusiness(b.id), `✓ ${b.name} approved`))} />
              <Btn small kind="ghost" label="Reject…" onPress={() => setWhy({ id: b.id, text: '' })} />
            </View>
          )}
          {reasonBox({ id: b.id, label: 'Reject', need: 'Why? Saved on their verification notes.',
            onSend: r => act(b.id, () => rejectBusiness(b, r), `✗ ${b.name} rejected`) })}
        </Card>
      ))}

      {camps.length > 0 && <Text style={st.h}>Camps and offers</Text>}
      {camps.map(c => (
        <Card key={c.id}>
          <Text style={st.name}>{c.title}</Text>
          <Text style={st.meta}>{[c.camp_type === 'free_camp' ? 'Free camp' : 'Offer', c.businesses?.name, `${toDmy(c.date_from?.slice(0, 10))} – ${toDmy(c.date_to?.slice(0, 10))}`].filter(Boolean).join(' · ')}</Text>
          {!!c.pin_codes?.length && <Text style={st.meta}>Areas: {c.pin_codes.join(', ')}</Text>}
          {!!c.description && <Text style={st.body}>{c.description}</Text>}
          {why?.id !== c.id && (
            <View style={st.row}>
              <Btn small label="Approve" busy={busy === c.id} onPress={() => act(c.id, () => reviewCamp(c.id, true), `✓ "${c.title}" approved`)} />
              <Btn small kind="ghost" label="Reject…" onPress={() => setWhy({ id: c.id, text: '' })} />
            </View>
          )}
          {reasonBox({ id: c.id, label: 'Reject', need: 'Why? The clinic sees this.',
            onSend: r => act(c.id, () => reviewCamp(c.id, false, r), `✗ "${c.title}" rejected`) })}
        </Card>
      ))}

      {casts.length > 0 && <Text style={st.h}>WhatsApp broadcasts</Text>}
      {casts.map(b => (
        <Card key={b.id}>
          <Text style={st.name}>{b.business_name}{b.business_city ? ` · ${b.business_city}` : ''}</Text>
          <Text style={st.meta}>{b.template_name} · {b.recipient_count} people · {money(b.total_cost_paise)}</Text>
          <Text style={st.body}>{b.params?.reduce((txt, v, i) => txt.split(`{{${i + 1}}}`).join(v), b.body) ?? b.body}</Text>
          {why?.id !== b.id && (
            <View style={st.row}>
              <Btn small label="Approve and send" busy={busy === b.id}
                onPress={() => sure('Send this broadcast?', `${b.recipient_count} people get it on WhatsApp.`, 'Send',
                  () => act(b.id, () => reviewBroadcast(b.id, true), '✓ Broadcast approved'))} />
              <Btn small kind="ghost" label="Reject…" onPress={() => setWhy({ id: b.id, text: '' })} />
            </View>
          )}
          {reasonBox({ id: b.id, label: 'Reject and refund', need: 'Why? The clinic is emailed this and refunded.',
            onSend: r => act(b.id, () => reviewBroadcast(b.id, false, r), '✗ Broadcast rejected, clinic refunded') })}
        </Card>
      ))}

      {reports.length > 0 && <Text style={st.h}>Insurance lead reports</Text>}
      {reports.map(r => (
        <Card key={r.id}>
          <Text style={st.name}>{r.code} · {r.advisor ?? '—'}</Text>
          <Text style={st.meta}>{[`PIN ${r.pin_code}`, r.fee_paise ? `fee ${money(r.fee_paise)}` : null, ago(r.created_at)].filter(Boolean).join(' · ')}</Text>
          {!!r.dispute_reason && <Text style={st.body}>Advisor says: {r.dispute_reason}</Text>}
          {r.patient_not_called && <Text style={st.warn}>Patient says the advisor never called.</Text>}
          {r.outcome_mismatch && <Text style={st.warn}>Patient and advisor disagree on the outcome.</Text>}
          {why?.id !== r.id && r.status === 'disputed' && !r.dispute_resolution && (
            <View style={st.row}>
              <Btn small label={`Refund ${money(r.fee_paise)}`} busy={busy === r.id}
                onPress={() => setWhy({ id: r.id, text: 'Report accepted.' })} />
              <Btn small kind="ghost" label="Reject report…" onPress={() => setWhy({ id: `x${r.id}`, text: '' })} />
            </View>
          )}
          {reasonBox({ id: r.id, label: 'Refund to wallet', need: 'Note for the advisor',
            onSend: n => act(r.id, () => resolveLead(r.id, true, n), `✓ ${r.code}: fee refunded`) })}
          {reasonBox({ id: `x${r.id}`, label: 'Reject report', need: 'Why? The advisor sees this.',
            onSend: n => act(`x${r.id}`, () => resolveLead(r.id, false, n), `✗ ${r.code}: report rejected`) })}
          {!(r.status === 'disputed' && !r.dispute_resolution) && <Note>A flag only — look into it on the computer (Leads tab) if it repeats.</Note>}
        </Card>
      ))}

      <Note>Pricing, GST, privacy requests, the team and reports are on the computer at sehatsandhi.com/admin.</Note>
    </ScrollView>
  )
}

function Tile({ n, l }: { n: number; l: string }) {
  return (
    <View style={st.tile}>
      <Text style={st.tileN}>{n.toLocaleString('en-IN')}</Text>
      <Text style={st.tileL}>{l}</Text>
    </View>
  )
}

const st = StyleSheet.create({
  btnRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  wrap: { padding: 14, gap: 12, paddingBottom: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '31%', flexGrow: 1, backgroundColor: '#f7f4ec', borderRadius: 12, padding: 10 },
  tileN: { fontSize: 20, fontWeight: '800', color: C.ink },
  tileL: { fontSize: 12, color: C.muted },
  h: { fontSize: 15, fontWeight: '800', color: C.ink, marginTop: 6 },
  big: { fontSize: 18, fontWeight: '800', color: C.ink },
  name: { fontSize: 16, fontWeight: '800', color: C.ink },
  meta: { fontSize: 13, color: C.muted },
  body: { fontSize: 14, color: C.ink },
  note: { fontSize: 13, color: C.ink, backgroundColor: '#f7f4ec', padding: 8, borderRadius: 8 },
  link: { color: C.green, fontWeight: '700', paddingVertical: 2 },
  warn: { fontSize: 13, color: C.danger, fontWeight: '600' },
  ok: { color: C.green, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
})
