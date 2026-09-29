import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, Home, Plus, Printer, Search, Send, Trash2, Check, MapPin, Upload, Phone, MessageCircle, Download, CalendarClock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { moneyExact } from '../../lib/format'
import { searchPatients, registerPatient, PatientSearchResult } from '../../lib/patientsApi'
import {
  getLabSettings, saveLabSettings, importCatalogue, getTests, getTestParameters, saveTest, getPackages, savePackage,
  createOrder, getOrders, getOrder, markCollected, assignCollector, cancelOrder, getResults, getPreviousValues,
  saveResults, approveOrder, sendReport, rangeText, STATUS_LABEL,
  getFollowups, followupAction, getCrmSummary, getSegment, setRepeatDays, reminderLink,
  getUploads, uploadReport, sendUpload, testVisible,
  type LabCategory,
  LabTest, LabPackage, LabOrder, LabParameter, OrderStatus, ParamKind, LabFollowup, CrmSummary, Segment, UploadedReport,
} from '../../lib/labApi'
import { downloadCsv } from '../../lib/billingApi'
import { sizeText } from '../../lib/shrinkUpload'

// The lab (0168) — tests, packages, orders, results, signed reports.
//
// Reception places orders and collects samples; technicians (nurse role) and
// doctors enter results; a doctor — the pathologist or radiologist — approves,
// and the report goes to the patient on WhatsApp the moment they do. The
// database enforces each of those lines; this screen only hides what a role
// could not do anyway.

type Section = 'queue' | 'new' | 'home' | 'followups' | 'uploads' | 'tests' | 'packages' | 'settings'
type QueueFilter = 'active' | 'ordered' | 'enter' | 'approve' | 'reported' | 'all'

const Err = ({ msg }: { msg: string }) => msg ? <p className="text-sm text-red-600 mt-2">{msg}</p> : null
const pill = (on: boolean) => `text-xs font-semibold px-3 py-1.5 rounded-full border ${on ? 'bg-teal-50 border-teal-500 text-teal-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`
const statusCls: Record<OrderStatus, string> = {
  ordered: 'bg-amber-50 text-amber-800', collected: 'bg-blue-50 text-blue-700', in_progress: 'bg-blue-50 text-blue-700',
  ready: 'bg-purple-50 text-purple-700', reported: 'bg-green-50 text-green-700', cancelled: 'bg-gray-100 text-gray-500',
}
const dt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const mapLink = (addr: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`

export default function LabPanel({ businessId, canManage, canResults, canApprove }: {
  businessId: string
  /** Owner, manager, doctor: tests, packages, prices, cancel. */
  canManage: boolean
  /** Owner, doctor, nurse (technician): enter results. */
  canResults: boolean
  /** Owner, doctor: approve and release reports. */
  canApprove: boolean
}) {
  const [section, setSection] = useState<Section>('queue')
  const [tests, setTests] = useState<LabTest[]>([])
  const [packages, setPackages] = useState<LabPackage[]>([])
  const [openOrder, setOpenOrder] = useState<string | null>(null)
  // "Book" on a follow-up opens New order with the patient and test filled in.
  const [prefill, setPrefill] = useState<{ memberId: string; name: string; phone: string; testId: string | null } | null>(null)
  const [labName, setLabName] = useState('')
  // 0177: the kinds of tests done here. Null = not chosen (everything shows).
  const [labCats, setLabCats] = useState<string[] | null>(null)
  const [isLab, setIsLab] = useState(false)
  useEffect(() => {
    supabase.from('businesses').select('name, vertical, lab_categories').eq('id', businessId).maybeSingle().then(({ data }) => {
      const b = data as { name?: string; vertical?: string; lab_categories?: string[] | null } | null
      setLabName(b?.name ?? ''); setLabCats(b?.lab_categories ?? null); setIsLab(b?.vertical === 'lab')
    })
  }, [businessId])
  const shown = useMemo(() => tests.filter(t => testVisible(labCats, t.category)), [tests, labCats])

  const reloadCatalogue = useCallback(() => {
    getTests(businessId).then(setTests).catch(() => setTests([]))
    getPackages(businessId).then(setPackages).catch(() => setPackages([]))
  }, [businessId])
  useEffect(reloadCatalogue, [reloadCatalogue])

  const sections: [Section, string][] = [
    ['queue', 'Orders'], ['new', 'New order'], ['home', 'Home collections'], ['followups', 'Follow-ups'],
    ...(canResults ? [['uploads', 'Uploaded reports']] as [Section, string][] : []),
    ['tests', 'Tests'], ['packages', 'Packages'],
    ...(canManage ? [['settings', 'Settings']] as [Section, string][] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy-700 flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Lab</h2>
          <p className="text-sm text-gray-500">Tests, packages, samples, results and reports sent to patients on WhatsApp.</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {sections.map(([s, l]) => <button key={s} onClick={() => { setSection(s); setOpenOrder(null) }} className={pill(section === s)}>{l}</button>)}
        </div>
      </div>

      {isLab && !labCats?.length && canManage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
          Tell us what kind of lab this is — pathology, or radiology &amp; imaging — under <b>Lab &amp; team</b>. Your test list and reports then show only those tests.
        </div>
      )}

      {openOrder ? (
        <OrderDetail orderId={openOrder} businessId={businessId} canManage={canManage} canResults={canResults}
          canApprove={canApprove} onBack={() => setOpenOrder(null)} />
      ) : (
        <>
          {section === 'queue' && <Queue businessId={businessId} onOpen={setOpenOrder} />}
          {section === 'new' && <NewOrder key={prefill?.memberId ?? 'blank'} businessId={businessId} tests={shown} packages={packages} prefill={prefill}
            onCreated={id => { setPrefill(null); setOpenOrder(id); setSection('queue') }} goTests={() => setSection('tests')} canManage={canManage} />}
          {section === 'followups' && <Followups businessId={businessId} labName={labName}
            onBook={f => { setPrefill({ memberId: f.patient_member_id, name: f.patient_name, phone: f.patient_phone ?? '', testId: f.test_id }); setSection('new') }} />}
          {section === 'uploads' && canResults && <Uploads businessId={businessId} />}
          {section === 'home' && <HomeRound businessId={businessId} onOpen={setOpenOrder} />}
          {section === 'tests' && <Tests businessId={businessId} tests={shown} cats={labCats} canManage={canManage} reload={reloadCatalogue} />}
          {section === 'packages' && <Packages businessId={businessId} tests={shown} packages={packages} canManage={canManage} reload={reloadCatalogue} />}
          {section === 'settings' && canManage && <Settings businessId={businessId} />}
        </>
      )}
    </div>
  )
}

// ── Queue ───────────────────────────────────────────────────────────────────

function OrderRow({ o, onOpen }: { o: LabOrder; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(o.id)} className="w-full text-left px-4 py-3 text-sm flex flex-wrap justify-between gap-2 hover:bg-gray-50">
      <span>
        <b>{o.order_no}</b> · {o.patient_name}{o.patient_age != null ? ` · ${o.patient_age}y` : ''}
        {o.priority === 'urgent' && <span className="ml-2 text-xs font-bold text-red-600">URGENT</span>}
        {o.collection === 'home' && <span className="ml-2 text-xs font-bold text-teal-700">HOME</span>}
        <span className="block text-xs text-gray-500">
          {o.items.map(i => i.name).join(', ')}
        </span>
      </span>
      <span className="flex items-center gap-2 text-xs">
        <span className="text-gray-400">{dt(o.created_at)}</span>
        <span className={`px-2 py-0.5 rounded-full font-semibold ${statusCls[o.status]}`}>{STATUS_LABEL[o.status]}</span>
      </span>
    </button>
  )
}

function Queue({ businessId, onOpen }: { businessId: string; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<QueueFilter>('active')
  const [orders, setOrders] = useState<LabOrder[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    const statuses: Record<QueueFilter, OrderStatus[] | undefined> = {
      active: ['ordered', 'collected', 'in_progress', 'ready'], ordered: ['ordered'],
      enter: ['collected', 'in_progress'], approve: ['ready', 'in_progress'], reported: ['reported'], all: undefined,
    }
    setOrders(null)
    getOrders(businessId, { statuses: statuses[filter], since: filter === 'reported' || filter === 'all' ? new Date(Date.now() - 30 * 864e5).toISOString() : undefined })
      .then(setOrders).catch(() => setOrders([]))
  }, [businessId, filter])
  const rows = (orders ?? []).filter(o => filter !== 'approve' || o.entered_count > 0)
    .filter(o => !q.trim() || `${o.order_no} ${o.patient_name} ${o.patient_phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="space-y-3">
      <div className="flex gap-1 flex-wrap">
        {([['active', 'All open'], ['ordered', 'To collect'], ['enter', 'Enter results'], ['approve', 'To approve'], ['reported', 'Reported (30 days)'], ['all', 'Everything (30 days)']] as [QueueFilter, string][])
          .map(([f, l]) => <button key={f} onClick={() => setFilter(f)} className={pill(filter === f)}>{l}</button>)}
      </div>
      <input className="input-field" value={q} onChange={e => setQ(e.target.value)} placeholder="Search order number, patient or phone" />
      {orders === null ? <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
        : rows.length === 0 ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">No orders here.</div>
        : <div className="card shadow-sm p-0 divide-y">{rows.map(o => <OrderRow key={o.id} o={o} onOpen={onOpen} />)}</div>}
    </div>
  )
}

