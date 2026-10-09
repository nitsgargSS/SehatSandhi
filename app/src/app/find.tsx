import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { supabase } from '../lib/supabase'
import { matchText, looksLikeEmergency, dayOffset, summary, SECONDARY_HI, type Match } from '../lib/match'
import { whereAmI, me, requestCode, verifyCode, bookAppointment, type Me, type Booked } from '../lib/patient'
import { registerPush } from '../lib/push'
import { SPECIALITIES, WA_NUMBER } from '@web/types'
import { C } from '../ui/theme'

// "Find a doctor" — what the WhatsApp bot does (speciality → area → doctor →
// time) but in conversation: say it any way, in English or Hindi, and it asks
// only for what is missing. What they type is understood by the database's
// matcher (0201, sehat_match_text) — the same one as the WhatsApp bot — never
// by rules in the app; only the emergency word check runs here when offline. Searching needs no login. Booking happens right
// here (0198): the patient proves their number once with a WhatsApp code, and
// the app books on it — the same open slots the bot and the clinic desk use.
// Medicines, ambulance and insurance go to the app's own screens, not WhatsApp.

type Doc = {
  /** 0221: what else they practise and the problems they treat. */
  other_specialities?: string[] | null; sub_specialities?: string[] | null
  practitioner_id: string | null; full_name: string; qualification: string | null; business_id: string
  business_name: string; address: string | null; consultation_fee: number | null; nearby: boolean; area: string | null
  slots: string[]; slotDay: number; code: string | null; phone: string | null
}
type Msg =
  | { id: number; from: 'me' | 'bot'; text: string; chips?: { label: string; say: string }[] }
  | { id: number; from: 'bot'; doctors: Doc[]; dayLabel: string }
  | { id: number; from: 'bot'; book: { doc: Doc; slot: string } }
  | { id: number; from: 'bot'; places: Place[]; kind: Kind }

// Omit that keeps each kind of message separate (plain Omit merges the union).
type NewMsg = Msg extends infer M ? M extends unknown ? Omit<M, 'id'> : never : never

// Other kinds of place, listed by the same public function the WhatsApp bot uses
// (bot_bookable). Labs have bookable times; the rest are called or reached
// through the app's own request screens.
type Kind = 'hospital' | 'lab' | 'pharmacy' | 'ambulance' | 'insurance'
type Place = {
  business_id: string; title: string; phone: string | null; address: string | null
  avg_rating: number | null; total_reviews: number | null; slots: string[]; slotDay: number
}
const KINDS: { id: Kind; label: string; en: string; hi: string }[] = [
  { id: 'hospital', label: '🏥 Hospital', en: 'Hospital', hi: 'अस्पताल' },
  { id: 'lab', label: '🧪 Lab test', en: 'Lab test', hi: 'जांच लैब' },
  { id: 'pharmacy', label: '💊 Medicines', en: 'Medicines', hi: 'दवाई' },
  { id: 'ambulance', label: '🚑 Ambulance', en: 'Ambulance', hi: 'एम्बुलेंस' },
  { id: 'insurance', label: '🛡️ Insurance', en: 'Insurance', hi: 'बीमा' },
]
const KIND_WORD: Record<Kind, string> = { hospital: 'hospitals', lab: 'labs', pharmacy: 'pharmacies', ambulance: 'ambulance services', insurance: 'insurance advisors' }
const kindChips = () => [...KINDS.map(k => ({ label: k.label, say: `__kind__${k.id}` })), { label: '🎁 Camps & offers', say: '__go__/camps' }]

// Every kind of doctor we list (the tests, labs and pharmacy have their own paths).
const NOT_DOCTORS = ['LAB', 'PATH', 'RAD', 'PHARMACY']
const DOCTORS = SPECIALITIES.filter(s => !NOT_DOCTORS.includes(s.id)).map(s => s.id)
const spName = (id?: string) => SPECIALITIES.find(s => s.id === id)
// Buttons carry their meaning; only typed words go to the matcher.
const spChip = (id: string) => ({ label: spName(id)!.en.split(' (')[0], say: `__sp__${id}` })
const istDate = (plusDays: number) => new Date(Date.now() + 5.5 * 3_600_000 + plusDays * 86_400_000).toISOString().slice(0, 10)
const DAY_WORD = ['today', 'tomorrow', 'day after tomorrow']
const slotText = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const timeText = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const KEY = 'sehat:lastArea'
const remember = (v: { pin: string; label: string }) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* fine */ } }
const recall = (): { pin: string; label: string } | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } }

