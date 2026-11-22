import { useCallback, useEffect, useState } from 'react'
import {
  adminCarePartners, adminCarePartnerStatus, adminSaveModule, adminSaveFaq, adminSaveContract, adminSaveSettings,
  adminCareSettings, adminUploadPdf, careModules, careContracts, careFaq, careFileUrl, parseCsv, STATUS_LABEL,
  adminQuestions, adminSaveQuestion,
  type AdminPartnerRow, type CareModule, type CareFaq, type CareContract, type PartnerStatus, type AdminQuestion, type QuizOption,
} from '../../lib/careApi'

// Admin → Care Partners (0331, Phase 1): program operations. Money (rewards,
// statements, payouts) stays in Admin → Partners with the other partners.
//   Partners   list, filter, pause / suspend / end / restore (reason logged)
//   Modules    titles, videos, PDFs, order, publish
//   FAQ        edit answers, import the CSV
//   Contracts  versions, PDFs, which one is current
//   Settings   the program switch and every OPEN value of the brief
// Admins only (owner/admin roles); every save is written to the staff action log.

type View = 'partners' | 'modules' | 'questions' | 'faq' | 'contracts' | 'settings'
const day = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function CarePartnersPanel() {
  const [view, setView] = useState<View>('partners')
  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <h2 className="font-bold text-navy-700 text-lg">Care Partner Program</h2>
        <p className="text-sm text-gray-500">Partners learn, pass the exam, get a Partner ID and introduce businesses. Rewards and payouts are in the Partners tab.</p>
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {(['partners', 'modules', 'questions', 'faq', 'contracts', 'settings'] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border capitalize ${view === v ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {v === 'faq' ? 'FAQ' : v}
            </button>
          ))}
        </div>
      </div>
      {view === 'partners' && <Partners />}
      {view === 'modules' && <Modules />}
      {view === 'questions' && <Questions />}
      {view === 'faq' && <Faq />}
      {view === 'contracts' && <Contracts />}
      {view === 'settings' && <Settings />}
    </div>
  )
}

function useRun() {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const run = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id); setErr(''); setMsg('')
    try { await fn(); if (done) { setMsg(done); setTimeout(() => setMsg(''), 4000) } } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const notes = <>{msg && <p className="text-sm text-green-700">{msg}</p>}{err && <p className="text-sm text-red-600">{err}</p>}</>
  return { busy, run, notes }
}

