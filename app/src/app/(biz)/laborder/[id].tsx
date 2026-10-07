import { useCallback, useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSession } from '../../../lib/session'
import { IS_STAGING } from '../../../lib/env'
import { supabase } from '../../../lib/supabase'
import { bytesOf, pickFile, pickPhoto, takePhoto, type Picked } from '../../../lib/patient'
import {
  getOrder, getTestParameters, getResults, saveResults, approveOrder, sendReport, getUploads, sendUpload, STATUS_LABEL,
  type LabOrder, type LabParameter, type UploadedReport,
} from '@web/lib/labApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../../ui/kit'
import { C } from '../../../ui/theme'

// One lab order: enter each test's results (the test's own fields, with the
// lab's reference ranges where it has set them), then a doctor approves and
// the report goes to the patient on WhatsApp — the website's results screen,
// same functions (sehat_lab_save_results / _approve, lab-report-send).
// A report made elsewhere (an X-ray reading, a machine print-out) is uploaded
// as it is — a PDF or a photo — and sent the same way (0169,
// sehat_lab_upload_report: the patient's folder, the lab's retention).
type Param = LabParameter & { id: string }
const SITE = IS_STAGING ? 'https://sehat-sandhi-staging.vercel.app' : 'https://sehatsandhi.com'

