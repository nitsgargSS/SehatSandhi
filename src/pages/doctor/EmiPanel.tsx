import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, IndianRupee, Plus, RefreshCw, X } from 'lucide-react'
import {
  listCases, listLenders, caseEvents, setFinanceModule, createCase, confirmCase, confirmAdmission, markReceived,
  withdrawCase, emiSources, caseScope, CASE_STATUS, LENDER_STATUS, CASE_EVENT, MIN_EMI_AMOUNT,
  type FinanceCase, type LenderOption, type CaseEvent, type EmiSource, type CaseScope,
} from '../../lib/financeApi'
import { isoDate, shortDate } from '../../lib/format'

// Treatment on EMI — the hospital's side (0326, step 2 of the phase-1 plan).
//
// The hospital offers EMI (or confirms a patient's request), confirms the
// patient is admitted / the date is fixed, and confirms the lender's money
// arrived. It never sees the patient's KYC or credit details: those go from
// the patient straight to the lender. Sehatsandhi is not the lender and the
// hospital pays nothing for this.

const inr = (n: number | null | undefined) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`
const digits = (s: string) => s.replace(/[^\d]/g, '')

const STATUS_TONE: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-800', hospital_confirmed: 'bg-blue-50 text-blue-800',
  shared: 'bg-blue-50 text-blue-800', offered: 'bg-blue-50 text-blue-800', sanctioned: 'bg-teal-50 text-teal-800',
  disbursed: 'bg-amber-100 text-amber-800', closed: 'bg-green-100 text-green-800',
  declined: 'bg-gray-100 text-gray-600', withdrawn: 'bg-gray-100 text-gray-600', expired: 'bg-gray-100 text-gray-600',
}

export default function EmiPanel({ businessId, moduleOn, canManage, prefill, onPrefillUsed, onModuleChanged }: {
  businessId: string
  moduleOn: boolean
  /** Owner or manager: may switch EMI on or off. */
  canManage: boolean
  /** "Offer EMI" pressed on an admission elsewhere in the dashboard. */
  prefill?: EmiSource | null
  onPrefillUsed?: () => void
  onModuleChanged?: (on: boolean) => void
}) {
  const [on, setOn] = useState(moduleOn)
  const [cases, setCases] = useState<FinanceCase[]>([])
  const [lenders, setLenders] = useState<LenderOption[]>([])
  const [view, setView] = useState<CaseScope | 'lenders'>('action')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => { setOn(moduleOn) }, [moduleOn])

  const load = useCallback(async () => {
    if (!on) return
    setLoading(true)
    try {
      const [c, l] = await Promise.all([listCases(businessId), listLenders(businessId)])
      setCases(c); setLenders(l); setErr('')
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [businessId, on])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 120_000); return () => clearInterval(t) }, [load])
  useEffect(() => { if (prefill && on) setShowNew(true) }, [prefill, on])

  const run = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id); setErr(''); setMsg('')
    try { await fn(); await load(); if (done) { setMsg(done); setTimeout(() => setMsg(''), 4000) } }
    catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const toggle = (next: boolean) => run('module', async () => {
    await setFinanceModule(businessId, next); setOn(next); onModuleChanged?.(next)
  }, next ? 'EMI switched on.' : 'EMI switched off. Existing cases are kept.')

  const counts = useMemo(() => {
    const c: Record<CaseScope, number> = { action: 0, active: 0, done: 0 }
    for (const x of cases) c[caseScope(x)]++
    return c
  }, [cases])
  const shown = view === 'lenders' ? [] : cases.filter(c => caseScope(c) === view)

  if (!on) {
    return (
      <div className="card shadow-sm max-w-2xl">
        <h2 className="font-bold text-navy-700 text-lg mb-1">Treatment on EMI</h2>
        <p className="text-sm text-gray-600">
          Patients who can't pay all at once can take a loan from an RBI-regulated bank or NBFC, paid
          <b> straight to your hospital</b>. You confirm the treatment and estimate; the patient applies with the
          lender; the lender pays you. Free for you — Sehatsandhi is not the lender and never handles the money.
        </p>
        <ul className="text-sm text-gray-600 list-disc pl-5 mt-2 space-y-0.5">
          <li>For treatments of ₹{MIN_EMI_AMOUNT.toLocaleString('en-IN')} or more.</li>
          <li>The patient's KYC and documents go to the lender, not to you or us.</li>
          <li>The lender approves your hospital as a payee once, and collects your bank details itself.</li>
        </ul>
        {canManage
          ? <button disabled={busy === 'module'} onClick={() => toggle(true)} className="btn-teal text-sm py-2 px-4 mt-4">Switch on EMI</button>
          : <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-2 mt-4">Ask the owner or manager to switch EMI on.</p>}
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-navy-700 text-lg">Treatment on EMI</h2>
          <div className="flex items-center gap-3">
            <button onClick={load} className="text-sm text-teal-700 flex items-center gap-1">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            {!showNew && (
              <button onClick={() => setShowNew(true)} className="btn-teal text-sm py-2 px-4 flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Offer EMI
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Loans by regulated lenders, paid to your hospital. You confirm the estimate and the admission; the lender does the rest.
        </p>
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {([['action', 'Needs you'], ['active', 'In progress'], ['done', 'Done'], ['lenders', 'Lenders']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ${view === id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {label}{id !== 'lenders' && counts[id] > 0 ? ` (${counts[id]})` : ''}
            </button>
          ))}
        </div>
        {msg && <p className="text-sm text-green-700 mt-2">{msg}</p>}
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </div>

      {showNew && (
        <NewCaseForm businessId={businessId} prefill={prefill ?? null}
          busy={busy === 'new'}
          onCancel={() => { setShowNew(false); onPrefillUsed?.() }}
          onSubmit={n => run('new', async () => {
            await createCase(businessId, n); setShowNew(false); onPrefillUsed?.(); setView('active')
          }, 'EMI offered. The patient now gives consent and picks a lender.')} />
      )}

      {view === 'lenders'
        ? <LendersList lenders={lenders} canManage={canManage} busy={busy === 'module'} onSwitchOff={() => toggle(false)} />
        : shown.length === 0
          ? <div className="card shadow-sm text-sm text-gray-500">
              {loading ? 'Loading…' : view === 'action' ? 'Nothing waiting for you.' : view === 'active' ? 'No cases in progress.' : 'No finished cases yet.'}
            </div>
          : shown.map(c => <CaseCard key={c.id} c={c} busy={busy} run={run} />)}
    </div>
  )
}

// ── New case ────────────────────────────────────────────────────────────────

function NewCaseForm({ businessId, prefill, busy, onCancel, onSubmit }: {
  businessId: string
  prefill: EmiSource | null
  busy: boolean
  onCancel: () => void
  onSubmit: (n: Parameters<typeof createCase>[1]) => void
}) {
  const [sources, setSources] = useState<EmiSource[] | null>(null)
  const [pick, setPick] = useState<string>(prefill ? `${prefill.kind}:${prefill.id}` : '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [treatment, setTreatment] = useState(prefill?.treatment ?? '')
  const [estimate, setEstimate] = useState(prefill?.amount ? String(Math.round(prefill.amount)) : '')
  const [loan, setLoan] = useState(prefill?.amount ? String(Math.round(prefill.amount)) : '')
  const [planned, setPlanned] = useState(prefill?.plannedOn ?? '')
  const [problem, setProblem] = useState('')

  useEffect(() => {
    emiSources(businessId).then(s => {
      // A prefill from elsewhere may not be in the lists (an older admission); keep it selectable.
      const found = prefill && s.find(x => x.kind === prefill.kind && x.id === prefill.id)
      if (prefill && !found) s = [prefill, ...s]
      // The list knows the stay's reason; the ward board doesn't.
      if (found) { setTreatment(found.treatment); if (found.plannedOn) setPlanned(found.plannedOn) }
      setSources(s)
    }, () => setSources(prefill ? [prefill] : []))
  }, [businessId, prefill])

  const src = sources?.find(s => `${s.kind}:${s.id}` === pick) ?? null
  const choose = (key: string) => {
    setPick(key)
    const s = sources?.find(x => `${x.kind}:${x.id}` === key)
    if (s) {
      setTreatment(s.kind === 'bill' ? (treatment || s.treatment) : s.treatment)
      if (s.amount) { setEstimate(String(Math.round(s.amount))); setLoan(String(Math.round(s.amount))) }
      if (s.plannedOn) setPlanned(s.plannedOn)
    }
  }

  const submit = () => {
    const est = Number(estimate), amt = Number(loan || estimate)
    if (pick === '') { setProblem('Choose the patient.'); return }
    if (pick === 'other' && (!name.trim() || digits(phone).length < 10)) { setProblem('Enter the patient’s name and 10-digit mobile number.'); return }
    if (!treatment.trim()) { setProblem('Say what the treatment is.'); return }
    if (!(est >= MIN_EMI_AMOUNT)) { setProblem(`EMI is for treatments of ₹${MIN_EMI_AMOUNT.toLocaleString('en-IN')} or more.`); return }
    if (!(amt >= MIN_EMI_AMOUNT) || amt > est) { setProblem(`The loan must be ₹${MIN_EMI_AMOUNT.toLocaleString('en-IN')} or more and not more than the estimate.`); return }
    setProblem('')
    onSubmit({
      memberId: src?.memberId ?? null,
      patientName: pick === 'other' ? name.trim() : '',
      patientPhone: pick === 'other' ? digits(phone).slice(-10) : (src?.patientPhone ?? ''),
      treatment: treatment.trim(), estimate: est, requested: amt, plannedOn: planned || null,
      admissionId: src?.kind === 'admission' ? src.id : src?.admissionId ?? null,
      surgeryId: src?.kind === 'surgery' ? src.id : null,
      billId: src?.kind === 'bill' ? src.id : null,
    })
  }

  const group = (k: EmiSource['kind']) => (sources ?? []).filter(s => s.kind === k)

  return (
    <div className="card shadow-sm border border-teal-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-navy-700">Offer EMI to a patient</h3>
        <button onClick={onCancel} aria-label="Close" className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-gray-600 mb-1 block">Patient</label>
          <select className="input-field" value={pick} onChange={e => choose(e.target.value)} disabled={sources === null}>
            <option value="">{sources === null ? 'Loading…' : 'Choose an admission, planned surgery or bill'}</option>
            {group('admission').length > 0 && <optgroup label="Admitted now">{group('admission').map(s => <option key={s.id} value={`admission:${s.id}`}>{s.label}</option>)}</optgroup>}
            {group('surgery').length > 0 && <optgroup label="Planned surgeries (next 60 days)">{group('surgery').map(s => <option key={s.id} value={`surgery:${s.id}`}>{s.label}</option>)}</optgroup>}
            {group('bill').length > 0 && <optgroup label="Recent bills of ₹10,000+">{group('bill').map(s => <option key={s.id} value={`bill:${s.id}`}>{s.label}</option>)}</optgroup>}
            <option value="other">Someone else (type name and number)</option>
          </select>
        </div>
        {pick === 'other' && (<>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Patient name</label>
            <input className="input-field" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Mobile number</label>
            <input className="input-field" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="10 digits" />
          </div>
          <p className="sm:col-span-2 text-xs text-gray-500">Without a patient record, the lender’s payment can’t be added to a bill automatically — you’d enter it yourself.</p>
        </>)}
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-gray-600 mb-1 block">Treatment</label>
          <input className="input-field" value={treatment} onChange={e => setTreatment(e.target.value)} placeholder="e.g. Knee replacement (right)" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Estimate (₹)</label>
          <input className="input-field" inputMode="numeric" value={estimate}
            onChange={e => { const v = digits(e.target.value); if (!loan || loan === estimate) setLoan(v); setEstimate(v) }} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Loan amount (₹)</label>
          <input className="input-field" inputMode="numeric" value={loan} onChange={e => setLoan(digits(e.target.value))} />
          <p className="text-xs text-gray-500 mt-0.5">Up to the estimate. The patient can pay part themselves.</p>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Admission / treatment date</label>
          <input className="input-field" type="date" value={planned} onChange={e => setPlanned(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-3">
        Sending this confirms the treatment and estimate on behalf of the hospital. The patient then consents and
        chooses a lender; nothing is shared with a lender before that.
      </p>
      {problem && <p className="text-sm text-red-600 mt-2">{problem}</p>}
      <div className="flex gap-2 mt-3">
        <button disabled={busy} onClick={submit} className="btn-teal text-sm py-2 px-4">{busy ? 'Saving…' : 'Offer EMI'}</button>
        <button onClick={onCancel} className="text-sm text-gray-600 px-3">Cancel</button>
      </div>
    </div>
  )
}

// ── One case ────────────────────────────────────────────────────────────────

function CaseCard({ c, busy, run }: {
  c: FinanceCase
  busy: string | null
  run: (id: string, fn: () => Promise<unknown>, done?: string) => Promise<void>
}) {
  const [open, setOpen] = useState(caseScope(c) === 'action')
  const [events, setEvents] = useState<CaseEvent[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [reason, setReason] = useState('')

  // Confirm form (patient-started cases)
  const [treatment, setTreatment] = useState(c.treatment)
  const [estimate, setEstimate] = useState(String(Math.round(c.estimate_amount)))
  const [loan, setLoan] = useState(String(Math.round(c.requested_amount)))
  const [planned, setPlanned] = useState(c.planned_on ?? '')

  const paid = c.lenders.find(l => l.status === 'disbursed')
  const [recvAmount, setRecvAmount] = useState(String(Math.round(paid?.disbursed_amount ?? c.requested_amount)))
  const [recvOn, setRecvOn] = useState(isoDate(new Date()))

  const id = c.id
  const loadHistory = async () => {
    setShowHistory(s => !s)
    if (!events) setEvents(await caseEvents(c.id).catch(() => []))
  }

  const canWithdraw = ['requested', 'hospital_confirmed', 'shared', 'offered'].includes(c.status)
  const needsAdmission = ['shared', 'offered', 'sanctioned'].includes(c.status) && !c.admission_confirmed_at

  return (
    <div className="card shadow-sm">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-navy-700">{c.patient_name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_TONE[c.status]}`}>{CASE_STATUS[c.status]}</span>
            {needsAdmission && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Confirm admission</span>}
          </div>
          <div className="text-sm text-gray-600 truncate">{c.treatment} · loan {inr(c.requested_amount)} of {inr(c.estimate_amount)}</div>
          <div className="text-xs text-gray-400">{c.case_no} · {c.started_by === 'patient' ? 'asked by patient' : 'offered by you'} · {shortDate(new Date(c.created_at))}</div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
          <div className="grid sm:grid-cols-3 gap-2 text-gray-600">
            <div><span className="text-xs text-gray-400 block">Mobile</span>{c.patient_phone}</div>
            <div><span className="text-xs text-gray-400 block">Admission / treatment date</span>{c.planned_on ? shortDate(new Date(c.planned_on)) : '—'}</div>
            <div><span className="text-xs text-gray-400 block">Confirmed by</span>{c.hospital_confirmed_by ?? (c.hospital_confirmed_at ? 'Hospital' : '—')}</div>
          </div>

          {/* Lenders on the case */}
          {c.lenders.length > 0 && (
            <div className="space-y-2">
              {c.lenders.map(l => (
                <div key={l.id} className="bg-gray-50 rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-medium text-navy-700">{l.lender_name}</span>
                    <span className="text-xs text-gray-600">{LENDER_STATUS[l.status]}{l.lender_ref ? ` · ref ${l.lender_ref}` : ''}</span>
                  </div>
                  {l.offer_amount != null && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      Offer {inr(l.offer_amount)}{l.offer_tenure_months ? ` over ${l.offer_tenure_months} months` : ''}{l.offer_emi ? `, EMI ${inr(l.offer_emi)}` : ''} (lender’s figures)
                    </div>
                  )}
                  {l.status === 'declined' && l.decline_reason && <div className="text-xs text-gray-600 mt-0.5">Reason: {l.decline_reason}</div>}
                  {l.status === 'disbursed' && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      Paid {inr(l.disbursed_amount)}{l.disbursed_on ? ` on ${shortDate(new Date(l.disbursed_on))}` : ''}{l.utr ? ` · UTR ${l.utr}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* What the hospital does next */}
          {c.status === 'requested' && (
            <div className="bg-amber-50 rounded-lg p-3 space-y-2">
              <p className="text-amber-900">The patient asked for EMI. Check the treatment and your estimate, then confirm.</p>
              <div className="grid sm:grid-cols-2 gap-2">
                <input className="input-field sm:col-span-2" value={treatment} onChange={e => setTreatment(e.target.value)} />
                <label className="text-xs text-gray-600">Estimate (₹)
                  <input className="input-field" inputMode="numeric" value={estimate} onChange={e => setEstimate(digits(e.target.value))} /></label>
                <label className="text-xs text-gray-600">Loan amount (₹)
                  <input className="input-field" inputMode="numeric" value={loan} onChange={e => setLoan(digits(e.target.value))} /></label>
                <label className="text-xs text-gray-600">Admission / treatment date
                  <input className="input-field" type="date" value={planned} onChange={e => setPlanned(e.target.value)} /></label>
              </div>
              <button disabled={busy === id} className="btn-teal text-sm py-2 px-4"
                onClick={() => run(id, () => confirmCase(c.id, { treatment, estimate: Number(estimate), requested: Number(loan), plannedOn: planned || null }), 'Estimate confirmed.')}>
                Confirm estimate
              </button>
            </div>
          )}

          {c.status === 'hospital_confirmed' && (
            <p className="bg-blue-50 text-blue-900 rounded-lg p-3">
              Waiting for the patient to give consent and choose a lender. Nothing has been shared with any lender yet.
            </p>
          )}

          {needsAdmission && (
            <div className="bg-amber-50 rounded-lg p-3 space-y-2">
              <p className="text-amber-900">The lender pays only after you confirm the patient is admitted or the treatment date is fixed.</p>
              <div className="flex gap-2 flex-wrap items-end">
                <label className="text-xs text-gray-600">Date
                  <input className="input-field" type="date" value={planned} onChange={e => setPlanned(e.target.value)} /></label>
                <button disabled={busy === id} className="btn-teal text-sm py-2 px-4"
                  onClick={() => run(id, () => confirmAdmission(c.id, planned || null, c.admission_id), 'Admission confirmed.')}>
                  Confirm admission
                </button>
              </div>
            </div>
          )}

          {c.admission_confirmed_at && ['shared', 'offered', 'sanctioned'].includes(c.status) && (
            <p className="text-gray-600">Admission confirmed {shortDate(new Date(c.admission_confirmed_at))}. Waiting for the lender.</p>
          )}

          {c.status === 'disbursed' && (
            <div className="bg-amber-50 rounded-lg p-3 space-y-2">
              <p className="text-amber-900 flex items-center gap-1"><IndianRupee className="w-4 h-4" /> The lender says it has paid you. Check your bank, then confirm.</p>
              <div className="flex gap-2 flex-wrap items-end">
                <label className="text-xs text-gray-600">Amount received (₹)
                  <input className="input-field w-36" inputMode="numeric" value={recvAmount} onChange={e => setRecvAmount(digits(e.target.value))} /></label>
                <label className="text-xs text-gray-600">Received on
                  <input className="input-field" type="date" value={recvOn} onChange={e => setRecvOn(e.target.value)} /></label>
                <button disabled={busy === id || !Number(recvAmount)} className="btn-teal text-sm py-2 px-4"
                  onClick={() => run(id, () => markReceived(c.id, Number(recvAmount), recvOn), 'Recorded as received.')}>
                  Money received
                </button>
              </div>
              <p className="text-xs text-gray-600">
                {c.patient_member_id
                  ? 'This adds a “Finance” payment to the patient’s account.'
                  : 'No patient record is linked, so add the payment to their bill yourself.'}
              </p>
            </div>
          )}

          {c.status === 'closed' && c.received_at && (
            <p className="text-green-800">Money received {shortDate(new Date(c.received_at))}.</p>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={loadHistory} className="text-teal-700 text-sm">{showHistory ? 'Hide history' : 'History'}</button>
            {canWithdraw && !withdrawing && (
              <button onClick={() => setWithdrawing(true)} className="text-red-600 text-sm">Withdraw</button>
            )}
          </div>

          {withdrawing && (
            <div className="flex gap-2 flex-wrap">
              <input className="input-field flex-1 min-w-[12rem]" placeholder="Why? (e.g. patient will pay in cash)" value={reason} onChange={e => setReason(e.target.value)} />
              <button disabled={busy === id || !reason.trim()} className="text-sm py-2 px-3 rounded-lg bg-red-600 text-white disabled:opacity-50"
                onClick={() => run(id, () => withdrawCase(c.id, reason.trim()), 'Case withdrawn.')}>Withdraw case</button>
              <button onClick={() => setWithdrawing(false)} className="text-sm text-gray-600 px-2">Cancel</button>
            </div>
          )}

          {showHistory && (
            <ol className="text-xs text-gray-600 space-y-1 border-l-2 border-gray-200 pl-3">
              {events === null ? <li>Loading…</li> : events.map(e => (
                <li key={e.id}>
                  <span className="text-gray-400">{new Date(e.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                  {' · '}{CASE_EVENT[e.event] ?? e.event}{e.actor_name ? ` (${e.actor_name})` : ''}{e.note ? ` — ${e.note}` : ''}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

// ── Lenders ─────────────────────────────────────────────────────────────────

const LINK_LABEL: Record<string, string> = {
  approved: 'You’re an approved payee', requested: 'Waiting for the lender to approve you', rejected: 'Lender declined',
}

function LendersList({ lenders, canManage, busy, onSwitchOff }: {
  lenders: LenderOption[]; canManage: boolean; busy: boolean; onSwitchOff: () => void
}) {
  return (
    <div className="space-y-3">
      {lenders.length === 0 && (
        <div className="card shadow-sm text-sm text-gray-500">No lenders are live yet. You can still offer EMI; patients will see lenders as they join.</div>
      )}
      {lenders.map(l => (
        <div key={l.business_id} className="card shadow-sm text-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold text-navy-700">{l.legal_name}</span>
            <span className="text-xs text-gray-500">{l.entity_type === 'bank' ? 'Bank' : 'NBFC'} · RBI regulated</span>
          </div>
          {l.terms_summary && <p className="text-gray-600 mt-1">{l.terms_summary}</p>}
          <p className="text-xs text-gray-500 mt-1">
            {inr(l.min_amount)}{l.max_amount ? ` – ${inr(l.max_amount)}` : ' and up'}{l.tenures ? ` · ${l.tenures}` : ''}
            {' · '}{l.pays_to === 'hospital' ? 'Pays the hospital' : 'Pays the patient'}
            {l.no_cost_emi ? ' · No-cost EMI with you' : ''}
          </p>
          <p className="text-xs mt-1">
            <span className={l.link_status === 'approved' ? 'text-green-700' : l.link_status === 'rejected' ? 'text-red-600' : 'text-gray-600'}>
              {l.link_status ? LINK_LABEL[l.link_status] : 'Not set up yet — the lender approves you on its first case here'}
            </span>
            {l.agreement_done_on ? ` · agreement signed ${shortDate(new Date(l.agreement_done_on))}` : ''}
          </p>
          {(l.grievance_email || l.grievance_phone) && (
            <p className="text-xs text-gray-400 mt-1">Grievance: {[l.grievance_email, l.grievance_phone].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      ))}
      {canManage && (
        <div className="text-xs text-gray-500">
          Don't want to offer EMI any more?{' '}
          <button disabled={busy} onClick={onSwitchOff} className="text-red-600 underline">Switch off EMI</button> (cases are kept).
        </div>
      )}
    </div>
  )
}
