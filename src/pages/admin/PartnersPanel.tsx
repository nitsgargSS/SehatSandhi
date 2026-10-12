import { useCallback, useEffect, useState } from 'react'
import {
  Partner, Credit, Statement, getPartners, savePartner, setPartnerRate, getCredits, decideCredit,
  getStatement, excludeLine, finaliseStatement, markStatementPaid, heardLabel,
} from '../../lib/partnersApi'

// 0255: marketing partners. Three things on one screen:
//   1. businesses waiting for a decision — who brought them (nothing is credited until approved);
//   2. the partners, their dates and their percentage (changed from a date, never backwards);
//   3. a partner's statement for a month — draft until finalised, then fixed and marked paid.

const rs = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) }
const blank = { id: null as string | null, name: '', code: '', kind: 'online', contact_name: '', phone: '', email: '', notes: '', active_from: today(), active_to: '' }

export default function PartnersPanel() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [credits, setCredits] = useState<Credit[]>([])
  const [show, setShow] = useState<'proposed' | 'approved' | 'direct'>('proposed')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState<typeof blank | null>(null)
  const [rateFor, setRateFor] = useState<string | null>(null)
  const [rate, setRate] = useState({ percent: '', from: today() })
  const [pick, setPick] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [sp, setSp] = useState('')            // statement: partner
  const [sm, setSm] = useState(lastMonth())    // statement: month, YYYY-MM
  const [st, setSt] = useState<Statement | null>(null)
  const [paid, setPaid] = useState({ on: today(), ref: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    getPartners().then(setPartners).catch(e => setErr((e as Error).message))
    getCredits().then(setCredits).catch(e => setErr((e as Error).message))
  }, [])
  useEffect(load, [load])
  const loadStatement = useCallback(() => {
    if (!sp || !sm) { setSt(null); return }
    getStatement(sp, `${sm}-01`).then(setSt).catch(e => setErr((e as Error).message))
  }, [sp, sm])
  useEffect(loadStatement, [loadStatement])

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setErr(''); setMsg('')
    try { await fn(); if (done) setMsg(done); load(); loadStatement() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const waiting = credits.filter(c => c.status === 'proposed')
  const list = credits.filter(c => c.status === show)
  const input = 'input-field text-sm'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-navy-700">Marketing partners</h2>
        <p className="text-sm text-gray-500">Who brought each business, and the incentive they are owed on what that business pays. Nothing is credited to a partner until you approve it.</p>
      </div>
      {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}

      {/* 1. Who brought each business */}
      <div className="card shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-navy-700">Businesses {waiting.length > 0 && <span className="ml-1 bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full">{waiting.length} to decide</span>}</h3>
          <div className="flex gap-1 text-xs">
            {(['proposed', 'approved', 'direct'] as const).map(s => (
              <button key={s} onClick={() => setShow(s)} className={`px-3 py-1.5 rounded-full border ${show === s ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                {s === 'proposed' ? 'Waiting for you' : s === 'approved' ? 'Credited to a partner' : 'Direct (nobody’s)'} · {credits.filter(c => c.status === s).length}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? <p className="text-sm text-gray-500">Nothing here.</p> : (
          <div className="divide-y">
            {list.map(c => (
              <div key={c.business_id} className="py-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-2 flex-wrap">
                  <div><b>{c.name}</b> <span className="text-gray-500">· {c.vertical}{c.city ? ` · ${c.city}` : ''} · registered {day(c.registered_at)} · {c.business_status}</span></div>
                  <div className="text-gray-600">Paid so far: <b>{rs(c.paid)}</b></div>
                </div>
                <div className="text-gray-600">
                  Says it heard of us from: <b>{heardLabel(c.heard_from)}</b>{c.heard_detail ? ` — “${c.heard_detail}”` : ''}
                  {c.status === 'proposed' && c.proposed && <> · proposed for <b>{c.proposed}</b> (the online partner that day)</>}
                  {c.status === 'approved' && <> · credited to <b>{c.partner}</b></>}
                  {c.decided_by && <span className="text-gray-400"> · decided by {c.decided_by}, {day(c.decided_at)}{c.note ? ` — ${c.note}` : ''}</span>}
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <select className="border border-gray-300 rounded px-2 py-1.5 text-sm" value={pick[c.business_id] ?? c.partner_id ?? c.proposed_id ?? ''}
                    onChange={e => setPick(p => ({ ...p, [c.business_id]: e.target.value }))}>
                    <option value="">Direct — nobody’s</option>
                    {partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (ended)'}</option>)}
                  </select>
                  <input className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1 min-w-[160px]" placeholder="Note (why)" maxLength={200}
                    value={notes[c.business_id] ?? ''} onChange={e => setNotes(n => ({ ...n, [c.business_id]: e.target.value }))} />
                  <button disabled={busy} className="btn-teal text-xs py-1.5 px-3 disabled:opacity-50"
                    onClick={() => run(() => decideCredit(c.business_id, (pick[c.business_id] ?? c.partner_id ?? c.proposed_id ?? '') || null, notes[c.business_id]), 'Saved.')}>
                    {c.status === 'proposed' ? 'Approve' : 'Change'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Partners */}
      <div className="card shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-navy-700">Partners</h3>
          <button className="btn-teal text-xs py-1.5 px-3" onClick={() => setForm({ ...blank })}>Add a partner</button>
        </div>
        {form && (
          <div className="bg-gray-50 border rounded-lg p-3 space-y-2">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <input className={input} placeholder="Firm or person's name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <input className={input} placeholder="Short code, e.g. FIRM-A" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              <select className={input} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                <option value="online">Online marketing (one at a time)</option><option value="field">Field — brings businesses in person</option>
              </select>
              <input className={input} placeholder="Contact person" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
              <input className={input} placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              <input className={input} placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              <label className="text-xs text-gray-500">Associated from<input type="date" className={input} value={form.active_from} onChange={e => setForm({ ...form, active_from: e.target.value })} /></label>
              <label className="text-xs text-gray-500">Until (leave empty while it continues)<input type="date" className={input} value={form.active_to} onChange={e => setForm({ ...form, active_to: e.target.value })} /></label>
            </div>
            <input className={input} placeholder="Notes — the agreement, in a line" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            <p className="text-xs text-gray-500">An <b>online</b> partner is proposed for every business that registers itself while it is active. The incentive stops on the end date, including on businesses it brought.</p>
            <div className="flex gap-2">
              <button disabled={busy} className="btn-teal text-xs py-1.5 px-3 disabled:opacity-50" onClick={() => run(async () => { await savePartner(form); setForm(null) }, 'Partner saved.')}>Save</button>
              <button className="btn-outline text-xs py-1.5 px-3" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </div>
        )}
        {partners.length === 0 && !form ? <p className="text-sm text-gray-500">No partners yet. Add your online marketing firm to start.</p> : (
          <div className="divide-y">
            {partners.map(p => (
              <div key={p.id} className="py-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-2 flex-wrap">
                  <div>
                    <b>{p.name}</b> <span className="font-mono text-xs text-gray-500">{p.code}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${p.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{p.active ? 'Active' : p.active_from > today() ? 'Not started' : 'Ended'}</span>
                    <span className="ml-2 text-xs text-gray-500">{p.kind === 'online' ? 'Online marketing' : 'Field'} · {day(p.active_from)} → {p.active_to ? day(p.active_to) : 'continuing'}</span>
                  </div>
                  <div>Incentive now: <b>{Number(p.percent)}%</b> of what its businesses pay · {p.businesses} businesses{p.waiting ? ` · ${p.waiting} waiting` : ''}</div>
                </div>
                {(p.contact_name || p.phone || p.email || p.notes) && <div className="text-gray-500 text-xs">{[p.contact_name, p.phone, p.email, p.notes].filter(Boolean).join(' · ')}</div>}
                {p.rates.length > 0 && <div className="text-xs text-gray-500">Percentage history: {p.rates.map(r => `${Number(r.percent)}% from ${day(r.effective_from)}`).join(' · ')}</div>}
                <div className="flex gap-2 flex-wrap items-center">
                  <button className="btn-outline text-xs py-1.5 px-3" onClick={() => setForm({ id: p.id, name: p.name, code: p.code, kind: p.kind, contact_name: p.contact_name ?? '', phone: p.phone ?? '', email: p.email ?? '', notes: p.notes ?? '', active_from: p.active_from, active_to: p.active_to ?? '' })}>Edit / set end date</button>
                  <button className="btn-outline text-xs py-1.5 px-3" onClick={() => { setRateFor(rateFor === p.id ? null : p.id); setRate({ percent: String(Number(p.percent) || ''), from: today() }) }}>Change percentage</button>
                  <button className="btn-outline text-xs py-1.5 px-3" onClick={() => setSp(p.id)}>Statement</button>
                </div>
                {rateFor === p.id && (
                  <div className="bg-gray-50 border rounded-lg p-3 flex gap-2 items-end flex-wrap text-xs">
                    <label className="text-gray-500">Percentage<input className={input + ' w-24'} inputMode="decimal" value={rate.percent} onChange={e => setRate({ ...rate, percent: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
                    <label className="text-gray-500">Applies to payments from<input type="date" className={input} value={rate.from} onChange={e => setRate({ ...rate, from: e.target.value })} /></label>
                    <button disabled={busy || rate.percent === ''} className="btn-teal text-xs py-1.5 px-3 disabled:opacity-50"
                      onClick={() => run(async () => { await setPartnerRate(p.id, Number(rate.percent), rate.from); setRateFor(null) }, 'Percentage saved.')}>Save</button>
                    <span className="text-gray-500 basis-full">Payments before that date keep the earlier percentage. A month already finalised cannot be changed.</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Statement */}
      <div className="card shadow-sm space-y-3">
        <h3 className="font-bold text-navy-700">Monthly statement</h3>
        <div className="flex gap-2 flex-wrap items-end text-xs">
          <label className="text-gray-500">Partner
            <select className={input} value={sp} onChange={e => setSp(e.target.value)}><option value="">Choose…</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="text-gray-500">Month<input type="month" className={input} value={sm} onChange={e => setSm(e.target.value)} /></label>
        </div>
        {st && sp && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between gap-2 flex-wrap items-center">
              <div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${st.status === 'draft' ? 'bg-amber-100 text-amber-800' : st.status === 'final' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                  {st.status === 'draft' ? 'Draft — recalculated each time you open it' : st.status === 'final' ? `Final · by ${st.finalised_by ?? '—'}, ${day(st.finalised_at)}` : `Paid ${day(st.paid_on)}${st.paid_reference ? ` · ${st.paid_reference}` : ''}`}
                </span>
              </div>
              <div className="text-base">Incentive due: <b>{rs(st.total)}</b></div>
            </div>
            {st.lines.length === 0 ? <p className="text-gray-500">No payments from this partner’s businesses in this month.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Date</th><th>Business</th><th>What</th><th className="text-right">Paid (ex-GST)</th><th className="text-right">%</th><th className="text-right">Incentive</th><th /></tr></thead>
                  <tbody>
                    {st.lines.map(l => (
                      <tr key={l.ref} className={`border-t ${l.excluded ? 'text-gray-400 line-through' : ''}`}>
                        <td className="py-1.5 whitespace-nowrap">{day(l.paid_on)}</td><td>{l.business}</td>
                        <td className="text-xs">{l.kind === 'refund' ? 'Refund — ' : ''}{l.detail}{l.excluded && l.reason ? <span className="no-underline"> · left out: {l.reason}</span> : null}</td>
                        <td className="text-right">{rs(l.base)}</td><td className="text-right">{Number(l.percent)}%</td><td className="text-right">{rs(l.incentive)}</td>
                        <td className="text-right">
                          {st.status === 'draft' && (l.excluded
                            ? <button className="text-teal-700 underline text-xs" onClick={() => run(() => excludeLine(sp, `${sm}-01`, l.ref, ''))}>Put back</button>
                            : <button className="text-red-600 underline text-xs" onClick={() => { const why = window.prompt('Why is this line left out of the statement?'); if (why && why.trim()) run(() => excludeLine(sp, `${sm}-01`, l.ref, why)) }}>Leave out</button>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {st.status === 'draft' && (
              <div className="flex gap-2 items-center flex-wrap">
                <button disabled={busy} className="btn-teal text-xs py-1.5 px-3 disabled:opacity-50"
                  onClick={() => { if (window.confirm(`Finalise this statement at ${rs(st.total)}? It cannot be changed afterwards.`)) run(() => finaliseStatement(sp, `${sm}-01`), 'Statement finalised.') }}>Finalise this month</button>
                <span className="text-xs text-gray-500">A month can be finalised once it has ended. After that it is a fixed record.</span>
              </div>
            )}
            {st.status === 'final' && (
              <div className="flex gap-2 items-end flex-wrap text-xs">
                <label className="text-gray-500">Paid on<input type="date" className={input} value={paid.on} onChange={e => setPaid({ ...paid, on: e.target.value })} /></label>
                <label className="text-gray-500">Bank / UPI reference<input className={input} value={paid.ref} onChange={e => setPaid({ ...paid, ref: e.target.value })} /></label>
                <button disabled={busy} className="btn-teal text-xs py-1.5 px-3 disabled:opacity-50" onClick={() => run(() => markStatementPaid(sp, `${sm}-01`, paid.on, paid.ref), 'Marked as paid.')}>Mark as paid</button>
              </div>
            )}
            <p className="text-xs text-gray-500">Counted: plan and renewal fees actually received, without GST, on the day they came in, while the partner was associated. Not counted: WhatsApp wallet top-ups. A refund is taken back in the month it is made.</p>
          </div>
        )}
      </div>
    </div>
  )
}
