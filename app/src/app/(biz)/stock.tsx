import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { useSession } from '../../lib/session'
import {
  getStock, saveItem, getBatches, adjustStock, recordPurchase, itemLabel, ITEM_FORMS,
  type StockRow, type Batch, type PharmacyItem,
} from '@web/lib/pharmacyApi'
import { Btn, Card, Chip, Err, Field, Label, Note, toIso, toDmy } from '../../ui/kit'
import { C } from '../../ui/theme'

// The medicine counter's stock on a phone — the website's Pharmacy → Stock
// (src/pages/doctor/PharmacyPanel.tsx StockSection), same functions: the
// pharmacy_stock list with Reorder / Expired-or-expiring filters, a medicine's
// batches, Add stock (a purchase in plain units, sehat_pharmacy_record_purchase),
// a new medicine with its opening stock (sehat_pharmacy_save_item), and
// Correct count on a batch (sehat_pharmacy_adjust_stock). Everyone on the staff
// sees the stock; adding and correcting are for the owner, a manager, a doctor
// or the pharmacist — the database refuses anyone else.
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const soon = (iso: string | null, days: number) => !!iso && new Date(iso) <= new Date(Date.now() + days * 86400000)
const rs = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const num = (t: string) => t.replace(/[^0-9.]/g, '')

interface StockIn { units: string; mrp: string; cost: string; batch: string; expiry: string }
const blankIn: StockIn = { units: '', mrp: '', cost: '', batch: '', expiry: '' }
const blankItem: Partial<PharmacyItem> = { name: '', generic_name: '', strength: '', form: 'tablet', unit: 'tablet', pack_size: 1, hsn_code: '3004', gst_rate: 12, reorder_level: 0 }

/** As the website's addStock: one purchase line in plain units. */
async function addStock(biz: string, itemId: string, st: StockIn, supplier: string) {
  const expiry = toIso(st.expiry)
  if (!(Number(st.units) > 0)) throw new Error('Enter how many units came in.')
  if (!(Number(st.mrp) > 0)) throw new Error('Enter the MRP per unit.')
  if (!st.batch.trim()) throw new Error('Enter the batch number (on the strip or box).')
  if (!expiry) throw new Error('Enter the expiry as dd/mm/yyyy.')
  if (expiry <= isoToday()) throw new Error('That expiry date has already passed.')
  await recordPurchase(biz, supplier, '', isoToday(), [{
    item_id: itemId, batch_no: st.batch.trim(), expiry_date: expiry,
    units: Number(st.units), free_units: 0, unit_cost: Number(st.cost) || 0, unit_mrp: Number(st.mrp),
  }])
}

function StockInFields({ unit, st, set }: { unit: string; st: StockIn; set: (s: StockIn) => void }) {
  const u = unit || 'unit'
  return (
    <View style={{ gap: 6 }}>
      <View style={st2.row2}>
        <View style={{ flex: 1 }}><Field label={`Quantity (${u}s)`} value={st.units} keyboardType="number-pad" onChangeText={t => set({ ...st, units: t.replace(/\D/g, '') })} /></View>
        <View style={{ flex: 1 }}><Field label={`MRP per ${u} (₹)`} value={st.mrp} keyboardType="decimal-pad" onChangeText={t => set({ ...st, mrp: num(t) })} /></View>
      </View>
      <View style={st2.row2}>
        <View style={{ flex: 1 }}><Field label="Batch no." value={st.batch} onChangeText={t => set({ ...st, batch: t })} autoCapitalize="characters" /></View>
        <View style={{ flex: 1 }}><Field label="Expiry (dd/mm/yyyy)" value={st.expiry} keyboardType="numbers-and-punctuation" onChangeText={t => set({ ...st, expiry: t })} /></View>
      </View>
      <Field label={`Cost per ${u} (₹, optional)`} value={st.cost} keyboardType="decimal-pad" onChangeText={t => set({ ...st, cost: num(t) })} />
    </View>
  )
}

