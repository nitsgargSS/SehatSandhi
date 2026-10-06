import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import { supabase } from '../../../lib/supabase'
import {
  getPatientSummary, updateVisit, getSpecialityFields, getFindings, saveFindings,
  getPractitionerSpeciality, type PatientSummary, type SpecialityField, type Visit,
} from '@web/lib/patientsApi'
import { issuePrescription, getPrescriptions, type Prescription, type PrescriptionItem } from '@web/lib/prescriptionsApi'
import { setTokenStatus, visitHasDiagnosis } from '@web/lib/queueApi'
import { inStockMedicines, suggestMedicines, rxFromStock, itemLabel, type StockRow } from '@web/lib/pharmacyApi'
import { SPECIALITIES } from '@web/types'
import { Btn, Card, Chip, Err, Field, Label, Note, toDmy, toIso } from '../../../ui/kit'
import VitalsCard from '../../../ui/VitalsCard'
import { C } from '../../../ui/theme'

// One patient's consultation, opened from the queue (sehat_token_visit made the
// visit for the TOKEN's doctor, so the speciality form is that doctor's — an eye
// doctor's patient gets refraction, VA, IOP). Same calls as the website's
// patient record; who recorded what is stamped by the database (0182).
export default function Consult() {
  const { token: tokenParam, visit, member, doctor } = useLocalSearchParams<{ token: string; visit: string; member: string; doctor: string }>()
  // 'none' = a past visit opened from the patient's page to correct it — no queue token.
  const token = tokenParam && tokenParam !== 'none' ? tokenParam : ''
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const [p, setP] = useState<PatientSummary | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (biz && member) getPatientSummary(member, biz).then(setP).catch(e => setErr((e as Error).message))
  }, [biz, member])

  if (!s || !visit) return <View style={{ padding: 20 }}><Note>Loading…</Note></View>

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={st.pname}>{p?.full_name ?? '…'}</Text>
          <Text style={st.meta}>{[p?.age_years != null ? `${p.age_years}y` : null, p?.gender, p?.phone, p?.mrn ? `file ${p.mrn}` : null].filter(Boolean).join(' · ')}</Text>
          {!!p?.allergies?.length && <Text style={st.allergy}>⚠ Allergies: {p.allergies.join(', ')}</Text>}
          {!!p?.conditions?.length && <Text style={st.meta}>Conditions: {p.conditions.join(', ')}</Text>}
        </Card>
        <Err msg={err} />
        <VitalsCard biz={biz} member={member} visitId={visit} />
        <Exam visit={visit} doctor={doctor || s.doctorId || ''} recordedBy={s.practitionerId} />
        <VisitNotes visit={visit} token={token} prescriber={s.prescriber} member={member} biz={biz} prescriberId={s.practitionerId} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── The doctor's speciality examination ─────────────────────────────────────
