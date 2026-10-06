import { useCallback, useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useSession, ROLE_WORD } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import {
  addStaff, findPeople, requestStaffCode, confirmStaffCode, staffInvite, inviteWhatsAppUrl,
  type PersonMatch, type StaffAction, type StaffInvite,
} from '@web/lib/staffApi'
import { registerPractitioner } from '@web/lib/identityApi'
import { listUpcomingLeave, addLeave, cancelLeave, listLeaveConflicts, type Leave, type LeaveConflict } from '@web/lib/leaveApi'
import { isValidEmail } from '@web/lib/credentials'
import { SPECIALITIES } from '@web/types'
import { Btn, Card, Chip, Err, Field, Label, Note, toIso } from '../../ui/kit'
import { C } from '../../ui/theme'

// The team, for owners and managers — the website's "Your team" and leave
// panels (src/pages/doctor/Dashboard.tsx, LeavePanels.tsx) on a phone.
// Adding is immediate and sends the person a link to set up their login
// (29 Sep 2026); someone already on Sehatsandhi is found first and invited,
// never registered twice (0151). Removing, bringing back and changing a role
// are confirmed with a code emailed to whoever makes the change (0147).
// 'owner' is never offered: it comes with signing the business up.
const ROLES: Record<string, [string, string][]> = {
  pharmacy: [['pharmacist', 'Pharmacist / helper'], ['delivery', 'Delivery'], ['manager', 'Manager']],
  ambulance: [['driver', 'Driver'], ['manager', 'Manager']],
  default: [['doctor', 'Doctor'], ['nurse', 'Nurse'], ['receptionist', 'Reception'], ['manager', 'Manager']],
}
interface Member {
  id: string; practitioner_id: string; role: string; status: string; awaiting_payment?: boolean
  practitioners: { full_name: string; speciality: string | null; phone: string | null; email: string | null; auth_uid: string | null } | null
}
type Change = { person: Member; action: StaffAction; role?: string; reason: string; requestId?: string; sentTo?: string; code: string }
const blankNew = { name: '', role: '', phone: '', email: '', speciality: '', qualification: '', reg: '' }
const dt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