function HomeRound({ businessId, onOpen }: { businessId: string; onOpen: (id: string) => void }) {
  const [orders, setOrders] = useState<LabOrder[] | null>(null)
  useEffect(() => {
    getOrders(businessId, { statuses: ['ordered'] }).then(o => setOrders(o.filter(x => x.collection === 'home')
      .sort((a, b) => (a.collection_slot ?? a.created_at).localeCompare(b.collection_slot ?? b.created_at)))).catch(() => setOrders([]))
  }, [businessId])
  if (!orders) return <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
  if (!orders.length) return <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">No home collections waiting.</div>
  return (
    <div className="card shadow-sm p-0 divide-y">
      {orders.map(o => (
        <div key={o.id} className="px-4 py-3 text-sm flex flex-wrap justify-between gap-3">
          <div>
            <b>{o.patient_name}</b> · {o.patient_phone && <a href={`tel:+${o.patient_phone}`} className="text-teal-700">{o.patient_phone}</a>}
            <div className="text-gray-600">{o.collection_address}</div>
            <div className="text-xs text-gray-500">
              {o.collection_slot ? `Slot ${dt(o.collection_slot)}` : 'No slot set'} · {o.collector_name ? `Collector: ${o.collector_name}` : 'No collector assigned'}
              {' · '}{o.items.map(i => i.name).join(', ')}
            </div>
          </div>
          <div className="flex gap-2 items-start">
            {o.collection_address && <a href={mapLink(o.collection_address)} target="_blank" rel="noreferrer" className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> Map</a>}
            <button onClick={() => onOpen(o.id)} className="btn-outline text-xs py-1.5 px-3">Open</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── New order ───────────────────────────────────────────────────────────────

export function TestPicker({ tests, packages, testIds, packageIds, setTestIds, setPackageIds }: {
  tests: LabTest[]; packages: LabPackage[]; testIds: string[]; packageIds: string[]
  setTestIds: (v: string[]) => void; setPackageIds: (v: string[]) => void
}) {
  const [q, setQ] = useState('')
  const act = tests.filter(t => t.is_active)
  const hits = q.trim() ? act.filter(t => t.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 10) : []
  const inPkg = new Set(packages.filter(p => packageIds.includes(p.id)).flatMap(p => p.test_ids))
  const total = packages.filter(p => packageIds.includes(p.id)).reduce((s, p) => s + p.price, 0)
    + act.filter(t => testIds.includes(t.id) && !inPkg.has(t.id)).reduce((s, t) => s + t.price, 0)
  return (
    <div className="space-y-2">
      {packages.filter(p => p.is_active).length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {packages.filter(p => p.is_active).map(p => {
            const on = packageIds.includes(p.id)
            return <button key={p.id} type="button" onClick={() => setPackageIds(on ? packageIds.filter(x => x !== p.id) : [...packageIds, p.id])}
              className={`text-xs px-3 py-1.5 rounded-lg border ${on ? 'border-teal-500 bg-teal-50 text-teal-700 font-semibold' : 'border-gray-200 text-gray-600'}`}>
              {p.name} · {moneyExact(p.price)}</button>
          })}
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
        <input className="input-field pl-9" value={q} onChange={e => setQ(e.target.value)} placeholder="Add a test — CBC, thyroid, X-ray chest…" />
        {hits.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-auto">
            {hits.map(t => (
              <button key={t.id} type="button" onClick={() => { if (!testIds.includes(t.id)) setTestIds([...testIds, t.id]); setQ('') }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50 flex justify-between gap-2">
                <span>{t.name}</span><span className="text-gray-500">{moneyExact(t.price)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {testIds.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {testIds.map(id => {
            const t = tests.find(x => x.id === id)
            return <span key={id} className="text-xs bg-gray-100 rounded-lg px-2 py-1 flex items-center gap-1">
              {t?.name}{inPkg.has(id) ? ' (in package)' : ''}
              <button type="button" onClick={() => setTestIds(testIds.filter(x => x !== id))} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
            </span>
          })}
        </div>
      )}
      {(testIds.length > 0 || packageIds.length > 0) && <p className="text-sm text-gray-700">Total <b>{moneyExact(total)}</b> — added to the patient's bill.</p>}
    </div>
  )
}

function NewOrder({ businessId, tests, packages, onCreated, goTests, canManage, prefill }: {
  businessId: string; tests: LabTest[]; packages: LabPackage[]; onCreated: (id: string) => void; goTests: () => void; canManage: boolean
  prefill?: { memberId: string; name: string; phone: string; testId: string | null } | null
}) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PatientSearchResult[]>([])
  const [patient, setPatient] = useState<{ id: string; name: string; phone: string } | null>(prefill ? { id: prefill.memberId, name: prefill.name, phone: prefill.phone } : null)
  const [reg, setReg] = useState<{ name: string; phone: string; age: string; gender: string } | null>(null)
  const [testIds, setTestIds] = useState<string[]>(prefill?.testId ? [prefill.testId] : [])
  const [packageIds, setPackageIds] = useState<string[]>([])
  const [home, setHome] = useState(false)
  const [address, setAddress] = useState('')
  const [slot, setSlot] = useState('')
  const [fee, setFee] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [referredBy, setReferredBy] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [defaultFee, setDefaultFee] = useState(0)
  useEffect(() => { getLabSettings(businessId).then(s => { setDefaultFee(s.homeFee); setFee(String(s.homeFee || '')) }) }, [businessId])

  useEffect(() => {
    if (patient || reg) return
    const t = setTimeout(() => { searchPatients(q, businessId).then(setFound).catch(() => setFound([])) }, 250)
    return () => clearTimeout(t)
  }, [q, patient, reg, businessId])

  if (!tests.length) {
    return (
      <div className="card shadow-sm text-sm text-gray-500 py-10 text-center space-y-3">
        <FlaskConical className="w-8 h-8 mx-auto text-gray-300" />
        <p>No tests yet. {canManage ? 'Load the standard test list, then set your prices.' : 'Ask the owner, a manager or a doctor to add tests.'}</p>
        {canManage && <button onClick={goTests} className="btn-teal text-sm">Set up tests</button>}
      </div>
    )
  }

  const submit = async () => {
    setErr('')
    if (!patient && !reg) { setErr('Choose or register the patient.'); return }
    if (!testIds.length && !packageIds.length) { setErr('Add at least one test or package.'); return }
    if (home && !address.trim()) { setErr('Give the address for home collection.'); return }
    setBusy(true)
    try {
      let memberId = patient?.id ?? ''
      if (!memberId && reg) {
        memberId = await registerPatient(businessId, { fullName: reg.name.trim(), phone: reg.phone.trim(), relation: 'self',
          gender: reg.gender || undefined, ageYears: reg.age ? Number(reg.age) : null })
      }
      const id = await createOrder(businessId, {
        memberId, testIds, packageIds, collection: home ? 'home' : 'lab', address, slot: slot ? new Date(slot).toISOString() : null,
        homeFee: home ? (fee === '' ? defaultFee : Number(fee)) : null, priority: urgent ? 'urgent' : 'routine', notes, referredBy,
      })
      onCreated(id)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card shadow-sm space-y-4">
      <div>
        <div className="text-xs font-semibold text-gray-500 mb-1">Patient</div>
        {patient ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
            <span><b>{patient.name}</b> · {patient.phone}</span>
            <button className="text-teal-700 text-xs" onClick={() => setPatient(null)}>Change</button>
          </div>
        ) : reg ? (
          <div className="grid sm:grid-cols-4 gap-2">
            <input className="input-field sm:col-span-2" placeholder="Full name" value={reg.name} onChange={e => setReg({ ...reg, name: e.target.value })} />
            <input className="input-field" placeholder="Mobile" inputMode="tel" value={reg.phone} onChange={e => setReg({ ...reg, phone: e.target.value })} />
            <div className="flex gap-2">
              <input className="input-field" placeholder="Age" inputMode="numeric" value={reg.age} onChange={e => setReg({ ...reg, age: e.target.value })} />
              <select className="input-field" value={reg.gender} onChange={e => setReg({ ...reg, gender: e.target.value })}>
                <option value="">Sex</option><option value="male">M</option><option value="female">F</option><option value="other">O</option>
              </select>
            </div>
            <button className="text-xs text-teal-700 text-left" onClick={() => setReg(null)}>← Search instead</button>
          </div>
        ) : (
          <div>
            <input className="input-field" value={q} onChange={e => setQ(e.target.value)} placeholder="Find the patient — name, phone or file number" />
            {found.length > 0 && (
              <div className="border border-gray-200 rounded-lg mt-1 divide-y">
                {found.slice(0, 8).map(p => (
                  <button key={p.patient_member_id} onClick={() => { setPatient({ id: p.patient_member_id, name: p.full_name, phone: p.phone }); setFound([]) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50">
                    <b>{p.full_name}</b> {p.age_years != null ? `· ${p.age_years}y` : ''} · {p.phone}
                  </button>
                ))}
              </div>
            )}
            <button className="text-xs text-teal-700 mt-2 inline-flex items-center gap-1" onClick={() => setReg({ name: q.replace(/\d/g, '').trim(), phone: q.replace(/\D/g, ''), age: '', gender: '' })}>
              <Plus className="w-3 h-3" /> New patient
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-500 mb-1">Tests & packages</div>
        <TestPicker tests={tests} packages={packages} testIds={testIds} packageIds={packageIds} setTestIds={setTestIds} setPackageIds={setPackageIds} />
      </div>

      <div className="space-y-2">
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={home} onChange={e => setHome(e.target.checked)} />
          <Home className="w-4 h-4 text-teal-700" /> Collect the sample at the patient's home</label>
        {home && (
          <div className="grid sm:grid-cols-3 gap-2">
            <input className="input-field sm:col-span-3" placeholder="Address for collection" value={address} onChange={e => setAddress(e.target.value)} />
            <label className="text-xs text-gray-500">Preferred time<input type="datetime-local" className="input-field mt-1" value={slot} onChange={e => setSlot(e.target.value)} /></label>
            <label className="text-xs text-gray-500">Home collection fee (₹)<input type="number" min={0} className="input-field mt-1" value={fee} onChange={e => setFee(e.target.value)} /></label>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-2">
        <input className="input-field" placeholder="Referred by (doctor)" value={referredBy} onChange={e => setReferredBy(e.target.value)} />
        <input className="input-field sm:col-span-2" placeholder="Notes (fasting, etc.)" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} /> Urgent</label>

      <Err msg={err} />
      <div className="flex justify-end">
        <button disabled={busy} onClick={submit} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Create order'}</button>
      </div>
    </div>
  )
}

// ── One order: collect, enter results, approve, send ────────────────────────

function OrderDetail({ orderId, businessId, canManage, canResults, canApprove, onBack }: {
  orderId: string; businessId: string; canManage: boolean; canResults: boolean; canApprove: boolean; onBack: () => void
}) {
  const [o, setO] = useState<LabOrder | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [collectedBy, setCollectedBy] = useState<string | null>(null)
  const [cancelWhy, setCancelWhy] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadedReport[]>([])
  const load = useCallback(() => {
    getOrder(orderId).then(setO).catch(e => setErr((e as Error).message))
    if (canResults) getUploads(businessId, { orderId }).then(setUploads).catch(() => setUploads([]))
  }, [orderId, businessId, canResults])
  useEffect(load, [load])
  useEffect(() => {
    supabase.from('business_practitioners').select('practitioner_id, practitioners(full_name)').eq('business_id', businessId).neq('status', 'suspended')
      .then(({ data }) => setStaff((data ?? []).map((r: Record<string, unknown>) => ({ id: r.practitioner_id as string, name: ((r.practitioners as { full_name?: string }) ?? {}).full_name ?? '—' }))))
  }, [businessId])

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setErr(''); setMsg('')
    try { const m = await fn(); if (m) setMsg(m); load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const approveAndSend = () => run(async () => {
    const r = await approveOrder(orderId)
    try {
      const s = await sendReport(r.report_id)
      return s.whatsapp ? 'Approved and sent to the patient on WhatsApp.'
        : `Approved. The report could not be sent automatically${s.errors?.length ? ` (${s.errors[0]})` : ''} — print it or resend.`
    } catch (e) { return `Approved. Sending failed: ${(e as Error).message}` }
  })

  if (!o) return <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">{err || 'Loading…'}</div>
  const rep = o.latest_report
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-teal-700">← All orders</button>
      <div className="card shadow-sm space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <div className="text-lg font-bold text-navy-700">{o.order_no} · {o.patient_name}</div>
            <div className="text-sm text-gray-500">
              {[o.patient_age != null ? `${o.patient_age}y` : null, o.patient_gender, o.patient_phone, o.mrn ? `file ${o.mrn}` : null].filter(Boolean).join(' · ')}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Ordered {dt(o.created_at)} by {o.ordered_by_name ?? o.created_by_name ?? '—'}{o.referred_by ? ` · referred by ${o.referred_by}` : ''}
              {o.priority === 'urgent' ? ' · URGENT' : ''}{o.notes ? ` · ${o.notes}` : ''}
            </div>
            {(o.collected_at || o.latest_report) && (
              <div className="text-xs text-gray-500 mt-0.5">
                {o.collected_at ? `Sample collected ${dt(o.collected_at)} by ${o.collected_by_name ?? '—'}` : ''}
                {o.latest_report ? `${o.collected_at ? ' · ' : ''}Approved ${dt(o.latest_report.approved_at)} by ${o.latest_report.approved_by_name ?? '—'}` : ''}
              </div>
            )}
          </div>
          <span className={`self-start px-2 py-1 rounded-full text-xs font-semibold ${statusCls[o.status]}`}>{STATUS_LABEL[o.status]}</span>
        </div>

        {o.collection === 'home' && (
          <div className="bg-teal-50 rounded-lg p-3 text-sm space-y-2">
            <div className="flex items-center gap-2 font-semibold text-teal-800"><Home className="w-4 h-4" /> Home collection · {moneyExact(o.home_fee)}</div>
            <div>{o.collection_address} {o.collection_address && <a href={mapLink(o.collection_address)} target="_blank" rel="noreferrer" className="text-teal-700 text-xs ml-2">Open map →</a>}</div>
            {o.status === 'ordered' && (
              <div className="flex flex-wrap gap-2 items-center">
                <select className="input-field w-auto" value={o.collector_id ?? ''} onChange={e => run(async () => { await assignCollector(o.id, e.target.value || null, null); return 'Collector saved.' })}>
                  <option value="">Who collects?</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input type="datetime-local" className="input-field w-auto" defaultValue={o.collection_slot ? o.collection_slot.slice(0, 16) : ''}
                  onBlur={e => e.target.value && run(async () => { await assignCollector(o.id, o.collector_id, new Date(e.target.value).toISOString()); return 'Time saved.' })} />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {o.status === 'ordered' && (
            // Who actually drew the blood / ran the scan — often not whoever clicks.
            <span className="inline-flex flex-wrap gap-2 items-center">
              <select className="input-field w-auto text-xs py-1.5" value={collectedBy ?? o.collector_id ?? ''}
                onChange={e => setCollectedBy(e.target.value)} aria-label="Collected by">
                <option value="">Collected by: me</option>
                {staff.map(s => <option key={s.id} value={s.id}>Collected by: {s.name}</option>)}
              </select>
              <button disabled={busy} onClick={() => run(async () => {
                const by = collectedBy ?? o.collector_id ?? ''
                await markCollected(o.id, by || null)
                return `Sample marked collected${by ? ` by ${staff.find(s => s.id === by)?.name ?? 'them'}` : ''}.`
              })} className="btn-teal text-xs py-2 px-4"><Check className="w-4 h-4" /> Sample collected</button>
            </span>
          )}
          {canApprove && o.entered_count > 0 && <button disabled={busy} onClick={approveAndSend} className="btn-teal text-xs py-2 px-4"><Send className="w-4 h-4" /> Approve & send report</button>}
          {rep && <a href={`/lab/${rep.token}`} target="_blank" rel="noreferrer" className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1"><Printer className="w-3 h-3" /> Report {rep.report_no}</a>}
          {rep && <button disabled={busy} onClick={() => run(async () => { const s = await sendReport(rep.id); return s.whatsapp ? 'Sent on WhatsApp.' : `Not sent${s.errors?.length ? `: ${s.errors[0]}` : ''}.` })} className="btn-outline text-xs py-1.5 px-3">Resend</button>}
          {canResults && o.status !== 'cancelled' && o.status !== 'ordered' && (
            <label className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1 cursor-pointer">
              <Upload className="w-3 h-3" /> Upload report file
              <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e => {
                const files = Array.from(e.target.files ?? []); e.target.value = ''
                if (!files.length) return
                run(async () => {
                  const up = await uploadReport(files, { businessId, memberId: o.patient_member_id, orderId: o.id,
                    title: `${o.items.map(i => i.name).join(', ').slice(0, 80) || 'Lab report'} — ${o.order_no}` })
                  try {
                    const sres = await sendUpload(up.id)
                    return sres.whatsapp ? `Uploaded (${shrunk(up)}) and sent to the patient on WhatsApp.`
                      : `Uploaded. Not sent automatically${sres.errors?.length ? ` (${sres.errors[0]})` : ''} — use Resend.`
                  } catch (e2) { return `Uploaded. Sending failed: ${(e2 as Error).message}` }
                })
              }} />
            </label>
          )}
          {canManage && !rep && !uploads.length && o.status !== 'cancelled' && <button onClick={() => setCancelWhy('')} className="btn-outline text-xs py-1.5 px-3 text-red-600">Cancel order</button>}
        </div>
        {uploads.map(u => (
          <div key={u.id} className="text-xs text-gray-600 flex flex-wrap gap-2 items-center">
            <Upload className="w-3 h-3" /> {u.title} · uploaded by {u.uploaded_by_name ?? '—'} · kept until {new Date(u.expires_on).toLocaleDateString('en-IN')}
            · {u.sent_at ? `sent ${dt(u.sent_at)}` : u.send_error ? `not sent: ${u.send_error}` : 'not sent'}
            <a href={`/lab/file/${u.public_token}`} target="_blank" rel="noreferrer" className="text-teal-700">Open</a>
            <button disabled={busy} className="text-teal-700" onClick={() => run(async () => { const r = await sendUpload(u.id); return r.whatsapp ? 'Sent on WhatsApp.' : `Not sent${r.errors?.length ? `: ${r.errors[0]}` : ''}.` })}>Resend</button>
          </div>
        ))}
        {rep && <p className="text-xs text-gray-500">Approved by {rep.approved_by_name} · {dt(rep.approved_at)} · {rep.sent_at ? `sent ${dt(rep.sent_at)} by ${rep.sent_channels.join(', ')}` : rep.send_error ? `not sent: ${rep.send_error}` : 'not sent yet'}</p>}
        {cancelWhy !== null && (
          <div className="flex gap-2">
            <input className="input-field" placeholder="Why is it being cancelled?" value={cancelWhy} onChange={e => setCancelWhy(e.target.value)} />
            <button disabled={busy} onClick={() => run(async () => { await cancelOrder(o.id, cancelWhy); setCancelWhy(null); return 'Order cancelled; its charges are removed.' })} className="btn-teal text-xs bg-red-600 hover:bg-red-700">Cancel order</button>
          </div>
        )}
        {msg && <p className="text-sm text-green-700">{msg}</p>}
        <Err msg={err} />
      </div>

      <div className="card shadow-sm p-0 divide-y">
        {o.items.map(it => (
          <div key={it.id}>
            <button onClick={() => setOpenItem(openItem === it.id ? null : it.id)} className="w-full text-left px-4 py-3 text-sm flex justify-between gap-2 hover:bg-gray-50">
              <span><b>{it.name}</b>{it.package_name ? <span className="text-gray-400"> · {it.package_name}</span> : null}
                {it.entered_by_name && <span className="block text-xs text-gray-400">Entered by {it.entered_by_name}{it.entered_at ? `, ${dt(it.entered_at)}` : ''}</span>}</span>
              <span className={`text-xs font-semibold ${it.status === 'approved' ? 'text-green-700' : it.status === 'entered' ? 'text-purple-700' : 'text-amber-700'}`}>
                {it.status === 'approved' ? 'Approved' : it.status === 'entered' ? 'Entered — awaiting approval' : 'Pending'}
              </span>
            </button>
            {openItem === it.id && it.test_id && (
              <ResultForm itemId={it.id} testId={it.test_id} memberId={o.patient_member_id} orderId={o.id}
                gender={o.patient_gender} locked={it.status === 'approved' || !canResults || o.status === 'cancelled' || o.status === 'ordered'}
                lockReason={o.status === 'ordered' ? 'Mark the sample collected first.' : !canResults ? 'Only a doctor or a technician (nurse role) enters results.' : it.status === 'approved' ? 'Approved — no longer editable.' : ''}
                onSaved={() => { setOpenItem(null); load() }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ResultForm({ itemId, testId, memberId, orderId, gender, locked, lockReason, onSaved }: {
  itemId: string; testId: string; memberId: string; orderId: string; gender: string | null
  locked: boolean; lockReason: string; onSaved: () => void
}) {
  const [params, setParams] = useState<(LabParameter & { id: string })[]>([])
  const [vals, setVals] = useState<Record<string, string>>({})
  const [prev, setPrev] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    Promise.all([getTestParameters(testId), getResults(itemId), getPreviousValues(memberId, testId, orderId)]).then(([p, r, pv]) => {
      setParams(p); setPrev(pv)
      const v: Record<string, string> = {}
      r.forEach(x => { if (x.parameter_id) v[x.parameter_id] = x.value_text ?? (x.value_num != null ? String(x.value_num) : '') })
      setVals(v)
    }).catch(e => setErr((e as Error).message))
  }, [itemId, testId, memberId, orderId])

  const female = gender === 'female'
  const range = (p: LabParameter) => {
    const f = female && (p.ref_low_f != null || p.ref_high_f != null)
    return { lo: f ? p.ref_low_f ?? null : p.ref_low ?? null, hi: f ? p.ref_high_f ?? null : p.ref_high ?? null }
  }
  const flag = (p: LabParameter, v: string) => {
    if (p.kind !== 'number' || v.trim() === '' || isNaN(Number(v))) return null
    const { lo, hi } = range(p); const n = Number(v)
    return lo != null && n < Number(lo) ? 'L' : hi != null && n > Number(hi) ? 'H' : lo != null || hi != null ? 'N' : null
  }
  const save = async () => {
    setBusy(true); setErr('')
    try { await saveResults(itemId, params.map(p => ({ parameter_id: p.id, value: vals[p.id] ?? '' }))); onSaved() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="px-4 pb-4 bg-gray-50 space-y-2">
      {lockReason && <p className="text-xs text-amber-700 pt-2">{lockReason}</p>}
      <div className="grid gap-2 pt-2">
        {params.map(p => {
          const v = vals[p.id] ?? ''; const f = flag(p, v); const { lo, hi } = range(p)
          const set = (x: string) => setVals(s => ({ ...s, [p.id]: x }))
          return (
            <div key={p.id} className={p.kind === 'long_text' ? 'grid gap-1' : 'grid sm:grid-cols-[1.3fr_1fr_1.2fr_.8fr] gap-2 items-center'}>
              <div className="text-sm font-medium text-gray-700">{p.name}{p.unit ? <span className="text-gray-400"> ({p.unit})</span> : null}</div>
              {p.kind === 'select' ? (
                <select disabled={locked} className="input-field py-1.5" value={v} onChange={e => set(e.target.value)}>
                  <option value="">—</option>{(p.options ?? []).map(o => <option key={o}>{o}</option>)}
                </select>
              ) : p.kind === 'long_text' ? (
                <textarea disabled={locked} className="input-field" rows={4} value={v} onChange={e => set(e.target.value)} />
              ) : (
                <input disabled={locked} className={`input-field py-1.5 ${f === 'H' || f === 'L' ? 'border-red-400 text-red-700 font-semibold' : ''}`}
                  inputMode={p.kind === 'number' ? 'decimal' : 'text'} value={v} onChange={e => set(e.target.value)} />
              )}
              {p.kind !== 'long_text' && (
                <div className="text-xs text-gray-500">{rangeText({ ref_low: lo, ref_high: hi, ref_text: p.ref_text ?? null, unit: p.unit })}
                  {f && f !== 'N' && <b className="ml-1 text-red-600">{f === 'H' ? 'High' : 'Low'}</b>}</div>
              )}
              {p.kind !== 'long_text' && <div className="text-xs text-gray-400">{prev[p.id] ? `Last: ${prev[p.id]}` : ''}</div>}
            </div>
          )
        })}
      </div>
      <Err msg={err} />
      {!locked && <button disabled={busy} onClick={save} className="btn-teal text-xs py-2 px-4">{busy ? 'Saving…' : 'Save results'}</button>}
    </div>
  )
}

// ── Follow-ups: repeat tests, reminders, campaigns (0169) ───────────────────
//
// Approving a result schedules the patient's next test (sooner when it was
// abnormal). Reminders go from the lab's own WhatsApp with one tap — no
// template — and are recorded; ordering the test again books the follow-up.

function Followups({ businessId, labName, onBook }: { businessId: string; labName: string; onBook: (f: LabFollowup) => void }) {
  const [filter, setFilter] = useState<'due7' | 'overdue' | 'abnormal' | 'upcoming' | 'reminded' | 'booked' | 'campaigns'>('due7')
  const [rows, setRows] = useState<LabFollowup[] | null>(null)
  const [sum, setSum] = useState<CrmSummary | null>(null)
  const [resched, setResched] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    getCrmSummary(businessId).then(setSum).catch(() => setSum(null))
    if (filter !== 'campaigns') getFollowups(businessId, filter).then(setRows).catch(e => { setErr((e as Error).message); setRows([]) })
  }, [businessId, filter])
  useEffect(load, [load])
  const act = async (fn: () => Promise<void>) => { setErr(''); try { await fn(); load() } catch (e) { setErr((e as Error).message) } }

  const tile = (label: string, v: string | number, note?: string) => (
    <div className="card shadow-sm py-3"><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold text-navy-700">{v}</p>{note && <p className="text-xs text-gray-400">{note}</p>}</div>
  )
  return (
    <div className="space-y-3">
      {sum && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tile('Due this week', sum.due_7d)}
          {tile('Overdue', sum.overdue, `${sum.abnormal_open} after an abnormal result`)}
          {tile('Came back (30 days)', `${sum.came_back} of ${sum.reminded}`, 'reminded → booked')}
          {tile('Repeat business (30 days)', moneyExact(sum.booked_revenue), `${sum.lapsed_12m} patients not seen in a year`)}
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        {([['due7', 'Due this week'], ['overdue', 'Overdue'], ['abnormal', 'Abnormal — repeat'], ['upcoming', 'All upcoming'], ['reminded', 'Reminded'], ['booked', 'Booked'], ['campaigns', 'Campaign lists']] as const)
          .map(([f, l]) => <button key={f} onClick={() => setFilter(f)} className={pill(filter === f)}>{l}</button>)}
      </div>
      <Err msg={err} />
      {filter === 'campaigns' ? <Campaigns businessId={businessId} labName={labName} /> : rows === null ? <div className="card shadow-sm text-sm text-gray-400 py-10 text-center">Loading…</div>
        : rows.length === 0 ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">Nothing here. Follow-ups are scheduled automatically when a result is approved, for tests with a repeat interval.</div>
        : (
          <div className="card shadow-sm p-0 divide-y">
            {rows.map(f => {
              const wa = reminderLink(f.patient_phone, f.patient_name, f.test_name, labName || 'your lab', f.due_on)
              return (
                <div key={f.id} className="px-4 py-3 text-sm flex flex-wrap justify-between gap-3">
                  <div>
                    <b>{f.patient_name}</b>{f.patient_age != null ? ` · ${f.patient_age}y` : ''} · {f.test_name}
                    {f.reason === 'abnormal' && <span className="ml-2 text-xs font-bold text-red-600">ABNORMAL LAST TIME</span>}
                    <div className="text-xs text-gray-500">
                      Due {new Date(f.due_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {f.days_to_due < 0 ? ` · ${-f.days_to_due} days overdue` : f.days_to_due === 0 ? ' · today' : ` · in ${f.days_to_due} days`}
                      {f.last_tested_at ? ` · last tested ${new Date(f.last_tested_at).toLocaleDateString('en-IN')}` : ''}
                      {f.reminded_count ? ` · reminded ${f.reminded_count}×` : ''}{f.booked_order_no ? ` · booked ${f.booked_order_no}` : ''}
                      {f.note ? ` · ${f.note}` : ''}
                    </div>
                  </div>
                  {f.status !== 'booked' && (
                    <div className="flex gap-2 items-start flex-wrap">
                      {wa && <a href={wa} target="_blank" rel="noreferrer" onClick={() => act(() => followupAction(f.id, 'reminded'))}
                        className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" /> WhatsApp</a>}
                      {f.patient_phone && <a href={`tel:+${f.patient_phone}`} onClick={() => act(() => followupAction(f.id, 'reminded', undefined, 'Called'))}
                        className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1"><Phone className="w-3 h-3" /> Call</a>}
                      <button onClick={() => onBook(f)} className="btn-teal text-xs py-1.5 px-3">Book</button>
                      {resched === f.id ? (
                        <input type="date" className="input-field w-auto py-1" autoFocus onChange={e => e.target.value && act(async () => { await followupAction(f.id, 'reschedule', e.target.value); setResched(null) })} />
                      ) : <button onClick={() => setResched(f.id)} className="text-xs text-teal-700 inline-flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Later</button>}
                      <button onClick={() => act(() => followupAction(f.id, 'dismiss'))} className="text-xs text-gray-400 hover:text-red-600">Dismiss</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

function Campaigns({ businessId, labName }: { businessId: string; labName: string }) {
  const [seg, setSeg] = useState<Segment>('overdue')
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getSegment>> | null>(null)
  useEffect(() => { setRows(null); getSegment(businessId, seg).then(setRows).catch(() => setRows([])) }, [businessId, seg])
  const message: Record<Segment, string> = {
    overdue: `Namaste! Your repeat blood test is due. Book now — we collect the sample at your home. — ${labName}`,
    due_7d: `Namaste! Your repeat test is due this week. Reply to book a home collection. — ${labName}`,
    due_30d: `Namaste! Your repeat test is due this month. Reply to book at a time that suits you. — ${labName}`,
    abnormal: `Namaste! Your last report needs a repeat test to check progress. Please book this week. — ${labName}`,
    lapsed: `Namaste! It has been a year since your last check-up. Book a full body checkup — home collection available. — ${labName}`,
  }
  return (
    <div className="space-y-3">
      <div className="card shadow-sm space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm font-semibold text-navy-700">Who</span>
          <select className="input-field w-auto" value={seg} onChange={e => setSeg(e.target.value as Segment)}>
            <option value="overdue">Overdue for a repeat test</option>
            <option value="due_7d">Due this week</option>
            <option value="due_30d">Due this month</option>
            <option value="abnormal">Abnormal result, not yet repeated</option>
            <option value="lapsed">No test in over a year</option>
          </select>
          <span className="text-sm text-gray-500">{rows ? `${rows.length} patients` : '…'}</span>
          {rows && rows.length > 0 && (
            <button className="btn-outline text-xs py-1.5 px-3 inline-flex items-center gap-1" onClick={() => downloadCsv(`lab-${seg}-${new Date().toISOString().slice(0, 10)}.csv`,
              [['Patient', 'Phone', 'Tests', 'Due', 'Last tested'], ...rows.map(r => [r.patient_name, r.patient_phone ?? '', r.detail, r.due_on ?? '', r.last_tested_at ? r.last_tested_at.slice(0, 10) : ''])]
                .map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))}>
              <Download className="w-3 h-3" /> Download list</button>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">Suggested message</div>
          <div className="text-sm bg-gray-50 rounded-lg p-3">{message[seg]}</div>
          <p className="text-xs text-gray-500 mt-1">Send it one by one from your WhatsApp (tap WhatsApp on each row), or as a WhatsApp broadcast to this list from the WhatsApp tab (needs the WhatsApp add-on and Sehatsandhi's approval).</p>
        </div>
      </div>
      {rows && rows.length > 0 && (
        <div className="card shadow-sm p-0 divide-y max-h-[28rem] overflow-auto">
          {rows.map(r => {
            const digits = String(r.patient_phone ?? '').replace(/\D/g, '')
            return (
              <div key={r.patient_member_id} className="px-4 py-2.5 text-sm flex justify-between gap-2 flex-wrap">
                <span><b>{r.patient_name}</b> · <span className="text-gray-500">{r.detail}</span></span>
                {digits && <a className="text-xs text-teal-700 inline-flex items-center gap-1" target="_blank" rel="noreferrer"
                  href={`https://wa.me/${digits}?text=${encodeURIComponent(message[seg])}`}><MessageCircle className="w-3 h-3" /> WhatsApp</a>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function shrunk(u: { originalBytes: number; bytes: number; pages: number }) {
  const pages = u.pages > 1 ? `${u.pages} pages, ` : ''
  return u.bytes < u.originalBytes * 0.9 ? `${pages}${sizeText(u.originalBytes)} → ${sizeText(u.bytes)}` : `${pages}${sizeText(u.bytes)}`
}

// ── Uploaded reports (0169): sent exactly as uploaded, kept for the lab's retention

function Uploads({ businessId }: { businessId: string }) {
  const [rows, setRows] = useState<UploadedReport[] | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<PatientSearchResult[]>([])
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = useCallback(() => { getUploads(businessId).then(setRows).catch(() => setRows([])) }, [businessId])
  useEffect(load, [load])
  useEffect(() => {
    if (patient) return
    const t = setTimeout(() => { searchPatients(q, businessId).then(setFound).catch(() => setFound([])) }, 250)
    return () => clearTimeout(t)
  }, [q, patient, businessId])

  const onFile = async (files: File[]) => {
    if (!patient) { setErr('Choose the patient first.'); return }
    setBusy(true); setErr(''); setMsg('')
    try {
      const up = await uploadReport(files, { businessId, memberId: patient.id, title: title.trim() || files[0].name.replace(/\.[^.]+$/, ''), reportDate: date || null })
      try {
        const r = await sendUpload(up.id)
        setMsg(r.whatsapp ? `Uploaded (${shrunk(up)}) and sent on WhatsApp.` : `Uploaded (${shrunk(up)}). Not sent automatically${r.errors?.length ? ` (${r.errors[0]})` : ''}.`)
      } catch (e2) { setMsg(`Uploaded. Sending failed: ${(e2 as Error).message}`) }
      setTitle(''); setDate(''); setPatient(null); setQ(''); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="card shadow-sm space-y-3">
        <h3 className="font-bold text-navy-700">Upload a report</h3>
        <p className="text-xs text-gray-500">A PDF or photo of the report — from your machine or another lab. Photos of several pages are compressed and joined into one PDF (a 10-page report comes to about 3–5 MB instead of 40+ MB). It goes to the patient on WhatsApp as it is — nothing on the page is changed — and stays here so you can resend it when they ask, until your retention period ends.</p>
        {patient ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm"><b>{patient.name}</b>
            <button className="text-teal-700 text-xs" onClick={() => setPatient(null)}>Change</button></div>
        ) : (
          <div>
            <input className="input-field" value={q} onChange={e => setQ(e.target.value)} placeholder="Find the patient — name, phone or file number" />
            {found.length > 0 && <div className="border border-gray-200 rounded-lg mt-1 divide-y">
              {found.slice(0, 6).map(p => <button key={p.patient_member_id} onClick={() => { setPatient({ id: p.patient_member_id, name: p.full_name }); setFound([]) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50"><b>{p.full_name}</b> · {p.phone}</button>)}
            </div>}
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-2">
          <input className="input-field sm:col-span-2" placeholder="Title (e.g. Thyroid profile)" value={title} onChange={e => setTitle(e.target.value)} />
          <input type="date" className="input-field" value={date} onChange={e => setDate(e.target.value)} title="Report date" />
        </div>
        <label className={`btn-teal text-sm inline-flex items-center gap-2 cursor-pointer ${busy || !patient ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload className="w-4 h-4" /> {busy ? 'Compressing & uploading…' : 'Choose PDF or photos & send'}
          <input type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) onFile(fs) }} />
        </label>
        {msg && <p className="text-sm text-green-700">{msg}</p>}
        <Err msg={err} />
      </div>
      {rows === null ? null : rows.length === 0 ? <div className="card shadow-sm text-sm text-gray-500 py-8 text-center">No uploaded reports yet.</div> : (
        <div className="card shadow-sm p-0 divide-y">
          {rows.map(u => (
            <div key={u.id} className="px-4 py-3 text-sm flex flex-wrap justify-between gap-2">
              <span><b>{u.patient_name}</b> · {u.title}{u.order_no ? ` · ${u.order_no}` : ''}
                <span className="block text-xs text-gray-500">Uploaded {dt(u.created_at)} by {u.uploaded_by_name ?? '—'} · kept until {new Date(u.expires_on).toLocaleDateString('en-IN')}
                  · {u.purged_at ? 'removed (retention ended)' : u.sent_at ? `sent ${dt(u.sent_at)}` : u.send_error ? `not sent: ${u.send_error}` : 'not sent'}</span></span>
              {!u.purged_at && (
                <span className="flex gap-3 text-xs items-center">
                  <a href={`/lab/file/${u.public_token}`} target="_blank" rel="noreferrer" className="text-teal-700">Open</a>
                  <button className="text-teal-700" onClick={async () => { setErr(''); try { const r = await sendUpload(u.id); setMsg(r.whatsapp ? 'Sent on WhatsApp.' : 'Not sent.'); load() } catch (e) { setErr((e as Error).message) } }}>Resend</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tests ───────────────────────────────────────────────────────────────────

const blankParam = (): LabParameter => ({ name: '', unit: '', kind: 'number', ref_low: null, ref_high: null })

function Tests({ businessId, tests, cats, canManage, reload }: { businessId: string; tests: LabTest[]; cats: string[] | null; canManage: boolean; reload: () => void }) {
  const firstCat = (cats?.[0] ?? 'pathology') as LabCategory
  const [edit, setEdit] = useState<{ test: Partial<LabTest>; params: LabParameter[] } | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = async (t: LabTest) => setEdit({ test: t, params: (await getTestParameters(t.id)).map(p => ({ ...p })) })
  const rows = tests.filter(t => !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase()))
  const groups = useMemo(() => Array.from(new Set(rows.map(t => t.category))), [rows])

  const doImport = async () => {
    setBusy(true); setErr(''); setMsg('')
    try { const n = await importCatalogue(businessId); setMsg(n ? `${n} standard tests added — set your own prices.` : 'You already have every standard test.'); reload() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const save = async () => {
    if (!edit) return
    setBusy(true); setErr('')
    try {
      const id = await saveTest(businessId, edit.test, edit.params.filter(p => p.name.trim()))
      await setRepeatDays(id, ((edit.test as { repeat_days?: number | null }).repeat_days) ?? null)
      setEdit(null); reload()
    }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (edit) {
    const t = edit.test
    const setT = (k: keyof LabTest, v: unknown) => setEdit({ ...edit, test: { ...t, [k]: v } })
    const setP = (i: number, k: keyof LabParameter, v: unknown) => setEdit({ ...edit, params: edit.params.map((p, j) => j === i ? { ...p, [k]: v } : p) })
    return (
      <div className="card shadow-sm space-y-3">
        <h3 className="font-bold text-navy-700">{t.id ? 'Edit test' : 'New test'}</h3>
        <div className="grid sm:grid-cols-4 gap-2">
          <input className="input-field sm:col-span-2" placeholder="Test name" value={t.name ?? ''} onChange={e => setT('name', e.target.value)} />
          <select className="input-field" value={t.category ?? firstCat} onChange={e => setT('category', e.target.value)}>
            {([['pathology', 'Pathology'], ['radiology', 'Radiology / imaging'], ['cardiology', 'Cardiology'], ['other', 'Other']] as const)
              .filter(([v]) => testVisible(cats, v) || t.category === v)
              .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="input-field" type="number" min={0} placeholder="Price ₹" value={t.price ?? ''} onChange={e => setT('price', e.target.value)} />
          <input className="input-field" placeholder="Department" value={t.department ?? ''} onChange={e => setT('department', e.target.value)} />
          <input className="input-field" placeholder="Sample (Blood, Urine…)" value={t.sample_type ?? ''} onChange={e => setT('sample_type', e.target.value)} />
          <input className="input-field" type="number" min={0} placeholder="Report in (hours)" value={t.tat_hours ?? ''} onChange={e => setT('tat_hours', e.target.value)} />
          <label className="text-xs text-gray-500">Repeat after (days) — for follow-up reminders; blank = none
            <input className="input-field mt-1" type="number" min={7} max={1095} value={(t as { repeat_days?: number | null }).repeat_days ?? ''}
              onChange={e => setT('repeat_days' as keyof LabTest, e.target.value === '' ? null : Number(e.target.value))} /></label>
          {t.id && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={t.is_active ?? true} onChange={e => setT('is_active', e.target.checked)} /> Offered</label>}
        </div>
        <div className="text-xs font-semibold text-gray-500">Parameters — what the report shows, with the normal range (female range only where it differs)</div>
        {edit.params.map((p, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-8 gap-2 items-center">
            <input className="input-field sm:col-span-2 py-1.5" placeholder="Name" value={p.name} onChange={e => setP(i, 'name', e.target.value)} />
            <select className="input-field py-1.5" value={p.kind} onChange={e => setP(i, 'kind', e.target.value as ParamKind)}>
              <option value="number">Number</option><option value="select">Choice</option><option value="text">Short text</option><option value="long_text">Paragraph</option>
            </select>
            <input className="input-field py-1.5" placeholder="Unit" value={p.unit ?? ''} onChange={e => setP(i, 'unit', e.target.value)} />
            {p.kind === 'number' ? <>
              <input className="input-field py-1.5" placeholder="Low" value={p.ref_low ?? ''} onChange={e => setP(i, 'ref_low', e.target.value === '' ? null : e.target.value)} />
              <input className="input-field py-1.5" placeholder="High" value={p.ref_high ?? ''} onChange={e => setP(i, 'ref_high', e.target.value === '' ? null : e.target.value)} />
              <input className="input-field py-1.5" placeholder="F low" value={p.ref_low_f ?? ''} onChange={e => setP(i, 'ref_low_f', e.target.value === '' ? null : e.target.value)} />
            </> : p.kind === 'select' ? (
              <input className="input-field sm:col-span-3 py-1.5" placeholder="Choices, comma-separated" value={(p.options ?? []).join(', ')}
                onChange={e => setP(i, 'options', e.target.value.split(',').map(x => x.trim()).filter(Boolean))} />
            ) : <input className="input-field sm:col-span-3 py-1.5" placeholder="Normal value (optional)" value={p.ref_text ?? ''} onChange={e => setP(i, 'ref_text', e.target.value)} />}
            <div className="flex gap-1 items-center">
              {p.kind === 'number' && <input className="input-field py-1.5" placeholder="F high" value={p.ref_high_f ?? ''} onChange={e => setP(i, 'ref_high_f', e.target.value === '' ? null : e.target.value)} />}
              <button onClick={() => setEdit({ ...edit, params: edit.params.filter((_, j) => j !== i) })} className="text-gray-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
        <button onClick={() => setEdit({ ...edit, params: [...edit.params, blankParam()] })} className="text-xs text-teal-700 inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Parameter</button>
        <Err msg={err} />
        <div className="flex gap-2 justify-end">
          <button onClick={() => setEdit(null)} className="btn-outline text-sm">Cancel</button>
          <button disabled={busy} onClick={save} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save test'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <input className="input-field max-w-sm" value={q} onChange={e => setQ(e.target.value)} placeholder="Search tests" />
        {canManage && (
          <div className="flex gap-2">
            <button disabled={busy} onClick={doImport} className="btn-outline text-xs py-2 px-3">Load standard tests</button>
            <button onClick={() => setEdit({ test: { category: firstCat, price: 0 }, params: [blankParam()] })} className="btn-teal text-xs py-2 px-4"><Plus className="w-4 h-4" /> Test</button>
          </div>
        )}
      </div>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <Err msg={err} />
      {!tests.length ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">No tests yet.{canManage ? ' "Load standard tests" adds 57 common blood, urine, imaging and cardiology tests with normal ranges — you set the prices.' : ''}</div>
        : groups.map(g => (
          <div key={g} className="card shadow-sm p-0">
            <div className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-gray-500">{g}</div>
            <div className="divide-y">
              {rows.filter(t => t.category === g).map(t => (
                <div key={t.id} className="px-4 py-2.5 text-sm flex justify-between gap-2">
                  <span className={t.is_active ? '' : 'text-gray-400 line-through'}>{t.name}{t.sample_type ? <span className="text-gray-400"> · {t.sample_type}</span> : null}</span>
                  <span className="flex gap-3 items-center">
                    <b>{moneyExact(t.price)}</b>
                    {canManage && <button onClick={() => load(t)} className="text-xs text-teal-700">Edit</button>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}

// ── Packages ────────────────────────────────────────────────────────────────

function Packages({ businessId, tests, packages, canManage, reload }: {
  businessId: string; tests: LabTest[]; packages: LabPackage[]; canManage: boolean; reload: () => void
}) {
  const [edit, setEdit] = useState<{ pkg: Partial<LabPackage>; ids: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!edit) return
    setBusy(true); setErr('')
    try { await savePackage(businessId, edit.pkg, edit.ids); setEdit(null); reload() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (edit) {
    const sum = tests.filter(t => edit.ids.includes(t.id)).reduce((s, t) => s + t.price, 0)
    return (
      <div className="card shadow-sm space-y-3">
        <h3 className="font-bold text-navy-700">{edit.pkg.id ? 'Edit package' : 'New package'}</h3>
        <div className="grid sm:grid-cols-3 gap-2">
          <input className="input-field" placeholder="Package name (e.g. Full Body Checkup)" value={edit.pkg.name ?? ''} onChange={e => setEdit({ ...edit, pkg: { ...edit.pkg, name: e.target.value } })} />
          <input className="input-field" type="number" min={0} placeholder="Package price ₹" value={edit.pkg.price ?? ''} onChange={e => setEdit({ ...edit, pkg: { ...edit.pkg, price: Number(e.target.value) } })} />
          <input className="input-field" placeholder="Short description (optional)" value={edit.pkg.description ?? ''} onChange={e => setEdit({ ...edit, pkg: { ...edit.pkg, description: e.target.value } })} />
        </div>
        <p className="text-xs text-gray-500">Tests chosen: {edit.ids.length} · separately they cost {moneyExact(sum)}{edit.pkg.price ? ` · package saves the patient ${moneyExact(Math.max(0, sum - Number(edit.pkg.price)))}` : ''}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1 max-h-80 overflow-auto border border-gray-100 rounded-lg p-2">
          {tests.filter(t => t.is_active).map(t => (
            <label key={t.id} className="text-sm flex items-center gap-2 py-1">
              <input type="checkbox" checked={edit.ids.includes(t.id)} onChange={e => setEdit({ ...edit, ids: e.target.checked ? [...edit.ids, t.id] : edit.ids.filter(x => x !== t.id) })} />
              {t.name} <span className="text-gray-400">{moneyExact(t.price)}</span>
            </label>
          ))}
        </div>
        {edit.pkg.id && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={edit.pkg.is_active ?? true} onChange={e => setEdit({ ...edit, pkg: { ...edit.pkg, is_active: e.target.checked } })} /> Offered</label>}
        <Err msg={err} />
        <div className="flex gap-2 justify-end">
          <button onClick={() => setEdit(null)} className="btn-outline text-sm">Cancel</button>
          <button disabled={busy} onClick={save} className="btn-teal text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save package'}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {canManage && <div className="flex justify-end"><button disabled={!tests.length} onClick={() => setEdit({ pkg: {}, ids: [] })} className="btn-teal text-xs py-2 px-4"><Plus className="w-4 h-4" /> Package</button></div>}
      {!packages.length ? <div className="card shadow-sm text-sm text-gray-500 py-10 text-center">No packages yet — group tests into a checkup at one price.</div> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {packages.map(p => (
            <div key={p.id} className={`card shadow-sm ${p.is_active ? '' : 'opacity-60'}`}>
              <div className="flex justify-between gap-2"><b className="text-navy-700">{p.name}</b><b>{moneyExact(p.price)}</b></div>
              {p.description && <p className="text-xs text-gray-500 mt-1">{p.description}</p>}
              <p className="text-xs text-gray-600 mt-2">{p.test_ids.map(id => tests.find(t => t.id === id)?.name).filter(Boolean).join(' · ')}</p>
              {canManage && <button onClick={() => setEdit({ pkg: p, ids: p.test_ids })} className="text-xs text-teal-700 mt-2">Edit</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Settings ────────────────────────────────────────────────────────────────

function Settings({ businessId }: { businessId: string }) {
  const [fee, setFee] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { getLabSettings(businessId).then(s => setFee(String(s.homeFee))) }, [businessId])
  return (
    <div className="card shadow-sm space-y-3 max-w-lg">
      <h3 className="font-bold text-navy-700">Lab settings</h3>
      <label className="text-xs text-gray-500 block">Home sample collection fee (₹) — added to the bill of every home collection; can be changed on each order. 0 = free.
        <input type="number" min={0} className="input-field mt-1" value={fee} onChange={e => setFee(e.target.value)} />
      </label>
      <p className="text-xs text-gray-500">Reports are approved by a doctor on your staff — add pathologists and radiologists as doctors (speciality Pathology or Radiology). Lab technicians join with the Nurse role. Reports go to patients on WhatsApp automatically when approved.</p>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <Err msg={err} />
      <button onClick={async () => { setErr(''); try { await saveLabSettings(businessId, Number(fee) || 0); setMsg('Saved.') } catch (e) { setErr((e as Error).message) } }} className="btn-teal text-sm">Save</button>
    </div>
  )
}
