import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { whereAmI } from '../lib/patient'
import { Btn, Card, Err, Field, Note } from '../ui/kit'
import { C } from '../ui/theme'

// Free health camps and special offers near a PIN (0199) — the same list the
// WhatsApp bot gives, no login needed. Approved camps that are not over yet,
// in the whole district, the ones covering this PIN first.
type Camp = {
  id: string; kind: 'free_camp' | 'special_offer'; title: string; description: string; services: string | null
  date_from: string; date_to: string; time_slot: string | null; near: boolean
  business_id: string | null; business_name: string | null; phone: string | null; address: string | null; city: string | null
}
const day = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
const KEY = 'sehat:lastArea'
const recall = (): string => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null')?.pin ?? '' } catch { return '' } }

export default function Camps() {
  const [pin, setPin] = useState(recall())
  const [camps, setCamps] = useState<Camp[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async (p: string) => {
    const v = p.replace(/\D/g, '')
    if (!/^[1-9][0-9]{5}$/.test(v)) { setErr('Enter a 6-digit PIN code.'); return }
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('sehat_find_camps', { p_pin_code: v })
      if (error) throw error
      setCamps((data ?? []) as Camp[])
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const here = async () => {
    setErr('')
    try { const p = await whereAmI(); if (!p.pin) { setErr('Could not find your PIN code from your location. Please type it.'); return } setPin(p.pin); load(p.pin) }
    catch (e) { setErr((e as Error).message) }
  }

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={st.h}>🎁 कैंप और ऑफर / Camps &amp; offers</Text>
        <Note>Free health check-up camps and special prices from clinics, hospitals and labs near you.</Note>
        <Field label="PIN code" keyboardType="number-pad" maxLength={6} placeholder="110001" value={pin} onChangeText={setPin} onSubmitEditing={() => load(pin)} />
        <View style={st.row}>
          <View style={{ flex: 1 }}><Btn label="Show camps & offers" busy={busy} onPress={() => load(pin)} /></View>
          <Pressable style={st.loc} onPress={here} accessibilityLabel="Use my location"><Text style={st.locT}>📍</Text></Pressable>
        </View>
        <Err msg={err} />
      </Card>

      {camps && !camps.length && <Note>No camps or offers near {pin} right now. Clinics add new ones often — check again soon.</Note>}
      {camps?.map(c => (
        <View key={c.id} style={[st.camp, c.kind === 'free_camp' ? st.free : st.offer]}>
          <Text style={[st.tag, c.kind === 'free_camp' ? st.tagFree : st.tagOffer]}>{c.kind === 'free_camp' ? '🏥 FREE CAMP · निःशुल्क कैंप' : '🎁 OFFER · ऑफर'}</Text>
          <Text style={st.title}>{c.title}</Text>
          <Text style={st.when}>📅 {day(c.date_from)}{c.date_to > c.date_from ? ` – ${day(c.date_to)}` : ''}{c.time_slot ? ` · ${c.time_slot}` : ''}</Text>
          {!!c.description && <Text style={st.body}>{c.description}</Text>}
          {!!c.services && <Text style={st.meta}>Includes: {c.services}</Text>}
          {!!c.business_name && <Text style={st.biz}>{c.business_name}{!c.near && c.city ? ` · ${c.city}` : ''}</Text>}
          {!!c.address && <Text style={st.meta}>📍 {c.address}</Text>}
          {!!c.phone && <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)}><Text style={st.link}>📞 Call to ask or register</Text></Pressable>}
        </View>
      ))}
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  h: { fontSize: 19, fontWeight: '800', color: C.ink },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  loc: { backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  locT: { fontSize: 18 },
  camp: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1.5, padding: 14, gap: 4 },
  free: { borderColor: '#b7e2cf' },
  offer: { borderColor: '#f3d9a4' },
  tag: { alignSelf: 'flex-start', fontSize: 11.5, fontWeight: '800', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  tagFree: { backgroundColor: '#e3f3ec', color: '#0b7d57' },
  tagOffer: { backgroundColor: '#fbf1dc', color: '#8a5a00' },
  title: { fontSize: 16.5, fontWeight: '800', color: C.ink, marginTop: 4 },
  when: { fontSize: 14, fontWeight: '700', color: C.ink },
  body: { fontSize: 14, color: C.ink },
  biz: { fontSize: 14, fontWeight: '700', color: C.ink, marginTop: 4 },
  meta: { fontSize: 13, color: C.muted },
  link: { color: C.green, fontWeight: '800', marginTop: 6 },
})