export default function Stock() {
  const { s } = useSession()
  const biz = s?.clinic?.id ?? ''
  const role = s?.role.role ?? ''
  const manages = !s?.role.enforced || ['owner', 'manager', 'doctor', 'pharmacist'].includes(role)
  const [stock, setStock] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'expiry'>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [adding, setAdding] = useState<{ st: StockIn; supplier: string } | null>(null)
  const [counting, setCounting] = useState<{ batch: string; n: string; why: string } | null>(null)
  const [newItem, setNewItem] = useState<{ f: Partial<PharmacyItem>; opening: StockIn } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!biz) return
    setLoading(true)
    try { setStock(await getStock(biz)) } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [biz])
  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => { if (open) getBatches(open).then(setBatches).catch(() => setBatches([])); else setBatches([]) }, [open])

  const low = (r: StockRow) => r.is_active && r.qty_available <= r.reorder_level
  const expiring = (r: StockRow) => r.qty_expired > 0 || (r.qty_available > 0 && soon(r.next_expiry, 60))
  const rows = useMemo(() => {
    const w = q.trim().toLowerCase()
    return stock.filter(r => filter === 'all' || (filter === 'low' ? low(r) : expiring(r)))
      .filter(r => !w || itemLabel(r).toLowerCase().includes(w) || (r.generic_name ?? '').toLowerCase().includes(w))
  }, [stock, filter, q])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      await fn(); setMsg(ok); await load()
      if (open) setBatches(await getBatches(open).catch(() => []))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (newItem) {
    const f = newItem.f
    const set = (k: keyof PharmacyItem, v: string | number) => setNewItem({ ...newItem, f: { ...f, [k]: v } })
    const save = () => run(async () => {
      const generic = (f.generic_name ?? '').trim(), brand = (f.name ?? '').trim()
      if (!generic && !brand) throw new Error('Enter the medicine name.')
      const withStock = Number(newItem.opening.units) > 0
      const id = await saveItem(biz, { ...f, name: brand || generic, generic_name: generic || null, reorder_level: Number(f.reorder_level) || 0 })
      if (withStock) await addStock(biz, id, newItem.opening, 'Opening stock')
      setNewItem(null)
    }, '✓ Medicine added')
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={st2.wrap} keyboardShouldPersistTaps="handled">
          <Card>
            <Label>Add a medicine</Label>
            <Field label="Medicine / item name *" placeholder="Paracetamol, Moxifloxacin, Syringe 5ml" value={String(f.generic_name ?? '')} onChangeText={t => set('generic_name', t)} autoFocus />
            <Field label="Brand (company name)" placeholder="Dolo, Vigamox — leave blank if none" value={String(f.name ?? '')} onChangeText={t => set('name', t)} />
            <Text style={st2.meta}>Type</Text>
            <View style={st2.row}>{ITEM_FORMS.map(t => <Chip key={t.value} label={t.label} on={f.form === t.value}
              onPress={() => setNewItem({ ...newItem, f: { ...f, form: t.value, unit: t.unit } })} />)}</View>
            <View style={st2.row2}>
              <View style={{ flex: 1 }}><Field label="Strength" placeholder="650mg, 0.5%" value={String(f.strength ?? '')} onChangeText={t => set('strength', t)} /></View>
              <View style={{ flex: 1 }}><Field label="Sold per" placeholder="tablet, bottle" value={String(f.unit ?? '')} onChangeText={t => set('unit', t)} /></View>
            </View>
            <Field label="Warn when stock is at or below" value={String(f.reorder_level ?? 0)} keyboardType="number-pad" onChangeText={t => set('reorder_level', t.replace(/\D/g, ''))} />
            <Note>HSN 3004 and GST 12% are set by default; change them on the computer if needed (used only with a pharmacy GSTIN).</Note>
          </Card>
          <Card>
            <Label>Stock you have now — in {f.unit || 'unit'}s, not boxes</Label>
            <Note>Leave the quantity empty to add stock later.</Note>
            <StockInFields unit={String(f.unit ?? '')} st={newItem.opening} set={o => setNewItem({ ...newItem, opening: o })} />
          </Card>
          <Err msg={err} />
          <View style={st2.row}>
            <Btn label="Save" busy={busy} onPress={save} />
            <Btn kind="ghost" label="Cancel" onPress={() => { setNewItem(null); setErr('') }} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={st2.wrap} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <View style={st2.row}>
          {([['all', 'All'], ['low', `Reorder (${stock.filter(low).length})`], ['expiry', `Expired / expiring (${stock.filter(expiring).length})`]] as const).map(([k, l]) =>
            <Chip key={k} label={l} on={filter === k} onPress={() => setFilter(k)} />)}
        </View>
        <Field placeholder="Search medicines" value={q} onChangeText={setQ} autoCorrect={false} />
        {manages && <Btn small kind="ghost" label="+ Add a medicine" onPress={() => { setNewItem({ f: { ...blankItem }, opening: blankIn }); setErr(''); setMsg('') }} />}
        <Err msg={err} />
        {!!msg && <Text style={st2.ok}>{msg}</Text>}

        {rows.map(r => (
          <Card key={r.id}>
            <Pressable onPress={() => { setOpen(open === r.id ? null : r.id); setAdding(null); setCounting(null) }}>
              <Text style={[st2.name, !r.is_active && { color: C.muted }]}>{itemLabel(r)}{!r.is_active ? ' · not stocked' : ''}</Text>
              <Text style={st2.meta}>
                <Text style={low(r) ? st2.bad : undefined}>{r.qty_available} {r.unit}</Text>
                {r.next_expiry ? <Text style={soon(r.next_expiry, 60) ? st2.warn : undefined}>{`  ·  exp ${toDmy(r.next_expiry)}`}</Text> : null}
                {r.qty_expired > 0 ? <Text style={st2.bad}>{`  ·  ${r.qty_expired} expired`}</Text> : null}
                {r.unit_mrp != null ? `  ·  ${rs(r.unit_mrp)}/${r.unit}` : ''}
              </Text>
            </Pressable>
            {open === r.id && (
              <View style={{ gap: 8 }}>
                {!batches.length ? <Note>No batches yet — add stock to bring some in.</Note> : batches.map(b => {
                  const expired = b.expiry_date < isoToday()
                  return (
                    <View key={b.id} style={st2.batch}>
                      <Text style={st2.body}>Batch {b.batch_no} · <Text style={expired ? st2.bad : soon(b.expiry_date, 60) ? st2.warn : undefined}>exp {toDmy(b.expiry_date)}{expired ? ' (expired)' : ''}</Text></Text>
                      <Text style={st2.meta}>{b.qty_in_hand} of {b.qty_received} {r.unit} left · MRP {rs(b.unit_mrp)}{manages ? ` · cost ${rs(b.unit_cost)}` : ''}</Text>
                      {manages && (counting?.batch === b.id ? (
                        <View style={{ gap: 6 }}>
                          <Field label="Counted on the shelf" value={counting.n} keyboardType="number-pad" onChangeText={t => setCounting({ ...counting, n: t.replace(/\D/g, '') })} />
                          <Field placeholder={expired ? 'Expired — thrown out' : 'Why? Physical count, damaged, expired…'} value={counting.why} onChangeText={t => setCounting({ ...counting, why: t })} />
                          <View style={st2.row}>
                            <Btn small label="Save count" busy={busy} disabled={counting.n === ''}
                              onPress={() => run(async () => { await adjustStock(b.id, parseInt(counting.n, 10), counting.why.trim()); setCounting(null) }, '✓ Count corrected')} />
                            <Btn small kind="ghost" label="Back" onPress={() => setCounting(null)} />
                          </View>
                        </View>
                      ) : <Text style={st2.link} onPress={() => setCounting({ batch: b.id, n: String(b.qty_in_hand), why: '' })}>Correct count</Text>)}
                    </View>
                  )
                })}
                {manages && (adding ? (
                  <View style={{ gap: 6 }}>
                    <Label>Add stock — {itemLabel(r)}</Label>
                    <StockInFields unit={r.unit} st={adding.st} set={x => setAdding({ ...adding, st: x })} />
                    <Field label="Supplier (optional)" value={adding.supplier} onChangeText={t => setAdding({ ...adding, supplier: t })} />
                    <View style={st2.row}>
                      <Btn small label="Add to stock" busy={busy}
                        onPress={() => run(async () => { await addStock(biz, r.id, adding.st, adding.supplier.trim() || 'Stock added'); setAdding(null) }, `✓ Stock added to ${itemLabel(r)}`)} />
                      <Btn small kind="ghost" label="Back" onPress={() => setAdding(null)} />
                    </View>
                  </View>
                ) : <Btn small label="Add stock" onPress={() => { setAdding({ st: blankIn, supplier: '' }); setCounting(null) }} />)}
              </View>
            )}
          </Card>
        ))}
        {!rows.length && <Note>{loading ? 'Loading…' : stock.length ? 'Nothing here.' : 'No medicines yet.'}</Note>}
        <Note>Bills, purchases with an invoice, and editing a medicine's details are on the computer (Pharmacy).</Note>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const st2 = StyleSheet.create({
  wrap: { padding: 14, gap: 10, paddingBottom: 60 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  row2: { flexDirection: 'row', gap: 8 },
  name: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  body: { fontSize: 14, color: C.ink },
  meta: { fontSize: 12.5, color: C.muted },
  bad: { color: C.danger, fontWeight: '800' },
  warn: { color: '#b45309', fontWeight: '700' },
  ok: { color: C.green, fontWeight: '700' },
  link: { color: C.green, fontWeight: '700' },
  batch: { backgroundColor: '#f4f8f6', borderRadius: 8, padding: 8, gap: 3 },
})
