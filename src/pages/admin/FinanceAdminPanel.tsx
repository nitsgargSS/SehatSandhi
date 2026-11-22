import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  adminLenders, adminCreateLender, adminSetLender, adminFinanceSwitch, adminCases, adminCommission, caseEvents,
  commissionInvoices, issueCommissionInvoice, markCommissionPaid,
  financeEnabled, CASE_STATUS, LENDER_STATUS, CASE_EVENT,
  type AdminLender, type AdminCase, type CommissionRow, type CaseEvent, type CaseStatus, type CommissionInvoice,
} from '../../lib/financeApi'
import { downloadCsv } from '../../lib/billingApi'

// Treatment on EMI — Sehatsandhi admin (0329, step 5).
//
//   Overview    the site switch, case counts, stuck cases, lenders waiting.
//   Lenders     add a lender's account; approve (RBI checked, LSP agreement
//               signed — the database insists on the date), set commission,
//               suspend.
//   Cases       every case, its lenders and its history.
//   Commission  loans paid out in a month, per lender, at each agreed rate —
//               the basis of the monthly invoice to each lender.
//
// Admins only (owner/admin roles); managers have no EMI tab and RLS shows
// them nothing.

const inr = (n: number | null | undefined) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const day = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const OPEN: CaseStatus[] = ['requested', 'hospital_confirmed', 'shared', 'offered', 'sanctioned', 'disbursed']
const STUCK_DAYS = 5
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) }
const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

type View = 'overview' | 'lenders' | 'cases' | 'commission'

