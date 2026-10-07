import { useCallback, useEffect, useState } from 'react'
import { Image, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useSession } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { IS_STAGING } from '../../lib/env'
import { bytesOf, pickPhoto, takePhoto, type Picked } from '../../lib/patient'
import { DAYS_OF_WEEK, type AvailabilityTemplate } from '@web/lib/availability'
import { doctorUrl } from '@web/lib/links'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// Doctors, fees, hours — the website's set-up pieces on a phone, same tables
// and functions:
//   * OPD fee and an optional discounted price: sehat_set_opd_fee (0132) —
//     DoctorWorkspace.tsx OpdFee. The server decides who may: the doctor
//     themselves, the owner or a manager.
//   * Public profile: practitioners (qualification, years, languages, about,
//     photo in 'profile-photos' at <practitioner id>/photo-…) —
//     PublicProfileEditor.tsx.
//   * Weekly hours: the availability template — Dashboard.tsx schedule tab:
//     per location, for "Everyone" (the clinic's own hours) or one doctor;
//     delete-then-insert scoped to that location and that person, so saving
//     one never touches another's. The clash guard (0076) refuses overlaps.
// Who sees what, as on the website: an owner or manager every doctor here
// (Clinic → Doctors → "Fee & public profile"); a doctor only themselves
// (My practice). Hours: owner / manager all; a doctor their own week only.
const LANGS = ['Hindi', 'English', 'Punjabi', 'Haryanvi', 'Urdu', 'Bengali', 'Marathi', 'Gujarati', 'Tamil', 'Telugu']
const SITE = IS_STAGING ? 'https://sehat-sandhi-staging.vercel.app' : 'https://sehatsandhi.com'
const WINDOWS: [number, string][] = [[30, 'Half-hourly'], [60, 'Hourly'], [120, '2-hourly']]

interface RosterRow { id: string; practitioner_id: string; role: string; status: string; name: string }