function Exam({ visit, doctor, recordedBy }: { visit: string; doctor: string; recordedBy: string | null }) {
  const [sp, setSp] = useState<string | null>(null)
  const [fields, setFields] = useState<SpecialityField[]>([])
  const [val, setVal] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    (async () => {
      const code = doctor ? (await getPractitionerSpeciality(doctor)) || 'GEN' : 'GEN'
      setSp(code)
      setFields(await getSpecialityFields(code).catch(() => []))
      const saved = await getFindings(visit).catch(() => [])
      const v: Record<string, string> = {}
      for (const f of saved) v[`${f.field_code}|${f.site ?? ''}`] = f.value_num != null ? String(f.value_num) : (f.value_text ?? '')
      setVal(v)
    })()
  }, [visit, doctor])
  const sections = useMemo(() => {
    const out: [string, SpecialityField[]][] = []
    for (const f of fields) { const k = f.section ?? 'Examination'; const h = out.find(x => x[0] === k); if (h) h[1].push(f); else out.push([k, [f]]) }
    return out
  }, [fields])
  if (!sp || fields.length === 0) return null
  const key = (f: SpecialityField, site?: string | null) => `${f.code}|${site ?? ''}`
  const set = (k: string, v: string) => setVal(x => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const out: { code: string; site?: string | null; num?: string | null; text?: string | null }[] = []
      for (const f of fields) for (const site of (f.sites?.length ? f.sites : [null])) {
        const v = (val[key(f, site)] ?? '').trim()
        if (!v) continue
        out.push({ code: f.code, site, ...(f.kind === 'number' ? { num: v } : { text: v }) })
      }
      const n = await saveFindings(visit, sp, out, recordedBy)
      setMsg(`✓ Saved ${n} finding${n === 1 ? '' : 's'}`)
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  const input = (f: SpecialityField, site: string | null) => {
    const k = key(f, site)
    if ((f.kind === 'select' || f.kind === 'boolean') && (f.options?.length || f.kind === 'boolean')) {
      const opts = f.kind === 'boolean' ? ['Yes', 'No'] : f.options!
      return <View style={st.chips}>{opts.map(o => <Chip key={o} label={o} on={val[k] === o} onPress={() => set(k, val[k] === o ? '' : o)} />)}</View>
    }
    return <Field value={val[k] ?? ''} onChangeText={t => set(k, t)} keyboardType={f.kind === 'number' ? 'numbers-and-punctuation' : 'default'}
      placeholder={f.unit ?? ''} style={{ paddingVertical: 8 }} />
  }
  const spName = SPECIALITIES.find(x => x.id === sp)?.en ?? sp
  return (
    <Card>
      <Label>Examination — {spName}</Label>
      {sections.map(([name, fs]) => (
        <View key={name} style={{ gap: 6 }}>
          <Text style={st.section}>{name}</Text>
          {fs.map(f => {
            const sites = f.sites ?? []
            if (sites.length > 0 && sites.length <= 4) return (
              <View key={f.id} style={{ gap: 4 }}>
                <Text style={st.flabel}>{f.label}{f.unit ? ` (${f.unit})` : ''}</Text>
                <View style={st.row}>
                  {sites.map(site => (
                    <View key={site} style={{ flex: 1, gap: 2 }}>
                      <Text style={st.site}>{site === 'R' ? 'Right' : site === 'L' ? 'Left' : site}</Text>
                      {input(f, site)}
                    </View>
                  ))}
                </View>
              </View>
            )
            if (sites.length > 4) return (
              <View key={f.id} style={{ gap: 4 }}>
                <Text style={st.flabel}>{f.label} — tap a site</Text>
                <View style={st.chips}>{sites.map(site => {
                  const k = key(f, site)
                  return <Chip key={site} label={val[k] ? `${site}: ${val[k]}` : site} on={!!val[k]}
                    onPress={() => {
                      const opts = f.options ?? []
                      if (!opts.length) return
                      const i = opts.indexOf(val[k] ?? '')
                      set(k, i + 1 < opts.length ? opts[i + 1] : '')
                    }} />
                })}</View>
                {!!f.options?.length && <Note>Tap repeatedly to cycle: {f.options.join(' → ')} → clear</Note>}
              </View>
            )
            return (
              <View key={f.id} style={{ gap: 4 }}>
                <Text style={st.flabel}>{f.label}{f.unit ? ` (${f.unit})` : ''}</Text>
                {input(f, null)}
              </View>
            )
          })}
        </View>
      ))}
      <View style={st.row}><Btn small label="Save examination" busy={busy} onPress={save} /></View>
      {!!msg && <Text style={{ color: msg.startsWith('✓') ? C.green : C.danger }}>{msg}</Text>}
    </Card>
  )
}

