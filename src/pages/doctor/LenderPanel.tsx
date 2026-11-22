import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import {
  lenderCases, lenderCaseViewed, lenderCaseUpdate, payeeDecide, lenderProfile, saveLenderProfile, payeeLinks,
  LENDER_ACTION, CASE_STATUS, MIN_EMI_AMOUNT,
  type LenderCase, type LenderProfile, type PayeeLink, type LenderUpdate,
} from '../../lib/financeApi'
import { isoDate, shortDate } from '../../lib/format'

// Treatment on EMI — the lender's dashboard (0326, step 4).
//
// A lender sees ONLY the cases a patient chose to share with it, through
// sehat_lender_cases (minimal columns; every opening is logged). It approves a
// hospital as a payee once, then posts offer / sanction / decline / paid with
// the UTR. Payout to a hospital needs that approval and the hospital's
// admission confirmation; the database refuses it otherwise. KYC, the loan
// agreement and repayments all stay in the lender's own systems.

const inr = (n: number | null | undefined) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`
const digits = (s: string) => s.replace(/[^\d]/g, '')
type View = 'new' | 'active' | 'done' | 'hospitals' | 'profile' | 'reports'
const scopeOf = (c: LenderCase): 'new' | 'active' | 'done' =>
  ['disbursed', 'declined', 'withdrawn'].includes(c.lender_status) || ['withdrawn', 'expired', 'closed'].includes(c.case_status)
    ? 'done' : c.lender_status === 'shared' ? 'new' : 'active'

export default function LenderPanel({ businessId, canManage }: { businessId: string; canManage: boolean }) {
  const [cases, setCases] = useState<LenderCase[]>([])
  const [profile, setProfile] = useState<LenderProfile | null | undefined>(undefined)
  const [links, setLinks] = useState<PayeeLink[]>([])
  const [view, setView] = useState<View>('new')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, p, l] = await Promise.all([lenderCases(businessId), lenderProfile(businessId), payeeLinks(businessId)])
      setCases(c); setProfile(p); setLinks(l); setErr('')
      if (!p) setView('profile')
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [businessId])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 120_000); return () => clearInterval(t) }, [load])

  const run = async (id: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(id); setErr(''); setMsg('')
    try { await fn(); await load(); if (done) { setMsg(done); setTimeout(() => setMsg(''), 4000) } }
    catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }

  const counts = useMemo(() => {
    const n = { new: 0, active: 0, done: 0 }
    for (const c of cases) n[scopeOf(c)]++
    return n
  }, [cases])
  const pendingPayees = links.filter(l => l.status === 'requested').length

  return (
    <div className="space-y-4">
      <div className="card shadow-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-navy-700 text-lg">Treatment on EMI — lender</h2>
          <button onClick={load} className="text-sm text-teal-700 flex items-center gap-1">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Cases patients chose to share with you, with the hospital's confirmed estimate. KYC, the agreement and repayments stay with you.
        </p>
        {profile === null && <p className="text-sm bg-amber-50 text-amber-900 rounded-lg p-2 mt-2">Fill in your lender profile below. Sehatsandhi reviews it before patients can choose you.</p>}
        {profile?.status === 'pending' && <p className="text-sm bg-amber-50 text-amber-900 rounded-lg p-2 mt-2">Your profile is waiting for Sehatsandhi's review. Patients can choose you once it is approved.</p>}
        {profile?.status === 'suspended' && <p className="text-sm bg-red-50 text-red-800 rounded-lg p-2 mt-2">Your account is suspended. Patients can't choose you. Contact Sehatsandhi.</p>}
        <div className="flex gap-2 mt-3 overflow-x-auto">
          {([['new', `New${counts.new ? ` (${counts.new})` : ''}`], ['active', `In progress${counts.active ? ` (${counts.active})` : ''}`], ['done', 'Done'],
             ['hospitals', `Hospitals${pendingPayees ? ` (${pendingPayees})` : ''}`], ['profile', 'Profile'], ['reports', 'Reports']] as [View, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ${view === id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-200'}`}>{label}</button>
          ))}
        </div>
        {msg && <p className="text-sm text-green-700 mt-2">{msg}</p>}
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </div>

      {(view === 'new' || view === 'active' || view === 'done') && (() => {
        const shown = cases.filter(c => scopeOf(c) === view)
        return shown.length === 0
          ? <div className="card shadow-sm text-sm text-gray-500">{loading ? 'Loading…' : view === 'new' ? 'No new cases.' : view === 'active' ? 'Nothing in progress.' : 'Nothing finished yet.'}</div>
          : shown.map(c => <LenderCaseCard key={c.case_lender_id} c={c} lenderId={businessId} canManage={canManage} busy={busy} run={run} />)
      })()}

      {view === 'hospitals' && <Hospitals links={links} lenderId={businessId} canManage={canManage} busy={busy} run={run} />}
      {view === 'profile' && profile !== undefined && <ProfileForm profile={profile} canManage={canManage} busy={busy === 'profile'}
        onSave={p => run('profile', () => saveLenderProfile(businessId, p), 'Profile saved.')} />}
      {view === 'reports' && <Reports cases={cases} profile={profile ?? null} />}
    </div>
  )
}

