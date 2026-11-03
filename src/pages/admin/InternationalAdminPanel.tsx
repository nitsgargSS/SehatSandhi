import { useEffect, useState } from 'react'
import { Globe2, FileCheck2, MessageCircle, RefreshCw } from 'lucide-react'
import { adminLoad, adminReview, adminEnquiry, adminSettings, docUrl, loadCatalogue, type AdminEnquiry, type MyHospital } from '../../lib/intlApi'
import { CHECKLIST, STEPS, CURRENCIES } from '../../lib/intlContent'
import { supabase } from '../../lib/supabase'

// 0312: review hospital applications (documents, video walkthrough, star and
// city level, list/pause) and look after patient requests.

type Loaded = Awaited<ReturnType<typeof adminLoad>>
const ENQ_STATUS = [...STEPS.map(s => s.key), 'closed', 'cancelled']

export default function InternationalAdminPanel({ isManager }: { isManager: boolean }) {
  const [d, setD] = useState<Loaded | null>(null)
  const [view, setView] = useState<'enquiries' | 'hospitals' | 'settings'>('enquiries')
  const [err, setErr] = useState('')
  const load = () => adminLoad().then(setD, e => setErr(e.message))
  useEffect(() => { load() }, [])
  if (err) return <p className="text-red-700">{err}</p>
  if (!d) return <p className="text-gray-500">Loading…</p>
  const newEnq = d.enquiries.filter(e => e.status === 'new').length
  const toReview = d.hospitals.filter(h => h.status === 'submitted' || h.status === 'reviewing').length
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xl font-bold text-navy-700 flex items-center gap-2 mr-4"><Globe2 className="w-5 h-5" /> International</h2>
        {([['enquiries', `Patient requests${newEnq ? ` (${newEnq} new)` : ''}`], ['hospitals', `Hospitals${toReview ? ` (${toReview} to review)` : ''}`], ...(!isManager ? [['settings', 'Fee & currency']] : [])] as [typeof view, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-full text-sm ${view === k ? 'bg-navy-700 text-white' : 'bg-white border'}`}>{l}</button>
        ))}
        <button onClick={load} className="ml-auto p-2" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
        <a href="/international" target="_blank" rel="noreferrer" className="text-sm text-teal-700 font-semibold">Open portal ↗</a>
      </div>
      {view === 'enquiries' && <Enquiries d={d} onChange={load} />}
      {view === 'hospitals' && <Hospitals d={d} onChange={load} isManager={isManager} />}
      {view === 'settings' && !isManager && <Settings />}
    </div>
  )
}

function Enquiries({ d, onChange }: { d: Loaded; onChange: () => void }) {
  const name = (id: string) => d.hospitals.find(h => h.business_id === id)?.businesses?.name ?? id.slice(0, 8)
  if (!d.enquiries.length) return <div className="card text-gray-500">No patient requests yet.</div>
  return <div className="space-y-3">{d.enquiries.map(e => <EnquiryRow key={e.id} e={e} name={name} onChange={onChange} />)}</div>
}

function EnquiryRow({ e, name, onChange }: { e: AdminEnquiry; name: (id: string) => string; onChange: () => void }) {
  const [status, setStatus] = useState(e.status)
  const [coord, setCoord] = useState(e.coordinator ?? '')
  const [note, setNote] = useState(e.admin_note ?? '')
  const [chosen, setChosen] = useState(e.chosen_hospital ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true); setErr('')
    try { await adminEnquiry(e.id, status, coord, note, chosen || null); onChange() } catch (x) { setErr((x as Error).message) }
    setBusy(false)
  }
  const wa = e.phone ? `https://wa.me/${e.phone.replace(/[^0-9]/g, '')}` : null
  const prefs = e.prefs as Record<string, string>
  return (
    <div className="card !p-4 text-sm">
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div>
          <p className="font-semibold text-navy-700 text-base">{e.name} {e.country && <span className="text-gray-500 font-normal">· {e.country}</span>}</p>
          <p className="text-gray-600">{e.procedure_code ?? 'Not sure'}{e.urgency ? ` · ${e.urgency}` : ''}{e.travel_when ? ` · travel ${e.travel_when}` : ''} · {e.companions ?? 0} companion(s){e.budget ? ` · budget ${e.budget}` : ''}</p>
          {e.problem && <p className="mt-1 text-gray-800 whitespace-pre-wrap">{e.problem}</p>}
          {e.shortlist.length > 0 && <p className="mt-1">Shortlist: {e.shortlist.map(name).join(', ')}</p>}
          {prefs && (prefs.language || prefs.food) && <p className="text-gray-500">Prefers: {[prefs.language, prefs.food].filter(Boolean).join(', ')}</p>}
          <p className="text-gray-400 mt-1">{new Date(e.created_at).toLocaleString('en-IN')} · tracker /international/track/{e.token}</p>
        </div>
        <div className="flex gap-2 items-center">
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-green-700 font-semibold"><MessageCircle className="w-4 h-4" /> {e.phone}</a>}
          {e.email && <a href={`mailto:${e.email}`} className="text-navy-700 underline">{e.email}</a>}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4 items-end">
        <label>Status<select value={status} onChange={x => setStatus(x.target.value)} className="w-full border rounded-lg px-2 py-1.5">
          {ENQ_STATUS.map(s => <option key={s} value={s}>{STEPS.find(x => x.key === s)?.label ?? s}</option>)}</select></label>
        <label>Coordinator<input value={coord} onChange={x => setCoord(x.target.value)} className="w-full border rounded-lg px-2 py-1.5" /></label>
        <label>Chosen hospital<select value={chosen} onChange={x => setChosen(x.target.value)} className="w-full border rounded-lg px-2 py-1.5">
          <option value="">—</option>{e.shortlist.map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>
        <button onClick={save} disabled={busy} className="btn-teal !px-4 !py-1.5 text-sm justify-center">Save</button>
        <label className="sm:col-span-4">Note (team only)<input value={note} onChange={x => setNote(x.target.value)} className="w-full border rounded-lg px-2 py-1.5" /></label>
      </div>
      {err && <p className="text-red-700 mt-1">{err}</p>}
    </div>
  )
}

function Hospitals({ d, onChange, isManager }: { d: Loaded; onChange: () => void; isManager: boolean }) {
  if (!d.hospitals.length) return <div className="card text-gray-500">No hospital has started an application yet. Hospitals apply from their dashboard → International.</div>
  return <div className="space-y-3">{d.hospitals.map(h => <HospitalRow key={h.business_id} h={h} pk={d.packages.filter(p => p.business_id === h.business_id).length} onChange={onChange} isManager={isManager} />)}</div>
}

function HospitalRow({ h, pk, onChange, isManager }: { h: Loaded['hospitals'][number]; pk: number; onChange: () => void; isManager: boolean }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string>(h.status === 'draft' ? 'submitted' : h.status)
  const [star, setStar] = useState(h.star ?? '')
  const [level, setLevel] = useState(h.city_level ?? '')
  const [note, setNote] = useState('')
  const [docs, setDocs] = useState(!!h.docs_checked_at)
  const [video, setVideo] = useState(!!h.video_checked_at)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const b = h.businesses
  const save = async () => {
    setBusy(true); setErr('')
    try { await adminReview(h.business_id, { status, star: star || null, city_level: level || null, note: note || null, docs, video }); setNote(''); onChange() }
    catch (x) { setErr((x as Error).message) }
    setBusy(false)
  }
  const cl = (h as MyHospital).checklist ?? {}
  const req = CHECKLIST.flatMap(g => g.items.filter(i => !i.optional))
  const done = req.filter(i => cl[i.key]?.ok).length
  const today = new Date().toISOString().slice(0, 10)
  const expired = CHECKLIST.flatMap(g => g.items).filter(i => cl[i.key]?.expires && cl[i.key]!.expires! < today)
  return (
    <div className="card !p-4 text-sm">
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <p className="font-semibold text-navy-700 text-base">{b?.name ?? h.business_id}</p>
          <p className="text-gray-600">{[b?.own_city || b?.own_district, b?.own_state].filter(Boolean).join(', ')} · {h.beds ?? '?'} beds, {h.icu_beds ?? '?'} ICU · NABH {h.nabh} · {pk} price(s)</p>
          <p className="text-gray-600">Checklist {done}/{req.length} required · agreement {h.agreement_accepted_at ? `accepted by ${h.agreement_signatory}` : 'not accepted'}{expired.length ? ` · ${expired.length} expired` : ''}</p>
          <p className="text-gray-500">Coordinator: {h.coordinator_name ?? '—'} {h.coordinator_phone ?? ''} {h.coordinator_email ?? ''}</p>
        </div>
        <span className="rounded-full px-3 py-1 bg-gray-100 font-semibold">{h.status}{h.star ? ` · ${h.star}★` : ''}</span>
      </div>
      <button onClick={() => setOpen(o => !o)} className="mt-2 text-teal-700 font-semibold">{open ? 'Hide' : 'Show'} checklist and documents</button>
      {open && (
        <div className="mt-2 space-y-3">
          {CHECKLIST.map(g => (
            <div key={g.key}>
              <p className="font-semibold text-navy-700">{g.title}</p>
              <ul className="divide-y">{g.items.map(i => {
                const s = cl[i.key] ?? {}
                return (
                  <li key={i.key} className="py-1 flex gap-2 items-center justify-between">
                    <span className={s.ok ? '' : 'text-gray-400'}>{s.ok ? '✓' : '○'} {i.label}{i.optional ? ' (optional)' : ''}</span>
                    <span className="flex gap-2 items-center shrink-0">
                      {s.expires && <span className={s.expires < today ? 'text-red-600' : 'text-gray-500'}>exp {s.expires}</span>}
                      {s.doc && <button onClick={async () => { const u = await docUrl(s.doc!); if (u) window.open(u, '_blank', 'noopener') }} className="text-teal-700 inline-flex items-center gap-1"><FileCheck2 className="w-4 h-4" /> doc</button>}
                    </span>
                  </li>
                )
              })}</ul>
            </div>
          ))}
        </div>
      )}
      {!isManager && h.status !== 'draft' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-6 items-end">
          <label className="flex items-center gap-2"><input type="checkbox" checked={docs} onChange={e => setDocs(e.target.checked)} /> Documents checked</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={video} onChange={e => setVideo(e.target.checked)} /> Video walkthrough done</label>
          <label>Star<select value={star} onChange={e => setStar(e.target.value)} className="w-full border rounded-lg px-2 py-1.5"><option value="">—</option><option value="4">4-star</option><option value="5">5-star</option></select></label>
          <label>City level<select value={level} onChange={e => setLevel(e.target.value)} className="w-full border rounded-lg px-2 py-1.5"><option value="">From city</option><option value="metro">Big metro</option><option value="regional">Regional</option><option value="smaller">Smaller city</option></select></label>
          <label>Status<select value={status} onChange={e => setStatus(e.target.value)} className="w-full border rounded-lg px-2 py-1.5">
            {['submitted', 'reviewing', 'listed', 'paused', 'rejected'].map(s => <option key={s}>{s}</option>)}</select></label>
          <button onClick={save} disabled={busy} className="btn-teal !px-4 !py-1.5 text-sm justify-center">Save</button>
          <label className="sm:col-span-6">Note to the hospital (shown in their dashboard)<input value={note} onChange={e => setNote(e.target.value)} placeholder={h.admin_note ?? ''} className="w-full border rounded-lg px-2 py-1.5" /></label>
        </div>
      )}
      {h.status === 'draft' && <p className="mt-2 text-gray-500">Still filling in — not sent yet.</p>}
      {err && <p className="text-red-700 mt-1">{err}</p>}
    </div>
  )
}

function Settings() {
  const [fee, setFee] = useState('10')
  const [fx, setFx] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => {
    supabase.rpc('sehat_intl_fee_pct').then(({ data }) => data != null && setFee(String(data)))
    loadCatalogue().then(c => setFx(Object.fromEntries(Object.entries(c.fx ?? {}).map(([k, v]) => [k, String(v)]))), () => {})
  }, [])
  const save = async () => {
    setMsg('')
    const clean: Record<string, number> = {}
    for (const [k, v] of Object.entries(fx)) if (Number(v) > 0) clean[k] = Number(v)
    try { await adminSettings(Number(fee), clean); setMsg('Saved. Reload the portal to see it.') } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <div className="card max-w-xl text-sm space-y-3">
      <label className="block">Sehatsandhi fee added to hospital prices (%)<input inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} className="w-full border rounded-lg px-2 py-1.5" /></label>
      <p className="font-semibold text-navy-700">Exchange rates — rupees for 1 unit (blank = not shown)</p>
      <div className="grid grid-cols-3 gap-2">
        {CURRENCIES.filter(c => c !== 'INR').map(c => (
          <label key={c}>{c}<input inputMode="decimal" value={fx[c] ?? ''} onChange={e => setFx({ ...fx, [c]: e.target.value })} className="w-full border rounded-lg px-2 py-1.5" /></label>
        ))}
      </div>
      <p className="text-gray-500">Converted prices show as “≈” next to rupees. Update rates now and then.</p>
      <button onClick={save} className="btn-teal !px-4 !py-1.5 text-sm">Save</button>
      {msg && <p>{msg}</p>}
    </div>
  )
}