export default function Doctors() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const role = s?.role.role ?? null
  const runsIt = !s?.role.enforced || role === 'owner' || role === 'manager'
  const me = s?.doctorId ?? null
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!biz) return
    const { data, error } = await supabase.from('business_practitioners')
      .select('id, practitioner_id, role, status, practitioners(full_name)').eq('business_id', biz)
    if (error) { setErr(error.message); return }
    setRoster(((data ?? []) as unknown as { id: string; practitioner_id: string; role: string; status: string; practitioners: { full_name: string } | null }[])
      .filter(r => r.practitioners).map(r => ({ id: r.id, practitioner_id: r.practitioner_id, role: r.role, status: r.status, name: r.practitioners!.full_name }))
      .sort((a, b) => a.name.localeCompare(b.name)))
  }, [biz])
  useFocusEffect(useCallback(() => { load() }, [load]))

  // Fee & profile: the owner / manager for every doctor on the roster; anyone
  // who prescribes, for themselves.
  const mine = roster.filter(r => r.status !== 'suspended' && (
    (runsIt && r.role === 'doctor') || (me && r.practitioner_id === me && ['doctor', 'owner'].includes(r.role))))
  // Hours: "Everyone" + each active doctor for the owner / manager; a doctor
  // only their own week.
  const hourPeople = roster.filter(r => r.role === 'doctor' && r.status === 'active' && (runsIt || r.practitioner_id === me))

  if (!biz) return <View style={{ padding: 20 }}><Note>Loading…</Note></View>

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <Err msg={err} />
        {(runsIt || hourPeople.length > 0 || !!me) && <Hours biz={biz} people={hourPeople} everyone={runsIt} />}
        <Label>{runsIt ? 'Doctors — fee & public profile' : 'My fee & public profile'}</Label>
        {mine.map(r => (
          <Card key={r.practitioner_id}>
            <View style={st.between}>
              <Text style={st.name}>{r.name}</Text>
              <Text style={st.link} onPress={() => setOpen(open === r.practitioner_id ? null : r.practitioner_id)}>{open === r.practitioner_id ? 'Close' : 'Edit'}</Text>
            </View>
            {open === r.practitioner_id && (
              <View style={{ gap: 12 }}>
                <Fee biz={biz} practitionerId={r.practitioner_id} />
                <Profile practitionerId={r.practitioner_id} />
              </View>
            )}
          </Card>
        ))}
        {!mine.length && <Note>{runsIt ? 'No doctors on your team yet — add them on the computer (Clinic → Doctors).' : 'Only a doctor sets their own fee and profile here.'}</Note>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── OPD fee (DoctorWorkspace.tsx OpdFee) ────────────────────────────────────
function Fee({ biz, practitionerId }: { biz: string; practitionerId: string }) {
  const [fee, setFee] = useState('')
  const [disc, setDisc] = useState('')
  const [offer, setOffer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('business_practitioners').select('consultation_fee, discounted_fee')
      .eq('business_id', biz).eq('practitioner_id', practitionerId).maybeSingle()
      .then(({ data }) => {
        const d = data as { consultation_fee: number | null; discounted_fee: number | null } | null
        setFee(d?.consultation_fee ? String(d.consultation_fee) : '')
        setDisc(d?.discounted_fee != null ? String(d.discounted_fee) : '')
        setOffer(d?.discounted_fee != null)
      })
  }, [biz, practitionerId])

  const save = async () => {
    setErr(''); setMsg('')
    const f = Number(fee)
    const dv = offer && disc !== '' ? Number(disc) : null
    if (fee === '' || !Number.isFinite(f) || f < 0) { setErr('Enter the regular fee in rupees.'); return }
    if (dv !== null && (!Number.isFinite(dv) || dv < 0 || dv >= f)) { setErr(`The discounted price must be less than ₹${f}.`); return }
    setBusy(true)
    const { error } = await supabase.rpc('sehat_set_opd_fee', {
      p_business: biz, p_practitioner: practitionerId, p_fee: Math.round(f), p_discounted_fee: dv === null ? null : Math.round(dv),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg(dv !== null ? `Saved. The WhatsApp bot now shows ₹${Math.round(f)} crossed out and ₹${Math.round(dv)}.` : `Saved. The WhatsApp bot now shows ₹${Math.round(f)}.`)
  }

  return (
    <View style={st.block}>
      <Text style={st.h}>OPD fee</Text>
      <Note>What patients see in the WhatsApp bot and on the profile for a consultation here.</Note>
      <Field label="Regular fee (₹)" value={fee} keyboardType="number-pad" placeholder="e.g. 600" onChangeText={t => setFee(t.replace(/\D/g, ''))} />
      <View style={st.row}><Chip label="Offer a discount" on={offer} onPress={() => setOffer(!offer)} /></View>
      {offer && <Field label="Discounted price (₹)" value={disc} keyboardType="number-pad" placeholder="e.g. 450" onChangeText={t => setDisc(t.replace(/\D/g, ''))} />}
      <Err msg={err} />
      {!!msg && <Text style={st.ok}>{msg}</Text>}
      <Btn small label="Save fee" busy={busy} disabled={fee === ''} onPress={save} />
    </View>
  )
}

// ── Public profile (PublicProfileEditor.tsx) ────────────────────────────────
function Profile({ practitionerId }: { practitionerId: string }) {
  const [p, setP] = useState<{ full_name: string; qualification: string; about: string; experience: string; languages: string[]; photo_url: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('practitioners').select('full_name, qualification, about, experience_years, languages, photo_url')
      .eq('id', practitionerId).maybeSingle()
      .then(({ data }) => {
        const d = data as { full_name: string; qualification: string | null; about: string | null; experience_years: number | null; languages: string[] | null; photo_url: string | null } | null
        if (d) setP({ full_name: d.full_name, qualification: d.qualification ?? '', about: d.about ?? '', experience: d.experience_years != null ? String(d.experience_years) : '', languages: d.languages ?? [], photo_url: d.photo_url })
      })
  }, [practitionerId])
  if (!p) return null

  const save = async (patch?: Record<string, unknown>) => {
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.from('practitioners').update(patch ?? {
      qualification: p.qualification.trim() || null,
      about: p.about.trim() || null,
      experience_years: p.experience ? Number(p.experience) : null,
      languages: p.languages.length ? p.languages : null,
    }).eq('id', practitionerId)
    setBusy(false)
    if (error) setErr(error.message); else setMsg('Saved — the public page is updated.')
  }

  const photo = async (get: () => Promise<Picked | null>) => {
    setErr(''); setMsg('')
    try {
      const f = await get()
      if (!f) return
      const mime = f.mime === 'image/jpg' ? 'image/jpeg' : f.mime
      if (!/^image\/(png|jpeg|webp)$/.test(mime)) { setErr('Use a PNG, JPG or WebP photo.'); return }
      setBusy(true)
      const bytes = await bytesOf(f.uri)
      if (bytes.byteLength > 3 * 1024 * 1024) { setBusy(false); setErr('Keep the photo under 3 MB.'); return }
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
      const path = `${practitionerId}/photo-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('profile-photos').upload(path, bytes, { contentType: mime })
      if (upErr) { setBusy(false); setErr(upErr.message); return }
      const url = supabase.storage.from('profile-photos').getPublicUrl(path).data.publicUrl
      setP({ ...p, photo_url: url })
      await save({ photo_url: url })
    } catch (e) { setBusy(false); setErr((e as Error).message) }
  }

  return (
    <View style={st.block}>
      <View style={st.between}>
        <Text style={st.h}>Public profile</Text>
        <Text style={st.link} onPress={() => Linking.openURL(`${SITE}${doctorUrl({ id: practitionerId, name: p.full_name })}`)}>View page</Text>
      </View>
      <Note>The page the WhatsApp bot and the website link patients to.</Note>
      <View style={[st.row, { gap: 10 }]}>
        {p.photo_url
          ? <Image source={{ uri: p.photo_url }} style={st.photo} />
          : <View style={[st.photo, st.noPhoto]}><Text style={st.initial}>{p.full_name.split(' ').pop()?.charAt(0)}</Text></View>}
        <View style={{ gap: 6 }}>
          <Btn small label="📷 Take photo" busy={busy} onPress={() => photo(takePhoto)} />
          <Btn small kind="ghost" label="🖼 Choose photo" onPress={() => photo(pickPhoto)} />
        </View>
      </View>
      <Field label="Qualification" value={p.qualification} placeholder="e.g. MBBS, MS (Ophthalmology)" onChangeText={t => setP({ ...p, qualification: t })} />
      <Field label="Years of experience" value={p.experience} keyboardType="number-pad" placeholder="e.g. 12" onChangeText={t => setP({ ...p, experience: t.replace(/\D/g, '').slice(0, 2) })} />
      <Text style={st.meta}>Languages spoken</Text>
      <View style={st.row}>{LANGS.map(l => {
        const on = p.languages.includes(l)
        return <Chip key={l} label={l} on={on} onPress={() => setP({ ...p, languages: on ? p.languages.filter(x => x !== l) : [...p.languages, l] })} />
      })}</View>
      <Field label={`About (${p.about.length}/1500)`} value={p.about} multiline maxLength={1500} style={{ minHeight: 100, textAlignVertical: 'top' }}
        placeholder="What you treat, special interests, procedures, where you trained…" onChangeText={t => setP({ ...p, about: t })} />
      <Err msg={err} />
      {!!msg && <Text style={st.ok}>{msg}</Text>}
      <Btn small label="Save profile" busy={busy} onPress={() => save()} />
    </View>
  )
}

// ── Weekly hours (Dashboard.tsx schedule tab) ──────────────────────────────
type Row = AvailabilityTemplate
const hhmm = (t: string) => t.slice(0, 5)
const okTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

function Hours({ biz, people, everyone }: { biz: string; people: RosterRow[]; everyone: boolean }) {
  const [locs, setLocs] = useState<{ id: string; name: string }[]>([])
  const [loc, setLoc] = useState('')
  const [bp, setBp] = useState<string>(everyone ? '' : people[0]?.id ?? '')
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState<Record<number, { start: string; end: string }>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { if (!everyone && !bp && people[0]) setBp(people[0].id) }, [everyone, people, bp])

  const loadRows = useCallback(async () => {
    const { data } = await supabase.from('availability').select('*').eq('business_id', biz).eq('is_active', true)
    setRows((data as Row[]) ?? []); setDraft({})
  }, [biz])
  useEffect(() => {
    supabase.from('practice_locations').select('id, name').eq('business_id', biz).eq('is_active', true)
      .order('is_primary', { ascending: false }).order('created_at')
      .then(({ data }) => {
        const l = (data ?? []) as { id: string; name: string }[]
        setLocs(l); setLoc(cur => cur && l.some(x => x.id === cur) ? cur : (l[0]?.id ?? ''))
      })
    loadRows()
  }, [biz, loadRows])

  if (!everyone && !bp) return null
  const inScope = (a: Row, dow: number) => a.day_of_week === dow && (a.location_id ?? '') === loc && (a.business_practitioner_id ?? '') === bp
  const dayRow = (dow: number) => rows.find(a => inScope(a, dow))
  const toggle = (dow: number) => {
    setMsg('')
    if (dayRow(dow)) setRows(r => r.filter(a => !inScope(a, dow)))
    else setRows(r => [...r, {
      id: `new-${dow}-${loc}-${bp}`, business_id: biz, location_id: loc, business_practitioner_id: bp || null, day_of_week: dow,
      start_time: '10:00:00', end_time: '18:00:00', slot_duration_minutes: 60, slot_capacity: 4, is_active: true,
    }])
  }
  const update = (dow: number, field: 'start_time' | 'end_time' | 'slot_duration_minutes' | 'slot_capacity', v: string | number) => {
    setMsg(''); setRows(r => r.map(a => inScope(a, dow) ? { ...a, [field]: v } : a))
  }
  const typeTime = (dow: number, which: 'start' | 'end', t: string) => {
    const v = t.replace(/[^\d:]/g, '').slice(0, 5)
    const row = dayRow(dow)!
    setDraft(d => ({ ...d, [dow]: { start: d[dow]?.start ?? hhmm(row.start_time), end: d[dow]?.end ?? hhmm(row.end_time), [which]: v } }))
    if (okTime(v)) update(dow, which === 'start' ? 'start_time' : 'end_time', `${v}:00`)
  }

  const save = async () => {
    setErr(''); setMsg('')
    for (const [dow, d] of Object.entries(draft)) {
      if (dayRow(Number(dow)) && (!okTime(d.start) || !okTime(d.end))) { setErr('Write times as HH:MM, 24-hour — e.g. 09:30 or 17:00.'); return }
    }
    const mine = rows.filter(a => (a.location_id ?? '') === loc && (a.business_practitioner_id ?? '') === bp)
    if (mine.some(a => a.end_time <= a.start_time)) { setErr('Each day must end after it starts.'); return }
    setBusy(true)
    try {
      // Delete-then-insert, scoped to this location AND this person (see the
      // website's saveAvailability for why both).
      const delQ = supabase.from('availability').delete().eq('business_id', biz).eq('location_id', loc)
      const del = await (bp ? delQ.eq('business_practitioner_id', bp) : delQ.is('business_practitioner_id', null))
      if (del.error) throw new Error(del.error.message)
      if (mine.length) {
        const { error } = await supabase.from('availability').insert(mine.map(a => ({
          business_id: biz, location_id: loc || null, business_practitioner_id: bp || null, day_of_week: a.day_of_week,
          start_time: a.start_time, end_time: a.end_time, slot_duration_minutes: a.slot_duration_minutes,
          slot_capacity: a.slot_capacity ?? 4, is_active: true,
        })))
        if (error) { await loadRows(); throw new Error(error.message) }
      }
      await loadRows()
      setMsg('✓ Hours saved.')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card>
      <Label>Weekly hours</Label>
      {locs.length > 1 && <View style={st.row}>{locs.map(l => <Chip key={l.id} label={l.name} on={loc === l.id} onPress={() => { setLoc(l.id); setDraft({}) }} />)}</View>}
      {(everyone ? people.length > 0 : people.length > 1) && (
        <>
          <Text style={st.meta}>Whose hours</Text>
          <View style={st.row}>
            {everyone && <Chip label="Everyone" on={bp === ''} onPress={() => { setBp(''); setDraft({}) }} />}
            {people.map(r => <Chip key={r.id} label={r.name} on={bp === r.id} onPress={() => { setBp(r.id); setDraft({}) }} />)}
          </View>
        </>
      )}
      <Note>{bp === '' ? 'The clinic\'s hours — for any doctor without their own set.' : 'This doctor\'s own week here — replaces the clinic hours for them.'} Patients book a window (12–1, 1–2…); set how many fit in one.</Note>
      {DAYS_OF_WEEK.map(day => {
        const row = dayRow(day.value)
        const d = draft[day.value]
        return (
          <View key={day.value} style={[st.day, row && st.dayOn]}>
            <View style={st.between}>
              <Chip label={`${row ? '✓ ' : ''}${day.labelEn}`} on={!!row} onPress={() => toggle(day.value)} />
              {!row && <Text style={st.meta}>closed</Text>}
            </View>
            {row && (
              <View style={{ gap: 6 }}>
                <View style={st.row}>
                  <View style={{ flex: 1 }}><Field label="From (HH:MM)" value={d?.start ?? hhmm(row.start_time)} keyboardType="numbers-and-punctuation" onChangeText={t => typeTime(day.value, 'start', t)} /></View>
                  <View style={{ flex: 1 }}><Field label="To (HH:MM)" value={d?.end ?? hhmm(row.end_time)} keyboardType="numbers-and-punctuation" onChangeText={t => typeTime(day.value, 'end', t)} /></View>
                </View>
                <View style={st.row}>{WINDOWS.map(([m, l]) => <Chip key={m} label={l} on={row.slot_duration_minutes === m} onPress={() => update(day.value, 'slot_duration_minutes', m)} />)}</View>
                <Field label="Patients per window" value={String(row.slot_capacity ?? 4)} keyboardType="number-pad"
                  onChangeText={t => update(day.value, 'slot_capacity', Math.min(200, Math.max(1, parseInt(t.replace(/\D/g, '')) || 1)))} />
              </View>
            )}
          </View>
        )
      })}
      <Err msg={err} />
      {!!msg && <Text style={st.ok}>{msg}</Text>}
      <Btn label="Save hours" busy={busy} onPress={save} />
    </Card>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 15.5, fontWeight: '800', color: C.ink, flexShrink: 1 },
  h: { fontSize: 14.5, fontWeight: '800', color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  link: { color: C.green, fontWeight: '700' },
  ok: { color: C.green, fontWeight: '700' },
  block: { gap: 6, borderTopWidth: 1, borderTopColor: '#eef1ef', paddingTop: 10 },
  photo: { width: 72, height: 72, borderRadius: 12 },
  noPhoto: { backgroundColor: '#eef8f3', alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 26, fontWeight: '800', color: C.green },
  day: { borderWidth: 1, borderColor: '#eef1ef', borderRadius: 10, padding: 8, gap: 6 },
  dayOn: { borderColor: '#bfe3d3', backgroundColor: '#f6fbf8' },
})
