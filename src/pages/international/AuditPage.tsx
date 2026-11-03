import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ShieldCheck, FileText, Download, Lock, Printer } from 'lucide-react'
import { openAudit, auditFiles } from '../../lib/intlApi'

// 0313: read-only access for a government body or an agency, from a link a
// Sehatsandhi admin made. No login; an optional passcode. Every open and
// download is logged on our side.

interface Item { key: string; grp: string; label: string; needs_doc: boolean; needs_expiry: boolean; required: boolean }
interface Doc { id: string; item_key: string; file_name: string | null; expires: string | null; status: string; reason: string | null; uploaded_at: string; uploaded_by_name: string | null; reviewed_by_name: string | null; reviewed_at: string | null }
interface Hosp {
  id: string; name: string; address: string | null; city: string | null; state: string | null; reg_number: string | null; gstin: string | null
  status: string; star: string | null; nabh: string; beds: number | null; icu_beds: number | null
  agreement_version: string | null; agreement_signatory: string | null; agreement_accepted_at: string | null
  video_checked_at: string | null; listed_at: string | null; checklist: Record<string, { ok?: boolean }>
  missing: { key: string; why: string }[]; documents: Doc[]; events: { at: string; action: string; item_key: string | null; note: string | null; by: string | null }[]
}
interface Pack { ok: boolean; label: string; expires_at: string; issued_by: string; issued_at: string; items: Item[]; hospitals: Hosp[] }

const d8 = (s: string | null) => s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const STATUS_WORD: Record<string, string> = { verified: 'Checked', pending: 'Waiting for check', rejected: 'Rejected', replaced: 'Earlier version' }
const GROUPS: Record<string, string> = { A: 'A. Government licences', B: 'B. Accreditation and panels', C: 'C. Clinical facilities', D: 'D. Comfort', E: 'E. International desk', F: 'F. Speciality extras', G: 'G. Photos and videos' }

