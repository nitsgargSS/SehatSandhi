import { useEffect, useMemo, useState } from 'react'
import IntlRequests from './IntlRequests'
import { Globe2, Upload, FileCheck2, Trash2, Pencil, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  canApply, loadMine, loadDocs, loadMedia, uploadMedia, addYoutube, editMedia, deleteMedia, mediaUrl, MEDIA_CATEGORIES, saveProfile, submitApplication, savePackage, deletePackage, uploadDoc, docUrl,
  type MyHospital, type MyPackage, type Procedure, type CheckState, type IntlDoc, type Missing, type DocEvent, type MediaItem,
} from '../../lib/intlApi'
import { CHECKLIST, AGREEMENT_POINTS, AGREEMENT_VERSION, inr } from '../../lib/intlContent'

// 0312: a hospital applies to receive international patients through
// Sehatsandhi — facts, the A–F checklist with documents, its prices per
// procedure, and the agreement. Owner and manager only (the RPCs check).

const STATUS: Record<MyHospital['status'], { label: string; tone: string; text: string }> = {
  draft: { label: 'Not sent yet', tone: 'bg-gray-100 text-gray-700', text: 'Fill in your details, checklist and prices, then accept the agreement to send for review.' },
  submitted: { label: 'Sent for review', tone: 'bg-amber-50 text-amber-800', text: 'Sehatsandhi will check your documents and book a video walkthrough with you.' },
  reviewing: { label: 'Under review', tone: 'bg-amber-50 text-amber-800', text: 'We are checking your documents and walkthrough.' },
  listed: { label: 'Listed on the portal', tone: 'bg-green-50 text-green-800', text: 'International patients can see your hospital and estimates at sehatsandhi.com/international.' },
  paused: { label: 'Paused', tone: 'bg-red-50 text-red-800', text: 'Your listing is hidden for now. See the note from Sehatsandhi below.' },
  rejected: { label: 'Not approved', tone: 'bg-red-50 text-red-800', text: 'See the note below. You can fix the items and send again.' },
}

const input = 'w-full border rounded-lg px-3 py-2 text-sm'
const csv = (a: string[] | null | undefined) => (a ?? []).join(', ')
const fromCsv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