export default function Team() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const roles = ROLES[s?.clinic?.vertical ?? ''] ?? ROLES.default
  const manages = !s?.role.enforced || s?.role.role === 'owner' || s?.role.role === 'manager'
  const [team, setTeam] = useState<Member[]>([])
  const [leave, setLeave] = useState<Leave[]>([])
  const [clash, setClash] = useState<LeaveConflict[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [nw, setNw] = useState(blankNew)
  const [matches, setMatches] = useState<PersonMatch[] | null>(null)
  const [share, setShare] = useState<StaffInvite | null>(null)
  const [change, setChange] = useState<Change | null>(null)
  const [lv, setLv] = useState<{ doctor: string; from: string; to: string; reason: string } | null>(null)

  const load = useCallback(async () => {
    if (!biz) return
    const { data, error } = await supabase.from('business_practitioners')
      .select('id, practitioner_id, role, status, awaiting_payment, practitioners(full_name, speciality, phone, email, auth_uid)')
      .eq('business_id', biz).order('sort_order')
    if (error) { setErr(error.message); return }
    const rows = (data ?? []) as unknown as Member[]
    setTeam(rows)
    const docs = rows.filter(r => ['doctor', 'owner'].includes(r.role)).map(r => r.practitioner_id)
    listUpcomingLeave(docs.length ? docs : undefined).then(l => setLeave(l.filter(x => !x.business_id || x.business_id === biz))).catch(() => {})
    listLeaveConflicts(biz).then(setClash).catch(() => setClash([]))
  }, [biz])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { setMsg('') }, [adding])

  if (!manages) return <View style={{ padding: 20 }}><Note>Only the owner or a manager looks after the team.</Note></View>

  const run = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k); setErr('')
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const inviteLine = (i: StaffInvite | null) => !i ? '' : i.email === 'sent' && i.whatsapp === 'sent'
    ? 'Their login link went by email and WhatsApp.' : i.email === 'sent' ? 'Their login link went by email.'
    : i.whatsapp === 'sent' ? 'Their login link went on WhatsApp.' : 'Send them the login link below.'

  const add = (picked?: string) => run('add', async () => {
    setMsg('')
    if (!picked) {
      if (!nw.name.trim() || !nw.role) throw new Error('Enter their name and choose a role.')
      if (!isValidEmail(nw.email)) throw new Error('Enter their email — it is how they sign in.')
      if (nw.role === 'doctor' && !nw.speciality) throw new Error('Choose the doctor’s speciality — it decides their examination form.')
      if (matches === null) {
        const found = await findPeople(biz, nw.email.trim(), nw.phone.trim())
        if (found.length) { setMatches(found); return }
      }
    }
    const pid = picked ?? await registerPractitioner({
      fullName: nw.name.trim(), role: nw.role as never, phone: nw.phone.trim(), email: nw.email.trim(),
      speciality: nw.role === 'doctor' ? nw.speciality : null,
      qualification: nw.role === 'doctor' ? nw.qualification.trim() || null : null,
      regNumber: nw.role === 'doctor' ? nw.reg.trim() || null : null,
    })
    const done = await addStaff({ businessId: biz, practitionerId: pid, role: nw.role || 'doctor' })
    setMsg(`✓ ${nw.name.trim() || 'They'} ${done.result.awaiting_payment ? 'will be live once the extra doctor is paid for (Plan, on the computer)' : 'can start now'}. ${inviteLine(done.invite)}`)
    if (done.invite?.phone && done.invite.whatsapp !== 'sent') setShare(done.invite)
    setAdding(false); setNw(blankNew); setMatches(null); load()
  })

  const startChange = (person: Member, action: StaffAction, role?: string) => { setErr(''); setMsg(''); setChange({ person, action, role, reason: '', code: '' }) }
  const sendCode = (c: Change) => run('code', async () => {
    if (c.action === 'remove' && c.reason.trim().length < 10) throw new Error('Give a reason of at least 10 characters.')
    const r = await requestStaffCode({ businessId: biz, practitionerId: c.person.practitioner_id, action: c.action, role: c.role ?? null, reason: c.reason.trim() || undefined })
    setChange({ ...c, requestId: r.requestId, sentTo: r.sentTo })
  })
  const confirm = (c: Change) => run('code', async () => {
    await confirmStaffCode(c.requestId!, c.code.trim())
    const name = c.person.practitioners?.full_name ?? 'They'
    setMsg(c.action === 'remove' ? `✓ ${name} is removed.` : c.action === 'restore' ? `✓ ${name} is back.` : `✓ ${name} is now ${ROLE_WORD[c.role ?? ''] ?? c.role}.`)
    setChange(null); load()
  })

  const doctors = team.filter(m => ['doctor', 'owner'].includes(m.role) && m.status !== 'suspended' && m.practitioners)
  const nameOf = (pid: string) => team.find(m => m.practitioner_id === pid)?.practitioners?.full_name ?? 'Doctor'
  const active = team.filter(m => m.status !== 'suspended')
  const removed = team.filter(m => m.status === 'suspended')

  const Person = (m: Member) => {
    const p = m.practitioners
    const c = change?.person.id === m.id ? change : null
    return (
      <View key={m.id} style={st.row}>
        <Text style={st.name}>{p?.full_name ?? '—'}<Text style={st.meta}>  {ROLE_WORD[m.role] ?? m.role}{m.awaiting_payment ? ' · awaiting payment' : ''}</Text></Text>
        <Text style={st.meta}>{[p?.speciality ? SPECIALITIES.find(x => x.id === p.speciality)?.en ?? p.speciality : null, p?.email,
          p?.auth_uid ? 'has signed in' : 'not signed in yet'].filter(Boolean).join(' · ')}</Text>
        {!!p?.phone && <Text style={st.link} onPress={() => Linking.openURL(`tel:${p.phone}`)}>📞 {p.phone}</Text>}
        {!c && m.role !== 'owner' && (
          <View style={st.btns}>
            {m.status === 'suspended'
              ? <Btn small kind="ghost" label="Bring back" onPress={() => startChange(m, 'restore')} />
              : <>
                {!p?.auth_uid && <Btn small kind="ghost" label="Send login link" busy={busy === m.id}
                  onPress={() => run(m.id, async () => { const i = await staffInvite(biz, m.practitioner_id, true); setMsg(`✓ ${inviteLine(i)}`); if (i.phone && i.whatsapp !== 'sent') setShare(i) })} />}
                <Btn small kind="ghost" label="Change role" onPress={() => startChange(m, 'role')} />
                <Btn small kind="danger" label="Remove" onPress={() => startChange(m, 'remove')} />
              </>}
          </View>
        )}
        {c && (
          <View style={st.box}>
            {c.action === 'role' && !c.requestId && (
              <View style={st.btns}>{roles.filter(([r]) => r !== m.role).map(([r, l]) => <Chip key={r} label={l} on={c.role === r} onPress={() => setChange({ ...c, role: r })} />)}</View>
            )}
            {c.action === 'remove' && !c.requestId && <Field placeholder="Why? (at least 10 characters — kept in the team log)" value={c.reason} onChangeText={t => setChange({ ...c, reason: t })} multiline />}
            {!c.requestId ? (
              <View style={st.btns}>
                <Btn small kind={c.action === 'remove' ? 'danger' : 'primary'} busy={busy === 'code'} disabled={c.action === 'role' && !c.role}
                  label={c.action === 'remove' ? 'Email me a code to remove' : c.action === 'restore' ? 'Email me a code to bring back' : 'Email me a code to change role'}
                  onPress={() => sendCode(c)} />
                <Btn small kind="ghost" label="Back" onPress={() => setChange(null)} />
              </View>
            ) : (
              <>
                <Note>A code went to {c.sentTo}. It confirms the change.</Note>
                <Field placeholder="6-digit code" keyboardType="number-pad" maxLength={6} value={c.code} onChangeText={t => setChange({ ...c, code: t.replace(/\D/g, '') })} autoFocus />
                <View style={st.btns}>
                  <Btn small busy={busy === 'code'} disabled={c.code.length < 6} label="Confirm" onPress={() => confirm(c)} />
                  <Btn small kind="ghost" label="Back" onPress={() => setChange(null)} />
                </View>
              </>
            )}
          </View>
        )}
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <Err msg={err} />
      {!!msg && <Text style={st.ok}>{msg}</Text>}
      {share && (
        <Card>
          <Text style={st.body}>Send {share.name} their login link on WhatsApp:</Text>
          <View style={st.btns}>
            <Btn small label="Open WhatsApp" onPress={() => { Linking.openURL(inviteWhatsAppUrl(share)); setShare(null) }} />
            <Btn small kind="ghost" label="Not now" onPress={() => setShare(null)} />
          </View>
        </Card>
      )}

      <Card>
        <View style={st.head}><Label>Team ({active.length})</Label>{!adding && <Btn small label="+ Add" onPress={() => setAdding(true)} />}</View>
        {adding && (
          <View style={st.box}>
            <View style={st.btns}>{roles.map(([r, l]) => <Chip key={r} label={l} on={nw.role === r} onPress={() => { setNw({ ...nw, role: r }); setMatches(null) }} />)}</View>
            <Field label="Full name" value={nw.name} onChangeText={t => setNw({ ...nw, name: t })} />
            <Field label="Email — how they sign in" value={nw.email} autoCapitalize="none" keyboardType="email-address" onChangeText={t => { setNw({ ...nw, email: t }); setMatches(null) }} />
            <Field label="Mobile (for the WhatsApp link)" value={nw.phone} keyboardType="phone-pad" onChangeText={t => { setNw({ ...nw, phone: t.replace(/[^\d+ ]/g, '') }); setMatches(null) }} />
            {nw.role === 'doctor' && <>
              <Label>Speciality</Label>
              <View style={st.btns}>{SPECIALITIES.filter(x => !['PHARMACY', 'LAB'].includes(x.id)).map(x => <Chip key={x.id} label={x.en} on={nw.speciality === x.id} onPress={() => setNw({ ...nw, speciality: x.id })} />)}</View>
              <Field label="Qualification (optional)" value={nw.qualification} onChangeText={t => setNw({ ...nw, qualification: t })} placeholder="MBBS, MS (Ophthalmology)" />
              <Field label="Council registration no. (optional)" value={nw.reg} onChangeText={t => setNw({ ...nw, reg: t })} />
            </>}
            {matches && (
              <View style={{ gap: 6 }}>
                <Text style={st.body}>Already on Sehatsandhi — add this person instead of a new record?</Text>
                {matches.map(p => (
                  <View key={p.practitioner_id} style={st.btns}>
                    <Text style={[st.body, { flex: 1 }]}>{p.full_name}{p.here_status ? ` · already here (${p.here_status})` : ''}</Text>
                    <Btn small label={p.needs_invitation ? 'Invite' : 'Add'} busy={busy === 'add'} onPress={() => add(p.practitioner_id)} />
                  </View>
                ))}
                <Btn small kind="ghost" label="No — a different person" onPress={() => add()} />
              </View>
            )}
            {!matches && (
              <View style={st.btns}>
                <Btn small label="Add to team" busy={busy === 'add'} onPress={() => add()} />
                <Btn small kind="ghost" label="Cancel" onPress={() => { setAdding(false); setNw(blankNew); setMatches(null) }} />
              </View>
            )}
          </View>
        )}
        {active.map(Person)}
      </Card>

      {doctors.length > 0 && (
        <Card>
          <View style={st.head}><Label>Doctors' leave</Label>{!lv && <Btn small kind="ghost" label="+ Leave" onPress={() => setLv({ doctor: doctors.length === 1 ? doctors[0].practitioner_id : '', from: '', to: '', reason: '' })} />}</View>
          {lv && (
            <View style={st.box}>
              {doctors.length > 1 && <View style={st.btns}>{doctors.map(d => <Chip key={d.practitioner_id} label={d.practitioners!.full_name} on={lv.doctor === d.practitioner_id} onPress={() => setLv({ ...lv, doctor: d.practitioner_id })} />)}</View>}
              <View style={st.btns}>
                <View style={{ flex: 1 }}><Field label="From" placeholder="dd/mm/yyyy" value={lv.from} keyboardType="numbers-and-punctuation" onChangeText={t => setLv({ ...lv, from: t })} /></View>
                <View style={{ flex: 1 }}><Field label="To (last day)" placeholder="dd/mm/yyyy" value={lv.to} keyboardType="numbers-and-punctuation" onChangeText={t => setLv({ ...lv, to: t })} /></View>
              </View>
              <Field placeholder="Reason (optional)" value={lv.reason} onChangeText={t => setLv({ ...lv, reason: t })} />
              <View style={st.btns}>
                <Btn small label="Save leave" busy={busy === 'leave'} onPress={() => run('leave', async () => {
                  const f = toIso(lv.from), t = toIso(lv.to || lv.from)
                  if (!lv.doctor) throw new Error('Choose the doctor.')
                  if (!f || !t) throw new Error('Dates as dd/mm/yyyy.')
                  await addLeave(lv.doctor, biz, new Date(`${f}T00:00:00`), new Date(`${t}T23:59:59`), lv.reason.trim() || undefined)
                  setLv(null); setMsg('✓ Leave saved — patients cannot book those days. Bookings already made are listed below to move.'); load()
                })} />
                <Btn small kind="ghost" label="Cancel" onPress={() => setLv(null)} />
              </View>
            </View>
          )}
          {leave.length === 0 && !lv && <Note>No leave coming up.</Note>}
          {leave.map(l => (
            <View key={l.id} style={st.line}>
              <Text style={[st.body, { flex: 1 }]}>{nameOf(l.practitioner_id)} · {dt(l.starts_at)} – {dt(l.ends_at)}{l.reason ? ` · ${l.reason}` : ''}{!l.business_id ? ' · every clinic' : ''}</Text>
              {!!l.business_id && <Btn small kind="ghost" label="Cancel" busy={busy === l.id} onPress={() => run(l.id, async () => { await cancelLeave(l.id); load() })} />}
            </View>
          ))}
          {clash.length > 0 && <>
            <Text style={st.warn}>Booked during leave — move or cancel these in Bookings:</Text>
            {clash.map(c => <Text key={c.appointment_id} style={st.meta}>{dt(c.slot_datetime)} · {c.patient_name ?? '—'} · {c.doctor_name}</Text>)}
          </>}
        </Card>
      )}

      {removed.length > 0 && <Card><Label>Removed ({removed.length})</Label>{removed.map(Person)}</Card>}
      <Note>Fees, timings and the doctors' public profiles are on the computer for now.</Note>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 60 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 10, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 6 },
  box: { gap: 8, backgroundColor: '#f7f4ec', borderRadius: 12, padding: 10, marginTop: 6 },
  name: { fontSize: 15.5, fontWeight: '700', color: C.ink },
  meta: { fontSize: 12.5, color: C.muted, fontWeight: '400' },
  body: { fontSize: 14, color: C.ink },
  link: { color: C.green, fontWeight: '600' },
  warn: { fontSize: 13, color: C.danger, fontWeight: '600', marginTop: 6 },
  ok: { color: C.green, fontWeight: '700' },
  btns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
})