// ── One case ────────────────────────────────────────────────────────────────

function LenderCaseCard({ c, lenderId, canManage, busy, run }: {
  c: LenderCase; lenderId: string; canManage: boolean; busy: string | null
  run: (id: string, fn: () => Promise<unknown>, done?: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [viewed, setViewed] = useState(false)
  const [mode, setMode] = useState<'' | 'offer' | 'sanction' | 'decline' | 'pay' | 'payee'>('')
  const [ref, setRef] = useState(c.lender_ref ?? '')
  const [amount, setAmount] = useState(String(Math.round(c.offer_amount ?? c.requested_amount)))
  const [tenure, setTenure] = useState(c.offer_tenure_months ? String(c.offer_tenure_months) : '')
  const [emi, setEmi] = useState(c.offer_emi ? String(Math.round(c.offer_emi)) : '')
  const [reason, setReason] = useState('')
  const [paid, setPaid] = useState(String(Math.round(c.offer_amount ?? c.requested_amount)))
  const [paidOn, setPaidOn] = useState(isoDate(new Date()))
  const [utr, setUtr] = useState('')
  const [agreementOn, setAgreementOn] = useState('')
  const [noCost, setNoCost] = useState(false)

  const id = c.case_lender_id
  const toggle = () => {
    setOpen(o => !o)
    // Every opening is recorded for the hospital and Sehatsandhi to see — once per screen.
    if (!viewed) { setViewed(true); lenderCaseViewed(id).catch(() => undefined) }
  }
  const closed = ['withdrawn', 'expired', 'closed'].includes(c.case_status)
  const live = !closed && ['shared', 'offered', 'sanctioned'].includes(c.lender_status)
  const payeeOk = c.payee_status === 'approved'
  const offerFields = { offer_amount: Number(amount) || undefined, offer_tenure_months: Number(tenure) || undefined, offer_emi: Number(emi) || undefined, lender_ref: ref.trim() || undefined }
  const send = (u: LenderUpdate, done: string) => run(id, async () => { await lenderCaseUpdate(id, u); setMode('') }, done)

  return (
    <div className="card shadow-sm">
      <button onClick={toggle} className="w-full text-left flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-navy-700">{c.patient_name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-800">{closed ? CASE_STATUS[c.case_status as keyof typeof CASE_STATUS] : LENDER_ACTION[c.lender_status]}</span>
            {live && !payeeOk && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Hospital not yet a payee</span>}
          </div>
          <div className="text-sm text-gray-600 truncate">{c.treatment} · {inr(c.requested_amount)} at {c.hospital_name}</div>
          <div className="text-xs text-gray-400">{c.case_no} · shared {shortDate(new Date(c.shared_at))}</div>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
          <div className="grid sm:grid-cols-2 gap-2 text-gray-600">
            <div><span className="text-xs text-gray-400 block">Patient mobile</span><a href={`tel:${c.patient_phone}`} className="text-teal-700">{c.patient_phone}</a></div>
            <div><span className="text-xs text-gray-400 block">Loan asked / estimate</span>{inr(c.requested_amount)} of {inr(c.estimate_amount)}</div>
            <div><span className="text-xs text-gray-400 block">Treatment date</span>{c.planned_on ? shortDate(new Date(c.planned_on)) : '—'}</div>
            <div><span className="text-xs text-gray-400 block">Hospital confirmed estimate</span>{c.hospital_confirmed_at ? shortDate(new Date(c.hospital_confirmed_at)) : '—'}</div>
            <div><span className="text-xs text-gray-400 block">Admission confirmed</span>{c.admission_confirmed_at ? shortDate(new Date(c.admission_confirmed_at)) : 'Not yet'}</div>
            <div><span className="text-xs text-gray-400 block">Hospital</span>{c.hospital_name}{c.hospital_address ? `, ${c.hospital_address}` : ''}</div>
            {(c.hospital_gstin || c.hospital_reg_no) && (
              <div className="sm:col-span-2 text-xs">{c.hospital_gstin ? `GSTIN ${c.hospital_gstin}` : ''}{c.hospital_gstin && c.hospital_reg_no ? ' · ' : ''}{c.hospital_reg_no ? `Reg. no. ${c.hospital_reg_no}` : ''}</div>
            )}
          </div>

          {(c.offer_amount != null || c.lender_ref) && (
            <p className="text-gray-600">Your figures: {inr(c.offer_amount)}{c.offer_tenure_months ? ` · ${c.offer_tenure_months} months` : ''}{c.offer_emi ? ` · EMI ${inr(c.offer_emi)}` : ''}{c.lender_ref ? ` · ref ${c.lender_ref}` : ''}</p>
          )}
          {c.lender_status === 'disbursed' && (
            <p className="text-gray-700">Paid {inr(c.disbursed_amount)}{c.disbursed_on ? ` on ${shortDate(new Date(c.disbursed_on))}` : ''} · UTR {c.utr} · {c.received ? <b className="text-green-700">hospital confirmed receipt</b> : 'waiting for the hospital to confirm receipt'}</p>
          )}

          {/* Payee: the lender approves the hospital once, before any payout to it. */}
          {live && !payeeOk && canManage && (
            mode === 'payee' ? (
              <div className="bg-amber-50 rounded-lg p-3 space-y-2">
                <p className="text-amber-900">Approve {c.hospital_name} as a payee for all your EMI cases there. Collect its bank details in your own merchant onboarding.</p>
                <div className="flex gap-3 flex-wrap items-end">
                  <label className="text-xs text-gray-600">Merchant agreement signed on (optional)
                    <input className="input-field" type="date" value={agreementOn} onChange={e => setAgreementOn(e.target.value)} /></label>
                  <label className="text-xs text-gray-600 flex items-center gap-2"><input type="checkbox" checked={noCost} onChange={e => setNoCost(e.target.checked)} /> No-cost EMI (hospital pays the interest)</label>
                </div>
                <div className="flex gap-2">
                  <button disabled={busy === id} className="btn-teal text-sm py-2 px-4"
                    onClick={() => run(id, async () => { await payeeDecide(lenderId, c.hospital_id, true, { agreementOn, noCostEmi: noCost }); setMode('') }, 'Hospital approved as payee.')}>Approve payee</button>
                  <button onClick={() => setMode('')} className="text-sm text-gray-600 px-2">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setMode('payee')} className="text-sm text-amber-800 underline">Approve {c.hospital_name} as a payee</button>
            )
          )}
          {live && !payeeOk && !canManage && <p className="text-xs text-amber-800">Your owner or manager approves this hospital as a payee.</p>}

          {/* Status actions */}
          {live && (
            <div className="flex gap-2 flex-wrap">
              {c.lender_status !== 'sanctioned' && <button onClick={() => setMode('offer')} className="text-sm py-2 px-3 rounded-lg border border-gray-200">{c.lender_status === 'offered' ? 'Change offer' : 'Make offer'}</button>}
              {c.lender_status !== 'sanctioned' && <button onClick={() => setMode('sanction')} className="text-sm py-2 px-3 rounded-lg border border-teal-300 text-teal-800">Sanctioned</button>}
              {c.lender_status === 'sanctioned' && <button onClick={() => setMode('pay')} className="btn-teal text-sm py-2 px-4">Paid to hospital</button>}
              <button onClick={() => setMode('decline')} className="text-sm py-2 px-3 rounded-lg border border-red-200 text-red-700">Decline</button>
            </div>
          )}

          {(mode === 'offer' || mode === 'sanction') && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-gray-600">{mode === 'offer' ? 'Shown to the patient as your figures; your Key Fact Statement has the full terms.' : 'Sanctioned in your system. Other lenders on this case step back.'}</p>
              <div className="grid sm:grid-cols-4 gap-2">
                <label className="text-xs text-gray-600">Amount (₹)<input className="input-field" inputMode="numeric" value={amount} onChange={e => setAmount(digits(e.target.value))} /></label>
                <label className="text-xs text-gray-600">Months<input className="input-field" inputMode="numeric" value={tenure} onChange={e => setTenure(digits(e.target.value))} /></label>
                <label className="text-xs text-gray-600">EMI (₹)<input className="input-field" inputMode="numeric" value={emi} onChange={e => setEmi(digits(e.target.value))} /></label>
                <label className="text-xs text-gray-600">Your ref.<input className="input-field" value={ref} onChange={e => setRef(e.target.value)} /></label>
              </div>
              <div className="flex gap-2">
                <button disabled={busy === id} className="btn-teal text-sm py-2 px-4"
                  onClick={() => send({ status: mode === 'offer' ? 'offered' : 'sanctioned', ...offerFields }, mode === 'offer' ? 'Offer saved.' : 'Marked sanctioned.')}>
                  {mode === 'offer' ? 'Save offer' : 'Mark sanctioned'}
                </button>
                <button onClick={() => setMode('')} className="text-sm text-gray-600 px-2">Cancel</button>
              </div>
            </div>
          )}

          {mode === 'pay' && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              {!payeeOk && <p className="text-amber-800">Approve the hospital as a payee first.</p>}
              {!c.admission_confirmed_at && <p className="text-amber-800">Wait for the hospital to confirm the admission / treatment date.</p>}
              <div className="grid sm:grid-cols-3 gap-2">
                <label className="text-xs text-gray-600">Amount paid (₹)<input className="input-field" inputMode="numeric" value={paid} onChange={e => setPaid(digits(e.target.value))} /></label>
                <label className="text-xs text-gray-600">Paid on<input className="input-field" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} /></label>
                <label className="text-xs text-gray-600">UTR<input className="input-field" value={utr} onChange={e => setUtr(e.target.value.trim())} /></label>
              </div>
              <div className="flex gap-2">
                <button disabled={busy === id || !Number(paid) || !utr || !payeeOk || !c.admission_confirmed_at} className="btn-teal text-sm py-2 px-4 disabled:opacity-50"
                  onClick={() => send({ status: 'disbursed', disbursed_amount: Number(paid), disbursed_on: paidOn, utr }, 'Marked as paid. The hospital will confirm receipt.')}>Mark paid</button>
                <button onClick={() => setMode('')} className="text-sm text-gray-600 px-2">Cancel</button>
              </div>
            </div>
          )}

          {mode === 'decline' && (
            <div className="flex gap-2 flex-wrap">
              <input className="input-field flex-1 min-w-[12rem]" placeholder="Short reason (shown to the patient and hospital)" value={reason} onChange={e => setReason(e.target.value)} />
              <button disabled={busy === id || !reason.trim()} className="text-sm py-2 px-3 rounded-lg bg-red-600 text-white disabled:opacity-50"
                onClick={() => send({ status: 'declined', reason: reason.trim() }, 'Declined.')}>Decline</button>
              <button onClick={() => setMode('')} className="text-sm text-gray-600 px-2">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Hospitals (payees) ──────────────────────────────────────────────────────

function Hospitals({ links, lenderId, canManage, busy, run }: {
  links: PayeeLink[]; lenderId: string; canManage: boolean; busy: string | null
  run: (id: string, fn: () => Promise<unknown>, done?: string) => Promise<void>
}) {
  const [note, setNote] = useState<Record<string, string>>({})
  if (links.length === 0) return <div className="card shadow-sm text-sm text-gray-500">No hospitals yet. A hospital appears here when a patient there first shares a case with you.</div>
  return (
    <div className="space-y-3">
      {links.map(l => (
        <div key={l.hospital_id} className="card shadow-sm text-sm space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold text-navy-700">{l.hospital_name}</span>
            <span className={`text-xs ${l.status === 'approved' ? 'text-green-700' : l.status === 'rejected' ? 'text-red-600' : 'text-amber-700'}`}>
              {l.status === 'approved' ? 'Approved payee' : l.status === 'rejected' ? 'Not approved' : 'Waiting for your approval'}
            </span>
          </div>
          {l.hospital_address && <p className="text-xs text-gray-500">{l.hospital_address}</p>}
          <p className="text-xs text-gray-500">
            First case {shortDate(new Date(l.requested_at))}{l.decided_at ? ` · decided ${shortDate(new Date(l.decided_at))}` : ''}
            {l.agreement_done_on ? ` · agreement ${shortDate(new Date(l.agreement_done_on))}` : ''}{l.no_cost_emi ? ' · no-cost EMI' : ''}
            {l.decision_note ? ` · ${l.decision_note}` : ''}
          </p>
          {canManage && (
            <div className="flex gap-2 flex-wrap items-center">
              <input className="input-field flex-1 min-w-[10rem]" placeholder="Note (optional)" value={note[l.hospital_id] ?? ''} onChange={e => setNote(n => ({ ...n, [l.hospital_id]: e.target.value }))} />
              {l.status !== 'approved' && <button disabled={busy === l.hospital_id} className="btn-teal text-sm py-2 px-3"
                onClick={() => run(l.hospital_id, () => payeeDecide(lenderId, l.hospital_id, true, { note: note[l.hospital_id] }), 'Approved.')}>Approve</button>}
              {l.status !== 'rejected' && <button disabled={busy === l.hospital_id} className="text-sm py-2 px-3 rounded-lg border border-red-200 text-red-700"
                onClick={() => run(l.hospital_id, () => payeeDecide(lenderId, l.hospital_id, false, { note: note[l.hospital_id] }), 'Not approved.')}>Don't approve</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Profile ─────────────────────────────────────────────────────────────────

function ProfileForm({ profile, canManage, busy, onSave }: {
  profile: LenderProfile | null; canManage: boolean; busy: boolean; onSave: (p: Partial<LenderProfile>) => void
}) {
  const [f, setF] = useState<Partial<LenderProfile>>(profile ?? { entity_type: 'nbfc', pays_to: 'hospital', min_amount: MIN_EMI_AMOUNT })
  const [problem, setProblem] = useState('')
  const set = (k: keyof LenderProfile, v: string | number | null) => setF(x => ({ ...x, [k]: v }))
  const txt = (k: keyof LenderProfile, label: string, ph = '') => (
    <label className="text-xs font-medium text-gray-600 block">{label}
      <input className="input-field mt-1" disabled={!canManage} placeholder={ph} value={(f[k] as string | null) ?? ''} onChange={e => set(k, e.target.value)} />
    </label>
  )
  const save = () => {
    if (!f.legal_name?.trim()) { setProblem('Enter your legal name.'); return }
    if (!f.rbi_reg_no?.trim()) { setProblem('Enter your RBI registration / licence number.'); return }
    if (!f.grievance_email?.trim() && !f.grievance_phone?.trim()) { setProblem('Add a grievance officer email or phone — patients are shown it.'); return }
    if (f.max_amount != null && Number(f.max_amount) < Number(f.min_amount ?? MIN_EMI_AMOUNT)) { setProblem('Maximum must be at least the minimum.'); return }
    setProblem('')
    onSave({ ...f, min_amount: Math.max(Number(f.min_amount) || MIN_EMI_AMOUNT, MIN_EMI_AMOUNT), max_amount: f.max_amount ? Number(f.max_amount) : null })
  }
  return (
    <div className="card shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-navy-700">Lender profile</h3>
        {profile && <span className="text-xs text-gray-500">Status: <b>{profile.status}</b>{profile.commission_pct != null ? ` · commission ${profile.commission_pct}%` : ''}</span>}
      </div>
      <p className="text-xs text-gray-500">Patients see your name, type, terms, amounts, tenures and grievance contact. Changing your legal name, type or RBI number sends the profile back for review.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {txt('legal_name', 'Legal name', 'e.g. ABC Finance Ltd')}
        <label className="text-xs font-medium text-gray-600 block">Type
          <select className="input-field mt-1" disabled={!canManage} value={f.entity_type ?? 'nbfc'} onChange={e => set('entity_type', e.target.value)}>
            <option value="nbfc">NBFC</option><option value="bank">Bank</option>
          </select>
        </label>
        {txt('rbi_reg_no', 'RBI registration / licence no.')}
        <label className="text-xs font-medium text-gray-600 block">Pays the money to
          <select className="input-field mt-1" disabled={!canManage} value={f.pays_to ?? 'hospital'} onChange={e => set('pays_to', e.target.value)}>
            <option value="hospital">The hospital</option><option value="patient">The patient</option>
          </select>
        </label>
        <div className="sm:col-span-2">{txt('terms_summary', 'Headline terms shown to patients', 'e.g. 0% EMI up to 6 months; 12–18% a year after that')}</div>
        <label className="text-xs font-medium text-gray-600 block">Minimum loan (₹)
          <input className="input-field mt-1" inputMode="numeric" disabled={!canManage} value={f.min_amount ?? ''} onChange={e => set('min_amount', digits(e.target.value))} /></label>
        <label className="text-xs font-medium text-gray-600 block">Maximum loan (₹, optional)
          <input className="input-field mt-1" inputMode="numeric" disabled={!canManage} value={f.max_amount ?? ''} onChange={e => set('max_amount', digits(e.target.value) || null)} /></label>
        {txt('tenures', 'Tenures', 'e.g. 3, 6, 9, 12 months')}
        {txt('journey_url', 'Your application link (optional)', 'https://… — use {ref} for our case number')}
        {txt('grievance_name', 'Grievance officer')}
        {txt('grievance_email', 'Grievance email')}
        {txt('grievance_phone', 'Grievance phone')}
      </div>
      {problem && <p className="text-sm text-red-600">{problem}</p>}
      {canManage ? <button disabled={busy} onClick={save} className="btn-teal text-sm py-2 px-4">{busy ? 'Saving…' : 'Save profile'}</button>
        : <p className="text-xs text-gray-500">Only the owner or a manager can edit the profile.</p>}
    </div>
  )
}

// ── Reports ─────────────────────────────────────────────────────────────────

function Reports({ cases, profile }: { cases: LenderCase[]; profile: LenderProfile | null }) {
  const r = useMemo(() => {
    const by = (s: string) => cases.filter(c => c.lender_status === s)
    const sanctioned = by('sanctioned').length + by('disbursed').length
    const declined = by('declined').length
    const paid = by('disbursed')
    const paidValue = paid.reduce((a, c) => a + Number(c.disbursed_amount ?? 0), 0)
    const decided = sanctioned + declined
    return { total: cases.length, sanctioned, declined, paidCount: paid.length, paidValue, rate: decided ? Math.round((sanctioned / decided) * 100) : null }
  }, [cases])
  const commission = profile?.commission_pct != null ? r.paidValue * Number(profile.commission_pct) / 100 : null
  const tile = (label: string, value: string, sub?: string) => (
    <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">{label}</div><div className="font-bold text-navy-700 text-xl">{value}</div>{sub && <div className="text-xs text-gray-500">{sub}</div>}</div>
  )
  return (
    <div className="card shadow-sm space-y-3">
      <h3 className="font-bold text-navy-700">Reports (all time)</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {tile('Cases shared with you', String(r.total))}
        {tile('Sanctioned', String(r.sanctioned), r.rate != null ? `${r.rate}% of decided` : undefined)}
        {tile('Declined', String(r.declined))}
        {tile('Paid out', String(r.paidCount))}
        {tile('Value paid out', inr(r.paidValue))}
        {tile('Commission to Sehatsandhi', commission != null ? inr(Math.round(commission)) : '—', profile?.commission_pct != null ? `${profile.commission_pct}% of value paid, as agreed` : 'Rate set by Sehatsandhi')}
      </div>
      <p className="text-xs text-gray-500">Sehatsandhi raises a monthly invoice for commission on loans paid out. Patients never pay Sehatsandhi.</p>
    </div>
  )
}