// ── Complaint, diagnosis, advice, follow-up; prescription; finish ───────────
function VisitNotes({ visit, token, prescriber, member, biz, prescriberId }: {
  visit: string; token: string; prescriber: boolean; member: string; biz: string; prescriberId: string | null
}) {
  const [f, setF] = useState({ complaint: '', diagnosis: '', advice: '', follow: '' })
  const [items, setItems] = useState<PrescriptionItem[]>([{ drug_name: '', dosage: '', duration: '', instructions: '' }])
  const [issued, setIssued] = useState<Prescription[]>([])
  // Medicines the clinic's pharmacy has in stock — suggested while typing.
  const [stock, setStock] = useState<StockRow[]>([])
  const [typingAt, setTypingAt] = useState<number | null>(null)
  useEffect(() => { if (prescriber) inStockMedicines(biz).then(setStock) }, [prescriber, biz])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    supabase.from('patient_visits').select('chief_complaint, diagnosis, advice, follow_up_due').eq('id', visit).maybeSingle()
      .then(({ data }) => {
        const v = data as Pick<Visit, 'chief_complaint' | 'diagnosis' | 'advice' | 'follow_up_due'> | null
        if (v) setF({ complaint: v.chief_complaint ?? '', diagnosis: v.diagnosis ?? '', advice: v.advice ?? '', follow: toDmy(v.follow_up_due) })
      })
    getPrescriptions(member, biz).then(r => setIssued(r.filter(x => x.visit_id === visit && x.status === 'issued'))).catch(() => {})
  }, [visit, member, biz])

  const saveVisit = async () => {
    if (f.follow.trim() && !toIso(f.follow)) throw new Error('Follow-up date as dd/mm/yyyy.')
    await updateVisit(visit, { chiefComplaint: f.complaint, diagnosis: f.diagnosis, advice: f.advice, followUpDue: toIso(f.follow) })
  }
  const run = async (k: string, fn: () => Promise<void>, ok: string) => {
    setBusy(k); setMsg('')
    try { await fn(); setMsg(ok) } catch (e) { setMsg((e as Error).message) } finally { setBusy(null) }
  }
  const issue = () => run('rx', async () => {
    if (!prescriberId) throw new Error('Only a doctor can prescribe.')
    await saveVisit()
    await issuePrescription({ patientMemberId: member, businessId: biz, practitionerId: prescriberId, items, visitId: visit,
      diagnosis: f.diagnosis, advice: f.advice, followUpDate: toIso(f.follow) })
    setItems([{ drug_name: '', dosage: '', duration: '', instructions: '' }])
    const r = await getPrescriptions(member, biz); setIssued(r.filter(x => x.visit_id === visit && x.status === 'issued'))
    if (!token) return
    // Issuing does not close the visit (more notes may follow) — but it is
    // usually the last step, so offer to finish right here.
    Alert.alert('Prescription issued', 'Finish this consultation now? The patient moves to Finished in the queue.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Finish', onPress: () => { setTokenStatus(token, 'completed').then(() => router.back(), e => setMsg((e as Error).message)) } },
    ])
  }, '✓ Prescription issued')
  const finish = () => run('done', async () => {
    await saveVisit()
    if (!f.diagnosis.trim() && !(await visitHasDiagnosis(visit))) {
      const go = await new Promise<boolean>(res => Alert.alert('No diagnosis yet', 'Finish the consultation without a diagnosis?', [
        { text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: 'Finish', onPress: () => res(true) }]))
      if (!go) return
    }
    await setTokenStatus(token, 'completed')
    router.back()
  }, '')

  return (
    <>
      <Card>
        <Label>Visit</Label>
        <Field label="Complaint" value={f.complaint} onChangeText={t => setF({ ...f, complaint: t })} />
        <Field label="Diagnosis" value={f.diagnosis} onChangeText={t => setF({ ...f, diagnosis: t })} />
        <Field label="Advice" multiline value={f.advice} onChangeText={t => setF({ ...f, advice: t })} />
        <Field label="Follow-up (dd/mm/yyyy)" value={f.follow} onChangeText={t => setF({ ...f, follow: t })} keyboardType="numbers-and-punctuation" placeholder="15/10/2026" />
        <View style={st.row}><Btn small label="Save visit" busy={busy === 'visit'} onPress={() => run('visit', saveVisit, '✓ Visit saved')} /></View>
      </Card>

      {prescriber && (
        <Card>
          <Label>Prescription</Label>
          {issued.map(rx => (
            <Text key={rx.id} style={st.body}>✓ {rx.prescription_no}: {rx.items.map(i => [i.drug_name, i.dosage].filter(Boolean).join(' ')).join('; ')}</Text>
          ))}
          {items.map((it, i) => (
            <View key={i} style={st.rx}>
              <Field placeholder={stock.length ? 'Medicine — type to pick from stock' : 'Medicine, e.g. Moxifloxacin 0.5% eye drops'} value={it.drug_name}
                onFocus={() => setTypingAt(i)}
                onChangeText={t => { setTypingAt(i); setItems(x => x.map((y, j) => j === i ? { ...y, drug_name: t } : y)) }} />
              {typingAt === i && suggestMedicines(stock, it.drug_name, 5).map(sv => (
                <Pressable key={sv.id} style={st.sugg} onPress={() => {
                  const r = rxFromStock(sv)
                  setItems(x => x.map((y, j) => j === i ? { ...y, drug_name: [r.drug_name, r.strength].filter(Boolean).join(' '), form: r.form } : y))
                  setTypingAt(null)
                }}>
                  <Text style={st.body}>{itemLabel(sv)}</Text>
                  <Text style={st.meta}>{sv.qty_available} {sv.unit} in stock</Text>
                </Pressable>
              ))}
              <View style={st.row}>
                <Field placeholder="Dose, e.g. 1 drop 4×/day" value={it.dosage ?? ''} onChangeText={t => setItems(x => x.map((y, j) => j === i ? { ...y, dosage: t } : y))} style={{ flex: 1 }} />
                <Field placeholder="For, e.g. 7 days" value={it.duration ?? ''} onChangeText={t => setItems(x => x.map((y, j) => j === i ? { ...y, duration: t } : y))} style={{ flex: 1 }} />
              </View>
              <Field placeholder="Instructions (optional)" value={it.instructions ?? ''} onChangeText={t => setItems(x => x.map((y, j) => j === i ? { ...y, instructions: t } : y))} />
            </View>
          ))}
          <View style={st.row}>
            <Btn small kind="ghost" label="+ Medicine" onPress={() => setItems(x => [...x, { drug_name: '', dosage: '', duration: '', instructions: '' }])} />
            <Btn small label="Issue prescription" busy={busy === 'rx'} onPress={issue} />
          </View>
        </Card>
      )}

      {!!msg && <Text style={{ color: msg.startsWith('✓') ? C.green : C.danger, textAlign: 'center' }}>{msg}</Text>}
      {/* Opened from the patient's page to correct a past visit: nothing to finish. */}
      {token ? <Btn label="Finish consultation" busy={busy === 'done'} onPress={finish} />
        : <Btn kind="ghost" label="Done" onPress={() => router.back()} />}
    </>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 12, paddingBottom: 60 },
  pname: { fontSize: 20, fontWeight: '800', color: C.ink },
  meta: { fontSize: 13.5, color: C.muted },
  allergy: { fontSize: 14, color: C.danger, fontWeight: '700' },
  body: { fontSize: 14.5, color: C.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  half: { minWidth: 120 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  section: { fontSize: 14, fontWeight: '800', color: C.ink, marginTop: 4 },
  flabel: { fontSize: 13, color: C.muted, fontWeight: '600' },
  site: { fontSize: 11.5, color: C.muted, fontWeight: '700' },
  rx: { gap: 6, borderTopWidth: 1, borderTopColor: '#f0ebe1', paddingTop: 8 },
  sugg: { backgroundColor: '#f3faf6', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
})