export default function FinanceAdminPanel() {
  const [view, setView] = useState<View>('overview')
  const [on, setOn] = useState<boolean | null>(null)
  const [lenders, setLenders] = useState<AdminLender[]>([])
  const [cases, setCases] = useState<AdminCase[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [o, l, c] = await Promise.all([financeEnabled(), adminLenders(), adminCases()])
      setOn(o); setLenders(l); setCases(c); setErr('')
    } catch (e) { setErr((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id); setErr(''); setMsg('')
    try { await fn(); await load(); if (done) { setMsg(done); setTimeout(() => setMsg(''), 4000) } }
    catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const pendingLenders = lenders.filter(l => l.status === 'pending').length
  const stuck = useMemo(() => cases.filter(c => OPEN.includes(c.status)
    && Date.now() - new Date(c.updated_at).getTime() > STUCK_DAYS * 86400000), [cases])

  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <h2 className="font-bold text-navy-700 text-lg">Treatment on EMI</h2>
        <p className="text-sm text-gray-500">Lenders pay hospitals; we connect and track, and earn the lender's commission. Patients never pay us.</p>
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {([['overview', 'Overview'], ['lenders', `Lenders${pendingLenders ? ` (${pendingLenders})` : ''}`], ['cases', `Cases${stuck.length ? ` (${stuck.length} stuck)` : ''}`], ['commission', 'Commission']] as [View, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ${view === id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>{label}</button>
          ))}
        </div>
        {msg && <p className="text-sm text-green-700 mt-2">{msg}</p>}
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </div>

      {view === 'overview' && <Overview on={on} cases={cases} stuck={stuck} pendingLenders={pendingLenders} busy={busy === 'switch'}
        onSwitch={next => run('switch', async () => { await adminFinanceSwitch(next); setOn(next) }, next ? 'EMI is on.' : 'EMI is off.')} />}
      {view === 'lenders' && <Lenders lenders={lenders} busy={busy} run={run} />}
      {view === 'cases' && <Cases cases={cases} stuck={stuck} />}
      {view === 'commission' && <Commission />}
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────

function Overview({ on, cases, stuck, pendingLenders, busy, onSwitch }: {
  on: boolean | null; cases: AdminCase[]; stuck: AdminCase[]; pendingLenders: number; busy: boolean; onSwitch: (on: boolean) => void
}) {
  const [sure, setSure] = useState(false)
  const count = (s: CaseStatus[]) => cases.filter(c => s.includes(c.status)).length
  const paid = cases.filter(c => c.status === 'disbursed' || c.status === 'closed')
  const paidValue = paid.reduce((a, c) => a + Number(c.lenders.find(l => l.status === 'disbursed')?.disbursed_amount ?? 0), 0)
  const tile = (label: string, value: string | number) => (
    <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">{label}</div><div className="font-bold text-navy-700 text-xl">{value}</div></div>
  )
  return (
    <>
      <div className={`card shadow-sm ${on ? 'border border-green-200' : 'border border-amber-200'}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold text-navy-700">EMI is {on === null ? '…' : on ? 'ON' : 'OFF'}</div>
            <p className="text-xs text-gray-500">
              {on ? 'Hospitals, patients (website, app, WhatsApp bot) and lenders can use it.'
                : 'Hidden from hospitals, patients and the bot. Admins can still test every step.'}
            </p>
          </div>
          {on !== null && (on
            ? <button disabled={busy} onClick={() => onSwitch(false)} className="text-sm py-2 px-4 rounded-lg border border-red-200 text-red-700">Switch off</button>
            : sure
              ? <div className="flex gap-2 items-center"><span className="text-xs text-gray-600">Shows EMI to every hospital, patient and the bot.</span>
                  <button disabled={busy} onClick={() => { setSure(false); onSwitch(true) }} className="btn-teal text-sm py-2 px-4">Yes, switch on</button>
                  <button onClick={() => setSure(false)} className="text-sm text-gray-600">Cancel</button></div>
              : <button onClick={() => setSure(true)} className="btn-teal text-sm py-2 px-4">Switch on</button>)}
        </div>
      </div>
      <div className="card shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tile('Waiting for hospital', count(['requested']))}
          {tile('Waiting for patient', count(['hospital_confirmed']))}
          {tile('With lenders', count(['shared', 'offered', 'sanctioned']))}
          {tile('Paid to hospitals', `${paid.length} · ${inr(paidValue)}`)}
          {tile('Declined', count(['declined']))}
          {tile('Withdrawn / expired', count(['withdrawn', 'expired']))}
          {tile(`Stuck ${STUCK_DAYS}+ days`, stuck.length)}
          {tile('Lenders to review', pendingLenders)}
        </div>
        <p className="text-xs text-gray-500 mt-2">Cases with no movement for 15 days before a sanction expire automatically each night.</p>
      </div>
    </>
  )
}

// ── Lenders ─────────────────────────────────────────────────────────────────

function Lenders({ lenders, busy, run }: {
  lenders: AdminLender[]; busy: string | null
  run: (id: string, fn: () => Promise<unknown>, done?: string) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', legalName: '', entityType: 'nbfc' as 'bank' | 'nbfc', phone: '', email: '' })
  const [edit, setEdit] = useState<Record<string, { pct: string; lsp: string }>>({})
  const ed = (l: AdminLender) => edit[l.business_id] ?? { pct: l.commission_pct != null ? String(l.commission_pct) : '', lsp: l.lsp_agreement_on ?? '' }
  const setEd = (id: string, v: { pct: string; lsp: string }) => setEdit(e => ({ ...e, [id]: v }))

  return (
    <div className="space-y-3">
      {adding ? (
        <div className="card shadow-sm space-y-3">
          <h3 className="font-bold text-navy-700">Add a lender</h3>
          <p className="text-xs text-gray-500">Creates their login: they sign in at Business login with a WhatsApp code sent to this number, then fill in their profile. Patients see them only after you approve.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">Display name<input className="input-field mt-1" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. ABC Finance" /></label>
            <label className="text-xs text-gray-600">Legal name<input className="input-field mt-1" value={f.legalName} onChange={e => setF({ ...f, legalName: e.target.value })} placeholder="e.g. ABC Finance Ltd" /></label>
            <label className="text-xs text-gray-600">Type
              <select className="input-field mt-1" value={f.entityType} onChange={e => setF({ ...f, entityType: e.target.value as 'bank' | 'nbfc' })}><option value="nbfc">NBFC</option><option value="bank">Bank</option></select></label>
            <label className="text-xs text-gray-600">Contact's WhatsApp number<input className="input-field mt-1" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="10 digits" /></label>
            <label className="text-xs text-gray-600 sm:col-span-2">Contact email (optional)<input className="input-field mt-1" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
          </div>
          <div className="flex gap-2">
            <button disabled={busy === 'add'} className="btn-teal text-sm py-2 px-4"
              onClick={() => run('add', async () => { await adminCreateLender(f); setAdding(false); setF({ name: '', legalName: '', entityType: 'nbfc', phone: '', email: '' }) }, 'Lender account created.')}>Create account</button>
            <button onClick={() => setAdding(false)} className="text-sm text-gray-600 px-2">Cancel</button>
          </div>
        </div>
      ) : <button onClick={() => setAdding(true)} className="btn-teal text-sm py-2 px-4">Add a lender</button>}

      {lenders.length === 0 && <div className="card shadow-sm text-sm text-gray-500">No lenders yet.</div>}
      {lenders.map(l => {
        const e = ed(l)
        return (
          <div key={l.business_id} className="card shadow-sm text-sm space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-navy-700">{l.legal_name}{l.business?.name && l.business.name !== l.legal_name ? ` (${l.business.name})` : ''}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${l.status === 'approved' ? 'bg-green-100 text-green-800' : l.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{l.status}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-1 text-xs text-gray-600">
              <div>{l.entity_type === 'bank' ? 'Bank' : 'NBFC'} · RBI no. {l.rbi_reg_no || <b className="text-amber-700">not given</b>}</div>
              <div>Login: {l.business?.phone ?? '—'}{l.business?.email ? ` · ${l.business.email}` : ''}</div>
              <div>Grievance: {[l.grievance_name, l.grievance_email, l.grievance_phone].filter(Boolean).join(' · ') || <b className="text-amber-700">not given</b>}</div>
              <div>Pays: {l.pays_to === 'hospital' ? 'the hospital' : 'the patient'} · {inr(l.min_amount)}{l.max_amount ? `–${inr(l.max_amount)}` : '+'}{l.tenures ? ` · ${l.tenures}` : ''}</div>
              {l.terms_summary && <div className="sm:col-span-2">Terms: {l.terms_summary}</div>}
              {l.journey_url && <div className="sm:col-span-2 truncate">Application link: {l.journey_url}</div>}
              <div>Approved: {day(l.approved_at)}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-600">
              Before approving: RBI registration checked on rbi.org.in · Sehatsandhi listed as their sourcing partner (LSP/DSA) on their website · LSP agreement signed and reviewed by our lawyer.
            </div>
            <div className="flex gap-2 flex-wrap items-end">
              <label className="text-xs text-gray-600">Commission %<input className="input-field w-24" inputMode="decimal" value={e.pct} onChange={x => setEd(l.business_id, { ...e, pct: x.target.value.replace(/[^\d.]/g, '') })} /></label>
              <label className="text-xs text-gray-600">LSP agreement signed<input className="input-field" type="date" value={e.lsp} onChange={x => setEd(l.business_id, { ...e, lsp: x.target.value })} /></label>
              {l.status !== 'approved'
                ? <button disabled={busy === l.business_id} className="btn-teal text-sm py-2 px-3"
                    onClick={() => run(l.business_id, () => adminSetLender(l.business_id, 'approved', e.pct === '' ? null : Number(e.pct), e.lsp), 'Lender approved.')}>Approve</button>
                : <button disabled={busy === l.business_id} className="text-sm py-2 px-3 rounded-lg border border-gray-200"
                    onClick={() => run(l.business_id, () => adminSetLender(l.business_id, 'approved', e.pct === '' ? null : Number(e.pct), e.lsp), 'Saved.')}>Save</button>}
              {l.status !== 'suspended' && <button disabled={busy === l.business_id} className="text-sm py-2 px-3 rounded-lg border border-red-200 text-red-700"
                onClick={() => run(l.business_id, () => adminSetLender(l.business_id, 'suspended'), 'Lender suspended.')}>Suspend</button>}
              {l.status === 'suspended' && <button disabled={busy === l.business_id} className="text-sm py-2 px-3 rounded-lg border border-gray-200"
                onClick={() => run(l.business_id, () => adminSetLender(l.business_id, 'pending'), 'Back to review.')}>Back to review</button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Cases ───────────────────────────────────────────────────────────────────

function Cases({ cases, stuck }: { cases: AdminCase[]; stuck: AdminCase[] }) {
  const [filter, setFilter] = useState<'stuck' | 'open' | 'all'>(stuck.length ? 'stuck' : 'open')
  const [q, setQ] = useState('')
  const shown = (filter === 'stuck' ? stuck : filter === 'open' ? cases.filter(c => OPEN.includes(c.status)) : cases)
    .filter(c => !q.trim() || `${c.case_no} ${c.patient_name} ${c.hospital_name} ${c.treatment}`.toLowerCase().includes(q.trim().toLowerCase()))
  const csv = () => downloadCsv(`emi-cases-${new Date().toISOString().slice(0, 10)}.csv`,
    ['case_no,status,hospital,treatment,estimate,loan,started_by,created,updated,lenders',
      ...cases.map(c => [c.case_no, c.status, c.hospital_name, c.treatment, c.estimate_amount, c.requested_amount, c.started_by, c.created_at.slice(0, 10), c.updated_at.slice(0, 10),
        c.lenders.map(l => `${l.lender_name}: ${l.status}`).join('; ')].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n'))
  return (
    <div className="space-y-3">
      <div className="card shadow-sm flex gap-2 flex-wrap items-center">
        {([['stuck', `Stuck ${STUCK_DAYS}+ days (${stuck.length})`], ['open', 'Open'], ['all', 'All']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={`px-3 py-1.5 rounded-full text-sm border ${filter === id ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-gray-600 border-gray-200'}`}>{label}</button>
        ))}
        <input className="input-field flex-1 min-w-[10rem]" placeholder="Case no., patient, hospital" value={q} onChange={e => setQ(e.target.value)} />
        <button onClick={csv} className="text-sm text-teal-700 underline">CSV</button>
      </div>
      {shown.length === 0 ? <div className="card shadow-sm text-sm text-gray-500">No cases here.</div> : shown.map(c => <AdminCaseRow key={c.id} c={c} />)}
    </div>
  )
}

function AdminCaseRow({ c }: { c: AdminCase }) {
  const [events, setEvents] = useState<CaseEvent[] | null>(null)
  const [open, setOpen] = useState(false)
  const toggle = () => { setOpen(o => !o); if (!events) caseEvents(c.id).then(setEvents, () => setEvents([])) }
  return (
    <div className="card shadow-sm text-sm">
      <button onClick={toggle} className="w-full text-left">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-semibold text-navy-700">{c.case_no} · {c.patient_name}</span>
          <span className="text-xs text-gray-600">{CASE_STATUS[c.status]}</span>
        </div>
        <div className="text-gray-600">{c.treatment} · {inr(c.requested_amount)} of {inr(c.estimate_amount)} · {c.hospital_name}</div>
        <div className="text-xs text-gray-400">{c.started_by === 'patient' ? 'Asked by patient' : 'Offered by hospital'} · created {day(c.created_at)} · last change {day(c.updated_at)}</div>
      </button>
      {open && (
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-2">
          {c.lenders.length > 0 && <div className="text-xs text-gray-600">{c.lenders.map(l => `${l.lender_name}: ${LENDER_STATUS[l.status]}${l.disbursed_amount ? ` ${inr(l.disbursed_amount)} UTR ${l.utr}` : ''}`).join(' · ')}</div>}
          <ol className="text-xs text-gray-600 space-y-1 border-l-2 border-gray-200 pl-3">
            {events === null ? <li>Loading…</li> : events.map(e => (
              <li key={e.id}>{new Date(e.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })} · {CASE_EVENT[e.event] ?? e.event} ({e.actor}{e.actor_name ? `: ${e.actor_name}` : ''}){e.note ? ` — ${e.note}` : ''}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

// ── Commission ──────────────────────────────────────────────────────────────

function Commission() {
  const [month, setMonth] = useState(lastMonth())
  const [rows, setRows] = useState<CommissionRow[] | null>(null)
  const [invs, setInvs] = useState<CommissionInvoice[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const { from, to } = monthRange(month)
  const over = to < new Date().toISOString().slice(0, 10)

  const load = useCallback(() => {
    setRows(null); setErr('')
    Promise.all([adminCommission(from, to), commissionInvoices(from)])
      .then(([r, i]) => { setRows(r); setInvs(i) }, e => { setRows([]); setErr((e as Error).message) })
  }, [from, to])
  useEffect(() => { load() }, [load])

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id); setErr(''); setMsg('')
    try { await fn(); load(); setMsg(done); setTimeout(() => setMsg(''), 4000) } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  const total = (rows ?? []).reduce((a, r) => a + Number(r.commission), 0)
  const csv = () => downloadCsv(`emi-commission-${month}.csv`,
    ['lender,commission_pct,loans,paid_value,commission,invoice,invoice_total,paid', ...(rows ?? []).map(r => {
      const inv = invs.find(i => i.business_id === r.lender_id)
      return [r.legal_name, r.commission_pct ?? '', r.loans, r.paid_value, r.commission, inv?.invoice_number ?? '', inv?.total_amount ?? '', inv?.paid_at ? inv.paid_at.slice(0, 10) : '']
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    })].join('\n'))
  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm text-gray-600">Month <input type="month" className="input-field" value={month} onChange={e => setMonth(e.target.value)} /></label>
        {rows && rows.length > 0 && <button onClick={csv} className="text-sm text-teal-700 underline">CSV</button>}
      </div>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? <p className="text-sm text-gray-500">No loans paid out in this month.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[36rem]">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Lender</th><th>Rate</th><th>Loans</th><th>Paid out</th><th>Commission</th><th>Invoice</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const inv = invs.find(i => i.business_id === r.lender_id)
                return (
                  <tr key={r.lender_id} className="border-t border-gray-100 align-top">
                    <td className="py-1.5">{r.legal_name}</td><td>{r.commission_pct != null ? `${r.commission_pct}%` : <b className="text-amber-700">not set</b>}</td>
                    <td>{r.loans}</td><td>{inr(r.paid_value)}</td><td className="font-semibold">{inr(r.commission)}</td>
                    <td className="py-1.5">
                      {inv ? (
                        <div className="space-y-0.5">
                          <a href={`/invoice/${inv.public_token}`} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline">{inv.invoice_number}</a>
                          <div className="text-xs text-gray-500">{inr(inv.total_amount)} incl. GST · {inv.paid_at ? `paid ${day(inv.paid_at)}` : `due ${day(inv.due_on)}`}</div>
                          {inv.paid_at
                            ? <button disabled={busy === inv.id} onClick={() => act(inv.id, () => markCommissionPaid(inv.id, false), 'Marked unpaid.')} className="text-xs text-gray-500 underline">Mark unpaid</button>
                            : <button disabled={busy === inv.id} onClick={() => act(inv.id, () => markCommissionPaid(inv.id, true), 'Marked paid.')} className="text-xs text-teal-700 underline">Mark paid</button>}
                        </div>
                      ) : over && r.commission_pct != null ? (
                        <button disabled={busy === r.lender_id} onClick={() => act(r.lender_id, () => issueCommissionInvoice(r.lender_id, from), 'Invoice issued.')}
                          className="text-sm py-1.5 px-3 rounded-lg border border-teal-300 text-teal-800">Issue invoice</button>
                      ) : <span className="text-xs text-gray-400">{over ? 'Set a rate first' : 'After the month ends'}</span>}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t border-gray-200 font-bold"><td className="py-1.5" colSpan={4}>Total</td><td>{inr(total)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">By date paid out, before GST. "Issue invoice" makes a GST tax invoice from NG Technologies to the lender (18% GST; IGST if the lender's GSTIN is from another state), due in 15 days, in the same number series and GST filing export as our other invoices.</p>
    </div>
  )
}