export default function AuditPage() {
  const { token = '' } = useParams()
  const [pass, setPass] = useState('')
  const [used, setUsed] = useState<string | null>(null)
  const [pack, setPack] = useState<Pack | null>(null)
  const [needPass, setNeedPass] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    document.title = 'Document audit · Sehatsandhi'
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow'; document.head.appendChild(m)
    return () => { m.remove() }
  }, [])
  const load = async (p: string | null) => {
    setErr('')
    try {
      const r = await openAudit(token, p) as unknown as Pack & { passcode?: boolean; error?: string | null }
      if (!r.ok) { setNeedPass(!!r.passcode); setErr(r.error ?? ''); return }
      setUsed(p); setNeedPass(false); setPack(r)
    } catch (e) { setErr((e as Error).message) }
  }
  useEffect(() => { load(null) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const view = async (id: string) => {
    setBusy(id)
    try { const f = await auditFiles(token, used, [id], 'view'); if (f[0]) window.open(f[0].url, '_blank', 'noopener') } catch (e) { setErr((e as Error).message) }
    setBusy('')
  }
  const zip = async (h: Hosp) => {
    setBusy(h.id); setErr('')
    try {
      const files = await auditFiles(token, used, h.documents.map(d => d.id), 'zip')
      const { default: JSZip } = await import('jszip')
      const z = new JSZip()
      const meta = h.documents
      for (const f of files) {
        const d = meta.find(x => x.id === f.id)
        const blob = await (await fetch(f.url)).blob()
        const base = (f.file_name || `${f.item_key}.${f.ext}`).replace(/[\\/:*?"<>|]/g, '_')
        const tag = d?.status === 'replaced' ? `earlier ${d.uploaded_at.slice(0, 10)} - ` : ''
        z.file(`${f.item_key}/${tag}${base}`, blob)
      }
      z.file('README.txt', [
        `${h.name} — documents for ${pack?.label}`,
        `Downloaded ${new Date().toLocaleString('en-IN')} from Sehatsandhi (NG Technologies).`,
        'One folder per checklist item. Files named "earlier …" are replaced versions, kept for the record.', '',
        ...meta.map(d => `${d.item_key}\t${d.file_name ?? ''}\t${STATUS_WORD[d.status] ?? d.status}\texpires ${d.expires ?? '—'}\tuploaded ${d.uploaded_at.slice(0, 10)}\tchecked by ${d.reviewed_by_name ?? '—'}`),
      ].join('\n'))
      const out = await z.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(out); a.download = `${h.name.replace(/[^A-Za-z0-9 ]/g, '').trim()} - documents.zip`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch (e) { setErr((e as Error).message) }
    setBusy('')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <img src="/logo-only-symbol.png" alt="" className="h-9" />
          <div><p className="font-bold text-navy-700">Sehatsandhi — hospital document audit</p><p className="text-sm text-gray-500">Read-only. Every view and download is recorded.</p></div>
          {pack && <button onClick={() => window.print()} className="ml-auto inline-flex items-center gap-1 text-sm border rounded-lg px-3 py-1.5 print:hidden"><Printer className="w-4 h-4" /> Print</button>}
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {!pack && needPass && (
          <form onSubmit={e => { e.preventDefault(); load(pass) }} className="bg-white rounded-2xl border p-6 max-w-sm mx-auto mt-10">
            <p className="font-semibold flex items-center gap-2"><Lock className="w-4 h-4" /> Enter the passcode</p>
            <p className="text-sm text-gray-500 mt-1">Sehatsandhi shared it with you separately.</p>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} className="mt-3 w-full border rounded-lg px-3 py-2" autoFocus />
            <button className="mt-3 w-full rounded-lg bg-teal-600 text-white py-2 font-semibold">Open</button>
            {err && <p className="text-red-700 text-sm mt-2">{err}</p>}
          </form>
        )}
        {!pack && !needPass && (err ? <p className="text-red-700 bg-white rounded-xl border p-6">{err}</p> : <p className="text-gray-500">Loading…</p>)}
        {pack && (
          <>
            <div className="bg-white rounded-2xl border p-5 mb-6">
              <p className="text-lg font-bold text-navy-700">{pack.label}</p>
              <p className="text-sm text-gray-600">Issued by {pack.issued_by} on {d8(pack.issued_at)} · access until {d8(pack.expires_at)} · {pack.hospitals.length} hospital(s)</p>
              {err && <p className="text-red-700 text-sm mt-2">{err}</p>}
            </div>
            {pack.hospitals.map(h => {
              const cur = (k: string) => h.documents.find(d => d.item_key === k && d.status !== 'replaced')
              return (
                <section key={h.id} className="bg-white rounded-2xl border p-5 mb-8 break-inside-avoid">
                  <div className="flex flex-wrap gap-3 justify-between items-start">
                    <div>
                      <h2 className="text-xl font-bold text-navy-700">{h.name}</h2>
                      <p className="text-sm text-gray-600">{[h.address, h.city, h.state].filter(Boolean).join(', ')}</p>
                      <p className="text-sm text-gray-600">Registration {h.reg_number ?? '—'} · GSTIN {h.gstin ?? '—'} · {h.beds ?? '?'} beds, {h.icu_beds ?? '?'} ICU · NABH {h.nabh}{h.star ? ` · ${h.star}-star` : ''}</p>
                      <p className="text-sm text-gray-600">Listing: <b>{h.status}</b>{h.listed_at ? ` since ${d8(h.listed_at)}` : ''} · agreement {h.agreement_accepted_at ? `${h.agreement_version} accepted by ${h.agreement_signatory} on ${d8(h.agreement_accepted_at)}` : 'not accepted'} · video walkthrough {h.video_checked_at ? d8(h.video_checked_at) : 'not done'}</p>
                      <p className={`text-sm mt-1 flex items-center gap-1 ${h.missing.length ? 'text-amber-700' : 'text-green-700'}`}><ShieldCheck className="w-4 h-4" />
                        {h.missing.length ? `${h.missing.length} required item(s) not complete: ${h.missing.slice(0, 5).map(m => `${m.key} (${m.why})`).join('; ')}${h.missing.length > 5 ? '…' : ''}` : 'Every required item complete and checked.'}</p>
                    </div>
                    {h.documents.length > 0 && (
                      <button onClick={() => zip(h)} disabled={!!busy} className="inline-flex items-center gap-1 rounded-lg bg-navy-700 text-white px-3 py-2 text-sm print:hidden">
                        <Download className="w-4 h-4" /> {busy === h.id ? 'Preparing…' : 'Download all (ZIP)'}</button>
                    )}
                  </div>
                  {Object.keys(GROUPS).map(g => {
                    const items = pack.items.filter(i => i.grp === g)
                    return (
                      <div key={g} className="mt-4">
                        <p className="font-semibold text-navy-700 text-sm">{GROUPS[g]}</p>
                        <table className="w-full text-sm mt-1">
                          <tbody className="divide-y">
                            {items.map(i => {
                              const d = cur(i.key)
                              const old = h.documents.filter(x => x.item_key === i.key && x.status === 'replaced')
                              const ok = i.key === 'G1' ? !h.missing.some(m => m.key === 'G1') : i.needs_doc ? !!d : !!h.checklist?.[i.key]?.ok
                              return (
                                <tr key={i.key} className="align-top">
                                  <td className="py-1.5 pr-2 w-12 font-semibold">{i.key}</td>
                                  <td className="py-1.5 pr-2">{i.label}{!i.required && <span className="text-gray-400"> (optional)</span>}
                                    {old.length > 0 && <div className="text-xs text-gray-500">Earlier versions: {old.map(o => <button key={o.id} onClick={() => view(o.id)} className="underline mr-2 print:no-underline">{d8(o.uploaded_at)}</button>)}</div>}
                                  </td>
                                  <td className="py-1.5 pr-2 whitespace-nowrap">{i.needs_doc
                                    ? (d ? <span className={d.status === 'verified' ? 'text-green-700' : d.status === 'rejected' ? 'text-red-700' : 'text-amber-700'}>{STATUS_WORD[d.status]}</span> : <span className="text-gray-400">No document</span>)
                                    : i.key === 'G1' ? <span className={ok ? 'text-green-700' : 'text-amber-700'}>{ok ? 'Approved' : h.missing.find(m => m.key === 'G1')?.why}</span>
                                    : <span className={ok ? 'text-green-700' : 'text-gray-400'}>{ok ? 'Declared' : 'Not declared'}</span>}</td>
                                  <td className="py-1.5 pr-2 text-xs text-gray-500">{d ? <>expires {d8(d.expires)}<br />checked {d.reviewed_by_name ? `by ${d.reviewed_by_name}, ${d8(d.reviewed_at)}` : '—'}</> : null}</td>
                                  <td className="py-1.5 text-right">{d && <button onClick={() => view(d.id)} disabled={busy === d.id} className="inline-flex items-center gap-1 text-teal-700 font-semibold print:hidden"><FileText className="w-4 h-4" /> Open</button>}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                  {h.events.length > 0 && (
                    <details className="mt-4 text-sm">
                      <summary className="cursor-pointer font-semibold text-navy-700">History ({h.events.length})</summary>
                      <ul className="mt-1 divide-y">{h.events.map((e, n) => <li key={n} className="py-1"><span className="text-gray-400">{new Date(e.at).toLocaleString('en-IN')}</span> {e.item_key ? <b>{e.item_key} </b> : null}{e.action.replace('_', ' ')}{e.note ? ` — ${e.note}` : ''} <span className="text-gray-400">· {e.by}</span></li>)}</ul>
                    </details>
                  )}
                </section>
              )
            })}
            <p className="text-xs text-gray-500">"Declared" items are confirmed by the hospital and checked by Sehatsandhi on the video walkthrough; they have no document. Facilities and documents are the hospital’s responsibility.</p>
          </>
        )}
      </main>
    </div>
  )
}
