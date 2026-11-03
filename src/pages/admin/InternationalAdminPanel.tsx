import { useEffect, useState } from 'react'
import { Globe2, FileCheck2, MessageCircle, RefreshCw } from 'lucide-react'
import {
  adminLoad, adminReview, adminEnquiry, adminSettings, docUrl, loadCatalogue, loadDocs, reviewDoc, loadAudit, createAuditLink,
  revokeAuditLink, backupNow, type AdminEnquiry, type MyHospital, type IntlDoc, type Missing, type DocEvent, type AuditLink, type AuditLogRow, type BackupRun,
} from '../../lib/intlApi'
import { CHECKLIST, STEPS, CURRENCIES } from '../../lib/intlContent'
import { supabase } from '../../lib/supabase'

// 0312: review hospital applications (documents, video walkthrough, star and
// city level, list/pause) and look after patient requests.

type Loaded = Awaited<ReturnType<typeof adminLoad>>
const ENQ_STATUS = [...STEPS.map(s => s.key), 'closed', 'cancelled']

export default function InternationalAdminPanel({ isManager }: { isManager: boolean }) {
  const [d, setD] = useState<Loaded | null>(null)
  const [view, setView] = useState<'enquiries' | 'hospitals' | 'articles' | 'audit' | 'settings'>('enquiries')
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
        {([['enquiries', `Patient requests${newEnq ? ` (${newEnq} new)` : ''}`], ['hospitals', `Hospitals${toReview ? ` (${toReview} to review)` : ''}`], ...(!isManager ? [['articles', 'Articles'], ['audit', 'Audit & backup'], ['settings', 'Fee & currency']] : [])] as [typeof view, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-full text-sm ${view === k ? 'bg-navy-700 text-white' : 'bg-white border'}`}>{l}</button>
        ))}
        <button onClick={load} className="ml-auto p-2" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
        <a href="/international" target="_blank" rel="noreferrer" className="text-sm text-teal-700 font-semibold">Open portal ↗</a>
      </div>
      {view === 'enquiries' && <Enquiries d={d} onChange={load} />}
      {view === 'hospitals' && <Hospitals d={d} onChange={load} isManager={isManager} />}
      {view === 'articles' && !isManager && <Articles />}
      {view === 'audit' && !isManager && <Audit hospitals={d.hospitals.map(h => ({ id: h.business_id, name: h.businesses?.name ?? h.business_id }))} />}
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
  const [video, setVideo] = useState(!!h.video_checked_at)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [docs, setDocs] = useState<IntlDoc[] | null>(null)
  const [missing, setMissing] = useState<Missing[]>([])
  const [events, setEvents] = useState<DocEvent[]>([])
  const b = h.businesses
  const loadD = () => loadDocs(h.business_id).then(r => { setDocs(r.docs); setMissing(r.forList); setEvents(r.events) }, e => setErr(e.message))
  useEffect(() => { loadD() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.business_id, h.updated_at])
  const save = async () => {
    setBusy(true); setErr('')
    try { await adminReview(h.business_id, { status, star: star || null, city_level: level || null, note: note || null, video }); setNote(''); onChange() }
    catch (x) { setErr((x as Error).message) }
    setBusy(false)
  }
  const review = async (d: IntlDoc, ok: boolean) => {
    let reason: string | undefined
    if (!ok) { reason = window.prompt(`Why is ${d.item_key} not acceptable? The hospital sees this.`) ?? undefined; if (!reason) return }
    setErr('')
    try { await reviewDoc(d.id, ok, reason); await loadD(); onChange() } catch (x) { setErr((x as Error).message) }
  }
  const view = async (path: string) => { const u = await docUrl(path); if (u) window.open(u, '_blank', 'noopener') }
  const cl = (h as MyHospital).checklist ?? {}
  const today = new Date().toISOString().slice(0, 10)
  const cur = (k: string) => docs?.find(d => d.item_key === k && d.status !== 'replaced')
  const toCheck = (docs ?? []).filter(d => d.status === 'pending').length
  return (
    <div className="card !p-4 text-sm">
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <p className="font-semibold text-navy-700 text-base">{b?.name ?? h.business_id}</p>
          <p className="text-gray-600">{[b?.own_city || b?.own_district, b?.own_state].filter(Boolean).join(', ')} · {h.beds ?? '?'} beds, {h.icu_beds ?? '?'} ICU · NABH {h.nabh} · {pk} price(s)</p>
          <p className="text-gray-600">Agreement {h.agreement_accepted_at ? `accepted by ${h.agreement_signatory}` : 'not accepted'} · video {h.video_checked_at ? 'done' : 'not done'}</p>
          <p className={missing.length ? 'text-amber-700' : 'text-green-700'}>
            {docs === null ? 'Checking…' : missing.length === 0 ? 'Every required item is ready to list.' : `${missing.length} item(s) not ready to list`}{toCheck ? ` · ${toCheck} document(s) waiting for your check` : ''}
          </p>
          <p className="text-gray-500">Coordinator: {h.coordinator_name ?? '—'} {h.coordinator_phone ?? ''} {h.coordinator_email ?? ''}</p>
        </div>
        <span className="rounded-full px-3 py-1 bg-gray-100 font-semibold">{h.status}{(h as { auto_paused?: boolean }).auto_paused ? ' (expiry)' : ''}{h.star ? ` · ${h.star}★` : ''}</span>
      </div>
      <button onClick={() => setOpen(o => !o)} className="mt-2 text-teal-700 font-semibold">{open ? 'Hide' : 'Check'} documents{toCheck ? ` (${toCheck} to check)` : ''}</button>
      {open && docs && (
        <div className="mt-2 space-y-3">
          {missing.length > 0 && (
            <div className="bg-amber-50 rounded-lg p-3"><p className="font-semibold text-amber-900">Not ready to list</p>
              <ul className="list-disc ml-5">{missing.map(m => <li key={m.key}><b>{m.key}</b> — {m.why}</li>)}</ul></div>
          )}
          {CHECKLIST.map(g => (
            <div key={g.key}>
              <p className="font-semibold text-navy-700">{g.title}</p>
              <ul className="divide-y">{g.items.map(i => {
                const d = i.doc ? cur(i.key) : undefined
                const ok = i.doc ? !!d : !!cl[i.key]?.ok
                const old = (docs ?? []).filter(x => x.item_key === i.key && x.status === 'replaced')
                return (
                  <li key={i.key} className="py-1.5">
                    <div className="flex gap-2 items-center justify-between flex-wrap">
                      <span className={ok ? '' : 'text-gray-400'}>{ok ? '✓' : '○'} <b>{i.key}</b> {i.label}{i.optional ? ' (optional)' : ''}</span>
                      {d && (
                        <span className="flex gap-2 items-center flex-wrap">
                          {d.expires && <span className={d.expires < today ? 'text-red-600' : 'text-gray-500'}>exp {d.expires}</span>}
                          <button onClick={() => view(d.path)} className="text-teal-700 inline-flex items-center gap-1"><FileCheck2 className="w-4 h-4" /> open</button>
                          {d.status === 'verified' && <span className="text-green-700">checked by {d.reviewed_by_name}</span>}
                          {d.status === 'rejected' && <span className="text-red-700">rejected: {d.reason}</span>}
                          {!isManager && d.status !== 'verified' && <button onClick={() => review(d, true)} className="rounded-lg bg-green-600 text-white px-2 py-0.5">Verify</button>}
                          {!isManager && d.status !== 'rejected' && <button onClick={() => review(d, false)} className="rounded-lg border border-red-300 text-red-700 px-2 py-0.5">Reject</button>}
                        </span>
                      )}
                    </div>
                    {old.length > 0 && <p className="text-xs text-gray-400 ml-5">Earlier: {old.map(o => <button key={o.id} onClick={() => view(o.path)} className="underline mr-2">{new Date(o.uploaded_at).toLocaleDateString('en-IN')}</button>)}</p>}
                  </li>
                )
              })}</ul>
            </div>
          ))}
          {events.length > 0 && (
            <details><summary className="cursor-pointer font-semibold text-navy-700">History ({events.length})</summary>
              <ul className="divide-y mt-1">{events.slice(0, 100).map(e => <li key={e.id} className="py-1"><span className="text-gray-400">{new Date(e.at).toLocaleString('en-IN')}</span> {e.item_key ? <b>{e.item_key} </b> : null}{e.action}{e.note ? ` — ${e.note}` : ''} <span className="text-gray-400">· {e.actor_name}</span></li>)}</ul>
            </details>
          )}
        </div>
      )}
      {!isManager && h.status !== 'draft' && (
        <div className="mt-3 grid gap-2 sm:grid-cols-5 items-end">
          <label className="flex items-center gap-2"><input type="checkbox" checked={video} onChange={e => setVideo(e.target.checked)} /> Video walkthrough done</label>
          <label>Star<select value={star} onChange={e => setStar(e.target.value)} className="w-full border rounded-lg px-2 py-1.5"><option value="">—</option><option value="4">4-star</option><option value="5">5-star</option></select></label>
          <label>City level<select value={level} onChange={e => setLevel(e.target.value)} className="w-full border rounded-lg px-2 py-1.5"><option value="">From city</option><option value="metro">Big metro</option><option value="regional">Regional</option><option value="smaller">Smaller city</option></select></label>
          <label>Status<select value={status} onChange={e => setStatus(e.target.value)} className="w-full border rounded-lg px-2 py-1.5">
            {['submitted', 'reviewing', 'listed', 'paused', 'rejected'].map(s => <option key={s} disabled={s === 'listed' && missing.length > 0}>{s}</option>)}</select></label>
          <button onClick={save} disabled={busy} className="btn-teal !px-4 !py-1.5 text-sm justify-center">Save</button>
          <label className="sm:col-span-5">Note to the hospital (shown in their dashboard and emailed)<input value={note} onChange={e => setNote(e.target.value)} placeholder={h.admin_note ?? ''} className="w-full border rounded-lg px-2 py-1.5" /></label>
        </div>
      )}
      {h.status === 'draft' && <p className="mt-2 text-gray-500">Still filling in — not sent yet.</p>}
      {err && <p className="text-red-700 mt-1">{err}</p>}
    </div>
  )
}

function Audit({ hospitals }: { hospitals: { id: string; name: string }[] }) {
  const [links, setLinks] = useState<AuditLink[]>([])
  const [log, setLog] = useState<AuditLogRow[]>([])
  const [runs, setRuns] = useState<BackupRun[]>([])
  const [label, setLabel] = useState('')
  const [pick, setPick] = useState<string[]>([])
  const [days, setDays] = useState('7')
  const [pass, setPass] = useState('')
  const [made, setMade] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showLog, setShowLog] = useState<string | null>(null)
  const load = () => loadAudit().then(r => { setLinks(r.links); setLog(r.log); setRuns(r.backups) }, e => setErr(e.message))
  useEffect(() => { load() }, [])
  const create = async () => {
    setErr(''); setBusy(true)
    try {
      const t = await createAuditLink(label, pick, Number(days) || 7, pass)
      setMade(`${window.location.origin}/audit/${t}`); setLabel(''); setPick([]); setPass(''); load()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const nameOf = (id: string | null) => hospitals.find(h => h.id === id)?.name ?? ''
  const runBackup = async () => {
    setBusy(true); setErr('')
    try { const r = await backupNow(); setErr(r.failed ? `Backup: ${r.failed} failed — ${(r.errors ?? []).join('; ')}` : '') ; load() } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const last = runs[0]
  return (
    <div className="space-y-4 text-sm">
      <div className="card space-y-3">
        <p className="font-bold text-navy-700">Give an auditor read-only access</p>
        <p className="text-gray-600">For a government body, NABH or another agency. They open a link — no login — and see the chosen hospitals’ checklists, every document version, who checked each one, and the history. Every open and download is logged. You can withdraw the link at any time.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="sm:col-span-3">Who is it for<input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. District CMO Yamunanagar — annual inspection" className="w-full border rounded-lg px-2 py-1.5" /></label>
          <label>Valid for (days)<input inputMode="numeric" value={days} onChange={e => setDays(e.target.value.replace(/\D/g, ''))} className="w-full border rounded-lg px-2 py-1.5" /></label>
          <label className="sm:col-span-2">Passcode (optional, 6+ characters — share it separately)<input value={pass} onChange={e => setPass(e.target.value)} className="w-full border rounded-lg px-2 py-1.5" /></label>
        </div>
        <div>
          <p className="mb-1">Hospitals {pick.length === 0 && <span className="text-gray-500">(none ticked = every hospital that has applied)</span>}</p>
          <div className="flex flex-wrap gap-2">{hospitals.map(h => (
            <label key={h.id} className={`rounded-full border px-3 py-1 cursor-pointer ${pick.includes(h.id) ? 'bg-navy-700 text-white' : ''}`}>
              <input type="checkbox" className="hidden" checked={pick.includes(h.id)} onChange={e => setPick(p => e.target.checked ? [...p, h.id] : p.filter(x => x !== h.id))} />{h.name}</label>
          ))}</div>
        </div>
        <button onClick={create} disabled={busy} className="btn-teal !px-4 !py-1.5 text-sm">Create link</button>
        {made && (
          <div className="bg-green-50 rounded-lg p-3">
            <p className="font-semibold text-green-900">Link ready — copy it now:</p>
            <p className="break-all font-mono mt-1">{made}</p>
            <button onClick={() => navigator.clipboard?.writeText(made)} className="mt-2 underline text-green-900">Copy</button>
          </div>
        )}
      </div>

      <div className="card">
        <p className="font-bold text-navy-700 mb-2">Links</p>
        {links.length === 0 && <p className="text-gray-500">No links yet.</p>}
        <ul className="divide-y">{links.map(l => {
          const live = !l.revoked_at && new Date(l.expires_at) > new Date()
          const mine = log.filter(x => x.link_id === l.id)
          return (
            <li key={l.id} className="py-2">
              <div className="flex flex-wrap gap-2 justify-between items-center">
                <span><b>{l.label}</b> · {l.business_ids.length ? l.business_ids.map(nameOf).join(', ') : 'all applied hospitals'}{l.passcode_hash ? ' · passcode' : ''}</span>
                <span className="flex gap-3 items-center">
                  <span className={live ? 'text-green-700' : 'text-gray-400'}>{l.revoked_at ? 'withdrawn' : live ? `until ${new Date(l.expires_at).toLocaleDateString('en-IN')}` : 'expired'}</span>
                  <button onClick={() => setShowLog(showLog === l.id ? null : l.id)} className="underline">{mine.filter(m => m.action !== 'bad_passcode').length} views/downloads</button>
                  {live && <button onClick={async () => { if (window.confirm('Withdraw this link now?')) { await revokeAuditLink(l.id); load() } }} className="text-red-700 underline">Withdraw</button>}
                </span>
              </div>
              <p className="text-gray-400">Made by {l.created_by_name} on {new Date(l.created_at).toLocaleString('en-IN')}{live ? ` · ${window.location.origin}/audit/${l.token}` : ''}</p>
              {showLog === l.id && (
                <ul className="mt-1 ml-3 text-xs">{mine.map(m => <li key={m.id}>{new Date(m.at).toLocaleString('en-IN')} · {m.action}{m.business_id ? ` · ${nameOf(m.business_id)}` : ''}{m.ip ? ` · ${m.ip}` : ''}</li>)}{!mine.length && <li className="text-gray-400">Not opened yet.</li>}</ul>
              )}
            </li>
          )
        })}</ul>
      </div>

      <div className="card space-y-2">
        <p className="font-bold text-navy-700">Document backup</p>
        <p className="text-gray-600">Every Monday 03:00 a copy of all hospital documents is made. Supabase’s own backups do not include files.</p>
        {last ? <p>Last run {new Date(last.started_at).toLocaleString('en-IN')} → {last.target}: {last.copied} copied, {last.already} already backed up{last.failed ? `, ${last.failed} failed` : ''}{last.error ? ` — ${last.error}` : ''}</p> : <p className="text-gray-500">No backup has run yet.</p>}
        {last?.target?.startsWith('supabase:') && <p className="text-amber-800 bg-amber-50 rounded-lg p-2">Copies go to a second private bucket in the same Supabase project. For a copy outside Supabase, add an S3-compatible bucket (Cloudflare R2, AWS S3 or Backblaze) — see the note from Claude.</p>}
        <button onClick={runBackup} disabled={busy} className="btn-outline text-sm">Back up now</button>
      </div>
      {err && <p className="text-red-700">{err}</p>}
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

interface AdminArticle {
  id: string; slug: string; title: string; summary: string; body: string; category: 'planning' | 'treatment' | 'health'
  procedure_code: string | null; status: 'draft' | 'review' | 'published'; reviewed_by: string | null; reviewed_at: string | null
  featured: boolean; image_url: string | null; views: number; updated_at: string
}

// 0315: the portal's articles. A treatment or health article is published only
// with the name of the doctor who reviewed it — the database refuses otherwise.
function Articles() {
  const [list, setList] = useState<AdminArticle[]>([])
  const [edit, setEdit] = useState<AdminArticle | null>(null)
  const [err, setErr] = useState('')
  const load = () => supabase.from('intl_articles').select('*').order('status').order('updated_at', { ascending: false })
    .then(({ data, error }) => { if (error) setErr(error.message); else setList((data ?? []) as AdminArticle[]) })
  useEffect(() => { load() }, [])
  const blank: AdminArticle = { id: '', slug: '', title: '', summary: '', body: '', category: 'health', procedure_code: null, status: 'draft', reviewed_by: null, reviewed_at: null, featured: false, image_url: null, views: 0, updated_at: '' }
  const save = async (a: AdminArticle) => {
    setErr('')
    const row = { slug: a.slug.trim(), title: a.title.trim(), summary: a.summary.trim(), body: a.body, category: a.category,
      procedure_code: a.procedure_code || null, status: a.status, reviewed_by: a.reviewed_by?.trim() || null,
      reviewed_at: a.reviewed_by?.trim() ? (a.reviewed_at || new Date().toISOString().slice(0, 10)) : null,
      featured: a.featured, image_url: a.image_url?.trim() || null }
    const { error } = a.id ? await supabase.from('intl_articles').update(row).eq('id', a.id) : await supabase.from('intl_articles').insert(row)
    if (error) { setErr(error.message.includes('check') && a.status === 'published' ? 'A treatment or health article needs the reviewing doctor’s name before it is published.' : error.message); return false }
    load(); return true
  }
  const quick = async (a: AdminArticle, patch: Partial<AdminArticle>) => {
    if (patch.status === 'published' && a.category !== 'planning' && !a.reviewed_by) {
      const who = window.prompt('Name of the doctor who reviewed this article (shown on the page):')
      if (!who) return
      patch.reviewed_by = who
    }
    await save({ ...a, ...patch })
  }
  const tone = { draft: 'bg-gray-100', review: 'bg-amber-50 text-amber-800', published: 'bg-green-50 text-green-800' }
  return (
    <div className="space-y-3 text-sm">
      <div className="card !p-4 flex flex-wrap gap-3 items-center">
        <p className="text-gray-600 flex-1">Articles rotate on the International home page and the Articles page; featured ones appear in the banner. A treatment or health article needs a reviewing doctor before it is published.</p>
        <button onClick={() => setEdit(blank)} className="btn-teal !px-4 !py-1.5 text-sm">New article</button>
      </div>
      {err && <p className="text-red-700">{err}</p>}
      {edit && (
        <div className="card !p-4 grid gap-2 sm:grid-cols-2">
          <label className="sm:col-span-2">Title<input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value, slug: edit.id ? edit.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} className="w-full border rounded-lg px-2 py-1.5" /></label>
          <label>Web address (slug)<input value={edit.slug} onChange={e => setEdit({ ...edit, slug: e.target.value })} className="w-full border rounded-lg px-2 py-1.5 font-mono" /></label>
          <label>Category<select value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value as AdminArticle['category'] })} className="w-full border rounded-lg px-2 py-1.5">
            <option value="planning">Planning your trip</option><option value="treatment">Treatments</option><option value="health">Health</option></select></label>
          <label className="sm:col-span-2">Summary (one or two sentences)<textarea rows={2} value={edit.summary} onChange={e => setEdit({ ...edit, summary: e.target.value })} className="w-full border rounded-lg px-2 py-1.5" /></label>
          <label className="sm:col-span-2">Article — ## for headings, - for lists, **bold**, [link](https://…)<textarea rows={14} value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} className="w-full border rounded-lg px-2 py-1.5 font-mono text-xs" /></label>
          <label>Related treatment code (optional)<input value={edit.procedure_code ?? ''} onChange={e => setEdit({ ...edit, procedure_code: e.target.value || null })} placeholder="knee_replacement" className="w-full border rounded-lg px-2 py-1.5" /></label>
          <label>Banner photo URL (optional, https)<input value={edit.image_url ?? ''} onChange={e => setEdit({ ...edit, image_url: e.target.value })} className="w-full border rounded-lg px-2 py-1.5" /></label>
          <label>Reviewed by (doctor’s name)<input value={edit.reviewed_by ?? ''} onChange={e => setEdit({ ...edit, reviewed_by: e.target.value })} className="w-full border rounded-lg px-2 py-1.5" /></label>
          <label>Status<select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value as AdminArticle['status'] })} className="w-full border rounded-lg px-2 py-1.5">
            <option value="draft">Draft</option><option value="review">Waiting for review</option><option value="published">Published</option></select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.featured} onChange={e => setEdit({ ...edit, featured: e.target.checked })} /> Show in the banner</label>
          <div className="sm:col-span-2 flex gap-2">
            <button onClick={async () => { if (await save(edit)) setEdit(null) }} className="btn-teal !px-4 !py-1.5 text-sm">Save</button>
            <button onClick={() => setEdit(null)} className="btn-outline text-sm">Cancel</button>
          </div>
        </div>
      )}
      <ul className="space-y-2">{list.map(a => (
        <li key={a.id} className="card !p-3 flex flex-wrap gap-3 items-center">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone[a.status]}`}>{a.status === 'review' ? 'waiting for review' : a.status}</span>
          <span className="flex-1 min-w-[200px]"><b>{a.title}</b> <span className="text-gray-400">· {a.category}{a.featured ? ' · banner' : ''} · {a.views} views{a.reviewed_by ? ` · reviewed by ${a.reviewed_by}` : ''}</span></span>
          {a.status === 'published' && <a href={`/international/articles/${a.slug}`} target="_blank" rel="noreferrer" className="text-teal-700">open ↗</a>}
          <button onClick={() => quick(a, { featured: !a.featured })} className="underline">{a.featured ? 'Remove from banner' : 'Add to banner'}</button>
          {a.status !== 'published' ? <button onClick={() => quick(a, { status: 'published' })} className="rounded-lg bg-green-600 text-white px-2 py-0.5">Publish</button>
            : <button onClick={() => quick(a, { status: 'draft' })} className="underline text-red-700">Unpublish</button>}
          <button onClick={() => setEdit(a)} className="underline">Edit</button>
        </li>
      ))}</ul>
    </div>
  )
}