/** A bare reply to "which area?" — a PIN, or a place name (checked against the place list). */
function asPlace(raw: string): { pin?: string; place?: string } {
  const pin = raw.match(/\b[1-9]\d{5}\b/)
  if (pin) return { pin: pin[0] }
  const p = raw.trim()
  return p.length >= 3 && /^[A-Za-zऀ-ॿ ]+$/.test(p) ? { place: p } : {}
}
const KIND_OF: Record<string, Kind> = { lab: 'lab', medicine: 'pharmacy', ambulance: 'ambulance', insurance: 'insurance' }
const SECONDARY_SAY: Record<string, string> = {
  lab: '__kind__lab', doctor: '__doctors__', medicine: '__go__/me/order', insurance: '__go__/me/insurance', camps: '__go__/camps', ambulance: '__go__/me/ambulance',
}

export default function Find() {
  // From Home: q = what they typed, m = the matcher's answer to it (so it is not asked twice); kind = a tile.
  const params = useLocalSearchParams<{ q?: string; m?: string; kind?: string }>()
  const pending = useRef<{ said: string; m: Match } | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ctx = useRef<{ speciality?: string; sub?: string; kind?: Kind; pin?: string; area?: string; day: number; hint?: string }>({ day: 0 })
  const scroll = useRef<ScrollView>(null)
  const n = useRef(0)
  const push = (m: NewMsg) => setMsgs(x => [...x, { ...m, id: ++n.current } as Msg])
  const bot = (t: string, chips?: { label: string; say: string }[]) => push({ from: 'bot', text: t, chips })

  useEffect(() => {
    const last = recall()
    if (last) { ctx.current.pin = last.pin; ctx.current.area = last.label }
    if (params.m && params.q) {
      try { apply(params.q, JSON.parse(params.m) as Match, true); return } catch { /* fall through to the welcome */ }
    }
    if (params.kind === 'lab') { handle('Lab test', 'lab'); return }
    bot('Namaste! Tell me what you need — for example "aankh ka doctor", "bachche ko bukhar", or "kal jagadhri me dentist". Or pick one:',
      kindChips())
    bot('Doctors / डॉक्टर:', DOCTORS.map(spChip))
  }, [])

  const placeToPin = async (place: string): Promise<{ pin: string; label: string } | null> => {
    const { data } = await supabase.rpc('sehat_area_search', { p_q: place, p_state: null })
    const r = data as { found?: boolean; label?: string; pin_code?: string | null; districts?: { district: string; pincodes: { pin: string; live: boolean }[] }[] } | null
    if (!r?.found) return null
    const pin = r.pin_code ?? r.districts?.[0]?.pincodes?.find(p => p.live)?.pin ?? r.districts?.[0]?.pincodes?.[0]?.pin
    return pin ? { pin, label: r.label ?? place } : null
  }

  const search = async () => {
    const { speciality, pin, area } = ctx.current
    if (!speciality || !pin) return
    // 0221: a problem they named ("sugar") narrows the search and puts those who treat it first.
    const { data, error } = await supabase.rpc('sehat_find_doctors',
      { p_speciality: speciality, p_pin_code: pin, ...(ctx.current.sub ? { p_sub: ctx.current.sub } : {}) })
    if (error) { bot('Sorry, the search did not work just now. Please try again.'); return }
    // One card per doctor per clinic (the search can return a doctor once per branch).
    const seen = new Set<string>()
    const found = ((data ?? []) as Omit<Doc, 'slots' | 'slotDay' | 'code' | 'phone'>[])
      .filter(d => { const k = `${d.practitioner_id}|${d.business_id}`; if (seen.has(k)) return false; seen.add(k); return true })
      .slice(0, 20)
    if (!found.length) {
      supabase.rpc('sehat_note_unmet', { p_speciality: speciality, p_pin: pin }).then(() => undefined, () => undefined)
      bot(`No ${spName(speciality)?.en ?? 'doctor'} near ${area ?? pin} has joined Sehatsandhi yet. We are growing across India and will be in your area soon — we have noted what you need. Try a nearby town, or another kind of doctor.`,
        DOCTORS.filter(c => c !== speciality).slice(0, 6).map(spChip))
      return
    }
    const ids = [...new Set(found.map(d => d.business_id))]
    const { data: biz } = await supabase.from('businesses').select('id, qr_code, phone').in('id', ids)
    const bmap = new Map(((biz ?? []) as { id: string; qr_code: string | null; phone: string | null }[]).map(b => [b.id, b]))
    // Open slots on the asked day; with none, the next day that has some (up to 3 days on).
    const docs: Doc[] = await Promise.all(found.map(async d => {
      for (let k = ctx.current.day; k <= Math.max(ctx.current.day, 2); k++) {
        const { data: w } = await supabase.rpc('sehat_open_windows', { p_business_id: d.business_id, p_date: istDate(k), p_practitioner_id: d.practitioner_id })
        const now = Date.now()
        const slots = ((w ?? []) as { window_start: string; seats_left: number }[])
          .filter(x => x.seats_left > 0 && new Date(x.window_start).getTime() > now + 15 * 60_000).map(x => x.window_start).slice(0, 6)
        if (slots.length) return { ...d, slots, slotDay: k, code: bmap.get(d.business_id)?.qr_code ?? null, phone: bmap.get(d.business_id)?.phone ?? null }
      }
      return { ...d, slots: [], slotDay: ctx.current.day, code: bmap.get(d.business_id)?.qr_code ?? null, phone: bmap.get(d.business_id)?.phone ?? null }
    }))
    push({ from: 'bot', doctors: docs, dayLabel: DAY_WORD[ctx.current.day] })
    bot('Tap a time to book it. Want another day?', [
      { label: 'Today', say: '__day__0' }, { label: 'Tomorrow', say: '__day__1' }, { label: 'Day after', say: '__day__2' },
    ])
  }

  const searchPlaces = async () => {
    const { kind, pin, area } = ctx.current
    if (!kind || !pin) return
    const { data, error } = await supabase.rpc('bot_bookable', { p_kind: 'business', p_filter: kind, p_pincode: pin })
    if (error) { bot('Sorry, the search did not work just now. Please try again.'); return }
    const rows = ((data ?? []) as Omit<Place, 'slots' | 'slotDay'>[]).slice(0, 20)
    if (!rows.length) {
      supabase.rpc('sehat_note_unmet', { p_speciality: kind, p_pin: pin }).then(() => undefined, () => undefined)
      bot(`No ${KIND_WORD[kind]} near ${area ?? pin} have joined Sehatsandhi yet. We are growing across India and will be in your area soon. Try a nearby town or PIN code.`,
        kind === 'ambulance' ? [{ label: '📞 Call 108', say: '__tel__108' }] : undefined)
      return
    }
    const places: Place[] = await Promise.all(rows.map(async r => (
      { ...r, slots: [], slotDay: ctx.current.day }
    )))
    if (kind === 'ambulance') bot('In an emergency call 108 first — it is free.', [{ label: '📞 Call 108', say: '__tel__108' }])
    push({ from: 'bot', places, kind })
    const next: Record<Kind, { text: string; chips: { label: string; say: string }[] }> = {
      lab: { text: 'Tap "Choose tests & book" — sample at the lab or at home, at a time that suits you.', chips: [] },
      pharmacy: { text: 'Want medicines delivered? Send the prescription photo — a pharmacy near you tells you the total first.', chips: [{ label: '💊 Order medicines', say: '__go__/me/order' }] },
      ambulance: { text: 'Or alert all of them at once — the first to accept calls you and sees where you are.', chips: [{ label: '🚑 Alert ambulances near me', say: '__go__/me/ambulance' }] },
      insurance: { text: 'Tell us the cover you want and one of these advisors calls you back. Only the advisor who takes it gets your number.', chips: [{ label: '🛡️ Ask for an advisor', say: '__go__/me/insurance' }] },
      hospital: { text: 'To see a doctor there, pick the kind of doctor:', chips: DOCTORS.slice(0, 8).map(spChip) },
    }
    bot(next[kind].text, next[kind].chips)
  }

  // What the matcher understood → the conversation's context, then on as before.
  // fromHome: the home box already asked (and logged) it.
  const apply = async (said: string, m: Match, fromHome = false) => {
    if (fromHome) push({ from: 'me', text: said })
    if (m.is_emergency || m.action === 'emergency') {
      bot('🚨 This looks like an emergency. Call 108 now — it is free.', [{ label: '📞 Call 108', say: '__tel__108' }, { label: '📞 112', say: '__tel__112' }])
      router.push('/emergency')
      return
    }
    if (m.action === 'confirm') {
      pending.current = { said, m }
      bot(m.reply_text.replace(/\n?हाँ \/ नहीं\s*$/, ''), [{ label: 'हाँ / Yes', say: '__yes__' }, { label: 'नहीं / No', say: '__no__' }])
      return
    }
    if (m.place_live === false && (m.intent || ctx.current.speciality || ctx.current.kind)) {
      // 0212/0213: nobody has joined in that district yet (the server counted it as area interest).
      bot(`Sehatsandhi is growing across India 🙏 Nobody in ${m.location} has joined us for this yet — we will be in your area soon, and we have noted what you need.\n\nNeed it somewhere else? Type that PIN code or town.`)
      if (m.intent === 'doctor' && m.speciality) { ctx.current.speciality = m.speciality; ctx.current.kind = undefined }
      else if (m.intent && KIND_OF[m.intent]) { ctx.current.kind = KIND_OF[m.intent]; ctx.current.speciality = undefined }
      ctx.current.pin = undefined; ctx.current.area = undefined
      return
    }
    if (m.action === 'menu' || !m.intent) {
      // A reply to "which area?" / "which day?": the place or day the matcher found, or a town to look up.
      if (ctx.current.speciality || ctx.current.kind) {
        if (m.pincode || m.target_date) { await understood({ pin: m.pincode ?? undefined, area: m.location ?? undefined, day: dayOffset(m) }); return }
        const pl = asPlace(said)
        if (pl.pin || pl.place) { await understood({ place: pl.place, pin: pl.pin }); return }
      }
      bot('माफ़ कीजिए, हम समझ नहीं पाए। Sorry, I did not understand — pick one, or describe the problem differently:', kindChips())
      bot('Doctors / डॉक्टर:', DOCTORS.map(spChip))
      return
    }
    if (m.intent === 'camps') { bot('Free health camps and special offers near you:', [{ label: '🎁 Camps & offers', say: '__go__/camps' }]); return }
    bot(`आपने खोजा: ${summary(m)}`, m.secondary_intents?.filter(x => SECONDARY_HI[x]).map(x => ({ label: SECONDARY_HI[x], say: SECONDARY_SAY[x] })))
    await understood({
      speciality: m.intent === 'doctor' ? m.speciality ?? undefined : undefined,
      sub: m.intent === 'doctor' ? m.sub_speciality ?? undefined : undefined,
      kind: KIND_OF[m.intent], doctorAny: m.intent === 'doctor' && !m.speciality,
      pin: m.pincode ?? undefined, area: m.location ?? undefined, day: dayOffset(m), hint: m.lab_test_hint ?? undefined,
    })
  }

  // preset: a tapped service chip — its label is not sent to the matcher.
  const handle = async (said: string, preset?: Kind) => {
    if (!said.trim()) return
    push({ from: 'me', text: said })
    setBusy(true)
    try {
      if (preset) { await understood({ kind: preset }); return }
      const m = await matchText(said, ctx.current.pin)
      if (!m) {
        if (looksLikeEmergency(said)) { router.push('/emergency'); return }
        bot('The network is slow — please pick one:', kindChips())
        return
      }
      await apply(said, m)
    } finally {
      setBusy(false)
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 200)
    }
  }

  const understood = async (u: { speciality?: string; sub?: string; kind?: Kind; doctorAny?: boolean; pin?: string; area?: string; place?: string; day?: number; hint?: string }) => {
    setBusy(true)
    try {
      // Pharmacies, labs, hospitals, ambulances and advisors: listed here too.
      if (u.kind) { ctx.current.kind = u.kind; ctx.current.speciality = undefined }
      // A new speciality forgets the last problem named, unless this one names its own.
      if (u.speciality) { ctx.current.speciality = u.speciality; ctx.current.sub = u.sub; ctx.current.kind = undefined }
      if (u.doctorAny) { ctx.current.kind = undefined }
      if (u.day !== undefined) ctx.current.day = u.day
      if (u.hint !== undefined) ctx.current.hint = u.hint
      if (u.pin) { ctx.current.pin = u.pin; ctx.current.area = u.area ?? u.pin }
      if (u.place && !u.pin) {
        const hit = await placeToPin(u.place)
        if (hit) { ctx.current.pin = hit.pin; ctx.current.area = hit.label }
        else { bot(`I could not find "${u.place}". Type the PIN code (6 digits) or a nearby town.`); return }
      }
      if (u.pin || ctx.current.pin) remember({ pin: ctx.current.pin!, label: ctx.current.area ?? ctx.current.pin! })
      if (ctx.current.kind && !ctx.current.speciality) {
        const k = ctx.current.kind
        if (!ctx.current.pin) { bot(`${KINDS.find(x => x.id === k)!.en} — got it. Which area? Type your PIN code or town, or tap 📍.`); return }
        bot(`Looking for ${KIND_WORD[k]} near ${ctx.current.area ?? ctx.current.pin}…`)
        await searchPlaces()
        return
      }
      if (!ctx.current.speciality) {
        bot('Which kind of doctor? You can also just describe the problem.', DOCTORS.map(spChip))
        return
      }
      if (!ctx.current.pin) {
        bot(`${spName(ctx.current.speciality)?.en} — got it. Which area? Type your PIN code or town, or tap 📍.`)
        return
      }
      bot(`Looking for ${spName(ctx.current.speciality)?.en} near ${ctx.current.area ?? ctx.current.pin}, ${DAY_WORD[ctx.current.day]}…`)
      await search()
    } finally {
      setBusy(false)
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 200)
    }
  }

  const tapChip = (say: string) => {
    if (say.startsWith('__tel__')) { Linking.openURL(`tel:${say.slice(7)}`); return }
    if (say.startsWith('__go__')) { router.push(say.slice(6) as '/me/order'); return }
    if (say.startsWith('__kind__')) {
      const k = say.slice(8) as Kind
      handle(KINDS.find(x => x.id === k)!.en, k)
      return
    }
    if (say.startsWith('__wa__')) { Linking.openURL(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(say.slice(6))}`); return }
    if (say.startsWith('__sp__')) {
      const id = say.slice(6)
      push({ from: 'me', text: spName(id)?.en ?? id })
      understood({ speciality: id })
      return
    }
    if (say.startsWith('__day__')) {
      const d = Number(say.slice(7))
      push({ from: 'me', text: DAY_WORD[d] })
      understood({ day: d })
      return
    }
    if (say === '__doctors__') { bot('Which kind of doctor?', DOCTORS.map(spChip)); return }
    if (say === '__yes__' || say === '__no__') {
      const p = pending.current
      pending.current = null
      push({ from: 'me', text: say === '__yes__' ? 'हाँ' : 'नहीं' })
      if (say === '__yes__' && p) apply(p.said, { ...p.m, action: 'proceed' })
      else { bot('Please pick one:', kindChips()); bot('Doctors / डॉक्टर:', DOCTORS.map(spChip)) }
      return
    }
    handle(say)
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroll} contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {msgs.map(m => {
          if ('doctors' in m) return (
            <View key={m.id} style={{ gap: 10 }}>
              {m.doctors.map(d => (
                <View key={`${d.practitioner_id}-${d.business_id}`} style={st.doc}>
                  <Text style={st.docName}>{d.full_name}</Text>
                  {!!d.qualification && <Text style={st.meta}>{d.qualification}</Text>}
                  <Text style={st.clinic}>{d.business_name}{d.area ? ` · ${d.area}` : ''}{d.nearby ? '' : ' · in your district'}</Text>
                  {!!d.address && <Text style={st.meta} numberOfLines={2}>{d.address}</Text>}
                  {d.consultation_fee != null && d.consultation_fee > 0 && <Text style={st.meta}>Fee ₹{d.consultation_fee}</Text>}
                  {d.slots.length ? (
                    <>
                      <Text style={st.slotHead}>Open {d.slotDay === m.doctors[0].slotDay && d.slotDay === ctx.current.day ? DAY_WORD[d.slotDay] : DAY_WORD[d.slotDay]}:</Text>
                      <View style={st.chips}>
                        {d.slots.map(sl => (
                          <Pressable key={sl} style={st.slot} onPress={() => push({ from: 'bot', book: { doc: d, slot: sl } })}>
                            <Text style={st.slotText}>{timeText(sl)}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : (
                    <Text style={st.meta}>No open times in the next 3 days.{d.phone ? ' ' : ''}{!!d.phone && <Text style={st.link} onPress={() => Linking.openURL(`tel:${d.phone}`)}>Call the clinic</Text>}</Text>
                  )}
                </View>
              ))}
            </View>
          )
          if ('book' in m) return <BookCard key={m.id} doc={m.book.doc} slot={m.book.slot} />
          if ('places' in m) return (
            <View key={m.id} style={{ gap: 10 }}>
              {m.places.map(pl => (
                <View key={pl.business_id} style={st.doc}>
                  <Text style={st.docName}>{pl.title}</Text>
                  {!!pl.address && <Text style={st.meta} numberOfLines={2}>{pl.address}</Text>}
                  <Text style={st.meta}>{pl.avg_rating != null ? `★ ${pl.avg_rating} · ${pl.total_reviews} reviews` : 'New on Sehatsandhi'}</Text>
                  {/* 0207: tests, prices, lab or home, a time — on the lab's own screen. */}
                  {m.kind === 'lab' && (
                    <Pressable style={[st.slot, { alignSelf: 'flex-start', marginTop: 6 }]}
                      onPress={() => router.push({ pathname: '/lab/[id]', params: { id: pl.business_id, hint: ctx.current.hint ?? '' } })}>
                      <Text style={st.slotText}>🧪 Choose tests & book</Text>
                    </Pressable>
                  )}
                  {/* Advisors are reached through a request (a paid lead), never a listed number. */}
                  {m.kind !== 'insurance' && !!pl.phone && (
                    <Pressable onPress={() => Linking.openURL(`tel:${pl.phone}`)}><Text style={[st.link, { textAlign: 'left', marginTop: 4 }]}>📞 Call {m.kind === 'pharmacy' ? 'the shop' : m.kind === 'ambulance' ? 'this ambulance' : m.kind === 'lab' ? 'the lab' : 'the hospital'}</Text></Pressable>
                  )}
                </View>
              ))}
            </View>
          )
          return (
            <View key={m.id} style={{ gap: 6, alignItems: m.from === 'me' ? 'flex-end' : 'flex-start' }}>
              <View style={[st.bubble, m.from === 'me' ? st.meB : st.botB]}>
                <Text style={m.from === 'me' ? st.meT : st.botT}>{m.text}</Text>
              </View>
              {!!m.chips?.length && (
                <View style={st.chips}>
                  {m.chips.map(c => (
                    <Pressable key={c.label} style={st.chip} onPress={() => tapChip(c.say)}><Text style={st.chipT}>{c.label}</Text></Pressable>
                  ))}
                </View>
              )}
            </View>
          )
        })}
        {busy && <Text style={st.meta}>…</Text>}
      </ScrollView>
      <View style={st.bar}>
        {/* 0196: the PIN from where the phone is, instead of typing it */}
        <Pressable style={st.send} accessibilityLabel="Use my location"
          onPress={() => whereAmI().then(p => p.pin ? handle(p.pin) : bot('I could not find your PIN code from your location. Please type it.')).catch(e => bot((e as Error).message))}>
          <Text style={st.sendT}>📍</Text></Pressable>
        <TextInput style={st.input} placeholder="Type here — any language" value={text} onChangeText={setText}
          onSubmitEditing={() => { const t = text; setText(''); handle(t) }} returnKeyType="send" />
        <Pressable style={st.send} onPress={() => { const t = text; setText(''); handle(t) }}><Text style={st.sendT}>Send</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

// Confirm a time: who it is for, then book. Signs the patient in first if needed.
function BookCard({ doc, slot }: { doc: Doc; slot: string }) {
  const [who, setWho] = useState<Me | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [dev, setDev] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Booked | null>(null)

  useEffect(() => { me().then(m => { setWho(m); if (m?.name) setName(m.name) }).catch(() => setWho(null)) }, [])

  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const send = () => run(async () => { const r = await requestCode(phone); setSent(true); setDev(r.devCode ?? '') })
  const verify = () => run(async () => {
    await supabase.auth.signOut().catch(() => {})
    await verifyCode(phone, code)
    registerPush().catch(() => {})
    const m = await me(); setWho(m); if (m?.name && !name) setName(m.name)
  })
  const book = () => run(async () => {
    const a = age.trim() ? Number(age.replace(/\D/g, '')) : null
    setDone(await bookAppointment(doc.business_id, doc.practitioner_id, slot, name, a))
  })

  if (done) return (
    <View style={[st.bubble, st.botB, { borderColor: C.green, borderWidth: 2 }]}>
      <Text style={st.okT}>✅ Booked</Text>
      <Text style={st.botT}>{done.name}{done.doctor ? ` · ${done.doctor}` : ''}{'\n'}{done.clinic}{'\n'}{slotText(done.at)}</Text>
      {!!done.address && <Text style={st.meta}>{done.address}</Text>}
      <Text style={st.small}>Please arrive 10 minutes early. The clinic has your booking.</Text>
      <Pressable style={st.primary} onPress={() => router.push('/me')}><Text style={st.primaryT}>See my bookings</Text></Pressable>
      {!!done.phone && <Pressable onPress={() => Linking.openURL(`tel:${done.phone}`)}><Text style={st.link}>Call the clinic</Text></Pressable>}
    </View>
  )

  return (
    <View style={[st.bubble, st.botB]}>
      <Text style={st.botT}>{doc.practitioner_id ? `${doc.full_name}, ${doc.business_name}` : doc.business_name}{'\n'}<Text style={{ fontWeight: '800' }}>{slotText(slot)}</Text></Text>
      {who === undefined ? <ActivityIndicator color={C.green} /> : !who ? (
        <>
          <Text style={st.small}>To book, confirm your mobile number once — we send a code on WhatsApp.</Text>
          <TextInput style={st.field} placeholder="Mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={!sent} />
          {!sent ? (
            <Pressable style={[st.primary, (busy || phone.replace(/\D/g, '').length < 10) && st.off]} disabled={busy || phone.replace(/\D/g, '').length < 10} onPress={send}>
              <Text style={st.primaryT}>{busy ? '…' : 'Send code'}</Text></Pressable>
          ) : (
            <>
              <TextInput style={st.field} placeholder="6-digit code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} />
              {!!dev && <Text style={st.small}>Test mode: your code is {dev}</Text>}
              <Pressable style={[st.primary, (busy || code.length !== 6) && st.off]} disabled={busy || code.length !== 6} onPress={verify}>
                <Text style={st.primaryT}>{busy ? '…' : 'Confirm number'}</Text></Pressable>
              <Pressable onPress={() => { setSent(false); setCode('') }}><Text style={st.link}>Change number</Text></Pressable>
            </>
          )}
        </>
      ) : (
        <>
          <Text style={st.small}>Booking on +{who.phone}. Who is the patient?</Text>
          <TextInput style={st.field} placeholder="Patient's name" value={name} onChangeText={setName} />
          <TextInput style={st.field} placeholder="Age (optional)" keyboardType="number-pad" maxLength={3} value={age} onChangeText={setAge} />
          <Pressable style={[st.primary, (busy || !name.trim()) && st.off]} disabled={busy || !name.trim()} onPress={book}>
            <Text style={st.primaryT}>{busy ? 'Booking…' : 'Confirm booking'}</Text></Pressable>
        </>
      )}
      {!!err && <Text style={st.err}>{err}</Text>}
      {!!doc.phone && <Pressable onPress={() => Linking.openURL(`tel:${doc.phone}`)}><Text style={st.link}>Call the clinic</Text></Pressable>}
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 20 },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  botB: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignSelf: 'flex-start', gap: 8 },
  meB: { backgroundColor: C.green },
  botT: { color: C.ink, fontSize: 15 },
  meT: { color: '#fff', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: C.green, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipT: { color: C.green, fontWeight: '700', fontSize: 13 },
  doc: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 3 },
  docName: { fontSize: 16.5, fontWeight: '800', color: C.ink },
  clinic: { fontSize: 14, color: C.ink, fontWeight: '600' },
  meta: { fontSize: 13, color: C.muted },
  slotHead: { fontSize: 12.5, fontWeight: '700', color: C.muted, marginTop: 6 },
  slot: { backgroundColor: '#eaf7f0', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  slotText: { color: C.green, fontWeight: '800' },
  primary: { backgroundColor: C.green, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  off: { opacity: 0.5 },
  field: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, minWidth: 240 },
  okT: { fontSize: 17, fontWeight: '800', color: C.green },
  err: { color: '#b42318', fontSize: 13 },
  link: { color: C.green, fontWeight: '700', textAlign: 'center' },
  small: { fontSize: 12, color: C.muted },
  bar: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card },
  input: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  send: { backgroundColor: C.green, borderRadius: 20, paddingHorizontal: 16, justifyContent: 'center' },
  sendT: { color: '#fff', fontWeight: '800' },
})