export default function InternationalPanel({ businessId }: { businessId: string }) {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [h, setH] = useState<MyHospital | null>(null)
  const [pkgs, setPkgs] = useState<MyPackage[]>([])
  const [procs, setProcs] = useState<Procedure[]>([])
  const [fee, setFee] = useState(10)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    nabh: 'none', jci: false, beds: '', icu_beds: '', panels: '', languages: 'English, Hindi', specialities: '',
    about: '', coordinator_name: '', coordinator_phone: '', coordinator_email: '', nearest_airport: '', airport_hours: '',
  })
  const [check, setCheck] = useState<Record<string, CheckState>>({})
  const [signatory, setSignatory] = useState('')
  const [agree, setAgree] = useState(false)
  // 0313: documents are their own records; readiness comes from the database.
  const [docs, setDocs] = useState<IntlDoc[]>([])
  const [forSubmit, setForSubmit] = useState<Missing[]>([])
  const [forList, setForList] = useState<Missing[]>([])
  const [events, setEvents] = useState<DocEvent[]>([])
  const [expiry, setExpiry] = useState<Record<string, string>>({})

  const reload = async () => {
    try {
      const [r, d] = await Promise.all([loadMine(businessId), loadDocs(businessId)])
      setH(r.hospital); setPkgs(r.packages); setProcs(r.procedures)
      setDocs(d.docs); setForSubmit(d.forSubmit); setForList(d.forList); setEvents(d.events)
      const x = r.hospital
      if (x) {
        setForm({
          nabh: x.nabh, jci: x.jci, beds: x.beds?.toString() ?? '', icu_beds: x.icu_beds?.toString() ?? '',
          panels: csv(x.panels), languages: csv(x.languages), specialities: csv(x.specialities), about: x.about ?? '',
          coordinator_name: x.coordinator_name ?? '', coordinator_phone: x.coordinator_phone ?? '', coordinator_email: x.coordinator_email ?? '',
          nearest_airport: x.nearest_airport ?? '', airport_hours: x.airport_hours?.toString() ?? '',
        })
        setCheck(x.checklist ?? {})
        setSignatory(x.agreement_signatory ?? '')
      }
    } catch (e) { setErr((e as Error).message) }
  }
  useEffect(() => {
    canApply(businessId).then(ok => { setAllowed(ok); if (ok) reload() })
    supabase.rpc('sehat_intl_fee_pct').then(({ data }) => { if (data != null) setFee(Number(data)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  const payload = (c: Record<string, CheckState> = check) => ({
    nabh: form.nabh, jci: form.jci, beds: form.beds, icu_beds: form.icu_beds,
    panels: fromCsv(form.panels), languages: fromCsv(form.languages), specialities: fromCsv(form.specialities),
    about: form.about, coordinator_name: form.coordinator_name, coordinator_phone: form.coordinator_phone,
    coordinator_email: form.coordinator_email, nearest_airport: form.nearest_airport, airport_hours: form.airport_hours, checklist: c,
  })
  const save = async (c?: Record<string, CheckState>, quiet = false) => {
    setBusy(true); setErr(''); setMsg('')
    try { await saveProfile(businessId, payload(c)); if (!quiet) setMsg('Saved.'); await reload() }
    catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const setItem = (k: string, v: Partial<CheckState>) => setCheck(c => ({ ...c, [k]: { ...c[k], ...v } }))
  const upload = async (k: string, needsExpiry: boolean, file: File) => {
    if (file.size > 10 * 1024 * 1024) { setErr('Files up to 10 MB, please.'); return }
    if (needsExpiry && !expiry[k]) { setErr('Enter the expiry date first, then upload.'); return }
    setBusy(true); setErr(''); setMsg('')
    try {
      // Save the rest of the form first, so ticks are not lost on reload.
      await saveProfile(businessId, payload())
      await uploadDoc(businessId, k, file, expiry[k] || null)
      setExpiry(x => ({ ...x, [k]: '' }))
      setMsg('Document uploaded. Sehatsandhi will check it.')
      await reload()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const current = (k: string) => docs.find(d => d.item_key === k && d.status !== 'replaced')
  const older = (k: string) => docs.filter(d => d.item_key === k && d.status === 'replaced').length
  const open = async (path: string) => { const u = await docUrl(path); if (u) window.open(u, '_blank', 'noopener') }

  // Live for ticks being edited; the database's own check decides on save.
  const progress = useMemo(() => CHECKLIST.map(g => {
    const req = g.items.filter(i => !i.optional)
    const done = req.filter(i => (i.doc || i.media) ? !forSubmit.some(m => m.key === i.key) : !!check[i.key]?.ok).length
    return { key: g.key, done, total: req.length }
  }), [check, forSubmit])
  const missingRequired = progress.reduce((n, p) => n + (p.total - p.done), 0)

  const submit = async () => {
    if (!agree) { setErr('Tick that you accept the agreement.'); return }
    setBusy(true); setErr('')
    try {
      await saveProfile(businessId, payload())
      await submitApplication(businessId, signatory, AGREEMENT_VERSION)
      setMsg('Sent to Sehatsandhi for review. We will contact your coordinator to book the video walkthrough.')
      await reload()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  if (allowed === null) return <p className="text-gray-500 p-4">Loading…</p>
  if (!allowed) return (
    <div className="card max-w-2xl">
      <h2 className="text-lg font-bold text-navy-700 flex items-center gap-2"><Globe2 className="w-5 h-5" /> International patients</h2>
      <p className="mt-2 text-gray-600">Sehatsandhi International is for hospitals with in-patient beds (IPD), an ICU and an international patient desk. If you run in-patient beds, ask Sehatsandhi to switch on IPD for your account first.</p>
    </div>
  )

  const st = STATUS[h?.status ?? 'draft']
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="card">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-navy-700 flex items-center gap-2"><Globe2 className="w-5 h-5" /> International patients</h2>
            <p className="text-gray-600 text-sm mt-1">Free to join. Patients from abroad compare hospitals across India; Sehatsandhi handles their travel and every quote goes through us. Patients see your price plus Sehatsandhi’s {fee}% service fee.</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${st.tone}`}>{st.label}{h?.star ? ` · ${h.star}-star` : ''}</span>
        </div>
        <p className="mt-3 text-sm text-gray-700">{st.text}</p>
        {h && h.status !== 'draft' && forList.length > 0 && (
          <p className="mt-2 text-sm text-gray-600">Before your listing can open: {forList.length} {forList.length === 1 ? 'item' : 'items'} still {forList.every(m => m.why.startsWith('Waiting')) ? 'waiting for Sehatsandhi to check' : 'need attention — see the checklist'}.</p>
        )}
        {h?.admin_note && <p className="mt-2 text-sm bg-amber-50 text-amber-900 rounded-lg p-3"><b>Note from Sehatsandhi:</b> {h.admin_note}</p>}
        {h?.status === 'listed' && <a href="/international/hospitals" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 text-sm text-teal-700 font-semibold">See the portal <ExternalLink className="w-4 h-4" /></a>}
      </div>

      {(err || msg) && <p className={`rounded-lg px-3 py-2 text-sm ${err ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>{err || msg}</p>}

      {/* 0325: requests Sehatsandhi has sent, and the hospital's quotes. */}
      {h && (h.status === 'listed' || h.status === 'paused') && <IntlRequests businessId={businessId} fee={fee} />}

      {/* 1. Facts */}
      <div className="card">
        <h3 className="font-bold text-navy-700 mb-1">1. Your hospital</h3>
        <p className="text-sm text-gray-500 mb-4">Facts patients see. We check them against your documents.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <label>NABH
            <select value={form.nabh} onChange={e => setForm({ ...form, nabh: e.target.value })} className={input}>
              <option value="full">Full accreditation</option><option value="entry">Entry-level</option><option value="applied">Applied (full)</option><option value="none">None</option>
            </select></label>
          <label>Beds<input inputMode="numeric" value={form.beds} onChange={e => setForm({ ...form, beds: e.target.value.replace(/\D/g, '') })} className={input} /></label>
          <label>ICU beds<input inputMode="numeric" value={form.icu_beds} onChange={e => setForm({ ...form, icu_beds: e.target.value.replace(/\D/g, '') })} className={input} /></label>
          <label className="sm:col-span-2">Government and insurance panels (comma separated)<input value={form.panels} onChange={e => setForm({ ...form, panels: e.target.value })} placeholder="CGHS, ECHS, Ayushman Bharat" className={input} /></label>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={form.jci} onChange={e => setForm({ ...form, jci: e.target.checked })} /> JCI accredited</label>
          <label className="sm:col-span-2">Specialities for international patients<input value={form.specialities} onChange={e => setForm({ ...form, specialities: e.target.value })} placeholder="Orthopaedics, Eye, General surgery" className={input} /></label>
          <label>Languages at the desk<input value={form.languages} onChange={e => setForm({ ...form, languages: e.target.value })} className={input} /></label>
          <label>Nearest international airport<input value={form.nearest_airport} onChange={e => setForm({ ...form, nearest_airport: e.target.value })} placeholder="Chandigarh (IXC)" className={input} /></label>
          <label>Hours by road from the airport<input inputMode="decimal" value={form.airport_hours} onChange={e => setForm({ ...form, airport_hours: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="2" className={input} /></label>
          <label className="sm:col-span-2 lg:col-span-3">About the hospital (facts only — no “best”, no testimonials)
            <textarea rows={3} value={form.about} onChange={e => setForm({ ...form, about: e.target.value })} className={input} /></label>
        </div>
        <h4 className="font-semibold text-navy-700 mt-5 mb-2 text-sm">International patient coordinator</h4>
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <label>Name<input value={form.coordinator_name} onChange={e => setForm({ ...form, coordinator_name: e.target.value })} className={input} /></label>
          <label>WhatsApp<input value={form.coordinator_phone} onChange={e => setForm({ ...form, coordinator_phone: e.target.value })} className={input} /></label>
          <label>Email<input value={form.coordinator_email} onChange={e => setForm({ ...form, coordinator_email: e.target.value })} className={input} /></label>
        </div>
        <p className="text-xs text-gray-500 mt-2">Only Sehatsandhi sees your coordinator’s contact. Patients reach you through us.</p>
        <button onClick={() => save()} disabled={busy} className="btn-teal !px-5 !py-2 text-sm mt-4">Save details</button>
      </div>

      {/* 2. Checklist */}
      <div className="card">
        <h3 className="font-bold text-navy-700 mb-1">2. Checklist and documents</h3>
        <p className="text-sm text-gray-500 mb-4">
          {missingRequired === 0 ? 'Every required item is done.' : `${missingRequired} required ${missingRequired === 1 ? 'item' : 'items'} left.`} Tick what you have, and upload each document with its expiry date (PDF or photo, up to 10 MB). Every upload is kept; Sehatsandhi checks each one.
        </p>
        <div className="space-y-5">
          {CHECKLIST.map(g => {
            const pr = progress.find(p => p.key === g.key)!
            return (
              <details key={g.key} className="border rounded-xl" open={g.key === 'A'}>
                <summary className="px-4 py-3 cursor-pointer flex items-center justify-between gap-3">
                  <span className="font-semibold text-navy-700">{g.title}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${pr.done === pr.total ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{pr.done}/{pr.total} required</span>
                </summary>
                <div className="px-4 pb-4">
                  <p className="text-xs text-gray-500 mb-3">{g.note}</p>
                  <ul className="divide-y">
                    {g.items.map(i => {
                      const s = check[i.key] ?? {}
                      const d = i.doc ? current(i.key) : undefined
                      const miss = forSubmit.find(m => m.key === i.key)
                      const tone = !d ? '' : d.status === 'verified' ? 'bg-green-50 text-green-700' : d.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
                      const word = !d ? '' : d.status === 'verified' ? 'Checked' : d.status === 'rejected' ? 'Rejected' : 'Waiting for check'
                      return (
                        <li key={i.key} className="py-3 text-sm">
                          <div className="grid gap-2 md:grid-cols-[1fr_auto] items-start">
                            {i.media ? (
                              <div>
                                <p><b className="text-navy-700">{i.key}</b> {i.label}</p>
                                {miss ? <p className="mt-1 text-xs text-amber-700">{miss.why}. Add them in “Photos and videos” below.</p>
                                  : forList.some(m => m.key === i.key) ? <p className="mt-1 text-xs text-amber-700">{forList.find(m => m.key === i.key)!.why}</p>
                                  : <p className="mt-1 text-xs text-green-700">Done — photos approved.</p>}
                              </div>
                            ) : i.doc ? (
                              <div>
                                <p><b className="text-navy-700">{i.key}</b> {i.label}{i.optional && <span className="text-gray-400"> (if it applies)</span>}</p>
                                {d && (
                                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                    <span className={`rounded-full px-2 py-0.5 font-semibold ${tone}`}>{word}</span>
                                    <span className="text-gray-500">{d.file_name ?? 'file'}{d.expires ? ` · expires ${d.expires}` : ''} · uploaded {new Date(d.uploaded_at).toLocaleDateString('en-IN')}</span>
                                    <button onClick={() => open(d.path)} className="inline-flex items-center gap-1 text-teal-700 font-semibold"><FileCheck2 className="w-3.5 h-3.5" /> View</button>
                                    {older(i.key) > 0 && <span className="text-gray-400">{older(i.key)} earlier version(s) kept</span>}
                                  </p>
                                )}
                                {d?.status === 'rejected' && d.reason && <p className="mt-1 text-xs text-red-700">Reason: {d.reason}. Please upload a corrected document.</p>}
                                {!i.optional && miss && !d && <p className="mt-1 text-xs text-amber-700">{miss.why}</p>}
                                {!i.optional && miss && d && d.status !== 'rejected' && <p className="mt-1 text-xs text-amber-700">{miss.why}</p>}
                              </div>
                            ) : (
                              <label className="flex gap-2 items-start">
                                <input type="checkbox" className="mt-1" checked={!!s.ok} onChange={e => setItem(i.key, { ok: e.target.checked })} />
                                <span><b className="text-navy-700">{i.key}</b> {i.label}{i.optional && <span className="text-gray-400"> (if it applies)</span>}</span>
                              </label>
                            )}
                            {i.doc && (
                              <div className="flex items-center gap-2 flex-wrap md:justify-end">
                                {i.expires && (
                                  <label className="text-xs text-gray-500 flex items-center gap-1">Expires
                                    <input type="date" value={expiry[i.key] ?? ''} min={new Date().toISOString().slice(0, 10)}
                                      onChange={e => setExpiry(x => ({ ...x, [i.key]: e.target.value }))} className="border rounded-lg px-2 py-1 text-xs" />
                                  </label>
                                )}
                                <label className={`inline-flex items-center gap-1 text-xs font-semibold border rounded-lg px-2 py-1 ${busy || (i.expires && !expiry[i.key]) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer text-navy-700'}`}
                                  title={i.expires && !expiry[i.key] ? 'Enter the expiry date first' : undefined}>
                                  <Upload className="w-3.5 h-3.5" /> {d ? 'Upload new' : 'Upload'}
                                  <input type="file" accept=".pdf,image/*" className="hidden" disabled={busy || (!!i.expires && !expiry[i.key])}
                                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(i.key, !!i.expires, f); e.target.value = '' }} />
                                </label>
                              </div>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </details>
            )
          })}
        </div>
        <button onClick={() => save()} disabled={busy} className="btn-teal !px-5 !py-2 text-sm mt-4">Save ticks</button>
        {events.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-navy-700 font-semibold">History ({events.length})</summary>
            <ul className="mt-2 divide-y">
              {events.slice(0, 50).map(e => (
                <li key={e.id} className="py-1.5 flex gap-3"><span className="text-gray-400 whitespace-nowrap">{new Date(e.at).toLocaleString('en-IN')}</span>
                  <span>{e.item_key ? <b>{e.item_key} </b> : null}{e.action.replace('_', ' ')}{e.note ? ` — ${e.note}` : ''}<span className="text-gray-400"> · {e.actor_name}</span></span></li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* 3. Photos and videos */}
      <MediaSection businessId={businessId} hasProfile={!!h} onChange={reload} />

      {/* 4. Prices */}
      <PackagesSection businessId={businessId} procs={procs} pkgs={pkgs} fee={fee} hasProfile={!!h} onChange={reload} />

      {/* 4. Agreement */}
      <div className="card">
        <h3 className="font-bold text-navy-700 mb-1">5. Agreement</h3>
        {h?.agreement_accepted_at ? (
          <p className="text-sm text-green-800 bg-green-50 rounded-lg p-3 flex gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5" /> Accepted by {h.agreement_signatory} on {new Date(h.agreement_accepted_at).toLocaleDateString('en-IN')} ({h.agreement_version}).</p>
        ) : <p className="text-sm text-gray-500 mb-3">Read and accept to send your application. Your listing opens only after Sehatsandhi checks your documents and video walkthrough.</p>}
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-700 mt-3">{AGREEMENT_POINTS.map(p => <li key={p}>{p}</li>)}</ol>
        {(!h?.agreement_accepted_at || h.status === 'rejected') && (
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] items-end text-sm">
            <label>Full name of the person accepting (owner or authorised signatory)
              <input value={signatory} onChange={e => setSignatory(e.target.value)} className={input} /></label>
            <span />
            <label className="flex gap-2 items-start sm:col-span-2"><input type="checkbox" className="mt-1" checked={agree} onChange={e => setAgree(e.target.checked)} />
              I accept these terms on behalf of the hospital and confirm the details and documents above are true.</label>
            {forSubmit.length > 0 && (
              <div className="sm:col-span-2 text-amber-900 bg-amber-50 rounded-lg p-3">
                <p className="flex gap-2 font-semibold"><AlertTriangle className="w-4 h-4 mt-0.5" /> {forSubmit.length} required {forSubmit.length === 1 ? 'item' : 'items'} to finish before you can send (after saving):</p>
                <ul className="mt-1 ml-6 list-disc">{forSubmit.slice(0, 8).map(m => <li key={m.key}><b>{m.key}</b> — {m.why}</li>)}</ul>
                {forSubmit.length > 8 && <p className="ml-6">and {forSubmit.length - 8} more</p>}
              </div>
            )}
            <button onClick={submit} disabled={busy || forSubmit.length > 0} className="btn-teal !px-5 !py-2 text-sm sm:col-span-2 justify-self-start disabled:opacity-50">Accept and send for review</button>
          </div>
        )}
      </div>
    </div>
  )
}

const EMPTY = { procedure_code: '', price_min: '', price_max: '', room_type: 'Single private room', included: '', excluded: '', hospital_days: '', india_days: '', fly_after_days: '', doctor_name: '', notes: '', valid_until: '', active: true }

function PackagesSection({ businessId, procs, pkgs, fee, hasProfile, onChange }: {
  businessId: string; procs: Procedure[]; pkgs: MyPackage[]; fee: number; hasProfile: boolean; onChange: () => Promise<void>
}) {
  const [f, setF] = useState<typeof EMPTY>(EMPTY)
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const name = (c: string) => procs.find(p => p.code === c)?.name ?? c
  const shown = (n: number) => inr(Math.ceil(n * (1 + fee / 100) / 100) * 100)
  const edit = (p: MyPackage) => {
    setF({
      procedure_code: p.procedure_code, price_min: String(p.price_min), price_max: String(p.price_max), room_type: p.room_type ?? '',
      included: p.included ?? '', excluded: p.excluded ?? '', hospital_days: p.hospital_days?.toString() ?? '', india_days: p.india_days?.toString() ?? '',
      fly_after_days: p.fly_after_days?.toString() ?? '', doctor_name: p.doctor_name ?? '', notes: p.notes ?? '', valid_until: p.valid_until, active: p.active,
    }); setEditing(true)
  }
  const pick = (c: string) => {
    const p = procs.find(x => x.code === c)
    setF(v => ({ ...v, procedure_code: c, hospital_days: v.hospital_days || (p?.hospital_days?.toString() ?? ''), india_days: v.india_days || (p?.india_days?.toString() ?? '') }))
  }
  const save = async () => {
    setBusy(true); setErr('')
    try { await savePackage(businessId, f); setF(EMPTY); setEditing(false); await onChange() } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const remove = async (p: MyPackage) => {
    if (!window.confirm(`Remove the price for ${name(p.procedure_code)}?`)) return
    try { await deletePackage(businessId, p.id); await onChange() } catch (e) { setErr((e as Error).message) }
  }
  const n = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') })
  const t = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="card">
      <h3 className="font-bold text-navy-700 mb-1">4. Prices per procedure</h3>
      <p className="text-sm text-gray-500 mb-4">Your rough package price in rupees — the same as your own international rate. Patients see it plus Sehatsandhi’s {fee}% fee, marked as an estimate. A price older than its valid-until date is hidden until you update it.</p>
      {!hasProfile && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-2 mb-3">Save your hospital details (step 1) first.</p>}
      {pkgs.length > 0 && (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500"><tr><th className="py-2">Procedure</th><th>Your price</th><th>Patients see</th><th>Days</th><th>Valid until</th><th /></tr></thead>
            <tbody className="divide-y">
              {pkgs.map(p => {
                const old = p.valid_until < today
                return (
                  <tr key={p.id} className={!p.active || old ? 'text-gray-400' : ''}>
                    <td className="py-2 font-medium">{name(p.procedure_code)}{!p.active && ' (hidden)'}</td>
                    <td>{inr(p.price_min)}{p.price_max !== p.price_min ? ` – ${inr(p.price_max)}` : ''}</td>
                    <td>{shown(p.price_min)}{p.price_max !== p.price_min ? ` – ${shown(p.price_max)}` : ''}</td>
                    <td>{p.hospital_days ?? '–'} / {p.india_days ?? '–'}</td>
                    <td className={old ? 'text-red-600' : ''}>{p.valid_until}{old ? ' (expired)' : ''}</td>
                    <td className="text-right whitespace-nowrap">
                      <button onClick={() => edit(p)} className="p-1 text-navy-700" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => remove(p)} className="p-1 text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {!editing ? (
        <button onClick={() => { setF(EMPTY); setEditing(true) }} disabled={!hasProfile} className="btn-outline text-sm">Add a procedure price</button>
      ) : (
        <div className="border rounded-xl p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <label className="sm:col-span-2">Procedure
            <select value={f.procedure_code} onChange={e => pick(e.target.value)} className={input}>
              <option value="">Choose…</option>
              {procs.map(p => <option key={p.code} value={p.code}>{p.speciality} · {p.name}</option>)}
            </select></label>
          <label>Lowest price (₹)<input inputMode="numeric" value={f.price_min} onChange={n('price_min')} className={input} /></label>
          <label>Highest price (₹)<input inputMode="numeric" value={f.price_max} onChange={n('price_max')} className={input} /></label>
          <label>Room type<input value={f.room_type} onChange={t('room_type')} className={input} /></label>
          <label>Days in hospital<input inputMode="numeric" value={f.hospital_days} onChange={n('hospital_days')} className={input} /></label>
          <label>Days in India<input inputMode="numeric" value={f.india_days} onChange={n('india_days')} className={input} /></label>
          <label>Safe to fly after (days)<input inputMode="numeric" value={f.fly_after_days} onChange={n('fly_after_days')} className={input} /></label>
          <label className="sm:col-span-2">Included<textarea rows={2} value={f.included} onChange={t('included')} placeholder="Surgeon, anaesthesia, OT, medicines, routine tests, implant (Indian), one follow-up" className={input} /></label>
          <label className="sm:col-span-2">Not included<textarea rows={2} value={f.excluded} onChange={t('excluded')} placeholder="Extra days, blood, other conditions, companion's food" className={input} /></label>
          <label>Doctor (optional)<input value={f.doctor_name} onChange={t('doctor_name')} className={input} /></label>
          <label>Valid until<input type="date" value={f.valid_until} min={today} onChange={t('valid_until')} className={input} /></label>
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Show to patients</label>
          {f.price_min && <p className="lg:col-span-4 text-gray-600">Patients will see <b>{shown(Number(f.price_min))}{f.price_max && f.price_max !== f.price_min ? ` – ${shown(Number(f.price_max))}` : ''}</b> (includes Sehatsandhi’s fee). Valid 6 months if no date is given.</p>}
          {err && <p className="lg:col-span-4 text-red-700">{err}</p>}
          <div className="lg:col-span-4 flex gap-2">
            <button onClick={save} disabled={busy || !f.procedure_code} className="btn-teal !px-5 !py-2 text-sm">Save price</button>
            <button onClick={() => { setEditing(false); setErr('') }} className="btn-outline text-sm">Cancel</button>
          </div>
        </div>
      )}
      {err && !editing && <p className="text-red-700 text-sm mt-2">{err}</p>}
    </div>
  )
}

// 0317: the hospital's photos and videos. Each waits for Sehatsandhi's check;
// once approved it shows on the hospital's page on the portal straight away.
function MediaSection({ businessId, hasProfile, onChange }: { businessId: string; hasProfile: boolean; onChange: () => Promise<void> }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [cat, setCat] = useState('rooms')
  const [caption, setCaption] = useState('')
  const [yt, setYt] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => loadMedia(businessId).then(setItems, e => setErr(e.message))
  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])
  const after = async (m: string) => { setMsg(m); setCaption(''); await load(); await onChange() }
  const upload = async (files: FileList) => {
    setErr(''); setMsg('')
    let n = 0
    for (const f of Array.from(files)) {
      setBusy(`Uploading ${f.name}…`)
      try { await uploadMedia(businessId, f, cat, caption); n++ } catch (e) { setErr(`${f.name}: ${(e as Error).message}`); break }
    }
    setBusy('')
    if (n) await after(`${n} uploaded. Sehatsandhi will check ${n === 1 ? 'it' : 'them'}; approved ones show on your page straight away.`)
  }
  const addYt = async () => {
    setErr(''); setBusy('Adding…')
    try { await addYoutube(businessId, yt, cat === 'rooms' ? 'tour' : cat, caption); setYt(''); await after('Video added. Sehatsandhi will check it.') } catch (e) { setErr((e as Error).message) }
    setBusy('')
  }
  const remove = async (m: MediaItem) => {
    if (!window.confirm('Remove this from your page?')) return
    try { await deleteMedia(businessId, m.id); await load(); await onChange() } catch (e) { setErr((e as Error).message) }
  }
  const move = async (m: MediaItem, d: number) => {
    const i = items.findIndex(x => x.id === m.id), j = i + d
    if (j < 0 || j >= items.length) return
    const other = items[j]
    try {
      await editMedia(businessId, m.id, m.category, m.caption ?? '', other.sort)
      await editMedia(businessId, other.id, other.category, other.caption ?? '', m.sort === other.sort ? m.sort + d : m.sort)
      await load()
    } catch (e) { setErr((e as Error).message) }
  }
  const photos = items.filter(i => i.kind === 'photo')
  const tone = { pending: 'bg-amber-50 text-amber-800', approved: 'bg-green-50 text-green-700', rejected: 'bg-red-50 text-red-700' }
  const word = { pending: 'Waiting for check', approved: 'On your page', rejected: 'Not accepted' }
  return (
    <div className="card">
      <h3 className="font-bold text-navy-700 mb-1">3. Photos and videos</h3>
      <p className="text-sm text-gray-500 mb-3">Patients decide with their eyes. Show real, recent photos of <b>this</b> hospital: the building, a patient room, the ICU, the operation theatre, equipment, food and the family lounge. At least 5 photos are needed (item G1). The first approved photo is your cover picture.</p>
      <ul className="text-xs text-gray-600 mb-4 list-disc ml-5 space-y-0.5">
        <li>Photos: JPG or PNG, up to 15 MB, at least 800 pixels wide — we resize them for fast loading.</li>
        <li>Videos: MP4, up to 50 MB. For a longer tour, upload it to YouTube and paste the link.</li>
        <li>No patients who can be recognised, no before/after pictures, no testimonials or “best” claims (NMC rules).</li>
      </ul>
      {!hasProfile && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-2 mb-3">Save your hospital details (step 1) first.</p>}
      <div className="grid gap-3 sm:grid-cols-[auto_1fr] items-end text-sm border rounded-xl p-3">
        <label>What it shows
          <select value={cat} onChange={e => setCat(e.target.value)} className={input}>
            {Object.entries(MEDIA_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label>Caption (optional)<input value={caption} onChange={e => setCaption(e.target.value)} maxLength={160} placeholder="e.g. Deluxe room with companion sofa-bed" className={input} /></label>
        <div className="sm:col-span-2 flex flex-wrap gap-2 items-center">
          <label className={`inline-flex items-center gap-1 font-semibold border rounded-lg px-3 py-1.5 ${!hasProfile || busy ? 'opacity-50' : 'cursor-pointer text-navy-700'}`}>
            <Upload className="w-4 h-4" /> Upload photos or a video
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" className="hidden" disabled={!hasProfile || !!busy}
              onChange={e => { if (e.target.files?.length) upload(e.target.files); e.target.value = '' }} />
          </label>
          <span className="text-gray-400">or</span>
          <input value={yt} onChange={e => setYt(e.target.value)} placeholder="YouTube link" className="border rounded-lg px-3 py-1.5 flex-1 min-w-[180px]" />
          <button onClick={addYt} disabled={!hasProfile || !yt || !!busy} className="btn-outline text-sm !py-1.5">Add video link</button>
        </div>
        {busy && <p className="sm:col-span-2 text-gray-600">{busy}</p>}
        {err && <p className="sm:col-span-2 text-red-700">{err}</p>}
        {msg && <p className="sm:col-span-2 text-green-700">{msg}</p>}
      </div>
      <p className="text-sm text-gray-600 mt-3">{photos.filter(p => p.status === 'approved').length} photo(s) on your page · {items.filter(i => i.status === 'pending').length} waiting for check</p>
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
          {items.map((m, n) => (
            <div key={m.id} className="border rounded-xl overflow-hidden text-xs">
              <div className="aspect-[4/3] bg-gray-100 relative">
                {m.kind === 'photo' && m.path && <img src={mediaUrl(m.path)} alt="" className="w-full h-full object-cover" loading="lazy" />}
                {m.kind === 'video' && m.path && <video src={mediaUrl(m.path)} className="w-full h-full object-cover" muted preload="metadata" />}
                {m.kind === 'youtube' && <img src={`https://img.youtube.com/vi/${m.youtube_id}/hqdefault.jpg`} alt="" className="w-full h-full object-cover" />}
                {m.kind !== 'photo' && <span className="absolute left-2 top-2 rounded bg-black/70 text-white px-1.5 py-0.5">{m.kind === 'youtube' ? 'YouTube' : 'Video'}</span>}
                {n === 0 && m.kind === 'photo' && <span className="absolute right-2 top-2 rounded bg-white/90 text-navy-700 px-1.5 py-0.5 font-semibold">Cover</span>}
              </div>
              <div className="p-2 space-y-1">
                <p className="font-semibold">{MEDIA_CATEGORIES[m.category] ?? m.category}{m.caption ? ` · ${m.caption}` : ''}</p>
                <span className={`inline-block rounded-full px-2 py-0.5 font-semibold ${tone[m.status]}`}>{word[m.status]}</span>
                {m.status === 'rejected' && m.reason && <p className="text-red-700">{m.reason}</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => move(m, -1)} disabled={n === 0} className="underline disabled:opacity-30">← Earlier</button>
                  <button onClick={() => move(m, 1)} disabled={n === items.length - 1} className="underline disabled:opacity-30">Later →</button>
                  <button onClick={() => remove(m)} className="ml-auto text-red-700 underline">Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