// ── Partners ────────────────────────────────────────────────────────────────
function Partners() {
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<AdminPartnerRow[] | null>(null)
  const [reason, setReason] = useState<Record<string, string>>({})
  const { busy, run, notes } = useRun()
  const load = useCallback(() => { adminCarePartners(status).then(setRows, () => setRows([])) }, [status])
  useEffect(() => { load() }, [load])
  const counts = (rows ?? []).reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {})

  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <select className="input-field w-auto" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as PartnerStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s].en}</option>)}
        </select>
        {!status && rows && <span className="text-xs text-gray-500">{Object.entries(counts).map(([k, n]) => `${STATUS_LABEL[k as PartnerStatus]?.en ?? k}: ${n}`).join(' · ')}</span>}
      </div>
      {notes}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? <p className="text-sm text-gray-500">No partners yet.</p> : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="border border-gray-100 rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold text-navy-700">{r.full_name}{r.partner_code ? ` · ${r.partner_code}` : ''}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{STATUS_LABEL[r.status].en}</span>
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                +{r.phone}{r.email ? ` · ${r.email}` : ''} · {r.city}, {r.state} · {r.language === 'hi' ? 'Hindi' : 'English'}
                {r.occupation ? ` · ${r.occupation}` : ''} · joined {day(r.created_at)} · modules {r.modules_done}/{r.modules_total}
                {r.status_reason ? ` · reason: ${r.status_reason}` : ''}
              </div>
              {r.status !== 'terminated' && (
                <div className="flex gap-2 flex-wrap mt-2 items-center">
                  <input className="input-field flex-1 min-w-[10rem] py-1.5" placeholder="Reason (needed to pause, suspend or end)"
                    value={reason[r.id] ?? ''} onChange={e => setReason(x => ({ ...x, [r.id]: e.target.value }))} />
                  {(['paused', 'suspended', 'terminated'] as const).filter(a => a !== r.status).map(a => (
                    <button key={a} disabled={busy === r.id} className={`text-xs py-1.5 px-3 rounded-lg border ${a === 'terminated' ? 'border-red-300 text-red-700' : 'border-gray-200'}`}
                      onClick={() => run(r.id, async () => { await adminCarePartnerStatus(r.id, a, reason[r.id] ?? ''); load() }, 'Saved.')}>
                      {a === 'paused' ? 'Pause' : a === 'suspended' ? 'Suspend' : 'End partnership'}
                    </button>
                  ))}
                  {(r.status === 'paused' || r.status === 'suspended') && (
                    <button disabled={busy === r.id} className="text-xs py-1.5 px-3 rounded-lg border border-teal-300 text-teal-800"
                      onClick={() => run(r.id, async () => { await adminCarePartnerStatus(r.id, 'restore', reason[r.id] ?? ''); load() }, 'Restored.')}>Restore</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Modules ─────────────────────────────────────────────────────────────────
function Modules() {
  const [mods, setMods] = useState<CareModule[] | null>(null)
  const [edit, setEdit] = useState<Partial<CareModule> | null>(null)
  const { busy, run, notes } = useRun()
  const load = useCallback(() => { careModules().then(setMods, () => setMods([])) }, [])
  useEffect(() => { load() }, [load])

  const upload = (lang: 'hi' | 'en') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file || !edit) return
    await run('upload', async () => {
      const path = await adminUploadPdf('modules', `${edit.slug ?? 'module'}-${lang}`, file)
      setEdit(x => ({ ...x, [lang === 'hi' ? 'pdf_path_hi' : 'pdf_path_en']: path }))
    }, 'PDF uploaded. Save the module to keep it.')
  }
  const f = (k: keyof CareModule, label: string, wide = false, type = 'text') => (
    <label className={`text-xs text-gray-600 block ${wide ? 'sm:col-span-2' : ''}`}>{label}
      <input className="input-field mt-1" type={type} value={(edit?.[k] as string | number | null | undefined) ?? ''}
        onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} />
    </label>
  )

  return (
    <div className="space-y-3">
      {notes}
      {edit ? (
        <div className="card shadow-sm space-y-3">
          <h3 className="font-bold text-navy-700">{edit.id ? 'Edit module' : 'New module'}</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {f('title_en', 'Title (English)')}{f('title_hi', 'Title (Hindi)')}
            {f('desc_en', 'Short description (English)', true)}{f('desc_hi', 'Short description (Hindi)', true)}
            {f('youtube_id_hi', 'YouTube video, Hindi (link or id)')}{f('youtube_id_en', 'YouTube video, English (link or id)')}
            {f('est_minutes', 'Estimated minutes', false, 'number')}{f('sort_order', 'Order (lower first)', false, 'number')}
            {!edit.id && f('slug', 'Slug (a-z, 0-9, -)')}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            {(['hi', 'en'] as const).map(l => {
              const path = l === 'hi' ? edit.pdf_path_hi : edit.pdf_path_en
              return (
                <div key={l} className="bg-gray-50 rounded-lg p-2">
                  <div className="text-xs text-gray-600 mb-1">PDF ({l === 'hi' ? 'Hindi' : 'English'})</div>
                  {path ? <button className="text-teal-700 underline text-xs" onClick={async () => window.open(await careFileUrl(path), '_blank')}>{path.split('/').pop()}</button> : <span className="text-xs text-gray-400">none</span>}
                  <input type="file" accept="application/pdf" className="block text-xs mt-1" disabled={busy === 'upload'} onChange={upload(l)} />
                </div>
              )
            })}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.is_published} onChange={e => setEdit(x => ({ ...x, is_published: e.target.checked }))} /> Published (needs a video and a PDF)</label>
          <div className="flex gap-2">
            <button disabled={busy === 'save'} className="btn-teal text-sm py-2 px-4"
              onClick={() => run('save', async () => { await adminSaveModule(edit); setEdit(null); load() }, 'Module saved.')}>Save</button>
            <button onClick={() => setEdit(null)} className="text-sm text-gray-600 px-2">Cancel</button>
          </div>
        </div>
      ) : <button onClick={() => setEdit({ is_published: false })} className="btn-teal text-sm py-2 px-4">Add a module</button>}
      {mods === null ? <p className="text-sm text-gray-400">Loading…</p> : mods.map(m => (
        <div key={m.id} className="card shadow-sm text-sm flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-navy-700">{m.sort_order}. {m.title_en}</div>
            <div className="text-xs text-gray-500">{m.title_hi}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Video {m.youtube_id_hi || m.youtube_id_en ? '✓' : '—'} · PDF {m.pdf_path_hi || m.pdf_path_en ? '✓' : '—'} · {m.est_minutes ?? '?'} min
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-xs px-2 py-0.5 rounded-full ${m.is_published ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{m.is_published ? 'Published' : 'Draft'}</span>
            <button onClick={() => setEdit(m)} className="text-teal-700 underline text-xs">Edit</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Quiz questions (0332) ───────────────────────────────────────────────────
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f']
const blankQ = (module_id: string | null): Partial<AdminQuestion> => ({ module_id, qtype: 'single', text_en: '', text_hi: '', is_active: true, correct: [],
  options: LETTERS.slice(0, 4).map(id => ({ id, text_en: '', text_hi: '' })) })

function Questions() {
  const [mods, setMods] = useState<CareModule[]>([])
  const [qs, setQs] = useState<AdminQuestion[] | null>(null)
  const [edit, setEdit] = useState<Partial<AdminQuestion> | null>(null)
  const { busy, run, notes } = useRun()
  const load = useCallback(() => {
    Promise.all([careModules(), adminQuestions()]).then(([m, q]) => { setMods(m); setQs(q) }, () => setQs([]))
  }, [])
  useEffect(() => { load() }, [load])

  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    await run('import', async () => {
      const rows = parseCsv(await file.text())
      if (!rows.length || !('text_en' in rows[0])) throw new Error('Needs columns module_slug, qtype, text_en, text_hi, a_en, a_hi, b_en, b_hi…, correct, explain_en, explain_hi.')
      for (const [i, r] of rows.entries()) {
        const mod = r.module_slug ? mods.find(m => m.slug === r.module_slug.trim()) : null
        if (r.module_slug && !mod) throw new Error(`Row ${i + 2}: no module "${r.module_slug}".`)
        const options = LETTERS.filter(l => (r[`${l}_en`] ?? '').trim()).map(l => ({ id: l, text_en: r[`${l}_en`].trim(), text_hi: (r[`${l}_hi`] ?? '').trim() }))
        try {
          await adminSaveQuestion({ module_id: mod?.id ?? null, qtype: (r.qtype || 'single').trim() as AdminQuestion['qtype'], text_en: r.text_en, text_hi: r.text_hi,
            options, correct: (r.correct ?? '').split(/[|,; ]+/).map(x => x.trim().toLowerCase()).filter(Boolean), explain_en: r.explain_en, explain_hi: r.explain_hi, is_active: true })
        } catch (e2) { throw new Error(`Row ${i + 2}: ${(e2 as Error).message}`) }
      }
      load()
    }, 'Questions imported.')
  }

  const setOpt = (i: number, k: keyof QuizOption, v: string) => setEdit(x => ({ ...x, options: (x?.options ?? []).map((o, j) => j === i ? { ...o, [k]: v } : o) }))
  const toggleCorrect = (id: string) => setEdit(x => {
    const multi = x?.qtype === 'multi'
    const cur = x?.correct ?? []
    return { ...x, correct: multi ? (cur.includes(id) ? cur.filter(c => c !== id) : [...cur, id]) : [id] }
  })
  const setType = (t: AdminQuestion['qtype']) => setEdit(x => ({ ...x, qtype: t, correct: [],
    options: t === 'truefalse' ? [{ id: 't', text_en: 'True', text_hi: 'सही' }, { id: 'f', text_en: 'False', text_hi: 'गलत' }]
      : (x?.qtype === 'truefalse' ? LETTERS.slice(0, 4).map(id => ({ id, text_en: '', text_hi: '' })) : x?.options) }))

  const groups: [string | null, string][] = [...mods.map(m => [m.id, `${m.sort_order}. ${m.title_en}`] as [string, string]), [null, 'Final exam only']]
  return (
    <div className="space-y-3">
      <div className="card shadow-sm flex gap-3 flex-wrap items-center text-sm">
        <button onClick={() => setEdit(blankQ(mods[0]?.id ?? null))} className="btn-teal text-sm py-2 px-4">Add a question</button>
        <label className="text-teal-700 underline cursor-pointer">Import CSV<input type="file" accept=".csv,text/csv" className="hidden" disabled={busy === 'import'} onChange={importCsv} /></label>
        <span className="text-xs text-gray-500">CSV columns: module_slug (empty = final only), qtype (single / multi / truefalse), text_en, text_hi, a_en, a_hi … f_en, f_hi, correct (e.g. a or a|c), explain_en, explain_hi. A module needs at least the quiz size in active questions before it can be published; about 3× is better.</span>
      </div>
      {notes}
      {edit && (
        <div className="card shadow-sm space-y-3 text-sm">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">Module
              <select className="input-field mt-1" value={edit.module_id ?? ''} onChange={e => setEdit(x => ({ ...x, module_id: e.target.value || null }))}>
                {groups.map(([id, l]) => <option key={id ?? 'final'} value={id ?? ''}>{l}</option>)}
              </select></label>
            <label className="text-xs text-gray-600">Type
              <select className="input-field mt-1" value={edit.qtype} onChange={e => setType(e.target.value as AdminQuestion['qtype'])}>
                <option value="single">One right answer</option><option value="multi">More than one right answer</option><option value="truefalse">True / false</option>
              </select></label>
            <label className="text-xs text-gray-600 sm:col-span-2">Question (English)<textarea className="input-field mt-1" rows={2} value={edit.text_en ?? ''} onChange={e => setEdit(x => ({ ...x, text_en: e.target.value }))} /></label>
            <label className="text-xs text-gray-600 sm:col-span-2">Question (Hindi)<textarea className="input-field mt-1" rows={2} value={edit.text_hi ?? ''} onChange={e => setEdit(x => ({ ...x, text_hi: e.target.value }))} /></label>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-gray-600">Options — tick the right one{edit.qtype === 'multi' ? 's' : ''}</div>
            {(edit.options ?? []).map((o, i) => (
              <div key={o.id} className="flex gap-2 items-center">
                <input type={edit.qtype === 'multi' ? 'checkbox' : 'radio'} name="correct" checked={(edit.correct ?? []).includes(o.id)} onChange={() => toggleCorrect(o.id)} className="w-5 h-5" />
                <span className="w-4 text-gray-500">{o.id}</span>
                <input className="input-field flex-1" placeholder="English" value={o.text_en} disabled={edit.qtype === 'truefalse'} onChange={e => setOpt(i, 'text_en', e.target.value)} />
                <input className="input-field flex-1" placeholder="Hindi" value={o.text_hi} disabled={edit.qtype === 'truefalse'} onChange={e => setOpt(i, 'text_hi', e.target.value)} />
              </div>
            ))}
            {edit.qtype !== 'truefalse' && (
              <div className="flex gap-3 text-xs">
                {(edit.options?.length ?? 0) < 6 && <button className="text-teal-700 underline" onClick={() => setEdit(x => ({ ...x, options: [...(x?.options ?? []), { id: LETTERS[x?.options?.length ?? 0], text_en: '', text_hi: '' }] }))}>Add option</button>}
                {(edit.options?.length ?? 0) > 2 && <button className="text-gray-500 underline" onClick={() => setEdit(x => { const opts = (x?.options ?? []).slice(0, -1); return { ...x, options: opts, correct: (x?.correct ?? []).filter(c => opts.some(o => o.id === c)) } })}>Remove last</button>}
              </div>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">Explanation (English, shown after a pass)<textarea className="input-field mt-1" rows={2} value={edit.explain_en ?? ''} onChange={e => setEdit(x => ({ ...x, explain_en: e.target.value }))} /></label>
            <label className="text-xs text-gray-600">Explanation (Hindi)<textarea className="input-field mt-1" rows={2} value={edit.explain_hi ?? ''} onChange={e => setEdit(x => ({ ...x, explain_hi: e.target.value }))} /></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.is_active !== false} onChange={e => setEdit(x => ({ ...x, is_active: e.target.checked }))} /> Active</label>
          <div className="flex gap-2">
            <button disabled={busy === 'save'} className="btn-teal text-sm py-2 px-4" onClick={() => run('save', async () => { await adminSaveQuestion(edit); setEdit(null); load() }, 'Question saved.')}>Save</button>
            <button onClick={() => setEdit(null)} className="text-sm text-gray-600 px-2">Cancel</button>
          </div>
        </div>
      )}
      {qs === null ? <p className="text-sm text-gray-400">Loading…</p> : groups.map(([id, label]) => {
        const list = qs.filter(q => q.module_id === id)
        const active = list.filter(q => q.is_active).length
        return (
          <div key={id ?? 'final'} className="card shadow-sm text-sm">
            <div className="font-semibold text-navy-700">{label} <span className="text-xs text-gray-500 font-normal">· {active} active</span></div>
            {list.map(q => (
              <div key={q.id} className="flex items-start justify-between gap-2 border-t border-gray-100 mt-2 pt-2">
                <span className={q.is_active ? '' : 'text-gray-400'}>{q.text_en} <span className="text-xs text-gray-400">· {q.qtype} · answer {q.correct.join(', ')}</span></span>
                <button onClick={() => setEdit(q)} className="text-teal-700 underline text-xs shrink-0">Edit</button>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── FAQ ─────────────────────────────────────────────────────────────────────
const toList = (s: string) => s.split(/[|;,]/).map(x => x.trim()).filter(Boolean)

function Faq() {
  const [faqs, setFaqs] = useState<CareFaq[] | null>(null)
  const [edit, setEdit] = useState<(Partial<CareFaq> & { kw_en?: string; kw_hi?: string }) | null>(null)
  const { busy, run, notes } = useRun()
  const load = useCallback(() => { careFaq().then(setFaqs, () => setFaqs([])) }, [])
  useEffect(() => { load() }, [load])

  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    await run('import', async () => {
      const rows = parseCsv(await file.text())
      if (!rows.length || !('question_en' in rows[0])) throw new Error('This does not look like the FAQ CSV (needs id, category, question_en, question_hi, answer_en, answer_hi…).')
      let n = 0
      for (const r of rows) {
        await adminSaveFaq({ id: r.id, category: r.category, sort_order: Number(r.sort_order) || 0, keywords_en: toList(r.keywords_en ?? ''),
          keywords_hi: toList(r.keywords_hi ?? ''), question_en: r.question_en, question_hi: r.question_hi, answer_en: r.answer_en,
          answer_hi: r.answer_hi, link_path: r.link_path || null, is_active: true })
        n++
      }
      load()
      return n
    }, 'CSV imported.')
  }

  const save = () => run('save', async () => {
    const { kw_en, kw_hi, helpful_yes: _y, helpful_no: _n, ...rest } = edit!
    await adminSaveFaq({ ...rest, keywords_en: toList(kw_en ?? ''), keywords_hi: toList(kw_hi ?? '') })
    setEdit(null); load()
  }, 'Answer saved.')
  const t = (k: 'question_en' | 'question_hi' | 'answer_en' | 'answer_hi' | 'kw_en' | 'kw_hi', label: string, area = false) => (
    <label className="text-xs text-gray-600 block sm:col-span-2">{label}
      {area ? <textarea className="input-field mt-1" rows={4} value={(edit?.[k] as string) ?? ''} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} />
            : <input className="input-field mt-1" value={(edit?.[k] as string) ?? ''} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} />}
    </label>
  )

  return (
    <div className="space-y-3">
      <div className="card shadow-sm flex gap-3 flex-wrap items-center text-sm">
        <button onClick={() => setEdit({ is_active: true, category: 'Account & Support', sort_order: 0 })} className="btn-teal text-sm py-2 px-4">Add an answer</button>
        <label className="text-teal-700 underline cursor-pointer">Import CSV<input type="file" accept=".csv,text/csv" className="hidden" disabled={busy === 'import'} onChange={importCsv} /></label>
        <span className="text-xs text-gray-500">Use {'{{cert_fee}}'}, {'{{pass_mark}}'}, {'{{retake_hours}}'}, {'{{min_payout}}'}, {'{{site}}'}… — filled from Settings.</span>
      </div>
      {notes}
      {edit && (
        <div className="card shadow-sm space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-xs text-gray-600">Id<input className="input-field mt-1" disabled={!!faqs?.some(f => f.id === edit.id) && !!edit.question_en} value={edit.id ?? ''} onChange={e => setEdit(x => ({ ...x, id: e.target.value }))} /></label>
            <label className="text-xs text-gray-600">Category<input className="input-field mt-1" value={edit.category ?? ''} onChange={e => setEdit(x => ({ ...x, category: e.target.value }))} /></label>
            <label className="text-xs text-gray-600">Order<input className="input-field mt-1" type="number" value={edit.sort_order ?? 0} onChange={e => setEdit(x => ({ ...x, sort_order: Number(e.target.value) }))} /></label>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {t('question_en', 'Question (English)')}{t('question_hi', 'Question (Hindi)')}
            {t('answer_en', 'Answer (English)', true)}{t('answer_hi', 'Answer (Hindi)', true)}
            {t('kw_en', 'Keywords, English and Roman Hindi (separate with |)')}{t('kw_hi', 'Keywords, Hindi (separate with |)')}
          </div>
          <label className="text-xs text-gray-600 block">Link path<input className="input-field mt-1" value={edit.link_path ?? ''} onChange={e => setEdit(x => ({ ...x, link_path: e.target.value }))} placeholder="/partner/learn" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.is_active !== false} onChange={e => setEdit(x => ({ ...x, is_active: e.target.checked }))} /> Shown</label>
          <div className="flex gap-2"><button disabled={busy === 'save'} onClick={save} className="btn-teal text-sm py-2 px-4">Save</button><button onClick={() => setEdit(null)} className="text-sm text-gray-600 px-2">Cancel</button></div>
        </div>
      )}
      {faqs === null ? <p className="text-sm text-gray-400">Loading…</p> : faqs.map(f => (
        <div key={f.id} className="card shadow-sm text-sm flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-gray-500">{f.category} · {f.id}{f.is_active ? '' : ' · hidden'}</div>
            <div className="font-semibold text-gray-800">{f.question_en}</div>
            <div className="text-xs text-gray-500">{f.question_hi}</div>
            <div className="text-xs text-gray-400 mt-0.5">Helpful: {f.helpful_yes} yes · {f.helpful_no} no</div>
          </div>
          <button onClick={() => setEdit({ ...f, kw_en: f.keywords_en.join(' | '), kw_hi: f.keywords_hi.join(' | ') })} className="text-teal-700 underline text-xs">Edit</button>
        </div>
      ))}
    </div>
  )
}

// ── Contracts ───────────────────────────────────────────────────────────────
const KINDS: [string, string][] = [['partner_agreement', 'Partner Agreement'], ['code_of_conduct', 'Code of Conduct'], ['reward_policy', 'Rewards Policy'], ['privacy_notice', 'Privacy notice'], ['fee_terms', 'Certification fee terms']]

function Contracts() {
  const [list, setList] = useState<CareContract[] | null>(null)
  const [edit, setEdit] = useState<Partial<CareContract> | null>(null)
  const { busy, run, notes } = useRun()
  const load = useCallback(() => { careContracts().then(setList, () => setList([])) }, [])
  useEffect(() => { load() }, [load])
  const upload = (lang: 'hi' | 'en') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file || !edit) return
    await run('upload', async () => {
      const path = await adminUploadPdf('contracts', `${edit.kind}-${edit.version}-${lang}`, file)
      setEdit(x => ({ ...x, [lang === 'hi' ? 'pdf_path_hi' : 'pdf_path_en']: path }))
    }, 'PDF uploaded. Save to keep it.')
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Legal text must be reviewed by the lawyer before a version is made current. Acceptance by partners comes in Phase 3.</p>
      {notes}
      {edit ? (
        <div className="card shadow-sm space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">Document
              <select className="input-field mt-1" value={edit.kind ?? ''} onChange={e => { const k = KINDS.find(x => x[0] === e.target.value); setEdit(x => ({ ...x, kind: e.target.value, title_en: x?.title_en || k?.[1] })) }}>
                <option value="">Choose</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
            <label className="text-xs text-gray-600">Version<input className="input-field mt-1" value={edit.version ?? ''} onChange={e => setEdit(x => ({ ...x, version: e.target.value }))} placeholder="v1" /></label>
            <label className="text-xs text-gray-600">Title (English)<input className="input-field mt-1" value={edit.title_en ?? ''} onChange={e => setEdit(x => ({ ...x, title_en: e.target.value }))} /></label>
            <label className="text-xs text-gray-600">Title (Hindi)<input className="input-field mt-1" value={edit.title_hi ?? ''} onChange={e => setEdit(x => ({ ...x, title_hi: e.target.value }))} /></label>
            <label className="text-xs text-gray-600">Effective from<input type="date" className="input-field mt-1" value={edit.effective_from ?? ''} onChange={e => setEdit(x => ({ ...x, effective_from: e.target.value }))} /></label>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {(['hi', 'en'] as const).map(l => (
              <div key={l} className="bg-gray-50 rounded-lg p-2 text-xs">
                PDF ({l === 'hi' ? 'Hindi' : 'English'}): {(l === 'hi' ? edit.pdf_path_hi : edit.pdf_path_en)?.split('/').pop() ?? 'none'}
                <input type="file" accept="application/pdf" className="block mt-1" disabled={!edit.kind || !edit.version || busy === 'upload'} onChange={upload(l)} />
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.is_current} onChange={e => setEdit(x => ({ ...x, is_current: e.target.checked }))} /> Make this the current version</label>
          <div className="flex gap-2">
            <button disabled={busy === 'save'} className="btn-teal text-sm py-2 px-4" onClick={() => run('save', async () => { await adminSaveContract(edit); setEdit(null); load() }, 'Saved.')}>Save</button>
            <button onClick={() => setEdit(null)} className="text-sm text-gray-600 px-2">Cancel</button>
          </div>
        </div>
      ) : <button onClick={() => setEdit({ is_current: false })} className="btn-teal text-sm py-2 px-4">Add a version</button>}
      {list === null ? <p className="text-sm text-gray-400">Loading…</p> : KINDS.map(([k, label]) => (
        <div key={k} className="card shadow-sm text-sm">
          <div className="font-semibold text-navy-700">{label}</div>
          {list.filter(c => c.kind === k).map(c => (
            <div key={c.id} className="flex items-center justify-between gap-2 border-t border-gray-100 mt-2 pt-2">
              <span>{c.version} · {c.title_en}{c.effective_from ? ` · from ${day(c.effective_from)}` : ''} · PDF {c.pdf_path_hi || c.pdf_path_en ? '✓' : '—'}</span>
              <span className="flex items-center gap-2">
                {c.is_current && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Current</span>}
                <button onClick={() => setEdit(c)} className="text-teal-700 underline text-xs">Edit</button>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Settings ────────────────────────────────────────────────────────────────
const FIELDS: [string, string][] = [
  ['cert_fee', 'Certification fee ₹ (all taxes included)'], ['pass_mark', 'Pass mark %'], ['module_questions', 'Questions per module quiz'],
  ['final_questions', 'Questions in the final exam'], ['retake_hours', 'Wait before a retake (hours)'], ['doc_min_seconds', 'Minimum time before "I have read this" (seconds)'],
  ['video_done_pct', 'Video counts as watched at %'], ['lead_lock_days', 'Days a reserved doctor stays with the partner'], ['lead_cap_new', 'Reserved doctors for a new partner'],
  ['claim_days', 'Days to claim after a payment'], ['refund_window_days', 'Days before a reward is approved'], ['min_payout', 'Minimum payout ₹'],
  ['inactive_days', 'Days to first business before pause'], ['ticket_sla_hours', 'Reply target (hours)'], ['start_reward_cap', 'Start Reward cap per business ₹'],
  ['renewal_grace_days', 'Renewal grace (days)'], ['contact_email', 'Contact email'],
]

function Settings() {
  const [s, setS] = useState<Record<string, string> | null>(null)
  const [orig, setOrig] = useState<Record<string, string>>({})
  const [sure, setSure] = useState(false)
  const { busy, run, notes } = useRun()
  const load = useCallback(() => { adminCareSettings().then(x => { setS(x); setOrig(x) }, () => setS({})) }, [])
  useEffect(() => { load() }, [load])
  if (!s) return <p className="text-sm text-gray-400">Loading…</p>
  const on = s.program_enabled === 'on'
  const changed = Object.fromEntries(FIELDS.filter(([k]) => s[k] !== orig[k]).map(([k]) => [`partner_${k}`, s[k]]))

  return (
    <div className="space-y-3">
      {notes}
      <div className={`card shadow-sm ${on ? 'border border-green-200' : 'border border-amber-200'}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold text-navy-700">Partner Program is {on ? 'ON' : 'OFF'}</div>
            <p className="text-xs text-gray-500">{on ? 'The /partner pages, sign-in and registration are open.' : 'Pages say "opens soon"; nobody can sign in or register.'} Before switching on in production: lawyer's opinion, content for Modules 1–10, CA sign-off.</p>
          </div>
          {on ? <button disabled={busy === 'sw'} onClick={() => run('sw', async () => { await adminSaveSettings({ partner_program_enabled: 'off' }); load() }, 'Switched off.')} className="text-sm py-2 px-4 rounded-lg border border-red-200 text-red-700">Switch off</button>
            : sure ? <span className="flex gap-2 items-center"><button disabled={busy === 'sw'} onClick={() => run('sw', async () => { await adminSaveSettings({ partner_program_enabled: 'on' }); setSure(false); load() }, 'Switched on.')} className="btn-teal text-sm py-2 px-4">Yes, switch on</button><button onClick={() => setSure(false)} className="text-sm text-gray-600">Cancel</button></span>
            : <button onClick={() => setSure(true)} className="btn-teal text-sm py-2 px-4">Switch on</button>}
        </div>
      </div>
      <div className="card shadow-sm grid sm:grid-cols-2 gap-3">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="text-xs text-gray-600">{label}
            <input className="input-field mt-1" value={s[k] ?? ''} inputMode={k === 'contact_email' ? 'email' : 'decimal'} onChange={e => setS({ ...s, [k]: e.target.value })} />
          </label>
        ))}
        <div className="sm:col-span-2">
          <button disabled={busy === 'save' || !Object.keys(changed).length} className="btn-teal text-sm py-2 px-4 disabled:opacity-50"
            onClick={() => run('save', async () => { await adminSaveSettings(changed); load() }, 'Settings saved.')}>Save {Object.keys(changed).length || ''} change{Object.keys(changed).length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  )
}
