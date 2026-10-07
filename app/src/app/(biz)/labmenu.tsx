import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useSession } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import {
  getTests, saveTest, getPackages, savePackage, importCatalogue, getLabSettings, saveLabSettings,
  type LabTest, type LabPackage,
} from '@web/lib/labApi'
import { Btn, Card, Chip, Err, Field, Label, Note } from '../../ui/kit'
import { C } from '../../ui/theme'

// A lab's price list on the phone (0168 / 0208): what patients can book in the
// app. Tests are picked from the shared catalogue of ~260 — never typed — and
// get the catalogue's suggested price, which the lab changes. Packages start
// from a ready-made template (Full Body, Diabetes, Fever…) or blank; tests are
// tapped in from the catalogue (one the lab has not listed yet is added to its
// price list on save), and the price suggests itself: the tests' total less
// 15%. The same functions as the website's Lab panel; managing is for the
// owner, a manager or a doctor (sehat_lab_check 'manage').
interface Cat { code: string; name: string; category: string; department: string | null; default_price: number | null }
interface Tpl { id: number; name: string; description: string | null; codes: string[] }
type Draft = { id?: string; name: string; description: string; price: string; codes: string[]; testIds: string[]; active: boolean }
const CATS: [string, string][] = [['', 'All'], ['pathology', 'Blood & urine'], ['radiology', 'Scans & X-ray'], ['cardiology', 'Heart'], ['other', 'Other']]
const rs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export default function LabMenu() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const manages = !s?.role.enforced || ['owner', 'manager', 'doctor'].includes(s?.role.role ?? '')
  const [tab, setTab] = useState<'packages' | 'tests' | 'home'>('packages')
  const [tests, setTests] = useState<LabTest[]>([])
  const [packs, setPacks] = useState<LabPackage[]>([])
  const [cat, setCat] = useState<Cat[]>([])
  const [tpls, setTpls] = useState<Tpl[]>([])
  const [fee, setFee] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const load = useCallback(async () => {
    if (!biz) return
    try {
      const [t, p, st] = await Promise.all([getTests(biz), getPackages(biz), getLabSettings(biz)])
      setTests(t); setPacks(p); setFee(String(st.homeFee))
    } catch (e) { setErr((e as Error).message) }
  }, [biz])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => {
    supabase.from('lab_catalogue').select('code, name, category, department, default_price').order('sort_order')
      .then(({ data }) => setCat(((data ?? []) as Cat[]).map(c => ({ ...c, default_price: c.default_price == null ? null : Number(c.default_price) }))))
    supabase.from('lab_package_templates').select('id, name, description, codes').eq('is_active', true).order('sort_order')
      .then(({ data }) => setTpls((data ?? []) as Tpl[]))
  }, [])

  const run = async (k: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(k); setErr(''); setMsg('')
    try { await fn(); if (ok) setMsg(ok); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const byCode = useMemo(() => new Map(tests.filter(t => t.catalogue_code).map(t => [t.catalogue_code!, t])), [tests])
  const byId = useMemo(() => new Map(tests.map(t => [t.id, t])), [tests])
  /** What a catalogue code costs here: the lab's price, or the catalogue's suggestion. */
  const priceOf = (code: string) => byCode.get(code)?.price ?? cat.find(c => c.code === code)?.default_price ?? 0

  if (!manages) return <View style={{ padding: 20 }}><Note>The owner, a manager or a doctor sets the lab's tests and prices.</Note></View>

  const startFrom = (t?: Tpl) => {
    setMsg(''); setErr('')
    const codes = t?.codes ?? []
    const total = codes.reduce((a, c) => a + priceOf(c), 0)
    setDraft({ name: t?.name ?? '', description: t?.description ?? '', price: total ? String(Math.round(total * 0.85 / 10) * 10) : '',
      codes, testIds: [], active: true })
  }
  const edit = (p: LabPackage) => {
    setMsg(''); setErr('')
    const codes: string[] = [], ids: string[] = []
    for (const id of p.test_ids) { const t = byId.get(id); if (t?.catalogue_code) codes.push(t.catalogue_code); else ids.push(id) }
    setDraft({ id: p.id, name: p.name, description: p.description ?? '', price: String(p.price), codes, testIds: ids, active: p.is_active })
  }
  const savePack = (d: Draft) => run('pack', async () => {
    if (!d.name.trim()) throw new Error('Give the package a name.')
    if (!d.codes.length && !d.testIds.length) throw new Error('Add at least one test.')
    if (!(Number(d.price) > 0)) throw new Error('Enter the package price.')
    // Catalogue tests the lab has not listed yet join its price list first.
    const missing = d.codes.filter(c => !byCode.has(c))
    if (missing.length) await importCatalogue(biz, missing)
    const fresh = await getTests(biz)
    const ids = [...new Set([...d.testIds, ...d.codes.map(c => fresh.find(t => t.catalogue_code === c)?.id).filter(Boolean) as string[]])]
    await savePackage(biz, { id: d.id, name: d.name.trim(), description: d.description.trim() || null, price: Number(d.price), is_active: d.active }, ids)
    setDraft(null)
  }, `✓ Package saved — patients see it in the app.`)

  return (
    <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <View style={st.row}>
        {([['packages', `Packages (${packs.length})`], ['tests', `Tests (${tests.filter(t => t.is_active).length})`], ['home', 'Home collection']] as const).map(([k, l]) => (
          <Chip key={k} label={l} on={tab === k} onPress={() => { setTab(k); setDraft(null) }} />
        ))}
      </View>
      <Err msg={err} />
      {!!msg && <Text style={st.ok}>{msg}</Text>}

      {tab === 'packages' && !draft && (
        <>
          <Card>
            <Label>New package</Label>
            <Note>Start from a ready-made one and adjust, or start blank. The price suggests itself (the tests' total less 15%).</Note>
            <View style={st.row}>
              {tpls.map(t => <Chip key={t.id} label={t.name} onPress={() => startFrom(t)} />)}
              <Chip label="+ Blank package" onPress={() => startFrom()} />
            </View>
          </Card>
          {packs.map(p => (
            <Pressable key={p.id} onPress={() => edit(p)}>
              <Card>
                <Text style={st.name}>{p.name}{!p.is_active ? <Text style={st.meta}>  (hidden)</Text> : null}</Text>
                <Text style={st.meta}>{rs(p.price)} · {p.test_ids.length} tests — tap to change</Text>
                <Text style={st.meta} numberOfLines={2}>{p.test_ids.map(id => byId.get(id)?.name).filter(Boolean).join(', ')}</Text>
              </Card>
            </Pressable>
          ))}
          {!packs.length && <Note>No packages yet. Patients choose packages first, so a few common ones help.</Note>}
        </>
      )}

      {tab === 'packages' && draft && (
        <PackageEditor d={draft} set={setDraft} cat={cat} tests={tests} priceOf={priceOf}
          busy={busy === 'pack'} onSave={() => savePack(draft)} onCancel={() => setDraft(null)} />
      )}

      {tab === 'tests' && <TestList cat={cat} byCode={byCode} tests={tests} busy={busy}
        add={(c: Cat) => run(c.code, () => importCatalogue(biz, [c.code]), `✓ ${c.name} added at ${rs(c.default_price ?? 0)} — change the price below if needed.`)}
        save={(t: LabTest, patch: Partial<LabTest>) => run(t.id, () => saveTest(biz, { ...t, ...patch }, null), '✓ Saved')} />}

      {tab === 'home' && (
        <Card>
          <Label>Home sample collection</Label>
          <Note>Patients can ask for the sample to be collected at home. This fee is added to their bill (0 = free).</Note>
          <Field label="Home collection fee (₹)" keyboardType="number-pad" value={fee} onChangeText={t => setFee(t.replace(/\D/g, ''))} />
          <Btn small label="Save" busy={busy === 'fee'} onPress={() => run('fee', () => saveLabSettings(biz, Number(fee) || 0), '✓ Home collection fee saved')} />
        </Card>
      )}
    </ScrollView>
  )
}

// Tap tests in from the catalogue — searched, or by kind.
function Picker({ cat, chosen, toggle }: { cat: Cat[]; chosen: Set<string>; toggle: (code: string) => void }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const shown = cat.filter(c => (!kind || c.category === kind) && (!q.trim() || `${c.name} ${c.department ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())))
  return (
    <View style={{ gap: 6 }}>
      <Field placeholder="Search tests — e.g. sugar, thyroid, x-ray" value={q} onChangeText={setQ} autoCorrect={false} />
      <View style={st.row}>{CATS.map(([k, l]) => <Chip key={k} label={l} on={kind === k} onPress={() => setKind(k)} />)}</View>
      {shown.slice(0, 60).map(c => (
        <Pressable key={c.code} style={st.pick} onPress={() => toggle(c.code)}>
          <Text style={[st.box, chosen.has(c.code) && st.boxOn]}>{chosen.has(c.code) ? '✓' : ''}</Text>
          <Text style={[st.body, { flex: 1 }]}>{c.name}</Text>
        </Pressable>
      ))}
      {shown.length > 60 && <Note>Showing 60 of {shown.length} — search to narrow.</Note>}
    </View>
  )
}

function PackageEditor({ d, set, cat, tests, priceOf, busy, onSave, onCancel }: {
  d: Draft; set: (d: Draft) => void; cat: Cat[]; tests: LabTest[]; priceOf: (code: string) => number
  busy: boolean; onSave: () => void; onCancel: () => void
}) {
  const [picking, setPicking] = useState(false)
  const total = d.codes.reduce((a, c) => a + priceOf(c), 0) + d.testIds.reduce((a, id) => a + (tests.find(t => t.id === id)?.price ?? 0), 0)
  const names = [...d.codes.map(c => ({ key: c, name: cat.find(x => x.code === c)?.name ?? c, code: true })),
                 ...d.testIds.map(id => ({ key: id, name: tests.find(t => t.id === id)?.name ?? '?', code: false }))]
  const toggle = (code: string) => set({ ...d, codes: d.codes.includes(code) ? d.codes.filter(c => c !== code) : [...d.codes, code] })
  return (
    <Card>
      <Label>{d.id ? 'Change package' : 'New package'}</Label>
      <Field label="Name" value={d.name} onChangeText={t => set({ ...d, name: t })} placeholder="e.g. Full Body Checkup" />
      <Field label="What it is for (shown to patients)" value={d.description} onChangeText={t => set({ ...d, description: t })} />
      <Text style={st.sub}>Tests ({names.length})</Text>
      <View style={st.row}>
        {names.map(n => (
          <Pressable key={n.key} style={st.tag} onPress={() => n.code ? toggle(n.key) : set({ ...d, testIds: d.testIds.filter(x => x !== n.key) })}>
            <Text style={st.tagT}>{n.name}  ✕</Text>
          </Pressable>
        ))}
      </View>
      {!picking ? <Btn small kind="ghost" label="+ Add tests" onPress={() => setPicking(true)} />
        : <><Picker cat={cat} chosen={new Set(d.codes)} toggle={toggle} /><Btn small kind="ghost" label="Done adding" onPress={() => setPicking(false)} /></>}
      <Note>Separately these come to {rs(total)}. Suggested package price: {rs(Math.round(total * 0.85 / 10) * 10)}.</Note>
      <Field label="Package price (₹)" keyboardType="number-pad" value={d.price} onChangeText={t => set({ ...d, price: t.replace(/\D/g, '') })} />
      <View style={st.between}><Text style={st.body}>Show to patients</Text><Switch value={d.active} onValueChange={v => set({ ...d, active: v })} trackColor={{ true: C.green }} /></View>
      <View style={st.row}>
        <Btn small label="Save package" busy={busy} onPress={onSave} />
        <Btn small kind="ghost" label="Cancel" onPress={onCancel} />
      </View>
    </Card>
  )
}

function TestList({ cat, byCode, tests, busy, add, save }: {
  cat: Cat[]; byCode: Map<string, LabTest>; tests: LabTest[]; busy: string | null
  add: (c: Cat) => void; save: (t: LabTest, patch: Partial<LabTest>) => void
}) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [only, setOnly] = useState(true)
  const [price, setPrice] = useState<Record<string, string>>({})
  const match = (name: string, c?: string | null, dep?: string | null) =>
    (!kind || c === kind) && (!q.trim() || `${name} ${dep ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  const mine = tests.filter(t => match(t.name, t.category, t.department))
  const more = only ? [] : cat.filter(c => !byCode.has(c.code) && match(c.name, c.category, c.department))
  return (
    <>
      <Card>
        <Field placeholder="Search tests" value={q} onChangeText={setQ} autoCorrect={false} />
        <View style={st.row}>{CATS.map(([k, l]) => <Chip key={k} label={l} on={kind === k} onPress={() => setKind(k)} />)}</View>
        <View style={st.row}>
          <Chip label="Tests we do" on={only} onPress={() => setOnly(true)} />
          <Chip label="+ Add from the full list" on={!only} onPress={() => setOnly(false)} />
        </View>
      </Card>
      {only && mine.map(t => (
        <View key={t.id} style={st.testRow}>
          <View style={{ flex: 1 }}>
            <Text style={[st.body, !t.is_active && { color: C.muted }]}>{t.name}</Text>
            <Text style={st.meta}>{[t.department, t.sample_type].filter(Boolean).join(' · ')}</Text>
          </View>
          <TextInput value={price[t.id] ?? String(t.price)} keyboardType="number-pad" style={st.price}
            onChangeText={v => setPrice(p => ({ ...p, [t.id]: v.replace(/\D/g, '') }))}
            onEndEditing={() => { const v = price[t.id]; if (v != null && Number(v) !== t.price) save(t, { price: Number(v) }) }} />
          <Switch value={t.is_active} onValueChange={v => save(t, { is_active: v })} trackColor={{ true: C.green }} />
        </View>
      ))}
      {only && !mine.length && <Note>No tests yet. Tap "+ Add from the full list" — about 260 tests with suggested prices.</Note>}
      {!only && more.slice(0, 80).map(c => (
        <View key={c.code} style={st.testRow}>
          <View style={{ flex: 1 }}><Text style={st.body}>{c.name}</Text><Text style={st.meta}>{c.department}</Text></View>
          <Btn small kind="ghost" label={`Add · ${rs(c.default_price ?? 0)}`} busy={busy === c.code} onPress={() => add(c)} />
        </View>
      ))}
      {!only && more.length > 80 && <Note>Showing 80 of {more.length} — search to narrow.</Note>}
    </>
  )
}

const st = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  sub: { fontSize: 13, fontWeight: '800', color: C.muted },
  body: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12.5, color: C.muted, fontWeight: '400' },
  ok: { color: C.green, fontWeight: '700' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#f0ebe1' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.border, textAlign: 'center', color: '#fff', fontWeight: '900' },
  boxOn: { backgroundColor: C.green, borderColor: C.green },
  tag: { backgroundColor: '#e6f4ee', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  tagT: { fontSize: 12.5, color: C.ink },
  testRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.border },
  price: { width: 76, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, textAlign: 'right', fontSize: 14, color: C.ink, backgroundColor: '#fff' },
})