export default function LabOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { s } = useSession()
  const role = s?.role.role ?? null
  const enters = !s?.role.enforced || ['owner', 'doctor', 'nurse'].includes(role ?? '')
  const approves = !s?.role.enforced || ['owner', 'doctor'].includes(role ?? '')
  const [o, setO] = useState<LabOrder | null>(null)
  const [params, setParams] = useState<Record<string, Param[]>>({})
  const [vals, setVals] = useState<Record<string, Record<string, string>>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [uploads, setUploads] = useState<UploadedReport[]>([])
  const [upTitle, setUpTitle] = useState('')

  const load = useCallback(async () => {
    const ord = await getOrder(id)
    setO(ord)
    if (!ord) return
    const p: Record<string, Param[]> = {}, v: Record<string, Record<string, string>> = {}
    await Promise.all(ord.items.map(async it => {
      p[it.id] = it.test_id ? await getTestParameters(it.test_id) : []
      const res = await getResults(it.id)
      v[it.id] = Object.fromEntries(res.filter(r => r.parameter_id).map(r => [r.parameter_id!, r.value_text ?? (r.value_num != null ? String(r.value_num) : '')]))
    }))
    setParams(p); setVals(v)
    getUploads(ord.business_id, { orderId: ord.id }).then(setUploads).catch(() => setUploads([]))
  }, [id])
  useEffect(() => { load().catch(e => setErr((e as Error).message)) }, [load])

  const run = async (k: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(k); setErr(''); setMsg('')
    // An empty message = the person backed out of a picker: nothing to say.
    try { await fn(); setMsg(ok); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  if (!o) return <View style={{ padding: 20 }}><Note>{err || 'Loading…'}</Note></View>
  const female = (o.patient_gender ?? '').toLowerCase().startsWith('f')
  const range = (p: Param) => {
    const lo = female ? p.ref_low_f ?? p.ref_low : p.ref_low, hi = female ? p.ref_high_f ?? p.ref_high : p.ref_high
    return { lo, hi, text: p.ref_text ?? (lo != null || hi != null ? `${lo ?? ''}–${hi ?? ''}` : '') }
  }
  const flag = (p: Param, v: string) => {
    const n = Number(v); const { lo, hi } = range(p)
    if (p.kind !== 'number' || v.trim() === '' || Number.isNaN(n)) return ''
    return lo != null && n < lo ? ' ↓ low' : hi != null && n > hi ? ' ↑ high' : ''
  }
  const report = o.latest_report
  const upload = (get: () => Promise<Picked | null>) => run('upload', async () => {
    const f = await get()
    if (!f) throw new Error('')
    if (!/^(application\/pdf|image\/)/.test(f.mime)) throw new Error('Choose a PDF or a photo.')
    const bytes = await bytesOf(f.uri)
    if (bytes.byteLength > 15 * 1024 * 1024) throw new Error('That file is over 15 MB — take a photo of the page instead.')
    const path = `${o.business_id}/${o.patient_member_id}/lab-${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)}`
    const { error: upErr } = await supabase.storage.from('patient-documents').upload(path, bytes, { contentType: f.mime, upsert: false })
    if (upErr) throw new Error(upErr.message)
    const { error } = await supabase.rpc('sehat_lab_upload_report', {
      p_business: o.business_id, p_member: o.patient_member_id, p_storage_path: path,
      p_title: upTitle.trim() || o.items.map(i => i.name).join(', ').slice(0, 120) || 'Lab report',
      p_mime: f.mime, p_size: bytes.byteLength, p_report_date: null, p_order: o.id,
    })
    if (error) { await supabase.storage.from('patient-documents').remove([path]).catch(() => undefined); throw new Error(error.message) }
    setUpTitle('')
  }, '✓ Uploaded. Send it to the patient below.')

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={st.big}>{o.patient_name}{o.patient_age != null ? `, ${o.patient_age}` : ''}{o.patient_gender ? ` ${o.patient_gender}` : ''}</Text>
          <Text style={st.meta}>{o.order_no} · {STATUS_LABEL[o.status]}{o.collected_by_name ? ` · collected by ${o.collected_by_name}` : ''}</Text>
          {!!o.referred_by && <Text style={st.meta}>Referred by {o.referred_by}</Text>}
          {!!o.notes && <Text style={st.body}>{o.notes}</Text>}
        </Card>
        <Err msg={err} />
        {!!msg && <Text style={st.ok}>{msg}</Text>}
        {o.status === 'ordered' && <Note>Mark the sample collected (Lab tab) before entering results.</Note>}

        {o.status !== 'ordered' && o.items.map(it => (
          <Card key={it.id}>
            <View style={st.between}>
              <Label>{it.name}</Label>
              <Text style={[st.meta, it.status !== 'pending' && { color: C.green }]}>{it.status === 'pending' ? 'to enter' : it.status === 'entered' ? `✓ entered${it.entered_by_name ? ` · ${it.entered_by_name}` : ''}` : '✓ approved'}</Text>
            </View>
            {!!it.package_name && <Text style={st.meta}>in {it.package_name}</Text>}
            {(params[it.id] ?? []).map(p => {
              const v = vals[it.id]?.[p.id] ?? ''
              const set = (t: string) => setVals(x => ({ ...x, [it.id]: { ...(x[it.id] ?? {}), [p.id]: t } }))
              const r = range(p)
              return (
                <View key={p.id} style={{ gap: 3 }}>
                  <Text style={st.flabel}>{p.name}{p.unit ? ` (${p.unit})` : ''}{r.text ? `  ·  ref ${r.text}` : ''}<Text style={st.flag}>{flag(p, v)}</Text></Text>
                  {p.kind === 'select' && p.options?.length
                    ? <View style={st.row}>{p.options.map(op => <Chip key={op} label={op} on={v === op} onPress={() => enters && set(v === op ? '' : op)} />)}</View>
                    : <Field value={v} onChangeText={set} editable={enters && it.status !== 'approved'} multiline={p.kind === 'long_text'}
                        keyboardType={p.kind === 'number' ? 'decimal-pad' : 'default'} style={{ paddingVertical: 8 }} />}
                </View>
              )
            })}
            {!(params[it.id] ?? []).length && <Note>This test has no result fields set up — upload its report below (PDF or photo), or add the fields in Tests & packages on the computer.</Note>}
            {enters && it.status !== 'approved' && !!(params[it.id] ?? []).length && (
              <Btn small label="Save results" busy={busy === it.id}
                onPress={() => run(it.id, () => saveResults(it.id, (params[it.id] ?? []).map(p => ({ parameter_id: p.id, value: vals[it.id]?.[p.id] ?? '' }))), `✓ ${it.name} saved`)} />
            )}
          </Card>
        ))}

        {o.status === 'ready' && (approves
          ? <Btn label="Approve — make the report" busy={busy === 'approve'} onPress={() => run('approve', () => approveOrder(o.id), '✓ Report made. Send it to the patient below.')} />
          : <Note>All results are in. A doctor approves the report.</Note>)}

        {!!report && (
          <Card>
            <Label>Report {report.report_no}{report.version > 1 ? ` (v${report.version})` : ''}</Label>
            <Text style={st.meta}>Approved by {report.approved_by_name ?? '—'}{report.sent_at ? ` · sent ${new Date(report.sent_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}` : ' · not sent yet'}</Text>
            {!!report.send_error && <Text style={st.flag}>{report.send_error}</Text>}
            <View style={st.row}>
              <Btn small label={report.sent_at ? 'Send again' : 'Send to the patient'} busy={busy === 'send'}
                onPress={() => run('send', async () => {
                  const r = await sendReport(report.id)
                  if (!r.whatsapp && !r.email) throw new Error(r.errors?.join(' ') || 'Could not send — give the patient the printed report.')
                }, '✓ Sent on WhatsApp')} />
              <Btn small kind="ghost" label="View report" onPress={() => Linking.openURL(`${SITE}/lab/${report.token}`)} />
            </View>
          </Card>
        )}
        {enters && o.status !== 'cancelled' && (
          <Card>
            <Label>Upload a report — PDF or photo</Label>
            <Note>For a report made outside the result fields (an X-ray reading, a machine print-out). It is sent as it is.</Note>
            <Field placeholder={`Title (default: ${o.items.map(i => i.name).join(', ').slice(0, 40) || 'Lab report'})`} value={upTitle} onChangeText={setUpTitle} />
            <View style={st.row}>
              <Btn small label="📷 Take photo" busy={busy === 'upload'} onPress={() => upload(takePhoto)} />
              <Btn small kind="ghost" label="🖼 Photo" onPress={() => upload(pickPhoto)} />
              <Btn small kind="ghost" label="📄 PDF / file" onPress={() => upload(pickFile)} />
            </View>
          </Card>
        )}
        {uploads.map(u => (
          <Card key={u.id}>
            <Label>📎 {u.title}</Label>
            <Text style={st.meta}>{u.purged_at ? 'Removed after the retention period' : `Kept until ${new Date(u.expires_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              {u.sent_at ? ` · sent ${new Date(u.sent_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}` : ' · not sent yet'}</Text>
            {!!u.send_error && <Text style={st.flag}>{u.send_error}</Text>}
            {!u.purged_at && <View style={st.row}>
              <Btn small label={u.sent_at ? 'Send again' : 'Send to the patient'} busy={busy === `send-${u.id}`}
                onPress={() => Alert.alert('Send this file?', `${u.title} → ${o.patient_name} on WhatsApp`, [{ text: 'Back', style: 'cancel' }, { text: 'Send', onPress: () =>
                  run(`send-${u.id}`, async () => {
                    const r = await sendUpload(u.id)
                    if (!r.whatsapp && !r.email) throw new Error(r.errors?.join(' ') || 'Could not send — give the patient a print-out.')
                  }, '✓ Sent on WhatsApp') }])} />
              <Btn small kind="ghost" label="View" onPress={() => Linking.openURL(`${SITE}/lab/file/${u.public_token}`)} />
            </View>}
          </Card>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  big: { fontSize: 18, fontWeight: '800', color: C.ink },
  body: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  flabel: { fontSize: 13, color: C.muted, fontWeight: '600' },
  flag: { color: C.danger, fontWeight: '800' },
  ok: { color: C.green, fontWeight: '700' },
})
